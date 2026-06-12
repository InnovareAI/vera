-- Operator-scoped AI entitlements.
--
-- Client spaces should normally use their own provider keys. This table is the
-- explicit escape hatch for trusted InnovareAI operators who are allowed to use
-- platform media credits on behalf of a client during internal production work.

CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

CREATE TABLE IF NOT EXISTS public.ai_user_entitlements (
  id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  org_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  project_id uuid REFERENCES public.projects(id) ON DELETE CASCADE,
  capability text NOT NULL CHECK (capability IN (
    'platform_fal_video',
    'platform_premium_video',
    'platform_fal_image'
  )),
  enabled boolean NOT NULL DEFAULT true,
  note text,
  granted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS ai_user_entitlements_scope_key
  ON public.ai_user_entitlements (
    user_id,
    capability,
    COALESCE(org_id, '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(project_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

CREATE INDEX IF NOT EXISTS ai_user_entitlements_user_idx
  ON public.ai_user_entitlements(user_id)
  WHERE enabled = true;

CREATE INDEX IF NOT EXISTS ai_user_entitlements_project_idx
  ON public.ai_user_entitlements(project_id)
  WHERE enabled = true AND project_id IS NOT NULL;

DROP TRIGGER IF EXISTS ai_user_entitlements_updated_at ON public.ai_user_entitlements;
CREATE TRIGGER ai_user_entitlements_updated_at
  BEFORE UPDATE ON public.ai_user_entitlements
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE public.ai_user_entitlements ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.ai_user_entitlements FROM anon, authenticated;
GRANT SELECT ON public.ai_user_entitlements TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_user_entitlements TO service_role;

DROP POLICY IF EXISTS ai_user_entitlements_select ON public.ai_user_entitlements;
CREATE POLICY ai_user_entitlements_select ON public.ai_user_entitlements
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR (org_id IS NOT NULL AND private.is_org_admin(org_id))
    OR (project_id IS NOT NULL AND private.can_project_manage(project_id))
  );

CREATE TABLE IF NOT EXISTS public.video_jobs (
  id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  request_id text NOT NULL,
  slug text NOT NULL,
  project_id uuid REFERENCES public.projects(id) ON DELETE CASCADE,
  post_id uuid REFERENCES public.content_posts(id) ON DELETE SET NULL,
  message_id uuid,
  session_id uuid,
  prompt text,
  status text NOT NULL DEFAULT 'rendering',
  video_url text,
  error text,
  key_source text NOT NULL DEFAULT 'client' CHECK (key_source IN ('client', 'platform')),
  operator_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS video_jobs_request_id_key
  ON public.video_jobs(request_id);

CREATE INDEX IF NOT EXISTS video_jobs_project_idx
  ON public.video_jobs(project_id)
  WHERE project_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS video_jobs_post_idx
  ON public.video_jobs(post_id)
  WHERE post_id IS NOT NULL;

ALTER TABLE public.video_jobs
  ADD COLUMN IF NOT EXISTS key_source text NOT NULL DEFAULT 'client'
    CHECK (key_source IN ('client', 'platform')),
  ADD COLUMN IF NOT EXISTS operator_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS video_jobs_operator_user_idx
  ON public.video_jobs(operator_user_id)
  WHERE operator_user_id IS NOT NULL;

DROP TRIGGER IF EXISTS video_jobs_updated_at ON public.video_jobs;
CREATE TRIGGER video_jobs_updated_at
  BEFORE UPDATE ON public.video_jobs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE public.video_jobs ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.video_jobs TO authenticated, service_role;

DO $$
BEGIN
  IF to_regprocedure('private._replace_project_table_policy(text,text,text)') IS NOT NULL THEN
    PERFORM private._replace_project_table_policy(
      'video_jobs',
      'private.can_project_read(project_id) OR private.is_post_member(post_id)',
      'private.can_project_write(project_id) OR private.is_post_member(post_id)'
    );
  END IF;
END $$;

INSERT INTO public.ai_user_entitlements (user_id, capability, note, granted_by)
SELECT u.id, 'platform_fal_video', 'Initial InnovareAI operator access for standard platform video rendering.', u.id
FROM auth.users u
WHERE lower(u.email) IN ('tl@innovareai.com', 'tl@innvoareai.com')
ON CONFLICT DO NOTHING;
