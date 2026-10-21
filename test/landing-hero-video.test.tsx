import "@testing-library/jest-dom/vitest";
import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LandingHeroVideo } from "@/components/landing/LandingHeroVideo";

let reduced = false;
let visibility = "visible";
let intersect: IntersectionObserverCallback;

beforeEach(() => {
  reduced = false;
  visibility = "visible";
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibility });
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: reduced, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  vi.stubGlobal("IntersectionObserver", class {
    constructor(callback: IntersectionObserverCallback) { intersect = callback; }
    observe() {}
    disconnect() {}
  });
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("landing background video", () => {
  it("lets visitors stop and resume decorative motion without navigating", async () => {
    const { container } = render(<LandingHeroVideo locale="zh" />);
    const video = container.querySelector("video")!;
    expect(video).toHaveAttribute("src", "/media/hero-atmosphere.mp4");
    expect(video.muted).toBe(true);
    expect(video.loop).toBe(true);
    await act(async () => {});
    fireEvent.click(screen.getByRole("button", { name: "暂停背景视频" }));
    expect(screen.getByRole("button", { name: "播放背景视频" })).toHaveAttribute("aria-pressed", "true");
    expect(video.pause).toHaveBeenCalled();
    vi.mocked(video.play).mockClear();
    fireEvent.click(screen.getByRole("button", { name: "播放背景视频" }));
    expect(video.play).toHaveBeenCalled();
  });

  it("uses the still without loading or playing video when reduced motion is requested", () => {
    reduced = true;
    const { container } = render(<LandingHeroVideo locale="en" />);
    expect(container.querySelector("img")).toHaveAttribute("src", "/media/hero-atmosphere-poster.jpg");
    expect(container.querySelector("video")).not.toHaveAttribute("src");
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("stops playback outside the hero and while the browser tab is hidden", () => {
    render(<LandingHeroVideo locale="en" />);
    act(() => intersect([{ isIntersecting: false } as IntersectionObserverEntry], {} as IntersectionObserver));
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled();
    vi.mocked(HTMLMediaElement.prototype.play).mockClear();
    visibility = "hidden";
    act(() => intersect([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver));
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
    visibility = "visible";
    fireEvent(document, new Event("visibilitychange"));
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalled();
  });

  it("keeps a visible still if playback is blocked or the video fails", async () => {
    vi.mocked(HTMLMediaElement.prototype.play).mockRejectedValue(new Error("autoplay blocked"));
    const { container } = render(<LandingHeroVideo locale="en" />);
    expect(await screen.findByRole("button", { name: "Play background video" })).toBeInTheDocument();
    fireEvent.error(container.querySelector("video")!);
    expect(container.querySelector(".workspace-hero-atmosphere")).toHaveAttribute("data-video-ready", "false");
    expect(container.querySelector("img")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
