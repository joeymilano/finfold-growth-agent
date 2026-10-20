import "@testing-library/jest-dom/vitest";
import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkbenchProvider, useWorkbench } from "@/components/workbench/WorkbenchProvider";
import { addToast } from "@/components/ui/Toast";
import { consumeSSEStream } from "@/lib/sse-client";
import { REFERRAL_SHARE_PROMPT_EVENT } from "@/components/referrals/WorkbenchReferralPrompts";

vi.mock("@/components/ui/Toast", () => ({ addToast: vi.fn() }));
vi.mock("@/lib/posthog", () => ({ captureEvent: vi.fn() }));
vi.mock("@/lib/theme", () => ({ getStoredLocale: () => "zh" }));
vi.mock("@/lib/completion-sound", () => ({ playTaskCompleteSound: vi.fn() }));
vi.mock("@/lib/sse-client", () => ({ consumeSSEStream: vi.fn() }));
vi.mock("@/lib/brand-brain", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/brand-brain")>(),
  getBrandBrain: () => ({}),
  loadPersistedBrandBrain: vi.fn(async () => ({ brain: {} }))
}));
vi.mock("@/lib/guardrails", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/guardrails")>(),
  getStoredCustomGuardrails: () => [],
  loadPersistedCustomGuardrails: vi.fn(async () => ({ rules: [] }))
}));
vi.mock("@/lib/generation-run-client", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/generation-run-client")>();
  return {
    ...original,
    loadPendingGeneration: () => null,
    clearPendingGeneration: vi.fn(),
    savePendingGeneration: vi.fn()
  };
});

const entitlement = {
  authenticated: true,
  plan: "pro",
  canUseOutputs: true,
  canAnalyze: false,
  urlBootstrap: false,
  polish: false,
  iterateReport: false,
  proactiveMonitoring: false,
  trialAvailable: false,
  used: 0,
  monthlyLimit: 500,
  available: 500
};

const savedKit = {
  id: "kit-old",
  ideaText: "历史主题，用来验证画板同步。",
  goal: "lead-gen",
  persona: "ai-saas",
  platforms: ["xiaohongshu"],
  mediaAssets: [],
  outputs: [{ id: "output-old", platform: "xiaohongshu", title: "旧标题", body: "旧正文", cta: "", notes: "", strategy: "", locked: false, publishStatus: "draft", userEdited: false }],
  status: "saved",
  createdAt: "2026-08-15T00:00:00.000Z"
};

function jsonResponse(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

function run(status: string, extra: Record<string, unknown> = {}) {
  const now = new Date().toISOString();
  return {
    id: "run-1",
    requestId: "req-1",
    traceId: "trace-1",
    status,
    currentStep: "generate_outputs",
    attemptCount: 1,
    platformCount: 3,
    modelTier: null,
    creditCost: 21,
    creditsReserved: true,
    creditsRefunded: false,
    contentKitId: null,
    error: null,
    startedAt: now,
    completedAt: null,
    lastHeartbeatAt: now,
    createdAt: now,
    updatedAt: now,
    ...extra
  };
}

function stubFetch(kits: unknown[], extra: (url: string) => Response | undefined = () => undefined) {
  const fetchMock = vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    const custom = extra(url);
    if (custom) return Promise.resolve(custom);
    if (url === "/api/entitlements/check") return Promise.resolve(jsonResponse(entitlement));
    if (url === "/api/kits") return Promise.resolve(jsonResponse({ kits }));
    if (url === "/api/generate") return Promise.resolve(jsonResponse({}));
    return Promise.resolve(jsonResponse({}));
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function Probe() {
  const w = useWorkbench();
  return (
    <>
      <span>{w.canvasRestoreComplete ? "restored" : "loading"}</span>
      <span data-testid="titles">{w.outputs.map((o) => o.title).join(",") || "empty"}</span>
      <span data-testid="current-kit">{w.currentKit?.id ?? "none"}</span>
      <span data-testid="error">{w.error ?? "no-error"}</span>
      <span data-testid="loading">{w.isLoading ? "busy" : "idle"}</span>
      <button type="button" onClick={() => void w.generateKit()}>generate</button>
      <button type="button" onClick={() => w.syncSavedOutput("kit-old", "xiaohongshu", { title: "详情页新标题" })}>sync</button>
    </>
  );
}

function renderProvider() {
  return render(
    <WorkbenchProvider>
      <Probe />
    </WorkbenchProvider>
  );
}

beforeEach(() => {
  const store = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, String(value)),
      removeItem: (key: string) => void store.delete(key),
      clear: () => store.clear()
    }
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.mocked(consumeSSEStream).mockReset();
  vi.mocked(addToast).mockReset();
});

describe("Workbench provider sync and completion", () => {
  it("applies edits saved on the kit detail page to the open studio canvas", async () => {
    stubFetch([savedKit]);
    renderProvider();
    await screen.findByText("restored");
    expect(screen.getByTestId("titles")).toHaveTextContent("旧标题");

    fireEvent.click(screen.getByRole("button", { name: "sync" }));
    expect(screen.getByTestId("titles")).toHaveTextContent("详情页新标题");
  });

  it("refreshes the library once when focus and visibilitychange fire together", async () => {
    const fetchMock = stubFetch([savedKit]);
    renderProvider();
    await screen.findByText("restored");
    const listCalls = () => fetchMock.mock.calls.filter(([url]) => String(url) === "/api/kits").length;
    const before = listCalls();

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("focus"));
    });
    await waitFor(() => expect(listCalls()).toBe(before + 1));
  });

  it("restores the previous canvas when the server reports a duplicate generation", async () => {
    stubFetch([savedKit]);
    vi.mocked(consumeSSEStream).mockImplementation(async (_response, onEvent) => {
      onEvent("duplicate", { contentKitId: "kit-old", createdAt: savedKit.createdAt, persona: "ai-saas", platforms: ["xiaohongshu"] });
    });
    renderProvider();
    await screen.findByText("restored");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "generate" }));
    });

    await waitFor(() => expect(screen.getByTestId("loading")).toHaveTextContent("idle"));
    expect(screen.getByTestId("titles")).toHaveTextContent("旧标题");
    expect(screen.getByTestId("current-kit")).toHaveTextContent("kit-old");
  });

  it("does not show an error when a queued run turns out cancelled", async () => {
    stubFetch([savedKit], (url) =>
      url === "/api/generation-runs/run-1"
        ? jsonResponse({ run: run("cancelled", { error: { code: "cancelled", message: "Generation was cancelled by the user.", retryable: false } }) })
        : undefined
    );
    vi.mocked(consumeSSEStream).mockImplementation(async (_response, onEvent) => {
      onEvent("run", { run: run("queued") });
      onEvent("queued", {});
    });
    renderProvider();
    await screen.findByText("restored");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "generate" }));
    });

    await waitFor(() => expect(screen.getByTestId("loading")).toHaveTextContent("idle"));
    expect(screen.getByTestId("error")).toHaveTextContent("no-error");
  });

  it("fires first-kit and referral side-effects when a queued run completes", async () => {
    const newKit = { ...savedKit, id: "kit-new" };
    stubFetch([], (url) => {
      if (url === "/api/generation-runs/run-1") return jsonResponse({ run: run("succeeded", { contentKitId: "kit-new" }) });
      if (url === "/api/kits/kit-new") return jsonResponse({ kit: newKit });
      if (url === "/api/referrals/incoming") {
        return jsonResponse({ referral: { status: "completed", rewardCredits: 100, rewardedAt: new Date().toISOString() } });
      }
      return undefined;
    });
    vi.mocked(consumeSSEStream).mockImplementation(async (_response, onEvent) => {
      onEvent("run", { run: run("queued") });
      onEvent("queued", {});
    });
    const sharePrompt = vi.fn();
    window.addEventListener(REFERRAL_SHARE_PROMPT_EVENT, sharePrompt);
    renderProvider();
    await screen.findByText("restored");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "generate" }));
    });

    await waitFor(() => expect(sharePrompt).toHaveBeenCalledTimes(1));
    expect(vi.mocked(addToast).mock.calls.some(([, message]) => String(message).includes("邀请奖励已解锁：100"))).toBe(true);
    expect(screen.getByTestId("current-kit")).toHaveTextContent("kit-new");
    window.removeEventListener(REFERRAL_SHARE_PROMPT_EVENT, sharePrompt);
  });
});
