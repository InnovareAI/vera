ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS ai_policy jsonb NOT NULL DEFAULT jsonb_build_object(
    'images_enabled', true,
    'standard_video_enabled', false,
    'premium_media_enabled', false
  );

UPDATE public.projects
SET ai_policy = jsonb_build_object(
  'images_enabled', COALESCE((ai_policy->>'images_enabled')::boolean, true),
  'standard_video_enabled', COALESCE((ai_policy->>'standard_video_enabled')::boolean, false),
  'premium_media_enabled', COALESCE((ai_policy->>'premium_media_enabled')::boolean, false)
)
WHERE ai_policy IS NULL
   OR NOT (ai_policy ? 'images_enabled')
   OR NOT (ai_policy ? 'standard_video_enabled')
   OR NOT (ai_policy ? 'premium_media_enabled');

GRANT SELECT (ai_policy) ON public.projects TO authenticated;
GRANT UPDATE (ai_policy) ON public.projects TO authenticated;
