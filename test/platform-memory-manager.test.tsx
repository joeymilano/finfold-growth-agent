import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { PlatformMemoryManager } from "@/components/memory/PlatformMemoryManager";
import { brandBrainSchema } from "@/lib/brand-brain";

describe("PlatformMemoryManager", () => {
  it("adds a high-confidence manual platform preference only after an explicit action", () => {
    const onChange = vi.fn();
    render(<PlatformMemoryManager brain={brandBrainSchema.parse({})} locale="en" onChange={onChange} />);

    fireEvent.change(screen.getByPlaceholderText("e.g. On X, lead with the concrete trade-off"), {
      target: { value: "Lead with a concrete trade-off." }
    });
    fireEvent.click(screen.getByRole("button", { name: "Add platform memory" }));

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
      platformMemory: [expect.objectContaining({
        platform: "xiaohongshu",
        kind: "preference",
        source: "manual",
        confidence: "high",
        value: "Lead with a concrete trade-off."
      })]
    }));
  });

  it("ignores Enter while an IME is composing", () => {
    const onChange = vi.fn();
    render(<PlatformMemoryManager brain={brandBrainSchema.parse({})} locale="zh" onChange={onChange} />);
    const input = screen.getByPlaceholderText("例如：在 X 开头先给出具体取舍");
    fireEvent.change(input, { target: { value: "开头先给" } });
    fireEvent.keyDown(input, { key: "Enter", keyCode: 229 });
    fireEvent.keyDown(input, { key: "Enter", isComposing: true });
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("shows localized source and confidence labels instead of raw values", () => {
    const brain = brandBrainSchema.parse({
      platformMemory: [{
        id: "m1", platform: "x", kind: "preference", value: "Lead with the trade-off",
        source: "manual", confidence: "high", createdAt: "2026-10-18T10:00:00.000Z"
      }]
    });
    render(<PlatformMemoryManager brain={brain} locale="zh" onChange={vi.fn()} />);
    expect(screen.getByText("X · 偏好 · 手动添加 · 高可信")).toBeTruthy();
    expect(screen.queryByText(/manual · high/)).toBeNull();
  });
});
