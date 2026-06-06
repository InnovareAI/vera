-- Client management dashboard: project-scoped client access, pending invites,
-- and client-scoped API key metadata. Secret values are written only through
-- the client-secrets Edge Function, which encrypts before storing ciphertext.

CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE SCHEMA IF NOT EXISTS private;
GRANT USAGE ON SCHEMA private TO authenticated, service_role;

CREATE TABLE IF NOT EXISTS public.project_members (
  id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'viewer' CHECK (role IN ('owner','editor','reviewer','viewer')),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, user_id)
);

CREATE INDEX IF NOT EXISTS project_members_org_idx ON public.project_members(org_id);
CREATE INDEX IF NOT EXISTS project_members_project_idx ON public.project_members(project_id);
CREATE INDEX IF NOT EXISTS project_members_user_idx ON public.project_members(user_id);

CREATE TABLE IF NOT EXISTS public.project_invites (
  id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  email text NOT NULL,
  role text NOT NULL DEFAULT 'viewer' CHECK (role IN ('owner','editor','reviewer','viewer')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','revoked','expired')),
  invite_token text NOT NULL DEFAULT encode(extensions.gen_random_bytes(24), 'hex'),
  created_by uuid,
  accepted_by uuid,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '14 days'),
  sent_at timestamptz,
  send_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS project_invites_org_idx ON public.project_invites(org_id);
CREATE INDEX IF NOT EXISTS project_invites_project_idx ON public.project_invites(project_id);
CREATE INDEX IF NOT EXISTS project_invites_email_idx ON public.project_invites(lower(email));
CREATE UNIQUE INDEX IF NOT EXISTS project_invites_pending_email_key
  ON public.project_invites(project_id, lower(email))
  WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS public.client_api_keys (
  id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  provider text NOT NULL,
  label text NOT NULL,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  models jsonb NOT NULL DEFAULT '[]'::jsonb,
  capabilities jsonb NOT NULL DEFAULT '{}'::jsonb,
  secret_preview text,
  secret_ciphertext text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','invalid','revoked')),
  created_by uuid,
  updated_by uuid,
  last_used_at timestamptz,
  last_tested_at timestamptz,
  test_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, provider, label)
);

CREATE INDEX IF NOT EXISTS client_api_keys_org_idx ON public.client_api_keys(org_id);
CREATE INDEX IF NOT EXISTS client_api_keys_project_idx ON public.client_api_keys(project_id);

CREATE OR REPLACE FUNCTION private.role_rank(p_role text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_role
    WHEN 'owner' THEN 40
    WHEN 'admin' THEN 40
    WHEN 'agency_admin' THEN 40
    WHEN 'member' THEN 30
    WHEN 'editor' THEN 30
    WHEN 'reviewer' THEN 20
    WHEN 'viewer' THEN 10
    ELSE 0
  END
$$;

CREATE OR REPLACE FUNCTION private.org_role(p_org_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  found_role text;
BEGIN
  IF p_org_id IS NULL OR auth.uid() IS NULL OR to_regclass('public.org_members') IS NULL THEN
    RETURN NULL;
  END IF;

  EXECUTE 'SELECT role FROM public.org_members WHERE org_id = $1 AND user_id = $2 LIMIT 1'
  INTO found_role
  USING p_org_id, auth.uid();

  RETURN found_role;
END;
$$;

CREATE OR REPLACE FUNCTION private.is_org_member(p_org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT private.org_role(p_org_id) IS NOT NULL
$$;

CREATE OR REPLACE FUNCTION private.is_org_admin(p_org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT private.org_role(p_org_id) IN ('owner','admin','agency_admin')
$$;

CREATE OR REPLACE FUNCTION private.project_role(p_project_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  found_role text;
BEGIN
  IF p_project_id IS NULL OR auth.uid() IS NULL OR to_regclass('public.project_members') IS NULL THEN
    RETURN NULL;
  END IF;

  EXECUTE 'SELECT role FROM public.project_members WHERE project_id = $1 AND user_id = $2 LIMIT 1'
  INTO found_role
  USING p_project_id, auth.uid();

  RETURN found_role;
END;
$$;

CREATE OR REPLACE FUNCTION private.project_org_id(p_project_id uuid)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  found_org uuid;
BEGIN
  IF p_project_id IS NULL OR to_regclass('public.projects') IS NULL THEN
    RETURN NULL;
  END IF;

  EXECUTE 'SELECT org_id FROM public.projects WHERE id = $1 LIMIT 1'
  INTO found_org
  USING p_project_id;

  RETURN found_org;
END;
$$;

CREATE OR REPLACE FUNCTION private.can_project_read(p_project_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT COALESCE(
    private.is_org_member(private.project_org_id(p_project_id))
    OR private.project_role(p_project_id) IS NOT NULL,
    false
  )
$$;

CREATE OR REPLACE FUNCTION private.can_project_write(p_project_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT COALESCE(
    private.org_role(private.project_org_id(p_project_id)) IN ('owner','admin','agency_admin','member')
    OR private.project_role(p_project_id) IN ('owner','editor'),
    false
  )
$$;

CREATE OR REPLACE FUNCTION private.can_project_review(p_project_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT COALESCE(
    private.org_role(private.project_org_id(p_project_id)) IN ('owner','admin','agency_admin','member')
    OR private.project_role(p_project_id) IN ('owner','editor','reviewer'),
    false
  )
$$;

CREATE OR REPLACE FUNCTION private.can_project_manage(p_project_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT COALESCE(
    private.is_org_admin(private.project_org_id(p_project_id))
    OR private.project_role(p_project_id) = 'owner',
    false
  )
$$;

CREATE OR REPLACE FUNCTION private.is_project_member(p_project_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT private.can_project_read(p_project_id)
$$;

CREATE OR REPLACE FUNCTION private.is_post_member(p_post_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  allowed boolean := false;
BEGIN
  IF p_post_id IS NULL OR auth.uid() IS NULL OR to_regclass('public.content_posts') IS NULL THEN
    RETURN false;
  END IF;

  EXECUTE 'SELECT COALESCE(private.can_project_read(project_id), private.is_org_member(org_id), false)
    FROM public.content_posts
    WHERE id = $1
    LIMIT 1'
  INTO allowed
  USING p_post_id;

  RETURN COALESCE(allowed, false);
END;
$$;

CREATE OR REPLACE FUNCTION private.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS project_members_updated_at ON public.project_members;
CREATE TRIGGER project_members_updated_at
  BEFORE UPDATE ON public.project_members
  FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();

DROP TRIGGER IF EXISTS project_invites_updated_at ON public.project_invites;
CREATE TRIGGER project_invites_updated_at
  BEFORE UPDATE ON public.project_invites
  FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();

DROP TRIGGER IF EXISTS client_api_keys_updated_at ON public.client_api_keys;
CREATE TRIGGER client_api_keys_updated_at
  BEFORE UPDATE ON public.client_api_keys
  FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();

ALTER TABLE public.project_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_api_keys ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_members TO authenticated, service_role;
REVOKE ALL ON public.project_invites FROM anon, authenticated;
GRANT SELECT (id, org_id, project_id, email, role, status, expires_at, sent_at, send_error, created_by, accepted_by, created_at, updated_at) ON public.project_invites TO authenticated;
GRANT UPDATE (status) ON public.project_invites TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_invites TO service_role;
REVOKE ALL ON public.client_api_keys FROM anon, authenticated;
GRANT SELECT (id, org_id, project_id, provider, label, config, models, capabilities, secret_preview, status, last_used_at, last_tested_at, test_error, created_at, updated_at) ON public.client_api_keys TO authenticated;
GRANT UPDATE (status) ON public.client_api_keys TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_api_keys TO service_role;

DROP POLICY IF EXISTS project_members_select ON public.project_members;
DROP POLICY IF EXISTS project_members_insert ON public.project_members;
DROP POLICY IF EXISTS project_members_update ON public.project_members;
DROP POLICY IF EXISTS project_members_delete ON public.project_members;

CREATE POLICY project_members_select ON public.project_members
  FOR SELECT TO authenticated
  USING (private.can_project_read(project_id));

CREATE POLICY project_members_insert ON public.project_members
  FOR INSERT TO authenticated
  WITH CHECK (private.can_project_manage(project_id) AND org_id = private.project_org_id(project_id));

CREATE POLICY project_members_update ON public.project_members
  FOR UPDATE TO authenticated
  USING (private.can_project_manage(project_id))
  WITH CHECK (private.can_project_manage(project_id) AND org_id = private.project_org_id(project_id));

CREATE POLICY project_members_delete ON public.project_members
  FOR DELETE TO authenticated
  USING (private.can_project_manage(project_id));

DROP POLICY IF EXISTS project_invites_select ON public.project_invites;
DROP POLICY IF EXISTS project_invites_insert ON public.project_invites;
DROP POLICY IF EXISTS project_invites_update ON public.project_invites;
DROP POLICY IF EXISTS project_invites_delete ON public.project_invites;

CREATE POLICY project_invites_select ON public.project_invites
  FOR SELECT TO authenticated
  USING (private.can_project_manage(project_id));

CREATE POLICY project_invites_insert ON public.project_invites
  FOR INSERT TO authenticated
  WITH CHECK (private.can_project_manage(project_id) AND org_id = private.project_org_id(project_id));

CREATE POLICY project_invites_update ON public.project_invites
  FOR UPDATE TO authenticated
  USING (private.can_project_manage(project_id))
  WITH CHECK (private.can_project_manage(project_id) AND org_id = private.project_org_id(project_id));

CREATE POLICY project_invites_delete ON public.project_invites
  FOR DELETE TO authenticated
  USING (private.can_project_manage(project_id));

DROP POLICY IF EXISTS client_api_keys_select ON public.client_api_keys;
DROP POLICY IF EXISTS client_api_keys_insert ON public.client_api_keys;
DROP POLICY IF EXISTS client_api_keys_update ON public.client_api_keys;
DROP POLICY IF EXISTS client_api_keys_delete ON public.client_api_keys;

CREATE POLICY client_api_keys_select ON public.client_api_keys
  FOR SELECT TO authenticated
  USING (private.can_project_manage(project_id));

CREATE POLICY client_api_keys_update ON public.client_api_keys
  FOR UPDATE TO authenticated
  USING (private.can_project_manage(project_id))
  WITH CHECK (private.can_project_manage(project_id) AND org_id = private.project_org_id(project_id));

DROP POLICY IF EXISTS projects_member_all ON public.projects;
DROP POLICY IF EXISTS projects_select ON public.projects;
DROP POLICY IF EXISTS projects_insert ON public.projects;
DROP POLICY IF EXISTS projects_update ON public.projects;
DROP POLICY IF EXISTS projects_delete ON public.projects;

CREATE POLICY projects_select ON public.projects
  FOR SELECT TO authenticated
  USING (private.is_org_member(org_id) OR private.project_role(id) IS NOT NULL);

CREATE POLICY projects_insert ON public.projects
  FOR INSERT TO authenticated
  WITH CHECK (private.is_org_member(org_id));

CREATE POLICY projects_update ON public.projects
  FOR UPDATE TO authenticated
  USING (private.can_project_manage(id))
  WITH CHECK (private.can_project_manage(id));

CREATE POLICY projects_delete ON public.projects
  FOR DELETE TO authenticated
  USING (private.can_project_manage(id));

CREATE OR REPLACE FUNCTION private._replace_project_table_policy(
  p_table text,
  p_read_expr text,
  p_write_expr text
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  table_name regclass := to_regclass(format('public.%I', p_table));
BEGIN
  IF table_name IS NULL THEN
    RETURN;
  END IF;

  EXECUTE format('DROP POLICY IF EXISTS %I ON %s', p_table || '_member_all', table_name);
  EXECUTE format('DROP POLICY IF EXISTS %I ON %s', p_table || '_select', table_name);
  EXECUTE format('DROP POLICY IF EXISTS %I ON %s', p_table || '_insert', table_name);
  EXECUTE format('DROP POLICY IF EXISTS %I ON %s', p_table || '_update', table_name);
  EXECUTE format('DROP POLICY IF EXISTS %I ON %s', p_table || '_delete', table_name);

  EXECUTE format('CREATE POLICY %I ON %s FOR SELECT TO authenticated USING (%s)', p_table || '_select', table_name, p_read_expr);
  EXECUTE format('CREATE POLICY %I ON %s FOR INSERT TO authenticated WITH CHECK (%s)', p_table || '_insert', table_name, p_write_expr);
  EXECUTE format('CREATE POLICY %I ON %s FOR UPDATE TO authenticated USING (%s) WITH CHECK (%s)', p_table || '_update', table_name, p_write_expr, p_write_expr);
  EXECUTE format('CREATE POLICY %I ON %s FOR DELETE TO authenticated USING (%s)', p_table || '_delete', table_name, p_write_expr);
END;
$$;

SELECT private._replace_project_table_policy('brand_voice', 'private.is_org_member(org_id) OR private.can_project_read(project_id)', 'private.is_org_member(org_id) OR private.can_project_write(project_id)');
SELECT private._replace_project_table_policy('campaigns', 'private.is_org_member(org_id) OR private.can_project_read(project_id)', 'private.is_org_member(org_id) OR private.can_project_write(project_id)');
SELECT private._replace_project_table_policy('chat_messages', 'private.is_org_member(org_id) OR private.can_project_read(project_id)', 'private.is_org_member(org_id) OR private.can_project_write(project_id)');
SELECT private._replace_project_table_policy('content_categories', 'private.is_org_member(org_id) OR private.can_project_read(project_id)', 'private.is_org_member(org_id) OR private.can_project_write(project_id)');
SELECT private._replace_project_table_policy('content_posts', 'private.is_org_member(org_id) OR private.can_project_read(project_id)', 'private.is_org_member(org_id) OR private.can_project_review(project_id)');
SELECT private._replace_project_table_policy('linkedin_audits', 'private.is_org_member(org_id) OR private.can_project_read(project_id)', 'private.is_org_member(org_id) OR private.can_project_write(project_id)');
SELECT private._replace_project_table_policy('media_jobs', 'private.can_project_read(project_id) OR private.is_post_member(post_id)', 'private.can_project_write(project_id) OR private.is_post_member(post_id)');
SELECT private._replace_project_table_policy('project_assets', 'private.can_project_read(project_id)', 'private.can_project_write(project_id)');
SELECT private._replace_project_table_policy('project_knowledge', 'private.can_project_read(project_id)', 'private.can_project_write(project_id)');
SELECT private._replace_project_table_policy('video_jobs', 'private.can_project_read(project_id) OR private.is_post_member(post_id)', 'private.can_project_write(project_id) OR private.is_post_member(post_id)');

DROP FUNCTION private._replace_project_table_policy(text, text, text);
