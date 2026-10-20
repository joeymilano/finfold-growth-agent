
import { NextResponse } from "next/server";
import type { MediaAsset } from "@/lib/content-schema";
import {
  inspectMediaUpload,
  MAX_MEDIA_DECODED_PIXELS,
  type MediaUploadMimeType
} from "@/lib/media-upload-policy";
import {
  MEDIA_MULTIPART_MAX_BYTES,
  parseBoundedFormData,
  RequestBodyTooLargeError
} from "@/lib/bounded-form-data";
import { createSupabaseAdminClient, getCurrentUserId } from "@/lib/supabase";
import { isLocalMockMode, persistenceUnavailableMessage } from "@/lib/runtime-mode";
import { apiError } from "@/lib/i18n";

const MAX_FILE_BYTES = 25 * 1024 * 1024; // 25MB per file
const MAX_TOTAL_BYTES = 25 * 1024 * 1024;
const MAX_FILE_COUNT = 6;
const MEDIA_BUCKET = "media";

export async function POST(request: Request) {
  try {
    const userId = await getCurrentUserId();
    const formData = await parseBoundedFormData(request, MEDIA_MULTIPART_MAX_BYTES);
    const entries = Array.from(formData.entries());
    if (
      entries.some(([name, value]) => name !== "files" || !(value instanceof File))
    ) {
      return NextResponse.json(
        { error: apiError(request.headers, "上传内容格式不正确，请重新选择图片。", "This upload couldn't be read. Choose the images again."), code: "invalid_form" },
        { status: 400 }
      );
    }
    const files = entries.map(([, file]) => file as File);

    if (files.length === 0) {
      return NextResponse.json({ assets: [] });
    }

    if (files.length > MAX_FILE_COUNT) {
      return NextResponse.json(
        { error: apiError(request.headers, `每次最多上传 ${MAX_FILE_COUNT} 张图片。`, `Upload at most ${MAX_FILE_COUNT} images at a time.`), code: "too_many_files" },
        { status: 400 }
      );
    }

    const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
    if (totalBytes > MAX_TOTAL_BYTES) {
      return NextResponse.json(
        { error: apiError(request.headers, "这次上传的图片合计超过 25MB，请分批或压缩后再传。", "These images add up to more than 25MB. Upload fewer or compress them."), code: "too_large" },
        { status: 400 }
      );
    }

    const validatedFiles: Array<{ file: File; contentType: MediaUploadMimeType }> = [];
    for (const file of files) {
      if (file.size > MAX_FILE_BYTES) {
        return NextResponse.json(
          { error: apiError(request.headers, `「${file.name}」超过 25MB，请压缩后再传。`, `"${file.name}" is larger than 25MB. Compress it and try again.`), code: "too_large" },
          { status: 400 }
        );
      }

      // Browser MIME values and file extensions are client-controlled. Read a
      // bounded header window and validate both magic bytes and dimensions
      // before any file is persisted, including in local mock mode.
      const inspection = await inspectMediaUpload(file);
      if (!inspection.ok) {
        if (inspection.code === "pixel_limit") {
          return NextResponse.json(
            {
              error: apiError(
                request.headers,
                `「${file.name}」分辨率过高（${inspection.width}×${inspection.height}），请缩小到 ${MAX_MEDIA_DECODED_PIXELS / 1_000_000} 百万像素以内。`,
                `"${file.name}" is too high-resolution (${inspection.width}×${inspection.height}). Resize it under ${MAX_MEDIA_DECODED_PIXELS / 1_000_000} megapixels.`
              ),
              code: "pixel_limit"
            },
            { status: 400 }
          );
        }
        if (
          inspection.code === "invalid_dimensions" ||
          inspection.code === "invalid_structure"
        ) {
          return NextResponse.json(
            { error: apiError(request.headers, `「${file.name}」已损坏或无法读取，请换一张图片。`, `"${file.name}" is damaged or unreadable. Try another image.`), code: "unreadable_image" },
            { status: 400 }
          );
        }
        if (inspection.code === "animated_image") {
          return NextResponse.json(
            { error: apiError(request.headers, `「${file.name}」是动图，暂不支持，请上传静态图片。`, `"${file.name}" is animated. Upload a still image instead.`), code: "animated_image" },
            { status: 400 }
          );
        }
        return NextResponse.json(
          {
            error: apiError(
              request.headers,
              `「${file.name}」格式不支持，请上传 JPG、PNG 或 WebP 图片。`,
              `"${file.name}" isn't supported. Upload a JPG, PNG, or WebP image.`
            ),
            code: "unsupported_type"
          },
          { status: 400 }
        );
      }

      validatedFiles.push({ file, contentType: inspection.contentType });
    }

    const admin = createSupabaseAdminClient();

    // Without storage configured, fall back to metadata-only assets so the
    // picker still works locally (files are not persisted in that case).
    if (!admin) {
      if (!isLocalMockMode()) {
        console.error("[api/media]", persistenceUnavailableMessage("Media uploads"));
        return NextResponse.json({ error: apiError(request.headers, "图片上传暂时不可用，请稍后再试。", "Image upload is temporarily unavailable. Please try again later."), code: "storage_unavailable" }, { status: 503 });
      }
      const assets: MediaAsset[] = validatedFiles.map(({ file }) => ({
        id: crypto.randomUUID(),
        name: file.name,
        size: file.size,
        type: "image"
      }));
      return NextResponse.json({ assets, persisted: false });
    }

    const assets: MediaAsset[] = [];
    const uploadedPaths: string[] = [];
    const rollbackUploadedPaths = async () => {
      if (uploadedPaths.length === 0) return;
      try {
        const { error: cleanupError } = await admin.storage
          .from(MEDIA_BUCKET)
          .remove(uploadedPaths);
        if (cleanupError) {
          console.error("[api/media] Partial upload cleanup failed:", cleanupError.message);
        }
      } catch (cleanupError) {
        console.error(
          "[api/media] Partial upload cleanup threw:",
          cleanupError instanceof Error ? cleanupError.name : "UnknownError"
        );
      }
    };

    try {
      for (const { file, contentType } of validatedFiles) {
        const id = crypto.randomUUID();
        const ext = contentType === "image/jpeg" ? "jpg" : contentType.split("/")[1];
        const path = `${userId}/${id}.${ext}`;
        const arrayBuffer = await file.arrayBuffer();

        const { error: uploadError } = await admin.storage
          .from(MEDIA_BUCKET)
          .upload(path, arrayBuffer, {
            upsert: true,
            contentType
          });

        if (uploadError) {
          await rollbackUploadedPaths();
          // Storage detail (bucket names, provider errors) stays in logs.
          console.error("[api/media] Storage upload failed:", uploadError.message);
          return NextResponse.json(
            { error: apiError(request.headers, "图片上传失败，请稍后重试。", "Image upload failed. Please try again."), code: "upload_failed" },
            { status: 400 }
          );
        }

        uploadedPaths.push(path);

        const { data: urlData } = admin.storage.from(MEDIA_BUCKET).getPublicUrl(path);

        assets.push({
          id,
          name: file.name,
          size: file.size,
          type: "image",
          url: urlData.publicUrl
        });
      }
    } catch (error) {
      await rollbackUploadedPaths();
      throw error;
    }

    return NextResponse.json({ assets, persisted: true });
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return NextResponse.json(
        { error: apiError(request.headers, "这次上传的图片合计超过 25MB，请分批或压缩后再传。", "These images add up to more than 25MB. Upload fewer or compress them."), code: "too_large" },
        { status: 413 }
      );
    }
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: apiError(request.headers, "登录后才能上传图片。", "Please log in to upload images.") }, { status: 401 });
    }
    console.error("[api/media] Upload failed:", error instanceof Error ? error.message : String(error));
    return NextResponse.json(
      { error: apiError(request.headers, "图片处理失败，请换一张图片或稍后重试。", "We couldn't process this image. Try another one or retry shortly."), code: "upload_failed" },
      { status: 400 }
    );
  }
}
