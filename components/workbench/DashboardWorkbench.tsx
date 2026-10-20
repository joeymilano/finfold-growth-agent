"use client";

import {
  ArrowLeft,
  ArrowRight,
  Bot,
  CheckCircle2,
  ChevronDown,
  FileStack,
  Loader2,
  LogIn,
  Paperclip,
  RotateCcw,
  SlidersHorizontal,
  Square,
  WandSparkles,
  X
} from "@/components/ui/icons";
import Link from "next/link";
import { insufficientGenerationCredits } from "@/lib/workbench-gating";
import { BILLING_PATH, outOfCreditsActionLabel } from "@/lib/kit-credits";
import { useRouter } from "next/navigation";
import type { MouseEvent } from "react";
import { buildAuthHref } from "@/lib/auth-return";
import { applyLocale } from "@/lib/theme";
import { currentToolAttribution, readWorkbenchAuthDraft, saveWorkbenchAuthDraft, workbenchAuthDraftHref, pendingWorkbenchAuthDraftHref, WORKBENCH_AUTH_RETURN_EVENT, type WorkbenchAuthReturnRequest } from "@/lib/workbench-auth-draft";
import { loadPendingGeneration } from "@/lib/generation-run-client";
import { useCallback, useEffect, useRef, useState } from "react";
import { buttonStyles } from "@/components/ui/Button";
import { addToast } from "@/components/ui/Toast";
import { captureEvent } from "@/lib/posthog";
import { getBrandBrain } from "@/lib/brand-brain";
import { GoalSelector } from "@/components/workbench/GoalSelector";
import { IdeaInput } from "@/components/workbench/IdeaInput";
import { KitLifecycle } from "@/components/workbench/KitLifecycle";
import { MediaUploader } from "@/components/workbench/MediaUploader";
import { OutputBoard } from "@/components/workbench/OutputBoard";
import { SourceVisualCard } from "@/components/workbench/SourceVisualCard";
import { SourceCoverAutoRenderer } from "@/components/workbench/cover/SourceCoverAutoRenderer";
import { PerformancePanel } from "@/components/workbench/PerformancePanel";
import { PersonaSelector } from "@/components/workbench/PersonaSelector";
import { QualityScorePanel } from "@/components/workbench/QualityScorePanel";
import { PlatformSelector } from "@/components/workbench/PlatformSelector";
import { UpgradeGate } from "@/components/workbench/UpgradeGate";
import { useWorkbench } from "@/components/workbench/WorkbenchProvider";
import { dashboardCopy } from "@/lib/i18n";
import {
  getMobileGenerationEstimate,
  getMobileSourceGuidance,
  isMobileSourceReady,
  type MobileWorkbenchStep
} from "@/lib/mobile-workbench";
import {
  growthMissionIdSchema,
  platformIdSchema,
  researchMissionIdSchema,
  xhsWorkflowIdSchema
} from "@/lib/content-schema";
import { computeKitCost } from "@/lib/payment/types";
import { MAX_PLATFORMS_PER_GENERATION } from "@/lib/platforms";
import type { PlatformId } from "@/lib/platforms";
import { GrowthMissionBanner } from "@/components/workbench/GrowthMissionBanner";
import { OPEN_GLOBAL_AGENT_EVENT } from "@/lib/agent/presentation";
import {
  generationRunStepLabel,
  isGenerationRunActive
} from "@/lib/generation-run-client";
import { buildXhsWorkbenchSource } from "@/lib/agent/xhs-coaching";
import {
  buildResearchWorkbenchIdea,
  type ResearchMission
} from "@/lib/operations/research";
import {
  buildXhsWorkbenchHandoff,
  type XhsWorkflowState
} from "@/lib/agent/xhs-workflow";
import type { SourceImageCandidate } from "@/lib/source-image";

type WorkbenchBootstrap = {
  idea: string;
  platform: PlatformId | null;
  missionId: string | null;
  researchMissionId: string | null;
  workflowId: string | null;
  artifactVersionIds: string[];
  coachingLink: { programId: string; taskId: string } | null;
};

export function DashboardWorkbench() {
  const router = useRouter();
  const [authDraftError, setAuthDraftError] = useState(false);
  const [restoredAuthDraftId, setRestoredAuthDraftId] = useState<string | null>(null);
  const {
    locale,
    ideaText,
    setIdeaText,
    goal,
    setGoal,
    persona,
    setPersona,
    selectedPlatforms,
    setSelectedPlatforms,
    visualMode,
    setVisualMode,
    visualSource,
    setVisualSource,
    sourceImageCandidates,
    setSourceImageCandidates,
    mediaAssets,
    setMediaAssets,
    sourceAttachments,
    setSourceAttachments,
    outputs,
    activeKitId,
    growthMissionId,
    setGrowthMissionId,
    researchMissionId,
    setResearchMissionId,
    xhsWorkflowId,
    setXhsWorkflowId,
    artifactVersionIds,
    setArtifactVersionIds,
    usedContext,
    allowance,
    entitlement,
    canvasRestoreComplete,
    isLoading,
    isRecoveringGeneration,
    generationRun,
    error,
    errorCode,
    canGenerate,
    generateDisabledReason,
    currentKit,
    prepareFreshDraft,
    generateKit,
    cancelGeneration,
    dismissGenerationRun,
    onOutputSaved
  } = useWorkbench();

  // Generation is blocked only by the balance: offer the top-up path inline.
  const creditsShort = allowance.status === "ready" && Boolean(insufficientGenerationCredits(allowance.available, selectedPlatforms.length, locale));
  const topUpLink = creditsShort ? (
    <Link href={BILLING_PATH} className="ml-1 font-semibold text-action-strong underline dark:text-action">
      {outOfCreditsActionLabel(locale)}
    </Link>
  ) : null;

  const [gate, setGate] = useState<{ open: boolean; reason: "copy" | "export" | "save" | "analyze" | "iterate" }>({
    open: false,
    reason: "copy"
  });
  const [mobileStep, setMobileStep] = useState<MobileWorkbenchStep>(1);
  const [xhsCoachingLink, setXhsCoachingLink] = useState<{ programId: string; taskId: string } | null>(null);
  const [pendingBootstrap, setPendingBootstrap] = useState<WorkbenchBootstrap | null>(null);
  const [sourceImageLoading, setSourceImageLoading] = useState(false);
  const [sourceImageNoMatch, setSourceImageNoMatch] = useState(false);
  const didApplyUrlBootstrapRef = useRef(false);
  const lastSourceSearchRef = useRef("");


  useEffect(() => {
    if (ideaText.trim()) return;
    setSourceImageNoMatch(false);
    lastSourceSearchRef.current = "";
  }, [ideaText]);

  useEffect(() => {
    if (!restoredAuthDraftId || !activeKitId || outputs.length === 0) return;
    // Once a real kit is saved, refresh should restore that kit, not the old input.
    const url = new URL(window.location.href);
    if (url.searchParams.get("authDraft") === restoredAuthDraftId) {
      url.searchParams.delete("authDraft");
      window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
    }
  }, [restoredAuthDraftId, activeKitId, outputs.length]);

  const saveAuthReturnTo = useCallback(() => {
    const incomingDraftHref = pendingWorkbenchAuthDraftHref(window.location.href, restoredAuthDraftId);
    if (incomingDraftHref) return incomingDraftHref;
    const id = crypto.randomUUID();
    const toolAttribution = currentToolAttribution(ideaText);
    const saved = saveWorkbenchAuthDraft({
      toolAttribution,
      id, savedAt: Date.now(), locale, ideaText, goal, persona, platforms: selectedPlatforms,
      visualMode, visualSource, mediaAssets, sourceAttachments,
      growthMissionId, researchMissionId, xhsWorkflowId, artifactVersionIds
    });
    setAuthDraftError(!saved);
    if (!saved) return null;
    captureEvent("workbench_auth_requested", { draft_id: id, platform_count: selectedPlatforms.length, ...toolAttribution });
    return workbenchAuthDraftHref(id);
  }, [restoredAuthDraftId, locale, ideaText, goal, persona, selectedPlatforms, visualMode, visualSource, mediaAssets, sourceAttachments, growthMissionId, researchMissionId, xhsWorkflowId, artifactVersionIds]);

  useEffect(() => {
    function preserveStudio(event: Event) {
      const detail = (event as CustomEvent<WorkbenchAuthReturnRequest>).detail;
      if (!detail) return;
      const returnTo = saveAuthReturnTo();
      detail.failed = returnTo === null;
      if (returnTo) detail.returnTo = returnTo;
    }
    window.addEventListener(WORKBENCH_AUTH_RETURN_EVENT, preserveStudio);
    return () => window.removeEventListener(WORKBENCH_AUTH_RETURN_EVENT, preserveStudio);
  }, [saveAuthReturnTo]);

  function continueToAuth(event: MouseEvent<HTMLAnchorElement>) {
    event.preventDefault();
    const returnTo = saveAuthReturnTo();
    if (returnTo) router.push(buildAuthHref("/login", returnTo));
  }

  function applyBootstrap(bootstrap: WorkbenchBootstrap) {
    prepareFreshDraft();
    setIdeaText(bootstrap.idea);
    if (bootstrap.platform) setSelectedPlatforms([bootstrap.platform]);
    if (bootstrap.missionId) setGrowthMissionId(bootstrap.missionId);
    setResearchMissionId(bootstrap.researchMissionId);
    if (bootstrap.workflowId) setXhsWorkflowId(bootstrap.workflowId);
    if (bootstrap.artifactVersionIds.length > 0) setArtifactVersionIds(bootstrap.artifactVersionIds);
    if (bootstrap.coachingLink) setXhsCoachingLink(bootstrap.coachingLink);
  }

  useEffect(() => {
    if (!canvasRestoreComplete || didApplyUrlBootstrapRef.current || typeof window === "undefined") return;
    didApplyUrlBootstrapRef.current = true;
    captureEvent("workbench_viewed");

    const params = new URLSearchParams(window.location.search);
    const authDraftId = params.get("authDraft");
    if (authDraftId) {
      // A running task owns the canvas; an auth return must never overwrite it.
      if (loadPendingGeneration()?.runId) return;
      const saved = readWorkbenchAuthDraft(authDraftId);
      if (!saved) { setAuthDraftError(true); return; }
      prepareFreshDraft();
      setRestoredAuthDraftId(saved.id);
      applyLocale(saved.locale);
      setIdeaText(saved.ideaText); setGoal(saved.goal); setPersona(saved.persona);
      setSelectedPlatforms(saved.platforms); setVisualMode(saved.visualMode);
      setVisualSource(saved.visualSource); setMediaAssets(saved.mediaAssets);
      setSourceAttachments(saved.sourceAttachments); setGrowthMissionId(saved.growthMissionId);
      setResearchMissionId(saved.researchMissionId); setXhsWorkflowId(saved.xhsWorkflowId);
      setArtifactVersionIds(saved.artifactVersionIds);
      captureEvent("workbench_auth_draft_restored", { draft_id: saved.id, platform_count: saved.platforms.length, ...saved.toolAttribution });
      return;
    }
    const rawIdea = params.get("idea")?.trim() ?? "";
    const researchMissionResult = researchMissionIdSchema.safeParse(params.get("researchMissionId"));
    const platformResult = platformIdSchema.safeParse(params.get("platform"));
    const missionResult = growthMissionIdSchema.safeParse(params.get("missionId"));
    const workflowResult = xhsWorkflowIdSchema.safeParse(params.get("workflowId"));
    if (rawIdea.length < 20 && !researchMissionResult.success && !workflowResult.success) return;
    const artifactVersionIds = (params.get("artifactIds") ?? "")
      .split(",")
      .map((item) => item.trim())
      .filter((item) => xhsWorkflowIdSchema.safeParse(item).success)
      .slice(0, 12);
    const coachingProgramResult = xhsWorkflowIdSchema.safeParse(params.get("coachingProgramId"));
    const coachingTaskResult = xhsWorkflowIdSchema.safeParse(params.get("coachingTaskId"));
    const base: Omit<WorkbenchBootstrap, "idea"> = {
      platform: platformResult.success
        ? platformResult.data
        : researchMissionResult.success
          ? "xiaohongshu"
          : null,
      missionId: missionResult.success ? missionResult.data : null,
      researchMissionId: researchMissionResult.success ? researchMissionResult.data : null,
      workflowId: workflowResult.success ? workflowResult.data : null,
      artifactVersionIds,
      coachingLink: coachingProgramResult.success && coachingTaskResult.success
        ? { programId: coachingProgramResult.data, taskId: coachingTaskResult.data }
        : null
    };
    const offer = (
      idea: string,
      override: Partial<Omit<WorkbenchBootstrap, "idea">> = {},
      replaceCurrent = false
    ) => {
      const preparedIdea = idea.trim().length >= 20 ? idea : rawIdea;
      if (preparedIdea.trim().length < 20) return;
      const bootstrap = { ...base, ...override, idea: preparedIdea };
      if (!replaceCurrent && ideaText.trim().length >= 20 && ideaText.trim() !== bootstrap.idea.trim()) {
        setPendingBootstrap(bootstrap);
      } else {
        applyBootstrap(bootstrap);
      }
    };
    const incompleteWorkflowHandoff = workflowResult.success && (rawIdea.length < 20 || artifactVersionIds.length === 0);
    if (incompleteWorkflowHandoff) {
      const controller = new AbortController();
      void fetch(`/api/agent/xhs/state?locale=${locale}&workflowId=${encodeURIComponent(workflowResult.data)}`, {
        cache: "no-store",
        signal: controller.signal
      })
        .then(async (response) => {
          const data = await response.json().catch(() => ({})) as { state?: XhsWorkflowState };
          if (response.ok && data.state?.workflow?.id === workflowResult.data) {
            const handoff = buildXhsWorkbenchHandoff(data.state.workflow, data.state.artifacts);
            offer(handoff.idea, {
              platform: "xiaohongshu",
              missionId: handoff.missionId,
              workflowId: handoff.workflowId,
              artifactVersionIds: handoff.artifactVersionIds
            }, true);
            return;
          }
          if (rawIdea.length >= 20) {
            offer(rawIdea, {}, true);
            return;
          }
          addToast("error", locale === "en" ? "The approved task context could not be loaded. Return to the Agent and try again." : "未能载入已确认的任务素材，请返回智能体后重试。");
        })
        .catch((error) => {
          if (error instanceof DOMException && error.name === "AbortError") return;
          if (rawIdea.length >= 20) {
            offer(rawIdea, {}, true);
            return;
          }
          addToast("error", locale === "en" ? "The approved task context could not be loaded. Return to the Agent and try again." : "未能载入已确认的任务素材，请返回智能体后重试。");
        });
      return () => controller.abort();
    }
    if (workflowResult.success) {
      offer(rawIdea, {}, true);
      return;
    }
    if (researchMissionResult.success) {
      const controller = new AbortController();
      void fetch(`/api/operations/research/${encodeURIComponent(researchMissionResult.data)}`, {
        cache: "no-store",
        signal: controller.signal
      })
        .then(async (response) => {
          const data = await response.json().catch(() => ({})) as { mission?: ResearchMission };
          if (
            response.ok &&
            data.mission?.status === "ready" &&
            data.mission.decision
          ) {
            captureEvent("research_context_attached", {
              researchMissionId: data.mission.id,
              evidenceCount: data.mission.evidence.length
            });
            offer(buildResearchWorkbenchIdea(data.mission, locale));
            return;
          }
          offer(rawIdea);
        })
        .catch((error) => {
          if (error instanceof DOMException && error.name === "AbortError") return;
          offer(rawIdea);
        });
      return () => controller.abort();
    }
    const diagnosisResult = xhsWorkflowIdSchema.safeParse(params.get("diagnosisId"));
    if (!diagnosisResult.success) {
      offer(rawIdea);
      return;
    }

    const controller = new AbortController();
    void fetch(`/api/agent/xhs/diagnoses?id=${encodeURIComponent(diagnosisResult.data)}&limit=1`, {
      cache: "no-store",
      signal: controller.signal
    })
      .then(async (response) => {
        const data = await response.json().catch(() => ({})) as { diagnoses?: Array<{ input?: Record<string, unknown> }> };
        offer(response.ok ? buildXhsWorkbenchSource({ idea: rawIdea, diagnosisInput: data.diagnoses?.[0]?.input }) : rawIdea);
      })
      .catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        offer(rawIdea);
      });
    return () => controller.abort();
    // URL bootstrap intentionally runs once after the provider restores the durable canvas.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvasRestoreComplete]);

  useEffect(() => {
    if (isLoading) setMobileStep(3);
  }, [isLoading]);

  const copy = dashboardCopy[locale];
  const sourceReady = isMobileSourceReady(ideaText, sourceAttachments.length);
  const sourceGuidance = getMobileSourceGuidance(ideaText, locale, sourceAttachments.length);
  const estimatedSeconds = getMobileGenerationEstimate(selectedPlatforms.length);
  const effectivePlatformSelectionLimit = Math.min(
    entitlement.platformLimit ?? MAX_PLATFORMS_PER_GENERATION,
    MAX_PLATFORMS_PER_GENERATION
  );
  const persistedKitId = activeKitId && activeKitId !== "showcase-kit" && activeKitId !== "draft-package" ? activeKitId : null;
  const kitHref = persistedKitId ? `/kits/${persistedKitId}` : "/packages";

  const selectSourceImage = useCallback(async (candidate: SourceImageCandidate) => {
    setSourceImageLoading(true);
    try {
      const response = await fetch("/api/source-assets/cache", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ selectionToken: candidate.selectionToken })
      });
      const data = await response.json().catch(() => ({})) as { asset?: typeof visualSource; error?: string };
      if (!response.ok || !data.asset) throw new Error(data.error ?? "Image caching failed.");
      setVisualMode("source_first");
      setVisualSource(data.asset);
      setSourceImageNoMatch(false);
      captureEvent("source_image_selected", {
        provider: data.asset.provider,
        domain: data.asset.domain,
        confidence: data.asset.confidence
      });
    } catch (caught) {
      addToast("error", caught instanceof Error ? caught.message : (locale === "en" ? "Could not save this source image." : "未能保存这张来源图片。"));
    } finally {
      setSourceImageLoading(false);
    }
  }, [locale, setVisualMode, setVisualSource]);

  const applySourceImageCandidates = useCallback((candidates: SourceImageCandidate[]) => {
    setVisualMode("source_first");
    setSourceImageCandidates(candidates);
    setSourceImageNoMatch(candidates.length === 0);
    const best = candidates[0];
    if (best?.confidence === "high") void selectSourceImage(best);
  }, [selectSourceImage, setSourceImageCandidates, setVisualMode]);

  useEffect(() => {
    if (visualMode !== "source_first" || visualSource || sourceImageCandidates.length > 0 || ideaText.trim().length < 20 || isLoading) return;
    const query = ideaText.trim();
    if (query === lastSourceSearchRef.current || /https?:\/\//i.test(query)) return;
    const timer = window.setTimeout(() => {
      lastSourceSearchRef.current = query;
      setSourceImageLoading(true);
      void fetch("/api/source-assets/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query })
      })
        .then(async (response) => {
          const data = await response.json().catch(() => ({})) as { status?: string; imageCandidates?: SourceImageCandidate[]; candidates?: SourceImageCandidate[] };
          if (!response.ok) return;
          const candidates = data.imageCandidates ?? data.candidates ?? [];
          setSourceImageCandidates(candidates);
          setSourceImageNoMatch(data.status === "no_match" || data.status === "not_applicable");
          if (candidates[0]?.confidence === "high") await selectSourceImage(candidates[0]);
        })
        .finally(() => setSourceImageLoading(false));
    }, 1200);
    return () => window.clearTimeout(timer);
  }, [ideaText, isLoading, selectSourceImage, setSourceImageCandidates, sourceImageCandidates.length, visualMode, visualSource]);


  const mobileStepCopy = {
    1: {
      title: locale === "en" ? "Add source" : "添加内容",
      subtitle: locale === "en" ? "Start with one source Finfold can adapt." : "先给 Finfold 一份源素材"
    },
    2: {
      title: locale === "en" ? "Choose platforms" : "选择发布平台",
      subtitle: locale === "en" ? "Pick channels, then generate them together." : "先选渠道，下一步一次生成"
    },
    3: {
      title: locale === "en" ? "Generate & edit" : "生成与编辑",
      subtitle: locale === "en" ? "Switch platforms and refine each draft." : "切换平台，继续编辑每一份草稿"
    }
  } as const;

  function goToMobileStep(step: MobileWorkbenchStep) {
    setMobileStep(step);
    captureEvent("workbench_mobile_step_viewed", { step });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function startMobileGeneration() {
    if (!canGenerate) return;
    goToMobileStep(3);
    await generateKit();
  }


  function openAgent() {
    window.dispatchEvent(new Event(OPEN_GLOBAL_AGENT_EVENT));
  }

  function reviewMediaAssets() {
    goToMobileStep(1);
    window.requestAnimationFrame(() => {
      const section = document.getElementById("workbench-media");
      if (section instanceof HTMLDetailsElement) section.open = true;
      section?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }

  return (
    <div className="workspace-studio grid min-w-0 gap-4 pb-40 lg:pb-10">
      {pendingBootstrap ? (
        <section role="status" className="flex flex-col gap-3 rounded-xl border border-warning/35 bg-warning/8 p-4 shadow-panel sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-black text-fg">{locale === "en" ? "Keep your current draft?" : "保留当前草稿？"}</p>
            <p className="mt-1 text-xs leading-5 text-fg-muted">{locale === "en" ? "Finfold prepared new task context. It will not replace what you are editing without confirmation." : "Finfold 已准备新的任务素材，确认前不会覆盖你正在编辑的内容。"}</p>
          </div>
          <div className="flex shrink-0 gap-2">
            <button type="button" className={buttonStyles({ variant: "tertiary", size: "sm" })} onClick={() => setPendingBootstrap(null)}>
              {locale === "en" ? "Keep current" : "保留当前"}
            </button>
            <button type="button" className={buttonStyles({ variant: "primary", size: "sm" })} onClick={() => { applyBootstrap(pendingBootstrap); setPendingBootstrap(null); }}>
              {locale === "en" ? "Use Finfold context" : "使用新素材"}
            </button>
          </div>
        </section>
      ) : null}
      {xhsCoachingLink ? (
        <section data-testid="xhs-coaching-workbench-context" className="flex flex-col gap-3 rounded-xl border border-action/30 bg-[linear-gradient(120deg,rgb(var(--action)/0.1),rgb(var(--surface)/0.94))] p-4 shadow-panel sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="eyebrow">{locale === "en" ? "Xiaohongshu coaching experiment" : "小红书陪跑实验"}</p>
            <p className="mt-1 text-sm font-bold text-fg">
              {locale === "en" ? "This draft is attached to one confirmed coaching variable." : "这份草稿已带入本日任务和唯一实验变量。"}
            </p>
            <p className="mt-1 text-xs text-fg-muted">
              {locale === "en" ? "You review and publish it yourself, then return proof to the coaching task." : "由你确认并亲自发布，完成后回到陪跑任务提交证明。"}
            </p>
          </div>
          <Link href="/operations/xiaohongshu" className={buttonStyles({ variant: "secondary", size: "sm" })}>
            {locale === "en" ? "Back to coaching" : "返回小红书陪跑"}
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </section>
      ) : xhsWorkflowId ? (
        <section className="flex flex-col gap-3 rounded-xl border border-action/25 bg-[linear-gradient(120deg,rgb(var(--action)/0.08),rgb(var(--surface)/0.94))] p-4 shadow-panel sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="eyebrow">{locale === "en" ? "Xiaohongshu Agent workflow" : "小红书智能体工作流"}</p>
            <p className="mt-1 text-sm font-bold text-fg">
              {locale === "en" ? "The approved topic, title, and visual direction will stay attached to this kit." : "已确认的选题、标题与视觉方向会随内容包一起保存。"}
            </p>
            <p className="mt-1 text-xs text-fg-muted">
              {locale === "en" ? `${artifactVersionIds.length} confirmed versions linked` : `已关联 ${artifactVersionIds.length} 个已确认版本`}
            </p>
          </div>
          <Link href="/dashboard" className={buttonStyles({ variant: "secondary", size: "sm" })}>
            {locale === "en" ? "Back to Agent" : "返回增长智能体"}
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </section>
      ) : null}
      {growthMissionId ? <GrowthMissionBanner missionId={growthMissionId} locale={locale} /> : null}
      {researchMissionId ? (
        <section data-testid="research-workbench-context" className="flex flex-col gap-3 rounded-xl border border-action/30 bg-[linear-gradient(120deg,rgb(var(--action)/0.1),rgb(var(--surface)/0.94))] p-4 shadow-panel sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="eyebrow">{locale === "en" ? "Approved Research intelligence" : "已确认的 Research 情报"}</p>
            <p className="mt-1 text-sm font-bold text-fg">
              {locale === "en" ? "Evidence will shape the topic, hook, objections, and structure." : "证据将用于决定选题、钩子、用户异议与内容结构。"}
            </p>
            <p className="mt-1 text-xs text-fg-muted">
              {locale === "en" ? "External observations remain hypotheses. Review every claim before publishing." : "外部观察仍是待验证假设；发布前请逐条确认事实与表述。"}
            </p>
          </div>
          <Link href="/operations/research" className={buttonStyles({ variant: "secondary", size: "sm" })}>
            {locale === "en" ? "Back to Research" : "返回调研中心"}
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </section>
      ) : null}
      <header className="workspace-page-header">
        <div><h1>{locale === "en" ? "Studio" : "创作台"}</h1><p>{locale === "en" ? "One idea. Ready for every channel." : "一个想法，变成各平台的好内容。"}</p></div>
        <div className="flex items-center gap-2">
          <button type="button" className="focus-ring workspace-action" onClick={openAgent}><Bot className="h-4 w-4" />{locale === "en" ? "Ask Finfold" : "问 Finfold"}</button>
          <Link href="/packages" className="focus-ring workspace-action"><FileStack className="h-4 w-4" />{locale === "en" ? "Library" : "内容库"}</Link>
        </div>
      </header>

      {authDraftError ? <p role="alert" className="rounded-xl border border-hairline p-4 text-sm text-risk">{locale === "en" ? "We could not save or restore this draft. Keep a copy of your text and files, and allow browser storage before continuing. Unsaved local images need to be uploaded again after login." : "草稿暂时无法保存或恢复。请先备份文字和文件，并允许浏览器存储后继续；未保存的本地图片需在登录后重新上传。"}</p> : null}
      {generationRun && !isLoading ? (
        <section
          data-trace-id={generationRun.traceId}
          className={`flex flex-col gap-3 rounded-xl border p-4 shadow-panel sm:flex-row sm:items-center sm:justify-between ${
            isGenerationRunActive(generationRun)
              ? "border-action/30 bg-action/[0.08]"
              : "border-risk/30 bg-risk/10"
          }`}
          role="status"
        >
          <div className="flex min-w-0 items-start gap-3">
            <span
              className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
                isGenerationRunActive(generationRun)
                  ? "bg-action/[0.12] text-action-strong dark:text-action"
                  : "bg-risk/15 text-risk"
              }`}
            >
              {isGenerationRunActive(generationRun) ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RotateCcw className="h-4 w-4" />
              )}
            </span>
            <div className="min-w-0">
              <p className="text-sm font-bold text-fg">
                {isGenerationRunActive(generationRun)
                  ? generationRunStepLabel(generationRun.currentStep, locale)
                  : locale === "en"
                    ? "Generation interrupted"
                    : "生成已中断"}
              </p>
              <p className="mt-1 text-xs leading-5 text-fg-muted">
                {isGenerationRunActive(generationRun)
                  ? isRecoveringGeneration
                    ? locale === "en"
                      ? "Checking the durable run and restoring progress…"
                      : "正在查询任务记录并恢复进度…"
                    : locale === "en"
                      ? "This task is still active. Finfold will restore the saved kit when it completes."
                      : "任务仍在执行，完成后会自动恢复已保存的内容包。"
                  : generationRun.creditsRefunded
                    ? locale === "en"
                      ? "The Credits reserved for this attempt were returned. You can retry safely."
                      : "本次预扣的创作点数已经退回，可以安全重试。"
                    : locale === "en"
                      ? "No duplicate charge will be created. Retry when you are ready."
                      : "不会产生重复扣费，你可以准备好后重新生成。"}
              </p>
            </div>
          </div>
          {isGenerationRunActive(generationRun) ? (
            <button
              type="button"
              onClick={() => void cancelGeneration()}
              className="focus-ring inline-flex shrink-0 items-center gap-2 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs font-semibold text-red-600 dark:text-red-300"
            >
              <Square className="h-3.5 w-3.5 fill-current" />
              {locale === "en" ? "Cancel task" : "取消任务"}
            </button>
          ) : (
            <div className="flex shrink-0 items-center gap-2">
              {generationRun.error?.retryable ? (
                <button
                  type="button"
                  onClick={() => void generateKit()}
                  disabled={!canGenerate}
                  className={buttonStyles({ variant: "primary", size: "sm" })}
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  {locale === "en" ? "Retry safely" : "安全重试"}
                </button>
              ) : null}
              <button
                type="button"
                onClick={dismissGenerationRun}
                aria-label={locale === "en" ? "Dismiss" : "关闭"}
                className="focus-ring flex h-9 w-9 items-center justify-center rounded-md border border-hairline bg-surface text-fg-muted"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          )}
        </section>
      ) : null}

      <section className="grid gap-4 lg:hidden">
        <div className="flex items-center justify-between gap-3">
          {mobileStep > 1 ? (
            <button
              type="button"
              onClick={() => goToMobileStep((mobileStep - 1) as MobileWorkbenchStep)}
              disabled={isLoading}
              aria-label={locale === "en" ? "Previous step" : "返回上一步"}
              className="focus-ring flex h-9 w-9 items-center justify-center rounded-lg border border-hairline bg-surface text-fg disabled:opacity-40"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
          ) : (
            <span className="text-base font-medium text-fg">{locale === "en" ? "Studio" : "创作台"}</span>
          )}
          <button type="button" className="focus-ring workspace-action" onClick={openAgent}><Bot className="h-4 w-4" />{locale === "en" ? "Ask Finfold" : "问 Finfold"}</button>
        </div>

        <div className="grid grid-cols-[1.5fr_1fr_1fr] gap-1.5" aria-label={locale === "en" ? `Step ${mobileStep} of 3` : `第 ${mobileStep} 步，共 3 步`}>
          {[1, 2, 3].map((step) => (
            <span
              key={step}
              className={`h-1 rounded-full transition-colors ${
                step <= mobileStep ? "bg-action" : "bg-hairline"
              }`}
            />
          ))}
        </div>

        <div>
          <h1 className="text-2xl font-medium tracking-tight text-fg">{mobileStepCopy[mobileStep].title}</h1>

          {mobileStep === 3 && currentKit ? (
            <div className="mt-3">
              <KitLifecycle kit={currentKit} locale={locale} compact />
            </div>
          ) : null}
          {mobileStep === 1 && outputs.length > 0 ? (
            <button
              type="button"
              onClick={() => goToMobileStep(3)}
              className="focus-ring mt-3 inline-flex items-center gap-1.5 rounded-full border border-hairline bg-surface px-3 py-1.5 text-xs font-semibold text-fg-muted transition hover:border-action/40 hover:text-fg"
            >
              <FileStack className="h-3.5 w-3.5 text-action-strong dark:text-action" />
              {locale === "en" ? `Resume ${outputs.length} existing drafts` : `继续编辑已有的 ${outputs.length} 份内容`}
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>
      </section>

      <section className="workspace-studio-grid">
        <div className="workspace-studio-inputs">
        <div id="workbench-source" className={`${mobileStep === 1 ? "grid" : "hidden"} workspace-studio-source scroll-mt-20 lg:grid`}>

          <IdeaInput
            value={ideaText}
            onChange={setIdeaText}
            locale={locale}
            attachments={sourceAttachments}
            onAttachmentsChange={setSourceAttachments}
            onSourceImagesDiscovered={({ imageCandidates }) => applySourceImageCandidates(imageCandidates)}
            disabled={isLoading}
          />
          <details id="workbench-media" className="workspace-studio-details group">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-3 text-sm font-semibold text-fg-muted transition hover:text-fg">
              <span className="flex min-w-0 flex-1 items-center gap-2"><Paperclip className="h-4 w-4 shrink-0" /><span className="break-words">{locale === "en" ? "Media" : "图片与视频"}</span></span>
              <ChevronDown className="h-4 w-4 shrink-0 transition group-open:rotate-180" />
            </summary>
            <div className="px-3 pb-3">
              <MediaUploader assets={mediaAssets} onChange={setMediaAssets} locale={locale} selectedPlatforms={selectedPlatforms} disabled={isLoading} />
            </div>
          </details>
        </div>

        <div className={`${mobileStep === 2 ? "grid" : "hidden"} workspace-studio-settings lg:grid`}>


          <div className="flex min-w-0 items-center gap-2.5 rounded-lg border border-hairline bg-surface p-2.5 lg:hidden">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-action/[0.12] text-action-strong dark:text-action">
              <CheckCircle2 className="h-4 w-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-xs font-semibold text-fg">{locale === "en" ? "Source ready" : "源素材已就绪"}</span>
              <span className="mt-0.5 block truncate text-[11px] text-fg-muted">
                {ideaText.trim().length} {locale === "en" ? "characters" : "字"}
                {sourceAttachments.length > 0 ? ` · ${sourceAttachments.length} ${locale === "en" ? "source files" : "份源文件"}` : ""}
                {mediaAssets.length > 0 ? ` · ${mediaAssets.length} ${locale === "en" ? "media files" : "份素材"}` : ""}
              </span>
            </span>
            <button type="button" onClick={() => goToMobileStep(1)} className="focus-ring rounded-md px-2 py-1 text-xs font-semibold text-action-strong dark:text-action">
              {locale === "en" ? "Edit" : "编辑"}
            </button>
          </div>

          <PlatformSelector
            value={selectedPlatforms}
            onChange={setSelectedPlatforms}
            locale={locale}
            disabled={isLoading}
            maxSelection={effectivePlatformSelectionLimit}
          />
          <div className="workspace-studio-generate">
            {isLoading ? (
              <button type="button" onClick={cancelGeneration} className="focus-ring items-center justify-center gap-2 rounded-md border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm font-semibold text-red-300 transition hover:border-red-500/60 hover:bg-red-500/20">
                <Square className="h-3 w-3 fill-current" />
                {locale === "en" ? "Cancel" : "取消生成"}
              </button>
            ) : !entitlement.authenticated ? (
              <Link href={buildAuthHref("/login", "/workbench")} onClick={continueToAuth} data-testid="generate-login-desktop" className={`${buttonStyles({ variant: "primary", size: "md" })}`}>
                <LogIn className="h-4 w-4" />
                {locale === "en" ? "Log in & generate" : "登录并生成"}
                <ArrowRight className="h-4 w-4" />
              </Link>
            ) : (
              <button type="button" data-testid="generate-kit-desktop" onClick={() => void generateKit()} disabled={!canGenerate} title={!canGenerate && generateDisabledReason ? generateDisabledReason : undefined} className={`${buttonStyles({ variant: "primary", size: "md" })} whitespace-nowrap`}>
                <WandSparkles className="h-4 w-4" />
                {copy.generate} <span className="opacity-80">· ~{computeKitCost(selectedPlatforms.length, { images: visualMode === "ai_generate" ? selectedPlatforms.length : 0 })} {locale === "en" ? "Credits" : "点数"}</span> <ArrowRight className="h-4 w-4" />
              </button>
            )}
            {!canGenerate && generateDisabledReason && !isLoading && entitlement.authenticated ? <p className="text-xs text-fg-muted" role="status">{generateDisabledReason}{topUpLink}</p> : null}
          </div>
          <details className="workspace-studio-details group">
            <summary>{locale === "en" ? "Cover image" : "配图"}<ChevronDown className="h-3.5 w-3.5" /></summary>
            <div className="px-3 pb-3">
          <SourceVisualCard
            locale={locale}
            mode={visualMode}
            source={visualSource}
            candidates={sourceImageCandidates}
            loading={sourceImageLoading}
            noMatch={sourceImageNoMatch}
            disabled={isLoading}
            canGenerateAi={entitlement.plan !== "free"}
            platformCount={selectedPlatforms.length}
            onModeChange={(mode) => {
              setVisualMode(mode);
              if (mode === "none" || mode === "ai_generate") setVisualSource(null);
            }}
            onSelect={(candidate) => void selectSourceImage(candidate)}
          />
            </div>
          </details>
          <details className="workspace-studio-details group">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2.5 text-sm font-semibold text-fg-muted transition hover:text-fg">
              <span className="flex min-w-0 flex-1 items-center gap-2"><SlidersHorizontal className="h-4 w-4 shrink-0" /><span className="break-words">{locale === "en" ? "Tone & goal" : "语气与目标"}</span></span>
              <ChevronDown className="h-4 w-4 shrink-0 transition group-open:rotate-180" />
            </summary>
            <div className="grid gap-3 px-3 pb-3">
              <PersonaSelector value={persona} onChange={setPersona} locale={locale} disabled={isLoading} />
              <GoalSelector value={goal} onChange={setGoal} locale={locale} disabled={isLoading} />
            </div>
          </details>
        </div>

        </div>

        <div className={`${mobileStep === 3 ? "grid" : "hidden"} min-w-0 grid-cols-[minmax(0,1fr)] content-start gap-4 lg:grid`}>
          <OutputBoard
            workspace
            outputs={outputs}
            isLoading={isLoading}
            isRunActive={generationRun ? isGenerationRunActive(generationRun) : false}
            error={error}
            errorCode={errorCode}
            locale={locale}
            canUseOutputs={entitlement.canUseOutputs}
            canPolish={entitlement.polish}
            platformCount={selectedPlatforms.length}
            expectedPlatforms={selectedPlatforms}
            usedContext={usedContext}
            onLockedAction={(reason) => setGate({ open: true, reason })}
            kitId={persistedKitId ?? undefined}
            growthMissionId={growthMissionId ?? undefined}
            mediaAssets={mediaAssets}
            onReviewMedia={reviewMediaAssets}
            onOutputSaved={onOutputSaved}
            referenceImageUrl={mediaAssets.find((asset) => asset.type === "image" && asset.url)?.url}
          />
          <SourceCoverAutoRenderer
            kitId={persistedKitId ?? undefined}
            outputs={outputs}
            locale={locale}
            onOutputSaved={onOutputSaved}
          />

        </div>
      </section>

      {outputs.length > 0 && !isLoading ? (
        <details className={`${mobileStep === 3 ? "block" : "hidden"} workspace-studio-details lg:block`}>
          <summary>{locale === "en" ? "Quality & performance" : "质量与表现"}<ChevronDown className="h-4 w-4" /></summary>
          <div className="grid gap-4 p-4">
            <QualityScorePanel outputs={outputs} brain={getBrandBrain()} locale={locale} />
            <PerformancePanel kit={currentKit} locale={locale} canAnalyze={entitlement.canAnalyze} onLockedAction={(reason) => setGate({ open: true, reason })} />
          </div>
        </details>
      ) : null}

      <div className="workspace-mobile-actions fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-30 border-t border-hairline bg-surface/95 px-3 py-3 backdrop-blur-xl lg:hidden">
        <div className="mx-auto grid max-w-xl gap-2">
          {mobileStep === 1 ? (
            <>
              <p className={`text-[11px] font-medium ${sourceReady ? "text-positive" : "text-fg-muted"}`}>{sourceGuidance}</p>
              <button type="button" onClick={() => goToMobileStep(2)} disabled={!sourceReady || isLoading} className={buttonStyles({ variant: "secondary", size: "lg", fullWidth: true })}>
                {locale === "en" ? "Next · Choose platforms" : "下一步 · 选择平台"}
                <ArrowRight className="h-4 w-4" />
              </button>
            </>
          ) : mobileStep === 2 ? (
            <>
              <div className="flex items-center justify-between gap-3 text-[11px] text-fg-muted">
                <span className="whitespace-nowrap">{selectedPlatforms.length} {locale === "en" ? "platforms selected" : "个平台已选"}</span>
                <span className="font-semibold text-brand whitespace-nowrap">~{computeKitCost(selectedPlatforms.length, { images: visualMode === "ai_generate" ? selectedPlatforms.length : 0 })} {locale === "en" ? "Credits" : "点数"}</span>
                <span className="whitespace-nowrap">{locale === "en" ? `~${estimatedSeconds}s` : `约 ${estimatedSeconds} 秒`}</span>
              </div>
              {!entitlement.authenticated ? (
                <Link href={buildAuthHref("/login", "/workbench")} onClick={continueToAuth} data-testid="generate-login-mobile" className={buttonStyles({ variant: "primary", size: "lg", fullWidth: true })}>
                  <LogIn className="h-4 w-4" />
                  {locale === "en" ? "Log in & generate" : "登录并生成"}
                </Link>
              ) : (
                <button type="button" data-testid="generate-kit-mobile" onClick={() => void startMobileGeneration()} disabled={!canGenerate} title={!canGenerate && generateDisabledReason ? generateDisabledReason : undefined} className={buttonStyles({ variant: "primary", size: "lg", fullWidth: true })}>
                  <WandSparkles className="h-4 w-4" />
                  {locale === "en" ? `Generate for ${selectedPlatforms.length} platforms` : `生成 ${selectedPlatforms.length} 个平台内容`}
                </button>
              )}
              {entitlement.authenticated && !canGenerate && generateDisabledReason ? <p className="text-[11px] font-medium text-amber-700 dark:text-amber-400">{generateDisabledReason}{topUpLink}</p> : null}
            </>
          ) : isLoading ? (
            <button type="button" onClick={cancelGeneration} className="focus-ring inline-flex w-full items-center justify-center gap-2 rounded-md border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm font-semibold text-red-600 transition dark:text-red-300">
              <Square className="h-3.5 w-3.5 fill-current" />
              {locale === "en" ? "Cancel generation" : "取消生成"}
            </button>
          ) : outputs.length > 0 ? (
            <>
              <Link href={kitHref} className={buttonStyles({ variant: "secondary", size: "lg", fullWidth: true })}>
                <FileStack className="h-4 w-4" />
                {persistedKitId ? (locale === "en" ? "Open content kit" : "打开内容包") : (locale === "en" ? "View content library" : "查看内容库")}
              </Link>

            </>
          ) : (
            <button type="button" onClick={() => goToMobileStep(2)} className={buttonStyles({ variant: "tertiary", size: "lg", fullWidth: true })}>
              <ArrowLeft className="h-4 w-4" />
              {locale === "en" ? "Back to platform settings" : "返回平台设置"}
            </button>
          )}
        </div>
      </div>

      <UpgradeGate open={gate.open} locale={locale} reason={gate.reason} authenticated={entitlement.authenticated} onClose={() => setGate((current) => ({ ...current, open: false }))} />
    </div>
  );
}
