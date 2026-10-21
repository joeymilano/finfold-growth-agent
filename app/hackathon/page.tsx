import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Check } from "@/components/ui/icons";
import { FishLogo } from "@/components/app-shell/FishLogo";
import { HackathonTryItDemo } from "@/components/hackathon/HackathonTryItDemo";

export const metadata: Metadata = {
  title: "Hackathon demo — Finfold × NVIDIA Nemotron on Nebius",
  description:
    "Live demo for the Nebius x NVIDIA Global AI Hackathon: Finfold's growth operator running on NVIDIA Nemotron 3 Super via Nebius Token Factory.",
  robots: { index: false, follow: false }
};

const HOW = [
  "Every direct-LLM call — draft generation, brand scoring, account diagnosis — fronts NVIDIA Nemotron 3 Super (nvidia/nemotron-3-super-120b-a12b) on the Nebius Token Factory.",
  "Setting NEBIUS_API_KEY promotes Nebius to the head of the provider chain; other providers remain outage-only failover.",
  "scripts/verify-nebius.mjs proves it live: model listing, a 902ms chat round-trip with reasoning tokens, and the structured-JSON path — recorded in docs/nebius-verification.md."
];

/** Accepts a bare YouTube id or a full watch/share URL; embeds nocookie. */
function parseYouTubeId(raw: string | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(trimmed)) return trimmed;
  const match = trimmed.match(/(?:watch\?v=|youtu\.be\/|embed\/|shorts\/)([A-Za-z0-9_-]{11})/);
  return match ? match[1] : null;
}

export default async function HackathonDemoPage({
  searchParams
}: {
  searchParams: Promise<{ v?: string }>;
}) {
  const videoId = parseYouTubeId((await searchParams).v);
  return (
    <div className="flex min-h-screen flex-col bg-bg">
      <header className="sticky top-0 z-10 border-b border-hairline bg-surface/80 backdrop-blur">
        <div className="mx-auto flex w-full max-w-3xl items-center justify-between px-5 py-4">
          <Link href="/" className="focus-ring flex items-center gap-2 rounded-md">
            <FishLogo variant="app-icon" className="h-6 w-6 rounded-[22%] object-cover" />
            <span className="text-sm font-bold text-fg">Finfold</span>
          </Link>
          <span className="text-xs font-semibold uppercase tracking-[0.18em] text-fg-muted">
            Nebius × NVIDIA Hackathon
          </span>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-5 py-12 sm:py-16">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand">
          Finfold · Nebius x NVIDIA Global AI Hackathon 2026
        </p>
        <h1 className="mt-3 text-3xl font-bold tracking-tight text-fg sm:text-4xl">
          An AI growth operator, running on Nemotron
        </h1>
        <p className="mt-4 max-w-2xl text-sm leading-relaxed text-fg-muted sm:text-base">
          Finfold turns one product update into platform-native content for 14 channels — drafts, covers,
          sizes — then answers comments and records what each piece brought back. Every consequential step
          stops for human approval. This page is the hackathon demo: read how Nebius powers it, then
          put the model to work yourself, live.
        </p>

        <section className="panel mt-8 p-5 sm:p-6">
          <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-fg-muted">How Nebius + Nemotron power Finfold</h2>
          <ul className="mt-4 grid gap-3">
            {HOW.map(item => (
              <li key={item} className="flex gap-3 text-sm leading-6 text-fg-muted">
                <Check className="mt-1 h-4 w-4 shrink-0 text-action" aria-hidden />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="mt-10">
          <h2 className="text-lg font-semibold text-fg">Try the model, live</h2>
          <p className="mt-2 text-sm leading-6 text-fg-muted">
            This calls the same Nebius endpoint the product uses. One idea in, two platform-native hooks out.
          </p>
          <HackathonTryItDemo placeholder="e.g. We just shipped dark mode and 2x faster exports in our note app" />
        </section>

        <section className="panel mt-10 p-5 sm:p-6">
          <h2 className="text-sm font-semibold text-fg">Full walkthrough (≤3 min)</h2>
          {videoId ? (
            <div className="mt-4 aspect-video w-full overflow-hidden rounded-xl border border-hairline">
              <iframe
                className="h-full w-full"
                src={`https://www.youtube-nocookie.com/embed/${videoId}`}
                title="Finfold hackathon walkthrough"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
                loading="lazy"
              />
            </div>
          ) : (
            <p className="mt-2 text-xs leading-5 text-fg-muted">
              Walkthrough video — append <code className="rounded bg-surface-2 px-1.5 py-0.5">?v=YOUTUBE_ID</code> to this
              URL once uploaded.
            </p>
          )}
        </section>

        <div className="mt-10 flex flex-wrap gap-3">
          <Link href="/workbench?start=1" className="btn-primary focus-ring inline-flex min-h-11 items-center gap-2 px-5 text-sm">
            Open the workbench <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
          <a
            href="https://github.com/joeymilano/finfold-growth-agent"
            className="btn-ghost focus-ring inline-flex min-h-11 items-center gap-2 px-5 text-sm"
          >
            Source (Apache-2.0)
          </a>
          <a
            href="https://github.com/joeymilano/finfold-growth-agent/blob/main/docs/nebius-verification.md"
            className="btn-ghost focus-ring inline-flex min-h-11 items-center gap-2 px-5 text-sm"
          >
            Live verification record
          </a>
        </div>
      </main>
    </div>
  );
}
