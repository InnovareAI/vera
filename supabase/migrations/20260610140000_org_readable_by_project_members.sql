-- Let client collaborators resolve their workspace.
--
-- A user invited to a single client space gets a project_members row but no
-- org_members row. organizations_member_select only let org members read the
-- org row, so a project-only member saw their workspace as a nameless
-- "Workspace" and any org-dependent read (real name, branding, plan, is_master)
-- came back empty.
--
-- Content was never the problem: content_posts / projects RLS already pass
-- project members via can_project_read. This only lets a member read the org
-- row of an org they actually belong to through a project, so the workspace
-- resolves with its real identity.

CREATE OR REPLACE FUNCTION private.is_org_project_member(p_org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.project_members pm
    JOIN public.projects p ON p.id = pm.project_id
    WHERE p.org_id = p_org_id
      AND pm.user_id = auth.uid()
  )
$$;

DROP POLICY IF EXISTS organizations_member_select ON public.organizations;
CREATE POLICY organizations_member_select ON public.organizations
  FOR SELECT TO authenticated
  USING (
    private.is_org_member(id)
    OR private.is_org_project_member(id)
  );
