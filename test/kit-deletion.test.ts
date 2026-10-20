import { describe, expect, it } from "vitest";
import { collectOwnedMediaStoragePaths, getOwnedMediaStoragePath, selectDeletableMediaStoragePaths } from "@/lib/kit-deletion";

const userId = "user-123";

describe("content kit media cleanup", () => {
  it("extracts only media bucket objects owned by the current user", () => {
    expect(getOwnedMediaStoragePath(
      "https://project.supabase.co/storage/v1/object/public/media/user-123/covers/cover.png",
      userId
    )).toBe("user-123/covers/cover.png");

    expect(getOwnedMediaStoragePath(
      "https://project.supabase.co/storage/v1/object/public/media/user-456/covers/cover.png",
      userId
    )).toBeNull();
    expect(getOwnedMediaStoragePath("https://images.pexels.com/photos/123/photo.jpg", userId)).toBeNull();
  });

  it("decodes paths and removes duplicates before storage cleanup", () => {
    const url = "https://project.supabase.co/storage/v1/object/public/media/user-123/article-illustrations/output%201/asset.png";
    expect(collectOwnedMediaStoragePaths([url, url, undefined], userId)).toEqual([
      "user-123/article-illustrations/output 1/asset.png"
    ]);
  });

  it("rejects malformed URLs and shared stock-cache paths", () => {
    expect(getOwnedMediaStoragePath("not-a-url", userId)).toBeNull();
    expect(getOwnedMediaStoragePath(
      "https://project.supabase.co/storage/v1/object/public/media/stock-cache/pixabay/image.jpg",
      userId
    )).toBeNull();
  });

  it("keeps media still referenced by other kits and the shared source-image cache", () => {
    const base = "https://project.supabase.co/storage/v1/object/public/media/";
    const candidates = [
      "user-123/upload-a.png",
      "user-123/upload-b.png",
      "user-123/source-images/abc123",
      "user-123/covers/only-here.png"
    ];
    expect(selectDeletableMediaStoragePaths(candidates, [`${base}user-123/upload-b.png`, undefined], userId)).toEqual([
      "user-123/upload-a.png",
      "user-123/covers/only-here.png"
    ]);
  });
});
