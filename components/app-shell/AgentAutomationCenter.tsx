"use client";

import React from "react";
import type { DragEvent, FormEvent } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import {
  Activity,
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  Bot,
  FileSpreadsheet,
  FileStack,
  History,
  Loader2,
  Plus,
  RefreshCw,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Target,
  Upload,
  Wrench,
  X
} from "@/components/ui/icons";
import { AgentComposer } from "@/components/app-shell/AgentComposer";
import { OpportunityRadarPreview } from "@/components/app-shell/OpportunityRadarPreview";
import { AgentQueuedTasks } from "@/components/app-shell/AgentQueuedTasks";
import { AgentQuestionCard } from "@/components/app-shell/AgentQuestionCard";
import { PendingAgentMutationCard } from "@/components/app-shell/PendingAgentMutationCard";
import { AgentMessageContent } from "@/components/app-shell/AgentMessageContent";
import { AgentSessionHistory, type AgentSessionSummary } from "@/components/app-shell/AgentSessionHistory";
import { AgentThinkingTrace, getAgentStatusLabel } from "@/components/app-shell/AgentThinkingTrace";
import {
  AgentWorkPanel,
  type AgentWorkStep
} from "@/components/app-shell/AgentWorkPanel";
import { AccountInvestigationReportCard } from "@/components/app-shell/AccountInvestigationReportCard";
import { CreatorStyleProfileCard } from "@/components/app-shell/CreatorStyleProfileCard";
import { FishLogo } from "@/components/app-shell/FishLogo";
import { addToast } from "@/components/ui/Toast";
import { useLocale } from "@/hooks/useLocale";
import { playTaskCompleteSound } from "@/lib/completion-sound";
import { consumeSSEStream } from "@/lib/sse-client";
import { AgentRunUsageHint, type AgentRunUsage } from "@/components/app-shell/AgentRunUsageHint";
import {
  isAcceptedAgentAttachmentFile,
  type AgentAttachment
} from "@/lib/agent/attachments";
import { readStoredAgentDepth, writeStoredAgentDepth, type AgentDepth } from "@/lib/agent/depth";
import {
  isAgentChatOutcome,
  isPendingAgentConfirmation,
  pendingAgentConfirmationId,
  resolveAgentTerminalContent,
  type AgentChatOutcome
} from "@/lib/agent/chat-outcome";
import type { GrowthBriefing } from "@/lib/agent/growth-briefing";
import type { GrowthMission } from "@/lib/agent/growth-missions";
import type { XhsWorkflowState } from "@/lib/agent/xhs-workflow";
import { XhsToolResultCard } from "@/components/app-shell/XhsAgentWorkflowCard";
import {
  collapseAgentToolEventsForDisplay,
  getAgentToolLabel
} from "@/lib/agent/presentation";
import type { MemoryGovernanceReport } from "@/lib/memory-governance";
import type { AccountInvestigation } from "@/lib/agent/account-investigation";
import { creatorStyleProfileSchema } from "@/lib/agent/style-profile-schema";
import {
  advanceAgentStatus,
  completeAgentStatuses,
  isAgentStatusStage,
  type AgentStatusEvent
} from "@/lib/agent/status";
import { parseAgentWorkRecord, workRecordOutcome, workRecordRunMeta, workRecordStatusEvents } from "@/lib/agent/work-record";
import {
  collaborationFromWorkRecord,
  createCollaborationViewState,
  type CollaborationViewState
} from "@/lib/agent/collaboration-ui";
import type { SubagentEvent } from "@/lib/agent/subagents";
import {
  AGENT_MAX_TURNS_ERROR_CODE,
  AGENT_SESSION_BUSY_CODE,
  agentStreamInterruptedMessage,
  agentUnexpectedFailureMessage,
  incompleteAgentTurnMessage,
  isRetryableAgentErrorCode,
  isRetryableStoredAgentError,
  isTechnicalAgentErrorMessage,
  safeStoredAgentErrorMessage
} from "@/lib/agent/provider-errors";
import {
  findActiveAgentRun,
  getActiveAgentRun,
  subscribeActiveAgentRuns,
  type ActiveAgentRun
} from "@/lib/agent/active-runs";
import { buildAuthHref } from "@/lib/auth-return";
import { FIRST_TASK_ENTRY } from "@/lib/first-task";
import { useOptionalWorkbench } from "@/components/workbench/WorkbenchProvider";
import { parseAskUserResult } from "@/lib/agent/ask-user";
import {
  clearLastAgentSession,
  readLastAgentSessionId,
  rememberLastAgentSession
} from "@/lib/agent/session-restore";
import { normalizeAgentTextContent } from "@/lib/agent/text-content";
import { buildOpportunityAgentPrompt } from "@/lib/trends/display";

type ToolEvent = { name: string; args?: Record<string, unknown>; result?: unknown };

type ChatMessage = {
  role: "assistant" | "user";
  content: string;
  images?: string[];
  attachments?: AgentAttachment[];
  dataFiles?: string[];
  dataImportIds?: string[];
  toolEvents?: ToolEvent[];
  statusEvents?: AgentStatusEvent[];
  collaboration?: CollaborationViewState;
  durationMs?: number;
  outcome?: AgentChatOutcome;
  pending?: boolean;
  paused?: boolean;
  /** A run started in the side rail is still streaming into this session. */
  runningElsewhere?: boolean;
  /** The sign-in expired; the message offers a login link instead of retry. */
  authRequired?: boolean;
  usage?: AgentRunUsage;
  retry?: {
    message: string;
    attachments: AgentAttachment[];
    dataImports: PendingDataImport[];
  };
};

type AgentSession = { id: string; title: string; updated_at: string };

// A run in another tab or device is followed by polling its session until
// the server clears the in-progress marker.
const REMOTE_RUN_POLL_MS = 4_000;
const REMOTE_RUN_POLL_MAX_MS = 20_000;
type PendingDataImport = { id: string; name: string; rowCount: number };
type QueuedCenterTask = {
  id: number;
  message: string;
  attachments: AgentAttachment[];
  dataImports: PendingDataImport[];
};

export function AgentAutomationCenter({
  initialIntent,
  initialPrompt
}: {
  initialIntent?: "research";
  initialPrompt?: string;
}) {
  const locale = useLocale();

  const copy = locale === "en" ? {
    title: "Finfold Agent",
    heroTitle: "What would you like to make happen?",
    firstTaskTitle: "Make your first publishing draft",
    firstTaskDesc: "Paste a product update, pick two platforms, and get two ready-to-use drafts in a few minutes.",
    firstTaskAction: "Start",
    placeholder: "For example: diagnose my account and tell me the next move",
    steerPlaceholder: "Type a new task — it runs after the current one",
    send: "Send",
    paused: "Stopped.",
    resume: "Continue this task",
    resumePrompt: "Continue the task I stopped — don't redo the steps already finished.",
    runningElsewhere: "This task is still running. The result will appear here when it's done.",
    authRequired: "Your sign-in has expired. Sign in again to continue — your message is kept in the input box.",
    signIn: "Sign in to continue",
    restoring: "Restoring conversation",
    thinking: "Thinking...",
    fallback: "The agent could not reply. Please try again.",
    memory: "Brand Memory",
    rules: "Brand Rules",
    contextTitle: "Context",
    contextDesc: "Finfold references this automatically when it helps. You do not need to repeat it in every chat.",
    contextScope: "Positioning · voice and examples · words to avoid",
    memoryDesc: "Positioning, audience, and voice",
    rulesDesc: "Words to avoid and publishing boundaries",
    openContext: "Context",
    attachHint: "Drop to add files",
    dropTitle: "Drop files anywhere to add them to this chat",
    dropDesc: "Add an image, document, or data file.",
    imageOnly: "Use an image, video, PDF, Office document, text file, CSV, or XLSX file.",
    uploadFail: "Upload failed.",
    newChat: "New chat",
    history: "History",
    workPanel: "Work",
  } : {
    title: "Finfold智能体",
    heroTitle: "今天想做什么？",
    firstTaskTitle: "先做第一份发布稿",
    firstTaskDesc: "贴一段产品更新，选两个平台，几分钟拿到可以直接用的两份稿子。",
    firstTaskAction: "开始",
    placeholder: "例如：分析我的账号，告诉我下一步",
    steerPlaceholder: "输入新任务，当前完成后执行",
    send: "发送",
    paused: "已停止。",
    resume: "继续这个任务",
    resumePrompt: "继续刚才停止的任务，已完成的步骤不用重做。",
    runningElsewhere: "这个任务还在进行，完成后结果会显示在这里。",
    authRequired: "登录已失效，重新登录后继续。刚才的消息已放回输入框。",
    signIn: "登录后继续",
    restoring: "正在恢复对话",
    thinking: "思考中...",
    fallback: "Finfold智能体暂时无法回复，请重试。",
    memory: "品牌记忆",
    rules: "品牌规则",
    contextTitle: "上下文",
    contextDesc: "生成和诊断时自动参考，无需每次重复提供。",
    contextScope: "产品定位 · 语气与示例 · 禁用表达",
    memoryDesc: "定位、受众和语气",
    rulesDesc: "禁用表达和发布边界",
    openContext: "上下文",
    attachHint: "松开以上传附件",
    dropTitle: "松开文件，添加到这段对话",
    dropDesc: "添加图片、文档或数据文件。",
    imageOnly: "支持图片、视频、PDF、Office 文档、文本、CSV 和 XLSX 文件。",
    uploadFail: "上传失败。",
    newChat: "新对话",
    history: "历史会话",
    workPanel: "工作",
  };

  const [chatInput, setChatInput] = useState("");
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatSending, setChatSending] = useState(false);
  // Thinking depth rides on every chat request; hydrate from storage after
  // mount so SSR markup and the stored preference never mismatch.
  const [agentDepth, setAgentDepth] = useState<AgentDepth>("low");
  useEffect(() => {
    setAgentDepth(readStoredAgentDepth());
  }, []);
  const [chatQueuedTasks, setChatQueuedTasks] = useState<QueuedCenterTask[]>([]);
  const [pendingAttachments, setPendingAttachments] = useState<AgentAttachment[]>([]);
  const [pendingDataImports, setPendingDataImports] = useState<PendingDataImport[]>([]);
  const [isUploadingAttachment, setIsUploadingAttachment] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const dragDepth = useRef(0);
  // 拖到输入框上的 drop 会先被 AgentComposer 处理、再冒泡到本页面的
  // onDrop 各调一次 handleFiles，且两次拿到的是同一个 FileList 引用。
  const lastHandledFilesRef = useRef<FileList | File[] | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  // Queued follow-ups are sent from the previous send's closure, which still
  // sees the pre-session state; read the live id so they join the same chat.
  const sessionIdRef = useRef(sessionId);
  sessionIdRef.current = sessionId;
  const [sessions, setSessions] = useState<AgentSession[]>([]);
  const [sessionsLoaded, setSessionsLoaded] = useState(false);
  // The dashboard provider already loads the content library; reuse it.
  const workbench = useOptionalWorkbench();
  const [historyOpen, setHistoryOpen] = useState(false);
  const [xhsState, setXhsState] = useState<XhsWorkflowState | null>(null);
  const [workPanelOpen, setWorkPanelOpen] = useState(false);
  const [pendingActionStatuses, setPendingActionStatuses] = useState<Record<string, "pending" | "executed" | "reverted">>({});
  const handleXhsActionStatusChanged = useCallback((pendingActionId: string, status: "pending" | "executed" | "reverted") => {
    setPendingActionStatuses((current) => current[pendingActionId] === status
      ? current
      : { ...current, [pendingActionId]: status });
  }, []);
  // 右侧上下文抽屉默认收起：避免挤压 chat，需要时点"上下文"展开。
  const [contextOpen, setContextOpen] = useState(false);
  const chatAbortRef = useRef<AbortController | null>(null);
  const activeChatRunRef = useRef(0);
  const chatQueuedTasksRef = useRef<QueuedCenterTask[]>([]);
  const chatQueuedTaskSeqRef = useRef(0);
  // Mirror of `chatSending` that stays current across the synchronous
  // finish-then-pump-queue chain, where the state closure would still see the
  // previous render's value.
  const chatSendingRef = useRef(false);
  const initialIntentAppliedRef = useRef(false);
  const contextTriggerRef = useRef<HTMLButtonElement | null>(null);
  const contextDrawerRef = useRef<HTMLElement | null>(null);
  const contextCloseRef = useRef<HTMLButtonElement | null>(null);
  const workPanelTriggerRef = useRef<HTMLButtonElement | null>(null);
  const workPanelDrawerRef = useRef<HTMLDivElement | null>(null);
  const workPanelCloseRef = useRef<HTMLButtonElement | null>(null);
  // Until the last conversation is restored the composer and starters stay
  // hidden, so a quick click cannot start a run that the restore then
  // overwrites. Arriving with an explicit task skips the restore entirely.
  const [restoringSession, setRestoringSession] = useState(!initialIntent && !initialPrompt);
  // Queued sends run from an earlier render's closure; read the live value.
  const restoringSessionRef = useRef(restoringSession);
  restoringSessionRef.current = restoringSession;
  // A run started in the side rail that is still streaming into the session
  // shown here. While set, this page shows the work as in progress (never a
  // retry) and queues new messages until the run ends.
  const externalRunRef = useRef<{ token: number; sessionId: string | null; stopped: boolean } | null>(null);
  const [externalRunToken, setExternalRunToken] = useState<number | null>(null);
  // The same for a run in another tab or device, known from the server's
  // in-progress marker on the session: the session id being followed.
  const remoteRunRef = useRef<string | null>(null);
  const [remoteRunSessionId, setRemoteRunSessionId] = useState<string | null>(null);
  const messageLogRef = useRef<HTMLDivElement | null>(null);
  const followLogBottomRef = useRef(true);
  const forceLogBottomRef = useRef(false);

  useEffect(() => {
    if (initialIntentAppliedRef.current) return;
    if (!initialPrompt && initialIntent !== "research") return;
    initialIntentAppliedRef.current = true;
    setChatInput(initialPrompt || (locale === "en"
      ? "Use real evidence to analyze a category or competitor opportunity. Ask me for the minimum missing inputs first."
      : "请用真实证据帮我分析一个品类或竞品机会。先问我最少需要补充哪些资料。"));
    // The task is now in the composer. Drop it from the URL so a refresh
    // restores the conversation instead of refilling the same prompt.
    try {
      const url = new URL(window.location.href);
      if (url.searchParams.has("prompt") || url.searchParams.has("intent")) {
        url.searchParams.delete("prompt");
        url.searchParams.delete("intent");
        window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
      }
    } catch {
      // URL cleanup is cosmetic; the prompt is already in the composer.
    }
  }, [initialIntent, initialPrompt, locale]);

  // Restore the latest conversation once on mount so returning from another
  // product surface lands back in the ongoing chat instead of a blank state.
  // A run still streaming from the side rail takes precedence: expanding the
  // rail mid-run lands on that run, shown as in progress.
  useEffect(() => {
    if (initialIntent || initialPrompt) return;
    let cancelled = false;
    const externalRun = findActiveAgentRun();
    if (externalRun && !externalRun.sessionId) {
      setChatMessages([
        { role: "user", content: externalRun.message },
        runningElsewherePlaceholder()
      ]);
      attachExternalRun(externalRun);
      setRestoringSession(false);
      return;
    }
    const storedId = externalRun?.sessionId ?? readLastAgentSessionId();
    if (!storedId) {
      setRestoringSession(false);
      return;
    }
    void loadSession(storedId, { restore: true })
      .then((result) => {
        if (!cancelled && result === "missing") clearLastAgentSession();
      })
      .finally(() => {
        if (!cancelled) setRestoringSession(false);
      });
    return () => {
      cancelled = true;
    };
    // Runs once per mount; loadSession is defined in this component scope.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Follow a rail run until it ends, then load what it saved and start any
  // message queued here in the meantime.
  useEffect(() => {
    if (externalRunToken === null) return;
    const sync = () => {
      const tracked = externalRunRef.current;
      if (!tracked || tracked.token !== externalRunToken) return;
      const run = getActiveAgentRun(tracked.token);
      if (run) {
        if (run.sessionId && run.sessionId !== tracked.sessionId) {
          tracked.sessionId = run.sessionId;
          sessionIdRef.current = run.sessionId;
          setSessionId(run.sessionId);
        }
        return;
      }
      externalRunRef.current = null;
      setExternalRunToken(null);
      if (tracked.stopped || !tracked.sessionId) return;
      void loadSession(tracked.sessionId, { keepQueue: true }).then((result) => {
        if (result === "loaded") pumpChatQueuedTasks();
      });
    };
    sync();
    return subscribeActiveAgentRuns(sync);
    // loadSession/pumpChatQueuedTasks read live refs; re-subscribing per render
    // is unnecessary.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalRunToken]);

  // Follow a run in another tab or device: poll its session (backing off,
  // paused while this tab is hidden) until the marker clears, then load what
  // it saved and start any message queued here in the meantime.
  useEffect(() => {
    const followedId = remoteRunSessionId;
    if (!followedId) return;
    let cancelled = false;
    let inFlight = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let delay = REMOTE_RUN_POLL_MS;
    const following = () => !cancelled && remoteRunRef.current === followedId;
    const isHidden = () => typeof document !== "undefined" && document.visibilityState === "hidden";
    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = null;
      if (following() && !isHidden()) timer = setTimeout(() => void poll(), delay);
    };
    const poll = async () => {
      timer = null;
      if (!following() || inFlight) return;
      inFlight = true;
      let finished = false;
      try {
        const response = await fetch(`/api/agent/sessions/${encodeURIComponent(followedId)}`, { cache: "no-store" });
        if (response.ok) {
          const data = (await response.json().catch(() => ({}))) as { activeRun?: unknown };
          finished = !data.activeRun;
        } else if (response.status === 404) {
          finished = true;
        }
      } catch {
        // Keep following; the next poll retries.
      } finally {
        inFlight = false;
      }
      if (!following()) return;
      if (finished) {
        remoteRunRef.current = null;
        setRemoteRunSessionId(null);
        void loadSession(followedId, { keepQueue: true }).then((result) => {
          if (result === "loaded" && !remoteRunRef.current) pumpChatQueuedTasks();
        });
        return;
      }
      delay = Math.min(Math.round(delay * 1.5), REMOTE_RUN_POLL_MAX_MS);
      schedule();
    };
    const handleVisibility = () => {
      if (isHidden()) {
        if (timer) clearTimeout(timer);
        timer = null;
      } else if (!timer && !inFlight) {
        // Coming back: check right away, then resume the normal pace.
        delay = REMOTE_RUN_POLL_MS;
        void poll();
      }
    };
    schedule();
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
    // loadSession/pumpChatQueuedTasks read live refs; re-subscribing per render
    // is unnecessary.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remoteRunSessionId]);

  // Keep the newest message in view while the reader is at (or near) the
  // bottom; a session switch or a new send always jumps to the bottom.
  useEffect(() => {
    const log = messageLogRef.current;
    if (!log) return;
    if (forceLogBottomRef.current || followLogBottomRef.current) {
      log.scrollTop = log.scrollHeight;
      forceLogBottomRef.current = false;
      followLogBottomRef.current = true;
    }
  }, [chatMessages]);

  function handleMessageLogScroll() {
    const log = messageLogRef.current;
    if (!log) return;
    followLogBottomRef.current = log.scrollHeight - log.scrollTop - log.clientHeight < 120;
  }

  function runningElsewherePlaceholder(): ChatMessage {
    return { role: "assistant", content: "", pending: true, runningElsewhere: true };
  }

  function attachExternalRun(run: ActiveAgentRun) {
    externalRunRef.current = { token: run.token, sessionId: run.sessionId, stopped: false };
    setExternalRunToken(run.token);
  }

  function detachExternalRun() {
    if (remoteRunRef.current) {
      remoteRunRef.current = null;
      setRemoteRunSessionId(null);
    }
    if (!externalRunRef.current) return;
    externalRunRef.current = null;
    setExternalRunToken(null);
  }

  function followRemoteRun(id: string) {
    remoteRunRef.current = id;
    setRemoteRunSessionId(id);
  }

  /** Stops a rail run from this page. The server keeps what it produced. */
  function stopExternalRun() {
    const tracked = externalRunRef.current;
    if (!tracked) return;
    tracked.stopped = true;
    getActiveAgentRun(tracked.token)?.stop?.();
    detachExternalRun();
    markLatestAssistantStopped();
    returnQueuedTasksToComposer();
  }

  useEffect(() => () => {
    chatAbortRef.current?.abort();
  }, []);

  useEffect(() => {
    if (!contextOpen) return;
    const previousOverflow = document.body.style.overflow;
    const contextTrigger = contextTriggerRef.current;
    document.body.style.overflow = "hidden";
    contextCloseRef.current?.focus();

    function handleDialogKeys(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setContextOpen(false);
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(contextDrawerRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), summary, input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      ) ?? []).filter((element) => !element.hasAttribute("hidden"));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    window.addEventListener("keydown", handleDialogKeys);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleDialogKeys);
      contextTrigger?.focus();
    };
  }, [contextOpen]);

  useEffect(() => {
    if (!workPanelOpen || (typeof window.matchMedia === "function" && window.matchMedia("(min-width: 1024px)").matches)) return;
    const previousOverflow = document.body.style.overflow;
    const workPanelTrigger = workPanelTriggerRef.current;
    document.body.style.overflow = "hidden";
    workPanelCloseRef.current?.focus();

    function handleWorkPanelKeys(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setWorkPanelOpen(false);
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(workPanelDrawerRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), summary, input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      ) ?? []).filter((element) => !element.hasAttribute("hidden"));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    window.addEventListener("keydown", handleWorkPanelKeys);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleWorkPanelKeys);
      workPanelTrigger?.focus();
    };
  }, [workPanelOpen]);

  const loadSessions = useCallback(async () => {
    try {
      const response = await fetch("/api/agent/sessions", { cache: "no-store" });
      const data = (await response.json().catch(() => ({}))) as { sessions?: AgentSession[] };
      setSessions(data.sessions ?? []);
      if (response.ok && Array.isArray(data.sessions)) setSessionsLoaded(true);
    } catch {
      /* best-effort */
    }
  }, []);

  useEffect(() => {
    void loadSessions();
  }, [loadSessions]);

  const loadXhsState = useCallback(async () => {
    try {
      const response = await fetch(`/api/agent/xhs/state?locale=${locale}`, { cache: "no-store" });
      const data = (await response.json().catch(() => ({}))) as { state?: XhsWorkflowState };
      if (response.ok && data.state) setXhsState(data.state);
    } catch {
      /* Agent chat remains usable while workflow persistence is unavailable. */
    }
  }, [locale]);

  useEffect(() => {
    void loadXhsState();
  }, [loadXhsState]);

  async function loadSession(
    id: string,
    options: { restore?: boolean; keepQueue?: boolean } = {}
  ): Promise<"loaded" | "missing" | "superseded"> {
    if (chatSendingRef.current) stopAgentChat({ keepQueuedDrafts: false });
    if (!options.keepQueue) clearChatQueuedTasks();
    detachExternalRun();
    // Any stream still delivering events belongs to the previous view; bumping
    // the run id makes those late events (and its queue pump) no-ops.
    activeChatRunRef.current += 1;
    const loadToken = activeChatRunRef.current;
    try {
      const response = await fetch(`/api/agent/sessions/${encodeURIComponent(id)}`, { cache: "no-store" });
      if (!response.ok) throw new Error("session unavailable");
      const data = (await response.json().catch(() => ({}))) as {
        activeRun?: { id: string; startedAt: string } | null;
        messages?: Array<{ role: string; content: { text?: string; error?: string; errorCode?: string; imageUrls?: string[]; attachments?: AgentAttachment[]; dataImportIds?: string[]; toolCalls?: Array<{ name: string; args: Record<string, unknown> }>; toolResults?: Array<{ name: string; result: unknown }>; work?: unknown } }>;
      };
      const storedMessages = (data.messages ?? [])
        .filter((m) => m.role === "user" || m.role === "assistant");
      const mapped: ChatMessage[] = storedMessages
        .map((m) => {
          const work = parseAgentWorkRecord(m.content.work);
          const storedRunMeta = workRecordRunMeta(m.content.work);
          const storedText = normalizeAgentTextContent(m.content.text);
          const stopped = m.role === "assistant" && workRecordOutcome(work) === "paused";
          const continuable = stopped || (m.role === "assistant" && m.content.errorCode === AGENT_MAX_TURNS_ERROR_CODE);
          return {
            role: m.role as "user" | "assistant",
            content: stopped
              ? (storedText ? `${storedText}\n\n${copy.paused}` : copy.paused)
              : storedText || safeStoredAgentErrorMessage(m.content, locale),
            ...(continuable ? { paused: true } : {}),
            images: m.content.imageUrls,
            attachments: m.content.attachments,
            dataImportIds: m.content.dataImportIds,
            dataFiles: m.content.dataImportIds?.map((_, index) => restoredDataImportName(index)),
            toolEvents: collapseAgentToolEventsForDisplay(m.content.toolCalls?.map((call, i) => ({
              name: call.name,
              args: call.args,
              result: m.content.toolResults?.[i]?.result
            })) ?? []),
            statusEvents: workRecordStatusEvents(work),
            collaboration: collaborationFromWorkRecord(work),
            durationMs: work?.durationMs,
            ...(workRecordOutcome(work) ? { outcome: workRecordOutcome(work)! } : {}),
            ...(storedRunMeta
              ? {
                  usage: {
                    ...storedRunMeta.usage,
                    startedAtMs: storedRunMeta.startedAtMs,
                    durationMs: storedRunMeta.durationMs
                  } satisfies AgentRunUsage
                }
              : {})
          };
        });
      for (let index = 1; index < mapped.length; index += 1) {
        const stored = storedMessages[index];
        const previous = mapped[index - 1];
        if (
          mapped[index].role === "assistant"
          && previous?.role === "user"
          && stored
          && isRetryableStoredAgentError(stored.content)
        ) {
          mapped[index].retry = {
            message: previous.content,
            attachments: previous.attachments ?? [],
            dataImports: restoredDataImports(previous.dataImportIds)
          };
        }
      }
      if (activeChatRunRef.current !== loadToken) return "superseded";
      const externalRun = findActiveAgentRun(id);
      // No run in this tab, but the server says one is still working on this
      // session (another tab or device).
      const remoteRun = !externalRun && Boolean(data.activeRun);
      const trailingTurn = mapped.at(-1);
      if (externalRun) {
        // The rail is still working on this session: show the run as in
        // progress. Its user message may not be saved yet.
        if (trailingTurn?.role !== "user") mapped.push({ role: "user", content: externalRun.message });
        mapped.push(runningElsewherePlaceholder());
      } else if (remoteRun) {
        mapped.push(runningElsewherePlaceholder());
      } else if (trailingTurn?.role === "user") {
        mapped.push({
          role: "assistant",
          content: incompleteAgentTurnMessage(locale),
          retry: {
            message: trailingTurn.content,
            attachments: trailingTurn.attachments ?? [],
            dataImports: restoredDataImports(trailingTurn.dataImportIds)
          }
        });
      }
      if (options.restore && mapped.length === 0) return "missing";
      forceLogBottomRef.current = true;
      setChatMessages(mapped.length > 0 ? mapped : chatMessages);
      sessionIdRef.current = id;
      setSessionId(id);
      rememberLastAgentSession(id);
      setHistoryOpen(false);
      if (externalRun) attachExternalRun(externalRun);
      else if (remoteRun) followRemoteRun(id);
      return "loaded";
    } catch {
      if (activeChatRunRef.current !== loadToken) return "superseded";
      if (!options.restore) addToast("error", copy.fallback);
      return "missing";
    }
  }

  function restoredDataImportName(index: number): string {
    return locale === "zh" ? `已导入表现数据 ${index + 1}` : `Imported performance data ${index + 1}`;
  }

  function restoredDataImports(ids: string[] | undefined): PendingDataImport[] {
    return (ids ?? []).map((importId, importIndex) => ({
      id: importId,
      name: restoredDataImportName(importIndex),
      rowCount: 0
    }));
  }

  /** Row counts are unknown for restored imports; never show "0 rows". */
  function dataImportLabel(item: PendingDataImport): string {
    return item.rowCount > 0
      ? `${item.name} · ${item.rowCount} ${locale === "zh" ? "行" : item.rowCount === 1 ? "row" : "rows"}`
      : item.name;
  }

  async function deleteSession(session: AgentSessionSummary) {
    // Optimistic delete: the row leaves the list immediately and the DELETE
    // settles in the background. On failure the row is restored in place.
    setSessions((current) => current.filter((item) => item.id !== session.id));
    if (session.id === sessionId) {
      if (chatSendingRef.current) stopAgentChat({ keepQueuedDrafts: false });
      activeChatRunRef.current += 1;
      detachExternalRun();
      clearChatQueuedTasks();
      setSessionId(null);
      setChatMessages([]);
      setWorkPanelOpen(false);
      clearLastAgentSession();
    }
    addToast("success", locale === "zh" ? "对话已删除。" : "Conversation deleted.");

    void (async () => {
      try {
        const response = await fetch(`/api/agent/sessions/${encodeURIComponent(session.id)}`, {
          method: "DELETE",
          signal: AbortSignal.timeout(10_000)
        });
        if (!response.ok) {
          const data = (await response.json().catch(() => ({}))) as { error?: string };
          throw new Error(data.error ?? copy.fallback);
        }
      } catch {
        setSessions((current) => {
          if (current.some((item) => item.id === session.id)) return current;
          return [...current, session].sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at));
        });
        addToast("error", locale === "zh" ? "删除没有完成，已恢复这条对话" : "Could not delete — the conversation is back");
      }
    })();
  }

  function startNewChat() {
    if (chatSendingRef.current) stopAgentChat({ keepQueuedDrafts: false });
    activeChatRunRef.current += 1;
    detachExternalRun();
    clearChatQueuedTasks();
    setSessionId(null);
    setChatMessages([]);
    setHistoryOpen(false);
    setWorkPanelOpen(false);
    clearLastAgentSession();
  }

  async function handleFiles(files: FileList | File[] | null) {
    if (!files?.length) return;
    if (files === lastHandledFilesRef.current) return;
    lastHandledFilesRef.current = files;
    const remainingSlots = Math.max(0, 6 - pendingAttachments.length - pendingDataImports.length);
    if (!remainingSlots) {
      addToast("error", locale === "zh" ? "每次最多添加 6 个附件。" : "Add up to 6 attachments at a time.");
      return;
    }
    const allFiles = Array.from(files).slice(0, remainingSlots);
    const dataFiles = allFiles.filter((file) => /\.(csv|xlsx)$/i.test(file.name));
    const attachmentFiles = allFiles.filter((file) => !/\.(csv|xlsx)$/i.test(file.name) && isAcceptedAgentAttachmentFile(file));
    const unsupportedFiles = allFiles.filter(
      (file) => !isAcceptedAgentAttachmentFile(file)
    );
    if (unsupportedFiles.length > 0 || (!attachmentFiles.length && !dataFiles.length)) {
      addToast("error", copy.imageOnly);
      return;
    }
    setIsUploadingAttachment(true);
    try {
      // CSV/XLSX first try the private performance-data import, which gives the
      // Agent structured metrics. A sheet that is not a metrics export, or a
      // plan without that import, still joins the chat as a regular file.
      const uploadAsAttachment = [...attachmentFiles];
      for (const file of dataFiles.slice(0, 6)) {
        let imported: PendingDataImport | null = null;
        try {
          const formData = new FormData();
          formData.append("file", file);
          if (xhsState?.workflow?.id) formData.append("workflowId", xhsState.workflow.id);
          const response = await fetch("/api/agent/xhs/data-import", { method: "POST", body: formData });
          const data = (await response.json().catch(() => ({}))) as { import?: PendingDataImport };
          if (response.ok && data.import) imported = data.import;
        } catch {
          // Fall back to a plain attachment below.
        }
        if (imported) {
          const importedItem = imported;
          setPendingDataImports((current) => [...current, importedItem]);
        } else {
          uploadAsAttachment.push(file);
        }
      }
      if (uploadAsAttachment.length) {
        const formData = new FormData();
        uploadAsAttachment.forEach((file) => formData.append("files", file));
        const response = await fetch("/api/agent/attachments", { method: "POST", body: formData });
        const data = (await response.json().catch(() => ({}))) as { attachments?: AgentAttachment[]; error?: string };
        if (!response.ok || !data.attachments) throw new Error(data.error ?? copy.uploadFail);
        setPendingAttachments((current) => [...current, ...data.attachments!].slice(0, 6));
      }
    } catch (error) {
      addToast("error", error instanceof Error && error.message && !isTechnicalAgentErrorMessage(error.message)
        ? error.message
        : copy.uploadFail);
    } finally {
      setIsUploadingAttachment(false);
    }
  }

  function removePendingDataImport(index: number) {
    setPendingDataImports((current) => current.filter((_, itemIndex) => itemIndex !== index));
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    dragDepth.current = 0;
    setIsDragging(false);
    if (event.dataTransfer.files?.length) {
      void handleFiles(event.dataTransfer.files);
    }
  }

  function handleDragEnter(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    if (!Array.from(event.dataTransfer.types).includes("Files")) return;
    dragDepth.current += 1;
    setIsDragging(true);
  }

  function handleDragOver(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    if (Array.from(event.dataTransfer.types).includes("Files")) setIsDragging(true);
  }

  function handleDragLeave(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    if (!Array.from(event.dataTransfer.types).includes("Files")) return;
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setIsDragging(false);
  }

  function enqueueChatTask(message: string, attachments: AgentAttachment[], dataImports: PendingDataImport[]) {
    chatQueuedTaskSeqRef.current += 1;
    chatQueuedTasksRef.current = [...chatQueuedTasksRef.current, {
      id: chatQueuedTaskSeqRef.current,
      message,
      attachments,
      dataImports
    }];
    setChatQueuedTasks(chatQueuedTasksRef.current);
  }

  function discardChatQueuedTask(id: number) {
    chatQueuedTasksRef.current = chatQueuedTasksRef.current.filter((item) => item.id !== id);
    setChatQueuedTasks(chatQueuedTasksRef.current);
  }

  function clearChatQueuedTasks() {
    chatQueuedTasksRef.current = [];
    setChatQueuedTasks([]);
  }

  /** After a stop, queued messages go back into the composer instead of
   *  starting on their own; nothing the user typed is lost. */
  function returnQueuedTasksToComposer() {
    const queued = chatQueuedTasksRef.current;
    if (queued.length === 0) return;
    clearChatQueuedTasks();
    setChatInput((current) => [current.trim(), ...queued.map((item) => item.message)].filter(Boolean).join("\n\n"));
    setPendingAttachments((current) => [...current, ...queued.flatMap((item) => item.attachments)].slice(0, 6));
    setPendingDataImports((current) => [...current, ...queued.flatMap((item) => item.dataImports)].slice(0, 6));
  }

  function pumpChatQueuedTasks() {
    if (chatQueuedTasksRef.current.length === 0) return;
    const [next, ...rest] = chatQueuedTasksRef.current;
    chatQueuedTasksRef.current = rest;
    setChatQueuedTasks(rest);
    void sendAgentMessage(undefined, next.message, next.attachments, next.dataImports);
  }

  async function sendAgentMessage(
    event?: FormEvent,
    preset?: string,
    retryAttachments?: AgentAttachment[],
    retryDataImports?: PendingDataImport[]
  ) {
    event?.preventDefault();
    const attachments = retryAttachments ? [...retryAttachments] : [...pendingAttachments];
    const dataImports = retryDataImports ? [...retryDataImports] : [...pendingDataImports];
    const message = (preset ?? chatInput).trim() || ((attachments.length || dataImports.length)
      ? (locale === "zh" ? "请分析这些附件。" : "Please analyze these attachments.")
      : "");
    if (!message || isUploadingAttachment || restoringSessionRef.current) return;
    if (chatSendingRef.current || externalRunRef.current || remoteRunRef.current) {
      // A message submitted while a task is running joins the FIFO queue
      // (with its attachment snapshot) and starts after the current task
      // instead of racing a second concurrent run.
      enqueueChatTask(message, attachments, dataImports);
      setChatInput("");
      setPendingAttachments([]);
      setPendingDataImports([]);
      return;
    }

    const runId = activeChatRunRef.current + 1;
    const runStartedAt = Date.now();
    activeChatRunRef.current = runId;
    forceLogBottomRef.current = true;

    if (!retryAttachments && !retryDataImports) {
      setChatInput("");
      setPendingAttachments([]);
      setPendingDataImports([]);
    }
    setChatSending(true);
    chatSendingRef.current = true;

    setChatMessages((current) => [
      ...current,
      {
        role: "user",
        content: message,
        ...(attachments.length ? { attachments } : {}),
        ...(attachments.length ? { images: attachments.filter((item) => item.kind === "image").map((item) => item.url).filter((url): url is string => Boolean(url)) } : {}),
        ...(dataImports.length ? { dataFiles: dataImports.map(dataImportLabel) } : {})
      },
      {
        role: "assistant",
        content: "",
        pending: true,
        statusEvents: [{ stage: "understanding_request", completed: false }]
      }
    ]);

    let assistantText = "";
    const toolEvents: ToolEvent[] = [];
    const collaboration = createCollaborationViewState();
    let statusEvents: AgentStatusEvent[] = [{ stage: "understanding_request", completed: false }];
    let terminalOutcome: AgentChatOutcome | null = null;
    let terminalDurationMs: number | undefined;
    let streamErrorCode: string | undefined;
    let sawDone = false;
    let runFinishedNormally = false;
    const runUsage: AgentRunUsage = {
      credits: 0,
      steps: 0,
      refunded: 0,
      startedAtMs: runStartedAt,
      durationMs: 0,
      available: 0
    };
    let insufficientCredits = false;

    function usageSnapshot(finalDurationMs: number): AgentRunUsage | undefined {
      if (!(insufficientCredits || runUsage.steps > 0 || runUsage.refunded > 0)) return undefined;
      return {
        ...runUsage,
        durationMs: finalDurationMs,
        ...(insufficientCredits ? { insufficient: true } : {})
      };
    }

    function updateAssistant() {
      if (activeChatRunRef.current !== runId) return;
      const collaborationSnapshot = collaboration.snapshot();
      setChatMessages((current) => {
        const next = [...current];
        next[next.length - 1] = {
          role: "assistant",
          content: assistantText,
          toolEvents: [...toolEvents],
          statusEvents: [...statusEvents],
          ...(collaborationSnapshot.groups.length > 0 ? { collaboration: collaborationSnapshot } : {}),
          pending: true
        };
        return next;
      });
    }

    let controller: AbortController | null = null;
    try {
      controller = new AbortController();
      chatAbortRef.current = controller;
      const response = await fetch("/api/agent/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: sessionIdRef.current ?? undefined,
          workflowId: xhsState?.workflow?.id ?? undefined,
          dataImportIds: dataImports.length ? dataImports.map((item) => item.id) : undefined,
          message,
          attachments: attachments.length ? attachments : undefined,
          depth: agentDepth
        }),
        signal: controller.signal
      });
      if (response.status === 401) {
        streamErrorCode = "AUTH_REQUIRED";
        throw new Error(copy.authRequired);
      }
      const busySessionId = sessionIdRef.current;
      if (response.status === 409 && busySessionId) {
        const data = (await response.json().catch(() => ({}))) as { code?: string };
        if (data.code === AGENT_SESSION_BUSY_CODE) {
          // Another tab or device is already working in this conversation:
          // show that run as in progress and send this message after it.
          setChatMessages((current) => [...current.slice(0, -2), runningElsewherePlaceholder()]);
          enqueueChatTask(message, attachments, dataImports);
          followRemoteRun(busySessionId);
          return;
        }
      }
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? copy.fallback);
      }

      let streamError: string | null = null;

      await consumeSSEStream(response, (event, data) => {
        if (activeChatRunRef.current !== runId) return;
        if (event === "session") {
          const { sessionId: newId } = data as { sessionId: string };
          sessionIdRef.current = sessionIdRef.current ?? newId;
          setSessionId((current) => current ?? newId);
          rememberLastAgentSession(newId);
        } else if (event === "text") {
          assistantText += normalizeAgentTextContent((data as { text?: unknown }).text);
          updateAssistant();
        } else if (event === "status") {
          const { stage } = data as { stage?: unknown };
          if (isAgentStatusStage(stage)) {
            statusEvents = advanceAgentStatus(statusEvents, stage);
            updateAssistant();
          }
        } else if (event === "tool_call") {
          const { name, args } = data as { name: string; args: Record<string, unknown> };
          toolEvents.push({ name, args });
          updateAssistant();
        } else if (event === "tool_result") {
          const { name, result } = data as { name: string; result: unknown };
          const idx = toolEvents.findIndex((t) => t.name === name && t.result === undefined);
          if (idx >= 0) toolEvents[idx].result = result;
          updateAssistant();
        } else if (event.startsWith("subagent_")) {
          // Subagent lifecycle events render through the collaboration strip,
          // not as a raw tool card.
          collaboration.apply(data as SubagentEvent);
          updateAssistant();
        } else if (event === "usage") {
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
        } else if (event === "error") {
          const errorEvent = data as { error?: string; code?: string };
          if (errorEvent.code === "INSUFFICIENT_CREDITS") {
            insufficientCredits = true;
            runUsage.available = 0;
          }
          streamErrorCode = errorEvent.code;
          streamError = errorEvent.code === "AUTH_REQUIRED"
            ? copy.authRequired
            : errorEvent.error && !isTechnicalAgentErrorMessage(errorEvent.error)
              ? errorEvent.error
              : agentUnexpectedFailureMessage(locale);
        } else if (event === "done") {
          sawDone = true;
          const { outcome, work: rawWork } = data as { outcome?: unknown; work?: unknown };
          if (isAgentChatOutcome(outcome)) terminalOutcome = outcome;
          const work = parseAgentWorkRecord(rawWork);
          if (work) terminalDurationMs = work.durationMs;
        }
      });

      if (activeChatRunRef.current !== runId) return;
      // A stream that ends without a result or an error was cut off mid-run.
      const interrupted = !sawDone && !streamError;
      const authRequired = streamErrorCode === "AUTH_REQUIRED";
      const terminalContent = interrupted
        ? [assistantText, agentStreamInterruptedMessage(locale)].filter(Boolean).join("\n\n")
        : resolveAgentTerminalContent({
            assistantText,
            streamError,
            outcome: terminalOutcome,
            hasPendingConfirmation: toolEvents.some((tool) => isPendingAgentConfirmation(tool.result)),
            fallback: copy.fallback
          });
      const retryable = interrupted || isRetryableAgentErrorCode(streamErrorCode);
      setChatMessages((current) => {
        const next = [...current];
        next[next.length - 1] = {
          role: "assistant",
          content: terminalContent,
          toolEvents,
          statusEvents: completeAgentStatuses(statusEvents),
          durationMs: terminalDurationMs ?? Date.now() - runStartedAt,
          ...(terminalOutcome ? { outcome: terminalOutcome } : {}),
          ...(retryable ? {
            retry: { message, attachments, dataImports }
          } : {}),
          ...(streamErrorCode === AGENT_MAX_TURNS_ERROR_CODE ? { paused: true } : {}),
          ...(authRequired ? { authRequired: true } : {}),
          ...(usageSnapshot(terminalDurationMs ?? Date.now() - runStartedAt)
            ? { usage: usageSnapshot(terminalDurationMs ?? Date.now() - runStartedAt)! }
            : {})
        };
        return next;
      });
      if (authRequired) setChatInput((current) => current.trim() ? current : message);
      if (!streamError && !interrupted) playTaskCompleteSound();
      runFinishedNormally = !insufficientCredits && !authRequired;
      void loadSessions();
      void loadXhsState();
    } catch (error) {
      if (activeChatRunRef.current !== runId) return;
      // Network failures surface as raw browser text ("Failed to fetch");
      // show the product message instead and keep the turn retryable with
      // the same message and attachments.
      const authRequired = streamErrorCode === "AUTH_REQUIRED";
      const rawMessage = error instanceof Error ? error.message : "";
      const content = authRequired
        ? copy.authRequired
        : rawMessage && !isTechnicalAgentErrorMessage(rawMessage)
          ? rawMessage
          : agentUnexpectedFailureMessage(locale);
      setChatMessages((current) => {
        const next = [...current];
        next[next.length - 1] = {
          role: "assistant",
          content: assistantText ? `${assistantText}\n\n${content}` : content,
          toolEvents,
          statusEvents: completeAgentStatuses(statusEvents),
          durationMs: Date.now() - runStartedAt,
          ...(authRequired
            ? { authRequired: true }
            : { retry: { message, attachments, dataImports } }),
          ...(usageSnapshot(Date.now() - runStartedAt)
            ? { usage: usageSnapshot(Date.now() - runStartedAt)! }
            : {})
        };
        return next;
      });
      if (authRequired) setChatInput((current) => current.trim() ? current : message);
    } finally {
      if (controller && chatAbortRef.current === controller) chatAbortRef.current = null;
      if (activeChatRunRef.current === runId) {
        setChatSending(false);
        chatSendingRef.current = false;
        // Queued messages start only after a run that actually finished. A
        // stop or a session switch bumps the run id, so this never fires for
        // them and never writes into a conversation the user has left.
        if (runFinishedNormally) pumpChatQueuedTasks();
      }
    }
  }

  function markLatestAssistantStopped() {
    setChatMessages((current) => {
      const next = [...current];
      const lastIndex = next.length - 1;
      const last = next[lastIndex];
      if (last?.role === "assistant") {
        next[lastIndex] = {
          ...last,
          content: last.content ? `${last.content}\n\n${copy.paused}` : copy.paused,
          pending: false,
          paused: true,
          runningElsewhere: false
        };
      }
      return next;
    });
  }

  function stopAgentChat(options: { keepQueuedDrafts?: boolean } = {}) {
    if (!chatSendingRef.current) return;
    chatSendingRef.current = false;
    activeChatRunRef.current += 1;
    chatAbortRef.current?.abort();
    chatAbortRef.current = null;
    markLatestAssistantStopped();
    setChatSending(false);
    if (options.keepQueuedDrafts === false) clearChatQueuedTasks();
    else returnQueuedTasksToComposer();
  }

  const composerAttachments: AgentAttachment[] = [
    ...pendingAttachments,
    ...pendingDataImports.map((item) => ({
      id: item.id,
      name: dataImportLabel(item),
      size: 0,
      kind: "data" as const,
      mimeType: "text/csv",
      storagePath: `data-import/${item.id}`
    }))
  ];
  const emptyConversation = chatMessages.length === 0;
  // Brand-new account (no saved content, no past chats): point to the guided first task.
  const showFirstTaskCard = sessionsLoaded
    && sessions.length === 0
    && Boolean(workbench?.kitsLoaded)
    && workbench?.kits.length === 0;
  const externalRunActive = externalRunToken !== null;
  const remoteRunActive = remoteRunSessionId !== null;
  const composerBusy = chatSending || externalRunActive || remoteRunActive;
  const stopComposerRun = () => {
    if (chatSendingRef.current) stopAgentChat();
    else stopExternalRun();
  };
  // A run in another tab or device cannot be stopped from here.
  const composerStop = chatSending || externalRunActive ? stopComposerRun : undefined;
  const latestUserMessage = [...chatMessages].reverse().find((message) => message.role === "user");
  const latestAssistantMessage = [...chatMessages].reverse().find((message) => message.role === "assistant");
  const currentToolEvents = collapseAgentToolEventsForDisplay(latestAssistantMessage?.toolEvents ?? [])
    // The delegation tool renders as the collaboration strip, never a raw card.
    .filter((tool) => tool.name !== "delegate_parallel" && tool.name !== "inspect_xhs_workflow");
  const workPanelActive = chatSending || Boolean(latestAssistantMessage?.pending);
  const workPanelAwaitingConfirmation = currentToolEvents.some((tool) => {
    if (!isPendingAgentConfirmation(tool.result)) return false;
    const pendingActionId = pendingAgentConfirmationId(tool.result);
    return !pendingActionId || !pendingActionStatuses[pendingActionId] || pendingActionStatuses[pendingActionId] === "pending";
  });
  const workPanelAwaitingInput = latestAssistantMessage?.outcome === "awaiting_input";
  const workPanelHandoffCompleted = currentToolEvents.some((tool) => {
    const pendingActionId = pendingAgentConfirmationId(tool.result);
    if (!pendingActionId || pendingActionStatuses[pendingActionId] !== "executed") return false;
    if (!tool.result || typeof tool.result !== "object" || Array.isArray(tool.result)) return false;
    const card = (tool.result as Record<string, unknown>).xhsCard;
    if (!card || typeof card !== "object" || Array.isArray(card)) return false;
    const meta = (card as Record<string, unknown>).meta;
    if (!meta || typeof meta !== "object" || Array.isArray(meta)) return false;
    const href = (meta as Record<string, unknown>).href;
    return typeof href === "string" && (href === "/workbench" || href.startsWith("/workbench?"));
  });
  const workPanelState = latestAssistantMessage?.paused
    ? "paused" as const
    : workPanelAwaitingConfirmation
      ? "awaiting_confirmation" as const
      : workPanelAwaitingInput
        ? "awaiting_input" as const
        : workPanelActive
          ? "active" as const
          : "complete" as const;
  const workPanelDurationMs = latestAssistantMessage?.durationMs;
  const workPanelTask = latestUserMessage?.content || (locale === "zh" ? "当前智能体任务" : "Current Agent task");
  const latestStatusEvent = [...(latestAssistantMessage?.statusEvents ?? [])].reverse()
    .find((status) => !status.completed)
    ?? latestAssistantMessage?.statusEvents?.at(-1);
  const workPanelSteps: AgentWorkStep[] = [
    ...(workPanelActive && latestStatusEvent ? [{
      id: `status-${latestStatusEvent.stage}`,
      label: getAgentStatusLabel(latestStatusEvent.stage, locale),
      state: latestAssistantMessage?.paused ? "paused" as const : "active" as const,
      kind: "status" as const
    }] : []),
    ...currentToolEvents.map((tool, index) => ({
      id: `tool-${tool.name}-${index}`,
      label: getAgentToolLabel(tool.name, locale),
      state: tool.result !== undefined ? "complete" as const : latestAssistantMessage?.paused ? "paused" as const : "active" as const,
      kind: "tool" as const
    }))
  ];
  const workPanelHasOutput = Boolean(
    latestAssistantMessage?.content
    || currentToolEvents.some((tool) => tool.result !== undefined)
  );
  const workPanelTriggerLabel = workPanelActive
    ? (locale === "zh" ? "正在工作" : "Working")
    : workPanelAwaitingConfirmation
      ? (locale === "zh" ? "等待确认" : "Needs approval")
      : workPanelAwaitingInput
        ? (locale === "zh" ? "等你选择" : "Needs your choice")
        : workPanelHandoffCompleted
          ? (locale === "zh" ? "已转接创作台" : "Handed off")
          : typeof workPanelDurationMs === "number"
            ? `${locale === "zh" ? "已完成" : "Done"} · ${formatCompactAgentDuration(workPanelDurationMs, locale)}`
            : copy.workPanel;
  const displayChatMessages = chatMessages.map((message) => ({
    ...message,
    ...(message.toolEvents
      ? { toolEvents: collapseAgentToolEventsForDisplay(message.toolEvents) }
      : {})
  }));

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      onDrop={handleDrop}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      className="workspace-agent mx-auto flex h-[calc(100dvh-10rem)] min-h-0 max-w-[1600px] flex-col lg:h-full"
    >
      <section
        aria-label={copy.title}
        className="workspace-agent-surface min-h-0 overflow-hidden"
      >
        <header className="workspace-agent-header">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="grid h-8 w-8 shrink-0 place-items-center text-fg-muted">
              <Bot className="h-4 w-4" />
            </span>
            <span className="truncate text-sm font-medium text-fg-muted">{locale === "zh" ? "对话" : "Chat"}</span>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {!emptyConversation ? (
              <button
                type="button"
                onClick={startNewChat}
                className="focus-ring inline-flex h-9 w-9 items-center justify-center rounded-full text-fg-muted transition hover:bg-surface-2 hover:text-fg"
                aria-label={copy.newChat}
              >
                <Plus className="h-4 w-4" />
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => setHistoryOpen((v) => !v)}
              className="focus-ring inline-flex h-9 w-9 items-center justify-center rounded-full text-fg-muted transition hover:bg-surface-2 hover:text-fg"
              aria-label={copy.history}
              aria-expanded={historyOpen}
            >
              <History className="h-4 w-4" />
            </button>
            {!emptyConversation ? (
              <button
                ref={workPanelTriggerRef}
                type="button"
                onClick={() => setWorkPanelOpen((open) => !open)}
                aria-expanded={workPanelOpen}
                className={`focus-ring inline-flex h-9 items-center justify-center gap-2 rounded-full px-2.5 text-xs font-semibold transition ${workPanelOpen
                  ? "bg-surface-2 text-fg"
                  : "text-fg-muted hover:bg-surface-2 hover:text-fg"}`}
                aria-label={workPanelOpen
                  ? (locale === "zh" ? "关闭工作过程和结果" : "Close work progress and results")
                  : (locale === "zh" ? "打开工作过程和结果" : "Open work progress and results")}
              >
                <Activity className="h-4 w-4" />
                <span className="hidden sm:inline">{workPanelTriggerLabel}</span>
                {workPanelActive ? (
                  <span className="h-1.5 w-1.5 rounded-full bg-action shadow-[0_0_10px_rgb(var(--action)/0.8)]" />
                ) : null}
              </button>
            ) : null}
            {!emptyConversation ? (
              <button
                ref={contextTriggerRef}
                type="button"
                onClick={() => setContextOpen(true)}
                aria-haspopup="dialog"
                aria-expanded={contextOpen}
                className="focus-ring inline-flex h-9 w-9 items-center justify-center rounded-full text-fg-muted transition hover:bg-surface-2 hover:text-fg"
                aria-label={copy.openContext}
              >
                <SlidersHorizontal className="h-4 w-4" />
              </button>
            ) : null}
          </div>
        </header>

        {historyOpen && (
          <div className="absolute right-3 top-[4.25rem] z-30 w-[min(22rem,calc(100%-1.5rem))] rounded-2xl border border-hairline bg-surface-raised/98 p-2 shadow-raised backdrop-blur-xl sm:right-5" role="region" aria-label={copy.history}>
            <AgentSessionHistory
              sessions={sessions}
              currentSessionId={sessionId}
              locale={locale}
              onSelect={(session) => { void loadSession(session.id); }}
              onDelete={deleteSession}
            />
          </div>
        )}

        {emptyConversation && restoringSession ? (
          <div className="workspace-agent-empty">
            <div role="status" aria-busy="true" aria-label={copy.restoring} className="w-full max-w-[720px] space-y-4">
              <div className="ml-auto h-11 w-2/3 animate-pulse rounded-[22px] bg-surface-2" />
              <div className="h-4 w-5/6 animate-pulse rounded-full bg-surface-2" />
              <div className="h-4 w-3/5 animate-pulse rounded-full bg-surface-2" />
              <div className="mt-8 h-24 w-full animate-pulse rounded-[28px] bg-surface-2/70" />
            </div>
          </div>
        ) : emptyConversation ? (
          <div className="workspace-agent-empty">
            <div className="w-full max-w-[720px]">
              <div className="workspace-agent-greeting">
                <div className="workspace-fish"><FishLogo variant="app-icon" className="h-12 w-12 rounded-2xl" /></div>
                <h1>{copy.heroTitle}</h1>
              </div>

              {showFirstTaskCard ? (
                <div data-testid="agent-first-task-card" className="mt-6 flex flex-col gap-3 rounded-2xl border border-action/25 bg-action/[0.06] p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
                  <div className="min-w-0">
                    <h2 className="text-base font-semibold text-fg">{copy.firstTaskTitle}</h2>
                    <p className="mt-1 text-sm leading-6 text-fg-muted">{copy.firstTaskDesc}</p>
                  </div>
                  <Link href={FIRST_TASK_ENTRY} className="btn-primary focus-ring min-h-11 shrink-0 justify-center px-5">
                    {copy.firstTaskAction}
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                </div>
              ) : null}

              <div className="mt-6">
                <AgentComposer
                  locale={locale}
                  value={chatInput}
                  onChange={setChatInput}
                  onSubmit={() => void sendAgentMessage()}
                  sending={composerBusy}
                  onStop={composerStop}
                  depth={agentDepth}
                  onDepthChange={(next) => {
                    setAgentDepth(next);
                    writeStoredAgentDepth(next);
                  }}
                  attachments={composerAttachments}
                  onFiles={(files) => void handleFiles(files)}
                  onRemoveAttachment={(index) => {
                    if (index < pendingAttachments.length) {
                      setPendingAttachments((current) => current.filter((_, itemIndex) => itemIndex !== index));
                    } else {
                      removePendingDataImport(index - pendingAttachments.length);
                    }
                  }}
                  uploading={isUploadingAttachment}
                  placeholder={isDragging ? copy.attachHint : copy.placeholder}
                />
              </div>

              <div className="workspace-agent-starters">
                {[
                  { zh: "写一篇内容", en: "Write a post", promptZh: "帮我写一篇内容。先问我主题和发布平台。", promptEn: "Help me write a post. Ask me about the topic and platform first.", icon: FileStack },
                  { zh: "分析我的账号", en: "Review my account", promptZh: "帮我分析社交媒体账号。先问我账号链接和目标。", promptEn: "Help me review my social account. Ask for the account link and goal first.", icon: BarChart3 },
                  { zh: "找个好选题", en: "Find a topic", promptZh: "帮我找适合的内容选题。先了解我的领域和受众。", promptEn: "Help me find content topics. Ask about my field and audience first.", icon: Target }
                ].map((item) => <button type="button" key={item.en} className="focus-ring" onClick={() => void sendAgentMessage(undefined, locale === "zh" ? item.promptZh : item.promptEn)}><item.icon className="h-3.5 w-3.5" />{locale === "zh" ? item.zh : item.en}</button>)}
              </div>

              <OpportunityRadarPreview
                surface="agent_chatbox"
                onSelect={(opportunity) => {
                  void sendAgentMessage(undefined, buildOpportunityAgentPrompt(opportunity, locale));
                }}
              />

            </div>
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 overflow-hidden">
            <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
              <div ref={messageLogRef} onScroll={handleMessageLogScroll} role="log" aria-live="polite" aria-relevant="additions text" aria-busy={composerBusy} className="mx-auto flex min-h-0 w-full max-w-[920px] flex-1 flex-col gap-5 overflow-y-auto overscroll-contain px-4 py-8 sm:px-8">
              {displayChatMessages.map((message, index) => (
            <div
              key={`${message.role}-${index}`}
              className={message.role === "user"
                ? "group/msg ml-auto max-w-[82%] shrink-0 rounded-[22px] bg-surface-2 px-4 py-3 text-[15px] font-medium leading-7 text-fg sm:max-w-[72%]"
                : "workspace-agent-message group/msg relative max-w-full shrink-0 overflow-hidden text-fg"}
            >
              {message.images?.length ? (
                <div className="mb-2 flex flex-wrap gap-1.5">
                  {message.images.map((url, i) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img key={i} src={url} alt="" className="h-20 w-20 rounded-md border border-hairline object-cover" />
                  ))}
                </div>
              ) : null}
              {message.attachments?.some((attachment) => attachment.kind !== "image") ? (
                <div className="mb-2 flex flex-wrap gap-1.5">
                  {message.attachments.filter((attachment) => attachment.kind !== "image").map((attachment) => (
                    <span key={attachment.id} className="inline-flex max-w-full items-center gap-1.5 rounded-lg border border-action/25 bg-action/10 px-2 py-1 text-[11px] font-bold text-action">
                      <FileStack className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate">{attachment.name}</span>
                    </span>
                  ))}
                </div>
              ) : null}
              {message.dataFiles?.length ? (
                <div className="mb-2 flex flex-wrap gap-1.5">
                  {message.dataFiles.map((name) => (
                    <span key={name} className="inline-flex items-center gap-1.5 rounded-md border border-action/25 bg-action/10 px-2 py-1 text-[11px] font-bold text-action">
                      <FileSpreadsheet className="h-3.5 w-3.5" />
                      {name}
                    </span>
                  ))}
                </div>
              ) : null}

              {message.statusEvents?.length ? (
                <AgentThinkingTrace
                  events={message.statusEvents}
                  active={Boolean(message.pending)}
                  locale={locale}
                  tone="surface"
                />
              ) : null}



              {message.content ? (
                message.role === "assistant"
                  ? <AgentMessageContent content={message.content} />
                  : <div className="whitespace-pre-wrap">{message.content}</div>
              ) : null}

              {message.toolEvents?.filter((tool) => tool.name !== "delegate_parallel" && tool.name !== "inspect_xhs_workflow").map((tool, i) => (
                <ToolEventCard
                  key={i}
                  tool={tool}
                  runPending={Boolean(message.pending)}
                  locale={locale}
                  interactive={message.role === "assistant"
                    && !displayChatMessages.slice(index + 1).some((later) => later.role === "user")}
                  onXhsStateChanged={(state) => setXhsState(state)}
                  onXhsActionStatusChanged={handleXhsActionStatusChanged}
                  onAskAgent={(prompt) => void sendAgentMessage(undefined, prompt)}
                />
              ))}

              {message.retry ? (
                <button
                  type="button"
                  onClick={() => void sendAgentMessage(
                    undefined,
                    message.retry!.message,
                    message.retry!.attachments,
                    message.retry!.dataImports
                  )}
                  disabled={composerBusy}
                  className="focus-ring mt-3 inline-flex items-center gap-2 rounded-md border border-action/40 bg-action/10 px-3 py-2 text-xs font-bold text-action transition hover:bg-action/20 disabled:opacity-50"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  {locale === "zh"
                    ? (message.retry.attachments.length || message.retry.dataImports.length
                        ? "重试本轮（保留资料）"
                        : "重试本轮")
                    : (message.retry.attachments.length || message.retry.dataImports.length
                        ? "Retry with evidence"
                        : "Retry this turn")}
                </button>
              ) : null}

              {message.authRequired ? (
                <Link
                  href={buildAuthHref("/login", "/dashboard")}
                  className="focus-ring mt-3 inline-flex min-h-9 items-center gap-2 rounded-md bg-action px-3 text-xs font-bold text-on-action transition hover:bg-action-strong"
                >
                  {copy.signIn}
                  <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              ) : null}

              {message.pending && message.runningElsewhere ? (
                <span role="status" className="inline-flex items-center gap-2 text-fg-muted">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {copy.runningElsewhere}
                </span>
              ) : message.pending && !message.content && (!message.toolEvents || message.toolEvents.length === 0) && !message.statusEvents?.length ? (
                <span className="inline-flex items-center gap-2 text-fg-muted">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {copy.thinking}
                </span>
              ) : null}

              {message.paused ? (
                <button
                  type="button"
                  onClick={() => void sendAgentMessage(undefined, copy.resumePrompt)}
                  className="focus-ring mt-3 inline-flex items-center gap-2 rounded-md border border-action/40 bg-action/10 px-3 py-2 text-xs font-bold text-action transition hover:bg-action/20"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  {copy.resume}
                </button>
              ) : null}
              {message.usage ? (
                <AgentRunUsageHint usage={message.usage} locale={locale} revealOnMessageHover />
              ) : null}
            </div>
              ))}
              </div>

              <div data-agent-composer-dock className="workspace-agent-dock shrink-0">
                <div className="mx-auto max-w-[820px]">
                  {chatQueuedTasks.length > 0 ? (
                    <div className="mb-2">
                      <AgentQueuedTasks locale={locale} items={chatQueuedTasks} onDiscard={discardChatQueuedTask} />
                    </div>
                  ) : null}
                  <AgentComposer
                    locale={locale}
                    value={chatInput}
                    onChange={setChatInput}
                    onSubmit={() => void sendAgentMessage()}
                    sending={composerBusy}
                    onStop={composerStop}
                    depth={agentDepth}
                    onDepthChange={(next) => {
                      setAgentDepth(next);
                      writeStoredAgentDepth(next);
                    }}
                    attachments={composerAttachments}
                    onFiles={(files) => void handleFiles(files)}
                    onRemoveAttachment={(index) => {
                      if (index < pendingAttachments.length) {
                        setPendingAttachments((current) => current.filter((_, itemIndex) => itemIndex !== index));
                      } else {
                        removePendingDataImport(index - pendingAttachments.length);
                      }
                    }}
                    uploading={isUploadingAttachment}
                    placeholder={isDragging ? copy.attachHint : composerBusy ? copy.steerPlaceholder : copy.placeholder}
                    compact
                  />
                </div>
              </div>
            </div>

            {workPanelOpen ? (
              <AgentWorkPanel
                locale={locale}
                task={workPanelTask}
                steps={workPanelSteps}
                hasOutput={workPanelHasOutput}
                state={workPanelState}
                handoffCompleted={workPanelHandoffCompleted}
                durationMs={workPanelDurationMs}
                collaboration={latestAssistantMessage?.collaboration}
                onClose={() => setWorkPanelOpen(false)}
                className="hidden w-[340px] shrink-0 border-l border-hairline lg:flex xl:w-[370px]"
              />
            ) : null}
          </div>
        )}

        <AnimatePresence>
          {isDragging ? (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="pointer-events-none absolute inset-0 z-30 grid place-items-center rounded-[28px] border-2 border-action bg-surface/92 p-6 backdrop-blur-sm"
            >
              <div className="max-w-sm text-center">
                <span className="mx-auto grid h-16 w-16 place-items-center rounded-2xl border border-action/50 bg-action/15 text-action shadow-[0_0_50px_rgb(var(--action)/0.2)]">
                  <Upload className="h-7 w-7" />
                </span>
                <p className="mt-5 text-lg font-bold text-fg">{copy.dropTitle}</p>
                <p className="mt-2 text-sm leading-6 text-fg-muted">{copy.dropDesc}</p>
              </div>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </section>

      <AnimatePresence>
        {workPanelOpen ? (
          <>
            <motion.button
              type="button"
              aria-label={locale === "zh" ? "关闭工作面板" : "Close work panel"}
              key="work-panel-overlay"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setWorkPanelOpen(false)}
              className="fixed inset-0 z-40 bg-black/55 backdrop-blur-sm lg:hidden"
            />
            <motion.div
              ref={workPanelDrawerRef}
              key="work-panel-drawer"
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "spring", damping: 30, stiffness: 300 }}
              role="dialog"
              aria-modal="true"
              aria-label={locale === "zh" ? "工作过程和结果" : "Work progress and results"}
              className="fixed right-0 top-0 z-50 h-full w-full max-w-[390px] shadow-2xl lg:hidden"
            >
              <AgentWorkPanel
                locale={locale}
                task={workPanelTask}
                steps={workPanelSteps}
                hasOutput={workPanelHasOutput}
                state={workPanelState}
                handoffCompleted={workPanelHandoffCompleted}
                durationMs={workPanelDurationMs}
                collaboration={latestAssistantMessage?.collaboration}
                onClose={() => setWorkPanelOpen(false)}
                closeButtonRef={workPanelCloseRef}
                className="flex h-full border-l border-hairline"
              />
            </motion.div>
          </>
        ) : null}
      </AnimatePresence>

      {/* 右侧上下文抽屉：可展开/收起，默认隐藏。浮动抽屉 + 遮罩，
          不再挤压 chat、不再造成右下角错位。 */}
      <AnimatePresence>
        {contextOpen ? (
          <>
            <motion.button
              type="button"
              aria-label={locale === "en" ? "Close context" : "关闭上下文"}
              key="context-overlay"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setContextOpen(false)}
              className="fixed inset-0 z-[60] bg-black/50 backdrop-blur-sm"
            />
            <motion.aside
              ref={contextDrawerRef}
              key="context-drawer"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 20 }}
              transition={{ duration: 0.18, ease: "easeOut" }}
              role="dialog"
              aria-modal="true"
              aria-label={copy.contextTitle}
              className="fixed inset-x-3 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-[70] flex max-h-[calc(100svh-6.25rem-env(safe-area-inset-bottom))] flex-col overflow-hidden rounded-2xl border border-hairline bg-surface text-fg shadow-2xl sm:bottom-auto sm:left-auto sm:right-4 sm:top-4 sm:w-[360px] sm:max-h-[calc(100svh-2rem)]"
            >
              <div className="flex items-center justify-between border-b border-hairline px-4 py-3.5 sm:px-5">
                <div className="flex items-center gap-2 text-sm font-bold text-action">
                  <SlidersHorizontal className="h-4 w-4" />
                  {copy.contextTitle}
                </div>
                <button
                  ref={contextCloseRef}
                  type="button"
                  onClick={() => setContextOpen(false)}
                  className="focus-ring grid h-9 w-9 place-items-center rounded-full text-fg-muted transition hover:bg-surface-2 hover:text-fg"
                  aria-label={locale === "en" ? "Close" : "关闭"}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="overflow-y-auto px-4 py-4 sm:px-5">
                <p className="text-sm leading-6 text-fg-muted">{copy.contextDesc}</p>

                <div className="mt-4 flex items-start gap-3 rounded-xl border border-action/15 bg-action/[0.06] p-3.5">
                  <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-action/12 text-action">
                    <ShieldCheck className="h-4 w-4" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-fg">{locale === "en" ? "Used when relevant" : "按需自动使用"}</p>
                    <p className="mt-1 text-xs leading-5 text-fg-muted">{copy.contextScope}</p>
                  </div>
                </div>

                <nav aria-label={locale === "en" ? "Manage context" : "管理上下文"} className="mt-4 overflow-hidden rounded-xl border border-hairline bg-surface-2/35">
                  <Link
                    href="/brand-memory"
                    onClick={() => setContextOpen(false)}
                    aria-label={copy.memory}
                    className="focus-ring flex min-h-16 items-center gap-3 px-3.5 py-3 transition hover:bg-surface-2"
                  >
                    <FileStack className="h-4 w-4 shrink-0 text-action" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-bold text-fg">{copy.memory}</span>
                      <span className="mt-0.5 block text-xs text-fg-muted">{copy.memoryDesc}</span>
                    </span>
                    <ArrowRight className="h-4 w-4 shrink-0 text-fg-muted" />
                  </Link>
                  <Link
                    href="/guardrails"
                    onClick={() => setContextOpen(false)}
                    aria-label={copy.rules}
                    className="focus-ring flex min-h-16 items-center gap-3 border-t border-hairline px-3.5 py-3 transition hover:bg-surface-2"
                  >
                    <ShieldCheck className="h-4 w-4 shrink-0 text-action" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-bold text-fg">{copy.rules}</span>
                      <span className="mt-0.5 block text-xs text-fg-muted">{copy.rulesDesc}</span>
                    </span>
                    <ArrowRight className="h-4 w-4 shrink-0 text-fg-muted" />
                  </Link>
                </nav>
              </div>
            </motion.aside>
          </>
        ) : null}
      </AnimatePresence>

    </motion.div>
  );
}

function formatCompactAgentDuration(durationMs: number, locale: "zh" | "en"): string {
  const seconds = Math.max(1, Math.round(durationMs / 1000));
  if (seconds < 60) return locale === "zh" ? `${seconds}秒` : `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return locale === "zh" ? `${minutes}分${remainder}秒` : `${minutes}m ${remainder}s`;
}

function ToolEventCard({
  tool,
  locale,
  onXhsStateChanged,
  onXhsActionStatusChanged,
  onAskAgent,
  interactive,
  runPending = false
}: {
  tool: ToolEvent;
  runPending?: boolean;
  locale: "zh" | "en";
  onXhsStateChanged?: (state: XhsWorkflowState) => void;
  onXhsActionStatusChanged?: (pendingActionId: string, status: "pending" | "executed" | "reverted") => void;
  onAskAgent?: (prompt: string) => void;
  /** Latest unanswered turn: the question card stays tappable. */
  interactive?: boolean;
}) {
  const label = getAgentToolLabel(tool.name, locale);
  const isRunning = tool.result === undefined;
  const askUser = tool.name === "ask_user" && tool.result
    ? parseAskUserResult(tool.result)
    : null;

  if (askUser) {
    return (
      <div className="mb-3">
        <AgentQuestionCard
          questions={askUser.questions}
          locale={locale}
          interactive={interactive && !isRunning}
          onAnswer={(answer) => onAskAgent?.(answer)}
        />
      </div>
    );
  }
  const report = tool.name === "diagnose_xiaohongshu" && tool.result
    ? (tool.result as { report?: { accountSummary: string; scores: Array<{ dimension: string; score: number; comment: string }>; problems: Array<{ title: string; evidence: string; severity: string }>; actions: Array<{ title: string; detail: string; priority: string }>; contentSuggestions: string[] } }).report
    : undefined;
  const accountInvestigation = tool.name === "investigate_social_account" && tool.result
    ? (tool.result as { investigation?: AccountInvestigation }).investigation
    : undefined;
  const growthBriefing = (tool.name === "analyze_account_performance" || tool.name === "plan_next_content_experiment") && tool.result
    ? (tool.result as { briefing?: GrowthBriefing }).briefing
    : undefined;
  const growthMission = tool.name === "start_growth_mission" && tool.result
    ? (tool.result as { mission?: GrowthMission }).mission
    : undefined;
  const xhsResult = tool.result && typeof tool.result === "object" && "xhsCard" in tool.result
    ? tool.result
    : undefined;
  const memoryGovernance = tool.name === "inspect_memory_conflicts" && tool.result
    ? (tool.result as { memoryGovernance?: MemoryGovernanceReport }).memoryGovernance
    : undefined;
  const creatorStyleProfile = tool.result && typeof tool.result === "object" && "creatorStyleProfile" in tool.result
    ? creatorStyleProfileSchema.safeParse(tool.result.creatorStyleProfile)
    : null;

  if (creatorStyleProfile?.success) {
    return (
      <div className="mb-3">
        <CreatorStyleProfileCard
          profile={creatorStyleProfile.data}
          locale={locale}
          variant="surface"
          onAskAgent={onAskAgent}
        />
      </div>
    );
  }

  if (accountInvestigation) {
    return (
      <div className="mb-3">
        <AccountInvestigationReportCard
          investigation={accountInvestigation}
          locale={locale}
          variant="surface"
          onAskAgent={onAskAgent}
        />
      </div>
    );
  }

  if (xhsResult) {
    return (
      <div className="mb-3">
        <XhsToolResultCard
          result={xhsResult}
          runPending={runPending}
          locale={locale}
          onStateChanged={onXhsStateChanged}
          onActionStatusChanged={onXhsActionStatusChanged}
        />
      </div>
    );
  }

  // Routine tool steps live in the work panel. Keep results requiring a user
  // decision (including confirmation, upgrade, and undo) in the conversation.
  const actionResult = tool.result && typeof tool.result === "object"
    && ("confirmationRequired" in tool.result || "upgradeRequired" in tool.result || "auditId" in tool.result);
  if (!growthMission && !growthBriefing && !memoryGovernance && !report && !actionResult) return null;

  return (
    <div className="mb-3 rounded-xl border border-hairline bg-surface-2/45 p-3 text-sm">
      <div className="flex items-center gap-2 font-semibold text-fg">
        {isRunning ? <Loader2 className="h-3.5 w-3.5 animate-spin text-action" /> : <Wrench className="h-3.5 w-3.5 text-action" />}
        {label}
        {isRunning ? <span className="text-xs font-normal text-fg-subtle">{locale === "en" ? "running..." : "执行中..."}</span> : null}
      </div>

      {growthMission ? (
        <div className="mt-3 rounded-md border border-action/20 bg-action/[0.06] p-3">
          <p className="text-xs font-bold text-fg">{growthMission.title}</p>
          <p className="mt-1 text-[11px] leading-5 text-fg-muted">{growthMission.hypothesis}</p>
          <Link
            href={buildMissionWorkbenchHref(growthMission)}
            className="mt-3 inline-flex items-center gap-1.5 text-xs font-bold text-action hover:underline"
          >
            {locale === "en" ? "Execute in workbench" : "带着任务去工作台"}
            <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      ) : growthBriefing ? (
        <GrowthToolSummary briefing={growthBriefing} locale={locale} />
      ) : memoryGovernance ? (
        <MemoryGovernanceSummary report={memoryGovernance} locale={locale} />
      ) : report ? (
        <div className="mt-3 space-y-3 text-fg-muted">
          <p>{report.accountSummary}</p>
          {report.scores?.length > 0 && (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {report.scores.map((s) => (
                <div key={s.dimension} className="rounded-md border border-hairline bg-surface p-2 text-center">
                  <div className="text-lg font-bold text-action">{s.score}</div>
                  <div className="text-[11px] text-fg-muted">{s.dimension}</div>
                </div>
              ))}
            </div>
          )}
          {report.problems?.length > 0 && (
            <div>
              <p className="text-xs font-bold uppercase text-fg-subtle">{locale === "en" ? "Problems" : "问题"}</p>
              <ul className="mt-1 list-disc space-y-1 pl-4">
                {report.problems.map((p, i) => (
                  <li key={i}><span className="font-semibold text-fg">{p.title}</span> — {p.evidence}</li>
                ))}
              </ul>
            </div>
          )}
          {report.actions?.length > 0 && (
            <div>
              <p className="text-xs font-bold uppercase text-fg-subtle">{locale === "en" ? "Actions" : "行动建议"}</p>
              <ul className="mt-1 list-disc space-y-1 pl-4">
                {report.actions.map((a, i) => (
                  <li key={i}><span className="font-semibold text-fg">{a.title}</span> — {a.detail}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      ) : !isRunning && tool.result ? (
        <ToolResultSummary result={tool.result} locale={locale} />
      ) : null}
    </div>
  );
}

function MemoryGovernanceSummary({
  report,
  locale
}: {
  report: MemoryGovernanceReport;
  locale: "zh" | "en";
}) {
  if (report.status === "clear") {
    return <p className="mt-3 text-xs leading-5 text-positive">{locale === "en" ? "No direct Brand Memory conflicts were found." : "未发现可确定的品牌记忆冲突。"}</p>;
  }
  return (
    <div className="mt-3 rounded-md border border-warn/25 bg-warn/[0.06] p-3">
      <p className="text-xs font-bold text-warn">{locale === "en" ? "Memory needs review" : "品牌记忆需要复核"}</p>
      <p className="mt-1 text-[11px] leading-5 text-fg-muted">
        {locale === "en" ? "Only direct, verifiable conflicts are shown. Finfold has not changed your memory." : "这里只显示可验证的直接冲突；Finfold 尚未修改任何记忆。"}
      </p>
      <div className="mt-2 space-y-2">
        {report.conflicts.map((conflict) => (
          <div key={conflict.id} className="border-l-2 border-warn/65 pl-2.5">
            <p className="text-xs font-semibold text-fg">{conflict.title}</p>
            <p className="mt-0.5 text-[11px] leading-4 text-fg-muted">{conflict.detail}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

export function GrowthBriefingCard({
  briefing,
  loading,
  activeMission,
  missionStarting,
  locale,
  onRefresh,
  onStartMission,
  onAskAgent
}: {
  briefing: GrowthBriefing | null;
  loading: boolean;
  activeMission: GrowthMission | null;
  missionStarting: boolean;
  locale: "zh" | "en";
  onRefresh: () => void;
  onStartMission: () => void;
  onAskAgent: (prompt: string) => void;
}) {
  if (loading && !briefing) {
    return (
      <div className="mt-5 grid gap-3 rounded-xl border border-white/10 bg-black/20 p-4 lg:grid-cols-[1.45fr_0.75fr]">
        <div className="h-28 animate-pulse rounded-lg bg-white/[0.05]" />
        <div className="h-28 animate-pulse rounded-lg bg-white/[0.05]" />
      </div>
    );
  }
  if (!briefing) return null;

  const primary = briefing.priorities[0];
  const experiment = briefing.experiment;
  const askPrompt = experiment?.agentPrompt ?? (locale === "en"
    ? "Tell me exactly which analytics I need to import, then help me create a measurement-ready Xiaohongshu post."
    : "请告诉我需要补齐哪些真实数据，并帮我创建一篇可以完整测量的小红书内容。");
  const workbenchHref = experiment
    ? `/workbench?platform=${experiment.platform}&idea=${encodeURIComponent(experiment.workbenchIdea)}`
    : "/workbench";
  const missionHref = activeMission
    ? activeMission.kitId
      ? `/kits/${activeMission.kitId}`
      : buildMissionWorkbenchHref(activeMission)
    : workbenchHref;
  const assignmentTitle = activeMission?.title ?? primary?.title ?? briefing.headline;
  const assignmentEvidence = activeMission?.hypothesis ?? primary?.evidence ?? briefing.summary;
  const assignmentVariants = activeMission?.variants ?? experiment?.variants ?? [];

  return (
    <section className="mt-5 overflow-hidden rounded-xl border border-white/10 bg-[#0d0f14]">
      <div className="grid lg:grid-cols-[minmax(0,1.5fr)_minmax(280px,0.72fr)]">
        <div className="relative p-4 sm:p-5">
          <div className="absolute inset-y-0 left-0 w-0.5 bg-action" />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.18em] text-action">
              <Activity className="h-3.5 w-3.5" />
              {locale === "en" ? "On-duty briefing · live" : "今日值班简报 · 自动更新"}
            </div>
            <button
              type="button"
              onClick={onRefresh}
              disabled={loading}
              className="focus-ring inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-semibold text-white/40 transition hover:bg-white/5 hover:text-white disabled:opacity-40"
            >
              <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
              {locale === "en" ? "Refresh" : "刷新"}
            </button>
          </div>

          <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="text-lg font-bold leading-snug text-white sm:text-xl">{briefing.headline}</h2>
              <p className="mt-1.5 max-w-3xl text-sm leading-6 text-white/55">{briefing.summary}</p>
            </div>
            <div className="shrink-0 border-l border-white/10 pl-3">
              <p className="text-[10px] font-bold uppercase tracking-wider text-white/35">{briefing.northStar.label}</p>
              <p className="mt-1 font-mono text-2xl font-bold text-white">{briefing.northStar.value}</p>
              <p className="mt-0.5 text-[11px] text-white/40">{briefing.northStar.evidence}</p>
            </div>
          </div>

          <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
            {briefing.funnel.map((signal) => (
              <div key={signal.stage} className="rounded-md border border-white/10 bg-white/[0.025] px-3 py-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-semibold text-white/45">{signal.label}</span>
                  <span className={`h-1.5 w-1.5 rounded-full ${healthDot(signal.health)}`} />
                </div>
                <p className="mt-1 font-mono text-sm font-bold text-white/85">{signal.value}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="border-t border-white/10 bg-white/[0.025] p-4 sm:p-5 lg:border-l lg:border-t-0">
          <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.16em] text-white/38">
            <Target className="h-3.5 w-3.5 text-action" />
            {activeMission
              ? (locale === "en" ? "Active Growth Mission" : "进行中的 Growth Mission")
              : (locale === "en" ? "Today's assignment" : "智能体今日任务")}
          </div>
          <h3 className="mt-3 text-base font-bold text-white">{assignmentTitle}</h3>
          <p className="mt-1.5 text-xs leading-5 text-white/52">{assignmentEvidence}</p>
          {activeMission ? (
            <div className="mt-3 rounded-md border border-action/20 bg-action/[0.06] p-3">
              <div className="flex items-center justify-between gap-2 text-[10px] font-bold uppercase tracking-wider text-white/38">
                <span>{missionStatusLabel(activeMission.status, locale)}</span>
                <span>{activeMission.primaryMetric}</span>
              </div>
              <div className="mt-1.5 flex items-end gap-2 font-mono">
                <span className="text-sm font-bold text-white/50">{formatMissionMetric(activeMission.baselineValue)}</span>
                <span className="pb-0.5 text-[10px] text-white/28">→</span>
                <span className="text-xl font-black text-action">{formatMissionMetric(activeMission.targetValue)}</span>
              </div>
            </div>
          ) : null}
          {assignmentVariants.length > 0 ? (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {assignmentVariants.map((variant) => (
                <span key={variant.name} className="rounded-sm border border-action/20 bg-action/[0.08] px-2 py-1 text-[10px] font-semibold text-action">
                  {variant.name}
                </span>
              ))}
            </div>
          ) : briefing.missingData.length > 0 ? (
            <p className="mt-3 text-[11px] leading-5 text-warn">
              {locale === "en" ? "Missing: " : "待补数据："}{briefing.missingData.join(locale === "en" ? ", " : "、")}
            </p>
          ) : null}
          <div className="mt-4 grid gap-2">
            {activeMission ? (
              <Link href={missionHref} className="focus-ring inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-action/55 bg-action px-4 text-xs font-bold text-on-action transition hover:bg-action-strong">
                {activeMission.kitId
                  ? (locale === "en" ? "Continue mission" : "继续推进任务")
                  : (locale === "en" ? "Generate mission draft" : "生成任务内容")}
                <ArrowUpRight className="h-3.5 w-3.5" />
              </Link>
            ) : experiment ? (
              <button
                type="button"
                onClick={onStartMission}
                disabled={missionStarting}
                className="focus-ring inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-action/55 bg-action px-4 text-xs font-bold text-on-action transition hover:bg-action-strong disabled:cursor-wait disabled:opacity-60"
              >
                {missionStarting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Target className="h-3.5 w-3.5" />}
                {locale === "en" ? "Accept today's mission" : "接受今日任务"}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => onAskAgent(askPrompt)}
                className="focus-ring inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-action/55 bg-action px-4 text-xs font-bold text-on-action transition hover:bg-action-strong"
              >
                <Sparkles className="h-3.5 w-3.5" />
                {locale === "en" ? "Build the data loop" : "让智能体帮我补数据"}
              </button>
            )}
            <button
              type="button"
              onClick={() => onAskAgent(activeMission
                ? (locale === "en"
                    ? "Review my active Growth Mission and tell me the single next action."
                    : "复盘我当前进行中的 Growth Mission，只告诉我现在唯一要做的下一步。")
                : askPrompt)}
              className="btn-ghost justify-center text-xs"
            >
              <Sparkles className="h-3.5 w-3.5" />
              {activeMission
                ? (locale === "en" ? "Ask Agent for next action" : "让智能体推进下一步")
                : (locale === "en" ? "Let Agent explain the plan" : "让智能体展开方案")}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

function buildMissionWorkbenchHref(mission: GrowthMission): string {
  return `/workbench?missionId=${mission.id}&platform=${mission.platform}&idea=${encodeURIComponent(mission.workbenchIdea)}`;
}

function missionStatusLabel(status: GrowthMission["status"], locale: "zh" | "en"): string {
  const labels = locale === "en"
    ? {
        accepted: "Accepted · generate next",
        draft_ready: "Draft ready · publish next",
        posted: "Posted · waiting for metrics",
        completed: "Completed",
        dismissed: "Dismissed",
        superseded: "Superseded"
      }
    : {
        accepted: "已接受 · 下一步生成",
        draft_ready: "草稿已就绪 · 下一步发布",
        posted: "已发布 · 等待数据",
        completed: "已完成判定",
        dismissed: "已关闭",
        superseded: "已替换"
      };
  return labels[status];
}

function formatMissionMetric(value: number): string {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value);
}

function GrowthToolSummary({ briefing, locale }: { briefing: GrowthBriefing; locale: "zh" | "en" }) {
  return (
    <div className="mt-3 space-y-3 text-fg-muted">
      <p className="font-semibold text-fg">{briefing.headline}</p>
      <p className="text-xs leading-5">{briefing.summary}</p>
      <div className="grid gap-2 sm:grid-cols-2">
        {briefing.priorities.slice(0, 2).map((priority) => (
          <div key={priority.stage} className="rounded-md border border-hairline bg-surface p-2.5">
            <p className="text-xs font-bold text-fg">{priority.title}</p>
            <p className="mt-1 text-[11px] leading-4 text-fg-muted">{priority.evidence}</p>
          </div>
        ))}
      </div>
      {briefing.experiment ? (
        <div>
          <p className="flex items-center gap-1.5 text-xs font-bold uppercase text-fg-subtle">
            <BarChart3 className="h-3.5 w-3.5 text-action" />
            {locale === "en" ? "Next experiment" : "下一轮实验"}
          </p>
          <p className="mt-1 text-xs text-fg-muted">{briefing.experiment.hypothesis}</p>
          <p className="mt-1 text-[11px] text-action">
            {locale === "en" ? "Primary metric: " : "唯一主指标："}{briefing.experiment.primaryMetric}
          </p>
        </div>
      ) : null}
    </div>
  );
}

function healthDot(health: GrowthBriefing["funnel"][number]["health"]): string {
  if (health === "healthy") return "bg-positive shadow-[0_0_8px_rgba(70,180,120,0.55)]";
  if (health === "critical") return "bg-negative shadow-[0_0_8px_rgba(245,90,90,0.5)]";
  if (health === "warning") return "bg-warn shadow-[0_0_8px_rgba(236,180,70,0.5)]";
  return "bg-white/20";
}

function ToolResultSummary({ result, locale }: { result: unknown; locale: "zh" | "en" }) {
  const [undoing, setUndoing] = useState(false);
  const [undone, setUndone] = useState(false);
  const [undoError, setUndoError] = useState<string | null>(null);

  if (result && typeof result === "object" && "upgradeRequired" in result) {
    return <p className="mt-1 text-xs text-warn">{locale === "en" ? "Requires a paid plan." : "此操作需要付费套餐。"}</p>;
  }
  if (result && typeof result === "object" && "confirmationRequired" in result) {
    return <PendingAgentMutationCard result={result as Record<string, unknown>} locale={locale} />;
  }

  const auditId = result && typeof result === "object" && "auditId" in result && typeof result.auditId === "string"
    ? result.auditId
    : null;
  const undoFailedCopy = locale === "en" ? "Undo failed. Please try again." : "撤销没有完成，请重试。";
  if (auditId) {
    async function undo() {
      setUndoing(true);
      setUndoError(null);
      try {
        const response = await fetch(`/api/agent/actions/${auditId}/undo`, { method: "POST" });
        const data = (await response.json().catch(() => ({}))) as { undone?: boolean; error?: string };
        if (!response.ok || !data.undone) throw new Error(data.error ?? undoFailedCopy);
        setUndone(true);
      } catch (error) {
        setUndoError(error instanceof Error && error.message && !isTechnicalAgentErrorMessage(error.message)
          ? error.message
          : undoFailedCopy);
      } finally {
        setUndoing(false);
      }
    }

    return (
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span className="text-xs text-positive">{undone ? (locale === "en" ? "Change undone" : "已撤销更改") : (locale === "en" ? "Change saved and audited" : "更改已保存并记录")}</span>
        {!undone ? (
          <button
            type="button"
            onClick={() => void undo()}
            disabled={undoing}
            className="rounded-md border border-hairline px-2 py-1 text-xs font-semibold text-fg-muted transition hover:border-action/50 hover:text-fg disabled:opacity-50"
          >
            {undoing ? (locale === "en" ? "Undoing..." : "撤销中...") : (locale === "en" ? "Undo" : "撤销")}
          </button>
        ) : null}
        {undoError ? <span className="w-full text-xs text-risk">{undoError}</span> : null}
      </div>
    );
  }
  return null;
}
