-- Add an explicit per-project gate for InnovareAI platform media keys.
--
-- Client projects should normally use their own provider keys. Env allowlists
-- and operator entitlements are not enough by themselves, because client
-- projects can live inside the InnovareAI master org. This flag keeps platform
-- FAL/OpenRouter/OpenAI media spend locked unless the exact project opts in.

UPDATE public.projects p
SET ai_policy = jsonb_set(
  COALESCE(p.ai_policy, '{}'::jsonb),
  '{platform_media_keys_enabled}',
  CASE
    WHEN o.is_master IS TRUE AND p.slug = 'innovareai-brand' THEN 'true'::jsonb
    ELSE 'false'::jsonb
  END,
  true
)
FROM public.organizations o
WHERE o.id = p.org_id
  AND (
    p.ai_policy IS NULL
    OR NOT (p.ai_policy ? 'platform_media_keys_enabled')
  );

ALTER TABLE public.projects
  ALTER COLUMN ai_policy SET DEFAULT jsonb_build_object(
    'images_enabled', true,
    'standard_video_enabled', false,
    'premium_media_enabled', false,
    'platform_media_keys_enabled', false,
    'monthly_budget_usd', null,
    'default_text_model', null,
    'default_image_model', 'nano-banana',
    'default_video_model', 'hailuo',
    'default_image_video_model', 'hailuo-i2v'
  );
