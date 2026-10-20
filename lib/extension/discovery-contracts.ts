import { z } from "zod";

// Browse-discovery pilot (X timeline): the extension submits posts that
// survived its local gates (age, engagement, dedupe, author cooldown), the
// server scores each against the user's brand context, and tiered verdicts
// come back without any user-facing copy — the client owns localization.
// Scoring is free but rate-limited; drafting a reply still goes through
// /reply-drafts and bills 3 Credits like any other reply.

export const discoveryAudienceSchema = z.enum([
  "potential_customer", "peer_builder", "discussion", "noise", "hostile", "other"
]);

export const discoveryPostSchema = z.object({
  // Permalink path ("/handle/status/123") — the client's dedupe key.
  id: z.string().trim().min(1).max(200),
  author: z.string().trim().max(80).default(""),
  text: z.string().trim().min(1).max(2_000),
  postedAt: z.string().datetime().optional(),
  replyCount: z.number().int().min(0).max(10_000_000).optional()
}).strict();

export const discoveryScoreRequestSchema = z.object({
  posts: z.array(discoveryPostSchema).min(1).max(6)
}).strict();

export type DiscoveryPost = z.infer<typeof discoveryPostSchema>;
export type DiscoveryAudienceType = z.infer<typeof discoveryAudienceSchema>;
export type DiscoveryTier = "high" | "medium" | "low";

export const DISCOVERY_HIGH_MIN = 0.6;
export const DISCOVERY_MEDIUM_MIN = 0.4;
