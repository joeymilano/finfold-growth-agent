import "@testing-library/jest-dom/vitest";
import React, { useState } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OutputBoard } from "@/components/workbench/OutputBoard";
import type { KitOutput } from "@/lib/content-schema";
import { addToast } from "@/components/ui/Toast";
import { CREDITS_CHANGED_EVENT } from "@/lib/kit-credits";

vi.mock("@/lib/posthog", () => ({ captureEvent: vi.fn() }));
vi.mock("@/components/ui/Toast", () => ({ addToast: vi.fn() }));
vi.mock("@/components/workbench/PlatformBrandIcon", () => ({ PlatformGlyph: () => null }));
vi.mock("@/components/workbench/mockups/SocialMockup", () => ({ SocialMockup: () => <div>preview</div> }));
vi.mock("@/components/workbench/visual-intelligence/VisualAssetPlanCard", () => ({ VisualAssetPlanCard: () => null }));

const xOutput: KitOutput = {
  id: "output-x",
  platform: "x",
  title: "X title",
  body: "X body.",
  cta: "Read more",
  notes: "",
  strategy: "",
  locked: false,
  publishStatus: "draft",
  userEdited: false
};
const linkedinOutput: KitOutput = { ...xOutput, id: "output-li", platform: "linkedin", title: "LinkedIn title", body: "LinkedIn body." };

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) } as Response);
}

function stubFetch(handler: (url: string, init?: RequestInit) => Promise<Response> | undefined = () => undefined) {
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const custom = handler(url, init);
    if (custom) return custom;
    if (url.startsWith("/api/brand-brain")) return jsonResponse({ brain: {}, persisted: false });
    if (url.startsWith("/api/output-feedback")) return jsonResponse({ feedback: [] });
    return jsonResponse({});
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function Harness({ canPolish = false }: { canPolish?: boolean }) {
  const [outputs, setOutputs] = useState<KitOutput[]>([xOutput, linkedinOutput]);
  return (
    <OutputBoard
      outputs={outputs}
      isLoading={false}
      error={null}
      locale="zh"
      canUseOutputs
      canPolish={canPolish}
      kitId="kit-1"
      onOutputSaved={(platform, patch) => {
        setOutputs((current) => current.map((output) => output.platform === platform ? { ...output, ...patch } : output));
      }}
    />
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.mocked(addToast).mockReset();
  vi.restoreAllMocks();
});

describe("OutputBoard guards", () => {
  it("asks before discarding unsaved edits when switching the editor to another platform", () => {
    stubFetch();
    render(<Harness />);
    fireEvent.click(screen.getByTestId("edit-output-x"));
    fireEvent.change(screen.getByTestId("output-editor-x"), { target: { value: "Unsaved X draft" } });

    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false);
    fireEvent.click(screen.getByTestId("edit-output-linkedin"));
    expect(confirm).toHaveBeenCalledOnce();
    expect(screen.getByTestId("output-editor-x")).toHaveValue("Unsaved X draft");
    expect(screen.queryByTestId("output-editor-linkedin")).not.toBeInTheDocument();

    confirm.mockReturnValueOnce(true);
    fireEvent.click(screen.getByTestId("edit-output-linkedin"));
    expect(screen.getByTestId("output-editor-linkedin")).toHaveValue("LinkedIn body.");
  });

  it("switches editors without a prompt when nothing changed", () => {
    stubFetch();
    render(<Harness />);
    const confirm = vi.spyOn(window, "confirm");
    fireEvent.click(screen.getByTestId("edit-output-x"));
    fireEvent.click(screen.getByTestId("edit-output-linkedin"));
    expect(confirm).not.toHaveBeenCalled();
    expect(screen.getByTestId("output-editor-linkedin")).toBeInTheDocument();
  });

  it("explains why Save is disabled when the call to action is empty", () => {
    stubFetch();
    render(<Harness />);
    fireEvent.click(screen.getByTestId("edit-output-x"));
    fireEvent.change(screen.getByTestId("output-cta-editor-x"), { target: { value: "  " } });
    expect(screen.getByTestId("save-output-x")).toBeDisabled();
    expect(screen.getByText("请填写行动引导后再保存")).toBeInTheDocument();
  });

  it("shows the cost on paid actions and offers top-up when Credits run out", async () => {
    stubFetch((url) => (url.endsWith("/polish") ? jsonResponse({ error: "raw server text", code: "insufficient_credits" }, 402) : undefined));
    render(<Harness canPolish />);
    const polish = screen.getAllByRole("button", { name: "润色 2 点" })[0];
    fireEvent.click(polish);

    await waitFor(() => expect(addToast).toHaveBeenCalledWith(
      "error",
      "本月创作点数已用完，购买补充包或升级套餐后可以继续生成。",
      expect.any(Number),
      expect.objectContaining({ label: "购买补充包 / 升级套餐" })
    ));
    expect(screen.queryByText("raw server text")).not.toBeInTheDocument();
  });

  it("refreshes the Credits balance after a paid action succeeds", async () => {
    stubFetch((url) => (url.endsWith("/polish") ? jsonResponse({ finalBody: "Polished body." }) : undefined));
    const creditsChanged = vi.fn();
    window.addEventListener(CREDITS_CHANGED_EVENT, creditsChanged);
    render(<Harness canPolish />);
    fireEvent.click(screen.getAllByRole("button", { name: "润色 2 点" })[0]);
    await waitFor(() => expect(creditsChanged).toHaveBeenCalledTimes(1));
    window.removeEventListener(CREDITS_CHANGED_EVENT, creditsChanged);
  });

  it("reports copy success and failure", async () => {
    stubFetch();
    const writeText = vi.fn().mockRejectedValueOnce(new Error("denied")).mockResolvedValueOnce(undefined);
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    vi.stubGlobal("ClipboardItem", undefined);
    render(<Harness />);

    fireEvent.click(screen.getAllByRole("button", { name: "复制" })[0]);
    await waitFor(() => expect(addToast).toHaveBeenCalledWith("error", "复制失败，请检查剪贴板权限后重试"));

    fireEvent.click(screen.getAllByRole("button", { name: "复制" })[0]);
    await waitFor(() => expect(addToast).toHaveBeenCalledWith("success", "已复制，可以直接粘贴到平台"));
    expect(writeText).toHaveBeenLastCalledWith("X title\n\nX body.\n\nRead more");
  });
});
