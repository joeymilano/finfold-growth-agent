"use client";

import { WorkspacePageHeader } from "@/components/app-shell/WorkspacePageHeader";

import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronRight,
  ClipboardList,
  Clock,
  Copy,
  Download,
  Loader2,
  Search,
  Trash2,
  WandSparkles,
  X,
} from "@/components/ui/icons";
import React, { useEffect, useMemo, useState } from "react";
import { useWorkbench } from "@/components/workbench/WorkbenchProvider";
import { addToast } from "@/components/ui/Toast";
import { BrandLottie } from "@/components/visual/brand-lottie";
import type { ContentKit } from "@/lib/content-schema";
import {
  copyKitToClipboard,
  downloadKitMarkdown,
  downloadMarkdown,
  formatAllOutputs,
} from "@/lib/kit-export";
import { getKitLifecycle, summarizeSignal } from "@/lib/kit-lifecycle";
import { getPlatform } from "@/lib/platforms";
import { captureEvent } from "@/lib/posthog";
import { useLocale } from "@/hooks/useLocale";

function formatRelativeTime(iso: string, locale: "zh" | "en"): string {
  const now = Date.now();
  const diff = now - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (locale === "en") {
    if (mins < 2) return "Just now";
    if (mins < 60) return `${mins}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days === 1) return "Yesterday";
    return `${days}d ago`;
  } else {
    if (mins < 2) return "刚刚";
    if (mins < 60) return `${mins} 分钟前`;
    if (hours < 24) return `${hours} 小时前`;
    if (days === 1) return "昨天";
    return `${days} 天前`;
  }
}

function sortByCreatedDesc(a: ContentKit, b: ContentKit): number {
  return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
}

/** Page-number sequence with ellipsis, e.g. 1 … 4 5 6 … 12. */
function pageSequence(current: number, total: number): Array<number | "…"> {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const seq: Array<number | "…"> = [1];
  if (current > 3) seq.push("…");
  for (let i = Math.max(2, current - 1); i <= Math.min(total - 1, current + 1); i++) seq.push(i);
  if (current < total - 2) seq.push("…");
  seq.push(total);
  return seq;
}

const PAGE_SIZE_DEFAULT = 10;
const UNDO_WINDOW_MS = 6000;

/** One in-flight soft-deleted batch awaiting either its undo window to expire
 *  (→ commit to server) or the user clicking Undo (→ restore). Kept in a queue
 *  so several overlapping batch deletes inside the undo window can't clobber
 *  each other's snapshot/timer (previously the 2nd batch overwrote the 1st,
 *  making it un-undoable and never committed). */
type PendingDeleteBatch = {
  id: number;
  items: ContentKit[];
  timer: ReturnType<typeof setTimeout> | null;
  commit: (keepalive?: boolean) => void;
};

/* The undo toast lives on the dashboard layout and outlives this page, so the
 * pending-delete queue lives at module scope too: navigating away keeps every
 * batch undoable until its window ends, and Undo still cancels the commit. */
const pendingDeleteBatches: PendingDeleteBatch[] = [];
let deleteBatchSeq = 0;
/** In-flight kit ids being DELETEd, shared across mounts to dedupe commits. */
const deletingKitIds = new Set<string>();
/** Restore hook of the currently mounted library view (null when unmounted). */
let restoreIntoLibraryView: ((items: ContentKit[]) => void) | null = null;
let pageHideFlushRegistered = false;

function pendingDeleteKitIds(): Set<string> {
  return new Set(pendingDeleteBatches.flatMap((batch) => batch.items.map((item) => item.id)));
}

function takePendingDeleteBatch(id: number): PendingDeleteBatch | null {
  const idx = pendingDeleteBatches.findIndex((batch) => batch.id === id);
  if (idx < 0) return null;
  const [batch] = pendingDeleteBatches.splice(idx, 1);
  if (batch.timer) {
    clearTimeout(batch.timer);
    batch.timer = null;
  }
  return batch;
}

/** Closing the tab inside the undo window still commits the delete. */
function ensurePageHideFlush() {
  if (pageHideFlushRegistered || typeof window === "undefined") return;
  pageHideFlushRegistered = true;
  window.addEventListener("pagehide", () => {
    pendingDeleteBatches.slice().forEach((batch) => {
      takePendingDeleteBatch(batch.id)?.commit(true);
    });
  });
}

export default function PackagesPage() {
  const locale = useLocale();
  const { removeKit } = useWorkbench();
  const [kits, setKits] = useState<ContentKit[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const [deletingKitId, setDeletingKitId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<{ kitId: string; message: string } | null>(null);

  // New: search + pagination + batch
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZE_DEFAULT);
  const [batchMode, setBatchMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [confirmBatch, setConfirmBatch] = useState(false);
  const [batchActionPending, setBatchActionPending] = useState(false);


  async function loadKits() {
    setError(null);
    try {
      const res = await fetch("/api/kits", { cache: "no-store" });
      const data = (await res.json().catch(() => ({}))) as { kits?: ContentKit[] };
      if (!res.ok || !Array.isArray(data.kits)) throw new Error("load_failed");
      // Kits still inside a batch-delete undo window stay hidden on remount.
      const hidden = pendingDeleteKitIds();
      setKits(data.kits.filter((item) => !hidden.has(item.id)).sort(sortByCreatedDesc));
    } catch {
      // Server detail stays in logs; the user only needs a way back in.
      setError(locale === "en" ? "Your content library didn’t load. Try again." : "内容库暂时没加载出来，点一下重试");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    captureEvent("content_library_viewed");
    void loadKits();

    restoreIntoLibraryView = (items) => {
      setKits((prev) => {
        const present = new Set(prev.map((item) => item.id));
        return [...prev, ...items.filter((item) => !present.has(item.id))].sort(sortByCreatedDesc);
      });
    };

    return () => {
      // Pending batches keep their timers: the undo toast outlives this page,
      // so Undo must keep working after navigation.
      restoreIntoLibraryView = null;
    };
    // Mount-only: load once + register the restore hook.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const c = locale === "en"
    ? {
        title: "Content Library",
        subtitle: "Your saved growth kits",
        empty: "No kits yet",
        emptyDesc: "Generate your first growth kit from the Workbench.",
        goWorkbench: "Go to Workbench",
        col_kit: "Kit",
        col_platforms: "Platforms",
        col_saved: "Saved",
        col_actions: "Actions",
        copy: "Copy all",
        export: "Export MD",
        view: "View",
        delete: "Delete",
        cancelDelete: "Cancel",
        confirmDelete: "Delete permanently",
        deleteWarning: "This cannot be undone.",
        deleting: "Deleting…",
        deleted: "Content kit deleted",
        deleteFailed: "Could not delete this content kit.",
        outputs: (n: number) => `${n} output${n !== 1 ? "s" : ""}`,
        search: "Search kits…",
        batchManage: "Batch",
        exitBatch: "Exit",
        selectPage: "Select page",
        clearSelection: "Clear",
        selected: (n: number) => `${n} selected`,
        batchDeleteLabel: "Delete",
        batchDownloadLabel: "Download",
        confirmBatchTitle: (n: number) => `Delete ${n} kit${n !== 1 ? "s" : ""}? You can undo for a few seconds`,
        copied: "Copied all outputs",
        copyFailed: "Copy failed — check clipboard permission and try again",
        confirmBatch: "Delete",
        cancel: "Cancel",
        batchDeleted: (n: number) => `Deleted ${n} kit${n !== 1 ? "s" : ""}.`,
        undo: "Undo",
        restored: "Deletion undone",
        batchDownloaded: (n: number) => `Downloaded ${n} kit${n !== 1 ? "s" : ""} (merged MD).`,
        noResults: "No kits match your search.",
        clearSearch: "Clear search",
        total: (n: number) => `${n} total`,
        perPage: "per page",
        page: "Page",
        restoreFailed: "Some items could not be deleted and were restored.",
      }
    : {
        title: "内容库",
        subtitle: "你生成过的内容",
        empty: "还没有内容包",
        emptyDesc: "去创作台生成第一份内容。",
        goWorkbench: "前往创作台",
        col_kit: "内容",
        col_platforms: "平台",
        col_saved: "保存时间",
        col_actions: "操作",
        copy: "复制全部",
        export: "导出 MD",
        view: "查看",
        delete: "删除",
        cancelDelete: "取消",
        confirmDelete: "确认删除",
        deleteWarning: "删除后无法恢复",
        deleting: "删除中…",
        deleted: "历史内容已删除",
        deleteFailed: "删除失败，请稍后重试。",
        outputs: (n: number) => `${n} 条内容`,
        search: "搜索内容…",
        batchManage: "批量管理",
        exitBatch: "退出",
        selectPage: "全选本页",
        clearSelection: "清空",
        selected: (n: number) => `已选 ${n} 项`,
        batchDeleteLabel: "删除",
        batchDownloadLabel: "下载",
        confirmBatchTitle: (n: number) => `确认删除 ${n} 项？删除后几秒内可以撤销`,
        copied: "已复制全部内容",
        copyFailed: "复制失败，请检查剪贴板权限后重试",
        confirmBatch: "确认删除",
        cancel: "取消",
        batchDeleted: (n: number) => `已删除 ${n} 项内容`,
        undo: "撤销",
        restored: "已恢复删除的内容",
        batchDownloaded: (n: number) => `已下载 ${n} 个内容包（合并为 MD）`,
        noResults: "没有匹配的内容",
        clearSearch: "清除搜索",
        total: (n: number) => `共 ${n} 项`,
        perPage: "每页",
        page: "第",
        restoreFailed: "部分内容删除失败，已恢复。",
      };

  // ---- Derived: filter (search) → paginate ----
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return kits;
    return kits.filter((k) => k.ideaText.toLowerCase().includes(q));
  }, [kits, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageItems = useMemo(
    () => filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize),
    [filtered, currentPage, pageSize],
  );

  const onPageSelected = filtered.filter((k) => selectedIds.has(k.id)).length;
  const selectedCount = selectedIds.size;
  const allOnPageSelected = pageItems.length > 0 && pageItems.every((k) => selectedIds.has(k.id));

  // ---- Single-row actions (unchanged behaviour) ----
  function downloadKit(kit: ContentKit) {
    downloadKitMarkdown(kit, locale);
    captureEvent("kit_exported", { source: "content_library", outputCount: kit.outputs.length });
  }

  async function copyKit(kit: ContentKit) {
    try {
      await copyKitToClipboard(kit, locale);
    } catch {
      addToast("error", c.copyFailed);
      return;
    }
    addToast("success", c.copied);
    captureEvent("kit_copied", { source: "content_library", outputCount: kit.outputs.length });
  }

  async function deleteKit(kit: ContentKit) {
    setDeletingKitId(kit.id);
    setDeleteError(null);
    try {
      const response = await fetch(`/api/kits/${encodeURIComponent(kit.id)}`, { method: "DELETE" });
      const data = (await response.json()) as { deleted?: boolean; error?: string };
      if (!response.ok || !data.deleted) throw new Error(data.error ?? c.deleteFailed);
      setKits((current) => current.filter((item) => item.id !== kit.id));
      removeKit(kit.id);
      setConfirmingDeleteId(null);
      addToast("success", c.deleted);
      captureEvent("kit_deleted", { source: "content_library", outputCount: kit.outputs.length });
    } catch (deleteFailure) {
      const message = deleteFailure instanceof Error ? deleteFailure.message : c.deleteFailed;
      setDeleteError({ kitId: kit.id, message });
      addToast("error", message);
    } finally {
      setDeletingKitId(null);
    }
  }

  // ---- Batch selection ----
  function enterBatch() {
    setBatchMode(true);
  }

  function exitBatch() {
    setBatchMode(false);
    setSelectedIds(new Set());
    setConfirmBatch(false);
  }

  function toggleSelected(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectPage() {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allOnPageSelected) {
        pageItems.forEach((k) => next.delete(k.id));
      } else {
        pageItems.forEach((k) => next.add(k.id));
      }
      return next;
    });
  }

  function clearSelection() {
    setSelectedIds(new Set());
  }

  // ---- Batch download (merge all selected kits into one MD, no new deps) ----
  function batchDownload() {
    const selected = kits.filter((k) => selectedIds.has(k.id));
    if (!selected.length) return;
    setBatchActionPending(true);
    try {
      const combined = selected
        .map((k) => formatAllOutputs(k.outputs, locale))
        .join("\n\n---\n\n");
      const stamp = new Date().toISOString().slice(0, 10);
      downloadMarkdown(`finfold-content-${selected.length}kits-${stamp}.md`, combined);
      addToast("success", c.batchDownloaded(selected.length));
      captureEvent("kits_batch_downloaded", { source: "content_library", count: selected.length });
    } finally {
      setBatchActionPending(false);
    }
  }

  // ---- Batch delete with undo (soft-delete → undo window → commit) ----
  function requestBatchDelete() {
    if (!selectedCount) return;
    setConfirmBatch(true);
  }

  function commitDeleteToServer(items: ContentKit[], keepalive = false) {
    // Dedupe in-flight deletes so overlapping commits (undo timer + page hide
    // + repeated batch deletes) never fire duplicate DELETEs for the same kit,
    // and aggregate all failures into a single restore toast.
    const pending = items.filter((kit) => !deletingKitIds.has(kit.id));
    if (!pending.length) return;
    pending.forEach((kit) => deletingKitIds.add(kit.id));
    const restore = (kit: ContentKit) => restoreIntoLibraryView?.([kit]);

    let failed = 0;
    let settled = 0;
    const total = pending.length;

    pending.forEach((kit) => {
      fetch(`/api/kits/${encodeURIComponent(kit.id)}`, keepalive ? { method: "DELETE", keepalive: true } : { method: "DELETE" })
        .then((r) => r.json() as Promise<{ deleted?: boolean; error?: string }>)
        .then((data) => {
          deletingKitIds.delete(kit.id);
          if (data.deleted) {
            removeKit(kit.id);
            captureEvent("kit_deleted", { source: "content_library_batch", outputCount: kit.outputs.length });
          } else {
            restore(kit);
            failed += 1;
          }
        })
        .catch(() => {
          deletingKitIds.delete(kit.id);
          restore(kit);
          failed += 1;
        })
        .finally(() => {
          settled += 1;
          // One toast for the whole batch, not one per failed kit.
          if (settled === total && failed > 0) {
            addToast("error", c.restoreFailed);
          }
        });
    });
  }

  function confirmBatchDelete() {
    const snapshot = kits.filter((k) => selectedIds.has(k.id));
    if (!snapshot.length) {
      setConfirmBatch(false);
      return;
    }
    const id = ++deleteBatchSeq;
    const batch: PendingDeleteBatch = {
      id,
      items: snapshot,
      timer: null,
      commit: (keepalive) => commitDeleteToServer(snapshot, keepalive)
    };
    pendingDeleteBatches.push(batch);
    ensurePageHideFlush();

    // Optimistic removal
    setKits((prev) => prev.filter((k) => !selectedIds.has(k.id)));
    setSelectedIds(new Set());
    setBatchMode(false);
    setConfirmBatch(false);

    batch.timer = setTimeout(() => {
      batch.timer = null;
      // Commit this batch only, then drop it from the queue.
      takePendingDeleteBatch(id)?.commit();
    }, UNDO_WINDOW_MS);

    addToast(
      "success",
      c.batchDeleted(snapshot.length),
      UNDO_WINDOW_MS + 1000,
      { label: c.undo, onClick: () => undoBatchDelete(id) },
    );
    captureEvent("kits_batch_deleted", { source: "content_library", count: snapshot.length });
  }

  function undoBatchDelete(id: number) {
    const batch = takePendingDeleteBatch(id);
    if (!batch) return; // already committed or undone
    // Restores into whichever library view is mounted now; when none is, the
    // kits simply were never deleted and reappear on the next visit.
    restoreIntoLibraryView?.(batch.items);
    addToast("info", c.restored);
  }

  // Keep page in range when filter/page-size shrink the list
  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const colGrid = batchMode
    ? "grid-cols-[auto_1fr_auto_140px] md:grid-cols-[auto_1fr_auto_140px_0px]"
    : "grid-cols-[1fr_auto_140px_230px]";

  return (
    <div className="grid gap-6 pb-10">
      <WorkspacePageHeader title={c.title} actions={<>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-muted" />
              <input
                type="search"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                placeholder={c.search}
                aria-label={c.search}
                className="focus-ring h-10 w-full rounded-lg border border-hairline bg-surface pl-9 pr-3 text-sm text-fg placeholder:text-fg-muted sm:w-64"
              />
            </div>
            {kits.length > 0 ? (
              batchMode ? (
                <button
                  type="button"
                  onClick={exitBatch}
                  className="btn-ghost focus-ring inline-flex h-10 cursor-pointer items-center gap-1.5 px-3 text-sm font-semibold"
                >
                  <X className="h-4 w-4" />
                  {c.exitBatch}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={enterBatch}
                  className="btn-ghost focus-ring inline-flex h-10 cursor-pointer items-center gap-1.5 px-3 text-sm font-semibold"
                >
                  <ClipboardList className="h-4 w-4" />
                  {c.batchManage}
                </button>
              )
            ) : null}
            <Link href="/workbench" className="btn-primary focus-ring inline-flex h-10 cursor-pointer items-center gap-1.5 px-4 text-sm">
              <WandSparkles className="h-4 w-4" />
              {locale === "en" ? "New Kit" : "生成新内容"}
            </Link>
      </>} />

      {/* Batch toolbar — sticky so it stays reachable on mobile while scrolling a long list */}
      {batchMode ? (
        <section
          aria-label={c.batchManage}
          className="workspace-floating-toolbar sticky bottom-24 lg:bottom-3 z-20 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-action/30 bg-surface p-3 shadow-panel"
        >
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={toggleSelectPage}
              disabled={pageItems.length === 0}
              className="focus-ring inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border border-hairline bg-surface px-2.5 text-xs font-semibold text-fg-muted transition hover:text-fg disabled:cursor-not-allowed disabled:opacity-50"
            >
              <span
                className={`flex h-3.5 w-3.5 items-center justify-center rounded-[4px] border ${
                  allOnPageSelected ? "border-action bg-action text-fg-invert" : "border-fg-muted"
                }`}
              >
                {allOnPageSelected ? <Check className="h-2.5 w-2.5" /> : null}
              </span>
              {c.selectPage}
            </button>
            <span className="text-xs font-semibold text-action">{c.selected(selectedCount)}</span>
            {selectedCount !== onPageSelected ? (
              <span className="text-[11px] text-fg-muted">
                {locale === "en"
                  ? `${onPageSelected} here + ${selectedCount - onPageSelected} other pages`
                  : `本页 ${onPageSelected} + 其他页 ${selectedCount - onPageSelected}`}
              </span>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={clearSelection}
              disabled={selectedCount === 0}
              className="focus-ring inline-flex h-8 cursor-pointer items-center px-2.5 text-xs font-semibold text-fg-muted transition hover:text-fg disabled:cursor-not-allowed disabled:opacity-50"
            >
              {c.clearSelection}
            </button>
            <button
              type="button"
              onClick={batchDownload}
              disabled={selectedCount === 0 || batchActionPending}
              className="btn-ghost focus-ring inline-flex h-8 cursor-pointer items-center gap-1.5 px-3 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Download className="h-3.5 w-3.5" />
              {c.batchDownloadLabel}
              {selectedCount > 0 ? ` (${selectedCount})` : ""}
            </button>
            <button
              type="button"
              onClick={requestBatchDelete}
              disabled={selectedCount === 0}
              className="focus-ring inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border border-risk/30 bg-risk/10 px-3 text-xs font-semibold text-risk transition hover:bg-risk/15 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Trash2 className="h-3.5 w-3.5" />
              {c.batchDeleteLabel}
              {selectedCount > 0 ? ` (${selectedCount})` : ""}
            </button>
          </div>
        </section>
      ) : null}

      {/* Batch delete confirmation */}
      {confirmBatch ? (
        <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-risk/30 bg-risk/5 p-3">
          <p className="flex items-center gap-2 text-xs font-semibold text-risk">
            <Trash2 className="h-4 w-4 shrink-0" />
            {c.confirmBatchTitle(selectedCount)}
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setConfirmBatch(false)}
              className="focus-ring inline-flex h-8 cursor-pointer items-center rounded-lg border border-hairline bg-surface px-3 text-xs font-semibold text-fg-muted transition hover:text-fg"
            >
              {c.cancel}
            </button>
            <button
              type="button"
              onClick={confirmBatchDelete}
              className="focus-ring inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border border-risk/40 bg-risk px-3 text-xs font-semibold text-fg-invert transition hover:bg-risk/90"
            >
              <Trash2 className="h-3.5 w-3.5" />
              {c.confirmBatch}
            </button>
          </div>
        </section>
      ) : null}

      <section className="panel overflow-hidden">
        {/* Table header */}
        <div
          className={`grid gap-4 border-b border-hairline bg-surface-2 px-5 py-3 text-[11px] font-semibold uppercase tracking-wide text-fg-muted max-md:hidden ${colGrid}`}
        >
          {batchMode ? (
            <>
              <span className="w-6">
                <button
                  type="button"
                  onClick={toggleSelectPage}
                  aria-label={c.selectPage}
                  className="focus-ring cursor-pointer"
                >
                  <span
                    className={`flex h-4 w-4 items-center justify-center rounded-[5px] border ${
                      allOnPageSelected ? "border-action bg-action text-fg-invert" : "border-fg-muted"
                    }`}
                  >
                    {allOnPageSelected ? <Check className="h-3 w-3" /> : null}
                  </span>
                </button>
              </span>
              <span>{c.col_kit}</span>
              <span>{c.col_platforms}</span>
              <span>{c.col_saved}</span>
            </>
          ) : (
            <>
              <span>{c.col_kit}</span>
              <span>{c.col_platforms}</span>
              <span>{c.col_saved}</span>
              <span>{c.col_actions}</span>
            </>
          )}
        </div>

        {isLoading ? (
          <div className="flex min-h-[320px] items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-fg-muted" />
          </div>
        ) : error ? (
          <div className="flex min-h-[200px] flex-col items-center justify-center gap-3 p-8 text-center">
            <p className="text-sm text-risk">{error}</p>
            <button type="button" onClick={() => { setIsLoading(true); void loadKits(); }} className="btn-ghost focus-ring">
              {locale === "en" ? "Retry" : "重试"}
            </button>
          </div>
        ) : kits.length === 0 ? (
          <div className="flex min-h-[360px] flex-col items-center justify-center gap-4 p-8 text-center">
            {/* Free-library Lottie (LottieFiles, Lottie Simple License) —
                empty-state illustration guiding the user to the workbench. */}
            <BrandLottie src="/lottie/empty-state.json" className="pointer-events-none w-32 sm:w-40" />
            <div>
              <p className="text-sm font-semibold text-fg">{c.empty}</p>
              <p className="mt-1 text-xs text-fg-muted">{c.emptyDesc}</p>
            </div>
            <Link href="/workbench" className="btn-primary focus-ring cursor-pointer text-sm">
              <WandSparkles className="h-4 w-4" />
              {c.goWorkbench} <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex min-h-[260px] flex-col items-center justify-center gap-3 p-8 text-center">
            <Search className="h-8 w-8 text-fg-muted/50" />
            <p className="text-sm font-semibold text-fg">{c.noResults}</p>
            <button
              type="button"
              onClick={() => setSearch("")}
              className="focus-ring inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-hairline bg-surface px-3 py-1.5 text-xs font-semibold text-fg-muted transition hover:text-fg"
            >
              <X className="h-3.5 w-3.5" />
              {c.clearSearch}
            </button>
          </div>
        ) : (
          pageItems.map((kit) => {
            const lifecycle = getKitLifecycle(kit, locale);
            const platformLabels = kit.platforms
              .slice(0, 3)
              .map((pid) => {
                try { return getPlatform(pid).shortLabel; } catch { return pid; }
              });
            const extra = kit.platforms.length - 3;
            const isSel = selectedIds.has(kit.id);

            return (
              <article
                key={kit.id}
                onClick={batchMode ? () => toggleSelected(kit.id) : undefined}
                className={`grid gap-3 border-b border-hairline px-5 py-4 last:border-b-0 transition-colors ${
                  batchMode ? "cursor-pointer hover:bg-surface-2" : "hover:bg-surface-2"
                } md:items-center ${batchMode ? "md:grid-cols-[auto_1fr_auto_140px_0px]" : "md:grid-cols-[1fr_auto_140px_230px]"}`}
              >
                {/* Checkbox (batch mode only) */}
                {batchMode ? (
                  <div className="flex items-center" onClick={(e) => e.stopPropagation()}>
                    <button
                      type="button"
                      onClick={() => toggleSelected(kit.id)}
                      aria-pressed={isSel}
                      aria-label={c.selected(1)}
                      className="focus-ring cursor-pointer rounded p-1"
                    >
                      <span
                        className={`flex h-4 w-4 items-center justify-center rounded-[5px] border transition-colors ${
                          isSel ? "border-action bg-action text-fg-invert" : "border-fg-muted bg-surface"
                        }`}
                      >
                        {isSel ? <Check className="h-3 w-3" /> : null}
                      </span>
                    </button>
                  </div>
                ) : null}

                {/* Kit info */}
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate text-sm font-semibold text-fg">
                      {summarizeSignal(kit.ideaText, 72)}
                    </p>
                  </div>
                  <p className="mt-1 text-xs text-fg-muted">{c.outputs(kit.outputs.length)}</p>
                  <p className="mt-1 truncate text-[11px] font-medium text-action-strong dark:text-action">
                    {locale === "en" ? "Next: " : "下一步："}{lifecycle.nextAction}
                  </p>
                </div>

                {/* Platforms */}
                <div className="flex flex-wrap items-center gap-1.5">
                  {platformLabels.map((label) => (
                    <span key={label} className="tag tag-neutral text-[10px]">{label}</span>
                  ))}
                  {extra > 0 && (
                    <span className="tag tag-neutral text-[10px]">+{extra}</span>
                  )}
                </div>

                {/* Time */}
                <div className="flex items-center gap-1.5 text-xs text-fg-muted">
                  <Clock className="h-3 w-3 shrink-0" />
                  {formatRelativeTime(kit.createdAt, locale)}
                </div>

                {/* Actions (hidden in batch mode) */}
                {batchMode ? null : (
                  <div className="min-w-0">
                    {confirmingDeleteId === kit.id ? (
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="w-full text-[11px] font-medium text-risk">{c.deleteWarning}</span>
                        <button
                          type="button"
                          onClick={() => {
                            setConfirmingDeleteId(null);
                            setDeleteError(null);
                          }}
                          disabled={deletingKitId === kit.id}
                          className="focus-ring cursor-pointer rounded-lg border border-hairline bg-surface px-2.5 py-1.5 text-xs font-semibold text-fg-muted transition hover:text-fg disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {c.cancelDelete}
                        </button>
                        <button
                          type="button"
                          onClick={() => void deleteKit(kit)}
                          disabled={deletingKitId === kit.id}
                          className="focus-ring inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-risk/30 bg-risk/10 px-2.5 py-1.5 text-xs font-semibold text-risk transition hover:bg-risk/15 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {deletingKitId === kit.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                          {deletingKitId === kit.id ? c.deleting : c.confirmDelete}
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => void copyKit(kit)}
                          title={c.copy}
                          aria-label={c.copy}
                          className="btn-ghost focus-ring cursor-pointer px-2.5 py-1.5 text-xs"
                        >
                          <Copy className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => downloadKit(kit)}
                          title={c.export}
                          aria-label={c.export}
                          className="btn-ghost focus-ring cursor-pointer px-2.5 py-1.5 text-xs"
                        >
                          <Download className="h-3.5 w-3.5" />
                        </button>
                        <Link
                          href={`/kits/${kit.id}`}
                          onClick={() => captureEvent("kit_resumed", { source: "content_library", outputCount: kit.outputs.length })}
                          className="btn-ghost focus-ring cursor-pointer px-2.5 py-1.5 text-xs font-semibold"
                        >
                          {c.view}
                        </Link>
                        <button
                          type="button"
                          onClick={() => {
                            setConfirmingDeleteId(kit.id);
                            setDeleteError(null);
                          }}
                          title={c.delete}
                          aria-label={`${c.delete}: ${summarizeSignal(kit.ideaText, 32)}`}
                          className="focus-ring cursor-pointer rounded-lg border border-transparent p-2 text-fg-muted transition hover:border-risk/25 hover:bg-risk/10 hover:text-risk"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    )}
                    {deleteError?.kitId === kit.id ? (
                      <p role="alert" className="mt-2 text-[11px] font-medium text-risk">{deleteError.message}</p>
                    ) : null}
                  </div>
                )}
              </article>
            );
          })
        )}
      </section>

      {/* Pagination */}
      {!isLoading && !error && filtered.length > 0 ? (
        <section className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3 text-xs text-fg-muted">
            <span>{c.total(filtered.length)}</span>
            <label className="flex items-center gap-1.5">
              {c.perPage}
              <select
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value));
                  setPage(1);
                }}
                className="focus-ring h-8 cursor-pointer rounded-lg border border-hairline bg-surface px-2 text-xs text-fg"
              >
                {[10, 20, 50].map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </label>
          </div>

          <nav className="flex items-center gap-1" aria-label={locale === "en" ? "Pagination" : "分页"}>
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={currentPage <= 1}
              aria-label={locale === "en" ? "Previous page" : "上一页"}
              className="focus-ring inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg border border-hairline bg-surface text-fg-muted transition hover:text-fg disabled:cursor-not-allowed disabled:opacity-40"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>

            {/* Desktop: full page numbers; Mobile: compact N/N */}
            <div className="hidden items-center gap-1 sm:flex">
              {pageSequence(currentPage, totalPages).map((p, i) =>
                p === "…" ? (
                  <span key={`gap-${i}`} className="px-1 text-xs text-fg-muted">…</span>
                ) : (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setPage(p)}
                    aria-current={p === currentPage ? "page" : undefined}
                    className={`focus-ring inline-flex h-8 min-w-8 cursor-pointer items-center justify-center rounded-lg border px-2 text-xs font-semibold transition ${
                      p === currentPage
                        ? "border-action bg-action text-fg-invert"
                        : "border-hairline bg-surface text-fg-muted hover:text-fg"
                    }`}
                  >
                    {p}
                  </button>
                ),
              )}
            </div>
            <span className="px-2 text-xs font-semibold text-fg sm:hidden">
              {currentPage} / {totalPages}
            </span>

            <button
              type="button"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage >= totalPages}
              aria-label={locale === "en" ? "Next page" : "下一页"}
              className="focus-ring inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg border border-hairline bg-surface text-fg-muted transition hover:text-fg disabled:cursor-not-allowed disabled:opacity-40"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </nav>
        </section>
      ) : null}
    </div>
  );
}
