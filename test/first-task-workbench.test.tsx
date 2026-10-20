import "@testing-library/jest-dom/vitest";
import React from "react";
import { fireEvent, render, screen, waitFor, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkbenchProvider, useWorkbench } from "@/components/workbench/WorkbenchProvider";
import { FirstTaskWorkbench } from "@/components/workbench/FirstTaskWorkbench";
import { readFirstTaskDraft, saveFirstTaskDraft } from "@/lib/first-task";
import { computeKitCost, PLAN_CREDITS } from "@/lib/payment/types";

const m = vi.hoisted(() => ({ push: vi.fn(), capture: vi.fn(), generated: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: m.push }) }));
vi.mock("@/lib/posthog", () => ({ captureEvent: m.capture }));
vi.mock("@/lib/theme", () => ({ getStoredLocale: () => "zh" }));
vi.mock("@/components/ui/Toast", () => ({ addToast: vi.fn() }));
vi.mock("@/lib/brand-brain", async (importOriginal) => ({ ...await importOriginal<typeof import("@/lib/brand-brain")>(), getBrandBrain: () => ({}), loadPersistedBrandBrain: async () => ({ brain: {} }) }));
vi.mock("@/lib/guardrails", async (importOriginal) => ({ ...await importOriginal<typeof import("@/lib/guardrails")>(), getStoredCustomGuardrails: () => [], loadPersistedCustomGuardrails: async () => ({ rules: [] }) }));
vi.mock("@/components/workbench/OutputBoard", () => ({ OutputBoard: ({ outputs }: { outputs: Array<{ body: string }> }) => <div>{outputs.map((o, i) => <p key={i}>{o.body}</p>)}</div> }));
vi.mock("@/lib/sse-client", () => ({ consumeSSEStream: async (_response: unknown, emit: (event: string, data: unknown) => void) => {
  const outputs = [{ id: "o1", platform: "xiaohongshu", title: "Test", body: "真实测试结果", cta: "", notes: "", strategy: "" }, { id: "o2", platform: "wechat", title: "Test", body: "第二份测试结果", cta: "", notes: "", strategy: "" }];
  for (const output of outputs) emit("output", { output });
  emit("done", { kit: { id: "91d9deae-0883-4b22-8a95-80fc382c29c9", ideaText: "用户实际输入内容", goal: "lead-gen", persona: "ai-saas", platforms: ["xiaohongshu", "wechat"], mediaAssets: [], outputs, createdAt: new Date().toISOString(), status: "saved" }, allowance: { used: 18, limit: 50, available: 32, plan: "free" } });
} }));

let authenticated = false;
let available = 50;
beforeEach(() => {
  const values = new Map<string, string>();
  Object.defineProperty(window, "localStorage", { configurable: true, value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); }, clear: () => values.clear()
  } });
  vi.clearAllMocks(); authenticated = false; available = 50;
  window.history.replaceState({}, "", "/workbench?start=1");
  vi.stubGlobal("fetch", vi.fn(async (url: unknown, init?: RequestInit) => {
    if (url === "/api/entitlements/check") return new Response(JSON.stringify({ authenticated, plan: "free", canUseOutputs: authenticated, monthlyLimit: 50, used: 50 - available, available: authenticated ? available : 0 }));
    if (url === "/api/kits") return new Response(JSON.stringify({ kits: [] }));
    if (url === "/api/generate") { m.generated(JSON.parse(String(init?.body))); return new Response(""); }
    return new Response("{}");
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function view(draftId?: string) { return render(<WorkbenchProvider><FirstTaskWorkbench draftId={draftId} /></WorkbenchProvider>); }
function DirectGenerateProbe() {
  const w = useWorkbench();
  return <><button onClick={() => void w.generateKit()}>Direct generate</button><p>{w.error}</p></>;
}
const source = "这是我们本周推出的真实产品更新，请为独立开发者整理成两份可发布的内容。";

describe("first task through authentication", () => {
  it("blocks a low-balance request in the provider as well as the UI, without calling generation", async () => {
    authenticated = true; available = 1;
    render(<WorkbenchProvider><FirstTaskWorkbench /><DirectGenerateProbe /></WorkbenchProvider>);
    await waitFor(() => expect(screen.getByLabelText("这次想分享什么？")).toBeEnabled());
    fireEvent.change(screen.getByLabelText("这次想分享什么？"), { target: { value: source } });
    expect(screen.getByRole("button", { name: "生成我的两份草稿" })).toBeDisabled();
    expect(screen.getByText(/本次需要 18 点，当前可用 1 点/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Direct generate" }));
    await waitFor(() => expect(screen.getByText(/生成文案需要 18 点，当前可用 1 点/)).toBeInTheDocument());
    expect(m.generated).not.toHaveBeenCalled();
    expect(m.capture.mock.calls.some(([name]) => name === "kit_generation_started")).toBe(false);
  });
  it("shows a disclosed example without filling, generating, or charging", async () => {
    view();
    await waitFor(() => expect(screen.getByLabelText("这次想分享什么？")).toBeEnabled());
    fireEvent.click(screen.getByText("先看一份真实材料与改写示范"));
    expect(screen.getByText(/输出为人工编写的改写示范/)).toBeInTheDocument();
    expect(screen.getByLabelText("这次想分享什么？")).toHaveValue("");
    expect(m.generated).not.toHaveBeenCalled();
    expect(m.capture.mock.calls.some(([name]) => name === "first_task_input_ready")).toBe(false);
  });
  it("shows the input requirement and measures editing without sending source text", async () => {
    view();
    const input = screen.getByLabelText("这次想分享什么？");
    await waitFor(() => expect(input).toBeEnabled());
    const submit = screen.getByRole("button", { name: "保存内容，免费注册后生成" });
    expect(submit).toBeDisabled();
    expect(screen.getByText("再写 20 个字，就可以继续。")).toBeInTheDocument();
    fireEvent.change(input, { target: { value: "真实更新" } });
    expect(screen.getByText("再写 16 个字，就可以继续。")).toBeInTheDocument();
    expect(submit).toBeDisabled();
    fireEvent.change(input, { target: { value: source } });
    expect(submit).toBeEnabled();
    fireEvent.change(input, { target: { value: source + "补充" } });
    expect(m.capture.mock.calls.filter(([name]) => name === "first_task_input_started")).toHaveLength(1);
    expect(m.capture.mock.calls.filter(([name]) => name === "first_task_input_ready")).toHaveLength(1);
    expect(JSON.stringify(m.capture.mock.calls)).not.toContain(source);
    expect(m.generated).not.toHaveBeenCalled();
  });
  it("turns only user answers into editable source without generating or leaking text", async () => {
    view();
    await waitFor(() => expect(screen.getByLabelText("这次想分享什么？")).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "还没写好？从三个问题开始" }));
    const apply = screen.getByRole("button", { name: "用这些回答开始" });
    expect(apply).toBeDisabled();
    fireEvent.change(screen.getByLabelText("这次做了什么、学到了什么，或改进了什么？"), { target: { value: source } });
    fireEvent.click(apply);
    expect(screen.getByLabelText("这次想分享什么？")).toHaveValue(source);
    expect(readFirstTaskDraft()?.text).toBe(source);
    expect(m.generated).not.toHaveBeenCalled();
    expect(m.push).not.toHaveBeenCalled();
    expect(JSON.stringify(m.capture.mock.calls)).not.toContain(source);
  });
  it("includes a restored ready draft in the funnel without generating or requiring another edit", async () => {
    const draft = { id: crypto.randomUUID(), text: source, platforms: ["xiaohongshu", "wechat"] as ["xiaohongshu", "wechat"], locale: "zh" as const, savedAt: Date.now() };
    saveFirstTaskDraft(draft);
    view(draft.id);
    await waitFor(() => expect(screen.getByLabelText("这次想分享什么？")).toHaveValue(source));
    expect(m.capture).toHaveBeenCalledWith("first_task_input_ready", expect.objectContaining({ first_task_id: draft.id, input_source: "restored", first_task_ui_version: 4 }));
    const names = m.capture.mock.calls.map(([name]) => name);
    expect(names.indexOf("first_task_viewed")).toBeLessThan(names.indexOf("first_task_input_ready"));
    expect(names).not.toContain("first_task_input_started");
    expect(m.generated).not.toHaveBeenCalled();
  });
  it("preserves the user's source and choices through signup, and only generates on explicit confirmation", async () => {
    const first = view();
    await waitFor(() => expect(screen.getByLabelText("这次想分享什么？")).toBeEnabled());
    fireEvent.change(screen.getByLabelText("这次想分享什么？"), { target: { value: source } });
    fireEvent.click(screen.getByRole("button", { name: "保存内容，免费注册后生成" }));
    await waitFor(() => expect(m.push).toHaveBeenCalledOnce());
    const saved = readFirstTaskDraft()!;
    expect(saved.text).toBe(source);
    expect(m.push.mock.calls[0][0]).not.toContain(encodeURIComponent(source));
    expect(m.generated).not.toHaveBeenCalled();
    first.unmount(); authenticated = true;
    window.history.replaceState({}, "", `/workbench?start=1&draft=${saved.id}`);
    view(saved.id);
    await waitFor(() => expect(screen.getByLabelText("这次想分享什么？")).toHaveValue(source));
    expect(m.generated).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "生成我的两份草稿" }));
    await screen.findByText("真实测试结果");
    expect(m.generated).toHaveBeenCalledWith(expect.objectContaining({ ideaText: source, platforms: ["xiaohongshu", "wechat"], visualMode: "none", analytics: expect.objectContaining({ entry_point: "first_task", first_task_id: saved.id }) }));
    expect(PLAN_CREDITS.free).toBeGreaterThanOrEqual(computeKitCost(2));
    expect(JSON.stringify(m.capture.mock.calls)).not.toContain(source);
    expect(readFirstTaskDraft()?.kitId).toBe("91d9deae-0883-4b22-8a95-80fc382c29c9");
    // A finished first task offers a clear next step instead of a dead end.
    const nextSteps = await screen.findByTestId("first-task-next-steps");
    expect(nextSteps.querySelector('a[href="/workbench"]')).toHaveTextContent("在创作台继续修改");
    expect(nextSteps.querySelector('a[href="/kits/91d9deae-0883-4b22-8a95-80fc382c29c9"]')).toHaveTextContent("打开草稿详情");
  });
  it("does not redirect and lose text when browser storage rejects the handoff", async () => {
    view();
    await waitFor(() => expect(screen.getByLabelText("这次想分享什么？")).toBeEnabled());
    const write = vi.spyOn(window.localStorage, "setItem").mockImplementation(() => { throw new Error("quota"); });
    fireEvent.change(screen.getByLabelText("这次想分享什么？"), { target: { value: source } });
    fireEvent.click(screen.getByRole("button", { name: "保存内容，免费注册后生成" }));
    expect(m.push).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("浏览器暂时无法保存草稿");
    expect(screen.getByLabelText("这次想分享什么？")).toHaveValue(source);
    write.mockRestore();
  });
  it("explains where the draft went when the URL's draft isn't in this browser", async () => {
    view("missing-draft-id");
    await waitFor(() => expect(screen.getByLabelText("这次想分享什么？")).toBeEnabled());
    expect(screen.getByText(/草稿保存在注册时使用的浏览器里/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("这次想分享什么？"), { target: { value: source } });
    expect(screen.queryByText(/草稿保存在注册时使用的浏览器里/)).not.toBeInTheDocument();
  });
  it("asks before an edit clears finished drafts and keeps the saved-draft link", async () => {
    authenticated = true;
    view();
    await waitFor(() => expect(screen.getByLabelText("这次想分享什么？")).toBeEnabled());
    fireEvent.change(screen.getByLabelText("这次想分享什么？"), { target: { value: source } });
    fireEvent.click(screen.getByRole("button", { name: "生成我的两份草稿" }));
    await screen.findByText("真实测试结果");

    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false);
    fireEvent.change(screen.getByLabelText("这次想分享什么？"), { target: { value: source + "改" } });
    expect(confirm).toHaveBeenCalledOnce();
    expect(screen.getByText("真实测试结果")).toBeInTheDocument();
    expect(screen.getByLabelText("这次想分享什么？")).toHaveValue(source);

    confirm.mockReturnValueOnce(true);
    fireEvent.change(screen.getByLabelText("这次想分享什么？"), { target: { value: source + "改" } });
    await waitFor(() => expect(screen.queryByText("真实测试结果")).not.toBeInTheDocument());
    expect(screen.getByRole("link", { name: "打开已保存的草稿" })).toHaveAttribute("href", "/kits/91d9deae-0883-4b22-8a95-80fc382c29c9");
    confirm.mockRestore();
  });
});
