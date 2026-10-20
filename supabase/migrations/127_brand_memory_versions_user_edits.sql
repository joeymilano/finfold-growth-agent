-- ============================================================
-- Migration 127: Brand Memory history records the user's edits only.
--
-- 070's trigger snapshotted every UPDATE of brand_brains, so background
-- writers (style learning, performance rules, examples adopted from
-- published posts, learned visual preferences) produced a version each
-- time and pushed the user's own saves out of the 12-item history list.
--
-- Restoring a version (versions/[id]/restore) already keeps those
-- system-learned fields at their current value, so a snapshot that only
-- differs in them can never restore anything. The trigger now skips an
-- UPDATE when nothing but those fields (and updated_at) changed, and
-- keeps the newest 50 versions per user.
-- ============================================================

CREATE OR REPLACE FUNCTION public.record_brand_memory_version()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c_system_fields constant text[] := ARRAY[
    'updated_at',
    'learned_style',
    'learned_negative',
    'performance_rules',
    'approved_examples'
  ];
BEGIN
  IF TG_OP = 'UPDATE'
     AND (to_jsonb(OLD) - c_system_fields) #- '{visual_identity,learnedPreferences}'
       = (to_jsonb(NEW) - c_system_fields) #- '{visual_identity,learnedPreferences}'
  THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.brand_memory_versions (user_id, snapshot)
  VALUES (NEW.user_id, to_jsonb(NEW));

  DELETE FROM public.brand_memory_versions
  WHERE user_id = NEW.user_id
    AND id IN (
      SELECT id FROM public.brand_memory_versions
      WHERE user_id = NEW.user_id
      ORDER BY created_at DESC, id DESC
      OFFSET 50
    );

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.record_brand_memory_version() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_brand_memory_version() TO service_role;
