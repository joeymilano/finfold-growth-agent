import "@testing-library/jest-dom/vitest";
import React from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentAutomationCenter } from "@/components/app-shell/AgentAutomationCenter";
import { WorkbenchProvider } from "@/components/workbench/WorkbenchProvider";

vi.mock("@/hooks/useLocale", () => ({ useLocale: () => "zh" }));
vi.mock("@/lib/theme", () => ({ getStoredLocale: () => "zh" }));
vi.mock("@/lib/posthog", () => ({ captureEvent: vi.fn() }));
vi.mock("@/components/ui/SpeechInputButton", () => ({
  appendTranscript: (current: string, next: string) => `${current}${next}`,
  SpeechInputButton: () => null
}));
vi.mock("@/components/app-shell/OpportunityRadarPreview", () => ({ OpportunityRadarPreview: () => null }));
vi.mock("@/lib/brand-brain", async (importOriginal) => ({ ...await importOriginal<typeof import("@/lib/brand-brain")>(), getBrandBrain: () => ({}), loadPersistedBrandBrain: async () => ({ brain: {} }) }));
vi.mock("@/lib/guardrails", async (importOriginal) => ({ ...await importOriginal<typeof import("@/lib/guardrails")>(), getStoredCustomGuardrails: () => [], loadPersistedCustomGuardrails: async () => ({ rules: [] }) }));

const kit = {
  id: "91d9deae-0883-4b22-8a95-80fc382c29c9", ideaText: "产品更新", goal: "lead-gen", persona: "ai-saas",
  platforms: ["x"], mediaAssets: [], outputs: [], status: "saved", createdAt: "2026-07-17T08:00:00.000Z"
};

function stubApi({ kits = [] as unknown[], sessions = [] as unknown[], sessionsOk = true } = {}) {
  vi.stubGlobal("fetch", vi.fn(async (input: unknown) => {
    const url = String(input);
    if (url === "/api/entitlements/check") return new Response(JSON.stringify({ authenticated: true, plan: "free", canUseOutputs: true, monthlyLimit: 50, used: 0, available: 50 }));
    if (url === "/api/kits") return new Response(JSON.stringify({ kits }));
    if (url === "/api/agent/sessions") return new Response(JSON.stringify(sessionsOk ? { sessions } : { error: "down" }), { status: sessionsOk ? 200 : 503 });
    return new Response("{}");
  }));
}

function view() {
  return render(<WorkbenchProvider><AgentAutomationCenter /></WorkbenchProvider>);
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("agent empty state for a brand-new account", () => {
  it("points an account with no content and no chats to the guided first task", async () => {
    stubApi();
    view();
    const card = await screen.findByTestId("agent-first-task-card");
    expect(card).toHaveTextContent("先做第一份发布稿");
    expect(card).toHaveTextContent("贴一段产品更新，选两个平台，几分钟拿到可以直接用的两份稿子。");
    expect(screen.getByRole("link", { name: "开始" })).toHaveAttribute("href", "/workbench?start=1");
    expect(screen.getByRole("heading", { level: 1, name: "今天想做什么？" })).toBeInTheDocument();
  });

  it("stays hidden once the account has saved content", async () => {
    stubApi({ kits: [kit] });
    view();
    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/kits", { cache: "no-store" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/agent/sessions", { cache: "no-store" }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByTestId("agent-first-task-card")).not.toBeInTheDocument();
  });

  it("stays hidden when past chats exist or could not be checked", async () => {
    for (const options of [{ sessions: [{ id: "s1", title: "旧对话", updatedAt: "2026-10-01T00:00:00.000Z" }] }, { sessionsOk: false }]) {
      stubApi(options);
      const rendered = view();
      await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/kits", { cache: "no-store" }));
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(screen.queryByTestId("agent-first-task-card")).not.toBeInTheDocument();
      rendered.unmount();
      vi.unstubAllGlobals();
    }
  });

  it("does not render outside the dashboard provider", async () => {
    stubApi();
    render(<AgentAutomationCenter />);
    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/agent/sessions", { cache: "no-store" }));
    expect(screen.queryByTestId("agent-first-task-card")).not.toBeInTheDocument();
  });
});
