-- Cost-control invariant for client AI usage policies.
--
-- UI and Edge Functions already enforce this, but projects.ai_policy is JSON
-- and can be edited outside the settings screen. Keep the database state safe:
-- paid video or premium media cannot be enabled unless the client has a
-- positive monthly budget cap.

CREATE SCHEMA IF NOT EXISTS private;

CREATE OR REPLACE FUNCTION private.ai_policy_boolean(p_policy jsonb, p_key text, p_fallback boolean DEFAULT false)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN jsonb_typeof(p_policy -> p_key) = 'boolean' THEN (p_policy ->> p_key)::boolean
    ELSE p_fallback
  END
$$;

CREATE OR REPLACE FUNCTION private.ai_policy_positive_number(p_policy jsonb, p_key text)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN jsonb_typeof(p_policy -> p_key) = 'number' THEN (p_policy ->> p_key)::numeric
    ELSE 0
  END
$$;

UPDATE public.projects
SET ai_policy = jsonb_set(
  jsonb_set(
    COALESCE(ai_policy, '{}'::jsonb),
    '{standard_video_enabled}',
    'false'::jsonb,
    true
  ),
  '{premium_media_enabled}',
  'false'::jsonb,
  true
)
WHERE (
    private.ai_policy_boolean(COALESCE(ai_policy, '{}'::jsonb), 'standard_video_enabled')
    OR private.ai_policy_boolean(COALESCE(ai_policy, '{}'::jsonb), 'premium_media_enabled')
  )
  AND private.ai_policy_positive_number(COALESCE(ai_policy, '{}'::jsonb), 'monthly_budget_usd') <= 0;

ALTER TABLE public.projects
  DROP CONSTRAINT IF EXISTS projects_ai_policy_paid_media_budget_guard;

ALTER TABLE public.projects
  ADD CONSTRAINT projects_ai_policy_paid_media_budget_guard
  CHECK (
    (
      NOT private.ai_policy_boolean(COALESCE(ai_policy, '{}'::jsonb), 'standard_video_enabled')
      AND NOT private.ai_policy_boolean(COALESCE(ai_policy, '{}'::jsonb), 'premium_media_enabled')
    )
    OR private.ai_policy_positive_number(COALESCE(ai_policy, '{}'::jsonb), 'monthly_budget_usd') > 0
  );
