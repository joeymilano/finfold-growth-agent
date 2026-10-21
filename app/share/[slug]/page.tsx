
import type { Metadata } from "next";
import { brand } from "@/lib/brand";
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { ArrowRight } from "@/components/ui/icons";
import { getPublicSharedKit } from "@/lib/kit-shares";
import { getGoal, type GoalId } from "@/lib/goals";
import { getLocalizedPlatformLabel } from "@/lib/platforms";
import { detectLocaleFromHeaders, sharePageCopy } from "@/lib/i18n";
import { PublicSiteHeader } from "@/components/marketing/PublicSiteHeader";
import { SharedKitBoard } from "@/components/share/SharedKitBoard";
import { TrackedCtaLink } from "@/components/marketing/TrackedCtaLink";

type PageParams = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: PageParams): Promise<Metadata> {
  const { slug } = await params;
  const kit = await getPublicSharedKit(slug);

  if (!kit) {
    return {
      title: `${brand.name} — Shared Kit`,
      robots: { index: false, follow: false }
    };
  }

  const locale = detectLocaleFromHeaders(await headers());
  const title = `${kit.ideaText.slice(0, 60)}${kit.ideaText.length > 60 ? "…" : ""} — ${brand.name}`;
  const description = locale === "zh"
    ? `用 ${brand.name} 生成的平台原生内容包，覆盖 ${kit.outputs.length} 个平台。`
    : `A platform-native content kit generated with ${brand.name}, covering ${kit.outputs.length} platforms.`;

  const firstImage = kit.outputs.find((output) => output.imageUrl)?.imageUrl;
  const socialImage = firstImage
    ? { url: firstImage }
    : brand.socialImage;

  return {
    title,
    description,
    robots: { index: false, follow: false },
    openGraph: {
      title,
      description,
      type: "article",
      images: [socialImage]
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [socialImage.url]
    }
  };
}

export default async function SharedKitPage({ params }: PageParams) {
  const { slug } = await params;
  const locale = detectLocaleFromHeaders(await headers());
  const copy = sharePageCopy[locale];
  const kit = await getPublicSharedKit(slug);

  if (!kit) {
    notFound();
  }

  const goal = getGoal(kit.goal as GoalId);
  const platformLabels = kit.outputs.map((output) => getLocalizedPlatformLabel(output.platform, locale)).join(" · ");

  return (
    <main data-workspace-theme data-workspace-canvas className="workspace-public min-h-screen bg-bg">
      <PublicSiteHeader locale={locale} sticky hideLocaleToggle />

      <div className="mx-auto max-w-4xl px-5 pb-16">
        <div className="panel p-5 sm:p-6">
          <p className="text-xs font-semibold uppercase tracking-wide text-fg-muted">{locale === "en" ? goal.labelEn : goal.label}</p>
          <h1 className="mt-2 text-xl font-semibold leading-snug text-fg sm:text-2xl">{kit.ideaText}</h1>
          <p className="mt-3 text-xs text-fg-muted">
            {copy.nPlatforms(kit.outputs.length)} · {platformLabels}
          </p>
        </div>

        <div className="mt-6">
          <SharedKitBoard outputs={kit.outputs} />
        </div>

        <div className="panel-inset mt-8 p-6">
          <p className="text-center text-sm font-semibold text-fg">{copy.madeWith}</p>
          <p className="mx-auto mt-2 max-w-xl text-center text-xs leading-5 text-fg-muted">{copy.tryYourself}</p>
          <div className="mt-5 flex justify-center">
            <TrackedCtaLink
              href="/workbench?start=1"
              sourceType="share"
              sourceSlug={slug}
              sourceSurface="share_footer"
              ctaId="share_try_free"
              destination="workbench"
              locale={locale}
              className="btn-primary focus-ring inline-flex items-center gap-2 text-sm"
            >
              {copy.tryFree} <ArrowRight className="h-4 w-4" />
            </TrackedCtaLink>
          </div>
        </div>
      </div>
    </main>
  );
}
