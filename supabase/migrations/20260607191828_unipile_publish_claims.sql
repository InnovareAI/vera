-- Atomic publish claims for direct Unipile publishing.
--
-- This table prevents two concurrent unipile-post invocations from sending the
-- same approved post twice. It is service-only runtime state, not a frontend
-- data surface.

CREATE TABLE IF NOT EXISTS public.content_post_publish_claims (
  post_id uuid PRIMARY KEY REFERENCES public.content_posts(id) ON DELETE CASCADE,
  org_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  project_id uuid REFERENCES public.projects(id) ON DELETE CASCADE,
  channel text NOT NULL,
  claim_status text NOT NULL DEFAULT 'in_progress',
  claimed_by text NOT NULL DEFAULT 'unipile-post',
  locked_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  remote_id text,
  remote_url text,
  last_error text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT content_post_publish_claims_status_check
    CHECK (claim_status IN ('in_progress', 'completed'))
);

CREATE INDEX IF NOT EXISTS content_post_publish_claims_org_idx
  ON public.content_post_publish_claims(org_id);

CREATE INDEX IF NOT EXISTS content_post_publish_claims_project_idx
  ON public.content_post_publish_claims(project_id);

CREATE INDEX IF NOT EXISTS content_post_publish_claims_locked_idx
  ON public.content_post_publish_claims(claim_status, locked_at);

DROP TRIGGER IF EXISTS content_post_publish_claims_updated_at
  ON public.content_post_publish_claims;
CREATE TRIGGER content_post_publish_claims_updated_at
  BEFORE UPDATE ON public.content_post_publish_claims
  FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();

ALTER TABLE public.content_post_publish_claims ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.content_post_publish_claims FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.content_post_publish_claims TO service_role;
