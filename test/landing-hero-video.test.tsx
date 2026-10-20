import "@testing-library/jest-dom/vitest";
import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AlmanacFilm } from "@/components/landing/LandingPage";

let visibility = "visible";

beforeEach(() => {
  visibility = "visible";
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibility });
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("landing framed reel", () => {
  it("lets visitors stop and resume decorative motion without navigating", async () => {
    const { container } = render(<AlmanacFilm locale="zh" />);
    const video = container.querySelector("video")!;
    expect(video).toHaveAttribute("src", "/media/hero-atmosphere.mp4");
    expect(video.muted).toBe(true);
    expect(video.loop).toBe(true);
    await act(async () => {});
    fireEvent.click(screen.getByRole("button", { name: "暂停胶片" }));
    expect(screen.getByRole("button", { name: "播放胶片" })).toHaveAttribute("aria-pressed", "true");
    expect(video.paused).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "播放胶片" }));
    expect(screen.getByRole("button", { name: "暂停胶片" })).toHaveAttribute("aria-pressed", "false");
  });

  it("keeps the still frame when the visitor prefers reduced motion", () => {
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
    const { container } = render(<AlmanacFilm locale="zh" />);
    expect(container.querySelector("video")).toBeNull();
    expect(container.querySelector("img")).not.toBeNull();
  });
});
