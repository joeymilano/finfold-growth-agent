-- ============================================================
-- Migration 125: keep archived official accounts archived, and
-- count lead-tool events on the China-time calendar day.
--
-- 1. The three official-account mirror RPCs (090 WeChat, 104
--    portfolio snapshot, 111 account metrics) upserted
--    managed_social_accounts with ON CONFLICT ... SET status =
--    'active'. Every re-sync therefore resurrected an account the
--    user had archived from the growth overview. The functions
--    below are exact copies of their latest definitions with only
--    that status reset removed: a new binding still lands as
--    'active', an existing row keeps whatever status it has.
--
-- 2. increment_lead_tool_event (112) bucketed visitor events by
--    CURRENT_DATE, which is the UTC date on Supabase. Lead-tool
--    stats are read as Beijing-time days, so events between 00:00
--    and 08:00 China time landed on the previous day. Exact copy
--    with the day computed in Asia/Shanghai.
-- ============================================================

-- save_wechat_official_account_metrics: copy of 090_wechat_official_account_sync.sql, minus the status reset on conflict.
CREATE OR REPLACE FUNCTION public.save_wechat_official_account_metrics(
  p_user_id uuid,
  p_connection_account_id uuid,
  p_summary_rows jsonb,
  p_follower_count bigint,
  p_period_follower_growth integer,
  p_measured_at timestamptz
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_connection_id uuid;
  v_external_account_id text;
  v_display_name text;
  v_handle text;
  v_avatar_url text;
  v_managed_account public.managed_social_accounts%ROWTYPE;
  v_rows integer := 0;
  v_period_growth bigint := 0;
BEGIN
  IF p_user_id IS NULL
     OR p_connection_account_id IS NULL
     OR jsonb_typeof(COALESCE(p_summary_rows, '[]'::jsonb)) <> 'array'
     OR jsonb_array_length(COALESCE(p_summary_rows, '[]'::jsonb)) > 20000
     OR (p_follower_count IS NOT NULL AND p_follower_count < 0)
     OR p_period_follower_growth IS NULL
     OR p_measured_at IS NULL THEN
    RAISE EXCEPTION 'invalid_wechat_official_account_metrics';
  END IF;

  SELECT
    account.connection_id,
    account.external_account_id,
    account.display_name,
    account.handle,
    account.avatar_url
  INTO
    v_connection_id,
    v_external_account_id,
    v_display_name,
    v_handle,
    v_avatar_url
  FROM public.social_connection_accounts account
  JOIN public.social_connections connection ON connection.id = account.connection_id
  WHERE account.id = p_connection_account_id
    AND connection.user_id = p_user_id
    AND connection.connector_id = 'wechat'
    AND connection.status = 'connected';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'wechat_social_connection_account_not_found';
  END IF;

  INSERT INTO public.wechat_user_summary_daily (
    connection_account_id,
    user_id,
    ref_date,
    user_source,
    new_user,
    cancel_user,
    synced_at
  )
  SELECT
    p_connection_account_id,
    p_user_id,
    rows.ref_date,
    rows.user_source,
    rows.new_user,
    rows.cancel_user,
    now()
  FROM jsonb_to_recordset(COALESCE(p_summary_rows, '[]'::jsonb)) AS rows(
    ref_date date,
    user_source integer,
    new_user bigint,
    cancel_user bigint
  )
  WHERE rows.ref_date IS NOT NULL
    AND rows.user_source >= 0
    AND rows.new_user >= 0
    AND rows.cancel_user >= 0
  ON CONFLICT (connection_account_id, ref_date, user_source) DO UPDATE
  SET
    new_user = EXCLUDED.new_user,
    cancel_user = EXCLUDED.cancel_user,
    synced_at = now();

  GET DIAGNOSTICS v_rows = ROW_COUNT;

  SELECT COALESCE(SUM(new_user - cancel_user), 0)
  INTO v_period_growth
  FROM public.wechat_user_summary_daily
  WHERE connection_account_id = p_connection_account_id
    AND ref_date >= date_trunc('month', p_measured_at AT TIME ZONE 'Asia/Shanghai')::date
    AND ref_date <= (p_measured_at AT TIME ZONE 'Asia/Shanghai')::date;

  IF v_period_growth < -2000000000 OR v_period_growth > 2000000000 THEN
    RAISE EXCEPTION 'wechat_official_account_period_growth_out_of_range';
  END IF;

  INSERT INTO public.managed_social_accounts (
    user_id,
    platform,
    display_name,
    handle,
    avatar_url,
    connected_account_id,
    status,
    updated_at
  ) VALUES (
    p_user_id,
    'wechat',
    COALESCE(NULLIF(v_display_name, ''), v_external_account_id),
    v_handle,
    v_avatar_url,
    p_connection_account_id,
    'active',
    now()
  )
  ON CONFLICT (connected_account_id) WHERE connected_account_id IS NOT NULL DO UPDATE
  SET
    display_name = EXCLUDED.display_name,
    handle = EXCLUDED.handle,
    avatar_url = EXCLUDED.avatar_url,
    updated_at = now()
  RETURNING * INTO v_managed_account;

  INSERT INTO public.social_account_snapshots (
    account_id,
    user_id,
    follower_count,
    period_follower_growth,
    views,
    leads,
    source,
    measured_at
  ) VALUES (
    v_managed_account.id,
    p_user_id,
    p_follower_count,
    v_period_growth::integer,
    NULL,
    NULL,
    'official_sync',
    p_measured_at
  );

  INSERT INTO public.social_connection_audit_events (
    user_id,
    connection_id,
    event_type,
    metadata
  ) VALUES (
    p_user_id,
    v_connection_id,
    'account_metrics_synchronized',
    jsonb_build_object(
      'connector_id', 'wechat',
      'summary_rows', v_rows,
      'measured_at', p_measured_at
    )
  );

  RETURN jsonb_build_object(
    'managed_account_id', v_managed_account.id,
    'summary_rows', v_rows,
    'period_follower_growth', v_period_growth
  );
END;
$$;

REVOKE ALL ON FUNCTION public.save_wechat_official_account_metrics(
  uuid, uuid, jsonb, bigint, integer, timestamptz
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_wechat_official_account_metrics(
  uuid, uuid, jsonb, bigint, integer, timestamptz
) TO service_role;

-- upsert_official_account_portfolio_snapshot: copy of 104_official_account_portfolio_sync.sql, minus the status reset on conflict.
CREATE OR REPLACE FUNCTION public.upsert_official_account_portfolio_snapshot(
  p_user_id uuid,
  p_connection_account_id uuid,
  p_follower_count bigint,
  p_views bigint,
  p_measured_at timestamptz
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_connection_id uuid;
  v_connector_id text;
  v_external_account_id text;
  v_display_name text;
  v_handle text;
  v_avatar_url text;
  v_managed_account public.managed_social_accounts%ROWTYPE;
BEGIN
  IF p_user_id IS NULL
     OR p_connection_account_id IS NULL
     OR (p_follower_count IS NOT NULL AND p_follower_count < 0)
     OR (p_views IS NOT NULL AND p_views < 0)
     OR p_measured_at IS NULL THEN
    RAISE EXCEPTION 'invalid_official_account_portfolio_snapshot';
  END IF;
  IF p_follower_count IS NULL AND p_views IS NULL THEN
    RAISE EXCEPTION 'official_account_portfolio_snapshot_requires_a_metric';
  END IF;

  SELECT
    connection.id,
    connection.connector_id,
    account.external_account_id,
    account.display_name,
    account.handle,
    account.avatar_url
  INTO
    v_connection_id,
    v_connector_id,
    v_external_account_id,
    v_display_name,
    v_handle,
    v_avatar_url
  FROM public.social_connection_accounts account
  JOIN public.social_connections connection ON connection.id = account.connection_id
  WHERE account.id = p_connection_account_id
    AND connection.user_id = p_user_id
    AND connection.connector_id IN ('x', 'linkedin', 'instagram', 'wechat')
    AND connection.status = 'connected';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'social_connection_account_not_found';
  END IF;

  INSERT INTO public.managed_social_accounts (
    user_id,
    platform,
    display_name,
    handle,
    avatar_url,
    connected_account_id,
    status,
    updated_at
  ) VALUES (
    p_user_id,
    v_connector_id,
    COALESCE(NULLIF(v_display_name, ''), v_external_account_id),
    v_handle,
    v_avatar_url,
    p_connection_account_id,
    'active',
    now()
  )
  ON CONFLICT (connected_account_id) WHERE connected_account_id IS NOT NULL DO UPDATE
  SET
    display_name = EXCLUDED.display_name,
    handle = EXCLUDED.handle,
    avatar_url = EXCLUDED.avatar_url,
    updated_at = now()
  RETURNING * INTO v_managed_account;

  INSERT INTO public.social_account_snapshots (
    account_id,
    user_id,
    follower_count,
    period_follower_growth,
    views,
    leads,
    source,
    measured_at
  ) VALUES (
    v_managed_account.id,
    p_user_id,
    p_follower_count,
    NULL,
    p_views,
    NULL,
    'official_sync',
    p_measured_at
  );

  INSERT INTO public.social_connection_audit_events (
    user_id,
    connection_id,
    event_type,
    metadata
  ) VALUES (
    p_user_id,
    v_connection_id,
    'account_metrics_synchronized',
    jsonb_build_object(
      'connector_id', v_connector_id,
      'portfolio_snapshot', true
    )
  );

  RETURN v_managed_account.id;
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_official_account_portfolio_snapshot(
  uuid, uuid, bigint, bigint, timestamptz
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_official_account_portfolio_snapshot(
  uuid, uuid, bigint, bigint, timestamptz
) TO service_role;

-- save_official_social_account_metrics: copy of 111_official_account_metrics_allow_x.sql, minus the status reset on conflict.
CREATE OR REPLACE FUNCTION public.save_official_social_account_metrics(
  p_user_id uuid,
  p_connection_account_id uuid,
  p_follower_count bigint,
  p_views bigint,
  p_reach bigint,
  p_profile_views bigint,
  p_measured_at timestamptz
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_connection_account public.social_connection_accounts%ROWTYPE;
  v_connection public.social_connections%ROWTYPE;
  v_managed_account public.managed_social_accounts%ROWTYPE;
  v_snapshot_id uuid;
BEGIN
  SELECT account.* INTO v_connection_account
  FROM public.social_connection_accounts account
  JOIN public.social_connections connection ON connection.id = account.connection_id
  WHERE account.id = p_connection_account_id
    AND connection.user_id = p_user_id
    AND connection.status = 'connected'
    AND connection.connector_id IN ('instagram', 'linkedin', 'x');

  IF NOT FOUND THEN RAISE EXCEPTION 'official_social_account_not_found'; END IF;

  SELECT * INTO v_connection
  FROM public.social_connections
  WHERE id = v_connection_account.connection_id;

  IF (p_follower_count IS NOT NULL AND p_follower_count < 0)
     OR (p_views IS NOT NULL AND p_views < 0)
     OR (p_reach IS NOT NULL AND p_reach < 0)
     OR (p_profile_views IS NOT NULL AND p_profile_views < 0) THEN
    RAISE EXCEPTION 'invalid_official_social_account_metrics';
  END IF;

  INSERT INTO public.managed_social_accounts (
    user_id, platform, display_name, handle, avatar_url,
    connected_account_id, status, updated_at
  ) VALUES (
    p_user_id,
    v_connection.connector_id,
    coalesce(nullif(v_connection_account.display_name, ''), v_connection_account.external_account_id),
    v_connection_account.handle,
    v_connection_account.avatar_url,
    v_connection_account.id,
    'active',
    now()
  )
  ON CONFLICT (connected_account_id) WHERE connected_account_id IS NOT NULL DO UPDATE
  SET display_name = EXCLUDED.display_name,
      handle = EXCLUDED.handle,
      avatar_url = EXCLUDED.avatar_url,
      updated_at = now()
  RETURNING * INTO v_managed_account;

  IF p_follower_count IS NOT NULL OR p_views IS NOT NULL
     OR p_reach IS NOT NULL OR p_profile_views IS NOT NULL THEN
    INSERT INTO public.social_account_snapshots (
      account_id, user_id, follower_count, views, reach, profile_views,
      source, measured_at
    ) VALUES (
      v_managed_account.id,
      p_user_id,
      p_follower_count,
      p_views,
      p_reach,
      p_profile_views,
      'official_sync',
      coalesce(p_measured_at, now())
    ) RETURNING id INTO v_snapshot_id;
  END IF;

  INSERT INTO public.social_connection_audit_events (
    user_id, connection_id, event_type, metadata
  ) VALUES (
    p_user_id,
    v_connection.id,
    'account_metrics_synchronized',
    jsonb_build_object(
      'connector_id', v_connection.connector_id,
      'connection_account_id', v_connection_account.id,
      'snapshot_created', v_snapshot_id IS NOT NULL
    )
  );

  RETURN jsonb_build_object(
    'managed_account_id', v_managed_account.id,
    'snapshot_id', v_snapshot_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.save_official_social_account_metrics(
  uuid, uuid, bigint, bigint, bigint, bigint, timestamptz
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_official_social_account_metrics(
  uuid, uuid, bigint, bigint, bigint, bigint, timestamptz
) TO service_role;

-- increment_lead_tool_event: copy of 112_lead_tools.sql with the day in Asia/Shanghai.
CREATE OR REPLACE FUNCTION public.increment_lead_tool_event(
  p_slug text,
  p_event text,
  p_result_id text default null,
  p_entry_id text default null
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_tool_id uuid;
  v_result_key text;
  v_day date := (now() AT TIME ZONE 'Asia/Shanghai')::date;
BEGIN
  SELECT id INTO v_tool_id
  FROM public.lead_tools
  WHERE slug = p_slug AND status = 'published';

  IF v_tool_id IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO public.lead_tool_event_daily (tool_id, day, opens, completions, cta_clicks, result_counts)
  VALUES (v_tool_id, v_day, 0, 0, 0, '{}'::jsonb)
  ON CONFLICT (tool_id, day) DO NOTHING;

  IF p_event = 'open' THEN
    UPDATE public.lead_tool_event_daily
    SET opens = opens + 1
    WHERE tool_id = v_tool_id AND day = v_day;

  ELSIF p_event = 'complete' THEN
    v_result_key := COALESCE(NULLIF(btrim(p_result_id), ''), '_unknown');
    UPDATE public.lead_tool_event_daily
    SET completions = completions + 1,
        result_counts = jsonb_set(
          result_counts,
          ARRAY[v_result_key],
          to_jsonb(COALESCE((result_counts ->> v_result_key)::integer, 0) + 1)
        )
    WHERE tool_id = v_tool_id AND day = v_day;

  ELSIF p_event = 'cta_click' THEN
    UPDATE public.lead_tool_event_daily
    SET cta_clicks = cta_clicks + 1
    WHERE tool_id = v_tool_id AND day = v_day;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.increment_lead_tool_event(text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.increment_lead_tool_event(text, text, text, text) TO service_role;
