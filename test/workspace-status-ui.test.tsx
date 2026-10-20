import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { WorkspaceStatusPage } from "@/components/app-shell/WorkspaceStatusPage";

vi.mock("@/hooks/useLocale", () => ({ useLocale: () => "zh" }));
vi.mock("@/components/app-shell/WorkspaceAuthHeader", () => ({ WorkspaceAuthHeader: () => null }));

describe("workspace recovery pages", () => {
  it("gives expired links a path back to the public workbench", () => {
    render(<WorkspaceStatusPage kind="not-found" />);
    expect(screen.getByRole("heading", { name: "没有找到这个页面" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "返回创作台" })).toHaveAttribute("href", "/workbench");
  });
  it("retries the error boundary when requested", () => {
    const retry = vi.fn();
    render(<WorkspaceStatusPage kind="error" retry={retry} />);
    fireEvent.click(screen.getByRole("button", { name: "重新加载" }));
    expect(retry).toHaveBeenCalledOnce();
  });
});
