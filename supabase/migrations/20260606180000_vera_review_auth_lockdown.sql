-- Vera production review-link and RLS lockdown.
-- Applied live on 2026-06-06, then recorded here so the production backend
-- state is reproducible during migration or restore work.

CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE SCHEMA IF NOT EXISTS private;
GRANT USAGE ON SCHEMA private TO authenticated, service_role;

CREATE OR REPLACE FUNCTION private.is_org_member(p_org_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  allowed boolean := false;
BEGIN
  IF p_org_id IS NULL OR auth.uid() IS NULL OR to_regclass('public.org_members') IS NULL THEN
    RETURN false;
  END IF;

  EXECUTE 'SELECT EXISTS (
    SELECT 1 FROM public.org_members
    WHERE org_id = $1 AND user_id = $2
  )'
  INTO allowed
  USING p_org_id, auth.uid();

  RETURN COALESCE(allowed, false);
END;
$$;

CREATE OR REPLACE FUNCTION private.is_project_member(p_project_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  allowed boolean := false;
BEGIN
  IF p_project_id IS NULL
    OR auth.uid() IS NULL
    OR to_regclass('public.projects') IS NULL
    OR to_regclass('public.org_members') IS NULL THEN
    RETURN false;
  END IF;

  EXECUTE 'SELECT EXISTS (
    SELECT 1
    FROM public.projects p
    JOIN public.org_members m ON m.org_id = p.org_id
    WHERE p.id = $1 AND m.user_id = $2
  )'
  INTO allowed
  USING p_project_id, auth.uid();

  RETURN COALESCE(allowed, false);
END;
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
  IF p_post_id IS NULL
    OR auth.uid() IS NULL
    OR to_regclass('public.content_posts') IS NULL
    OR to_regclass('public.projects') IS NULL
    OR to_regclass('public.org_members') IS NULL THEN
    RETURN false;
  END IF;

  EXECUTE 'SELECT EXISTS (
    SELECT 1
    FROM public.content_posts cp
    LEFT JOIN public.projects p ON p.id = cp.project_id
    JOIN public.org_members m ON m.org_id = COALESCE(cp.org_id, p.org_id)
    WHERE cp.id = $1 AND m.user_id = $2
  )'
  INTO allowed
  USING p_post_id, auth.uid();

  RETURN COALESCE(allowed, false);
END;
$$;

CREATE OR REPLACE FUNCTION private.is_competitor_member(p_competitor_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  allowed boolean := false;
BEGIN
  IF p_competitor_id IS NULL
    OR auth.uid() IS NULL
    OR to_regclass('public.competitors') IS NULL
    OR to_regclass('public.org_members') IS NULL THEN
    RETURN false;
  END IF;

  EXECUTE 'SELECT EXISTS (
    SELECT 1
    FROM public.competitors c
    JOIN public.org_members m ON m.org_id = c.org_id
    WHERE c.id = $1 AND m.user_id = $2
  )'
  INTO allowed
  USING p_competitor_id, auth.uid();

  RETURN COALESCE(allowed, false);
END;
$$;

CREATE OR REPLACE FUNCTION private.is_skill_member(p_skill_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  allowed boolean := false;
BEGIN
  IF p_skill_id IS NULL OR auth.uid() IS NULL OR to_regclass('public.skills') IS NULL THEN
    RETURN false;
  END IF;

  EXECUTE 'SELECT EXISTS (
    SELECT 1
    FROM public.skills s
    WHERE s.id = $1 AND (s.org_id IS NULL OR private.is_org_member(s.org_id))
  )'
  INTO allowed
  USING p_skill_id;

  RETURN COALESCE(allowed, false);
END;
$$;

CREATE OR REPLACE FUNCTION private.add_org_owner_membership()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND to_regclass('public.org_members') IS NOT NULL THEN
    EXECUTE 'INSERT INTO public.org_members (org_id, user_id, role)
      VALUES ($1, $2, $3)
      ON CONFLICT (org_id, user_id) DO NOTHING'
    USING NEW.id, auth.uid(), 'owner';
  END IF;

  RETURN NEW;
END;
$$;

ALTER TABLE IF EXISTS public.content_posts
  ADD COLUMN IF NOT EXISTS review_token text,
  ADD COLUMN IF NOT EXISTS review_token_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS review_token_revoked_at timestamptz;

ALTER TABLE IF EXISTS public.content_posts
  ALTER COLUMN review_token SET DEFAULT encode(extensions.gen_random_bytes(24), 'hex');

DO $$
BEGIN
  IF to_regclass('public.content_posts') IS NOT NULL THEN
    UPDATE public.content_posts
    SET review_token = encode(extensions.gen_random_bytes(24), 'hex')
    WHERE review_token IS NULL;

    CREATE UNIQUE INDEX IF NOT EXISTS content_posts_review_token_key
      ON public.content_posts (review_token)
      WHERE review_token IS NOT NULL;
  END IF;
END;
$$;

DO $$
DECLARE
  p record;
  r record;
BEGIN
  FOR p IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', p.policyname, p.schemaname, p.tablename);
  END LOOP;

  FOR r IN
    SELECT n.nspname, c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
  LOOP
    EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY', r.nspname, r.relname);
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION private._apply_all_policy_if_table_exists(
  p_table text,
  p_policy text,
  p_expr text
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

  EXECUTE format('DROP POLICY IF EXISTS %I ON %s', p_policy, table_name);
  BEGIN
    EXECUTE format(
      'CREATE POLICY %I ON %s FOR ALL TO authenticated USING (%s) WITH CHECK (%s)',
      p_policy,
      table_name,
      p_expr,
      p_expr
    );
  EXCEPTION
    WHEN undefined_column THEN
      RETURN;
  END;
END;
$$;

CREATE OR REPLACE FUNCTION private._apply_organization_policies_if_table_exists()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF to_regclass('public.organizations') IS NULL THEN
    RETURN;
  END IF;

  DROP POLICY IF EXISTS organizations_member_select ON public.organizations;
  DROP POLICY IF EXISTS organizations_member_insert ON public.organizations;
  DROP POLICY IF EXISTS organizations_member_update ON public.organizations;
  DROP POLICY IF EXISTS organizations_member_delete ON public.organizations;

  CREATE POLICY organizations_member_select ON public.organizations
    FOR SELECT TO authenticated
    USING (private.is_org_member(id));

  CREATE POLICY organizations_member_insert ON public.organizations
    FOR INSERT TO authenticated
    WITH CHECK (auth.uid() IS NOT NULL);

  CREATE POLICY organizations_member_update ON public.organizations
    FOR UPDATE TO authenticated
    USING (private.is_org_member(id))
    WITH CHECK (private.is_org_member(id));

  CREATE POLICY organizations_member_delete ON public.organizations
    FOR DELETE TO authenticated
    USING (private.is_org_member(id));

  DROP TRIGGER IF EXISTS organizations_add_owner_membership ON public.organizations;
  CREATE TRIGGER organizations_add_owner_membership
    AFTER INSERT ON public.organizations
    FOR EACH ROW
    EXECUTE FUNCTION private.add_org_owner_membership();
END;
$$;

CREATE OR REPLACE FUNCTION private._apply_skill_policies_if_table_exists()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF to_regclass('public.skills') IS NULL THEN
    RETURN;
  END IF;

  DROP POLICY IF EXISTS skills_member_select ON public.skills;
  DROP POLICY IF EXISTS skills_member_insert ON public.skills;
  DROP POLICY IF EXISTS skills_member_update ON public.skills;
  DROP POLICY IF EXISTS skills_member_delete ON public.skills;

  CREATE POLICY skills_member_select ON public.skills
    FOR SELECT TO authenticated
    USING (org_id IS NULL OR private.is_org_member(org_id));

  CREATE POLICY skills_member_insert ON public.skills
    FOR INSERT TO authenticated
    WITH CHECK (org_id IS NOT NULL AND private.is_org_member(org_id));

  CREATE POLICY skills_member_update ON public.skills
    FOR UPDATE TO authenticated
    USING (org_id IS NOT NULL AND private.is_org_member(org_id))
    WITH CHECK (org_id IS NOT NULL AND private.is_org_member(org_id));

  CREATE POLICY skills_member_delete ON public.skills
    FOR DELETE TO authenticated
    USING (org_id IS NOT NULL AND private.is_org_member(org_id));
END;
$$;

SELECT private._apply_organization_policies_if_table_exists();
SELECT private._apply_all_policy_if_table_exists('agent_observations', 'agent_observations_member_all', 'private.is_org_member(org_id)');
SELECT private._apply_all_policy_if_table_exists('audiences', 'audiences_member_all', 'private.is_org_member(org_id)');
SELECT private._apply_all_policy_if_table_exists('audit_runs', 'audit_runs_member_all', 'private.is_org_member(org_id)');
SELECT private._apply_all_policy_if_table_exists('brand_voice', 'brand_voice_member_all', 'private.is_org_member(org_id) OR private.is_project_member(project_id)');
SELECT private._apply_all_policy_if_table_exists('campaigns', 'campaigns_member_all', 'private.is_org_member(org_id) OR private.is_project_member(project_id)');
SELECT private._apply_all_policy_if_table_exists('channel_profiles', 'channel_profiles_member_all', 'private.is_org_member(org_id)');
SELECT private._apply_all_policy_if_table_exists('chat_messages', 'chat_messages_member_all', 'private.is_org_member(org_id) OR private.is_project_member(project_id)');
SELECT private._apply_all_policy_if_table_exists('competitor_events', 'competitor_events_member_all', 'private.is_org_member(org_id) OR private.is_competitor_member(competitor_id)');
SELECT private._apply_all_policy_if_table_exists('competitor_snapshots', 'competitor_snapshots_member_all', 'private.is_competitor_member(competitor_id)');
SELECT private._apply_all_policy_if_table_exists('competitors', 'competitors_member_all', 'private.is_org_member(org_id)');
SELECT private._apply_all_policy_if_table_exists('content_briefs', 'content_briefs_member_all', 'private.is_org_member(org_id)');
SELECT private._apply_all_policy_if_table_exists('content_categories', 'content_categories_member_all', 'private.is_org_member(org_id) OR private.is_project_member(project_id)');
SELECT private._apply_all_policy_if_table_exists('content_posts', 'content_posts_member_all', 'private.is_org_member(org_id) OR private.is_project_member(project_id)');
SELECT private._apply_all_policy_if_table_exists('generation_log', 'generation_log_member_all', 'org_id IS NULL OR private.is_org_member(org_id)');
SELECT private._apply_all_policy_if_table_exists('kb_article_revisions', 'kb_article_revisions_member_all', 'private.is_org_member(org_id)');
SELECT private._apply_all_policy_if_table_exists('kb_articles', 'kb_articles_member_all', 'private.is_org_member(org_id)');
SELECT private._apply_all_policy_if_table_exists('kb_change_log', 'kb_change_log_member_all', 'private.is_org_member(org_id)');
SELECT private._apply_all_policy_if_table_exists('kb_raw', 'kb_raw_member_all', 'private.is_org_member(org_id)');
SELECT private._apply_all_policy_if_table_exists('linkedin_audits', 'linkedin_audits_member_all', 'private.is_org_member(org_id) OR private.is_project_member(project_id)');
SELECT private._apply_all_policy_if_table_exists('media_jobs', 'media_jobs_member_all', 'private.is_project_member(project_id) OR private.is_post_member(post_id)');
SELECT private._apply_all_policy_if_table_exists('onboarding_sessions', 'onboarding_sessions_member_all', 'private.is_org_member(org_id)');
SELECT private._apply_all_policy_if_table_exists('org_members', 'org_members_member_all', 'private.is_org_member(org_id)');
SELECT private._apply_all_policy_if_table_exists('personas', 'personas_member_all', 'private.is_org_member(org_id)');
SELECT private._apply_all_policy_if_table_exists('platform_configs', 'platform_configs_member_all', 'private.is_org_member(org_id)');
SELECT private._apply_all_policy_if_table_exists('post_outcomes', 'post_outcomes_member_all', 'private.is_post_member(post_id)');
SELECT private._apply_all_policy_if_table_exists('project_assets', 'project_assets_member_all', 'private.is_project_member(project_id)');
SELECT private._apply_all_policy_if_table_exists('project_knowledge', 'project_knowledge_member_all', 'private.is_project_member(project_id)');
SELECT private._apply_all_policy_if_table_exists('projects', 'projects_member_all', 'private.is_org_member(org_id)');
SELECT private._apply_all_policy_if_table_exists('publish_attempts', 'publish_attempts_member_all', 'private.is_org_member(org_id) OR private.is_post_member(post_id)');
SELECT private._apply_all_policy_if_table_exists('publish_locks', 'publish_locks_member_all', 'private.is_post_member(post_id)');
SELECT private._apply_all_policy_if_table_exists('publishers', 'publishers_member_all', 'private.is_org_member(org_id)');
SELECT private._apply_all_policy_if_table_exists('seo_audits', 'seo_audits_member_all', 'private.is_org_member(org_id)');
SELECT private._apply_all_policy_if_table_exists('skill_invocations', 'skill_invocations_member_all', 'private.is_org_member(org_id) OR private.is_post_member(post_id) OR private.is_skill_member(skill_id)');
SELECT private._apply_all_policy_if_table_exists('skill_revisions', 'skill_revisions_member_all', 'private.is_skill_member(skill_id)');
SELECT private._apply_skill_policies_if_table_exists();
SELECT private._apply_all_policy_if_table_exists('users', 'users_member_all', 'private.is_org_member(org_id)');
SELECT private._apply_all_policy_if_table_exists('vera_memories', 'vera_memories_member_all', 'private.is_org_member(org_id)');
SELECT private._apply_all_policy_if_table_exists('video_jobs', 'video_jobs_member_all', 'private.is_project_member(project_id) OR private.is_post_member(post_id)');

DROP FUNCTION private._apply_all_policy_if_table_exists(text, text, text);
DROP FUNCTION private._apply_organization_policies_if_table_exists();
DROP FUNCTION private._apply_skill_policies_if_table_exists();
