import "@testing-library/jest-dom/vitest";
import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentAutomationCenter } from "@/components/app-shell/AgentAutomationCenter";
import {
  beginActiveAgentRun,
  endActiveAgentRun,
  setActiveAgentRunSession
} from "@/lib/agent/active-runs";
import { rememberLastAgentSession } from "@/lib/agent/session-restore";

vi.mock("@/hooks/useLocale", () => ({ useLocale: () => "zh" }));
vi.mock("@/components/ui/SpeechInputButton", () => ({
  appendTranscript: (current: string, next: string) => `${current}${next}`,
  SpeechInputButton: () => null
}));
vi.mock("@/components/app-shell/OpportunityRadarPreview", () => ({ OpportunityRadarPreview: () => null }));

const mocks = vi.hoisted(() => ({ consume: vi.fn() }));
vi.mock("@/lib/sse-client", () => ({ consumeSSEStream: mocks.consume }));

const SESSION_ID = "0d6b6a43-8a1f-4c55-9c0e-1f0c3a8e2b71";

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body)
  } as Response);
}

beforeEach(() => {
  mocks.consume.mockReset();
  const values = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      clear: () => values.clear(),
      getItem: (key: string) => values.get(key) ?? null,
      key: (index: number) => Array.from(values.keys())[index] ?? null,
      get length() { return values.size; },
      removeItem: (key: string) => values.delete(key),
      setItem: (key: string, value: string) => values.set(key, value)
    }
  });
});

afterEach(() => vi.unstubAllGlobals());

describe("AgentAutomationCenter recovery", () => {
  it("shows a run still streaming from the side rail as in progress instead of offering a retry", async () => {
    const token = beginActiveAgentRun({ sessionId: null, message: "诊断我的账号" });
    const fetchMock = vi.fn((input: unknown) => {
      if (String(input) === `/api/agent/sessions/${SESSION_ID}`) {
        return jsonResponse({
          messages: [
            { role: "user", content: { text: "诊断我的账号" } },
            { role: "assistant", content: { text: "账号诊断完成。" } }
          ]
        });
      }
      return jsonResponse({ sessions: [] });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<AgentAutomationCenter />);

    expect(screen.getByText("诊断我的账号")).toBeInTheDocument();
    expect(screen.getByText("这个任务还在进行，完成后结果会显示在这里。")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /重试本轮/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/上一轮没有完成/)).not.toBeInTheDocument();

    // New input while the rail run streams is queued, never a parallel run.
    await userEvent.setup().type(screen.getByPlaceholderText("输入新任务，当前完成后执行"), "再写一篇{Enter}");
    expect(fetchMock.mock.calls.some(([input]) => String(input) === "/api/agent/chat")).toBe(false);
    expect(screen.getByRole("list", { name: "排队任务" })).toBeInTheDocument();

    await act(async () => {
      setActiveAgentRunSession(token, SESSION_ID);
      endActiveAgentRun(token);
    });

    expect(await screen.findByText("账号诊断完成。")).toBeInTheDocument();
    expect(screen.queryByText("这个任务还在进行，完成后结果会显示在这里。")).not.toBeInTheDocument();
    // The queued message starts once the rail run has finished.
    await waitFor(() => expect(fetchMock.mock.calls.some(([input]) => String(input) === "/api/agent/chat")).toBe(true));
  });

  it("follows a run in another tab or device until it finishes, without offering a retry", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    rememberLastAgentSession(SESSION_ID);
    let remoteRunning = true;
    const fetchMock = vi.fn((input: unknown, _init?: RequestInit) => {
      if (String(input) === `/api/agent/sessions/${SESSION_ID}`) {
        return jsonResponse(remoteRunning
          ? {
              activeRun: { id: "5f0c1d2e-3b4a-4c5d-8e6f-7a8b9c0d1e2f", startedAt: new Date().toISOString() },
              messages: [{ role: "user", content: { text: "诊断我的账号" } }]
            }
          : {
              activeRun: null,
              messages: [
                { role: "user", content: { text: "诊断我的账号" } },
                { role: "assistant", content: { text: "账号诊断完成。" } }
              ]
            });
      }
      return jsonResponse({ sessions: [] });
    });
    vi.stubGlobal("fetch", fetchMock);
    const chatCalls = () => fetchMock.mock.calls.filter(([input]) => String(input) === "/api/agent/chat");
    const sessionCalls = () => fetchMock.mock.calls.filter(([input]) => String(input) === `/api/agent/sessions/${SESSION_ID}`);

    try {
      render(<AgentAutomationCenter />);

      expect(await screen.findByText("这个任务还在进行，完成后结果会显示在这里。")).toBeInTheDocument();
      expect(screen.getByText("诊断我的账号")).toBeInTheDocument();
      expect(screen.queryByText(/上一轮没有完成/)).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /重试本轮/ })).not.toBeInTheDocument();
      // That run cannot be stopped from this tab.
      expect(screen.queryByRole("button", { name: "停止" })).not.toBeInTheDocument();

      // New input waits for that run instead of starting a parallel one.
      fireEvent.change(screen.getByPlaceholderText("输入新任务，当前完成后执行"), { target: { value: "再写一篇" } });
      fireEvent.click(screen.getByRole("button", { name: "排队" }));
      expect(screen.getByRole("list", { name: "排队任务" })).toBeInTheDocument();
      expect(chatCalls()).toHaveLength(0);

      // Still running at the first poll.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(4_000);
      });
      expect(sessionCalls()).toHaveLength(2);
      expect(screen.getByText("这个任务还在进行，完成后结果会显示在这里。")).toBeInTheDocument();

      remoteRunning = false;
      await act(async () => {
        await vi.advanceTimersByTimeAsync(6_000);
      });

      expect(await screen.findByText("账号诊断完成。")).toBeInTheDocument();
      expect(screen.queryByText("这个任务还在进行，完成后结果会显示在这里。")).not.toBeInTheDocument();
      await waitFor(() => expect(chatCalls()).toHaveLength(1));
      const sent = JSON.parse(String(chatCalls()[0][1]?.body)) as { message: string };
      expect(sent.message).toBe("再写一篇");
    } finally {
      vi.useRealTimers();
    }
  });

  it("waits for the other run when the server refuses a second run on the same conversation", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    rememberLastAgentSession(SESSION_ID);
    let remoteRunning = false;
    const fetchMock = vi.fn((input: unknown, _init?: RequestInit) => {
      const url = String(input);
      if (url === `/api/agent/sessions/${SESSION_ID}`) {
        return jsonResponse({
          activeRun: remoteRunning ? { id: "5f0c1d2e-3b4a-4c5d-8e6f-7a8b9c0d1e2f", startedAt: new Date().toISOString() } : null,
          messages: [
            { role: "user", content: { text: "整理选题" } },
            { role: "assistant", content: { text: "选题已整理。" } }
          ]
        });
      }
      if (url === "/api/agent/chat") {
        const calls = fetchMock.mock.calls.filter(([called]) => String(called) === "/api/agent/chat").length;
        if (calls === 1) {
          remoteRunning = true;
          return jsonResponse({ code: "AGENT_SESSION_BUSY", error: "这个对话里已有任务在进行，请等它完成" }, 409);
        }
        return Promise.resolve({ ok: true, status: 200, body: null } as Response);
      }
      return jsonResponse({ sessions: [] });
    });
    vi.stubGlobal("fetch", fetchMock);
    const chatCalls = () => fetchMock.mock.calls.filter(([input]) => String(input) === "/api/agent/chat");

    try {
      render(<AgentAutomationCenter />);
      expect(await screen.findByText("选题已整理。")).toBeInTheDocument();

      fireEvent.change(screen.getByPlaceholderText("例如：分析我的账号，告诉我下一步"), { target: { value: "写一篇" } });
      fireEvent.click(screen.getByRole("button", { name: "发送" }));

      expect(await screen.findByText("这个任务还在进行，完成后结果会显示在这里。")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /重试本轮/ })).not.toBeInTheDocument();
      expect(screen.getByRole("list", { name: "排队任务" })).toBeInTheDocument();
      expect(chatCalls()).toHaveLength(1);

      remoteRunning = false;
      await act(async () => {
        await vi.advanceTimersByTimeAsync(4_000);
      });

      await waitFor(() => expect(chatCalls()).toHaveLength(2));
      expect(JSON.parse(String(chatCalls()[1][1]?.body)).message).toBe("写一篇");
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the composer and starters hidden until the conversation is restored", async () => {
    const token = beginActiveAgentRun({ sessionId: SESSION_ID, message: "整理选题" });
    let releaseSession!: () => void;
    vi.stubGlobal("fetch", vi.fn((input: unknown) => {
      if (String(input) === `/api/agent/sessions/${SESSION_ID}`) {
        return new Promise<Response>((resolve) => {
          releaseSession = () => resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve({ messages: [{ role: "user", content: { text: "整理选题" } }] })
          } as Response);
        });
      }
      return jsonResponse({ sessions: [] });
    }));

    render(<AgentAutomationCenter />);
    expect(screen.getByRole("status", { name: "正在恢复对话" })).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("例如：分析我的账号，告诉我下一步")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /写一篇内容/ })).not.toBeInTheDocument();

    await act(async () => releaseSession());
    expect(await screen.findByText("这个任务还在进行，完成后结果会显示在这里。")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /重试本轮/ })).not.toBeInTheDocument();
    act(() => endActiveAgentRun(token));
  });

  it("maps a network failure to product copy and keeps the turn retryable", async () => {
    const fetchMock = vi.fn((input: unknown, _init?: RequestInit) => {
      if (String(input) === "/api/agent/chat") return Promise.reject(new TypeError("Failed to fetch"));
      return jsonResponse({ sessions: [] });
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<AgentAutomationCenter />);

    await user.type(screen.getByPlaceholderText("例如：分析我的账号，告诉我下一步"), "分析账号");
    await user.click(screen.getByRole("button", { name: "发送" }));

    expect(await screen.findByText(/这一轮没有跑完/)).toBeInTheDocument();
    expect(screen.queryByText("Failed to fetch")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "重试本轮" }));
    const chatBodies = fetchMock.mock.calls
      .filter(([input]) => String(input) === "/api/agent/chat")
      .map(([, init]) => JSON.parse(String(init?.body)) as { message: string });
    expect(chatBodies.map((body) => body.message)).toEqual(["分析账号", "分析账号"]);
  });

  it("offers a retry when the stream is cut off mid-run", async () => {
    mocks.consume.mockImplementation(async (_response: unknown, onEvent: (event: string, data: unknown) => void) => {
      onEvent("text", { text: "正在读取主页" });
    });
    vi.stubGlobal("fetch", vi.fn(() => jsonResponse({ sessions: [] })));
    const user = userEvent.setup();
    render(<AgentAutomationCenter />);

    await user.type(screen.getByPlaceholderText("例如：分析我的账号，告诉我下一步"), "分析账号");
    await user.click(screen.getByRole("button", { name: "发送" }));

    expect(await screen.findByText(/连接中断/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重试本轮" })).toBeInTheDocument();
  });

  it("offers sign-in when the session expired mid-chat", async () => {
    mocks.consume.mockImplementation(async (_response: unknown, onEvent: (event: string, data: unknown) => void) => {
      onEvent("error", { code: "AUTH_REQUIRED", error: "请登录后使用 Finfold智能体。" });
    });
    vi.stubGlobal("fetch", vi.fn(() => jsonResponse({ sessions: [] })));
    const user = userEvent.setup();
    render(<AgentAutomationCenter />);

    await user.type(screen.getByPlaceholderText("例如：分析我的账号，告诉我下一步"), "分析账号");
    await user.click(screen.getByRole("button", { name: "发送" }));

    const signIn = await screen.findByRole("link", { name: /登录后继续/ });
    expect(signIn).toHaveAttribute("href", "/login?next=%2Fdashboard");
    expect(screen.queryByRole("button", { name: /重试本轮/ })).not.toBeInTheDocument();
    expect(screen.getByDisplayValue("分析账号")).toBeInTheDocument();
  });

  it("adds a sheet that is not a performance export as a regular attachment", async () => {
    const attachment = {
      id: "c8f6be26-70f1-4d31-9d0f-31c3e35e5cf4",
      name: "budget.csv",
      size: 12,
      kind: "data",
      mimeType: "text/csv",
      storagePath: "user-1/c8f6be26-70f1-4d31-9d0f-31c3e35e5cf4.csv"
    };
    const fetchMock = vi.fn((input: unknown) => {
      if (String(input) === "/api/agent/xhs/data-import") {
        return jsonResponse({ error: "CSV / XLSX 私有导入需要 Starter 或以上套餐。" }, 403);
      }
      if (String(input) === "/api/agent/attachments") return jsonResponse({ attachments: [attachment] });
      return jsonResponse({ sessions: [] });
    });
    vi.stubGlobal("fetch", fetchMock);
    const { container } = render(<AgentAutomationCenter />);

    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [new File(["a,b\n1,2"], "budget.csv", { type: "text/csv" })] } });

    expect(await screen.findByText("budget.csv")).toBeInTheDocument();
    expect(screen.queryByText(/Starter 或以上套餐/)).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([input]) => String(input) === "/api/agent/attachments")).toBe(true);
  });

  it("drops a consumed ?prompt= from the URL so a refresh restores the conversation", () => {
    window.history.replaceState(null, "", "/dashboard?prompt=%E5%86%99%E4%B8%80%E7%AF%87");
    vi.stubGlobal("fetch", vi.fn(() => jsonResponse({ sessions: [] })));
    render(<AgentAutomationCenter initialPrompt="写一篇" />);

    expect(screen.getByDisplayValue("写一篇")).toBeInTheDocument();
    expect(window.location.search).toBe("");
    expect(window.location.pathname).toBe("/dashboard");
  });
});
