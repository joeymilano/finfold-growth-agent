// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { pageDiscoveryTask } from "./discovery";
import type { DiscoveryScore } from "./types";

const sendMessage = vi.fn();

function tweetArticle(options: {
  path?: string;
  text?: string;
  ageMs?: number;
  permalink?: string;
  replies?: string;
} = {}) {
  const article = document.createElement("article");
  article.setAttribute("data-testid", "tweet");
  const text = document.createElement("div");
  text.setAttribute("data-testid", "tweetText");
  text.textContent = options.text ?? "Anyone know a good tool for scheduling client calls? Manual email ping-pong is killing my week.";
  const anchor = document.createElement("a");
  anchor.setAttribute("href", options.permalink ?? "/somebody/status/1234567890");
  const time = document.createElement("time");
  time.setAttribute("datetime", new Date(Date.now() - (options.ageMs ?? 3_600_000)).toISOString());
  anchor.append(time);
  const replyButton = document.createElement("button");
  replyButton.setAttribute("data-testid", "reply");
  replyButton.setAttribute("aria-label", options.replies ?? "12 Replies");
  replyButton.textContent = options.replies ?? "12";
  article.append(text, anchor, replyButton);
  return article;
}

const score = (id: string, tier: DiscoveryScore["tier"]): DiscoveryScore =>
  ({ id, tier, audienceType: tier === "low" ? "noise" : "potential_customer", worthReplying: tier === "high" ? 0.9 : 0.5 });

beforeEach(() => {
  vi.stubGlobal("chrome", { runtime: { sendMessage } });
  sendMessage.mockReset();
});
afterEach(async () => {
  vi.unstubAllGlobals();
  // jsdom's window is shared across tests in this file; a leftover observer
  // from a previous test would swallow the next install as "already there".
  await pageDiscoveryTask({ op: "remove" }, { host: "x.com", path: "/home" });
  document.body.innerHTML = "";
  vi.useRealTimers();
});

it("refuses to install outside X", async () => {
  expect(await pageDiscoveryTask({ op: "install", locale: "en" }, { host: "linkedin.com", path: "/feed" }))
    .toEqual({ ok: false, code: "NOT_DISCOVERY_PAGE" });
});

it("collects a fresh post, ships it to the panel and renders a high badge", async () => {
  vi.useFakeTimers();
  sendMessage.mockResolvedValue({ ok: true, scores: [score("/somebody/status/1234567890", "high")] });
  document.body.append(tweetArticle());
  const result = await pageDiscoveryTask({ op: "install", locale: "zh" }, { host: "x.com", path: "/home" });
  expect(result).toEqual({ ok: true, installed: true });
  await vi.advanceTimersByTimeAsync(5_000);
  const message = sendMessage.mock.calls[0]?.[0] as { type?: string; posts?: { id: string }[] };
  expect(message?.type).toBe("DISCOVERY_CANDIDATES");
  expect(message?.posts?.[0]?.id).toBe("/somebody/status/1234567890");
  const badge = document.querySelector(".finfold-disc");
  expect(badge).not.toBeNull();
  expect(badge?.className).not.toContain("med");
  expect(badge?.textContent).toContain("值得回复");
  expect(badge?.textContent).toContain("起草");
  await pageDiscoveryTask({ op: "remove" }, { host: "x.com", path: "/home" });
  expect(document.querySelector(".finfold-disc")).toBeNull();
  expect(document.getElementById("finfold-discovery-style")).toBeNull();
});

it("drops posts older than 72 hours and dead old posts without scoring them", async () => {
  vi.useFakeTimers();
  sendMessage.mockResolvedValue({ ok: true, scores: [] });
  document.body.append(
    tweetArticle({ permalink: "/old/status/1", ageMs: 73 * 3_600_000 }),
    tweetArticle({ permalink: "/dead/status/2", ageMs: 30 * 3_600_000, replies: "0" })
  );
  await pageDiscoveryTask({ op: "install", locale: "en" }, { host: "x.com", path: "/home" });
  await vi.advanceTimersByTimeAsync(6_000);
  expect(sendMessage).not.toHaveBeenCalled();
});

it("skips tweet detail pages, which belong to the reply assistant", async () => {
  vi.useFakeTimers();
  document.body.append(tweetArticle());
  await pageDiscoveryTask({ op: "install", locale: "en" }, { host: "x.com", path: "/somebody/status/1234567890" });
  await vi.advanceTimersByTimeAsync(6_000);
  expect(sendMessage).not.toHaveBeenCalled();
});

it("uninstalls itself when no panel context answers", async () => {
  vi.useFakeTimers();
  sendMessage.mockResolvedValue(undefined);
  document.body.append(tweetArticle());
  await pageDiscoveryTask({ op: "install", locale: "en" }, { host: "x.com", path: "/home" });
  await vi.advanceTimersByTimeAsync(5_000);
  expect(document.getElementById("finfold-discovery-style")).toBeNull();
});

it("renders medium badges in the muted style and no badge for low scores", async () => {
  vi.useFakeTimers();
  sendMessage.mockResolvedValue({ ok: true, scores: [
    score("/a/status/1", "medium"),
    score("/b/status/2", "low")
  ] });
  const first = tweetArticle({ permalink: "/a/status/1" });
  const second = tweetArticle({ permalink: "/b/status/2", text: "A completely different post about scheduling tools for client work." });
  document.body.append(first, second);
  await pageDiscoveryTask({ op: "install", locale: "en" }, { host: "x.com", path: "/search?q=tools" });
  await vi.advanceTimersByTimeAsync(5_000);
  expect(document.querySelectorAll(".finfold-disc")).toHaveLength(1);
  expect(document.querySelector(".finfold-disc")?.className).toContain("med");
  expect(document.querySelector(".finfold-disc")?.textContent).toContain("Maybe");
});
