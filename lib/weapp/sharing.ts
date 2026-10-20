import type { loadTopicOpportunity } from "@/lib/trends/service";

type Opportunity = NonNullable<Awaited<ReturnType<typeof loadTopicOpportunity>>>;
export function publicOpportunitySnapshot(found: Opportunity) {
  const zh = found.localizedContent?.zh;
  return {
    title: zh?.title ?? found.title,
    fact: zh?.fact ?? found.fact,
    // Personalization can affect angle/reason fields; share only event facts.
    evidence: found.evidence.map((item) => ({
      title: zh?.evidenceTitles?.[item.id] ?? item.title, url: item.url, source: item.source
    })),
    lastSeenAt: found.lastSeenAt
  };
}
