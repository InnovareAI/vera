-- Durable weekly learning review state.
--
-- agent_observations is already live in production and used by VERA, but the
-- create-table migration was missing from the repo. Keep this migration
-- idempotent so production is not disturbed while clean rebuilds get the table.

CREATE TABLE IF NOT EXISTS public.agent_observations (
  id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  project_id uuid REFERENCES public.projects(id) ON DELETE CASCADE,
  kind text NOT NULL,
  severity text NOT NULL DEFAULT 'medium',
  title text NOT NULL,
  detail text,
  proposed_action text,
  action_kind text,
  action_payload jsonb,
  dedup_key text,
  status text NOT NULL DEFAULT 'open',
  surface_until timestamptz,
  actioned_at timestamptz,
  dismissed_at timestamptz,
  acted_result jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.agent_observations
  ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES public.projects(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS kind text,
  ADD COLUMN IF NOT EXISTS severity text NOT NULL DEFAULT 'medium',
  ADD COLUMN IF NOT EXISTS title text,
  ADD COLUMN IF NOT EXISTS detail text,
  ADD COLUMN IF NOT EXISTS proposed_action text,
  ADD COLUMN IF NOT EXISTS action_kind text,
  ADD COLUMN IF NOT EXISTS action_payload jsonb,
  ADD COLUMN IF NOT EXISTS dedup_key text,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'open',
  ADD COLUMN IF NOT EXISTS surface_until timestamptz,
  ADD COLUMN IF NOT EXISTS actioned_at timestamptz,
  ADD COLUMN IF NOT EXISTS dismissed_at timestamptz,
  ADD COLUMN IF NOT EXISTS acted_result jsonb,
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS agent_observations_open_idx
  ON public.agent_observations(org_id, project_id, created_at DESC)
  WHERE status = 'open';

CREATE UNIQUE INDEX IF NOT EXISTS agent_observations_open_dedup_key_idx
  ON public.agent_observations(dedup_key)
  WHERE status = 'open' AND dedup_key IS NOT NULL;

ALTER TABLE public.agent_observations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.agent_observations FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.agent_observations TO authenticated, service_role;

DROP POLICY IF EXISTS agent_observations_member_all ON public.agent_observations;
CREATE POLICY agent_observations_member_all ON public.agent_observations
  FOR ALL TO authenticated
  USING (private.is_org_member(org_id) OR private.is_project_member(project_id))
  WITH CHECK (private.is_org_member(org_id) OR private.is_project_member(project_id));

CREATE TABLE IF NOT EXISTS public.sam_handoff_actions (
  id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  observation_id uuid REFERENCES public.agent_observations(id) ON DELETE SET NULL,
  post_id uuid REFERENCES public.content_posts(id) ON DELETE SET NULL,
  title text NOT NULL,
  channel text,
  score numeric NOT NULL DEFAULT 0,
  triggers text[] NOT NULL DEFAULT '{}'::text[],
  status text NOT NULL DEFAULT 'queued',
  priority text NOT NULL DEFAULT 'medium',
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  actioned_at timestamptz,
  CONSTRAINT sam_handoff_actions_status_check
    CHECK (status IN ('queued', 'in_progress', 'done', 'dismissed')),
  CONSTRAINT sam_handoff_actions_priority_check
    CHECK (priority IN ('low', 'medium', 'high'))
);

CREATE INDEX IF NOT EXISTS sam_handoff_actions_org_project_idx
  ON public.sam_handoff_actions(org_id, project_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS sam_handoff_actions_observation_idx
  ON public.sam_handoff_actions(observation_id);

CREATE INDEX IF NOT EXISTS sam_handoff_actions_post_idx
  ON public.sam_handoff_actions(post_id);

CREATE UNIQUE INDEX IF NOT EXISTS sam_handoff_actions_observation_post_key
  ON public.sam_handoff_actions(observation_id, post_id)
  WHERE observation_id IS NOT NULL AND post_id IS NOT NULL;

DROP TRIGGER IF EXISTS sam_handoff_actions_updated_at ON public.sam_handoff_actions;
CREATE TRIGGER sam_handoff_actions_updated_at
  BEFORE UPDATE ON public.sam_handoff_actions
  FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();

ALTER TABLE public.sam_handoff_actions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sam_handoff_actions FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sam_handoff_actions TO authenticated, service_role;

DROP POLICY IF EXISTS sam_handoff_actions_member_select ON public.sam_handoff_actions;
CREATE POLICY sam_handoff_actions_member_select ON public.sam_handoff_actions
  FOR SELECT TO authenticated
  USING (private.is_org_member(org_id) OR private.is_project_member(project_id));

DROP POLICY IF EXISTS sam_handoff_actions_member_insert ON public.sam_handoff_actions;
CREATE POLICY sam_handoff_actions_member_insert ON public.sam_handoff_actions
  FOR INSERT TO authenticated
  WITH CHECK (private.is_org_member(org_id) OR private.is_project_member(project_id));

DROP POLICY IF EXISTS sam_handoff_actions_member_update ON public.sam_handoff_actions;
CREATE POLICY sam_handoff_actions_member_update ON public.sam_handoff_actions
  FOR UPDATE TO authenticated
  USING (private.is_org_member(org_id) OR private.is_project_member(project_id))
  WITH CHECK (private.is_org_member(org_id) OR private.is_project_member(project_id));

DROP POLICY IF EXISTS sam_handoff_actions_member_delete ON public.sam_handoff_actions;
CREATE POLICY sam_handoff_actions_member_delete ON public.sam_handoff_actions
  FOR DELETE TO authenticated
  USING (private.is_org_member(org_id) OR private.is_project_member(project_id));
