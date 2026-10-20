"use client";

import { useState } from "react";
import type { Locale } from "@/lib/i18n";

/** A writing aid using only the visitor's own facts, never a generated sample. */
export function FirstTaskInputGuide({ locale, disabled, onApply }: {
  locale: Locale; disabled: boolean; onApply: (text: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [answers, setAnswers] = useState(["", "", ""]);
  const en = locale === "en";
  const text = answers.map(answer => answer.trim()).filter(Boolean).join("\n\n");
  return <div className="mb-4 rounded-xl border border-hairline bg-bg/50 p-4">
    <button type="button" disabled={disabled} aria-expanded={open} aria-controls="first-task-guide" onClick={() => setOpen(!open)} className="focus-ring text-left text-sm font-semibold text-action-strong">
      {en ? "No draft yet? Start with three questions" : "还没写好？从三个问题开始"}
    </button>
    {open ? <div id="first-task-guide" className="mt-4 space-y-4">
      {(en ? ["What did you make, learn, or change?", "Who is it for?", "Which detail should the reader remember?"] : ["这次做了什么、学到了什么，或改进了什么？", "希望谁看到？", "有什么希望读者记住的具体细节？"]).map((label, i) => <label key={label} className="block text-xs leading-5 text-fg-muted">{label}<textarea value={answers[i]} maxLength={3500} rows={2} disabled={disabled} onChange={event => setAnswers(current => current.map((value, index) => index === i ? event.target.value : value))} className="focus-ring mt-1 block w-full resize-y rounded-lg border border-hairline bg-surface p-3 text-sm text-fg" /></label>)}
      <p className="text-xs leading-5 text-fg-muted">{en ? "Use your own facts. Only your answers will be added; you can edit them before continuing." : "只填写真实信息。仅将你的回答放入材料，继续前仍可修改。"}</p>
      <button type="button" disabled={disabled || text.length < 20} onClick={() => { onApply(text); setOpen(false); }} className="btn-secondary min-h-11 disabled:opacity-50">{en ? "Use these answers" : "用这些回答开始"}</button>
    </div> : null}
  </div>;
}
