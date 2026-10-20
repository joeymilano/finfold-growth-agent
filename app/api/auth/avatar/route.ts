
import { NextResponse } from "next/server";
import {
  AVATAR_MULTIPART_MAX_BYTES,
  parseBoundedFormData,
  RequestBodyTooLargeError
} from "@/lib/bounded-form-data";
import { inspectMediaUpload, MAX_MEDIA_DECODED_PIXELS } from "@/lib/media-upload-policy";
import { createSupabaseServerClient, createSupabaseAdminClient, hasSupabaseConfig } from "@/lib/supabase";
import { apiError } from "@/lib/i18n";
import { authUnavailableMessage } from "@/lib/auth-errors";

/**
 * POST /api/auth/avatar
 *
 * Upload a new avatar image for the current user.
 * The server handles the Supabase Storage upload and user metadata
 * update, so the secret key is never exposed to the browser.
 *
 * Expected body: FormData with "file" (image) and "userId" (string)
 */
export async function POST(request: Request) {
  const headers = request.headers ?? new Headers();
  if (!hasSupabaseConfig()) {
    return NextResponse.json(
      { error: authUnavailableMessage(headers) },
      { status: 503 }
    );
  }

  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json(
      { error: authUnavailableMessage(headers) },
      { status: 503 }
    );
  }

  // Verify the user is authenticated
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();

  if (!authUser) {
    return NextResponse.json(
      { error: apiError(headers, "登录状态已失效，请重新登录后再上传头像。", "You must be logged in to upload an avatar.") },
      { status: 401 }
    );
  }

  let formData: FormData;
  try {
    formData = await parseBoundedFormData(request, AVATAR_MULTIPART_MAX_BYTES);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return NextResponse.json(
        { error: apiError(headers, "图片不能超过 2MB。", "Image must be under 2MB.") },
        { status: 413 }
      );
    }
    throw error;
  }
  const file = formData.get("file");
  const userId = formData.get("userId") as string | null;

  if (!(file instanceof File)) {
    return NextResponse.json(
      { error: apiError(headers, "请选择要上传的图片。", "No file provided.") },
      { status: 400 }
    );
  }

  if (!userId || userId !== authUser.id) {
    return NextResponse.json(
      { error: apiError(headers, "账号信息已变化，请刷新页面后重试。", "Your account changed. Refresh the page and try again.") },
      { status: 400 }
    );
  }

  // Validate file
  if (file.size > 2 * 1024 * 1024) {
    return NextResponse.json(
      { error: apiError(headers, "图片不能超过 2MB。", "Image must be under 2MB.") },
      { status: 400 }
    );
  }

  const inspection = await inspectMediaUpload(file);
  if (!inspection.ok) {
    if (inspection.code === "pixel_limit") {
      return NextResponse.json(
        {
          error: apiError(
            headers,
            `图片尺寸过大（${inspection.width}×${inspection.height}），请上传不超过 ${MAX_MEDIA_DECODED_PIXELS / 1_000_000} 百万像素的图片。`,
            `Avatar exceeds the ${MAX_MEDIA_DECODED_PIXELS / 1_000_000}-megapixel decoded image limit (${inspection.width}×${inspection.height}).`
          )
        },
        { status: 400 }
      );
    }
    if (inspection.code === "animated_image") {
      return NextResponse.json(
        { error: apiError(headers, "暂不支持动图头像，请上传 JPG、PNG 或 WebP 静态图片。", "Animated avatars are not supported. Use a still JPG, PNG, or WebP image.") },
        { status: 400 }
      );
    }
    return NextResponse.json(
      { error: apiError(headers, "请上传 JPG、PNG 或 WebP 格式的图片。", "Avatar must be a JPG, PNG, or WebP image.") },
      { status: 400 }
    );
  }

  // Use the admin client for storage operations (bypasses RLS)
  const admin = createSupabaseAdminClient();
  if (!admin) {
    return NextResponse.json(
      { error: apiError(headers, "头像上传暂时不可用，请稍后再试。", "Avatar upload is temporarily unavailable. Please try again later.") },
      { status: 503 }
    );
  }

  const ext = inspection.contentType === "image/jpeg" ? "jpg" : inspection.contentType.split("/")[1];
  // A versioned path makes rollback safe. Upserting a fixed avatar path would
  // overwrite the previous object before metadata is durable; deleting that
  // path on a later failure would then destroy the user's last good avatar.
  const path = `${userId}/avatar-${crypto.randomUUID()}.${ext}`;
  const previousAvatarUrl =
    typeof authUser.user_metadata?.avatar_url === "string"
      ? authUser.user_metadata.avatar_url
      : null;

  const arrayBuffer = await file.arrayBuffer();

  const { error: uploadError } = await admin.storage
    .from("avatars")
    .upload(path, arrayBuffer, {
      upsert: true,
      contentType: inspection.contentType,
    });

  if (uploadError) {
    const msg = uploadError.message ?? "";
    const storageMisconfigured = /bucket/i.test(msg);
    // Operators see the storage cause in logs; users only see a retry hint.
    console.error("[auth/avatar] upload failed", storageMisconfigured ? "avatars bucket missing or misconfigured" : "storage error");
    return NextResponse.json(
      { error: apiError(headers, "头像上传暂时不可用，请稍后再试。", "Avatar upload is temporarily unavailable. Please try again later.") },
      { status: storageMisconfigured ? 503 : 400 }
    );
  }

  try {
    const { data: urlData } = admin.storage.from("avatars").getPublicUrl(path);
    // Bust cache so the browser re-fetches
    const publicUrl = `${urlData.publicUrl}?t=${Date.now()}`;

    // Update user metadata with the new avatar URL
    const { error: updateError } = await supabase.auth.updateUser({
      data: { avatar_url: publicUrl },
    });

    if (!updateError) {
      await removePreviousAvatarAfterSuccess(
        admin,
        previousAvatarUrl,
        userId,
        path
      );
      return NextResponse.json({ avatarUrl: publicUrl });
    }

    await removeAvatarAfterFailure(admin, path);
    return NextResponse.json(
      { error: apiError(headers, "头像更新失败，请重试。", "Failed to update avatar. Please try again.") },
      { status: 400 }
    );
  } catch (error) {
    await removeAvatarAfterFailure(admin, path);
    throw error;
  }
}

async function removePreviousAvatarAfterSuccess(
  admin: NonNullable<ReturnType<typeof createSupabaseAdminClient>>,
  previousAvatarUrl: string | null,
  userId: string,
  currentPath: string
): Promise<void> {
  const previousPath = ownedAvatarPath(previousAvatarUrl, userId);
  if (!previousPath || previousPath === currentPath) return;
  await removeAvatarAfterFailure(admin, previousPath);
}

function ownedAvatarPath(value: string | null, userId: string): string | null {
  if (!value) return null;
  try {
    const marker = "/storage/v1/object/public/avatars/";
    const pathname = new URL(value).pathname;
    const markerIndex = pathname.indexOf(marker);
    if (markerIndex < 0) return null;
    const encodedPath = pathname.slice(markerIndex + marker.length);
    const path = encodedPath
      .split("/")
      .map((segment) => decodeURIComponent(segment))
      .join("/");
    return path.startsWith(`${userId}/`) ? path : null;
  } catch {
    return null;
  }
}

async function removeAvatarAfterFailure(
  admin: NonNullable<ReturnType<typeof createSupabaseAdminClient>>,
  path: string
): Promise<void> {
  try {
    const { error } = await admin.storage.from("avatars").remove([path]);
    if (error) console.error("[auth/avatar] Uploaded object cleanup failed.");
  } catch (error) {
    console.error(
      "[auth/avatar] Uploaded object cleanup threw:",
      error instanceof Error ? error.name : "UnknownError"
    );
  }
}
