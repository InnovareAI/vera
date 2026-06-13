-- Scope connected CMS/blog publishers to Vera client spaces.
--
-- `publishers` predated client spaces and only carried org_id. In Vera, the
-- client boundary is projects, so project-scoped content must only publish
-- through publishers explicitly connected to the same project.

ALTER TABLE public.publishers
  ADD COLUMN IF NOT EXISTS project_id uuid;

DO $$
BEGIN
  IF to_regclass('public.projects') IS NULL THEN
    RAISE EXCEPTION 'public.projects is required before publisher project scoping can be installed';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'publishers_project_id_fkey'
      AND conrelid = 'public.publishers'::regclass
  ) THEN
    ALTER TABLE public.publishers
      ADD CONSTRAINT publishers_project_id_fkey
      FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS publishers_project_idx
  ON public.publishers(project_id);

ALTER TABLE public.publishers
  DROP CONSTRAINT IF EXISTS publishers_org_id_kind_name_key;

CREATE UNIQUE INDEX IF NOT EXISTS publishers_org_project_kind_name_key
  ON public.publishers (
    org_id,
    COALESCE(project_id, '00000000-0000-0000-0000-000000000000'::uuid),
    kind,
    name
  );

COMMENT ON COLUMN public.publishers.project_id IS
  'Client-space scope for this publishing target. Null is legacy workspace scope only and cannot publish project-scoped posts.';

CREATE OR REPLACE FUNCTION private.validate_publisher_project_org()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  linked_org_id uuid;
BEGIN
  IF NEW.project_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT p.org_id INTO linked_org_id
  FROM public.projects p
  WHERE p.id = NEW.project_id;

  IF linked_org_id IS NULL THEN
    RAISE EXCEPTION 'Publisher project % does not exist', NEW.project_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF NEW.org_id IS DISTINCT FROM linked_org_id THEN
    RAISE EXCEPTION 'Publisher project % does not belong to org %', NEW.project_id, NEW.org_id
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS publishers_project_org_guard ON public.publishers;
CREATE TRIGGER publishers_project_org_guard
  BEFORE INSERT OR UPDATE OF org_id, project_id ON public.publishers
  FOR EACH ROW EXECUTE FUNCTION private.validate_publisher_project_org();

REVOKE ALL ON FUNCTION private.validate_publisher_project_org() FROM PUBLIC, anon, authenticated;

DROP POLICY IF EXISTS publishers_member_all ON public.publishers;
CREATE POLICY publishers_member_all ON public.publishers
  FOR ALL TO authenticated
  USING (
    private.is_org_member(org_id)
    OR (project_id IS NOT NULL AND private.can_project_read(project_id))
  )
  WITH CHECK (
    private.is_org_member(org_id)
    OR (project_id IS NOT NULL AND private.can_project_manage(project_id))
  );
