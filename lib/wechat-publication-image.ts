import { getCloudflareContext } from "@opennextjs/cloudflare";
import { inspectMediaUploadBytes } from "@/lib/media-upload-policy";
import { readBytesWithLimit, safeExternalFetch, validateExternalHttpUrl } from "@/lib/safe-url";

function runtimeAssets(): CloudflareEnv["ASSETS"] | undefined {
  try {
    return getCloudflareContext().env.ASSETS;
  } catch {
    return undefined;
  }
}

export async function readWechatPublicationImage(
  input: string,
  maxBytes: number,
  assets = runtimeAssets()
): Promise<{ bytes: Uint8Array; contentType: "image/jpeg" | "image/png" }> {
  const url = validateExternalHttpUrl(input);
  // Read our bundled brand files directly. A public self-fetch can receive an
  // edge error page instead of the asset when invoked inside the same Worker.
  const bundledBrandImage = url.origin === "https://www.finfold.app"
    && url.pathname.startsWith("/brand/") && /\.(png|jpe?g)$/i.test(url.pathname);
  const response = bundledBrandImage && assets
    ? await assets.fetch(new Request(url, { signal: AbortSignal.timeout(15_000) }))
    : await safeExternalFetch(input, {
      headers: { Accept: "image/jpeg,image/png" }, cache: "no-store"
    }, {
      timeoutMs: 15_000, allowedContentTypes: ["image/jpeg", "image/png"],
      auditPurpose: "wechat_publication_asset"
    });
  if (!response.ok) throw new Error(`Could not download a publication image (${response.status}).`);
  const contentType = response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  if (contentType !== "image/jpeg" && contentType !== "image/png") {
    await response.body?.cancel();
    throw new Error("WeChat article images must be valid static JPEG or PNG files.");
  }
  const bytes = await readBytesWithLimit(response, maxBytes);
  const inspection = inspectMediaUploadBytes(bytes);
  if (!inspection.ok || (inspection.contentType !== "image/jpeg" && inspection.contentType !== "image/png")) {
    throw new Error("WeChat article images must be valid static JPEG or PNG files.");
  }
  return { bytes, contentType: inspection.contentType };
}
