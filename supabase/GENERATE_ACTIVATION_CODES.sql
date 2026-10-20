-- ============================================================
-- Generate a batch of single-use activation codes.
-- Run migration 021_activation_codes.sql first.
--
-- Edit the four variables below, then run in Supabase SQL Editor.
-- Re-running with the same batch_label just appends more codes.
-- ============================================================

DO $$
DECLARE
  v_count        integer     := 100;         -- how many codes to make
  v_plan         text        := 'starter';   -- 'starter' | 'pro' | 'growth' | 'employee'
  v_duration     integer     := 30;          -- trial length in days
  v_batch        text        := 'launch-2026-07';  -- label to group/track this batch
  v_prefix       text        := 'FINFOLD';   -- human-readable code prefix
  v_expires      timestamptz := now() + interval '90 days';  -- deadline to redeem (or NULL)
  v_code         text;
  i              integer;
BEGIN
  FOR i IN 1..v_count LOOP
    -- 8-char random suffix from a no-ambiguous-chars alphabet (no 0/O/1/I).
    SELECT v_prefix || '-' || string_agg(
             substr('ABCDEFGHJKMNPQRSTUVWXYZ23456789',
                    (floor(random() * 31) + 1)::int, 1),
             ''
           )
      INTO v_code
    FROM generate_series(1, 8);

    INSERT INTO public.activation_codes (code, plan, duration_days, expires_at, batch_label)
    VALUES (v_code, v_plan, v_duration, v_expires, v_batch)
    ON CONFLICT (code) DO NOTHING;  -- skip the astronomically-rare collision
  END LOOP;
END $$;

-- Export the batch you just created (copy this column to hand out):
SELECT code, plan, duration_days, expires_at
FROM public.activation_codes
WHERE batch_label = 'launch-2026-07'   -- <-- match v_batch above
ORDER BY created_at DESC;

-- Handy: redemption stats for a batch.
-- SELECT batch_label,
--        count(*)                                   AS total,
--        count(redeemed_by)                         AS redeemed,
--        count(*) - count(redeemed_by)              AS remaining
-- FROM public.activation_codes
-- GROUP BY batch_label;
