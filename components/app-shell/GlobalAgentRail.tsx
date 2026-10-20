"use client";

import React, {
  type FormEvent,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import {
  ArrowUp,
  Bot,
  CheckCircle2,
  Expand,
  History,
  Loader2,
  Plus,
  RefreshCw,
  Sparkles,
  X
} from "@/components/ui/icons";
import { AgentComposer } from "@/components/app-shell/AgentComposer";
import { AgentQueuedTasks, type QueuedAgentTask } from "@/components/app-shell/AgentQueuedTasks";
import { AgentQuestionCard } from "@/components/app-shell/AgentQuestionCard";
import { PendingAgentMutationCard } from "@/components/app-shell/PendingAgentMutationCard";
import { AgentMessageContent } from "@/components/app-shell/AgentMessageContent";
import { AgentSessionHistory, type AgentSessionSummary } from "@/components/app-shell/AgentSessionHistory";
import { AgentThinkingTrace } from "@/components/app-shell/AgentThinkingTrace";
import { EvidenceCard } from "@/components/report/EvidenceCard";
import { isV2Report, ReportRenderer } from "@/components/report/ReportRenderer";
import type { EvidencePayload } from "@/lib/report/chart-spec";
import { AgentCollaborationStrip } from "@/components/app-shell/AgentCollaborationStrip";
import {
  collaborationFromWorkRecord,
  createCollaborationViewState,
  type CollaborationViewState
} from "@/lib/agent/collaboration-ui";
import type { SubagentEvent } from "@/lib/agent/subagents";
import { AccountInvestigationReportCard } from "@/components/app-shell/AccountInvestigationReportCard";
import { RewriteResultCard } from "@/components/agent/RewriteResultCard";
import { CreatorStyleProfileCard } from "@/components/app-shell/CreatorStyleProfileCard";
import { XhsToolResultCard } from "@/components/app-shell/XhsAgentWorkflowCard";
import { addToast } from "@/components/ui/Toast";
import { useLocale } from "@/hooks/useLocale";
import { useAuthUser } from "@/components/auth/AuthUserProvider";
import { buildAuthHref } from "@/lib/auth-return";
import { consumeAgentLoginDraft, saveAgentLoginDraft } from "@/lib/agent/login-draft";
import { requestWorkbenchAuthReturnTo } from "@/lib/workbench-auth-draft";
import {
  collapseAgentToolEventsForDisplay,
  getAgentToolLabel,
  OPEN_GLOBAL_AGENT_EVENT,
  resolveAgentPageContext
} from "@/lib/agent/presentation";
import {
  AGENT_MAX_TURNS_ERROR_CODE,
  agentStreamInterruptedMessage,
  agentUnexpectedFailureMessage,
  incompleteAgentTurnMessage,
  isRetryableAgentErrorCode,
  isRetryableStoredAgentError,
  isTechnicalAgentErrorMessage,
  safeStoredAgentErrorMessage
} from "@/lib/agent/provider-errors";
import {
  beginActiveAgentRun,
  endActiveAgentRun,
  setActiveAgentRunSession
} from "@/lib/agent/active-runs";
import { parseAskUserResult } from "@/lib/agent/ask-user";
import { workRecordOutcome, workRecordRunMeta } from "@/lib/agent/work-record";
import {
  clearLastAgentSession,
  readLastAgentSessionId,
  rememberLastAgentSession
} from "@/lib/agent/session-restore";
import { normalizeAgentTextContent } from "@/lib/agent/text-content";
import { playTaskCompleteSound } from "@/lib/completion-sound";
import { captureEvent } from "@/lib/posthog";
import { consumeSSEStream } from "@/lib/sse-client";
import { AgentRunUsageHint, type AgentRunUsage } from "@/components/app-shell/AgentRunUsageHint";
import type { AgentAttachment } from "@/lib/agent/attachments";
import { readStoredAgentDepth, writeStoredAgentDepth, type AgentDepth } from "@/lib/agent/depth";
import type { AccountInvestigation } from "@/lib/agent/account-investigation";
import { creatorStyleProfileSchema } from "@/lib/agent/style-profile-schema";
import {
  isAgentChatOutcome,
  isPendingAgentConfirmation,
  resolveAgentTerminalContent,
  type AgentChatOutcome
} from "@/lib/agent/chat-outcome";
import {
  advanceAgentStatus,
  completeAgentStatuses,
  isAgentStatusStage,
  type AgentStatusEvent
} from "@/lib/agent/status";

type ToolEvent = {
  name: string;
  args?: Record<string, unknown>;
  result?: unknown;
  completed?: boolean;
  startedAt?: number;
  completedAt?: number;
};
type RailMessage = {
  role: "assistant" | "user";
  content: string;
  pending?: boolean;
  toolEvents?: ToolEvent[];
  evidence?: EvidencePayload[];
  statusEvents?: AgentStatusEvent[];
  collaboration?: CollaborationViewState;
  paused?: boolean;
  attachments?: AgentAttachment[];
  retry?: { message: string; attachments: AgentAttachment[] };
  usage?: AgentRunUsage;
};

type AgentSession = AgentSessionSummary;

type GlobalAgentRailProps = {
  previewPathname?: string;
  previewMode?: boolean;
  hideLauncher?: boolean;
};

const PREVIEW_SESSIONS: AgentSession[] = [
  { id: "preview-current", title: "奶茶新品小红书整套方案", updated_at: "2026-08-04T03:02:00.000Z" },
  { id: "preview-brand", title: "梳理品牌语气与禁用表达", updated_at: "2026-08-03T08:40:00.000Z" },
  { id: "preview-review", title: "复盘上周内容表现", updated_at: "2026-08-01T02:20:00.000Z" }
];

const SUGGESTIONS: Record<string, { zh: string[]; en: string[] }> = {
  dashboard: {
    zh: ["分析今天最值得先做的任务", "看看本周增长哪里不对劲"],
    en: ["Find today's highest-value task", "Check what changed in growth this week"]
  },
  workbench: {
    zh: ["检查这批内容，告诉我先改哪条", "把这个想法做成小红书发布方案", "上传小红书博主截图，学习他的风格"],
    en: ["Review this content and tell me what to fix first", "Turn this idea into a Xiaohongshu publishing plan", "Upload creator screenshots to learn their style"]
  },
  packages: {
    zh: ["从最近内容中找出可复用的风格", "检查哪些内容已经可以发布"],
    en: ["Find reusable styles in recent content", "Check which content is ready to publish"]
  },
  "brand-memory": {
    zh: ["检查品牌记忆有没有冲突", "总结 Finfold 最近学会了什么"],
    en: ["Check brand memory for conflicts", "Summarize what Finfold learned recently"]
  },
  guardrails: {
    zh: ["检查还缺哪些品牌表达边界", "找出会影响内容质量的规则冲突"],
    en: ["Find missing brand boundaries", "Find rules that conflict with content quality"]
  },
  billing: {
    zh: ["解释哪种套餐最适合我", "Finfold智能体当前可以使用哪些能力"],
    en: ["Explain which plan fits me", "What Agent capabilities can I use now?"]
  },
  finfold: {
    zh: ["告诉我现在最值得做什么", "帮我把增长想法变成可发布内容"],
    en: ["Tell me the best next step", "Turn a marketing idea into publish-ready content"]
  }
};

const PREVIEW_MESSAGES: RailMessage[] = [
  { role: "user", content: "帮我把今天的奶茶新品做成一篇小红书爆款图文" },
  {
    role: "assistant",
    content: "我会先结合你的品牌语气和近期热门结构，整理 3 个选题方向，再给你一份可以直接修改的图文方案。发布前会先让你确认。",
    toolEvents: [
      {
        name: "create_execution_plan",
        completed: true,
        result: {
          steps: [
            { title: "读取品牌与真实素材", outcome: "确认事实边界" },
            { title: "调研选题方向", outcome: "给出推荐方向" },
            { title: "生成正文与标题", outcome: "完成可编辑初稿" },
            { title: "编排视觉故事", outcome: "生成 3:4 故事板" },
            { title: "发布前检查", outcome: "等待最终确认" }
          ]
        }
      },
      { name: "get_brand_brain", completed: true },
      {
        name: "prepare_xhs_campaign",
        completed: true,
        result: {
          xhsCard: {
            kind: "campaign",
            eyebrow: "整套方案 · 一次确认",
            title: "写字楼下的新奶茶，怎么让人一眼记住",
            summary: "调研、正文方向、标题和 3:4 视觉故事板已经连续准备完成；采用后进入创作与发布预览，不会直接公开发布。",
            items: [
              { id: "topic", title: "推荐选题：午休 10 分钟，也值得喝一杯有记忆点的奶茶", rationale: "从真实办公场景切入，不虚构平台热度" },
              { id: "title", title: "主标题：楼下这杯奶茶，凭什么被记住", rationale: "具体场景 + 好奇缺口 · 标题评分 88" },
              { id: "visual", title: "视觉故事：6 页 · 3:4", rationale: "封面单焦点，逐页展示场景、差异和行动" }
            ],
            meta: {
              limitations: ["尚未接入实时小红书趋势样本；当前选题属于品牌策略判断。"],
              targetMetric: "封面点击率",
              href: "/workbench?platform=xiaohongshu"
            }
          },
          pendingAction: { id: "preview-action", actionKind: "confirm_campaign" },
          executionProgress: { completedSteps: 5, totalSteps: 5 }
        }
      }
    ],
    statusEvents: [
      { stage: "understanding_request", completed: true },
      { stage: "connecting_workspace", completed: true },
      { stage: "preparing_context", completed: true },
      { stage: "choosing_capabilities", completed: true },
      { stage: "reviewing_results", completed: true },
      { stage: "composing_response", completed: true }
    ]
  }
];

function TaskProgress({ events, locale }: { events: ToolEvent[]; locale: "zh" | "en" }) {
  const planEvent = events.find((event) => event.name === "create_execution_plan");
  const planValue = planEvent?.result && typeof planEvent.result === "object"
    ? planEvent.result as { steps?: Array<{ title?: string; outcome?: string }> }
    : planEvent?.args as { steps?: Array<{ title?: string; outcome?: string }> } | undefined;
  const plannedSteps = (planValue?.steps ?? []).filter((step) => typeof step.title === "string" && step.title.trim());
  const executionEvents = events.filter(
    (event) => event.name !== "create_execution_plan" && event.name !== "delegate_parallel"
  );
  const fallbackEvents = executionEvents.length > 0 ? executionEvents : events;
  const explicitProgress = executionEvents
    .map((event) => event.result && typeof event.result === "object" && "executionProgress" in event.result
      ? (event.result as { executionProgress?: { completedSteps?: number; totalSteps?: number } }).executionProgress
      : undefined)
    .find(Boolean);
  const completed = explicitProgress?.completedSteps ?? executionEvents.filter((event) => event.completed).length;
  const total = plannedSteps.length || explicitProgress?.totalSteps || fallbackEvents.length;
  const currentIndex = Math.min(completed, Math.max(total - 1, 0));
  const activeTitle = plannedSteps[currentIndex]?.title
    ?? getAgentToolLabel(fallbackEvents.find((event) => !event.completed)?.name ?? fallbackEvents.at(-1)?.name ?? "create_execution_plan", locale);
  const finished = total > 0 && completed >= total;

  return (
    <details className="group mb-3">
      <summary className="focus-ring inline-flex max-w-full cursor-pointer list-none items-center gap-2 rounded-full border border-hairline bg-surface px-3 py-1.5 text-xs font-semibold text-fg-muted shadow-raised transition hover:border-action/35 [&::-webkit-details-marker]:hidden">
        {finished
          ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-positive" />
          : <span className="h-3.5 w-3.5 shrink-0 rounded-full border-2 border-action/25 border-t-action motion-safe:animate-spin" />}
        <span className="truncate">
          {locale === "zh" ? `步骤 ${Math.min(completed + 1, total)} / ${total}` : `Step ${Math.min(completed + 1, total)} / ${total}`}
          {activeTitle ? ` · ${activeTitle}` : ""}
        </span>
      </summary>
      <div className="mt-2 space-y-1.5 rounded-xl border border-hairline bg-surface/75 p-2">
        {(plannedSteps.length > 0 ? plannedSteps : fallbackEvents).map((item, index) => {
          const label = "name" in item ? getAgentToolLabel(item.name, locale) : item.title ?? "";
          const itemCompleted = plannedSteps.length > 0 ? index < completed : "completed" in item && Boolean(item.completed);
          const itemActive = !itemCompleted && index === currentIndex;
          return (
          <div key={`${label}-${index}`} className="flex items-center gap-2 px-1.5 py-1 text-[11px] font-semibold text-fg-muted">
            {itemCompleted
              ? <CheckCircle2 className="h-3.5 w-3.5 text-positive" />
              : itemActive
                ? <Loader2 className="h-3.5 w-3.5 animate-spin text-action" />
                : <span className="h-3.5 w-3.5 rounded-full border border-hairline" />}
            <span className="flex-1">{label}</span>
            <span className="text-[10px] text-fg-subtle">
              {itemCompleted
                ? (locale === "zh" ? "已完成" : "Done")
                : itemActive
                  ? (locale === "zh" ? "进行中" : "Working")
                  : (locale === "zh" ? "待执行" : "Queued")}
            </span>
          </div>
        );})}
      </div>
    </details>
  );
}


export function GlobalAgentRail({ previewPathname, previewMode = false, hideLauncher = false }: GlobalAgentRailProps) {
  const actualPathname = usePathname();
  const router = useRouter();
  const pathname = previewPathname ?? actualPathname ?? "/";
  const locale = useLocale();
  const { ready: authReady, user: authenticatedUser } = useAuthUser();
  const [authExpired, setAuthExpired] = useState(false);
  const [loginDraftError, setLoginDraftError] = useState(false);
  const [open, setOpen] = useState(previewMode);
  const [sessionId, setSessionId] = useState<string | null>(previewMode ? "preview-current" : null);
  // Queued follow-ups are sent from the previous send's closure, which still
  // sees the pre-session state; read the live id so they join the same chat.
  const sessionIdRef = useRef(sessionId);
  sessionIdRef.current = sessionId;
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  // Thinking depth rides on every chat request; hydrate from storage after
  // mount so SSR markup and the stored preference never mismatch.
  const [depth, setDepth] = useState<AgentDepth>("low");
  useEffect(() => {
    setDepth(readStoredAgentDepth());
  }, []);
  const [pendingAttachments, setPendingAttachments] = useState<AgentAttachment[]>([]);
  const [messages, setMessages] = useState<RailMessage[]>(previewMode ? PREVIEW_MESSAGES : []);
  const [sessions, setSessions] = useState<AgentSession[]>(previewMode ? PREVIEW_SESSIONS : []);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [queuedTasks, setQueuedTasks] = useState<QueuedAgentTask[]>([]);
  // Report entitlement — starts locked, checks lazily when a diagnosis report
  // first appears in the stream, unlocks once the effective plan is known.
  // A failed check unlocks (never punish a paying user for a flaky request).
  const [reportFullAccess, setReportFullAccess] = useState(false);
  const entitlementCheckedRef = useRef(false);
  const sawDiagnosisReport = messages.some((message) =>
    message.toolEvents?.some((event) => event.name === "investigate_social_account" && event.completed)
  );
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const previewTimerRef = useRef<number | null>(null);
  const activeRunRef = useRef(0);
  const queuedTasksRef = useRef<QueuedAgentTask[]>([]);
  const queuedTaskSeqRef = useRef(0);
  // Mirror of `sending` that stays current across the synchronous
  // finish-then-pump-queue chain, where the state closure would still see the
  // previous render's value.
  const sendingRef = useRef(false);
  const context = useMemo(() => resolveAgentPageContext(pathname), [pathname]);
  const suggestions = SUGGESTIONS[context.key]?.[locale] ?? SUGGESTIONS.finfold[locale];
  const isFullAgentPage = !previewPathname && (
    actualPathname === "/dashboard" || actualPathname?.startsWith("/agents") === true
  );
  const accountHealthOwnsAgentEntry = !previewPathname && actualPathname === "/operations/account-health";
  const needsLogin = !previewMode && ((authReady && !authenticatedUser) || authExpired);
  const [loginHref, setLoginHref] = useState(buildAuthHref("/login", pathname));

  useEffect(() => {
    if (previewMode) return;
    setLoginHref(buildAuthHref("/login", `${window.location.pathname}${window.location.search}${window.location.hash}`));
    const draft = consumeAgentLoginDraft(pathname);
    if (draft !== null) { setInput(draft); setOpen(true); }
  }, [pathname, previewMode]);

  useEffect(() => { if (authenticatedUser) setAuthExpired(false); }, [authenticatedUser]);

  const copy = locale === "en" ? {
    launcher: "Ask Finfold",
    title: "Finfold Agent",
    viewing: "Viewing",
    newChat: "New conversation",
    history: "History",
    historyTitle: "Conversation history",
    noHistory: "No previous conversations yet",
    current: "Current",
    full: "Full workspace",
    close: "Close Agent",
    greeting: "What would you like to do?",
    placeholder: "Do anything",
    steerPlaceholder: "Type a new task — it runs after the current one",
    send: "Send",
    paused: "Stopped.",
    resume: "Continue this task",
    resumePrompt: "Continue the task I stopped — don't redo the steps already finished.",
    thinking: "Choosing the best way to help…",
    uploadFail: "Could not upload this attachment."
  } : {
    launcher: "问 Finfold智能体",
    title: "Finfold智能体",
    viewing: "正在看",
    newChat: "新对话",
    history: "历史对话",
    historyTitle: "历史对话",
    noHistory: "还没有历史对话",
    current: "当前",
    full: "完整工作台",
    close: "关闭智能体",
    greeting: "想一起完成什么？",
    placeholder: "想做什么都可以",
    steerPlaceholder: "输入新任务，当前完成后执行",
    send: "发送",
    paused: "已停止。",
    resume: "继续这个任务",
    resumePrompt: "继续刚才停止的任务，已完成的步骤不用重做。",
    thinking: "正在选择最合适的做法…",
    uploadFail: "附件上传失败，请重试。"
  };

  useEffect(() => {
    if (previewMode) {
      setReportFullAccess(true);
      return;
    }
    if (!sawDiagnosisReport || entitlementCheckedRef.current) return;
    entitlementCheckedRef.current = true;
    let cancelled = false;
    void fetch("/api/entitlements/check", { method: "POST", cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("entitlement check failed");
        const data = await response.json() as { plan?: string | null };
        if (cancelled) return;
        setReportFullAccess(Boolean(data.plan && data.plan !== "free"));
      })
      .catch(() => {
        if (!cancelled) setReportFullAccess(true);
      });
    return () => {
      cancelled = true;
    };
  }, [sawDiagnosisReport, previewMode]);

  useEffect(() => {
    if (previewMode) return;
    let cancelled = false;
    const storedSessionId = readLastAgentSessionId();
    if (!storedSessionId) return;

    void fetch(`/api/agent/sessions/${encodeURIComponent(storedSessionId)}`, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Unable to restore Agent session.");
        return response.json() as Promise<{ messages?: Array<{ role?: string; content?: unknown }> }>;
      })
      .then((data) => {
        if (cancelled) return;
        setSessionId(storedSessionId);
        setMessages(mapStoredMessages(data.messages ?? [], locale, copy.paused));
      })
      .catch(() => {
        // Session restore is best-effort and must never block a new chat.
        clearLastAgentSession();
      });
    return () => {
      cancelled = true;
    };
    // copy.paused follows locale, which is already a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locale, previewMode]);

  // The full-page conversation can start, switch, or clear the shared "last
  // conversation" while this rail sits closed. Re-sync on open so the rail
  // never reopens a stale conversation.
  useEffect(() => {
    if (!open || previewMode || sendingRef.current || queuedTasksRef.current.length > 0) return;
    const storedSessionId = readLastAgentSessionId();
    if (storedSessionId === sessionIdRef.current) return;
    if (!storedSessionId) {
      activeRunRef.current += 1;
      setSessionId(null);
      setMessages([]);
      return;
    }
    let cancelled = false;
    const loadToken = activeRunRef.current + 1;
    activeRunRef.current = loadToken;
    void fetch(`/api/agent/sessions/${encodeURIComponent(storedSessionId)}`, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Unable to restore Agent session.");
        return response.json() as Promise<{ messages?: Array<{ role?: string; content?: unknown }> }>;
      })
      .then((data) => {
        if (cancelled || activeRunRef.current !== loadToken) return;
        setSessionId(storedSessionId);
        setMessages(mapStoredMessages(data.messages ?? [], locale, copy.paused));
      })
      .catch(() => {
        // Keep showing the current conversation; the next open retries.
      });
    return () => {
      cancelled = true;
    };
    // Re-sync only when the rail opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, previewMode]);

  useEffect(() => {
    function handleShortcut(event: globalThis.KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "j") {
        event.preventDefault();
        setOpen((current) => {
          const next = !current;
          if (next) captureEvent("global_agent_opened", { surface: context.key, method: "shortcut" });
          return next;
        });
      } else if (event.key === "Escape") {
        setOpen(false);
      }
    }
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [context.key]);

  useEffect(() => {
    function openFromProductSurface(event: Event) {
      setOpen(true);
      const prompt = (event as CustomEvent<{ prompt?: unknown }>).detail?.prompt;
      if (typeof prompt === "string" && prompt.trim()) setInput(prompt.trim().slice(0, 4000));
      captureEvent("global_agent_opened", {
        surface: context.key,
        method: "workbench_card"
      });
    }
    window.addEventListener(OPEN_GLOBAL_AGENT_EVENT, openFromProductSurface);
    return () => window.removeEventListener(OPEN_GLOBAL_AGENT_EVENT, openFromProductSurface);
  }, [context.key]);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => inputRef.current?.focus(), 80);
    return () => window.clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    scrollRef.current?.scrollTo?.({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, open]);

  useEffect(() => () => {
    abortRef.current?.abort();
    if (previewTimerRef.current !== null) window.clearTimeout(previewTimerRef.current);
  }, []);

  function openRail(method: "launcher" | "suggestion") {
    setOpen(true);
    captureEvent("global_agent_opened", { surface: context.key, method });
  }

  async function loadSessions() {
    if (previewMode) {
      setSessions(PREVIEW_SESSIONS);
      return;
    }
    setHistoryLoading(true);
    try {
      const response = await fetch("/api/agent/sessions", { cache: "no-store" });
      const data = (await response.json().catch(() => ({}))) as { sessions?: AgentSession[] };
      if (!response.ok) throw new Error("Unable to load Agent history.");
      setSessions(data.sessions ?? []);
    } catch {
      setSessions([]);
    } finally {
      setHistoryLoading(false);
    }
  }

  function toggleHistory() {
    setHistoryOpen((current) => {
      const next = !current;
      if (next) void loadSessions();
      return next;
    });
  }

  async function selectSession(nextSession: AgentSession) {
    if (sendingRef.current) stopAgent({ keepQueuedDrafts: false });
    activeRunRef.current += 1;
    clearQueuedTasks();
    if (previewMode) {
      setSessionId(nextSession.id);
      setMessages(nextSession.id === "preview-current" ? PREVIEW_MESSAGES : [
        { role: "user", content: nextSession.title },
        {
          role: "assistant",
          content: nextSession.id === "preview-brand"
            ? "我已经整理了品牌语气、可复用表达和需要避免的说法。"
            : "我已经按真实表现找出最上游的内容断点，并保留了下一步建议。"
        }
      ]);
      setHistoryOpen(false);
      return;
    }
    setHistoryLoading(true);
    try {
      const response = await fetch(`/api/agent/sessions/${encodeURIComponent(nextSession.id)}`, { cache: "no-store" });
      const data = (await response.json().catch(() => ({}))) as { messages?: Array<{ role?: string; content?: unknown }> };
      if (!response.ok) throw new Error("Unable to load Agent session.");
      setSessionId(nextSession.id);
      setMessages(mapStoredMessages(data.messages ?? [], locale, copy.paused));
      setHistoryOpen(false);
      rememberLastAgentSession(nextSession.id);
    } finally {
      setHistoryLoading(false);
    }
  }

  async function deleteSession(session: AgentSession) {
    // Optimistic delete: the row leaves the list immediately and the DELETE
    // settles in the background. If it cannot finish (slow network, timeout),
    // the row is restored in place and the user is told — the UI never waits
    // on the round-trip with a spinning confirmation row.
    setSessions((current) => current.filter((item) => item.id !== session.id));
    if (session.id === sessionId) {
      if (sendingRef.current) stopAgent({ keepQueuedDrafts: false });
      activeRunRef.current += 1;
      clearQueuedTasks();
      setSessionId(null);
      setMessages([]);
      setInput("");
      setPendingAttachments([]);
      clearLastAgentSession();
    }
    addToast("success", locale === "zh" ? "对话已删除。" : "Conversation deleted.");

    if (previewMode) return;

    void (async () => {
      try {
        const response = await fetch(`/api/agent/sessions/${encodeURIComponent(session.id)}`, {
          method: "DELETE",
          signal: AbortSignal.timeout(10_000)
        });
        if (!response.ok) {
          const data = (await response.json().catch(() => ({}))) as { error?: string };
          throw new Error(data.error ?? "delete failed");
        }
        captureEvent("global_agent_session_deleted", {
          surface: context.key,
          deleted_current: session.id === sessionId
        });
      } catch {
        setSessions((current) => {
          if (current.some((item) => item.id === session.id)) return current;
          return [...current, session].sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at));
        });
        addToast("error", locale === "zh" ? "删除没有完成，已恢复这条对话" : "Could not delete — the conversation is back");
      }
    })();
  }

  function stopAgent(options: { keepQueuedDrafts?: boolean } = {}) {
    if (!sendingRef.current) return;
    sendingRef.current = false;
    activeRunRef.current += 1;
    abortRef.current?.abort();
    if (previewTimerRef.current !== null) {
      window.clearTimeout(previewTimerRef.current);
      previewTimerRef.current = null;
    }
    setMessages((current) => {
      const next = [...current];
      const last = next.at(-1);
      if (last?.role === "assistant") {
        next[next.length - 1] = {
          ...last,
          content: last.content ? `${last.content}\n\n${copy.paused}` : copy.paused,
          pending: false,
          paused: true
        };
      }
      return next;
    });
    setSending(false);
    if (options.keepQueuedDrafts === false) clearQueuedTasks();
    else returnQueuedTasksToComposer();
    captureEvent("global_agent_paused", { surface: context.key, has_session: Boolean(sessionIdRef.current) });
  }
  // Lets the full-page conversation stop a run it is showing from this rail.
  const stopAgentRef = useRef(stopAgent);
  stopAgentRef.current = stopAgent;

  function resetConversation() {
    if (sendingRef.current) stopAgent({ keepQueuedDrafts: false });
    activeRunRef.current += 1;
    clearQueuedTasks();
    setSessionId(null);
    setMessages([]);
    setInput("");
    setPendingAttachments([]);
    setHistoryOpen(false);
    clearLastAgentSession();
    inputRef.current?.focus();
  }

  async function uploadAttachments(files: FileList | File[] | null) {
    if (!files?.length || uploading) return;
    if (!previewMode && (!authReady || !authenticatedUser || authExpired)) return;
    const remainingSlots = Math.max(0, 6 - pendingAttachments.length);
    if (!remainingSlots) {
      addToast("error", locale === "zh" ? "每次最多添加 6 个附件。" : "Add up to 6 attachments at a time.");
      return;
    }
    setUploading(true);
    try {
      const formData = new FormData();
      Array.from(files).slice(0, remainingSlots).forEach((file) => formData.append("files", file));
      const response = await fetch("/api/agent/attachments", { method: "POST", body: formData });
      const data = (await response.json().catch(() => ({}))) as { attachments?: AgentAttachment[]; error?: string };
      if (!response.ok || !data.attachments) throw new Error(data.error ?? copy.uploadFail);
      setPendingAttachments((current) => [...current, ...data.attachments!]);
      captureEvent("global_agent_attachments_added", { surface: context.key, count: data.attachments.length });
    } catch (error) {
      addToast("error", error instanceof Error ? error.message : copy.uploadFail);
    } finally {
      setUploading(false);
    }
  }

  function enqueueAgentTask(message: string, attachments: AgentAttachment[] = []) {
    queuedTaskSeqRef.current += 1;
    queuedTasksRef.current = [...queuedTasksRef.current, { id: queuedTaskSeqRef.current, message, attachments }];
    setQueuedTasks(queuedTasksRef.current);
    captureEvent("global_agent_message_queued", {
      surface: context.key,
      queue_length: queuedTasksRef.current.length
    });
  }

  function discardQueuedTask(id: number) {
    queuedTasksRef.current = queuedTasksRef.current.filter((item) => item.id !== id);
    setQueuedTasks(queuedTasksRef.current);
  }

  function clearQueuedTasks() {
    queuedTasksRef.current = [];
    setQueuedTasks([]);
  }

  /** After a stop, queued messages go back into the composer instead of
   *  starting on their own; nothing the user typed is lost. */
  function returnQueuedTasksToComposer() {
    const queued = queuedTasksRef.current;
    if (queued.length === 0) return;
    clearQueuedTasks();
    setInput((current) => [current.trim(), ...queued.map((item) => item.message)].filter(Boolean).join("\n\n"));
    setPendingAttachments((current) => [...current, ...queued.flatMap((item) => item.attachments ?? [])].slice(0, 6));
  }

  function pumpQueuedTasks() {
    if (queuedTasksRef.current.length === 0) return;
    const [next, ...rest] = queuedTasksRef.current;
    queuedTasksRef.current = rest;
    setQueuedTasks(rest);
    void sendMessage(undefined, next.message, next.attachments);
  }

  async function sendMessage(
    event?: FormEvent,
    preset?: string,
    retryAttachments?: AgentAttachment[]
  ) {
    event?.preventDefault();
    const attachments = retryAttachments ? [...retryAttachments] : [...pendingAttachments];
    const message = (preset ?? input).trim() || (attachments.length
      ? (locale === "zh" ? "请分析这些附件。" : "Please analyze these attachments.")
      : "");
    if (!message || uploading) return;
    if (!previewMode && (!authReady || !authenticatedUser || authExpired)) {
      setInput(message);
      return;
    }
    if (sendingRef.current) {
      // A message submitted while a task is running joins the FIFO queue
      // instead of racing a second concurrent run. It starts when the current
      // task finishes (a stop returns it to the composer), keeping its
      // attachment snapshot for that run.
      enqueueAgentTask(message, attachments);
      setInput("");
      setPendingAttachments([]);
      setHistoryOpen(false);
      return;
    }
    const runId = activeRunRef.current + 1;
    activeRunRef.current = runId;

    if (!retryAttachments) {
      setInput("");
      setPendingAttachments([]);
    }
    setHistoryOpen(false);
    setSending(true);
    sendingRef.current = true;
    setMessages((current) => [
      ...current,
      { role: "user", content: message, ...(attachments.length ? { attachments } : {}) },
      {
        role: "assistant",
        content: "",
        pending: true,
        toolEvents: [],
        statusEvents: [{ stage: "understanding_request", completed: false }]
      }
    ]);
    captureEvent("global_agent_message_sent", { surface: context.key, has_session: Boolean(sessionId) });

    if (previewMode) {
      previewTimerRef.current = window.setTimeout(() => {
        if (activeRunRef.current !== runId) return;
        setMessages((current) => {
          const next = [...current];
          next[next.length - 1] = {
            role: "assistant",
            content: locale === "en"
              ? "I’ve mapped a short workflow. I’ll show you the draft before any publishing action."
              : "我已经把它拆成一条短工作流。任何发布动作前，我都会先把成品给你确认。",
            toolEvents: [
              { name: "get_brand_brain", completed: true },
              { name: "analyze_content_readiness", completed: false }
            ],
            statusEvents: [
              { stage: "understanding_request", completed: true },
              { stage: "connecting_workspace", completed: true },
              { stage: "preparing_context", completed: true },
              { stage: "choosing_capabilities", completed: true },
              { stage: "reviewing_results", completed: true },
              { stage: "composing_response", completed: true }
            ]
          };
          return next;
        });
        setSending(false);
        sendingRef.current = false;
        previewTimerRef.current = null;
        pumpQueuedTasks();
      }, 5000);
      return;
    }

    let assistantText = "";
    const toolEvents: ToolEvent[] = [];
    const evidenceItems: EvidencePayload[] = [];
    const collaboration = createCollaborationViewState();
    let statusEvents: AgentStatusEvent[] = [{ stage: "understanding_request", completed: false }];
    let terminalOutcome: AgentChatOutcome | null = null;
    let streamErrorCode: string | undefined;
    let sawDone = false;
    let runFinishedNormally = false;
    let terminalFlags: { retryable: boolean; continuable: boolean } = { retryable: false, continuable: false };
    const fallback = locale === "en" ? "The Agent could not reply. Please try again." : "Finfold智能体暂时无法回复，请重试。";
    let controller: AbortController | null = null;
    const runStartedAt = Date.now();
    const runUsage: AgentRunUsage = {
      credits: 0,
      steps: 0,
      refunded: 0,
      startedAtMs: runStartedAt,
      durationMs: 0,
      available: 0
    };
    let insufficientCredits = false;
    let authenticationRequired = false;

    function updateAssistant(pending = true) {
      if (activeRunRef.current !== runId) return;
      const collaborationSnapshot = collaboration.snapshot();
      const usageSnapshot = !pending && (insufficientCredits || runUsage.steps > 0 || runUsage.refunded > 0)
        ? {
          ...runUsage,
          durationMs: Date.now() - runStartedAt,
          ...(insufficientCredits ? { insufficient: true } : {})
        }
        : undefined;
      setMessages((current) => {
        const next = [...current];
        next[next.length - 1] = {
          role: "assistant",
          content: assistantText,
          pending,
          toolEvents: [...toolEvents],
          ...(evidenceItems.length > 0 ? { evidence: [...evidenceItems] } : {}),
          statusEvents: pending ? [...statusEvents] : completeAgentStatuses(statusEvents),
          ...(collaborationSnapshot.groups.length > 0 ? { collaboration: collaborationSnapshot } : {}),
          ...(!pending && terminalFlags.retryable ? {
            retry: { message, attachments }
          } : {}),
          ...(!pending && terminalFlags.continuable ? { paused: true } : {}),
          ...(usageSnapshot ? { usage: usageSnapshot } : {})
        };
        return next;
      });
    }

    // Registered so the full-page conversation can show this run as still in
    // progress (and stop it) if the user expands the rail mid-run.
    const activeRunToken = beginActiveAgentRun({
      sessionId: sessionIdRef.current,
      message,
      stop: () => {
        if (activeRunRef.current === runId) stopAgentRef.current();
      }
    });
    try {
      controller = new AbortController();
      abortRef.current = controller;
      const response = await fetch("/api/agent/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: sessionIdRef.current ?? undefined,
          message,
          attachments: attachments.length ? attachments : undefined,
          pageContext: { pathname },
          depth
        }),
        signal: controller.signal
      });
      if (response.status === 401) {
        restoreUnauthenticatedPrompt();
        return;
      }
      if (response.status === 409) {
        // Another tab or device is already working in this conversation. A
        // retry would only be refused again; the message goes back to the
        // composer for when that task is done.
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        assistantText = data.error ?? fallback;
        setInput((current) => current.trim() ? current : message);
        updateAssistant(false);
        return;
      }
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? fallback);
      }

      let streamError: string | null = null;
      await consumeSSEStream(response, (eventName, data) => {
        if (activeRunRef.current !== runId) return;
        if (eventName === "session") {
          const newSessionId = (data as { sessionId: string }).sessionId;
          sessionIdRef.current = sessionIdRef.current ?? newSessionId;
          setSessionId((current) => current ?? newSessionId);
          rememberLastAgentSession(newSessionId);
          setActiveAgentRunSession(activeRunToken, sessionIdRef.current ?? newSessionId);
        } else if (eventName === "text") {
          assistantText += normalizeAgentTextContent((data as { text?: unknown }).text);
          updateAssistant();
        } else if (eventName === "status") {
          const { stage } = data as { stage?: unknown };
          if (isAgentStatusStage(stage)) {
            statusEvents = advanceAgentStatus(statusEvents, stage);
            updateAssistant();
          }
        } else if (eventName === "tool_call") {
          const { name, args } = data as { name: string; args?: Record<string, unknown> };
          toolEvents.push({ name, args, startedAt: Date.now() });
          updateAssistant();
        } else if (eventName === "tool_result") {
          const { name, result } = data as { name: string; result?: unknown };
          const item = toolEvents.find((tool) => tool.name === name && !tool.completed);
          if (item) {
            item.completed = true;
            item.result = result;
            item.completedAt = Date.now();
          }
          updateAssistant();
        } else if (eventName === "evidence") {
          const item = (data as { evidence?: EvidencePayload }).evidence;
          if (item) {
            evidenceItems.push(item);
            updateAssistant();
          }
        } else if (eventName.startsWith("subagent_")) {
          collaboration.apply(data as SubagentEvent);
          updateAssistant();
        } else if (eventName === "usage") {
          const usageEvent = data as { credits?: number; refunded?: number; available?: number };
          if (typeof usageEvent.credits === "number") {
            runUsage.credits += usageEvent.credits;
            if (usageEvent.credits > 0) runUsage.steps += 1;
          }
          if (typeof usageEvent.refunded === "number" && usageEvent.refunded > 0) {
            runUsage.refunded += usageEvent.refunded;
            runUsage.credits = Math.max(0, runUsage.credits - usageEvent.refunded);
          }
          if (typeof usageEvent.available === "number") runUsage.available = usageEvent.available;
        } else if (eventName === "error") {
          const errorEvent = data as { error?: string; code?: string };
          if (errorEvent.code === "AUTH_REQUIRED") authenticationRequired = true;
          if (errorEvent.code === "INSUFFICIENT_CREDITS") {
            insufficientCredits = true;
            runUsage.available = 0;
          }
          streamErrorCode = errorEvent.code;
          streamError = errorEvent.error && !isTechnicalAgentErrorMessage(errorEvent.error)
            ? errorEvent.error
            : agentUnexpectedFailureMessage(locale);
        } else if (eventName === "done") {
          sawDone = true;
          const { outcome } = data as { outcome?: unknown };
          if (isAgentChatOutcome(outcome)) terminalOutcome = outcome;
        }
      });

      if (authenticationRequired) {
        restoreUnauthenticatedPrompt();
        return;
      }

      if (activeRunRef.current !== runId) return;
      // A stream that ends without a result or an error was cut off mid-run.
      const interrupted = !sawDone && !streamError;
      assistantText = interrupted
        ? [assistantText, agentStreamInterruptedMessage(locale)].filter(Boolean).join("\n\n")
        : resolveAgentTerminalContent({
            assistantText,
            streamError,
            outcome: terminalOutcome,
            hasPendingConfirmation: toolEvents.some((tool) => isPendingAgentConfirmation(tool.result)),
            fallback
          });
      terminalFlags = {
        retryable: interrupted || isRetryableAgentErrorCode(streamErrorCode),
        continuable: streamErrorCode === AGENT_MAX_TURNS_ERROR_CODE
      };
      updateAssistant(false);
      if (!streamError && !interrupted) playTaskCompleteSound();
      runFinishedNormally = !insufficientCredits;
      void loadSessions();
    } catch (error) {
      if (activeRunRef.current === runId) {
        // Network failures surface as raw browser text ("Failed to fetch");
        // show the product message and keep the turn retryable.
        const rawMessage = error instanceof Error ? error.message : "";
        const failure = rawMessage && !isTechnicalAgentErrorMessage(rawMessage)
          ? rawMessage
          : agentUnexpectedFailureMessage(locale);
        assistantText = assistantText ? `${assistantText}\n\n${failure}` : failure;
        terminalFlags = { retryable: true, continuable: false };
        updateAssistant(false);
      }
    } finally {
      endActiveAgentRun(activeRunToken);
      if (controller && abortRef.current === controller) abortRef.current = null;
      if (activeRunRef.current === runId) {
        setSending(false);
        sendingRef.current = false;
        // Queued messages start only after a run that actually finished; a
        // stop or a conversation switch bumps the run id first.
        if (runFinishedNormally && !authenticationRequired) pumpQueuedTasks();
      }
    }

    function restoreUnauthenticatedPrompt() {
      authenticationRequired = true;
      setAuthExpired(true);
      setInput(message);
      setPendingAttachments(attachments);
      setMessages((current) => current.filter((item, index) => !(index === current.length - 1 && item.role === "assistant" && item.pending)));
    }
  }

  if (isFullAgentPage) return null;
  const displayMessages = messages.map((message) => ({
    ...message,
    ...(message.toolEvents
      ? { toolEvents: collapseAgentToolEventsForDisplay(message.toolEvents) }
      : {})
  }));

  return (
    <>
      {!accountHealthOwnsAgentEntry && !hideLauncher ? <button
        type="button"
        onClick={() => openRail("launcher")}
        className="workspace-agent-launcher focus-ring group fixed bottom-[calc(8.5rem+env(safe-area-inset-bottom))] right-3 z-40 flex items-center gap-2 rounded-full border border-action/55 bg-action px-3.5 py-2.5 text-sm font-bold text-on-action shadow-[0_16px_44px_rgb(var(--action)/0.26)] transition hover:-translate-y-0.5 hover:bg-action-strong lg:bottom-20 lg:right-6"
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <Sparkles className="h-4 w-4 transition-transform group-hover:rotate-6" />
        <span>{copy.launcher}</span>
      </button> : null}

      <AnimatePresence>
        {open ? (
          <motion.aside
            role="dialog"
            aria-label={copy.title}
            aria-modal="false"
            aria-busy={sending}
            initial={{ opacity: 0, x: 28, y: 8, scale: 0.98 }}
            animate={{ opacity: 1, x: 0, y: 0, scale: 1 }}
            exit={{ opacity: 0, x: 22, y: 8, scale: 0.98 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            className={`fixed inset-x-2 bottom-[calc(5.25rem+env(safe-area-inset-bottom))] top-14 z-[90] flex min-h-0 flex-col overflow-hidden rounded-[24px] border bg-surface/98 text-fg backdrop-blur-2xl transition-[border-color,box-shadow] duration-500 sm:left-auto sm:right-4 sm:top-16 sm:w-[430px] lg:bottom-5 lg:right-6 lg:top-5 ${sending
              ? "border-action/35 shadow-[0_24px_80px_rgb(0_0_0/0.3),0_0_46px_rgb(var(--action)/0.1)]"
              : "border-hairline shadow-[0_24px_80px_rgb(0_0_0/0.28)]"}`}
          >
            <header className="shrink-0 border-b border-hairline bg-surface/92 px-4 pb-3 pt-4">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-action/[0.11] text-action-strong dark:text-action">
                  <Bot className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h2 className="text-sm font-extrabold tracking-tight text-fg">{copy.title}</h2>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="focus-ring relative inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-hairline bg-surface-2/80 text-fg-muted transition after:absolute after:-inset-1.5 after:content-[''] hover:border-action/35 hover:bg-action/[0.07] hover:text-action-strong dark:hover:text-action"
                  aria-label={copy.close}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="mt-3 flex items-center justify-between gap-2">
                <span className="inline-flex min-w-0 items-center gap-1.5 rounded-full border border-hairline bg-surface-2/75 px-2.5 py-1 text-[11px] font-semibold text-fg-muted">
                  <span className="h-1.5 w-1.5 rounded-full bg-positive" />
                  {copy.viewing}: {locale === "en" ? context.labelEn : context.labelZh}
                </span>
                <div className="flex items-center gap-1">
                  <button type="button" onClick={resetConversation} className="focus-ring inline-flex h-8 w-8 items-center justify-center rounded-lg text-fg-muted transition hover:bg-surface-2 hover:text-fg" title={copy.newChat} aria-label={copy.newChat}>
                    <Plus className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={toggleHistory}
                    className={`focus-ring inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-semibold transition ${historyOpen ? "bg-surface-2 text-fg" : "text-fg-muted hover:bg-surface-2 hover:text-fg"}`}
                    aria-expanded={historyOpen}
                    aria-label={copy.history}
                  >
                    <History className="h-3.5 w-3.5" />
                    <span>{copy.history}</span>
                  </button>
                  <Link href="/dashboard" onClick={() => setOpen(false)} className="focus-ring inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-semibold text-fg-muted transition hover:bg-surface-2 hover:text-fg">
                    <Expand className="h-3.5 w-3.5" />
                    {copy.full}
                  </Link>
                </div>
              </div>
            </header>

            <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4">
              {historyOpen ? (
                <AgentSessionHistory
                  sessions={sessions}
                  currentSessionId={sessionId}
                  locale={locale}
                  loading={historyLoading}
                  onSelect={selectSession}
                  onDelete={deleteSession}
                />
              ) : null}

              {!historyOpen ? <>
              {messages.length === 0 ? (
                <div className="px-1 py-4">
                  <p className="text-sm leading-6 text-fg">{copy.greeting}</p>
                  <div className="mt-3 grid gap-2">
                    {suggestions.map((suggestion) => (
                      <button
                        key={suggestion}
                        type="button"
                        onClick={() => {
                          openRail("suggestion");
                          void sendMessage(undefined, suggestion);
                        }}
                        className="focus-ring rounded-xl border border-hairline bg-surface px-3 py-2.5 text-left text-xs font-semibold leading-5 text-fg transition hover:border-action/35 hover:bg-action/[0.04]"
                      >
                        {suggestion}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              {displayMessages.map((message, index) => (
                <div key={`${message.role}-${index}`} className={`group/msg ${message.role === "user" ? "ml-auto max-w-[84%]" : "max-w-[94%]"}`}>
                  <div className={message.role === "user"
                    ? "rounded-2xl bg-surface-2 px-3.5 py-2.5 text-sm leading-6 text-fg"
                    : "px-1 py-3 text-sm leading-6 text-fg"}
                  >
                    {message.attachments?.length ? (
                      <div className="mb-2 flex flex-wrap gap-1.5">
                        {message.attachments.map((attachment) => (
                          <span key={attachment.id} className="max-w-full truncate rounded-lg border border-current/15 bg-black/[0.05] px-2 py-1 text-[10px] font-semibold opacity-85">
                            {attachment.name}
                          </span>
                        ))}
                      </div>
                    ) : null}
                    {message.statusEvents?.length || message.toolEvents?.length ? (
                      <AgentThinkingTrace
                        events={message.statusEvents ?? []}
                        active={Boolean(message.pending)}
                        locale={locale}
                        steps={message.toolEvents}
                      />
                    ) : null}
                    {message.collaboration || message.toolEvents?.length ? (
                      <details className="mb-2 text-fg-muted">
                        <summary className="focus-ring cursor-pointer rounded-lg py-2 text-xs">{locale === "zh" ? "工作详情" : "Work details"}</summary>
                        {message.collaboration ? <AgentCollaborationStrip view={message.collaboration} locale={locale} /> : null}
                        {message.toolEvents?.length ? <TaskProgress events={message.toolEvents} locale={locale} /> : null}
                      </details>
                    ) : null}
                    {message.evidence?.length ? (
                      <div className="mb-2 space-y-2">
                        {message.evidence.map((item) => (
                          <EvidenceCard key={item.id} evidence={item} locale={locale} />
                        ))}
                      </div>
                    ) : null}
                    {message.content ? (
                      message.role === "assistant"
                        ? <AgentMessageContent content={message.content} compact />
                        : <p dir="auto" className="whitespace-pre-wrap text-start">{message.content}</p>
                    ) : null}
                    {message.retry ? (
                      <button
                        type="button"
                        onClick={() => void sendMessage(
                          undefined,
                          message.retry!.message,
                          message.retry!.attachments
                        )}
                        disabled={sending}
                        className="focus-ring mt-3 inline-flex items-center gap-1.5 rounded-full border border-action/35 bg-action/[0.1] px-3 py-1.5 text-xs font-bold text-action-strong transition hover:bg-action/[0.16] disabled:opacity-50 dark:text-action"
                      >
                        <RefreshCw className="h-3.5 w-3.5" />
                        {locale === "zh"
                          ? (message.retry.attachments.length ? "重试本轮（保留附件）" : "重试本轮")
                          : (message.retry.attachments.length ? "Retry with attachments" : "Retry this turn")}
                      </button>
                    ) : null}
                    {message.toolEvents?.map((tool, toolIndex) => {
                      if (tool.name === "inspect_xhs_workflow") return null;
                      const result = tool.result && typeof tool.result === "object"
                        ? tool.result as Record<string, unknown>
                        : null;
                      if (!result) return null;
                      if (tool.name === "ask_user") {
                        const askUser = parseAskUserResult(result);
                        if (askUser) {
                          return (
                            <AgentQuestionCard
                              key={`${tool.name}-ask-${toolIndex}`}
                              questions={askUser.questions}
                              locale={locale}
                              interactive={!displayMessages.slice(index + 1).some((later) => later.role === "user")
                                && !sending}
                              onAnswer={(answer) => void sendMessage(undefined, answer)}
                            />
                          );
                        }
                      }
                      if (tool.name === "rewrite_text" && typeof result.rewritten === "string" && result.rewritten.trim()) {
                        return (
                          <RewriteResultCard
                            key={`${tool.name}-rewrite-${toolIndex}`}
                            text={result.rewritten}
                            locale={locale}
                            demoMode={previewMode}
                          />
                        );
                      }
                      const accountInvestigation = tool.name === "investigate_social_account"
                        && result.investigation
                        && typeof result.investigation === "object"
                        ? result.investigation as AccountInvestigation
                        : null;
                      if (accountInvestigation) {
                        return isV2Report(accountInvestigation.report) ? (
                          <ReportRenderer
                            key={`${tool.name}-report-v2-${toolIndex}`}
                            investigation={accountInvestigation}
                            locale={locale}
                            evidence={message.evidence ?? []}
                            fullAccess={reportFullAccess}
                            onAskAgent={(prompt) => void sendMessage(undefined, prompt)}
                          />
                        ) : (
                          <AccountInvestigationReportCard
                            key={`${tool.name}-report-${toolIndex}`}
                            investigation={accountInvestigation}
                            locale={locale}
                            variant="surface"
                            compact
                            onAskAgent={(prompt) => void sendMessage(undefined, prompt)}
                          />
                        );
                      }
                      const creatorStyleProfile = "creatorStyleProfile" in result
                        ? creatorStyleProfileSchema.safeParse(result.creatorStyleProfile)
                        : null;
                      if (creatorStyleProfile?.success) {
                        return (
                          <CreatorStyleProfileCard
                            key={`${tool.name}-creator-style-${toolIndex}`}
                            profile={creatorStyleProfile.data}
                            locale={locale}
                            variant="surface"
                            compact
                            onAskAgent={(prompt) => void sendMessage(undefined, prompt)}
                          />
                        );
                      }
                      // XHS pending actions use their own durable workflow
                      // endpoint and card. Handle them before the generic
                      // mutation card so confirmation can advance the stage
                      // and expose the Workbench handoff in-place.
                      if ("xhsCard" in result) {
                        return (
                          <XhsToolResultCard
                            key={`${tool.name}-result-${toolIndex}`}
                            result={result}
                            locale={locale}
                            runPending={Boolean(message.pending)}
                            demoMode={previewMode}
                          />
                        );
                      }
                      if (result.pendingAction && typeof result.pendingAction === "object") {
                        return (
                          <PendingAgentMutationCard
                            key={`${tool.name}-pending-${toolIndex}`}
                            result={result}
                            locale={locale}
                          />
                        );
                      }
                      return null;
                    })}
                    {message.pending && !message.content && !message.toolEvents?.length && !message.statusEvents?.length ? (
                      <span className="inline-flex items-center gap-2 text-fg-muted">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        {copy.thinking}
                      </span>
                    ) : null}
                    {message.paused ? (
                      <button
                        type="button"
                        onClick={() => void sendMessage(undefined, copy.resumePrompt)}
                        className="focus-ring mt-3 inline-flex items-center gap-1.5 rounded-full border border-action/30 bg-action/[0.08] px-3 py-1.5 text-xs font-bold text-action-strong transition hover:bg-action/[0.14] dark:text-action"
                      >
                        <ArrowUp className="h-3.5 w-3.5" />
                        {copy.resume}
                      </button>
                    ) : null}
                    {message.usage ? (
                      <AgentRunUsageHint usage={message.usage} locale={locale} revealOnMessageHover />
                    ) : null}
                  </div>
                </div>
              ))}
              </> : null}
            </div>

            <div className="shrink-0 border-t border-hairline bg-surface/95 p-3">
              {needsLogin ? (
                <div className="mb-3 rounded-xl border border-hairline bg-surface-2 p-3 text-sm" role="status">
                  <p>{locale === "en" ? "Sign in to use Finfold Agent." : "登录后即可使用 Finfold智能体。"}</p>
                  {loginDraftError ? <p className="mt-1 text-xs text-risk">{locale === "en" ? "Your browser could not save this question. Copy it before signing in." : "浏览器暂时无法保存问题，请先复制备份再登录。"}</p> : null}
                  <Link href={loginHref} onClick={(event) => {
                    event.preventDefault();
                    if (!saveAgentLoginDraft(pathname, input) && !loginDraftError) { setLoginDraftError(true); return; }
                    const returnTo = requestWorkbenchAuthReturnTo(`${window.location.pathname}${window.location.search}${window.location.hash}`);
                    if (returnTo) router.push(buildAuthHref("/login", returnTo));
                  }} className="focus-ring mt-2 inline-flex min-h-10 items-center rounded-lg bg-action px-3 font-semibold text-on-brand">
                    {loginDraftError ? (locale === "en" ? "Sign in after copying" : "已复制，继续登录") : (locale === "en" ? "Sign in and keep my question" : "登录并保留问题")}
                  </Link>
                </div>
              ) : null}
              {queuedTasks.length > 0 ? (
                <div className="mb-2">
                  <AgentQueuedTasks locale={locale} items={queuedTasks} onDiscard={discardQueuedTask} />
                </div>
              ) : null}
              <AgentComposer
                locale={locale}
                value={input}
                onChange={setInput}
                onSubmit={() => void sendMessage()}
                sending={sending}
                onStop={stopAgent}
                depth={depth}
                onDepthChange={(next) => {
                  setDepth(next);
                  writeStoredAgentDepth(next);
                }}
                attachments={pendingAttachments}
                onFiles={(files) => void uploadAttachments(files)}
                onRemoveAttachment={(index) => setPendingAttachments((current) => current.filter((_, itemIndex) => itemIndex !== index))}
                uploading={uploading}
                placeholder={sending ? copy.steerPlaceholder : copy.placeholder}
                textareaRef={inputRef}
                compact
              />
            </div>
          </motion.aside>
        ) : null}
      </AnimatePresence>
    </>
  );
}

function mapStoredMessages(
  rows: Array<{ role?: string; content?: unknown }>,
  locale: "zh" | "en",
  stoppedNote: string
): RailMessage[] {
  const mapped: RailMessage[] = [];
  for (const row of rows) {
    if (row.role !== "user" && row.role !== "assistant") continue;
    const content = row.content && typeof row.content === "object" && !Array.isArray(row.content)
      ? row.content as {
          text?: string;
          error?: string;
          errorCode?: string;
          toolCalls?: Array<{ name?: string; args?: Record<string, unknown> }>;
          toolResults?: Array<{ name?: string; result?: unknown }>;
          attachments?: AgentAttachment[];
          work?: unknown;
        }
      : {};
    const toolEvents = row.role === "assistant"
      ? collapseAgentToolEventsForDisplay((content.toolCalls ?? []).flatMap((call, index): ToolEvent[] => call.name ? [{
          name: call.name,
          args: call.args,
          result: content.toolResults?.[index]?.result,
          completed: true
        }] : []))
      : undefined;
    const previous = mapped.at(-1);
    const stopped = row.role === "assistant" && workRecordOutcome(content.work) === "paused";
    const continuable = stopped || (row.role === "assistant" && content.errorCode === AGENT_MAX_TURNS_ERROR_CODE);
    const storedText = normalizeAgentTextContent(content.text);
    const restoredCollaboration = row.role === "assistant"
      ? collaborationFromWorkRecord(content.work)
      : undefined;
    const storedRunMeta = row.role === "assistant"
      ? workRecordRunMeta(content.work)
      : null;
    const retryable = row.role === "assistant" && isRetryableStoredAgentError(content) && previous?.role === "user";
    mapped.push({
      role: row.role,
      content: stopped
        ? (storedText ? `${storedText}\n\n${stoppedNote}` : stoppedNote)
        : storedText || safeStoredAgentErrorMessage(content, locale),
      ...(continuable ? { paused: true } : {}),
      ...(toolEvents?.length ? { toolEvents } : {}),
      ...(restoredCollaboration ? { collaboration: restoredCollaboration } : {}),
      ...(content.attachments?.length ? { attachments: content.attachments } : {}),
      ...(storedRunMeta ? {
        usage: {
          ...storedRunMeta.usage,
          startedAtMs: storedRunMeta.startedAtMs,
          durationMs: storedRunMeta.durationMs
        }
      } : {}),
      ...(retryable ? {
        retry: {
          message: previous.content,
          attachments: previous.attachments ?? []
        }
      } : {})
    });
  }
  const incompleteUserTurn = mapped.at(-1);
  if (incompleteUserTurn?.role === "user") {
    mapped.push({
      role: "assistant",
      content: incompleteAgentTurnMessage(locale),
      retry: {
        message: incompleteUserTurn.content,
        attachments: incompleteUserTurn.attachments ?? []
      }
    });
  }
  return mapped;
}
