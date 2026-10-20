import "@testing-library/jest-dom/vitest";
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { NavLink } from "@/components/app-shell/NavLink";
import { PlatformSelector } from "@/components/workbench/PlatformSelector";
import { Home } from "@/components/ui/icons";

vi.mock("next/navigation", () => ({ usePathname: () => "/dashboard" }));
vi.mock("motion/react", () => ({
  motion: {
    span: ({ children, layoutId: _layoutId, ...props }: React.HTMLAttributes<HTMLSpanElement> & { layoutId?: string }) => <span {...props}>{children}</span>
  }
}));

describe("authenticated app interaction semantics", () => {
  it("marks the current navigation destination", () => {
    render(<NavLink href="/dashboard" label="Dashboard" description="Overview" icon={Home} />);
    expect(screen.getByRole("link", { name: /Dashboard/ })).toHaveAttribute("aria-current", "page");
  });

  it("keeps platform selection explicit and removable", () => {
    const onChange = vi.fn();
    render(<PlatformSelector value={["wechat"]} onChange={onChange} locale="en" />);

    const selected = screen.getAllByTestId("platform-wechat")[0];
    expect(selected).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(selected);
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it("keeps secondary platforms behind an accessible disclosure", () => {
    render(<PlatformSelector value={[]} onChange={vi.fn()} locale="en" />);
    expect(screen.queryByTestId("platform-wechat")).not.toBeInTheDocument();
    const more = screen.getByRole("button", { name: "More platforms" });
    expect(more).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(more);
    expect(screen.getByTestId("platform-wechat")).toHaveAccessibleName("WeChat Official Account");
    fireEvent.click(screen.getByRole("button", { name: "Show less" }));
    expect(screen.queryByTestId("platform-wechat")).not.toBeInTheDocument();
  });

  it("lists Global platforms before China platforms in English, reversed in Chinese", () => {
    const { rerender } = render(<PlatformSelector value={[]} onChange={vi.fn()} locale="en" />);
    const before = (a: HTMLElement, b: HTMLElement) =>
      Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

    const x = screen.getAllByTestId("platform-x")[0];
    const xiaohongshu = screen.getAllByTestId("platform-xiaohongshu")[0];
    expect(before(x, xiaohongshu)).toBe(true);

    rerender(<PlatformSelector value={[]} onChange={vi.fn()} locale="zh" />);
    const xZh = screen.getAllByTestId("platform-x")[0];
    const xiaohongshuZh = screen.getAllByTestId("platform-xiaohongshu")[0];
    expect(before(xiaohongshuZh, xZh)).toBe(true);
  });

  it("blocks a seventh platform while keeping selected platforms removable", () => {
    const onChange = vi.fn();
    const selected = ["wechat", "xiaohongshu", "zhihu", "moments", "x", "linkedin"] as const;
    render(<PlatformSelector value={[...selected]} onChange={onChange} locale="zh" maxSelection={6} />);

    fireEvent.click(screen.getByRole("button", { name: "更多平台" }));
    const blocked = screen.getByTestId("platform-instagram");
    expect(blocked).toBeDisabled();
    expect(blocked).toHaveAttribute("title", "最多选择 6 个平台");

    const removable = screen.getAllByTestId("platform-zhihu")[0];
    expect(removable).not.toBeDisabled();
    fireEvent.click(removable);
    expect(onChange).toHaveBeenCalledWith(["wechat", "xiaohongshu", "moments", "x", "linkedin"]);
  });
});
