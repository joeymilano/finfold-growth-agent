import "@testing-library/jest-dom/vitest";
import React, { useState } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OutputBoard } from "@/components/workbench/OutputBoard";
import type { KitOutput } from "@/lib/content-schema";
import { captureEvent } from "@/lib/posthog";
import { addToast } from "@/components/ui/Toast";
import { downloadMarkdown } from "@/lib/kit-export";

vi.mock("@/lib/posthog", () => ({ captureEvent: vi.fn() }));
vi.mock("@/components/ui/Toast", () => ({ addToast: vi.fn() }));
vi.mock("@/components/workbench/PlatformBrandIcon", () => ({ PlatformGlyph: () => null }));
vi.mock("@/components/workbench/mockups/SocialMockup", () => ({ SocialMockup: () => <div>preview</div> }));
vi.mock("@/components/workbench/visual-intelligence/VisualAssetPlanCard", () => ({ VisualAssetPlanCard: () => null }));
vi.mock("@/lib/kit-export", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/kit-export")>();
  return { ...original, downloadMarkdown: vi.fn() };
});

const draftOutput: KitOutput = {
  id: "output-1",
  platform: "x",
  title: "N/A",
  body: "Original body.",
  cta: "Read more",
  notes: "Keep it direct.",
  strategy: "Founder-led update.",
  locked: false,
  publishStatus: "draft",
  userEdited: false
};

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body)
  } as Response);
}

function Harness() {
  const [outputs, setOutputs] = useState<KitOutput[]>([draftOutput]);
  return (
    <OutputBoard
      outputs={outputs}
      isLoading={false}
      error={null}
      locale="zh"
      canUseOutputs
      kitId="kit-1"
      onOutputSaved={(platform, patch) => {
        setOutputs((current) => current.map((output) => output.platform === platform ? { ...output, ...patch } : output));
      }}
    />
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("OutputBoard editing", () => {
  it("keeps the post readable and secondary tools behind More in Studio", () => {
    vi.stubGlobal("fetch", vi.fn(() => jsonResponse({})));
    render(<OutputBoard workspace outputs={[draftOutput]} kitId="ui-test-kit" isLoading={false} error={null} locale="en" canUseOutputs canPolish />);
    expect(screen.getByText(draftOutput.body)).toBeVisible();
    expect(screen.getByRole("button", { name: "Polish 2 Credits" })).not.toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    expect(screen.queryByText("Notes & strategy")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("More", { exact: true }));
    expect(screen.getByRole("button", { name: "Polish 2 Credits" })).toBeVisible();
    fireEvent.keyDown(screen.getByRole("button", { name: "Polish 2 Credits" }), { key: "Escape" });
    expect(screen.getByRole("button", { name: "Polish 2 Credits" })).not.toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Text" }));
    expect(screen.getByText("Notes & strategy")).toBeInTheDocument();
  });

  it("shows arriving results immediately and preserves the selected platform as more arrive", () => {
    vi.stubGlobal("fetch", vi.fn(() => jsonResponse({})));
    const linkedInOutput: KitOutput = { ...draftOutput, id: "output-2", platform: "linkedin", body: "LinkedIn body." };
    const redditOutput: KitOutput = { ...draftOutput, id: "output-3", platform: "reddit", body: "Reddit body." };
    const props = { workspace: true, isLoading: true, error: null, locale: "en" as const, canUseOutputs: true, expectedPlatforms: ["x", "linkedin", "reddit"] as KitOutput["platform"][] };
    const view = render(<OutputBoard {...props} outputs={[]} />);
    expect(screen.getByRole("status")).toHaveTextContent("Creating your content");
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();

    view.rerender(<OutputBoard {...props} outputs={[draftOutput]} />);
    expect(screen.queryByText("Creating your content…")).not.toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "Platforms ready" })).toHaveAttribute("aria-valuenow", "1");
    expect(screen.getByTestId("output-card-x")).toBeVisible();

    view.rerender(<OutputBoard {...props} outputs={[draftOutput, linkedInOutput]} />);
    fireEvent.click(screen.getByRole("button", { name: "LinkedIn" }));
    expect(screen.getByTestId("output-card-x")).not.toBeVisible();
    expect(screen.getByTestId("output-card-linkedin")).toBeVisible();

    view.rerender(<OutputBoard {...props} outputs={[draftOutput, linkedInOutput, redditOutput]} />);
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "3");
    expect(screen.getByRole("button", { name: "LinkedIn" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("output-card-linkedin")).toBeVisible();
    expect(screen.getByTestId("output-card-reddit")).not.toBeVisible();
  });

  it("records recovered persisted output while not loading, once per kit per mount", async () => {
    vi.mocked(captureEvent).mockClear();
    vi.stubGlobal("fetch", vi.fn(() => jsonResponse({})));
    const view = render(<OutputBoard outputs={[draftOutput]} kitId="recovered-kit" isLoading={false} error={null} locale="zh" />);
    await waitFor(() => expect(captureEvent).toHaveBeenCalledWith("output_first_visible", expect.objectContaining({ kit_id: "recovered-kit", analytics_version: 2 })));
    view.rerender(<OutputBoard outputs={[{ ...draftOutput, body: "Edited" }]} kitId="recovered-kit" isLoading={false} error={null} locale="zh" />);
    expect(vi.mocked(captureEvent).mock.calls.filter(([event]) => event === "output_first_visible")).toHaveLength(1);
  });

  it("edits title, body, and CTA in one durable save", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/outputs/output-1") && init?.method === "PUT") {
        return jsonResponse({
          output: {
            ...draftOutput,
            title: "A clearer launch note",
            cta: "Try the checklist",
            finalBody: "Edited body.",
            userEdited: true
          }
        });
      }
      if (url.startsWith("/api/brand-brain")) return jsonResponse({ brain: {}, persisted: false });
      if (url.startsWith("/api/output-feedback")) return jsonResponse({ feedback: [] });
      return jsonResponse({});
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "编辑" }));

    expect(screen.getByLabelText("标题（可留空）")).toHaveValue("");
    await waitFor(() => expect(screen.getByLabelText("正文")).toHaveFocus());
    expect(screen.getByLabelText("标题（可留空）")).toHaveAttribute("placeholder", "留空时显示“无标题”");
    fireEvent.change(screen.getByLabelText("标题（可留空）"), { target: { value: "A clearer launch note" } });
    fireEvent.change(screen.getByLabelText("正文"), { target: { value: "Edited body." } });
    fireEvent.change(screen.getByLabelText("行动引导"), { target: { value: "Try the checklist" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/kits/kit-1/outputs/output-1",
        expect.objectContaining({
          method: "PUT",
          body: JSON.stringify({
            title: "A clearer launch note",
            body: "Edited body.",
            cta: "Try the checklist"
          })
        })
      );
    });
    expect(await screen.findByText("A clearer launch note")).toBeInTheDocument();
    expect(addToast).toHaveBeenCalledWith("success", "修改已保存。");
  });

  it("persists an empty title as the localized Untitled fallback", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/outputs/output-1") && init?.method === "PUT") {
        return jsonResponse({
          output: { ...draftOutput, title: "Untitled", finalBody: draftOutput.body, userEdited: true }
        });
      }
      if (url.startsWith("/api/brand-brain")) return jsonResponse({ brain: {}, persisted: false });
      if (url.startsWith("/api/output-feedback")) return jsonResponse({ feedback: [] });
      return jsonResponse({});
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "编辑" }));
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/kits/kit-1/outputs/output-1",
        expect.objectContaining({ body: JSON.stringify({ title: "Untitled", body: "Original body.", cta: "Read more" }) })
      );
    });
    expect(await screen.findByText("无标题")).toBeInTheDocument();
  });

  it("confirms that a Markdown download was started without claiming disk success", async () => {
    vi.stubGlobal("fetch", vi.fn(() => jsonResponse({})));
    render(<Harness />);

    fireEvent.click(screen.getByRole("button", { name: "导出 MD" }));

    expect(downloadMarkdown).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(addToast).toHaveBeenCalledWith(
        "success",
        "下载已开始；如果文件没有出现，请检查浏览器下载记录。"
      );
    });
  });
});
