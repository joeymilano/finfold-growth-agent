import "@testing-library/jest-dom/vitest";
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/useLocale", () => ({ useLocale: () => "zh" }));
vi.mock("@/components/brand/CommercialAssetLibrary", () => ({ CommercialAssetLibrary: () => null }));
vi.mock("@/components/app-shell/WorkspacePageHeader", () => ({
  WorkspacePageHeader: ({ title, actions }: { title: string; actions?: React.ReactNode }) => <header><h1>{title}</h1>{actions}</header>
}));
const toast = vi.hoisted(() => vi.fn());
vi.mock("@/components/ui/Toast", () => ({ addToast: toast }));

import BrandMemoryPage from "@/app/(dashboard)/brand-memory/page";
import GuardrailsPage from "@/app/(dashboard)/guardrails/page";

type Handler = (url: string, init?: RequestInit) => Response | Promise<Response>;
let handler: Handler;

beforeEach(() => {
  toast.mockReset();
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value); },
    removeItem: (key: string) => { store.delete(key); },
    clear: () => store.clear()
  });
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => handler(String(input), init)));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("Brand Memory page", () => {
  it("blocks saving when the saved memory could not be loaded", async () => {
    handler = (url) => (url === "/api/brand-brain" ? json({ error: "boom" }, 500) : json({}));
    render(<BrandMemoryPage />);
    expect(await screen.findByText(/没能读取已保存的品牌记忆/)).toBeInTheDocument();
    for (const button of screen.getAllByRole("button", { name: /保存记忆/ })) expect(button).toBeDisabled();
  });

  it("commits a typed-but-unconfirmed tag on save and sends the loaded version", async () => {
    const puts: Array<Record<string, unknown>> = [];
    handler = (url, init) => {
      if (url === "/api/brand-brain" && init?.method === "PUT") {
        const body = JSON.parse(String(init.body));
        puts.push(body);
        return json({ brain: body, persisted: true, updatedAt: "2026-10-18T11:00:00Z" });
      }
      if (url === "/api/brand-brain") return json({ brain: {}, persisted: true, updatedAt: "2026-10-18T10:00:00Z" });
      return json({});
    };
    render(<BrandMemoryPage />);
    const saveButton = (await screen.findAllByRole("button", { name: /保存记忆/ }))[0];
    await waitFor(() => expect(saveButton).toBeEnabled());

    const toneInput = screen.getByRole("textbox", { name: "语气关键词" });
    fireEvent.change(toneInput, { target: { value: "克制" } });
    fireEvent.keyDown(toneInput, { key: "Enter", keyCode: 229 });
    expect(screen.queryByText("克制", { selector: "span" })).toBeNull();
    fireEvent.click(saveButton);

    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0].toneKeywords).toEqual(["克制"]);
    expect(puts[0].expectedUpdatedAt).toBe("2026-10-18T10:00:00Z");
  });

  it("explains a conflict instead of claiming a local save", async () => {
    handler = (url, init) => {
      if (url === "/api/brand-brain" && init?.method === "PUT") return json({ error: "内容已在别处更新，请刷新后再保存" }, 409);
      if (url === "/api/brand-brain") return json({ brain: { brandName: "Finfold" }, persisted: true, updatedAt: "2026-10-18T10:00:00Z" });
      return json({});
    };
    render(<BrandMemoryPage />);
    const saveButton = (await screen.findAllByRole("button", { name: /保存记忆/ }))[0];
    await waitFor(() => expect(saveButton).toBeEnabled());
    fireEvent.click(saveButton);
    await waitFor(() => expect(toast).toHaveBeenCalledWith("error", "内容已在别处更新，请刷新后再保存"));
    expect(toast).not.toHaveBeenCalledWith(expect.anything(), expect.stringContaining("已保存到本地"));
  });
});

describe("Guardrails page", () => {
  it("deletes one of two rules that share a title", async () => {
    const rules = [
      { id: "r1", title: "同名", titleEn: "", detail: "第一条", detailEn: "", type: "avoid" },
      { id: "r2", title: "同名", titleEn: "", detail: "第二条", detailEn: "", type: "avoid" }
    ];
    const puts: Array<Record<string, unknown>> = [];
    handler = (url, init) => {
      if (url === "/api/guardrails" && init?.method === "PUT") {
        const body = JSON.parse(String(init.body));
        puts.push(body);
        return json({ ...body, persisted: true, updatedAt: "2026-10-18T11:00:00Z" });
      }
      if (url === "/api/guardrails") return json({ rules, enabledPacks: [], persisted: true, updatedAt: "2026-10-18T10:00:00Z" });
      return json({ brain: {}, persisted: true, updatedAt: null });
    };
    render(<GuardrailsPage />);
    await screen.findByText("第二条");
    fireEvent.click(screen.getAllByRole("button", { name: "删除 同名" })[0]);
    await waitFor(() => expect(puts).toHaveLength(1));
    expect((puts[0].rules as Array<{ id: string }>).map((rule) => rule.id)).toEqual(["r2"]);
    expect(puts[0].expectedUpdatedAt).toBe("2026-10-18T10:00:00Z");
    await waitFor(() => expect(screen.queryByText("第一条")).toBeNull());
    expect(screen.getByText("第二条")).toBeInTheDocument();
  });

  it("rolls the list back when saving a new rule fails", async () => {
    handler = (url, init) => {
      if (url === "/api/guardrails" && init?.method === "PUT") return json({ error: "boom" }, 500);
      if (url === "/api/guardrails") return json({ rules: [], enabledPacks: [], persisted: true, updatedAt: null });
      return json({ brain: {}, persisted: true, updatedAt: null });
    };
    render(<GuardrailsPage />);
    await screen.findByText("还没有自定义规则");
    fireEvent.click(screen.getAllByRole("button", { name: /新增规则/ })[0]);
    fireEvent.change(screen.getByLabelText("规则标题"), { target: { value: "不说第一" } });
    fireEvent.change(screen.getByLabelText("规则说明"), { target: { value: "不要使用绝对化用语" } });
    fireEvent.click(screen.getByRole("button", { name: "确认保存" }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith("error", "规则未能保存到账号，请重试。"));
    expect(screen.getByText("还没有自定义规则")).toBeInTheDocument();
    // The draft stays open so nothing typed is lost.
    expect(screen.getByLabelText("规则标题")).toHaveValue("不说第一");
  });
});
