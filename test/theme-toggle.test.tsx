import "@testing-library/jest-dom/vitest";
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { THEME_INIT_SCRIPT, THEME_STORAGE_KEY } from "@/lib/theme";

vi.mock("@/hooks/useLocale", () => ({ useLocale: () => "zh" }));

beforeEach(() => {
  const values = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      clear: () => values.clear(),
      getItem: (key: string) => values.get(key) ?? null,
      key: (index: number) => Array.from(values.keys())[index] ?? null,
      get length() { return values.size; },
      removeItem: (key: string) => values.delete(key),
      setItem: (key: string, value: string) => values.set(key, value)
    }
  });
});

describe("ThemeToggle", () => {
  it.each(["/", "/en", "/tools", "/login"])("applies the saved light preference before hydration on %s", (path) => {
    window.history.replaceState({}, "", path);
    localStorage.setItem(THEME_STORAGE_KEY, "light");
    document.documentElement.setAttribute("data-theme", "dark");
    new Function(THEME_INIT_SCRIPT)();
    expect(document.documentElement).toHaveAttribute("data-theme", "light");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
  });
  it("keeps desktop and mobile controls in sync when either changes the theme", async () => {
    document.documentElement.setAttribute("data-theme", "dark");
    render(<><ThemeToggle /><ThemeToggle /></>);
    const controls = screen.getAllByRole("button", { name: "切换到亮色主题" });
    fireEvent.click(controls[0]);
    await waitFor(() => expect(controls[1]).toHaveAccessibleName("切换到暗色主题"));
    fireEvent.click(controls[1]);
    await waitFor(() => expect(controls[0]).toHaveAccessibleName("切换到亮色主题"));
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
  });

  it("shows the light-mode Lightbulb action while dark mode is active", async () => {
    document.documentElement.setAttribute("data-theme", "dark");
    render(<ThemeToggle />);

    const button = await screen.findByRole("button", { name: "切换到亮色主题" });

    await waitFor(() => {
      expect(button.querySelector('[data-fin-icon="Lightbulb"]')).toBeInTheDocument();
    });
    expect(button.querySelector('[data-fin-icon="Sun"]')).not.toBeInTheDocument();

    fireEvent.click(button);

    expect(document.documentElement).toHaveAttribute("data-theme", "light");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
    expect(button).toHaveAccessibleName("切换到暗色主题");
    expect(button.querySelector('[data-fin-icon="Moon"]')).toBeInTheDocument();
  });
});
