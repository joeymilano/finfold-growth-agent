import { NextResponse } from "next/server";
import { enforceApiRateLimit } from "@/lib/api-rate-limit";
import { getNebiusProvider } from "@/lib/nebius";

/**
 * Public, unauthenticated one-shot demo for the Nebius x NVIDIA hackathon
 * judges: one product idea in, two platform-native hooks out — served by
 * NVIDIA Nemotron on the Nebius Token Factory, the same provider that fronts
 * the product's generation chain. Deliberately tight budgets: per-IP hourly
 * limit, short input, capped output, no streaming, no persistence.
 *
 * Returns 503 when NEBIUS_API_KEY is absent so local/dev environments fail
 * loudly instead of silently routing the demo to some other provider.
 */

const DEMO_MODEL = "nvidia/nemotron-3-super-120b-a12b";
const MAX_TOKENS = 1000;

type DemoReply = {
  x_hook: string;
  linkedin_opener: string;
};

const replyShape = (value: unknown): DemoReply | null => {
  if (typeof value !== "object" || value === null) return null;
  const { x_hook, linkedin_opener } = value as Record<string, unknown>;
  if (typeof x_hook !== "string" || typeof linkedin_opener !== "string") return null;
  if (!x_hook.trim() || !linkedin_opener.trim()) return null;
  return { x_hook: x_hook.trim().slice(0, 280), linkedin_opener: linkedin_opener.trim().slice(0, 400) };
};

function parseReply(content: string): DemoReply | null {
  const stripped = content.replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
  const start = stripped.indexOf("{");
  const end = stripped.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    return replyShape(JSON.parse(stripped.slice(start, end + 1)));
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  const limited = enforceApiRateLimit(request, { scope: "hackathon-demo", limit: 6, windowMs: 3_600_000 });
  if (limited) return limited;

  let idea = "";
  try {
    const body = (await request.json()) as { idea?: unknown };
    idea = typeof body.idea === "string" ? body.idea.trim().slice(0, 300) : "";
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  if (idea.length < 8) {
    return NextResponse.json({ error: "Describe your product update in at least 8 characters." }, { status: 400 });
  }

  const provider = getNebiusProvider("general");
  if (!provider) {
    return NextResponse.json(
      { error: "Nebius is not configured on this deployment. Set NEBIUS_API_KEY (see README) — the demo only runs on NVIDIA Nemotron via Nebius Token Factory." },
      { status: 503 }
    );
  }

  const startedAt = Date.now();
  try {
    const response = await fetch(`${provider.apiBase}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${provider.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: DEMO_MODEL,
        messages: [
          {
            role: "system",
            content:
              "You are Finfold's growth copy engine. Reply with a single JSON object and nothing else: {\"x_hook\": string, \"linkedin_opener\": string}. x_hook: one scroll-stopping post hook for X (max 180 chars, no hashtags). linkedin_opener: a professional two-sentence post opener. Match the user's language."
          },
          { role: "user", content: `Product update to promote: ${idea}` }
        ],
        max_tokens: MAX_TOKENS
      })
    });
    if (!response.ok) {
      return NextResponse.json(
        { error: `Nebius returned HTTP ${response.status}. Please retry in a moment.` },
        { status: 502 }
      );
    }
    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: unknown }; finish_reason?: string }>;
      usage?: { total_tokens?: number };
    };
    const content = payload.choices?.[0]?.message?.content;
    const reply = typeof content === "string" ? parseReply(content) : null;
    if (!reply) {
      // The hybrid-reasoning checkpoint can spend the whole budget thinking.
      return NextResponse.json(
        { error: "Nemotron spent its budget reasoning. Please try again." },
        { status: 502 }
      );
    }
    return NextResponse.json({
      ...reply,
      model: DEMO_MODEL,
      served_by: "Nebius Token Factory",
      latency_ms: Date.now() - startedAt,
      total_tokens: payload.usage?.total_tokens ?? null
    });
  } catch {
    return NextResponse.json({ error: "Could not reach Nebius. Please retry." }, { status: 502 });
  }
}
