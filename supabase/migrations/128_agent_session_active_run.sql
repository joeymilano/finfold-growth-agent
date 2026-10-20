-- ============================================================
-- Migration 128: Agent session in-progress marker
--
-- A Finfold智能体 run streams into one browser tab. Another tab or device
-- that opens the same conversation used to see the trailing user message as
-- an unfinished turn and offer a retry, starting a second, separately charged
-- run. /api/agent/chat now records the run on the session while it works:
--
--   active_run_id          the run holding the session (compare-and-clear:
--                          a run only ever clears its own id)
--   active_run_started_at  claim / heartbeat time; a marker older than the
--                          stale bound (15 minutes, refreshed every 2 minutes
--                          by a live run) is ignored, so a run that died
--                          without clearing it never blocks the session
--
-- The route claims the marker with one conditional UPDATE, so two concurrent
-- requests cannot both start a run on the same session. Deploy order is
-- free: before this migration the route skips the marker and logs it.
--
-- Rows stay covered by the existing per-user agent_sessions RLS policies
-- (migration 028); no new policy or grant is needed.
-- ============================================================

ALTER TABLE public.agent_sessions
  ADD COLUMN IF NOT EXISTS active_run_id uuid;

ALTER TABLE public.agent_sessions
  ADD COLUMN IF NOT EXISTS active_run_started_at timestamptz;
