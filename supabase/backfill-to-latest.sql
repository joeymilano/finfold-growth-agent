-- ============================================================
-- Backfill script — bring an existing DB up to the latest schema
-- (applies migrations 023 through 031).
--
-- WHY THIS EXISTS:
-- ALL_MIGRATIONS.sql (the project's bundled schema) had fallen behind
-- at migration ~022. Migrations 023–031 were shipped as code but never
-- folded into the bundled schema, and the project has no automated
-- migration runner — so on environments initialized from the bundle,
-- these tables/columns are missing. The user-visible symptom was:
--   Toggling an Industry Rule Pack in /guardrails fails with
--   "行业规则库设置未能保存" — because migration 027
--   (custom_guardrails.enabled_packs) was never applied, so the
--   upsert in /api/guardrails errors out.
--
-- Run this ONCE in the Supabase SQL Editor (production). Every statement
-- is idempotent (IF NOT EXISTS / DROP POLICY IF EXISTS), so re-running is
-- safe regardless of which of 023–031 the DB already has applied.
-- ============================================================

-- ============================================================
-- 023: Persist quality scores at generation time
-- ============================================================
CREATE TABLE IF NOT EXISTS public.quality_scores (
  id            uuid        primary key default gen_random_uuid(),
  output_id     uuid        not null references public.kit_outputs(id) on delete cascade,
  kit_id        uuid        not null references public.content_kits(id) on delete cascade,
  user_id       uuid        not null references auth.users(id) on delete cascade,
  platform      text        not null,
  overall       integer     not null,
  grade         text        not null check (grade in ('A', 'B', 'C', 'D')),
  dimensions    jsonb       not null,
  score_version integer     not null default 1,
  scored_at     timestamptz not null default now(),
  UNIQUE (output_id, score_version)
);

CREATE INDEX IF NOT EXISTS idx_quality_scores_user_platform
  ON public.quality_scores(user_id, platform);
CREATE INDEX IF NOT EXISTS idx_quality_scores_kit
  ON public.quality_scores(kit_id);

ALTER TABLE public.quality_scores ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "quality scores: select own" ON public.quality_scores;
CREATE POLICY "quality scores: select own"
  ON public.quality_scores FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "quality scores: insert own" ON public.quality_scores;
CREATE POLICY "quality scores: insert own"
  ON public.quality_scores FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- ============================================================
-- 024: Few-shot backflow experiment bucketing (content_kits)
-- ============================================================
ALTER TABLE public.content_kits
  ADD COLUMN IF NOT EXISTS experiment_bucket text
    CHECK (experiment_bucket IN ('treatment', 'control')),
  ADD COLUMN IF NOT EXISTS flywheel_meta jsonb;

-- ============================================================
-- 025: Negative-learning + adopted performance rules (brand_brains)
-- ============================================================
ALTER TABLE public.brand_brains
  ADD COLUMN IF NOT EXISTS learned_negative text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS performance_rules text[] NOT NULL DEFAULT '{}';

-- ============================================================
-- 026: User-supplied X (Twitter) API credentials
-- ============================================================
CREATE TABLE IF NOT EXISTS public.user_integrations (
  user_id          uuid        primary key references auth.users(id) on delete cascade,
  x_bearer_token   text,
  x_token_added_at timestamptz,
  updated_at       timestamptz not null default now()
);

ALTER TABLE public.user_integrations ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 027: Industry rule packs (opt-in compliance libraries)  ← FIXES THE REPORTED TOGGLE BUG
-- ============================================================
ALTER TABLE public.custom_guardrails
  ADD COLUMN IF NOT EXISTS enabled_packs text[] NOT NULL DEFAULT '{}';

-- ============================================================
-- 028: Agent chat persistence
-- ============================================================
CREATE TABLE IF NOT EXISTS public.agent_sessions (
  id         uuid        primary key default gen_random_uuid(),
  user_id    uuid        not null references auth.users(id) on delete cascade,
  title      text        not null default '新对话',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

CREATE INDEX IF NOT EXISTS idx_agent_sessions_user_updated
  ON public.agent_sessions(user_id, updated_at DESC);

ALTER TABLE public.agent_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "agent sessions: select own" ON public.agent_sessions;
CREATE POLICY "agent sessions: select own"
  ON public.agent_sessions FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "agent sessions: insert own" ON public.agent_sessions;
CREATE POLICY "agent sessions: insert own"
  ON public.agent_sessions FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "agent sessions: update own" ON public.agent_sessions;
CREATE POLICY "agent sessions: update own"
  ON public.agent_sessions FOR UPDATE
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "agent sessions: delete own" ON public.agent_sessions;
CREATE POLICY "agent sessions: delete own"
  ON public.agent_sessions FOR DELETE
  USING (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS public.agent_messages (
  id         uuid        primary key default gen_random_uuid(),
  session_id uuid        not null references public.agent_sessions(id) on delete cascade,
  user_id    uuid        not null references auth.users(id) on delete cascade,
  role       text        not null check (role in ('user', 'assistant', 'tool')),
  content    jsonb       not null,
  created_at timestamptz not null default now()
);

CREATE INDEX IF NOT EXISTS idx_agent_messages_session_time
  ON public.agent_messages(session_id, created_at ASC);

ALTER TABLE public.agent_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "agent messages: select own" ON public.agent_messages;
CREATE POLICY "agent messages: select own"
  ON public.agent_messages FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "agent messages: insert own" ON public.agent_messages;
CREATE POLICY "agent messages: insert own"
  ON public.agent_messages FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "agent messages: delete own" ON public.agent_messages;
CREATE POLICY "agent messages: delete own"
  ON public.agent_messages FOR DELETE
  USING (auth.uid() = user_id);

-- ============================================================
-- 029: Agent mutation audit + safe undo metadata
-- ============================================================
CREATE TABLE IF NOT EXISTS public.agent_action_audit (
  id            uuid        primary key default gen_random_uuid(),
  user_id       uuid        not null references auth.users(id) on delete cascade,
  session_id    uuid        references public.agent_sessions(id) on delete set null,
  tool_name     text        not null,
  target_type   text        not null check (target_type in ('guardrails', 'brand_brain')),
  action_args   jsonb       not null default '{}',
  before_state  jsonb       not null,
  after_state   jsonb       not null,
  status        text        not null default 'applied' check (status in ('applied', 'reverted')),
  created_at    timestamptz not null default now(),
  reverted_at   timestamptz
);

CREATE INDEX IF NOT EXISTS idx_agent_action_audit_user_created
  ON public.agent_action_audit(user_id, created_at DESC);

ALTER TABLE public.agent_action_audit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "agent action audit: select own" ON public.agent_action_audit;
CREATE POLICY "agent action audit: select own"
  ON public.agent_action_audit FOR SELECT
  USING (auth.uid() = user_id);

-- ============================================================
-- 030: Explicit output feedback
-- ============================================================
CREATE TABLE IF NOT EXISTS public.output_feedback (
  id           uuid        primary key default gen_random_uuid(),
  output_id    uuid        not null references public.kit_outputs(id) on delete cascade,
  kit_id       uuid        not null references public.content_kits(id) on delete cascade,
  user_id      uuid        not null references auth.users(id) on delete cascade,
  platform     text        not null,
  rating       text        not null check (rating in ('helpful', 'unhelpful')),
  reason_codes text[]      not null default '{}',
  note         text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (output_id, user_id)
);

CREATE INDEX IF NOT EXISTS output_feedback_user_created_idx
  ON public.output_feedback(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS output_feedback_kit_idx
  ON public.output_feedback(kit_id);

ALTER TABLE public.output_feedback ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "output feedback: select own" ON public.output_feedback;
CREATE POLICY "output feedback: select own"
  ON public.output_feedback FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "output feedback: insert own" ON public.output_feedback;
CREATE POLICY "output feedback: insert own"
  ON public.output_feedback FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "output feedback: update own" ON public.output_feedback;
CREATE POLICY "output feedback: update own"
  ON public.output_feedback FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "output feedback: delete own" ON public.output_feedback;
CREATE POLICY "output feedback: delete own"
  ON public.output_feedback FOR DELETE
  USING (auth.uid() = user_id);

-- ============================================================
-- 031: Activation-code creator audit
-- ============================================================
ALTER TABLE public.activation_codes
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS activation_codes_created_by_idx
  ON public.activation_codes(created_by, created_at DESC);
