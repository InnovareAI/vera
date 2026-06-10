-- Reddit market-listening pulls for the Measure surface (READ-ONLY).
--
-- VERA never posts to Reddit. This table stores market intelligence only: each
-- row is one synthesis of what buyers are saying on Reddit about a topic,
-- pulled via the Perplexity Sonar API (scoped to reddit.com) by the
-- reddit-listen edge function. `sources` holds the cited Reddit threads so the
-- operator can deep-read the originals.

CREATE TABLE IF NOT EXISTS public.reddit_listens (
  id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  topic text NOT NULL,
  synthesis text NOT NULL DEFAULT '',
  sources jsonb NOT NULL DEFAULT '[]'::jsonb,
  model text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS reddit_listens_org_idx
  ON public.reddit_listens(org_id);

CREATE INDEX IF NOT EXISTS reddit_listens_project_idx
  ON public.reddit_listens(project_id, created_at DESC);

ALTER TABLE public.reddit_listens ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.reddit_listens FROM anon, authenticated;
GRANT SELECT ON public.reddit_listens TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.reddit_listens TO service_role;

DROP POLICY IF EXISTS reddit_listens_select ON public.reddit_listens;
CREATE POLICY reddit_listens_select ON public.reddit_listens
  FOR SELECT TO authenticated
  USING (private.can_project_read(project_id));
