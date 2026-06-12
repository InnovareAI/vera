ALTER TABLE public.generation_log
  ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS provider text,
  ADD COLUMN IF NOT EXISTS operation text,
  ADD COLUMN IF NOT EXISTS usage_metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS generation_log_project_id_idx ON public.generation_log(project_id);
CREATE INDEX IF NOT EXISTS generation_log_provider_idx ON public.generation_log(provider);
CREATE INDEX IF NOT EXISTS generation_log_operation_idx ON public.generation_log(operation);
CREATE INDEX IF NOT EXISTS generation_log_created_at_idx ON public.generation_log(created_at DESC);

ALTER TABLE public.generation_log ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.generation_log FROM anon, authenticated;
GRANT SELECT ON public.generation_log TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.generation_log TO service_role;

DROP POLICY IF EXISTS generation_log_member_all ON public.generation_log;
DROP POLICY IF EXISTS generation_log_member_select ON public.generation_log;

CREATE POLICY generation_log_member_select
  ON public.generation_log
  FOR SELECT
  TO authenticated
  USING (
    (org_id IS NOT NULL AND private.is_org_member(org_id))
    OR (project_id IS NOT NULL AND private.is_project_member(project_id))
  );
