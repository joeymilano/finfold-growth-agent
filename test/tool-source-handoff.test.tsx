import "@testing-library/jest-dom/vitest";
import React from "react";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToolSourceClinic } from "@/components/tools/ToolSourceClinic";
import { toolPages } from "@/lib/tool-pages";
import { readWorkbenchAuthDraft } from "@/lib/workbench-auth-draft";
const m=vi.hoisted(()=>({push:vi.fn(),capture:vi.fn()}));
vi.mock("next/navigation",()=>({useRouter:()=>({push:m.push})}));
vi.mock("@/lib/posthog",()=>({captureEvent:m.capture}));
beforeEach(()=>{
  vi.clearAllMocks();const values=new Map<string,string>();
  Object.defineProperty(window,"localStorage",{configurable:true,value:{getItem:(k:string)=>values.get(k)??null,setItem:(k:string,v:string)=>values.set(k,v)}});
});
afterEach(cleanup);
describe("tool source continuation",()=>{
  it.each(["zh", "en"] as const)("accepts the built-in %s example as complete", (locale) => {
    render(<ToolSourceClinic config={toolPages[0]} locale={locale} />);
    fireEvent.click(screen.getByRole("button", { name: locale === "en" ? "Use example" : "看示例" }));
    expect(screen.getByText("5 / 5")).toBeInTheDocument();
    expect(screen.queryByText("1 things to add")).not.toBeInTheDocument();
  });
  it("preserves the selected tool and original text without putting source in URL or analytics",()=>{
    const tool=toolPages.find(t=>t.platform==="linkedin")!;
    render(<ToolSourceClinic config={tool} locale="en" />);
    const source="Yesterday our team launched a real update for independent designers.";
    fireEvent.change(screen.getByLabelText("Your source"),{target:{value:source}});
    fireEvent.click(screen.getByRole("button",{name:"Continue to generate"}));
    const href=m.push.mock.calls[0][0];
    const id=new URL(href,"https://www.finfold.app").searchParams.get("authDraft");
    expect(readWorkbenchAuthDraft(id)).toMatchObject({ideaText:source,platforms:["linkedin"],locale:"en",visualMode:"none"});
    expect(readWorkbenchAuthDraft(id)?.toolAttribution).toEqual({ tool_slug: tool.slug, source_origin: "user", tool_draft_id: id });
    expect(href).not.toContain("Yesterday");
    expect(JSON.stringify(m.capture.mock.calls)).not.toContain(source);
  });
  it.each([false, true])("labels example handoffs, including edits (%s), without source text", (edited) => {
    render(<ToolSourceClinic config={toolPages[0]} locale="en" />);
    fireEvent.click(screen.getByRole("button", { name: "Use example" }));
    const input = screen.getByLabelText("Your source") as HTMLTextAreaElement;
    if (edited) fireEvent.change(input, { target: { value: input.value + " An additional fact." } });
    fireEvent.click(screen.getByRole("button", { name: "Continue to generate" }));
    expect(m.capture).toHaveBeenCalledWith("tool_source_handoff_clicked", expect.objectContaining({ source_origin: edited ? "edited_sample" : "sample", handoff_version: 3 }));
    expect(JSON.stringify(m.capture.mock.calls)).not.toContain(input.value);
  });
  it("keeps the source visible instead of navigating when storage fails",()=>{
    render(<ToolSourceClinic config={toolPages[0]} locale="zh" />);
    const source="这是必须保留的原始材料，注册之前不能丢掉这些真实细节。";
    fireEvent.change(screen.getByLabelText("你的原材料"),{target:{value:source}});
    window.localStorage.setItem=()=>{throw new Error("quota");};
    fireEvent.click(screen.getByRole("button",{name:"继续生成"}));
    expect(m.push).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByLabelText("你的原材料")).toHaveValue(source);
  });
});
