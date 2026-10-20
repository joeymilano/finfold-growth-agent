-- ============================================================
-- Migration 126: scan-pay plans grant credits per paid 30-day period,
-- and a refunded plan gives back the credits it granted.
--
-- 1. ensure_cycle_plan_credits replaces the direct grant_plan_credits
--    call in lib/payment/credits.ts#ensurePlanCredits.
--    - Card (Creem) and free users keep the UTC calendar-month batch
--      ('YYYY-MM'), exactly as before.
--    - A live one-off scan-pay plan (zcwpay / alipay_qrcode, 30 days per
--      payment) gets one plan batch per paid 30-day window, keyed
--      'scan-<window end UTC>' and expiring at the window end. Windows are
--      counted back from subscriptions.current_period_end; an early
--      renewal adds exactly 30 days, so window boundaries never move.
--      The calendar-month batch stays at the free allowance, which keeps
--      reconciliation's "active subscription has a plan batch" check and
--      the free baseline unchanged.
--    - One-time conversion: a month batch that an earlier scan-pay grant
--      had topped up to the paid allowance is capped back to the free
--      allowance when the first window batch is created, and the paid
--      credits already spent from it are carried into the window batch,
--      so nobody is granted the same paid credits twice.
--
-- 2. get_credit_allowance_snapshot reports the live scan window batch
--    (periodKey 'scan-…') when one exists, otherwise the month batch.
--    Output keys are unchanged.
--
-- 3. revoke_paid_plan_credits takes back the unspent paid plan credits
--    when a plan is refunded: live window batches drop to what was
--    already used, the month batch drops to the free allowance.
--
-- Every reduction of `granted` writes a matching negative ledger row
-- (action 'expire'), so reconciliation (059: SUM(remaining) = SUM(delta))
-- stays balanced and the spend summary shows it as expired credits, not
-- as user spend.
-- ============================================================

CREATE OR REPLACE FUNCTION public.ensure_cycle_plan_credits(
  p_user_id uuid,
  p_plan_credits integer,
  p_free_credits integer,
  p_month_key text,
  p_month_expires_at timestamptz
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c_window      constant bigint := 2592000; -- 30 days, matches PLAN_MONTH_MS
  v_now         timestamptz := statement_timestamp();
  v_scan_end    timestamptz;
  v_card_active boolean;
  v_k           bigint;
  v_window_end  timestamptz;
  v_key         text;
  v_month_id    uuid;
  v_month_granted integer;
  v_month_used  integer;
  v_month_cap   integer;
  v_carry       integer := 0;
  v_scan_id     uuid;
  v_scan_granted integer;
BEGIN
  IF p_plan_credits <= 0 OR p_free_credits < 0 THEN
    RETURN NULL;
  END IF;

  SELECT MAX(current_period_end) INTO v_scan_end
  FROM public.subscriptions
  WHERE user_id = p_user_id
    AND payment_provider IN ('zcwpay', 'alipay_qrcode')
    AND status = 'active'
    AND current_period_end > v_now;

  SELECT EXISTS (
    SELECT 1 FROM public.subscriptions
    WHERE user_id = p_user_id
      AND payment_provider = 'creem'
      AND (
        status IN ('active', 'trialing', 'past_due')
        OR (status = 'scheduled_cancel' AND current_period_end > v_now)
      )
  ) INTO v_card_active;

  -- Card subscribers, free users and lapsed scan-pay plans: calendar month.
  IF v_scan_end IS NULL OR v_card_active OR p_plan_credits <= p_free_credits THEN
    PERFORM public.grant_plan_credits(p_user_id, p_plan_credits, p_month_key, p_month_expires_at);
    RETURN p_month_key;
  END IF;

  -- The 30-day window that contains now, aligned to the paid-through date.
  v_k := floor(extract(epoch FROM (v_scan_end - v_now)) / c_window)::bigint;
  v_window_end := v_scan_end - make_interval(secs => v_k * c_window);
  v_key := 'scan-' || to_char(v_window_end AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');

  -- Free baseline for the calendar month (no-op when it already exists).
  PERFORM public.grant_plan_credits(p_user_id, p_free_credits, p_month_key, p_month_expires_at);

  -- Lock the month batch: serializes concurrent window grants for this user.
  SELECT id, granted, used INTO v_month_id, v_month_granted, v_month_used
  FROM public.credit_balances
  WHERE user_id = p_user_id AND source = 'plan' AND period_key = p_month_key
  FOR UPDATE;

  SELECT id, granted INTO v_scan_id, v_scan_granted
  FROM public.credit_balances
  WHERE user_id = p_user_id AND source = 'plan' AND period_key = v_key
  FOR UPDATE;

  IF v_scan_id IS NULL THEN
    -- One-time conversion of a month batch topped up by an earlier scan-pay grant.
    IF v_month_id IS NOT NULL AND v_month_granted > p_free_credits THEN
      v_month_cap := GREATEST(v_month_used, p_free_credits);
      v_carry := LEAST(GREATEST(v_month_used - p_free_credits, 0), p_plan_credits);
      UPDATE public.credit_balances SET granted = v_month_cap WHERE id = v_month_id;
      INSERT INTO public.credit_transactions (user_id, delta, action, source, balance_id, detail)
      VALUES (
        p_user_id, v_month_cap - v_month_granted, 'expire', 'system', v_month_id,
        jsonb_build_object('reason', 'scan_pay_cycle_conversion', 'periodKey', v_key)
      );
    END IF;

    INSERT INTO public.credit_balances (user_id, source, period_key, granted, used, expires_at)
    VALUES (p_user_id, 'plan', v_key, p_plan_credits, v_carry, v_window_end)
    ON CONFLICT (user_id, period_key) WHERE source = 'plan' DO NOTHING
    RETURNING id INTO v_scan_id;

    IF v_scan_id IS NOT NULL THEN
      INSERT INTO public.credit_transactions (user_id, delta, action, source, balance_id, detail)
      VALUES (
        p_user_id, p_plan_credits - v_carry, 'grant', 'system', v_scan_id,
        CASE WHEN v_carry > 0
          THEN jsonb_build_object('carriedUsed', v_carry)
          ELSE NULL
        END
      );
    END IF;
  ELSIF p_plan_credits > v_scan_granted THEN
    -- Same-window upgrade: top up by the difference (mirrors 105).
    UPDATE public.credit_balances SET granted = p_plan_credits WHERE id = v_scan_id;
    INSERT INTO public.credit_transactions (user_id, delta, action, source, balance_id)
    VALUES (p_user_id, p_plan_credits - v_scan_granted, 'grant', 'system', v_scan_id);
  END IF;

  RETURN v_key;
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_cycle_plan_credits(
  uuid, integer, integer, text, timestamptz
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_cycle_plan_credits(
  uuid, integer, integer, text, timestamptz
) TO service_role;

-- Same contract as 060; the live scan window batch wins over the month batch.
CREATE OR REPLACE FUNCTION public.get_credit_allowance_snapshot(
  p_user_id uuid
) RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH context AS (
    SELECT
      statement_timestamp() AS as_of,
      to_char(timezone('UTC', statement_timestamp()), 'YYYY-MM') AS period_key
  ),
  scan AS (
    SELECT balance.period_key, balance.used::bigint AS used
    FROM public.credit_balances AS balance
    CROSS JOIN context
    WHERE balance.user_id = p_user_id
      AND balance.source = 'plan'
      AND balance.period_key LIKE 'scan-%'
      AND balance.expires_at > context.as_of
    ORDER BY balance.expires_at ASC
    LIMIT 1
  ),
  snapshot AS (
    SELECT
      context.period_key,
      COUNT(balance.id) FILTER (
        WHERE balance.source = 'plan'
          AND balance.period_key = context.period_key
      ) AS plan_batch_count,
      COALESCE(
        MAX(balance.used) FILTER (
          WHERE balance.source = 'plan'
            AND balance.period_key = context.period_key
        ),
        0
      )::bigint AS used,
      COALESCE(
        SUM(balance.remaining) FILTER (
          WHERE balance.remaining > 0
            AND (
              balance.expires_at IS NULL
              OR balance.expires_at > context.as_of
            )
        ),
        0
      )::bigint AS available
    FROM context
    LEFT JOIN public.credit_balances AS balance
      ON balance.user_id = p_user_id
    GROUP BY context.period_key, context.as_of
  )
  SELECT CASE
    WHEN EXISTS (SELECT 1 FROM scan) THEN jsonb_build_object(
      'periodKey', (SELECT scan.period_key FROM scan),
      'used', (SELECT scan.used FROM scan),
      'available', snapshot.available
    )
    WHEN snapshot.plan_batch_count = 1 THEN jsonb_build_object(
      'periodKey', snapshot.period_key,
      'used', snapshot.used,
      'available', snapshot.available
    )
    ELSE NULL
  END
  FROM snapshot;
$$;

REVOKE ALL ON FUNCTION public.get_credit_allowance_snapshot(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_credit_allowance_snapshot(uuid)
  TO service_role;

-- Refunded plan: drop live paid plan credits to what was already used.
-- Returns { revoked, consumedPaid } for the refund notification.
CREATE OR REPLACE FUNCTION public.revoke_paid_plan_credits(
  p_user_id uuid,
  p_free_credits integer,
  p_detail jsonb DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now      timestamptz := statement_timestamp();
  v_row      record;
  v_keep     integer;
  v_revoked  integer := 0;
  v_consumed integer := 0;
BEGIN
  FOR v_row IN
    SELECT id, period_key, granted, used
    FROM public.credit_balances
    WHERE user_id = p_user_id
      AND source = 'plan'
      AND (expires_at IS NULL OR expires_at > v_now)
    ORDER BY id
    FOR UPDATE
  LOOP
    IF v_row.period_key LIKE 'scan-%' THEN
      v_keep := v_row.used;
      v_consumed := v_consumed + v_row.used;
    ELSE
      v_keep := GREATEST(v_row.used, LEAST(v_row.granted, p_free_credits));
      v_consumed := v_consumed + GREATEST(v_row.used - p_free_credits, 0);
    END IF;

    IF v_keep < v_row.granted THEN
      UPDATE public.credit_balances SET granted = v_keep WHERE id = v_row.id;
      INSERT INTO public.credit_transactions (user_id, delta, action, source, balance_id, detail)
      VALUES (
        p_user_id, v_keep - v_row.granted, 'expire', 'refund', v_row.id,
        COALESCE(p_detail, '{}'::jsonb) || jsonb_build_object('reason', 'plan_refund')
      );
      v_revoked := v_revoked + (v_row.granted - v_keep);
    END IF;
  END LOOP;

  RETURN jsonb_build_object('revoked', v_revoked, 'consumedPaid', v_consumed);
END;
$$;

REVOKE ALL ON FUNCTION public.revoke_paid_plan_credits(uuid, integer, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_paid_plan_credits(uuid, integer, jsonb)
  TO service_role;
