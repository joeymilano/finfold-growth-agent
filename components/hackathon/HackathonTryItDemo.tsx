"use client";

import { useState } from "react";
import { ArrowRight, Loader2 } from "lucide-react";

type DemoResult = {
  x_hook: string;
  linkedin_opener: string;
  model: string;
  served_by: string;
  latency_ms: number;
  total_tokens: number | null;
};

/**
 * One-shot live demo: a product idea in, two platform-native hooks out,
 * answered by NVIDIA Nemotron on Nebius Token Factory through
 * /api/hackathon/demo. No account, no streaming — judges can feel the
 * model's latency and tone directly.
 */
export function HackathonTryItDemo({ placeholder }: { placeholder: string }) {
  const [idea, setIdea] = useState("");
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<DemoResult | null>(null);
  const [error, setError] = useState("");

  async function run() {
    if (pending || idea.trim().length < 8) return;
    setPending(true);
    setError("");
    setResult(null);
    try {
      const response = await fetch("/api/hackathon/demo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idea: idea.trim() })
      });
      const payload = await response.json();
      if (!response.ok) {
        setError(String(payload.error ?? "Demo failed. Please retry."));
      } else {
        setResult(payload as DemoResult);
      }
    } catch {
      setError("Network error. Please retry.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="panel mt-6 p-5 sm:p-6">
      <label htmlFor="hackathon-demo-idea" className="text-sm font-medium text-fg">
        Try the model live — describe a product update
      </label>
      <textarea
        id="hackathon-demo-idea"
        value={idea}
        onChange={event => setIdea(event.target.value.slice(0, 300))}
        placeholder={placeholder}
        rows={2}
        maxLength={300}
        className="mt-3 w-full resize-none rounded-xl border border-hairline bg-surface px-3.5 py-2.5 text-sm text-fg placeholder:text-fg-muted focus:border-hairline-strong focus:outline-none"
      />
      <div className="mt-3 flex items-center justify-between gap-3">
        <span className="text-xs text-fg-muted">{idea.length}/300 · 6 runs/hour · no account needed</span>
        <button
          type="button"
          onClick={() => void run()}
          disabled={pending || idea.trim().length < 8}
          className="btn-primary focus-ring inline-flex min-h-10 items-center gap-2 px-4 text-xs disabled:opacity-50"
        >
          {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
          {pending ? "Nemotron is thinking…" : "Generate with Nemotron"}
          {!pending ? <ArrowRight className="h-3.5 w-3.5" aria-hidden /> : null}
        </button>
      </div>

      {error ? (
        <p role="alert" className="mt-4 rounded-xl border border-hairline bg-surface-2 px-3.5 py-2.5 text-xs text-fg-muted">
          {error}
        </p>
      ) : null}

      {result ? (
        <div className="mt-5 grid gap-3">
          <div className="rounded-xl border border-hairline bg-surface-2 p-4">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-brand">X hook</p>
            <p className="mt-2 text-sm leading-6 text-fg">{result.x_hook}</p>
          </div>
          <div className="rounded-xl border border-hairline bg-surface-2 p-4">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-brand">LinkedIn opener</p>
            <p className="mt-2 text-sm leading-6 text-fg">{result.linkedin_opener}</p>
          </div>
          <p className="font-mono text-[10px] uppercase tracking-wider text-fg-muted">
            {result.model} · {result.served_by} · {result.latency_ms}ms
            {result.total_tokens ? ` · ${result.total_tokens} tokens` : ""}
          </p>
        </div>
      ) : null}
    </div>
  );
}
