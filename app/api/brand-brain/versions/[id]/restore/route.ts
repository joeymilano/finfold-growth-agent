import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseAdminClient, getCurrentUserId } from "@/lib/supabase";
import { mapBrandBrainFromRow, mapBrandBrainToRow } from "@/lib/brand-brain-persistence";
import { buildRestoredBrandBrain, parseBrandMemoryVersionSnapshot } from "@/lib/brand-memory-versions";
import { apiError } from "@/lib/i18n";

const idSchema = z.string().uuid();
const restoreSchema = z.object({
  expectedLatestVersionId: z.string().uuid().nullable().optional()
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await getCurrentUserId();
    const { id: rawId } = await params;
    const id = idSchema.parse(rawId);
    const { expectedLatestVersionId } = restoreSchema.parse(await request.json().catch(() => ({})));
    const admin = createSupabaseAdminClient();
    if (!admin) {
      return NextResponse.json(
        { error: apiError(request.headers, "版本历史暂时不可用，请稍后再试", "Brand Memory history is temporarily unavailable.") },
        { status: 503 }
      );
    }

    if (expectedLatestVersionId) {
      const { data: latest, error: latestError } = await admin
        .from("brand_memory_versions")
        .select("id")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (latestError) throw latestError;
      if (latest?.id !== expectedLatestVersionId) {
        return NextResponse.json(
          {
            error: apiError(
              request.headers,
              "品牌记忆在你打开历史后又有更新，已刷新版本列表，请确认后再恢复",
              "Brand Memory changed after this history view was loaded. History has been refreshed — check it before restoring."
            ),
            code: "conflict"
          },
          { status: 409 }
        );
      }
    }

    const { data: version, error: versionError } = await admin
      .from("brand_memory_versions")
      .select("snapshot")
      .eq("id", id)
      .eq("user_id", userId)
      .maybeSingle();
    if (versionError) throw versionError;
    if (!version) {
      return NextResponse.json({ error: apiError(request.headers, "没有找到这个版本", "Memory version not found.") }, { status: 404 });
    }

    const { data: currentRow, error: currentError } = await admin
      .from("brand_brains")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();
    if (currentError) throw currentError;

    const brain = buildRestoredBrandBrain(parseBrandMemoryVersionSnapshot(version.snapshot), mapBrandBrainFromRow(currentRow));
    const { data, error } = await admin
      .from("brand_brains")
      .upsert(
        { user_id: userId, ...mapBrandBrainToRow(brain), updated_at: new Date().toISOString() },
        { onConflict: "user_id" }
      )
      .select("*")
      .maybeSingle();
    if (error) throw error;
    return NextResponse.json({
      restored: true,
      brain: parseBrandMemoryVersionSnapshot(data),
      updatedAt: (data as { updated_at?: string | null } | null)?.updated_at ?? null
    });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: apiError(request.headers, "请登录后再恢复版本", "Please log in to restore Brand Memory.") }, { status: 401 });
    }
    console.error("[brand-brain/restore] failed:", error);
    return NextResponse.json(
      { error: apiError(request.headers, "没能恢复这个版本，请稍后再试", "Unable to restore this Brand Memory version.") },
      { status: 400 }
    );
  }
}