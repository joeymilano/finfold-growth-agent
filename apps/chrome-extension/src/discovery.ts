import type { DiscoveryCandidate, DiscoveryScore, DiscoveryTask } from "./types";

/**
 * Runs INSIDE the active x.com tab through chrome.scripting.executeScript,
 * same self-containment rule as automation.ts: executeScript serializes `func`
 * with Function.prototype.toString, so every helper and every user-facing
 * string lives inside this function tree. Type-only imports are erased.
 *
 * Browse-discovery (the ReplyWink-inspired pass): while the user scrolls an
 * X timeline/search/profile surface, a throttled MutationObserver harvests
 * text posts, applies local gates (age, dead-post, dedupe — zero AI cost)
 * and ships survivors to the side panel in batches. The panel answers with
 * server scores; high/medium verdicts render an inline badge with a short
 * reason and a "draft" button that hands the post to the panel's reply form.
 * Everything stops the moment the panel stops answering — same lifecycle
 * contract as Autopilot.
 */
export async function pageDiscoveryTask(
  task: DiscoveryTask,
  env?: { host?: string; path?: string }
): Promise<{ ok: true; installed: boolean } | { ok: false; code: "NOT_DISCOVERY_PAGE" }> {
  const host = (env?.host ?? location.hostname).toLowerCase();
  const onX = host === "x.com" || host.endsWith(".x.com") || host === "twitter.com" || host.endsWith(".twitter.com");
  if (!onX) return { ok: false, code: "NOT_DISCOVERY_PAGE" };
  // Timeline-like surfaces only: tweet detail pages are the reply assistant's
  // own-post territory, and DM/notifications are not a place to pitch in.
  const surface = (path: string) =>
    path === "/" || path === "/home" || path.startsWith("/search") || path.startsWith("/explore")
    || path.startsWith("/i/lists")
    || /^\/[A-Za-z0-9_]{1,20}\/?(with_replies|media)?\/?$/.test(path);
  const MAX_AGE_MS = 72 * 60 * 60 * 1_000;
  const MAX_QUEUED = 6;
  const FLUSH_DELAY_MS = 5_000;
  const BATCH_SIZE = 6;

  type DiscoveryState = {
    locale: "zh" | "en";
    observer: MutationObserver | null;
    scanTimer: number;
    flushTimer: number;
    queue: DiscoveryCandidate[];
    queued: Set<string>;
    scored: Set<string>;
    candidates: Map<string, DiscoveryCandidate>;
    inFlight: boolean;
    uninstalled: boolean;
    uninstall: () => void;
  };
  const globalWindow = window as unknown as { __finfoldDiscovery?: DiscoveryState };
  const existing = globalWindow.__finfoldDiscovery;
  if (task.op === "remove") {
    existing?.uninstall();
    return { ok: true, installed: false };
  }
  if (existing && !existing.uninstalled) return { ok: true, installed: true };

  const normalize = (value: string) => value.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
  const parseCount = (raw: string): number => {
    const match = /([\d.]+)\s*([KMkm])?/.exec(raw.replace(/,/g, ""));
    if (!match) return 0;
    const value = Number.parseFloat(match[1]);
    if (!Number.isFinite(value)) return 0;
    if (/k/i.test(match[2] ?? "")) return Math.round(value * 1_000);
    if (/m/i.test(match[2] ?? "")) return Math.round(value * 1_000_000);
    return Math.round(value);
  };

  const tierLabel = (tier: DiscoveryScore["tier"]) => (state.locale === "zh"
    ? (tier === "high" ? "值得回复" : "可以看看")
    : (tier === "high" ? "Worth a reply" : "Maybe"));
  const reasonFor = (tier: DiscoveryScore["tier"], audience: string) => {
    const zh = tier === "high"
      ? {
        potential_customer: "像是在找你产品能解决的问题",
        peer_builder: "同行的实践分享，值得交流",
        discussion: "这个话题你有相关经验可补充",
        default: "这条帖子值得一条有内容的回复"
      }
      : {
        potential_customer: "可能有需求信号，可以看看",
        peer_builder: "可能值得交流",
        discussion: "话题相关，可以补充视角",
        default: "可以看看"
      };
    const en = tier === "high"
      ? {
        potential_customer: "Looks like a problem your product could solve",
        peer_builder: "A fellow builder sharing work — worth exchanging notes",
        discussion: "A topic where your experience adds value",
        default: "Worth a thoughtful reply"
      }
      : {
        potential_customer: "Possible demand signal",
        peer_builder: "Might be worth exchanging notes",
        discussion: "Related topic; you could add a viewpoint",
        default: "Maybe worth a look"
      };
    const table = state.locale === "zh" ? zh : en;
    return (table as Record<string, string>)[audience] ?? (table as Record<string, string>).default;
  };

  const permalinkOf = (article: Element) => {
    const time = article.querySelector("time");
    const href = time?.closest("a")?.getAttribute("href") ?? "";
    return /^\/[A-Za-z0-9_]{1,20}\/status\/\d+/.exec(href)?.[0] ?? null;
  };
  const findArticle = (id: string) =>
    Array.from(document.querySelectorAll("article[data-testid='tweet']")).find((article) => permalinkOf(article) === id) ?? null;

  const renderBadge = (article: Element, id: string, score: DiscoveryScore) => {
    if (article.querySelector(":scope > .finfold-disc")) return;
    const candidate = state.candidates.get(id);
    if (!candidate) return;
    const badge = document.createElement("div");
    const high = score.tier === "high";
    badge.className = `finfold-disc${high ? "" : " med"}`;
    badge.setAttribute("data-finfold-id", id);
    const chip = document.createElement("strong");
    chip.className = "fd-chip";
    chip.textContent = `◆ ${tierLabel(score.tier)}`;
    const why = document.createElement("span");
    why.className = "fd-why";
    why.textContent = reasonFor(score.tier, score.audienceType);
    const draft = document.createElement("button");
    draft.type = "button";
    draft.textContent = state.locale === "zh" ? "起草" : "Draft";
    draft.addEventListener("click", () => {
      draft.disabled = true;
      draft.textContent = state.locale === "zh" ? "已送面板" : "In panel";
      try {
        void chrome.runtime.sendMessage({ type: "DISCOVERY_DRAFT", post: candidate }).catch(() => undefined);
      } catch { /* the panel is gone; the badge simply reports nothing */ }
    });
    badge.append(chip, why, draft);
    article.append(badge);
  };

  const pruneStaleBadges = () => {
    // X recycles timeline cells; a badge left on a recycled cell belongs to a
    // different tweet now, so drop any badge whose article no longer matches.
    document.querySelectorAll(".finfold-disc").forEach((badge) => {
      const article = badge.closest("article[data-testid='tweet']");
      if (!article || badge.getAttribute("data-finfold-id") !== permalinkOf(article)) badge.remove();
    });
  };

  const state: DiscoveryState = {
    locale: task.locale,
    observer: null,
    scanTimer: 0,
    flushTimer: 0,
    queue: [],
    queued: new Set(),
    scored: new Set(),
    candidates: new Map(),
    inFlight: false,
    uninstalled: false,
    uninstall: () => {
      state.uninstalled = true;
      state.observer?.disconnect();
      window.clearTimeout(state.scanTimer);
      window.clearTimeout(state.flushTimer);
      document.querySelectorAll(".finfold-disc").forEach((badge) => badge.remove());
      document.getElementById("finfold-discovery-style")?.remove();
      delete globalWindow.__finfoldDiscovery;
    }
  };
  globalWindow.__finfoldDiscovery = state;

  const style = document.createElement("style");
  style.id = "finfold-discovery-style";
  style.textContent = [
    ".finfold-disc{display:flex;align-items:center;gap:8px;margin:2px 0 10px;padding:6px 10px;border-radius:8px;font-size:12px;line-height:1.4;color:inherit;border:1px solid rgba(15,160,110,.4);background:rgba(15,160,110,.07);max-width:100%}",
    ".finfold-disc.med{border-color:rgba(215,150,20,.4);background:rgba(215,150,20,.06)}",
    ".finfold-disc .fd-chip{flex:none;font-weight:700;color:#0e8a62}",
    ".finfold-disc.med .fd-chip{color:#a37400}",
    ".finfold-disc .fd-why{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;opacity:.85}",
    ".finfold-disc button{flex:none;margin-left:auto;padding:3px 12px;border-radius:999px;border:1px solid currentColor;background:transparent;color:#0e8a62;font-weight:600;font-size:12px;cursor:pointer}",
    ".finfold-disc.med button{color:#a37400}",
    ".finfold-disc button:disabled{opacity:.55;cursor:default}"
  ].join("\n");
  document.head.append(style);

  const collect = () => {
    if (state.uninstalled) return;
    if (!surface(env?.path ?? location.pathname)) return;
    for (const article of Array.from(document.querySelectorAll("article[data-testid='tweet']"))) {
      const id = permalinkOf(article);
      if (!id || state.queued.has(id)) continue;
      const textHolder = article.querySelector("[data-testid='tweetText']");
      const text = normalize(textHolder?.textContent ?? "").slice(0, 400);
      if (text.length < 20) continue;
      const postedAt = article.querySelector("time")?.getAttribute("datetime") ?? "";
      const age = postedAt ? Date.now() - Date.parse(postedAt) : Number.NaN;
      if (!Number.isFinite(age) || age < 0 || age > MAX_AGE_MS) continue;
      const replyButton = article.querySelector("button[data-testid='reply']");
      const replies = replyButton
        ? parseCount(`${replyButton.getAttribute("aria-label") ?? ""} ${replyButton.textContent ?? ""}`)
        : 0;
      // A zero-reply post is fine while it is fresh; an old silent one is dead.
      if (replies === 0 && age > 24 * 60 * 60 * 1_000) continue;
      const author = /^\/([A-Za-z0-9_]{1,20})\/status\//.exec(id)?.[1] ?? "";
      const candidate: DiscoveryCandidate = { id, author, text, postedAt, replyCount: replies };
      state.queued.add(id);
      state.candidates.set(id, candidate);
      state.queue.push(candidate);
      if (state.queue.length >= MAX_QUEUED) break;
    }
    pruneStaleBadges();
    scheduleFlush();
  };

  const flush = async () => {
    state.flushTimer = 0;
    if (state.uninstalled || state.inFlight || state.queue.length === 0) return;
    state.inFlight = true;
    const batch = state.queue.splice(0, BATCH_SIZE);
    try {
      const response = await chrome.runtime.sendMessage({ type: "DISCOVERY_CANDIDATES", posts: batch }) as
        | { ok: true; scores: DiscoveryScore[] }
        | { ok: false }
        | undefined;
      // No answer means no panel context is listening: stop silently, exactly
      // like Autopilot stops when its panel closes.
      if (!response || response.ok !== true) {
        state.uninstall();
        return;
      }
      for (const score of response.scores ?? []) {
        state.scored.add(score.id);
        if (score.tier === "low") continue;
        const article = findArticle(score.id);
        if (article) renderBadge(article, score.id, score);
      }
    } catch {
      state.uninstall();
      return;
    } finally {
      state.inFlight = false;
      if (!state.uninstalled && state.queue.length > 0) scheduleFlush();
    }
  };

  function scheduleFlush() {
    if (state.uninstalled || state.flushTimer !== 0 || state.inFlight) return;
    if (state.queue.length >= BATCH_SIZE) void flush();
    else state.flushTimer = window.setTimeout(() => void flush(), FLUSH_DELAY_MS);
  }

  state.observer = new MutationObserver(() => {
    if (state.scanTimer !== 0) return;
    state.scanTimer = window.setTimeout(() => {
      state.scanTimer = 0;
      collect();
    }, 1_200);
  });
  state.observer.observe(document.body, { childList: true, subtree: true });
  collect();
  return { ok: true, installed: true };
}
