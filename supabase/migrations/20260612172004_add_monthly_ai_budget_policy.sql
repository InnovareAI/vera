ALTER TABLE public.projects
  ALTER COLUMN ai_policy SET DEFAULT jsonb_build_object(
    'images_enabled', true,
    'standard_video_enabled', false,
    'premium_media_enabled', false,
    'monthly_budget_usd', null
  );

UPDATE public.projects
SET ai_policy = jsonb_set(
  COALESCE(ai_policy, '{}'::jsonb),
  '{monthly_budget_usd}',
  'null'::jsonb,
  true
)
WHERE ai_policy IS NULL
   OR NOT (ai_policy ? 'monthly_budget_usd');
