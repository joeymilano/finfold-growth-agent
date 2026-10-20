/**
 * Jev scoring for browse-discovery (mirrors lib/extension/reply-triage.ts).
 * One fan-out call per post judges worth_replying + audience type against the
 * user's brand context. Pure optimization with a hard fail-open contract:
 * a disabled Jev, an outage, or an unparsable answer leaves that post
 * unscored (no badge) — it never errors the batch and never blocks browsing.
 */
import { askJev, jevEnabled, type JevQuestions } from "@/lib/jev";
import { logInfo } from "@/lib/observability";
import {
  DISCOVERY_HIGH_MIN, DISCOVERY_MEDIUM_MIN,
  type DiscoveryAudienceType, type DiscoveryPost, type DiscoveryTier
} from "./discovery-contracts";

export type DiscoveryScore = {
  id: string;
  tier: DiscoveryTier;
  audienceType: DiscoveryAudienceType | null;
  worthReplying: number;
};

const AUDIENCES: ReadonlySet<string> = new Set([
  "potential_customer", "peer_builder", "discussion", "noise", "hostile", "other"
]);

export function buildDiscoveryScoreQuestions(): JevQuestions {
  return {
    worth_replying: {
      type: "noul",
      instructions: "Is this X post worth a thoughtful reply from the user described in the brand context — a question or problem their offering plausibly solves, a recommendation request, or a substantive discussion where their first-hand experience adds value? News headlines, pure venting, celebrity gossip, engagement bait, crypto/airdrop spam and posts with no opening for a useful reply are not."
    },
    audience_type: {
      type: "choice",
      instructions: "Classify the post author from the post text alone, relative to the user's brand context.",
      criteria: {
        potential_customer: "describes a pain point or need the user's offering plausibly solves, or asks for tool/product recommendations",
        peer_builder: "a fellow builder or creator sharing work or asking for feedback — worth exchanging experience",
        discussion: "a substantive topic discussion where the user's relevant first-hand experience adds value",
        noise: "news reposts, memes, engagement bait, off-topic chatter or spam",
        hostile: "attacking or dunking on others; engaging risks a flame war",
        other: "anything else"
      }
    }
  };
}

export function discoveryTier(worthReplying: number, audienceType: string | null): DiscoveryTier {
  const welcome = audienceType === "potential_customer" || audienceType === "peer_builder" || audienceType === "discussion";
  if (welcome && worthReplying >= DISCOVERY_HIGH_MIN) return "high";
  if (worthReplying >= DISCOVERY_MEDIUM_MIN && audienceType !== "hostile" && audienceType !== "noise") return "medium";
  return "low";
}

export async function scoreDiscoveryPosts(input: {
  userId: string;
  brandContext: string | null;
  posts: DiscoveryPost[];
}): Promise<{ scores: DiscoveryScore[]; scoringAvailable: boolean }> {
  if (!jevEnabled()) return { scores: [], scoringAvailable: false };
  const verdicts = await Promise.all(input.posts.map(async (post): Promise<DiscoveryScore | null> => {
    try {
      const result = await askJev(
        {
          brand_context: input.brandContext,
          platform: "x",
          author: post.author.slice(0, 80),
          post: post.text.slice(0, 2_000)
        },
        buildDiscoveryScoreQuestions(),
        { operation: "extension_discovery_score", userId: input.userId }
      );
      const answers = result.answers as unknown as Record<string, Record<string, unknown>>;
      const worth = answers.worth_replying;
      const audience = answers.audience_type;
      const probability = worth && typeof worth.noul === "number" && Number.isFinite(worth.noul) ? worth.noul : null;
      const choice = audience && typeof audience.choice === "string" ? audience.choice : null;
      if (probability === null) return null;
      const audienceType = (AUDIENCES.has(choice ?? "") ? choice : "other") as DiscoveryAudienceType;
      logInfo("jev_decision", { userId: input.userId }, {
        operation: "extension_discovery_score", audience_type: audienceType, worth_replying: probability, model: result.model
      });
      return { id: post.id, tier: discoveryTier(probability, audienceType), audienceType, worthReplying: probability };
    } catch {
      return null;
    }
  }));
  return { scores: verdicts.filter((verdict): verdict is DiscoveryScore => verdict !== null), scoringAvailable: true };
}
