import type { Metadata } from "next";
import Link from "next/link";
import { FishLogo } from "@/components/app-shell/FishLogo";

export const metadata: Metadata = {
  title: "产品演示 — Finfold",
  description:
    "Finfold：开源 AI 内容增长运营 Agent —— 2026 上海开源软件应用创新大赛演示视频.",
  robots: { index: false, follow: false }
};

export default function Os2026DemoPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-10 border-b border-hairline bg-surface/80 backdrop-blur">
        <div className="mx-auto flex w-full max-w-3xl items-center justify-between px-5 py-4">
          <Link href="/" className="focus-ring flex items-center gap-2 rounded-md">
            <FishLogo variant="app-icon" className="h-6 w-6 rounded-[22%] object-cover" />
            <span className="text-sm font-bold text-fg">Finfold</span>
          </Link>
          <span className="text-xs font-semibold uppercase tracking-[0.18em] text-fg-muted">
            Product demo
          </span>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-5 py-12 sm:py-16">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand">
          Finfold · 2026 上海开源软件应用创新大赛
        </p>
        <h1 className="mt-3 text-3xl font-bold tracking-tight text-fg sm:text-4xl">
          开源 AI 内容增长运营 Agent · 产品演示
        </h1>
        <p className="mt-4 max-w-2xl text-sm leading-relaxed text-fg-muted sm:text-base">
          从内容洞察、策略生成到创作与发布，了解 Finfold 的完整工作流程。
        </p>

        <video
          className="mt-8 w-full rounded-2xl border border-hairline bg-black"
          controls
          playsInline
          preload="metadata"
        >
          <source src="/media/os2026-demo.mp4" type="video/mp4" />
          当前浏览器不支持视频播放，请使用下方链接下载观看。
        </video>

        <p className="mt-4 text-sm text-fg-muted">
          如在线播放不畅，可
          <a
            href="/media/os2026-demo.mp4"
            download="Finfold-2026上海开源大赛-产品演示.mp4"
            className="focus-ring rounded font-semibold text-brand underline underline-offset-4"
          >
            下载演示视频
          </a>
          后观看。
        </p>

        <p className="mt-6 text-sm text-fg-muted">
          开源仓库：
          <a
            href="https://github.com/joeymilano/Finfold"
            target="_blank"
            rel="noreferrer"
            className="focus-ring rounded font-semibold text-brand underline underline-offset-4"
          >
            github.com/joeymilano/Finfold
          </a>
        </p>
      </main>
    </div>
  );
}
