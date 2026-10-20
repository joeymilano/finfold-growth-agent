import { api, fetchWxaCode, type OpportunityCard } from "../../utils/api";
import { getFinfoldApp } from "../../utils/global-data";
import { lifecycleClass, lifecycleLabel, platformLabel, timeAgo } from "../../utils/format";

type DetailData = OpportunityCard & {
  rankScore: number;
  matchDimensions: { matchedTerms: string[] };
};

const app = getFinfoldApp();

Page({
  data: {
    loaded: false,
    shared: false,
    errorText: "",
    sharing: false,
    shareReady: false,
    title: "",
    fact: "",
    whyNow: "",
    whyYou: "",
    mainAngle: "",
    alternateAngles: [] as string[],
    recommendedPlatform: "",
    recommendedFormat: "",
    matchScore: 0,
    lifecycle: "",
    lifecycleLabel: "",
    lifecycleClass: "",
    timeAgoText: "",
    platformText: "",
    matchedTerms: [] as string[],
    matchedTermsText: "",
    evidence: [] as Array<{ title: string; url: string; source: string; sourceLabel: string }>,
    opportunityId: ""
  },

  onLoad(query: Record<string, string | undefined>) {
    wx.hideShareMenu();
    let token = query.s ?? "";
    try { token = token || decodeURIComponent(query.scene ?? "").replace(/^s=/, ""); } catch { /* invalid scene */ }
    if (/^[A-Za-z0-9_-]{22}$/.test(token)) {
      this.shareToken = token;
      this.setData({ shared: true });
      this.loadShared(token);
      return;
    }
    const id = query.id ?? "";
    if (!id) {
      this.setData({ errorText: "选题链接无效，请返回今日机会。" });
      return;
    }
    this.setData({ opportunityId: id });
    this.loadDetail(id);
  },

  async loadDetail(id: string) {
    try {
      const detail = await api.getOpportunity(id);
      this.setData({
        loaded: true,
        title: detail.title,
        fact: detail.fact,
        whyNow: detail.whyNow,
        whyYou: detail.whyYou,
        mainAngle: detail.mainAngle,
        alternateAngles: detail.alternateAngles ?? [],
        recommendedPlatform: detail.recommendedPlatform,
        recommendedFormat: detail.recommendedFormat,
        matchScore: detail.matchScore,
        lifecycle: detail.lifecycle,
        lifecycleLabel: lifecycleLabel(detail.lifecycle),
        lifecycleClass: lifecycleClass(detail.lifecycle),
        timeAgoText: timeAgo(detail.lastSeenAt),
        platformText: platformLabel(detail.recommendedPlatform),
        matchedTerms: detail.matchDimensions?.matchedTerms ?? [],
        matchedTermsText: (detail.matchDimensions?.matchedTerms ?? []).join("、"),
        evidence: (detail.evidence ?? []).map((item) => ({
          ...item,
          sourceLabel: item.source?.toString().slice(0, 24) ?? "来源"
        }))
      });
      this.detail = detail;

    } catch (error) {
      wx.showToast({ title: error instanceof Error ? error.message : "加载失败", icon: "none" });
      this.setData({ errorText: "详情加载失败，请重试。" });
    }
  },

  shareToken: "",

  async loadShared(token: string) {
    try {
      const shared = await api.getShare(token);
      const detail: DetailData = {
        ...shared, id: "", whyNow: shared.fact, whyYou: "", mainAngle: "", alternateAngles: [],
        recommendedPlatform: "wechat", recommendedFormat: "", matchScore: 0, rankScore: 0,
        lifecycle: "", analysisStatus: "", keywords: [], evidenceCount: shared.evidence.length,
        matchDimensions: { matchedTerms: [] }
      };
      this.detail = detail;
      this.setData({ loaded: true, title: detail.title, fact: detail.fact, whyNow: detail.fact,
        timeAgoText: timeAgo(detail.lastSeenAt),
        evidence: detail.evidence.map((e) => ({ ...e, sourceLabel: e.source })) });
    } catch {
      this.setData({ errorText: "分享暂不可用，请重试或返回今日机会。" });
    }
  },

  retryLoad() {
    this.setData({ errorText: "" });
    if (this.data.shared) this.loadShared(this.shareToken);
    else this.loadDetail(this.data.opportunityId);
  },

  goHome() { wx.switchTab({ url: "/pages/radar/index" }); },

  async prepareShare() {
    if (this.data.sharing || !this.data.loaded) return;
    this.setData({ sharing: true });
    try {
      if (!this.shareToken) this.shareToken = (await api.createShare(this.data.opportunityId)).token;
      this.setData({ shareReady: true });
      wx.showShareMenu({ menus: ["shareAppMessage", "shareTimeline"] });
      this.drawShareCard();
    } catch {
      wx.showToast({ title: "分享准备失败，请重试", icon: "none" });
    } finally { this.setData({ sharing: false }); }
  },

  detail: null as (OpportunityCard & { rankScore: number; matchDimensions: { matchedTerms: string[] } }) | null,
  shareCardPath: "" as string,

  /* ============ 分享卡（离屏 canvas 绘制，二维码失败自动降级） ============ */

  async drawShareCard() {
    try {
      const query = wx.createSelectorQuery();
      query.select("#sharecard").fields({ node: true, size: true });
      query.exec(async (res) => {
        try {
        const entry = res?.[0];
        if (!entry?.node) return;
        const canvas = entry.node as WechatMiniprogram.Canvas;
        const ctx = canvas.getContext("2d");
        const dpr = wx.getSystemInfoSync().pixelRatio || 2;
        const width = 375;
        const height = 300;
        canvas.width = width * dpr;
        canvas.height = height * dpr;
        ctx.scale(dpr, dpr);

        // 背景
        ctx.fillStyle = "#14120E";
        ctx.fillRect(0, 0, width, height);
        ctx.strokeStyle = "#342F26";
        ctx.lineWidth = 1;
        ctx.strokeRect(6, 6, width - 12, height - 12);

        // 顶部标签
        ctx.fillStyle = "#D9A441";
        ctx.font = "600 13px sans-serif";
        ctx.fillText("选题分享 · 增长搭子", 24, 40);

        // 标题（最多 4 行手动折行）
        ctx.fillStyle = "#F4F1EA";
        ctx.font = "600 19px sans-serif";
        const lines = wrapText(ctx, this.data.title, width - 150, 4);
        lines.forEach((line, index) => ctx.fillText(line, 24, 76 + index * 28));

        // whyNow 一句话
        ctx.fillStyle = "#B8B2A5";
        ctx.font = "12px sans-serif";
        const briefLines = wrapText(ctx, this.data.fact, width - 48, 2);
        briefLines.forEach((line, index) => ctx.fillText(line, 24, 200 + index * 18));

        // 底部品牌
        ctx.fillStyle = "#7E776B";
        ctx.font = "11px sans-serif";
        ctx.fillText("Finfold 一鱼多吃 · AI 提案，你拍板", 24, height - 26);

        // 小程序码（best effort）
        const fileID = await fetchWxaCode("pages/radar/detail", `s=${this.shareToken}`);
        if (fileID) {
          const qrPath = await new Promise<string | null>((resolve) => {
            wx.cloud.downloadFile({ fileID, success: (r) => resolve(r.tempFilePath), fail: () => resolve(null) });
          });
          if (qrPath) {
            const image = canvas.createImage();
            await new Promise<void>((resolve) => {
              image.onload = () => {
                ctx.drawImage(image, width - 96, height - 96, 72, 72);
                resolve();
              };
              image.onerror = () => resolve();
              image.src = qrPath;
            });
          }
        }

        wx.canvasToTempFilePath({
          canvas,
          success: (result: WechatMiniprogram.CanvasToTempFilePathOption & { tempFilePath: string }) => {
            this.shareCardPath = result.tempFilePath;
          }
        });
        } catch { wx.showToast({ title: "图片生成失败，可直接分享选题链接", icon: "none" }); }
      });
    } catch {
      /* 分享卡失败不影响页面功能，onShareAppMessage 会回退到默认截图 */
    }
  },

  saveShareCard() {
    if (!this.shareCardPath) {
      wx.showToast({ title: "分享卡还没生成好，稍后再试", icon: "none" });
      return;
    }
    wx.saveImageToPhotosAlbum({
      filePath: this.shareCardPath,
      success: () => wx.showToast({ title: "已存入相册", icon: "success" }),
      fail: (error) => {
        if (String(error.errMsg || "").includes("auth")) {
          wx.showToast({ title: "请在设置里允许保存到相册", icon: "none" });
        }
      }
    });
  },

  copyEvidence(event: WechatMiniprogram.TouchEvent) {
    const url = event.currentTarget.dataset.url as string;
    wx.setClipboardData({ data: url });
  },

  goDraft() {
    const detail = this.detail;
    if (!detail) return;
    app.globalData.pendingDraft = {
      source: this.data.shared ? "free" : "opportunity",
      opportunityId: this.data.shared ? undefined : detail.id,
      topic: {
        title: detail.title,
        fact: detail.fact,
        angle: detail.mainAngle,
        keywords: detail.keywords
      },
      platform: detail.recommendedPlatform === "xiaohongshu" ? "xiaohongshu" : detail.recommendedPlatform === "moments" ? "moments" : "wechat"
    };
    wx.switchTab({ url: "/pages/draft/index" });
  },

  async sendFeedback(kind: "not_relevant" | "already_knew" | "later") {
    try {
      if (this.data.shared) return;
      await api.postFeedback(this.data.opportunityId, kind);
      app.globalData.profileDirty = true;
      wx.showToast({ title: kind === "later" ? "已收起 24 小时" : "已记录，同类机会会变少", icon: "none" });
      if (kind !== "later") setTimeout(() => wx.navigateBack(), 900);
    } catch (error) {
      wx.showToast({ title: error instanceof Error ? error.message : "提交失败", icon: "none" });
    }
  },

  feedbackNotRelevant() {
    this.sendFeedback("not_relevant");
  },

  feedbackAlreadyKnew() {
    this.sendFeedback("already_knew");
  },

  feedbackLater() {
    this.sendFeedback("later");
  },

  onShareAppMessage(): WechatMiniprogram.Page.ICustomShareContent {
    return {
      title: this.shareToken ? `选题分享：${this.data.title}` : "增长搭子：今日选题",
      path: this.shareToken ? `/pages/radar/detail?s=${this.shareToken}` : "/pages/radar/index",
      imageUrl: this.shareCardPath || "/assets/share.png"
    };
  },

  onShareTimeline(): WechatMiniprogram.Page.ICustomTimelineContent {
    return {
      title: this.shareToken ? `选题分享：${this.data.title}` : "增长搭子：今日选题",
      query: this.shareToken ? `s=${this.shareToken}` : "",
      imageUrl: this.shareCardPath || "/assets/share.png"
    };
  }
});

type MeasureContext = { measureText(text: string): { width: number } };

function wrapText(ctx: MeasureContext, text: string, maxWidth: number, maxLines: number): string[] {
  const lines: string[] = [];
  let current = "";
  for (const char of text.replace(/\s+/g, " ").trim()) {
    const candidate = current + char;
    if (ctx.measureText(candidate).width > maxWidth && current) {
      lines.push(current);
      current = char;
      if (lines.length === maxLines) break;
    } else {
      current = candidate;
    }
  }
  if (lines.length < maxLines && current) lines.push(current);
  if (lines.length === maxLines && current && lines[maxLines - 1] !== current) {
    lines[maxLines - 1] = `${lines[maxLines - 1].slice(0, -1)}…`;
  }
  return lines;
}
