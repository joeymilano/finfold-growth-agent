/**
 * In-tab registry of Agent chat runs that are still streaming.
 *
 * The side rail stays mounted (hidden) on the full-page conversation, so a run
 * started in the rail keeps streaming after the user expands to /dashboard.
 * The full page reads this registry to show that work as still in progress
 * instead of treating the trailing user message as an unfinished turn and
 * offering a retry, which would start a second, separately charged run.
 */
export type ActiveAgentRun = {
  token: number;
  /** Null until the server assigns the session (first `session` event). */
  sessionId: string | null;
  message: string;
  startedAtMs: number;
  /** Stops the run from another surface, exactly like its own stop button. */
  stop?: () => void;
};

let nextToken = 0;
const runs = new Map<number, ActiveAgentRun>();
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of [...listeners]) listener();
}

export function beginActiveAgentRun(input: {
  sessionId: string | null;
  message: string;
  stop?: () => void;
}): number {
  nextToken += 1;
  runs.set(nextToken, {
    token: nextToken,
    sessionId: input.sessionId,
    message: input.message,
    startedAtMs: Date.now(),
    ...(input.stop ? { stop: input.stop } : {})
  });
  notify();
  return nextToken;
}

export function setActiveAgentRunSession(token: number, sessionId: string): void {
  const run = runs.get(token);
  if (!run || run.sessionId === sessionId) return;
  runs.set(token, { ...run, sessionId });
  notify();
}

export function endActiveAgentRun(token: number): void {
  if (runs.delete(token)) notify();
}

export function getActiveAgentRun(token: number): ActiveAgentRun | null {
  return runs.get(token) ?? null;
}

/** The newest in-flight run, optionally limited to one session. */
export function findActiveAgentRun(sessionId?: string | null): ActiveAgentRun | null {
  let latest: ActiveAgentRun | null = null;
  for (const run of runs.values()) {
    if (sessionId !== undefined && run.sessionId !== sessionId) continue;
    if (!latest || run.token > latest.token) latest = run;
  }
  return latest;
}

export function subscribeActiveAgentRuns(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
