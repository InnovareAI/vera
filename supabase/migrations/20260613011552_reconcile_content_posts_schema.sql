-- Reconcile production content schema with migration replay.
--
-- Several content fields were added directly while VERA moved from the early
-- Kai schema to the modern client-space model. A fresh migration replay needs
-- the same table shape that the current app, Edge Functions, and generated
-- database types expect.

CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

CREATE TABLE IF NOT EXISTS public.audiences (
  id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  kind text NOT NULL,
  name text NOT NULL,
  is_primary boolean NOT NULL DEFAULT false,
  pain_points jsonb NOT NULL DEFAULT '[]'::jsonb,
  goals jsonb NOT NULL DEFAULT '[]'::jsonb,
  attributes jsonb NOT NULL DEFAULT '{}'::jsonb,
  parent_id uuid,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT audiences_kind_check CHECK (
    kind IN ('icp', 'buyer_persona', 'consumer_persona', 'audience')
  ),
  CONSTRAINT audiences_parent_id_fkey
    FOREIGN KEY (parent_id) REFERENCES public.audiences(id) ON DELETE SET NULL
);

ALTER TABLE public.audiences
  ADD COLUMN IF NOT EXISTS org_id uuid,
  ADD COLUMN IF NOT EXISTS kind text,
  ADD COLUMN IF NOT EXISTS name text,
  ADD COLUMN IF NOT EXISTS is_primary boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS pain_points jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS goals jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS attributes jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS parent_id uuid,
  ADD COLUMN IF NOT EXISTS notes text,
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE public.audiences
  ALTER COLUMN org_id SET NOT NULL,
  ALTER COLUMN kind SET NOT NULL,
  ALTER COLUMN name SET NOT NULL,
  ALTER COLUMN is_primary SET NOT NULL,
  ALTER COLUMN pain_points SET NOT NULL,
  ALTER COLUMN goals SET NOT NULL,
  ALTER COLUMN attributes SET NOT NULL,
  ALTER COLUMN created_at SET NOT NULL,
  ALTER COLUMN updated_at SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'audiences_org_id_fkey'
      AND conrelid = 'public.audiences'::regclass
  ) THEN
    ALTER TABLE public.audiences
      ADD CONSTRAINT audiences_org_id_fkey
      FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'audiences_parent_id_fkey'
      AND conrelid = 'public.audiences'::regclass
  ) THEN
    ALTER TABLE public.audiences
      ADD CONSTRAINT audiences_parent_id_fkey
      FOREIGN KEY (parent_id) REFERENCES public.audiences(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'audiences_kind_check'
      AND conrelid = 'public.audiences'::regclass
  ) THEN
    ALTER TABLE public.audiences
      ADD CONSTRAINT audiences_kind_check
      CHECK (kind IN ('icp', 'buyer_persona', 'consumer_persona', 'audience'));
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_audiences_org_kind
  ON public.audiences(org_id, kind);

CREATE INDEX IF NOT EXISTS idx_audiences_org_primary
  ON public.audiences(org_id, is_primary)
  WHERE is_primary = true;

CREATE INDEX IF NOT EXISTS idx_audiences_parent
  ON public.audiences(parent_id)
  WHERE parent_id IS NOT NULL;

DROP TRIGGER IF EXISTS audiences_updated_at ON public.audiences;
CREATE TRIGGER audiences_updated_at
  BEFORE UPDATE ON public.audiences
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE public.audiences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS audiences_member_all ON public.audiences;
CREATE POLICY audiences_member_all ON public.audiences
  FOR ALL
  USING (private.is_org_member(org_id))
  WITH CHECK (private.is_org_member(org_id));

ALTER TABLE public.content_posts
  ADD COLUMN IF NOT EXISTS media_metadata jsonb DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS profile_name text DEFAULT 'Thorsten Linz',
  ADD COLUMN IF NOT EXISTS profile_title text DEFAULT 'CEO & Co-Founder @ InnovareAI',
  ADD COLUMN IF NOT EXISTS author text,
  ADD COLUMN IF NOT EXISTS publish_date date,
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS reviewed_by text,
  ADD COLUMN IF NOT EXISTS compliance_checks jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS asana_task_gid text,
  ADD COLUMN IF NOT EXISTS airtable_record_id text,
  ADD COLUMN IF NOT EXISTS posted_at timestamptz,
  ADD COLUMN IF NOT EXISTS posted_url text,
  ADD COLUMN IF NOT EXISTS audience_id uuid,
  ADD COLUMN IF NOT EXISTS category text;

ALTER TABLE public.content_posts
  ALTER COLUMN copy DROP DEFAULT;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'content_posts_org_id_fkey'
      AND conrelid = 'public.content_posts'::regclass
  ) THEN
    ALTER TABLE public.content_posts
      DROP CONSTRAINT content_posts_org_id_fkey;
  END IF;

  ALTER TABLE public.content_posts
    ADD CONSTRAINT content_posts_org_id_fkey
    FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE SET NULL;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'content_posts_audience_id_fkey'
      AND conrelid = 'public.content_posts'::regclass
  ) THEN
    ALTER TABLE public.content_posts
      ADD CONSTRAINT content_posts_audience_id_fkey
      FOREIGN KEY (audience_id) REFERENCES public.audiences(id) ON DELETE SET NULL;
  END IF;
END
$$;

UPDATE public.content_posts
SET status = CASE
  WHEN lower(status) IN ('approved') THEN 'approved'
  WHEN lower(status) IN ('rejected') THEN 'rejected'
  WHEN lower(status) IN ('changes_requested', 'change_requested') THEN 'changes_requested'
  WHEN lower(status) IN ('scheduled', 'posted', 'published') THEN 'approved'
  ELSE 'pending'
END
WHERE status NOT IN ('pending', 'approved', 'rejected', 'changes_requested');

ALTER TABLE public.content_posts
  DROP CONSTRAINT IF EXISTS content_posts_status_check;

ALTER TABLE public.content_posts
  ADD CONSTRAINT content_posts_status_check
  CHECK (status IN ('pending', 'approved', 'rejected', 'changes_requested'));

CREATE INDEX IF NOT EXISTS idx_content_posts_org
  ON public.content_posts(org_id);

CREATE INDEX IF NOT EXISTS idx_content_posts_project
  ON public.content_posts(project_id);

CREATE INDEX IF NOT EXISTS idx_content_posts_campaign
  ON public.content_posts(campaign_id);

CREATE INDEX IF NOT EXISTS idx_content_posts_status
  ON public.content_posts(status);

CREATE INDEX IF NOT EXISTS idx_content_posts_audience
  ON public.content_posts(audience_id);

CREATE INDEX IF NOT EXISTS idx_content_posts_posted
  ON public.content_posts(org_id, posted_at DESC)
  WHERE posted_at IS NOT NULL;
