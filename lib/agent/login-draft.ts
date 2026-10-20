import { z } from "zod";

const KEY = "finfold:agent-login-draft:v1";
const MAX_AGE = 24 * 60 * 60 * 1000;
const schema = z.object({
  pathname: z.string().startsWith("/").max(240),
  input: z.string().max(4000),
  savedAt: z.number().finite()
});

export function saveAgentLoginDraft(pathname: string, input: string): boolean {
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify(schema.parse({ pathname, input, savedAt: Date.now() })));
    return true;
  } catch { return false; }
}

/** Restore for review only. Authentication must never automatically send a prompt. */
export function consumeAgentLoginDraft(pathname: string): string | null {
  try {
    const parsed = schema.safeParse(JSON.parse(window.sessionStorage.getItem(KEY) ?? "null"));
    if (!parsed.success) return null;
    const draft = parsed.data;
    const age = Date.now() - draft.savedAt;
    if (age < 0 || age > MAX_AGE) { window.sessionStorage.removeItem(KEY); return null; }
    if (draft.pathname !== pathname) return null;
    window.sessionStorage.removeItem(KEY);
    return draft.input;
  } catch { return null; }
}
