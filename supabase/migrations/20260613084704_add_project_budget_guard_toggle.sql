-- Add client-level budget guard controls to projects.ai_policy.
--
-- budget_guard_enabled=false means monthly cap checks are skipped.
-- budget_guard_mode='warn' records and emits budget warnings without blocking.
-- budget_guard_mode='enforce' blocks requests that would exceed the cap.

UPDATE public.projects
SET ai_policy = jsonb_set(
  jsonb_set(
    COALESCE(ai_policy, '{}'::jsonb),
    '{budget_guard_enabled}',
    COALESCE(ai_policy->'budget_guard_enabled', 'true'::jsonb),
    true
  ),
  '{budget_guard_mode}',
  COALESCE(ai_policy->'budget_guard_mode', to_jsonb('warn'::text)),
  true
)
WHERE ai_policy IS NULL
   OR NOT (ai_policy ? 'budget_guard_enabled')
   OR NOT (ai_policy ? 'budget_guard_mode');

ALTER TABLE public.projects
  ALTER COLUMN ai_policy SET DEFAULT jsonb_build_object(
    'images_enabled', true,
    'standard_video_enabled', false,
    'premium_media_enabled', false,
    'platform_media_keys_enabled', false,
    'budget_guard_enabled', true,
    'budget_guard_mode', 'warn',
    'monthly_budget_usd', null,
    'default_text_model', null,
    'default_image_model', 'nano-banana',
    'default_video_model', 'hailuo',
    'default_image_video_model', 'hailuo-i2v'
  );
