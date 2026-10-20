// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ReplyPanel } from "./ReplyPanel";
import { App } from "./App";
import { EMPTY_REPLY } from "./reply";

const api = vi.hoisted(() => ({ getSessionInfo: vi.fn(), hasLocalSession: vi.fn(), authenticatedRequest: vi.fn(), signIn: vi.fn(), signOut: vi.fn(), locateReplyControls: vi.fn(), reportReplyOutcome: vi.fn(), scoreDiscoveryPosts: vi.fn() }));
vi.mock("./api", () => ({ ...api, anonymousGenerate: vi.fn(), authenticatedGenerate: vi.fn(), claimAnonymousResult: vi.fn() }));
vi.mock("./i18n", () => ({ isChinese: false, useUiLocale: () => "en", uiLocale: "en", t: { loading: "Loading" } }));
let root: Root;
let element: HTMLDivElement;
let store: Record<string, unknown>;
const writeText = vi.fn();
const sendMessage = vi.fn();
const permissionsRequest = vi.fn();
type PanelMessageListener = (message: unknown, sender: unknown, sendResponse: (response?: unknown) => void) => boolean | undefined;
const messageListeners = new Set<PanelMessageListener>();
const activatedListeners = new Set<() => void>();
const updatedListeners = new Set<(tabId: number, changeInfo: chrome.tabs.TabChangeInfo) => void>();

const chromeStub = () => ({
  runtime: {
    sendMessage,
    onMessage: {
      addListener: (listener: PanelMessageListener) => { messageListeners.add(listener); },
      removeListener: (listener: PanelMessageListener) => { messageListeners.delete(listener); }
    }
  },
  permissions: { request: permissionsRequest },
  tabs: {
    onActivated: {
      addListener: (listener: () => void) => { activatedListeners.add(listener); },
      removeListener: (listener: () => void) => { activatedListeners.delete(listener); }
    },
    onUpdated: {
      addListener: (listener: (tabId: number, changeInfo: chrome.tabs.TabChangeInfo) => void) => { updatedListeners.add(listener); },
      removeListener: (listener: (tabId: number, changeInfo: chrome.tabs.TabChangeInfo) => void) => { updatedListeners.delete(listener); }
    }
  },
  storage: {
    session: {
      get: async () => ({ ...store }),
      set: async (value: Record<string, unknown>) => { Object.assign(store, value); },
      remove: async (key: string) => { delete store[key]; }
    },
    local: {
      get: async () => ({}),
      set: async () => undefined
    }
  }
});

beforeEach(() => {
  vi.clearAllMocks();
  messageListeners.clear();
  activatedListeners.clear();
  updatedListeners.clear();
  store = {};
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("chrome", chromeStub());
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  sendMessage.mockImplementation(async (message: { action?: string }) => {
    if (message?.action === "capture") {
      return { ok: true, platform: "xiaohongshu", postText: "Post body", selection: "", comments: [{ text: "How much is it?", author: "Amy" }] };
    }
    return undefined;
  });
  api.hasLocalSession.mockResolvedValue(true);
  api.getSessionInfo.mockResolvedValue({ authenticated: true, userId: "one", brandName: "Finfold", availableCredits: 30, replyDraftsEnabled: true });
  api.authenticatedRequest.mockResolvedValue({ result: { status: "draft", body: "A useful reply", factsToCheck: [] }, availableCredits: 27, cost: 3 });
  api.locateReplyControls.mockResolvedValue({ replyInput: { x: 0.5, y: 0.5 }, sendButton: { x: 0.9, y: 0.6 } });
  api.reportReplyOutcome.mockResolvedValue({ recorded: true });
  element = document.createElement("div"); document.body.append(element); root = createRoot(element);
});
afterEach(async () => { await act(async () => root.unmount()); element.remove(); vi.unstubAllGlobals(); });
async function render(component = ReplyPanel) { await act(async () => { root.render(createElement(component)); }); }
async function click(button: Element) { await act(async () => { (button as HTMLElement).click(); }); }
async function input(textarea: HTMLTextAreaElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(textarea, value);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
function button(text: string) { return [...element.querySelectorAll("button")].find((node) => node.textContent?.includes(text))!; }

it("auto-captures comments from the page and prefills the reply form", async () => {
  await render(App);
  expect(sendMessage).toHaveBeenCalledWith({ type: "AUTOMATION", action: "capture" });
  expect(element.textContent).toContain("Captured 1 comments");
  expect(element.querySelector<HTMLTextAreaElement>("textarea")!.value).toBe("How much is it?");
  const textareas = element.querySelectorAll("textarea");
  expect((textareas[1] as HTMLTextAreaElement).value).toBe("Post body");
});

it("accepts short comments, reviews before charging and copies only edited body", async () => {
  await render();
  await input(element.querySelector("textarea")!, "👍");
  expect(button("Generate reply").hasAttribute("disabled")).toBe(true);
  await click(element.querySelector('input[type="checkbox"]')!);
  await click(button("Generate reply"));
  expect(api.authenticatedRequest).toHaveBeenCalledTimes(1);
  const sent = JSON.parse(api.authenticatedRequest.mock.calls[0][1].body);
  expect(sent.comment).toBe("👍"); expect(sent.platform).toBe("xiaohongshu"); expect(sent.page).toBeUndefined();
  await input(element.querySelector('.reply-result textarea')!, "My edited reply");
  await click(button("Copy reply"));
  expect(writeText).toHaveBeenCalledWith("My edited reply");
  expect(element.textContent).toContain("Copied");
  expect(element.textContent).not.toContain("Sent on the platform");
});

it("sends the confirmed reply automatically after generation", async () => {
  sendMessage.mockImplementation(async (message: { action?: string }) => {
    if (message?.action === "capture") {
      return { ok: true, platform: "xiaohongshu", postText: "Post body", selection: "", comments: [{ text: "How much is it?", author: "Amy" }] };
    }
    if (message?.action === "send_dom") return { status: "sent" };
    return undefined;
  });
  await render();
  await click(element.querySelector('input[type="checkbox"]')!);
  await click(button("Generate reply"));
  await click(button("Confirm & send"));
  const sendCall = sendMessage.mock.calls.map((call) => call[0]).find((message) => message?.action === "send_dom");
  expect(sendCall?.commentText).toBe("How much is it?");
  expect(sendCall?.replyText).toBe("A useful reply");
  expect(element.textContent).toContain("✓ Sent on the platform");
  expect(writeText).not.toHaveBeenCalled();
  expect(api.reportReplyOutcome).toHaveBeenCalledWith(expect.objectContaining({ platform: "xiaohongshu", outcome: "sent" }));
});

it("falls back to vision locate and then copy when DOM send fails", async () => {
  sendMessage.mockImplementation(async (message: { action?: string }) => {
    if (message?.action === "capture") {
      return { ok: true, platform: "xiaohongshu", postText: "Post body", selection: "", comments: [{ text: "How much is it?", author: "Amy" }] };
    }
    if (message?.action === "send_dom") return { status: "needs_vision" };
    if (message?.action === "screenshot") return { ok: true, dataUrl: "data:image/jpeg;base64,AAAA" };
    if (message?.action === "vision_send") return { status: "failed", code: "NO_EDITABLE_AT_POINT" };
    return undefined;
  });
  await render();
  await click(element.querySelector('input[type="checkbox"]')!);
  await click(button("Generate reply"));
  await click(button("Confirm & send"));
  expect(api.locateReplyControls).toHaveBeenCalledTimes(1);
  const visionCall = sendMessage.mock.calls.map((call) => call[0]).find((message) => message?.action === "vision_send");
  expect(visionCall?.inputPoint).toEqual({ x: 0.5, y: 0.5 });
  expect(visionCall?.sendPoint).toEqual({ x: 0.9, y: 0.6 });
  expect(writeText).toHaveBeenCalledWith("A useful reply");
  expect(element.textContent).toContain("the reply was copied");
});

it("skips the vision fallback when the user switched it off", async () => {
  sendMessage.mockImplementation(async (message: { action?: string }) => {
    if (message?.action === "capture") {
      return { ok: true, platform: "xiaohongshu", postText: "Post body", selection: "", comments: [{ text: "How much is it?", author: "Amy" }] };
    }
    if (message?.action === "send_dom") return { status: "needs_vision" };
    return undefined;
  });
  await render();
  const checkboxes = element.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
  await click(checkboxes[1]);
  await click(checkboxes[0]);
  await click(button("Generate reply"));
  await click(button("Confirm & send"));
  expect(api.locateReplyControls).not.toHaveBeenCalled();
  expect(element.textContent).toContain("the reply was copied");
});

it("keeps manual paste working when auto-capture is unavailable", async () => {
  sendMessage.mockImplementation(async (message: { action?: string }) =>
    message?.action === "capture" ? { ok: false, code: "NOT_REPLY_PLATFORM" } : undefined);
  await render();
  expect(element.textContent).toContain("Auto-capture works on Xiaohongshu, LinkedIn, or an X post page");
  await input(element.querySelector("textarea")!, "👍");
  await click(element.querySelector('input[type="checkbox"]')!);
  await click(button("Generate reply"));
  const sent = JSON.parse(api.authenticatedRequest.mock.calls[0][1].body);
  expect(sent.comment).toBe("👍");
});

it("re-captures automatically after the user switches to a reply platform tab", async () => {
  vi.useFakeTimers();
  try {
    sendMessage.mockImplementation(async (message: { action?: string }) =>
      message?.action === "capture" ? { ok: false, code: "NOT_REPLY_PLATFORM" } : undefined);
    await render();
    expect(element.textContent).toContain("Auto-capture works on Xiaohongshu, LinkedIn, or an X post page");
    sendMessage.mockImplementation(async (message: { action?: string }) =>
      message?.action === "capture"
        ? { ok: true, platform: "linkedin", postText: "Post body", selection: "", comments: [{ text: "Nice post", author: "Bob" }] }
        : undefined);
    await act(async () => { activatedListeners.forEach((listener) => listener()); });
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(element.textContent).toContain("Captured 1 comments");
    expect(element.querySelector<HTMLTextAreaElement>("textarea")!.value).toBe("Nice post");
  } finally {
    vi.useRealTimers();
  }
});

it("re-captures when a tab finishes navigating and ignores intermediate updates", async () => {
  vi.useFakeTimers();
  try {
    await render();
    const before = sendMessage.mock.calls.filter((call) => call[0]?.action === "capture").length;
    await act(async () => { updatedListeners.forEach((listener) => listener(7, { status: "loading" })); });
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    expect(sendMessage.mock.calls.filter((call) => call[0]?.action === "capture")).toHaveLength(before);
    await act(async () => { updatedListeners.forEach((listener) => listener(7, { status: "complete" })); });
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    expect(sendMessage.mock.calls.filter((call) => call[0]?.action === "capture")).toHaveLength(before + 1);
  } finally {
    vi.useRealTimers();
  }
});

it("shows the re-capture button on non-reply pages so navigation can recover", async () => {
  sendMessage.mockImplementation(async (message: { action?: string }) =>
    message?.action === "capture" ? { ok: false, code: "NOT_REPLY_PLATFORM" } : undefined);
  await render();
  expect(button("Re-capture")).toBeDefined();
});

it("grants pilot site access with one click and retries the capture", async () => {
  sendMessage.mockImplementation(async (message: { action?: string }) =>
    message?.action === "capture" ? { ok: false, code: "PERMISSION_DENIED" } : undefined);
  await render();
  expect(element.textContent).toContain("Could not read the page");
  expect(button("Always allow")).toBeDefined();
  sendMessage.mockImplementation(async (message: { action?: string }) =>
    message?.action === "capture"
      ? { ok: true, platform: "linkedin", postText: "Post body", selection: "", comments: [{ text: "Nice post", author: "Bob" }] }
      : undefined);
  permissionsRequest.mockResolvedValue(true);
  await click(button("Always allow"));
  expect(permissionsRequest).toHaveBeenCalledWith({ origins: [
    "https://xiaohongshu.com/*", "https://*.xiaohongshu.com/*", "https://linkedin.com/*", "https://*.linkedin.com/*",
    "https://x.com/*", "https://*.x.com/*", "https://twitter.com/*", "https://*.twitter.com/*"
  ]});
  expect(element.textContent).toContain("Captured 1 comments");
});

it("leaves the denied state untouched when the grant dialog is dismissed", async () => {
  sendMessage.mockImplementation(async (message: { action?: string }) =>
    message?.action === "capture" ? { ok: false, code: "PERMISSION_DENIED" } : undefined);
  await render();
  permissionsRequest.mockResolvedValue(false);
  await click(button("Always allow"));
  expect(sendMessage).toHaveBeenCalledTimes(1);
  expect(element.textContent).toContain("Could not read the page");
});

it("autopilot drafts and sends new comments without per-reply confirmation", async () => {
  vi.useFakeTimers();
  try {
    sendMessage.mockImplementation(async (message: { action?: string }) => {
      if (message?.action === "capture") {
        return { ok: true, platform: "linkedin", postText: "Post body", selection: "", comments: [{ text: "Nice post", author: "Bob" }] };
      }
      if (message?.action === "send_dom") return { status: "sent" };
      return undefined;
    });
    await render();
    await click(element.querySelector('button[role="switch"]')!);
    await act(async () => { await vi.advanceTimersByTimeAsync(4_000); });
    expect(api.authenticatedRequest).toHaveBeenCalledTimes(1);
    const sent = JSON.parse(api.authenticatedRequest.mock.calls[0][1].body);
    expect(sent.comment).toBe("Nice post");
    expect(sent.platform).toBe("linkedin");
    const domCall = sendMessage.mock.calls.map((call) => call[0]).find((message) => message?.action === "send_dom");
    expect(domCall?.replyText).toBe("A useful reply");
    expect(api.reportReplyOutcome).toHaveBeenCalledWith(expect.objectContaining({ platform: "linkedin", outcome: "sent" }));
    expect(element.textContent).toContain("1/30 handled today");
    expect(element.textContent).toContain("✓ Sent");
    // Re-capturing the same comment never generates twice.
    await act(async () => { updatedListeners.forEach((listener) => listener(7, { status: "complete" })); });
    await act(async () => { await vi.advanceTimersByTimeAsync(3_000); });
    expect(api.authenticatedRequest).toHaveBeenCalledTimes(1);
  } finally {
    vi.useRealTimers();
  }
});

it("autopilot never auto-sends needs-context drafts and logs them", async () => {
  vi.useFakeTimers();
  try {
    api.authenticatedRequest.mockResolvedValue({ result: { status: "needs_context", body: "", factsToCheck: ["What is the price?"] }, availableCredits: 27 });
    sendMessage.mockImplementation(async (message: { action?: string }) =>
      message?.action === "capture"
        ? { ok: true, platform: "xiaohongshu", postText: "Post body", selection: "", comments: [{ text: "How much is it?", author: "Amy" }] }
        : undefined);
    await render();
    await click(element.querySelector('button[role="switch"]')!);
    await act(async () => { await vi.advanceTimersByTimeAsync(4_000); });
    expect(api.authenticatedRequest).toHaveBeenCalledTimes(1);
    expect(sendMessage.mock.calls.map((call) => call[0]).find((message) => message?.action === "send_dom")).toBeUndefined();
    expect(api.reportReplyOutcome).not.toHaveBeenCalled();
    expect(element.textContent).toContain("Needs context");
  } finally {
    vi.useRealTimers();
  }
});

it("autopilot pauses itself after repeated generation failures", async () => {
  vi.useFakeTimers();
  try {
    api.authenticatedRequest.mockRejectedValue(new Error("GENERATION_FAILED"));
    sendMessage.mockImplementation(async (message: { action?: string }) =>
      message?.action === "capture"
        ? { ok: true, platform: "linkedin", postText: "Post body", selection: "", comments: [
          { text: "First", author: "A" }, { text: "Second", author: "B" }, { text: "Third", author: "C" }] }
        : undefined);
    await render();
    await click(element.querySelector('button[role="switch"]')!);
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    expect(api.authenticatedRequest).toHaveBeenCalledTimes(3);
    await act(async () => { await vi.advanceTimersByTimeAsync(4_000); });
    expect(api.authenticatedRequest).toHaveBeenCalledTimes(3);
    expect(element.textContent).toContain("Paused: several generations failed");
  } finally {
    vi.useRealTimers();
  }
});

it("preserves the request ID across a network error and retry", async () => {
  api.authenticatedRequest.mockRejectedValueOnce(new TypeError("Failed to fetch"));
  await render(); await input(element.querySelector("textarea")!, "Thanks");
  await click(element.querySelector('input[type="checkbox"]')!); await click(button("Generate reply"));
  await click(button("Recover request"));
  const calls = api.authenticatedRequest.mock.calls.map((call) => JSON.parse(call[1].body));
  expect(calls).toHaveLength(2); expect(calls[0].requestId).toBe(calls[1].requestId);
});

it("shows missing facts with no fake copyable reply", async () => {
  api.authenticatedRequest.mockResolvedValue({ result: { status: "needs_context", body: "", factsToCheck: ["What is the verified price?"] }, availableCredits: 27 });
  await render(); await input(element.querySelector("textarea")!, "How much?");
  await click(element.querySelector('input[type="checkbox"]')!); await click(button("Generate reply"));
  expect(element.textContent).toContain("What is the verified price?"); expect(button("Copy reply")).toBeUndefined();
});

it("restores an edited draft but disables copying after a different target is entered", async () => {
  const state = { userId: "one", input: { ...EMPTY_REPLY, comment: "Thanks" }, result: { status: "draft", body: "Original", factsToCheck: [] }, editedBody: "My edit", savedAt: Date.now() };
  store.finfoldReplyState = { ...state, resultIntent: JSON.stringify(state.input) };
  await render(); expect(element.querySelector<HTMLTextAreaElement>('.reply-result textarea')?.value).toBe("My edit");
  await input(element.querySelector("textarea")!, "How much?");
  expect(button("Copy reply").hasAttribute("disabled")).toBe(true);
});

it("does not reveal another user's stored draft", async () => {
  sendMessage.mockImplementation(async (message: { action?: string }) =>
    message?.action === "capture" ? { ok: false, code: "NOT_REPLY_PLATFORM" } : undefined);
  store.finfoldReplyState = { userId: "other", input: { ...EMPTY_REPLY, comment: "private comment" }, result: null, editedBody: "secret", savedAt: Date.now() };
  await render(); expect(element.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe("");
});

it("keeps non-pilot accounts out of paid reply generation", async () => {
  api.getSessionInfo.mockResolvedValue({ authenticated: true, userId: "one", availableCredits: 30, replyDraftsEnabled: false });
  await render(); expect(button("Generate reply")).toBeUndefined(); expect(api.authenticatedRequest).not.toHaveBeenCalled();
});

it("clears the previous identity's inputs when the account changes before generation", async () => {
  await render(); await input(element.querySelector("textarea")!, "Private comment");
  await click(element.querySelector('input[type="checkbox"]')!);
  api.getSessionInfo.mockResolvedValue({ authenticated: true, userId: "two", brandName: "Other brand", availableCredits: 30, replyDraftsEnabled: true });
  await click(button("Generate reply"));
  expect(api.authenticatedRequest).not.toHaveBeenCalled();
  expect(element.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe("");
  expect(element.textContent).toContain("Your reply identity changed");
});

it("requires a fresh review if the saved brand changes before charging", async () => {
  await render(); await input(element.querySelector("textarea")!, "Thanks");
  await click(element.querySelector('input[type="checkbox"]')!);
  api.getSessionInfo.mockResolvedValue({ authenticated: true, userId: "one", brandName: "New brand", availableCredits: 30, replyDraftsEnabled: true });
  await click(button("Generate reply"));
  expect(api.authenticatedRequest).not.toHaveBeenCalled();
  expect(element.textContent).toContain("New brand");
  expect(element.querySelector<HTMLInputElement>('input[type="checkbox"]')?.checked).toBe(false);
});

// ---- Browse discovery ----
const candidate = { id: "/somebody/status/123", author: "somebody", text: "Any tool for scheduling client calls without email ping-pong?", postedAt: new Date().toISOString(), replyCount: 3 };

it("arms the in-page observer when the discovery switch is toggled on", async () => {
  sendMessage.mockImplementation(async (message: { type?: string }) =>
    message?.type === "DISCOVERY" ? { ok: true, installed: true } : undefined);
  await render();
  await click(element.querySelector('[aria-label="Browse discovery switch"]')!);
  const install = sendMessage.mock.calls.find((call) => (call[0] as { type?: string })?.type === "DISCOVERY");
  expect((install?.[0] as { action?: string })?.action).toBe("install");
  expect(element.textContent).toContain("scored today");
});

it("scores candidate batches through the free endpoint and reports the tier counts", async () => {
  sendMessage.mockImplementation(async (message: { type?: string }) =>
    message?.type === "DISCOVERY" ? { ok: true, installed: true } : undefined);
  await render();
  await click(element.querySelector('[aria-label="Browse discovery switch"]')!);
  api.scoreDiscoveryPosts.mockResolvedValue({ scores: [
    { id: candidate.id, tier: "high", audienceType: "potential_customer", worthReplying: 0.9 },
    { id: "/other/status/9", tier: "low", audienceType: "noise", worthReplying: 0.1 }
  ], scoringAvailable: true });
  let response: { ok?: boolean; scores?: unknown[] } | undefined;
  for (const listener of messageListeners) {
    listener({ type: "DISCOVERY_CANDIDATES", posts: [candidate] }, {}, (value: unknown) => { response = value as { ok?: boolean; scores?: unknown[] }; });
  }
  await act(async () => { await Promise.resolve(); });
  await act(async () => { await Promise.resolve(); });
  expect(api.scoreDiscoveryPosts).toHaveBeenCalledOnce();
  expect(response?.ok).toBe(true);
  expect(response?.scores).toHaveLength(2);
  expect(element.textContent).toContain("worth a reply");
});

it("loads an in-page badge draft into the form as a discover target", async () => {
  await render();
  for (const listener of messageListeners) {
    listener({ type: "DISCOVERY_DRAFT", post: candidate }, {}, () => undefined);
  }
  await act(async () => { await Promise.resolve(); });
  expect(element.textContent).toContain("Discovery reply to @somebody");
  expect(element.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe(candidate.text);
});

it("never scores discovery candidates while the reply pilot gate is off", async () => {
  api.getSessionInfo.mockResolvedValue({ authenticated: true, userId: "one", availableCredits: 30, replyDraftsEnabled: false });
  await render();
  let response: { ok?: boolean } | undefined;
  for (const listener of messageListeners) {
    listener({ type: "DISCOVERY_CANDIDATES", posts: [candidate] }, {}, (value: unknown) => { response = value as { ok?: boolean }; });
  }
  await act(async () => { await Promise.resolve(); });
  await act(async () => { await Promise.resolve(); });
  expect(response?.ok).toBe(false);
  expect(api.scoreDiscoveryPosts).not.toHaveBeenCalled();
});

it("offers both draft variants and swaps the editor text", async () => {
  api.authenticatedRequest.mockResolvedValue({ result: { status: "draft", body: "safe take", altBody: "bold take", factsToCheck: [] }, availableCredits: 27, cost: 3 });
  await render(); await input(element.querySelector("textarea")!, "How much?");
  await click(element.querySelector('input[type="checkbox"]')!);
  await click(button("Generate reply"));
  expect(element.textContent).toContain("Safe");
  expect(element.textContent).toContain("Bold");
  await click(button("Bold"));
  expect([...element.querySelectorAll("textarea")].some((node) => (node as HTMLTextAreaElement).value === "bold take")).toBe(true);
});
