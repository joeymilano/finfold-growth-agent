-- ============================================================
-- Finfold — combined migrations 001–020, in order.
-- Paste this whole file into the Supabase SQL Editor and Run.
-- Safe to re-run: every statement uses IF NOT EXISTS / idempotent guards
-- where the original migrations did. Do NOT run supabase/schema.sql.
-- ============================================================


-- ========================================================
-- >>> 000_base_tables (from schema.sql — content_kits, kit_outputs,
-- usage_events, subscriptions, performance_metrics were never created by
-- any numbered migration; they only ever existed in schema.sql, which the
-- README says not to run because its profiles/handle_new_user definitions
-- drift from 001/011/012's. This block carries over ONLY the base tables
-- those numbered migrations assume already exist, skipping profiles,
-- brand_brains, and handle_new_user (001/004/012 own those).
-- ========================================================

create table if not exists public.content_kits (
  id           uuid        primary key default gen_random_uuid(),
  user_id      uuid        not null references auth.users(id) on delete cascade,
  idea_text    text        not null,
  goal         text        not null,
  persona      text        not null,
  platforms    text[]      not null default '{}',
  media_assets jsonb       not null default '[]',
  status       text        not null default 'saved'
                           check (status in ('preview','saved','published','analyzed')),
  created_at   timestamptz not null default now()
);

create table if not exists public.kit_outputs (
  id             uuid        primary key default gen_random_uuid(),
  kit_id         uuid        not null references public.content_kits(id) on delete cascade,
  user_id        uuid        not null references auth.users(id) on delete cascade,
  platform       text        not null,
  title          text        not null default '',
  body           text        not null default '',
  cta            text        not null default '',
  notes          text        not null default '',
  strategy       text        not null default '',
  locked         boolean     not null default false,
  publish_status text        not null default 'draft'
                             check (publish_status in ('draft','planned','posted','measured','iterated')),
  created_at     timestamptz not null default now()
);

create table if not exists public.usage_events (
  id         uuid        primary key default gen_random_uuid(),
  user_id    uuid        not null references auth.users(id) on delete cascade,
  event_name text        not null,
  metadata   jsonb       not null default '{}',
  created_at timestamptz not null default now()
);

create table if not exists public.subscriptions (
  id                       uuid        primary key default gen_random_uuid(),
  user_id                  uuid        not null references auth.users(id) on delete cascade,
  payment_provider         text        not null default 'creem',
  provider_customer_id     text,
  provider_subscription_id text        unique,
  stripe_customer_id       text,
  stripe_subscription_id   text,
  status                   text        not null default 'incomplete',
  current_period_end       timestamptz,
  cancel_at                timestamptz,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

create table if not exists public.performance_metrics (
  id           uuid        primary key default gen_random_uuid(),
  kit_id       uuid        not null references public.content_kits(id) on delete cascade,
  user_id      uuid        not null references auth.users(id) on delete cascade,
  platform     text        not null,
  impressions  integer     not null default 0,
  clicks       integer     not null default 0,
  likes        integer     not null default 0,
  comments     integer     not null default 0,
  saves        integer     not null default 0,
  shares       integer     not null default 0,
  leads        integer     not null default 0,
  signups      integer     not null default 0,
  revenue      numeric     not null default 0,
  published_url text,
  measured_at  timestamptz not null default now(),
  created_at   timestamptz not null default now(),
  unique (kit_id, platform)
);

create index if not exists idx_content_kits_user_created
  on public.content_kits(user_id, created_at desc);
create index if not exists idx_kit_outputs_kit_id
  on public.kit_outputs(kit_id);
create index if not exists idx_kit_outputs_user_id
  on public.kit_outputs(user_id);
create index if not exists idx_usage_events_user_created
  on public.usage_events(user_id, created_at desc);
create index if not exists idx_subscriptions_user_id
  on public.subscriptions(user_id);
create index if not exists idx_performance_metrics_kit_id
  on public.performance_metrics(kit_id);

alter table public.content_kits        enable row level security;
alter table public.kit_outputs         enable row level security;
alter table public.usage_events        enable row level security;
alter table public.subscriptions       enable row level security;
alter table public.performance_metrics enable row level security;

drop policy if exists "kits: select own" on public.content_kits;
create policy "kits: select own"  on public.content_kits for select  using (auth.uid() = user_id);
drop policy if exists "kits: insert own" on public.content_kits;
create policy "kits: insert own"  on public.content_kits for insert  with check (auth.uid() = user_id);
drop policy if exists "kits: update own" on public.content_kits;
create policy "kits: update own"  on public.content_kits for update  using (auth.uid() = user_id);
drop policy if exists "kits: delete own" on public.content_kits;
create policy "kits: delete own"  on public.content_kits for delete  using (auth.uid() = user_id);

drop policy if exists "outputs: select own" on public.kit_outputs;
create policy "outputs: select own"  on public.kit_outputs for select  using (auth.uid() = user_id);
drop policy if exists "outputs: insert own" on public.kit_outputs;
create policy "outputs: insert own"  on public.kit_outputs for insert  with check (auth.uid() = user_id);
drop policy if exists "outputs: update own" on public.kit_outputs;
create policy "outputs: update own"  on public.kit_outputs for update  using (auth.uid() = user_id);
drop policy if exists "outputs: delete own" on public.kit_outputs;
create policy "outputs: delete own"  on public.kit_outputs for delete  using (auth.uid() = user_id);

drop policy if exists "events: select own" on public.usage_events;
create policy "events: select own"  on public.usage_events for select  using (auth.uid() = user_id);
drop policy if exists "events: insert own" on public.usage_events;
create policy "events: insert own"  on public.usage_events for insert  with check (auth.uid() = user_id);

drop policy if exists "subs: select own" on public.subscriptions;
create policy "subs: select own"  on public.subscriptions for select  using (auth.uid() = user_id);

drop policy if exists "perf: select own" on public.performance_metrics;
create policy "perf: select own"  on public.performance_metrics for select  using (auth.uid() = user_id);
drop policy if exists "perf: insert own" on public.performance_metrics;
create policy "perf: insert own"  on public.performance_metrics for insert  with check (auth.uid() = user_id);
drop policy if exists "perf: update own" on public.performance_metrics;
create policy "perf: update own"  on public.performance_metrics for update  using (auth.uid() = user_id);


-- ========================================================
-- >>> 001_initial_schema.sql
-- ========================================================
-- ============================================================
-- Finfold — Supabase Database Migration
-- Run this SQL in the Supabase Dashboard → SQL Editor
-- ============================================================

-- 1. Create the profiles table
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  plan TEXT NOT NULL DEFAULT 'free',
  locale TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 1b. If profiles already existed from a prior partial run, it may be
-- missing columns this migration set expects further down (e.g. locale).
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS locale TEXT;

-- 2. Enable Row Level Security
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- 3. RLS policies
-- Users can read their own profile
DROP POLICY IF EXISTS "Users can read own profile" ON public.profiles;
CREATE POLICY "Users can read own profile"
  ON public.profiles FOR SELECT
  USING (auth.uid() = id);

-- Users can update their own profile
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = id);

-- Service role has full access (used by backend API routes)
DROP POLICY IF EXISTS "Service role full access" ON public.profiles;
CREATE POLICY "Service role full access"
  ON public.profiles FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- 4. Auto-create profile on user signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, plan, locale)
  VALUES (NEW.id, 'free', NULL)
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5. Create the trigger
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 6. Create the avatars storage bucket (if it doesn't exist)
INSERT INTO storage.buckets (id, name, public)
VALUES ('avatars', 'avatars', true)
ON CONFLICT (id) DO NOTHING;

-- 7. Storage policies for avatars bucket
-- Anyone can view avatars (public bucket)
DROP POLICY IF EXISTS "Public read access" ON storage.objects;
CREATE POLICY "Public read access"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'avatars');

-- Authenticated users can upload their own avatar
DROP POLICY IF EXISTS "Users can upload own avatar" ON storage.objects;
CREATE POLICY "Users can upload own avatar"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'avatars' AND auth.uid()::text = (storage.foldername(name))[1]);

-- Users can update their own avatar
DROP POLICY IF EXISTS "Users can update own avatar" ON storage.objects;
CREATE POLICY "Users can update own avatar"
  ON storage.objects FOR UPDATE
  USING (bucket_id = 'avatars' AND auth.uid()::text = (storage.foldername(name))[1]);

-- Service role has full access to storage
DROP POLICY IF EXISTS "Service role storage access" ON storage.objects;
CREATE POLICY "Service role storage access"
  ON storage.objects FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- 8. Backfill profiles for existing users
INSERT INTO public.profiles (id, plan, locale)
SELECT id, 'free', NULL
FROM auth.users
WHERE id NOT IN (SELECT id FROM public.profiles)
ON CONFLICT (id) DO NOTHING;


-- ========================================================
-- >>> 002_payment_provider.sql
-- ========================================================
-- ============================================================
-- Migration 002: Add payment provider columns to subscriptions
-- Run after 001 (initial schema)
-- ============================================================

-- Add new columns (additive, non-breaking)
ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS payment_provider text NOT NULL DEFAULT 'creem';

ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS provider_customer_id text;

ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS provider_subscription_id text;

ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS cancel_at timestamptz;

-- Unique index on provider_subscription_id (partial — ignores NULLs)
CREATE UNIQUE INDEX IF NOT EXISTS idx_subscriptions_provider_sub_id
  ON public.subscriptions(provider_subscription_id)
  WHERE provider_subscription_id IS NOT NULL;

-- Index for provider-based lookups
CREATE INDEX IF NOT EXISTS idx_subscriptions_provider_customer
  ON public.subscriptions(payment_provider, provider_customer_id);

-- Backfill from existing Stripe data (safe to re-run)
UPDATE public.subscriptions
SET
  provider_customer_id = stripe_customer_id,
  provider_subscription_id = stripe_subscription_id,
  payment_provider = 'creem'
WHERE stripe_customer_id IS NOT NULL
  AND provider_customer_id IS NULL;


-- ========================================================
-- >>> 003_subscription_entitlements.sql
-- ========================================================
-- ============================================================
-- Migration 003: Subscription entitlement reliability
-- Run after 002.
-- ============================================================

-- One active customer binding row per user/provider is required for
-- checkout.completed to idempotently link Creem customers to app users.
CREATE UNIQUE INDEX IF NOT EXISTS idx_subscriptions_user_provider
  ON public.subscriptions(user_id, payment_provider);

-- Keep webhook subscription upserts idempotent when provider_subscription_id
-- is present, while still allowing checkout rows before subscription creation.
CREATE UNIQUE INDEX IF NOT EXISTS idx_subscriptions_provider_sub_id
  ON public.subscriptions(provider_subscription_id)
  WHERE provider_subscription_id IS NOT NULL;


-- ========================================================
-- >>> 004_brand_brains.sql
-- ========================================================
-- ============================================================
-- Migration 004: Account-level Brand Brain
-- Run after 003.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.brand_brains (
  user_id                uuid        primary key references auth.users(id) on delete cascade,
  brand_name             text        not null default '',
  product_description    text        not null default '',
  target_audience        text        not null default '',
  tone_keywords          text[]      not null default '{}',
  banned_phrases         text[]      not null default '{}',
  approved_examples      text[]      not null default '{}',
  competitors            text[]      not null default '{}',
  positioning_statement  text        not null default '',
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

ALTER TABLE public.brand_brains enable row level security;

DROP POLICY IF EXISTS "brand brains: select own" ON public.brand_brains;
CREATE POLICY "brand brains: select own"
  ON public.brand_brains FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "brand brains: insert own" ON public.brand_brains;
CREATE POLICY "brand brains: insert own"
  ON public.brand_brains FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "brand brains: update own" ON public.brand_brains;
CREATE POLICY "brand brains: update own"
  ON public.brand_brains FOR UPDATE
  USING (auth.uid() = user_id);


-- ========================================================
-- >>> 005_locale_and_creem_fields.sql
-- ========================================================
-- Migration 005: Add locale and Creem subscription fields to profiles
-- Run in: Supabase Dashboard → SQL Editor → New query → Run

-- Add locale preference to profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS locale TEXT DEFAULT 'zh' CHECK (locale IN ('zh', 'en'));

-- Add Creem subscription fields (referenced in Appendix B of the task doc)
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS creem_subscription_id TEXT;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS subscription_status TEXT DEFAULT 'active';

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS renewed_at TIMESTAMPTZ;

-- Update default monthly_limit from 5 to 3 for new free users
ALTER TABLE public.profiles
  ALTER COLUMN monthly_limit SET DEFAULT 3;


-- ========================================================
-- >>> 006_user_agents.sql
-- ========================================================
-- ============================================================
-- Finfold — Letta Agent Mapping Table
-- Maps each Supabase user to their corresponding Letta agent.
-- ============================================================

-- 1. Create the user_agents table
CREATE TABLE IF NOT EXISTS public.user_agents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  letta_agent_id TEXT NOT NULL,
  letta_agent_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_user_agents_user_id UNIQUE (user_id),
  CONSTRAINT uq_user_agents_letta_agent_id UNIQUE (letta_agent_id)
);

-- 2. Enable Row Level Security
ALTER TABLE public.user_agents ENABLE ROW LEVEL SECURITY;

-- 3. RLS policies
-- Users can read their own agent mapping
DROP POLICY IF EXISTS "Users can read own agent" ON public.user_agents;
CREATE POLICY "Users can read own agent"
  ON public.user_agents FOR SELECT
  USING (auth.uid() = user_id);

-- Service role has full access (used by backend API routes)
DROP POLICY IF EXISTS "Service role agent full access" ON public.user_agents;
CREATE POLICY "Service role agent full access"
  ON public.user_agents FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- 4. Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_user_agents_user_id ON public.user_agents (user_id);
CREATE INDEX IF NOT EXISTS idx_user_agents_letta_agent_id ON public.user_agents (letta_agent_id);

-- 5. Auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION public.update_user_agents_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS on_user_agents_updated ON public.user_agents;
CREATE TRIGGER on_user_agents_updated
  BEFORE UPDATE ON public.user_agents
  FOR EACH ROW EXECUTE FUNCTION public.update_user_agents_updated_at();


-- ========================================================
-- >>> 007_media_bucket.sql
-- ========================================================
-- 007_media_bucket.sql
-- Storage bucket for Workbench media uploads (images / videos attached to a
-- content kit). Public read so generated previews can render the URLs; writes
-- are scoped to the owning user's folder, with full service-role access for
-- the server-side upload route.

-- 1. Create the public 'media' bucket (idempotent)
INSERT INTO storage.buckets (id, name, public)
VALUES ('media', 'media', true)
ON CONFLICT (id) DO NOTHING;

-- 2. Anyone can read media (public bucket — needed for preview rendering)
DROP POLICY IF EXISTS "Public read access media" ON storage.objects;
CREATE POLICY "Public read access media"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'media');

-- 3. Authenticated users can upload into their own folder (media/<uid>/...)
DROP POLICY IF EXISTS "Users can upload own media" ON storage.objects;
CREATE POLICY "Users can upload own media"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'media' AND auth.uid()::text = (storage.foldername(name))[1]);

-- 4. Users can update their own media
DROP POLICY IF EXISTS "Users can update own media" ON storage.objects;
CREATE POLICY "Users can update own media"
  ON storage.objects FOR UPDATE
  USING (bucket_id = 'media' AND auth.uid()::text = (storage.foldername(name))[1]);

-- 5. Users can delete their own media
DROP POLICY IF EXISTS "Users can delete own media" ON storage.objects;
CREATE POLICY "Users can delete own media"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'media' AND auth.uid()::text = (storage.foldername(name))[1]);

-- Note: the existing "Service role storage access" policy from
-- 001_initial_schema.sql already grants the server-side admin client full
-- access to all buckets, including 'media'.


-- ========================================================
-- >>> 008_kit_output_images_and_quota.sql
-- ========================================================
-- ============================================================
-- Migration 008: kit_outputs image columns + atomic quota reservation
-- Run after 007.
-- ============================================================

-- 1. kit_outputs was missing image_url/image_prompt columns that
--    app/api/generate/route.ts has always tried to insert — every kit
--    generation's kit_outputs insert was silently failing in production.
ALTER TABLE public.kit_outputs
  ADD COLUMN IF NOT EXISTS image_url text;

ALTER TABLE public.kit_outputs
  ADD COLUMN IF NOT EXISTS image_prompt text;

-- 2. Atomic per-user-per-month generation counter. Quota enforcement was
--    previously a read-count-then-insert race (two concurrent requests could
--    both read "under limit" and both proceed). This table + the two
--    functions below make reservation atomic via a single
--    INSERT ... ON CONFLICT DO UPDATE ... WHERE statement.
CREATE TABLE IF NOT EXISTS public.usage_counters (
  user_id    uuid        not null references auth.users(id) on delete cascade,
  month_start date        not null,
  used       integer     not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, month_start)
);

ALTER TABLE public.usage_counters ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "usage counters: select own" ON public.usage_counters;
CREATE POLICY "usage counters: select own"
  ON public.usage_counters FOR SELECT
  USING (auth.uid() = user_id);

-- Backfill from existing content_kits rows so users don't get a free
-- extra month of quota the first time this migration runs.
INSERT INTO public.usage_counters (user_id, month_start, used)
SELECT user_id, date_trunc('month', created_at)::date, count(*)::integer
FROM public.content_kits
GROUP BY user_id, date_trunc('month', created_at)::date
ON CONFLICT (user_id, month_start) DO UPDATE SET used = excluded.used;

-- Atomically increments the counter and returns the new value, but only if
-- the current value is below p_limit. Returns -1 if the limit is already
-- reached (no row is modified in that case) so callers can distinguish
-- "reserved" (>= 0) from "quota exceeded" (-1) without a second query.
CREATE OR REPLACE FUNCTION public.reserve_generation_credit(
  p_user_id uuid,
  p_month_start date,
  p_limit integer
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_used integer;
BEGIN
  IF p_limit <= 0 THEN
    RETURN -1;
  END IF;

  INSERT INTO public.usage_counters (user_id, month_start, used, updated_at)
  VALUES (p_user_id, p_month_start, 1, now())
  ON CONFLICT (user_id, month_start) DO UPDATE
    SET used = public.usage_counters.used + 1, updated_at = now()
    WHERE public.usage_counters.used < p_limit
  RETURNING used INTO v_used;

  IF v_used IS NULL THEN
    RETURN -1;
  END IF;

  RETURN v_used;
END;
$$;

-- Refunds one credit (e.g. the generation failed after reservation).
-- Never goes below zero.
CREATE OR REPLACE FUNCTION public.release_generation_credit(
  p_user_id uuid,
  p_month_start date
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.usage_counters
  SET used = greatest(used - 1, 0), updated_at = now()
  WHERE user_id = p_user_id AND month_start = p_month_start;
END;
$$;


-- ========================================================
-- >>> 009_iteration_reports.sql
-- ========================================================
-- ============================================================
-- Migration 009: Persist iteration reports (previously in-memory only)
-- Run after 008.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.iteration_reports (
  id           uuid        primary key default gen_random_uuid(),
  kit_id       uuid        not null references public.content_kits(id) on delete cascade,
  user_id      uuid        not null references auth.users(id) on delete cascade,
  summary      text        not null default '',
  wins         text[]      not null default '{}',
  problems     text[]      not null default '{}',
  next_actions text[]      not null default '{}',
  created_at   timestamptz not null default now()
);

CREATE INDEX IF NOT EXISTS idx_iteration_reports_kit_id
  ON public.iteration_reports(kit_id);
CREATE INDEX IF NOT EXISTS idx_iteration_reports_user_created
  ON public.iteration_reports(user_id, created_at desc);

ALTER TABLE public.iteration_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "iteration reports: select own" ON public.iteration_reports;
CREATE POLICY "iteration reports: select own"
  ON public.iteration_reports FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "iteration reports: insert own" ON public.iteration_reports;
CREATE POLICY "iteration reports: insert own"
  ON public.iteration_reports FOR INSERT
  WITH CHECK (auth.uid() = user_id);


-- ========================================================
-- >>> 010_webhook_idempotency.sql
-- ========================================================
-- ============================================================
-- Migration 010: Creem webhook idempotency
-- Run after 009.
--
-- The webhook handler verified HMAC signatures but never recorded which
-- events it had already processed, so a captured signed payload could be
-- replayed indefinitely (e.g. replaying subscription.canceled to keep
-- downgrading a paying user back to free).
-- ============================================================

CREATE TABLE IF NOT EXISTS public.webhook_events (
  id           text        primary key, -- Creem event.id
  event_type   text        not null,
  processed_at timestamptz not null default now()
);

ALTER TABLE public.webhook_events ENABLE ROW LEVEL SECURITY;
-- No policies: only the service-role client (which bypasses RLS) touches
-- this table; it is not part of any user-facing read/write surface.


-- ========================================================
-- >>> 011_reconcile_profiles.sql
-- ========================================================
-- ============================================================
-- Migration 011: Reconcile profiles table drift
--
-- schema.sql and 001_initial_schema.sql both define `profiles` with
-- `CREATE TABLE IF NOT EXISTS`, so whichever ran first on a given
-- Supabase project silently "won" and the other's extra columns/
-- constraints were never applied. schema.sql's version has
-- monthly_limit + a plan CHECK constraint that 001's version lacks;
-- if 001 ran first, every paid-plan lookup in app/api/generate and
-- app/api/entitlements/check silently falls back to the free tier
-- default because monthly_limit doesn't exist.
--
-- This migration is safe to run regardless of which one applied —
-- everything is additive and IF NOT EXISTS / guarded.
-- ============================================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS email text;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS monthly_limit integer NOT NULL DEFAULT 3;

ALTER TABLE public.profiles
  ALTER COLUMN plan SET NOT NULL;

ALTER TABLE public.profiles
  ALTER COLUMN plan SET DEFAULT 'free';

-- Add the plan CHECK constraint by name, idempotently. The original 011
-- used an ILIKE probe for the old tier list which, on a full re-run after
-- 017 has already installed the NEW-tier constraint under the same name,
-- would not match and then fail on a duplicate ADD CONSTRAINT. Since 017
-- (further down) is the authoritative definition anyway, here we only
-- ensure *a* constraint of this name exists; 017 will replace it.
-- Regularize any plan value that the (old) constraint about to be added
-- wouldn't accept — including the NEW-tier values 'growth'/'employee' that
-- may already exist if 017 ran on a prior attempt. They get restored to
-- their proper values by 017 further down; this is only to survive the
-- brief window where 011's old constraint is the active one.
UPDATE public.profiles
  SET plan = 'free'
  WHERE plan IS NULL
     OR plan NOT IN ('free', 'starter', 'creator', 'pro', 'team');

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.profiles'::regclass
      AND conname = 'profiles_plan_check'
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_plan_check
      CHECK (plan IN ('free', 'starter', 'creator', 'pro', 'team'));
  END IF;
END $$;

-- Backfill email for any profile rows created before this column existed.
UPDATE public.profiles p
SET email = u.email
FROM auth.users u
WHERE p.id = u.id AND p.email IS NULL;


-- ========================================================
-- >>> 012_fix_handle_new_user.sql
-- ========================================================
-- ============================================================
-- Migration 012: Re-establish the correct handle_new_user() trigger
--
-- schema.sql and 001_initial_schema.sql each define public.handle_new_user()
-- with CREATE OR REPLACE FUNCTION. Whichever ran LAST wins for the function
-- body (unlike the table itself, which uses IF NOT EXISTS so whichever ran
-- FIRST wins). Per the README setup order (schema.sql, then migrations in
-- order), 001's version currently wins in practice — and it inserts
-- (id, plan, locale) only, dropping the email backfill and the
-- `set search_path = public` hardening that schema.sql's version had.
--
-- This migration makes the complete version authoritative regardless of
-- what ran before it, since it is the highest-numbered migration touching
-- this function.
-- ============================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email)
  VALUES (NEW.id, NEW.email)
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();


-- ========================================================
-- >>> 013_custom_guardrails.sql
-- ========================================================
-- ============================================================
-- Migration 013: Persist custom brand guardrails server-side
--
-- Guardrails were previously localStorage-only (finfold-custom-guardrails),
-- so a customer configuring banned phrases on one device got none of that
-- enforcement on another device or a teammate's browser — silent
-- brand-compliance failure for a core feature. This mirrors the
-- brand_brains pattern: one row per user, upserted from the server.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.custom_guardrails (
  user_id    uuid        primary key references auth.users(id) on delete cascade,
  rules      jsonb       not null default '[]',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

ALTER TABLE public.custom_guardrails ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "custom guardrails: select own" ON public.custom_guardrails;
CREATE POLICY "custom guardrails: select own"
  ON public.custom_guardrails FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "custom guardrails: insert own" ON public.custom_guardrails;
CREATE POLICY "custom guardrails: insert own"
  ON public.custom_guardrails FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "custom guardrails: update own" ON public.custom_guardrails;
CREATE POLICY "custom guardrails: update own"
  ON public.custom_guardrails FOR UPDATE
  USING (auth.uid() = user_id);


-- ========================================================
-- >>> 014_trial_generations.sql
-- ========================================================
-- ============================================================
-- Migration 014: Persistent trial generation ledger
--
-- lib/rate-limit.ts is explicitly best-effort in-memory — Cloudflare Pages
-- runs each request on one of many isolated instances with no shared
-- memory, so a scripted trial abuser rotating across isolates (or just
-- making enough requests) faces no real ceiling on /api/trial/generate,
-- which is an unauthenticated LLM-cost surface. This table gives that
-- route a durable, per-IP-per-day cap enforced atomically in Postgres,
-- the same pattern as usage_counters/reserve_generation_credit (008).
-- ============================================================

CREATE TABLE IF NOT EXISTS public.trial_generations (
  id         uuid        primary key default gen_random_uuid(),
  ip_hash    text        not null,
  day_start  date        not null,
  idea_text  text        not null,
  platforms  jsonb       not null default '[]',
  created_at timestamptz not null default now()
);

CREATE INDEX IF NOT EXISTS trial_generations_ip_day_idx
  ON public.trial_generations (ip_hash, day_start);

ALTER TABLE public.trial_generations ENABLE ROW LEVEL SECURITY;

-- No public SELECT/INSERT policy — this table is only ever touched by the
-- service-role client from app/api/trial/generate/route.ts, mirroring
-- usage_counters/webhook_events. Row Level Security stays enabled with no
-- permissive policy so it defaults to deny for any non-service-role caller.

-- Atomically counts today's trial generations for an IP and inserts a new
-- ledger row in one round trip when under the limit. Returns the new count,
-- or -1 if the daily limit is already reached (no row inserted).
CREATE OR REPLACE FUNCTION public.reserve_trial_generation(
  p_ip_hash text,
  p_day_start date,
  p_idea_text text,
  p_platforms jsonb,
  p_limit integer
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  SELECT count(*) INTO v_count
  FROM public.trial_generations
  WHERE ip_hash = p_ip_hash AND day_start = p_day_start;

  IF v_count >= p_limit THEN
    RETURN -1;
  END IF;

  INSERT INTO public.trial_generations (ip_hash, day_start, idea_text, platforms)
  VALUES (p_ip_hash, p_day_start, p_idea_text, p_platforms);

  RETURN v_count + 1;
END;
$$;


-- ========================================================
-- >>> 015_editable_outputs.sql
-- ========================================================
-- ============================================================
-- Migration 015: Editable outputs + edit log
--
-- Generated outputs were read-only — copy or export the AI draft verbatim,
-- or discard it. This adds an editable "final" body per output (separate
-- from the original AI draft, so we can later diff edits into style
-- learning — see plan §4 "编辑回路") plus publish tracking fields the
-- Workbench UI already reads/writes for kit history (kit_outputs.publish_status
-- exists since 001, but published_url/published_at do not yet).
-- ============================================================

ALTER TABLE public.kit_outputs
  ADD COLUMN IF NOT EXISTS final_body text;

ALTER TABLE public.kit_outputs
  ADD COLUMN IF NOT EXISTS user_edited boolean NOT NULL DEFAULT false;

ALTER TABLE public.kit_outputs
  ADD COLUMN IF NOT EXISTS published_url text;

ALTER TABLE public.kit_outputs
  ADD COLUMN IF NOT EXISTS published_at timestamptz;

-- Append-only edit log: every time a user saves an edit to an output body,
-- we record the before/after pair here. This is raw material for the
-- future style-learning loop (diff edits -> distill persistent style rules
-- -> inject into future generations) — see plan §4. Not used for that yet,
-- just captured so it exists in history once that loop ships.
CREATE TABLE IF NOT EXISTS public.output_edits (
  id          uuid        primary key default gen_random_uuid(),
  output_id   uuid        not null references public.kit_outputs(id) on delete cascade,
  user_id     uuid        not null references auth.users(id) on delete cascade,
  field       text        not null check (field in ('body', 'title', 'cta')),
  before_text text        not null,
  after_text  text        not null,
  created_at  timestamptz not null default now()
);

CREATE INDEX IF NOT EXISTS output_edits_output_id_idx ON public.output_edits (output_id);

ALTER TABLE public.output_edits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "output edits: select own" ON public.output_edits;
CREATE POLICY "output edits: select own"
  ON public.output_edits FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "output edits: insert own" ON public.output_edits;
CREATE POLICY "output edits: insert own"
  ON public.output_edits FOR INSERT
  WITH CHECK (auth.uid() = user_id);


-- ========================================================
-- >>> 016_brand_brain_enrichment.sql
-- ========================================================
-- ============================================================
-- Migration 016: Brand Memory URL bootstrap metadata
--
-- Pro+ plans can populate Brand Memory from a product URL instead of
-- typing every field by hand (plan §4 "Bootstrap 回路"). These columns
-- track where an auto-filled brain came from and when, so the UI can show
-- "imported from your site on <date>" and so a future re-bootstrap can
-- diff against what was auto-extracted vs. hand-edited afterward.
-- ============================================================

ALTER TABLE public.brand_brains
  ADD COLUMN IF NOT EXISTS source_url text;

ALTER TABLE public.brand_brains
  ADD COLUMN IF NOT EXISTS auto_extracted boolean NOT NULL DEFAULT false;

ALTER TABLE public.brand_brains
  ADD COLUMN IF NOT EXISTS enriched_at timestamptz;


-- ========================================================
-- >>> 017_new_plan_tiers.sql
-- ========================================================
-- ============================================================
-- Migration 017: Update profiles.plan CHECK constraint for new plan tiers
--
-- Migration 011 added a CHECK constraint restricting profiles.plan to the
-- old ('free','starter','creator','pro','team') set. The pricing model
-- moved to ('free','starter','pro','growth','employee') — 'creator' and
-- 'team' are gone, 'growth' and 'employee' are new. Without this migration,
-- every checkout/webhook write of a 'growth' or 'employee' plan would be
-- rejected at the database level with a CHECK violation.
--
-- Also introduces a "founding_member" flag: the first 10 Digital Employee
-- customers lock in ¥999/mo for life (vs. the standard ¥1,999) as an M1
-- cash-flow / early-feedback presale (see plan roadmap W2/W4).
-- ============================================================

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_plan_check;

-- NOTE: the original migration 017 added the new CHECK constraint BEFORE
-- running these data migrations, so any pre-existing row on a retired plan
-- id ('creator'/'team') made the ADD CONSTRAINT fail. Reordered here so the
-- data is cleaned FIRST, then the constraint is added.
--
-- 'creator' and 'pro' overlapped in seat count with the new 'pro' tier
-- closely enough to map directly; 'team' has no direct successor yet, so it
-- downgrades to 'growth' (closest kit allowance) rather than silently
-- losing paid status.
UPDATE public.profiles SET plan = 'pro' WHERE plan = 'creator';
UPDATE public.profiles SET plan = 'growth' WHERE plan = 'team';

-- Safety net for any other unexpected/legacy/NULL plan value so the new
-- constraint can't be violated by a row we didn't anticipate.
UPDATE public.profiles
  SET plan = 'free'
  WHERE plan IS NULL
     OR plan NOT IN ('free', 'starter', 'pro', 'growth', 'employee');

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_plan_check
  CHECK (plan IN ('free', 'starter', 'pro', 'growth', 'employee'));

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS founding_member boolean NOT NULL DEFAULT false;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS founding_member_locked_price integer;


-- ========================================================
-- >>> 018_kit_shares.sql
-- ========================================================
-- ============================================================
-- Migration 018: Public kit share pages
--
-- Backs /share/[slug] — the growth loop where a user's generated kit
-- becomes a public page (cover image as OG, "Made with Finfold" footer)
-- that they post to 即刻/V2EX/Reddit/X themselves (plan §6 "非 SEO 增长").
-- One kit can have at most one active share slug; toggling share off
-- just flips is_public rather than deleting the row, so view_count and
-- the slug survive a re-share.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.kit_shares (
  id         uuid        primary key default gen_random_uuid(),
  kit_id     uuid        not null references public.content_kits(id) on delete cascade,
  user_id    uuid        not null references auth.users(id) on delete cascade,
  slug       text        not null unique,
  is_public  boolean     not null default true,
  view_count integer     not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (kit_id)
);

CREATE INDEX IF NOT EXISTS kit_shares_slug_idx ON public.kit_shares (slug);

ALTER TABLE public.kit_shares ENABLE ROW LEVEL SECURITY;

-- Owners manage their own share row (create/toggle/delete).
DROP POLICY IF EXISTS "kit shares: select own" ON public.kit_shares;
CREATE POLICY "kit shares: select own"
  ON public.kit_shares FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "kit shares: insert own" ON public.kit_shares;
CREATE POLICY "kit shares: insert own"
  ON public.kit_shares FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "kit shares: update own" ON public.kit_shares;
CREATE POLICY "kit shares: update own"
  ON public.kit_shares FOR UPDATE
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "kit shares: delete own" ON public.kit_shares;
CREATE POLICY "kit shares: delete own"
  ON public.kit_shares FOR DELETE
  USING (auth.uid() = user_id);

-- Public read of the share row itself (needed so the /share/[slug] route
-- can resolve slug -> kit_id) is intentionally NOT granted here — the
-- route reads via the service-role admin client server-side instead, so
-- anonymous visitors never get a Postgres session that could enumerate
-- other users' kit_shares/content_kits/kit_outputs rows.

-- Atomically increments a share's view count. SECURITY DEFINER so the
-- anonymous /share/[slug] page (no Postgres session) can bump it without
-- needing a public UPDATE policy that would otherwise let anyone tamper
-- with any row.
CREATE OR REPLACE FUNCTION public.increment_kit_share_view(p_slug text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.kit_shares
  SET view_count = view_count + 1
  WHERE slug = p_slug AND is_public = true;
END;
$$;


-- ========================================================
-- >>> 019_learned_style.sql
-- ========================================================
-- ============================================================
-- Migration 019: Learned style — the edit-learning loop
--
-- Every time a user edits an output's body, that before/after pair already
-- lands in output_edits (migration 015). This adds the other half: a
-- distilled, persistent list of style rules on brand_brains that future
-- generations read back — "it gets more like you every week" (plan §4
-- "编辑回路"). Capped at ~10 rules (enforced in application code, not here)
-- so the prompt injection stays small and the signal stays high-value.
-- ============================================================

ALTER TABLE public.brand_brains
  ADD COLUMN IF NOT EXISTS learned_style text[] NOT NULL DEFAULT '{}';


-- ========================================================
-- >>> 020_watch_sources.sql
-- ========================================================
-- ============================================================
-- Migration 020: Update-monitoring watch sources (Digital Employee tier)
--
-- Backs the proactiveMonitoring plan feature (employee tier only — see
-- lib/payment/types.ts PLAN_FEATURES): a user configures a changelog/RSS/
-- GitHub-releases URL, a separate Cloudflare Worker polls it on a cron
-- schedule (Cloudflare Pages itself has no cron trigger — see the plan's
-- infra note in §3), and on a new entry calls
-- POST /api/watch-sources/[id]/check to auto-draft a kit for the user to
-- review. This is the primary deliverable that makes the ¥1,999/mo tier
-- earn its "digital employee" name rather than just being a bigger model.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.watch_sources (
  id              uuid        primary key default gen_random_uuid(),
  user_id         uuid        not null references auth.users(id) on delete cascade,
  type            text        not null check (type in ('rss', 'changelog', 'github_releases')),
  url             text        not null,
  label           text        not null default '',
  last_seen_hash  text,
  last_checked_at timestamptz,
  enabled         boolean     not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

CREATE INDEX IF NOT EXISTS watch_sources_user_id_idx ON public.watch_sources (user_id);
CREATE INDEX IF NOT EXISTS watch_sources_enabled_idx ON public.watch_sources (enabled) WHERE enabled = true;

ALTER TABLE public.watch_sources ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "watch sources: select own" ON public.watch_sources;
CREATE POLICY "watch sources: select own"
  ON public.watch_sources FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "watch sources: insert own" ON public.watch_sources;
CREATE POLICY "watch sources: insert own"
  ON public.watch_sources FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "watch sources: update own" ON public.watch_sources;
CREATE POLICY "watch sources: update own"
  ON public.watch_sources FOR UPDATE
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "watch sources: delete own" ON public.watch_sources;
CREATE POLICY "watch sources: delete own"
  ON public.watch_sources FOR DELETE
  USING (auth.uid() = user_id);

-- Links an auto-drafted kit back to the watch source that triggered it, so
-- the UI can show "drafted from your changelog update" instead of the kit
-- looking like it appeared out of nowhere.
CREATE TABLE IF NOT EXISTS public.drafted_kits (
  id              uuid        primary key default gen_random_uuid(),
  watch_source_id uuid        not null references public.watch_sources(id) on delete cascade,
  kit_id          uuid        not null references public.content_kits(id) on delete cascade,
  user_id         uuid        not null references auth.users(id) on delete cascade,
  source_entry    text        not null default '',
  created_at      timestamptz not null default now()
);

CREATE INDEX IF NOT EXISTS drafted_kits_watch_source_id_idx ON public.drafted_kits (watch_source_id);

ALTER TABLE public.drafted_kits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "drafted kits: select own" ON public.drafted_kits;
CREATE POLICY "drafted kits: select own"
  ON public.drafted_kits FOR SELECT
  USING (auth.uid() = user_id);


-- ========================================================
-- >>> 022_performance_backflow.sql
-- ========================================================
-- ============================================================
-- Migration 022: Performance backflow — provenance + history
--
-- performance_metrics is a latest-value upsert row per (kit_id, platform),
-- so every re-save overwrites history and there's no way to tell a manually
-- typed number from one an AI extracted from a pasted screenshot/text vs a
-- future automated poll. This adds:
--   1. `source` on the live row, so the UI can label how a number got there.
--   2. `performance_snapshots`, an append-only log written alongside every
--      save — additive only, does not change how performance_metrics is
--      read today, but is what a future trend chart or auto-poller needs.
-- ============================================================

ALTER TABLE public.performance_metrics
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual'
    CHECK (source IN ('manual', 'import', 'auto'));

CREATE TABLE IF NOT EXISTS public.performance_snapshots (
  id           uuid        primary key default gen_random_uuid(),
  kit_id       uuid        not null references public.content_kits(id) on delete cascade,
  user_id      uuid        not null references auth.users(id) on delete cascade,
  platform     text        not null,
  impressions  integer     not null default 0,
  clicks       integer     not null default 0,
  likes        integer     not null default 0,
  comments     integer     not null default 0,
  saves        integer     not null default 0,
  shares       integer     not null default 0,
  leads        integer     not null default 0,
  signups      integer     not null default 0,
  revenue      numeric     not null default 0,
  source       text        not null default 'manual' check (source in ('manual', 'import', 'auto')),
  measured_at  timestamptz not null default now()
);

CREATE INDEX IF NOT EXISTS idx_perf_snapshots_kit_platform_time
  ON public.performance_snapshots(kit_id, platform, measured_at DESC);

ALTER TABLE public.performance_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "perf snapshots: select own" ON public.performance_snapshots;
CREATE POLICY "perf snapshots: select own"
  ON public.performance_snapshots FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "perf snapshots: insert own" ON public.performance_snapshots;
CREATE POLICY "perf snapshots: insert own"
  ON public.performance_snapshots FOR INSERT
  WITH CHECK (auth.uid() = user_id);


-- ============================================================
-- Migrations 023–031 (appended to bring the bundled schema current;
-- mirrors supabase/migrations/023..031 and supabase/backfill-to-latest.sql)
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
