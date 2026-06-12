-- Modern VERA foundation tables.
--
-- The first Kai migrations used the British `organisations` table. Current
-- VERA code, generated types, and later migrations use `organizations`,
-- `org_members`, and `projects`. This bridge keeps old data intact while making
-- a clean migration replay produce the modern schema before access policies,
-- client spaces, integrations, and AI policy migrations run.

CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

CREATE TABLE IF NOT EXISTS public.organizations (
  id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  plan text NOT NULL DEFAULT 'starter',
  logo_url text,
  website text,
  industry text,
  timezone text NOT NULL DEFAULT 'UTC',
  locale text NOT NULL DEFAULT 'en',
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  business_model text NOT NULL DEFAULT 'unspecified',
  email_domain text,
  is_master boolean NOT NULL DEFAULT false,
  unipile_account_id text,
  unipile_connected_at timestamptz,
  unipile_health_status text,
  unipile_last_health_check timestamptz,
  gsc_property_url text,
  gsc_refresh_token text,
  gsc_connected_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF to_regclass('public.organisations') IS NOT NULL THEN
    EXECUTE $copy$
      INSERT INTO public.organizations (
        id, name, slug, plan, logo_url, website, industry, timezone, locale,
        settings, created_at, updated_at
      )
      SELECT
        id, name, slug, plan, logo_url, website, industry, timezone, locale,
        settings, created_at, updated_at
      FROM public.organisations
      ON CONFLICT (id) DO NOTHING
    $copy$;
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS public.org_members (
  id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'member' CHECK (
    role IN ('owner','admin','agency_admin','member','editor','reviewer','viewer')
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, user_id)
);

DO $$
BEGIN
  IF to_regclass('public.users') IS NOT NULL THEN
    EXECUTE $copy$
      INSERT INTO public.org_members (org_id, user_id, role, created_at)
      SELECT
        u.org_id,
        u.id,
        CASE
          WHEN u.role IN ('owner','admin','member','viewer') THEN u.role
          ELSE 'member'
        END,
        u.created_at
      FROM public.users u
      JOIN public.organizations o ON o.id = u.org_id
      ON CONFLICT (org_id, user_id) DO NOTHING
    $copy$;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS org_members_org_idx ON public.org_members(org_id);
CREATE INDEX IF NOT EXISTS org_members_user_idx ON public.org_members(user_id);

CREATE TABLE IF NOT EXISTS public.projects (
  id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  slug text NOT NULL,
  description text,
  instructions text,
  is_default boolean NOT NULL DEFAULT false,
  is_archived boolean NOT NULL DEFAULT false,
  is_starred boolean NOT NULL DEFAULT false,
  ai_policy jsonb NOT NULL DEFAULT '{
    "images_enabled": true,
    "standard_video_enabled": false,
    "premium_media_enabled": false,
    "monthly_budget_usd": null,
    "default_text_model": null,
    "default_image_model": "nano-banana",
    "default_video_model": "hailuo",
    "default_image_video_model": "hailuo-i2v"
  }'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, slug)
);

CREATE INDEX IF NOT EXISTS projects_org_idx ON public.projects(org_id);

INSERT INTO public.projects (org_id, name, slug, is_default)
SELECT o.id, o.name, o.slug || '-brand', true
FROM public.organizations o
WHERE NOT EXISTS (
  SELECT 1 FROM public.projects p WHERE p.org_id = o.id
)
ON CONFLICT (org_id, slug) DO NOTHING;

ALTER TABLE IF EXISTS public.content_posts
  ADD COLUMN IF NOT EXISTS project_id uuid;

DO $$
BEGIN
  IF to_regclass('public.content_posts') IS NOT NULL THEN
    UPDATE public.content_posts cp
    SET project_id = p.id
    FROM public.projects p
    WHERE cp.project_id IS NULL
      AND cp.org_id = p.org_id
      AND p.is_default = true;

    IF NOT EXISTS (
      SELECT 1
      FROM pg_constraint
      WHERE conname = 'content_posts_project_id_fkey'
        AND conrelid = 'public.content_posts'::regclass
    ) THEN
      ALTER TABLE public.content_posts
        ADD CONSTRAINT content_posts_project_id_fkey
        FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE SET NULL;
    END IF;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS content_posts_project_id_idx
  ON public.content_posts(project_id);

DO $$
DECLARE
  target_table text;
BEGIN
  FOREACH target_table IN ARRAY ARRAY[
    'users',
    'brand_voice',
    'personas',
    'platform_configs',
    'campaigns',
    'content_briefs',
    'generation_log',
    'content_posts',
    'skills',
    'skill_invocations'
  ]
  LOOP
    IF to_regclass(format('public.%I', target_table)) IS NOT NULL
       AND EXISTS (
       SELECT 1
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = target_table
         AND column_name = 'org_id'
       ) THEN
      EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT IF EXISTS %I', target_table, target_table || '_org_id_fkey');
      EXECUTE format(
        'ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE SET NULL',
        target_table,
        target_table || '_org_id_fkey'
      );
    END IF;
  END LOOP;
END
$$;

DROP TRIGGER IF EXISTS organizations_updated_at ON public.organizations;
CREATE TRIGGER organizations_updated_at
  BEFORE UPDATE ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS projects_updated_at ON public.projects;
CREATE TRIGGER projects_updated_at
  BEFORE UPDATE ON public.projects
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.org_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
