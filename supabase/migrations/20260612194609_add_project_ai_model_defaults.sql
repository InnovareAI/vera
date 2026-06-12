ALTER TABLE public.projects
  ALTER COLUMN ai_policy SET DEFAULT jsonb_build_object(
    'images_enabled', true,
    'standard_video_enabled', false,
    'premium_media_enabled', false,
    'monthly_budget_usd', null,
    'default_text_model', null,
    'default_image_model', 'nano-banana',
    'default_video_model', 'hailuo',
    'default_image_video_model', 'hailuo-i2v'
  );

UPDATE public.projects
SET ai_policy =
  jsonb_set(
    jsonb_set(
      jsonb_set(
        jsonb_set(
          COALESCE(ai_policy, '{}'::jsonb),
          '{default_text_model}',
          COALESCE(ai_policy->'default_text_model', 'null'::jsonb),
          true
        ),
        '{default_image_model}',
        COALESCE(ai_policy->'default_image_model', to_jsonb('nano-banana'::text)),
        true
      ),
      '{default_video_model}',
      COALESCE(ai_policy->'default_video_model', to_jsonb('hailuo'::text)),
      true
    ),
    '{default_image_video_model}',
    COALESCE(ai_policy->'default_image_video_model', to_jsonb('hailuo-i2v'::text)),
    true
  )
WHERE ai_policy IS NULL
   OR NOT (ai_policy ? 'default_text_model')
   OR NOT (ai_policy ? 'default_image_model')
   OR NOT (ai_policy ? 'default_video_model')
   OR NOT (ai_policy ? 'default_image_video_model');
