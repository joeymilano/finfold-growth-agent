import "@testing-library/jest-dom/vitest";
import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SiteFooter } from "@/components/landing/SiteFooter";

vi.mock("@/hooks/useLocale", () => ({ useLocale: () => "en" }));
vi.mock("@/components/app-shell/FishLogo", () => ({ FishLogo: () => null }));

describe("SiteFooter", () => {
  it("links the Good AI Tools badge to the exact Finfold listing", () => {
    render(<SiteFooter locale="en" />);

    const link = screen.getByRole("link", { name: "Good AI Tools" });
    expect(link).toHaveAttribute("href", "https://goodaitools.com/ai/finfold");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener");
    expect(link).not.toHaveAttribute("rel", expect.stringContaining("nofollow"));

    const badge = screen.getByAltText("Good AI Tools");
    expect(badge).toHaveAttribute(
      "src",
      "https://goodaitools.com/assets/images/badge-dark.png"
    );
    expect(badge).toHaveAttribute("height", "54");
    expect(badge).toHaveAttribute("loading", "lazy");
  });

  it("keeps English visitors in English on the extension page", () => {
    render(<SiteFooter locale="en" />);
    expect(screen.getByRole("link", { name: "Chrome extension" })).toHaveAttribute("href", "/extension/download?ui_locale=en");
  });

  it("names the agent integration with the product term in Chinese", () => {
    render(<SiteFooter locale="zh" />);
    expect(screen.getByRole("link", { name: "智能体接入" })).toHaveAttribute("href", "/for-agents");
    expect(screen.getByRole("link", { name: "Chrome 插件" })).toHaveAttribute("href", "/extension/download");
  });
});
