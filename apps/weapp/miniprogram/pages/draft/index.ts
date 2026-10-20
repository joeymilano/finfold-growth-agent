import { api, type DraftSnapshot } from "../../utils/api";
import { getFinfoldApp, type PendingDraft } from "../../utils/global-data";
import { platformLabel, timeAgo } from "../../utils/format";

const app = getFinfoldApp();
const POLL_INTERVAL_MS = 2500;
const MAX_POLLS = 110; // 覆盖服务端四分钟超时结算

type HistoryItem = {
  id: string;
  title: string;
  platformText: string;
  dotClass: string;
  statusText: string;
  timeAgoText: string;
  content: string;
  contentText: string;
  expanded: boolean;
};

const PLATFORM_DOT: Record<string, string> = {
  wechat: "dot-rising",
  xiaohongshu: "dot-hot",
  moments: "dot-new"
};

Page({
  data: {
    formTitle: "",
    titleValid: false,
    formFact: "",
    platform: "wechat" as "wechat" | "xiaohongshu" | "moments",
    platformText: "公众号",
    generating: false,
    currentDraft: null as DraftSnapshot | null,
    creditsText: "…",
    history: [] as HistoryItem[]
  },

  pendingSource: "free" as PendingDraft["source"],
  pendingOpportunityId: undefined as string | undefined,
  pendingAngle: "",
  pendingKeywords: [] as string[],
  requestId: "",
  requestFingerprint: "",
  pollEpoch: 0,
  pollTimer: 0,
  pollCount: 0,
  activePollId: "" as string,

  onLoad() {
    this.consumePendingDraft();
  },

  onShow() {
    this.consumePendingDraft();
    // 生成中切走再回来：恢复轮询。draft 是 tabBar 页，不恢复就会把页面
    // 永久卡在 generating 态（输入全禁用、按钮短路）。
    if (this.activePollId) {
      this.startPolling(this.activePollId);
      this.refreshCredits();
      return;
    }
    this.refreshCredits();
    this.refreshHistory();
  },

  onHide() {
    this.stopPolling();
  },

  onUnload() {
    this.stopPolling();
    this.activePollId = "";
  },

  /** 雷达/详情页 switchTab 过来的待生成选题；返回 true 表示本次已消费。 */
  consumePendingDraft(): boolean {
    const pending = app.globalData.pendingDraft;
    if (!pending) return false;
    if (this.data.generating) return false;
    this.stopPolling();
    this.activePollId = "";
    this.setData({ currentDraft: null });
    app.globalData.pendingDraft = null;
    this.pendingAngle = pending.topic.angle ?? "";
    this.pendingKeywords = pending.topic.keywords ?? [];
    this.refreshCredits();
    this.pendingSource = pending.source;
    this.pendingOpportunityId = pending.opportunityId;
    this.setData({
      formTitle: pending.topic.title.slice(0, 120),
      titleValid: pending.topic.title.trim().length >= 2,
      formFact: (pending.topic.fact ?? "").slice(0, 600),
      platform: pending.platform,
      platformText: platformLabel(pending.platform)
    });
    return true;
  },

  async refreshCredits() {
    try {
      const me = await api.getMe();
      this.setData({ creditsText: String(me.credits) });
    } catch {
      this.setData({ creditsText: "—" });
    }
  },

  async refreshHistory() {
    try {
      const { drafts } = await api.listDrafts();
      this.setData({
        history: drafts.slice(0, 10).map((item) => ({
          id: item.id,
          title: item.title || "（未命名选题）",
          platformText: platformLabel(item.platform),
          dotClass: PLATFORM_DOT[item.platform] ?? "dot-cool",
          statusText: item.status === "ready" ? "已完成" : item.status === "pending" ? "生成中" : "失败",
          timeAgoText: timeAgo(item.createdAt),
          content: item.content ?? "",
          contentText: item.content
            ?? (item.status === "pending" ? "还在生成，稍后再来看。" : item.status === "failed" ? "生成失败，额度已退回。" : "暂无内容"),
          expanded: false
        }))
      });
    } catch {
      /* 历史加载失败不打断主流程 */
    }
  },

  onTitleInput(event: WechatMiniprogram.CustomEvent) {
    const formTitle = String(event.detail.value || "");
    this.setData({ formTitle, titleValid: formTitle.trim().length >= 2 });
  },

  onFactInput(event: WechatMiniprogram.CustomEvent) {
    this.setData({ formFact: String(event.detail.value || "") });
  },

  onPlatformChip(event: WechatMiniprogram.TouchEvent) {
    const platform = event.currentTarget.dataset.platform as "wechat" | "xiaohongshu" | "moments";
    if (this.data.generating) return;
    this.setData({ platform, platformText: platformLabel(platform) });
  },

  async generate() {
    const title = this.data.formTitle.trim();
    if (title.length < 2 || this.data.generating) return;
    this.setData({ generating: true, currentDraft: null });
    try {
      const fingerprint = JSON.stringify([title, this.data.formFact, this.data.platform, this.pendingOpportunityId, this.pendingAngle, this.pendingKeywords]);
      if (!this.requestId || this.requestFingerprint !== fingerprint) {
        this.requestId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
        this.requestFingerprint = fingerprint;
      }
      const created = await api.createDraft({
        requestId: this.requestId,
        source: this.pendingOpportunityId ? "opportunity" : "free",
        opportunityId: this.pendingOpportunityId,
        platform: this.data.platform,
        topic: {
          title,
          fact: this.data.formFact.trim() || undefined,
          angle: this.pendingAngle.slice(0, 300) || undefined,
          keywords: this.pendingKeywords.slice(0, 8).map((k) => k.slice(0, 24)).filter(Boolean)
        }
      });
      this.setData({ creditsText: String(created.available) });
      this.startPolling(created.id);
    } catch (error) {
      this.setData({ generating: false });
      wx.showToast({ title: error instanceof Error ? error.message : "创建失败", icon: "none", duration: 3000 });
    }
  },

  startPolling(id: string) {
    this.stopPolling();
    const epoch = this.pollEpoch;
    this.activePollId = id;
    this.pollCount = 0;
    const tick = async () => {
      this.pollCount += 1;
      try {
        const draft = await api.getDraft(id);
        if (epoch !== this.pollEpoch) return;
        if (draft.status !== "pending") {
          this.requestId = "";
          this.activePollId = "";
          this.setData({ generating: false, currentDraft: draft });
          if (typeof draft.available === "number") {
            this.setData({ creditsText: String(draft.available) });
          }
          this.refreshHistory();
          if (draft.status === "ready") {
            wx.vibrateShort({ type: "light" });
          }
          return;
        }
      } catch (error) {
        if (epoch !== this.pollEpoch) return;
        this.setData({ generating: false });
        wx.showToast({ title: error instanceof Error ? error.message : "查询失败", icon: "none" });
        return;
      }
      if (epoch !== this.pollEpoch) return;
      if (this.pollCount >= MAX_POLLS) {
        this.setData({ generating: false });
        wx.showToast({ title: "生成时间较长，稍后在历史里查看", icon: "none" });
        this.refreshHistory();
        return;
      }
      this.pollTimer = setTimeout(tick, POLL_INTERVAL_MS) as unknown as number;
    };
    this.pollTimer = setTimeout(tick, POLL_INTERVAL_MS) as unknown as number;
  },

  stopPolling() {
    this.pollEpoch += 1;
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = 0;
    }
  },

  copyContent() {
    const content = this.data.currentDraft?.content;
    if (!content) return;
    wx.setClipboardData({ data: content });
  },

  toggleHistory(event: WechatMiniprogram.TouchEvent) {
    const index = Number(event.currentTarget.dataset.index);
    const key = `history[${index}].expanded`;
    this.setData({ [key]: !this.data.history[index].expanded } as Record<string, boolean>);
  },

  copyHistory(event: WechatMiniprogram.TouchEvent) {
    const index = Number(event.currentTarget.dataset.index);
    const content = this.data.history[index]?.content;
    if (!content) return;
    wx.setClipboardData({ data: content });
  }
});
