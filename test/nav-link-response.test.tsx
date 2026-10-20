import "@testing-library/jest-dom/vitest";
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NavLink } from "@/components/app-shell/NavLink";
import { Gauge as Icon } from "@/components/ui/icons";

const mocks = vi.hoisted(() => ({ pathname: "/workbench", pendingHref: "", locale: "zh", navigate: vi.fn() }));
vi.mock("next/navigation", () => ({ usePathname: () => mocks.pathname }));
vi.mock("@/hooks/useLocale", () => ({ useLocale: () => mocks.locale }));
vi.mock("next/link", async () => {
  const React = await import("react");
  const Context = React.createContext("");
  return {
    useLinkStatus: () => ({ pending: React.useContext(Context) === mocks.pendingHref }),
    default: ({ href, children, onNavigate, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & {
      href: string; onNavigate?: (event: { preventDefault: () => void }) => void;
    }) => <Context.Provider value={href}><a {...props} href={href} onClick={(event) => {
      event.preventDefault();
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      let prevented = false;
      onNavigate?.({ preventDefault: () => { prevented = true; } });
      if (!prevented) mocks.navigate(href);
    }}>{children}</a></Context.Provider>,
  };
});

const links = () => <><NavLink href="/overview" label="总览" icon={Icon} /><NavLink href="/operations" label="任务" icon={Icon} /></>;

beforeEach(() => {
  mocks.pathname = "/workbench";
  mocks.pendingHref = "";
  mocks.locale = "zh";
  mocks.navigate.mockClear();
});

describe("navigation response", () => {
  it("starts navigation once even when the same link is clicked repeatedly before feedback renders", () => {
    render(links());
    const link = screen.getByRole("link", { name: "总览" });
    fireEvent.click(link);
    fireEvent.click(link);
    expect(mocks.navigate).toHaveBeenCalledExactlyOnceWith("/overview");
  });

  it("shows feedback for the pending target and lets a different destination interrupt it", () => {
    const view = render(links());
    fireEvent.click(screen.getByRole("link", { name: "总览" }));
    mocks.pendingHref = "/overview";
    view.rerender(links());
    expect(screen.getByRole("status")).toHaveAttribute("aria-label", "正在打开页面");
    fireEvent.click(screen.getByRole("link", { name: "总览" }));
    fireEvent.click(screen.getByRole("link", { name: "任务" }));
    expect(mocks.navigate.mock.calls).toEqual([["/overview"], ["/operations"]]);
  });

  it("allows retry after a canceled navigation without requiring a pathname change", () => {
    const view = render(links());
    const link = screen.getByRole("link", { name: "总览" });
    fireEvent.click(link);
    mocks.pendingHref = "/overview";
    view.rerender(links());
    mocks.pendingHref = "";
    view.rerender(links());
    fireEvent.click(link);
    expect(mocks.navigate).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("keeps the duplicate-click guard until the transition settles, even after the URL changes", () => {
    const view = render(links());
    fireEvent.click(screen.getByRole("link", { name: "总览" }));
    mocks.pendingHref = "/overview";
    mocks.pathname = "/overview";
    view.rerender(links());
    fireEvent.click(screen.getByRole("link", { name: "总览" }));
    expect(mocks.navigate).toHaveBeenCalledTimes(1);
  });

  it("preserves native modified-click links while another navigation is pending", () => {
    render(links());
    const link = screen.getByRole("link", { name: "总览" });
    fireEvent.click(link);
    fireEvent.click(link, { metaKey: true });
    expect(link).toHaveAttribute("href", "/overview");
    expect(mocks.navigate).toHaveBeenCalledTimes(1);
  });
});
