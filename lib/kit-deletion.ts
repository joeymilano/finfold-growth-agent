const MEDIA_BUCKET_PUBLIC_MARKER = "/storage/v1/object/public/media/";

/**
 * Return the storage object path only when the URL belongs to Finfold's public
 * media bucket and is scoped to the current user. Stock-library cache URLs and
 * another user's uploads must never be removed with a content kit.
 */
export function getOwnedMediaStoragePath(url: string | undefined, userId: string): string | null {
  if (!url) return null;

  try {
    const pathname = new URL(url).pathname;
    const generated = /^\/api\/generated-images\/([^/]+)\/([0-9a-f-]{36}\.(?:png|jpg|webp))$/i.exec(pathname);
    if (generated) return generated[1] === userId ? `${userId}/covers/${generated[2]}` : null;
    const markerIndex = pathname.indexOf(MEDIA_BUCKET_PUBLIC_MARKER);
    if (markerIndex < 0) return null;

    const encodedPath = pathname.slice(markerIndex + MEDIA_BUCKET_PUBLIC_MARKER.length);
    const storagePath = decodeURIComponent(encodedPath);
    return storagePath.startsWith(`${userId}/`) ? storagePath : null;
  } catch {
    return null;
  }
}

export function collectOwnedMediaStoragePaths(urls: Array<string | undefined>, userId: string): string[] {
  const paths = urls
    .map((url) => getOwnedMediaStoragePath(url, userId))
    .filter((path): path is string => Boolean(path));

  return Array.from(new Set(paths));
}

/**
 * Source images are cached once per user at `${userId}/source-images/${hash}`
 * and reused by every kit that picks the same image, so they are never owned
 * by a single kit.
 */
export function isSharedMediaCachePath(path: string, userId: string): boolean {
  return path.startsWith(`${userId}/source-images/`);
}

/**
 * Keep only storage paths that no other kit of the same user still references.
 * `otherKitUrls` are media URLs found on the user's remaining kits.
 */
export function selectDeletableMediaStoragePaths(
  candidatePaths: string[],
  otherKitUrls: Array<string | undefined>,
  userId: string
): string[] {
  const stillReferenced = new Set(collectOwnedMediaStoragePaths(otherKitUrls, userId));
  return candidatePaths.filter((path) => !isSharedMediaCachePath(path, userId) && !stillReferenced.has(path));
}
