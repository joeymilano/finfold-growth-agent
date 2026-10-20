import React from "react";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GrowthLineChart } from "@/components/app-shell/GrowthPortfolio";

const points = [{ date: "2026-10-01", value: 12 }, { date: "2026-10-02", value: 18 }];
let frame: FrameRequestCallback;
const strokes: string[] = [];
const context = {
  setTransform: vi.fn(), clearRect: vi.fn(), beginPath: vi.fn(), closePath: vi.fn(),
  moveTo: vi.fn(), lineTo: vi.fn(), fill: vi.fn(), arc: vi.fn(), fillText: vi.fn(),
  save: vi.fn(), restore: vi.fn(),
  createLinearGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
  strokeStyle: "", stroke: vi.fn(() => strokes.push(context.strokeStyle)),
  fillStyle: "", lineWidth: 0, lineCap: "", lineJoin: "", font: "", textAlign: "", textBaseline: "", shadowBlur: 0
};

beforeEach(() => {
  vi.clearAllMocks();
  strokes.length = 0;
  document.documentElement.setAttribute("data-theme", "light");
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(context as unknown as CanvasRenderingContext2D);
  vi.spyOn(window, "getComputedStyle").mockImplementation(() => ({
    getPropertyValue: (token: string) => token === "--action"
      ? document.documentElement.getAttribute("data-theme") === "dark" ? "138 195 183" : "45 107 99"
      : token === "--fg-muted" ? "101 107 116" : "227 229 232"
  }) as CSSStyleDeclaration);
  vi.stubGlobal("matchMedia", () => ({ matches: true }));
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frame = callback; return 1; });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.documentElement.removeAttribute("data-theme");
});

function drawChart() {
  const view = render(<GrowthLineChart points={points} days={30} locale="en" ariaLabel="Follower growth" />);
  act(() => frame(1));
  return view;
}

describe("growth chart rendering", () => {
  it("keeps all four grid lines inside the chart rather than using the window height", () => {
    drawChart();
    const gridCoordinates = context.moveTo.mock.calls.slice(0, 4);
    expect(gridCoordinates.map(([, y]) => y)).toEqual([24, 78, 132, 186]);
  });

  it("redraws the curve on a theme change and stops observing after unmount", async () => {
    const view = drawChart();
    expect(strokes).toContain("rgba(45,107,99,1)");
    act(() => document.documentElement.setAttribute("data-theme", "dark"));
    await waitFor(() => expect(strokes).toContain("rgba(138,195,183,1)"));
    view.unmount();
    const draws = context.stroke.mock.calls.length;
    await act(async () => { document.documentElement.setAttribute("data-theme", "light"); });
    expect(context.stroke).toHaveBeenCalledTimes(draws);
    expect(window.cancelAnimationFrame).toHaveBeenCalledWith(1);
  });
});
