-- Scope Brain audiences to client spaces.
--
-- Legacy rows without project_id remain workspace-level defaults. New client
-- Brain rows should always carry project_id so one client cannot influence
-- another client's generation context.

ALTER TABLE public.audiences
  ADD COLUMN IF NOT EXISTS project_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'audiences_project_id_fkey'
      AND conrelid = 'public.audiences'::regclass
  ) THEN
    ALTER TABLE public.audiences
      ADD CONSTRAINT audiences_project_id_fkey
      FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_audiences_project_kind
  ON public.audiences(project_id, kind)
  WHERE project_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_audiences_project_primary
  ON public.audiences(project_id, is_primary)
  WHERE project_id IS NOT NULL AND is_primary = true;

COMMENT ON COLUMN public.audiences.project_id IS
  'Client-space scope. Null rows are legacy workspace-level defaults and must not be used as active client Brain audiences.';

CREATE OR REPLACE FUNCTION private.validate_audience_project_scope()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  v_project_org_id uuid;
BEGIN
  IF NEW.project_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT p.org_id
    INTO v_project_org_id
  FROM public.projects p
  WHERE p.id = NEW.project_id;

  IF v_project_org_id IS NULL THEN
    RAISE EXCEPTION 'Audience project % does not exist', NEW.project_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF NEW.org_id IS DISTINCT FROM v_project_org_id THEN
    RAISE EXCEPTION 'Audience project % does not belong to org %', NEW.project_id, NEW.org_id
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_audience_project_scope ON public.audiences;
CREATE TRIGGER validate_audience_project_scope
  BEFORE INSERT OR UPDATE OF org_id, project_id ON public.audiences
  FOR EACH ROW
  EXECUTE FUNCTION private.validate_audience_project_scope();

ALTER TABLE public.audiences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audiences FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS audiences_member_all ON public.audiences;
CREATE POLICY audiences_member_all ON public.audiences
  FOR ALL
  TO authenticated
  USING (
    (project_id IS NULL AND private.is_org_member(org_id))
    OR (project_id IS NOT NULL AND private.can_project_read(project_id))
  )
  WITH CHECK (
    (project_id IS NULL AND private.is_org_member(org_id))
    OR (
      project_id IS NOT NULL
      AND private.can_project_write(project_id)
      AND org_id = private.project_org_id(project_id)
    )
  );

REVOKE ALL ON public.audiences FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.audiences TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.audiences TO service_role;
