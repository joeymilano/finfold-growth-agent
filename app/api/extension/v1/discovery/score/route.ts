import { checkRateLimit } from "@/lib/rate-limit";
import { authenticateExtensionRequest } from "@/lib/extension/auth";
import { extensionJson, extensionPreflight, hasDisallowedExtensionOrigin } from "@/lib/extension/cors";
import { extensionAuthEnabled, extensionPaidActionsEnabled } from "@/lib/extension/usage";
import { replyDraftEnabled } from "@/lib/extension/reply-contracts";
import { buildBrandContextDigest } from "@/lib/extension/reply-service";
import { discoveryScoreRequestSchema } from "@/lib/extension/discovery-contracts";
import { scoreDiscoveryPosts } from "@/lib/extension/discovery-scoring";
import { BRAND_BRAIN_COLUMNS, mapBrandBrainFromRow } from "@/lib/brand-brain-persistence";
import { createSupabaseAdminClient } from "@/lib/supabase";
import { readTextWithLimit } from "@/lib/safe-url";

const MAX_BODY_BYTES = 100_000;

export function OPTIONS(request: Request) { return extensionPreflight(request); }

export async function POST(request: Request) {
  const fail = (code: string, status: number) => extensionJson(request, { error: { code } }, { status });
  if (hasDisallowedExtensionOrigin(request)) return fail("ORIGIN_NOT_ALLOWED", 403);
  if (!extensionAuthEnabled() || !extensionPaidActionsEnabled()) return fail("FEATURE_DISABLED", 503);
  const session = await authenticateExtensionRequest(request);
  if (!session?.scope.includes("extension:generate")) return fail("UNAUTHORIZED", 401);
  if (!replyDraftEnabled(session.userId)) return fail("PILOT_NOT_AVAILABLE", 403);
  // A batch is a few kilobytes of text; anything larger is not a scroll burst.
  // Content-Length is advisory (chunked bodies omit it), so the limit is also
  // enforced while streaming the body.
  if (Number(request.headers.get("content-length")) > MAX_BODY_BYTES) return fail("BAD_REQUEST", 413);
  let rawBody: string;
  try {
    rawBody = await readTextWithLimit(new Response(request.body, { headers: request.headers }), MAX_BODY_BYTES);
  } catch { return fail("BAD_REQUEST", 413); }
  let body: unknown;
  try { body = JSON.parse(rawBody); } catch { return fail("BAD_REQUEST", 400); }
  const parsed = discoveryScoreRequestSchema.safeParse(body);
  if (!parsed.success) return fail("BAD_REQUEST", 400);
  // Scoring is free but not unmetered: a per-user hourly batch cap keeps the
  // decision-model fan-out bounded while covering any realistic scroll pace.
  if (!checkRateLimit(`ext-discovery-score:${session.userId}`, 40, 3_600_000)) return fail("RATE_LIMITED", 429);
  try {
    const db = createSupabaseAdminClient();
    if (!db) throw new Error("SERVICE_UNAVAILABLE");
    const { data: brain, error: brainError } = await db.from("brand_brains")
      .select(BRAND_BRAIN_COLUMNS).eq("user_id", session.userId).maybeSingle();
    if (brainError) throw new Error("SERVICE_UNAVAILABLE");
    const scored = await scoreDiscoveryPosts({
      userId: session.userId,
      brandContext: buildBrandContextDigest(mapBrandBrainFromRow(brain)),
      posts: parsed.data.posts
    });
    return extensionJson(request, scored);
  } catch (error) {
    const code = error instanceof Error ? error.message : "SERVICE_UNAVAILABLE";
    return fail(code === "SERVICE_UNAVAILABLE" ? code : "SERVICE_UNAVAILABLE", 503);
  }
}
