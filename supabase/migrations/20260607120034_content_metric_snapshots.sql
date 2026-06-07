-- Normalized performance snapshots for Measure.
--
-- Post records keep the provider identifiers Vera needs after publishing.
-- The snapshot table stores time-series metrics from LinkedIn, Meta, Google,
-- YouTube, and future channels without changing the UI contract every time a
-- provider exposes a new metric.

ALTER TABLE public.content_posts
  ADD COLUMN IF NOT EXISTS provider text,
  ADD COLUMN IF NOT EXISTS provider_account_id text,
  ADD COLUMN IF NOT EXISTS provider_post_id text,
  ADD COLUMN IF NOT EXISTS provider_page_id text,
  ADD COLUMN IF NOT EXISTS provider_media_id text,
  ADD COLUMN IF NOT EXISTS provider_permalink text,
  ADD COLUMN IF NOT EXISTS last_metric_sync_at timestamptz;

CREATE INDEX IF NOT EXISTS content_posts_provider_idx
  ON public.content_posts(provider);

CREATE INDEX IF NOT EXISTS content_posts_provider_post_idx
  ON public.content_posts(provider, provider_post_id)
  WHERE provider_post_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS content_posts_metric_sync_idx
  ON public.content_posts(project_id, last_metric_sync_at);

CREATE TABLE IF NOT EXISTS public.content_metric_snapshots (
  id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  post_id uuid REFERENCES public.content_posts(id) ON DELETE CASCADE,
  provider text NOT NULL,
  provider_account_id text,
  provider_object_id text,
  object_type text NOT NULL DEFAULT 'post',
  metric_name text NOT NULL,
  metric_value numeric NOT NULL DEFAULT 0,
  metric_period text NOT NULL DEFAULT 'lifetime',
  metric_time timestamptz,
  pulled_at timestamptz NOT NULL DEFAULT now(),
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS content_metric_snapshots_org_idx
  ON public.content_metric_snapshots(org_id);

CREATE INDEX IF NOT EXISTS content_metric_snapshots_project_idx
  ON public.content_metric_snapshots(project_id, pulled_at DESC);

CREATE INDEX IF NOT EXISTS content_metric_snapshots_post_idx
  ON public.content_metric_snapshots(post_id, pulled_at DESC)
  WHERE post_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS content_metric_snapshots_provider_idx
  ON public.content_metric_snapshots(provider, metric_name, pulled_at DESC);

CREATE INDEX IF NOT EXISTS content_metric_snapshots_object_idx
  ON public.content_metric_snapshots(provider, provider_object_id, metric_name, pulled_at DESC)
  WHERE provider_object_id IS NOT NULL;

ALTER TABLE public.content_metric_snapshots ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.content_metric_snapshots FROM anon, authenticated;
GRANT SELECT ON public.content_metric_snapshots TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.content_metric_snapshots TO service_role;

DROP POLICY IF EXISTS content_metric_snapshots_select ON public.content_metric_snapshots;
CREATE POLICY content_metric_snapshots_select ON public.content_metric_snapshots
  FOR SELECT TO authenticated
  USING (private.can_project_read(project_id));
