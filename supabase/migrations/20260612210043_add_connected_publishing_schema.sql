-- Connected publishing schema used by WordPress, Ghost, Webflow, Sanity,
-- Strapi, Contentful, HubSpot, and Git publishers.
--
-- These objects existed in production before they were represented in the
-- repo. Keep this migration idempotent so it can run against prod safely while
-- making future restores aware of the runtime tables and RPCs.

CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE SCHEMA IF NOT EXISTS vault;
CREATE EXTENSION IF NOT EXISTS supabase_vault WITH SCHEMA vault;

DO $$
BEGIN
  IF to_regclass('public.organizations') IS NULL THEN
    RAISE EXCEPTION 'public.organizations is required before connected publishing schema can be installed';
  END IF;

  IF to_regclass('public.content_posts') IS NULL THEN
    RAISE EXCEPTION 'public.content_posts is required before connected publishing schema can be installed';
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS public.publishers (
  id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  kind text NOT NULL,
  name text NOT NULL,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  credentials_ref text NOT NULL,
  default_status text NOT NULL DEFAULT 'draft',
  health_status text,
  health_detail text,
  last_health_check timestamptz,
  connected_at timestamptz NOT NULL DEFAULT now(),
  connected_by uuid,
  UNIQUE (org_id, kind, name)
);

ALTER TABLE public.publishers
  ADD COLUMN IF NOT EXISTS org_id uuid,
  ADD COLUMN IF NOT EXISTS kind text,
  ADD COLUMN IF NOT EXISTS name text,
  ADD COLUMN IF NOT EXISTS config jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS credentials_ref text,
  ADD COLUMN IF NOT EXISTS default_status text NOT NULL DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS health_status text,
  ADD COLUMN IF NOT EXISTS health_detail text,
  ADD COLUMN IF NOT EXISTS last_health_check timestamptz,
  ADD COLUMN IF NOT EXISTS connected_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS connected_by uuid;

ALTER TABLE public.publishers
  ALTER COLUMN config SET DEFAULT '{}'::jsonb,
  ALTER COLUMN default_status SET DEFAULT 'draft',
  ALTER COLUMN connected_at SET DEFAULT now();

ALTER TABLE public.publishers
  DROP CONSTRAINT IF EXISTS publishers_kind_check,
  DROP CONSTRAINT IF EXISTS publishers_default_status_check,
  DROP CONSTRAINT IF EXISTS publishers_health_status_check;

ALTER TABLE public.publishers
  ADD CONSTRAINT publishers_kind_check CHECK (
    kind IN ('wordpress', 'ghost', 'webflow', 'hubspot', 'notion', 'sanity', 'contentful', 'github_mdx')
  ),
  ADD CONSTRAINT publishers_default_status_check CHECK (
    default_status IN ('draft', 'published', 'scheduled')
  ),
  ADD CONSTRAINT publishers_health_status_check CHECK (
    health_status IN ('healthy', 'stale', 'unknown', 'never')
  );

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'publishers_org_id_fkey'
      AND conrelid = 'public.publishers'::regclass
  ) THEN
    ALTER TABLE public.publishers
      ADD CONSTRAINT publishers_org_id_fkey
      FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'publishers_org_id_kind_name_key'
      AND conrelid = 'public.publishers'::regclass
  ) THEN
    ALTER TABLE public.publishers
      ADD CONSTRAINT publishers_org_id_kind_name_key UNIQUE (org_id, kind, name);
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS publishers_org_idx ON public.publishers(org_id);
CREATE INDEX IF NOT EXISTS publishers_health_idx ON public.publishers(health_status, last_health_check);

COMMENT ON TABLE public.publishers IS
  'One row per connected publishing target. Credentials live behind credentials_ref; this row stores non-secret config and health state.';

CREATE OR REPLACE FUNCTION public.set_publisher_credentials(p_id uuid, p_creds jsonb)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE
  secret_name text := 'publisher_' || p_id::text || '_creds';
BEGIN
  DELETE FROM vault.secrets WHERE name = secret_name;
  PERFORM vault.create_secret(p_creds::text, secret_name);
  UPDATE public.publishers
  SET credentials_ref = secret_name
  WHERE id = p_id;
  RETURN secret_name;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_publisher_credentials(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE
  ref text;
  secret_text text;
BEGIN
  SELECT credentials_ref INTO ref
  FROM public.publishers
  WHERE id = p_id;

  IF ref IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT decrypted_secret INTO secret_text
  FROM vault.decrypted_secrets
  WHERE name = ref;

  IF secret_text IS NULL THEN
    RETURN NULL;
  END IF;

  RETURN secret_text::jsonb;
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_publisher_credentials_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
BEGIN
  IF OLD.credentials_ref IS NOT NULL THEN
    DELETE FROM vault.secrets WHERE name = OLD.credentials_ref;
  END IF;
  RETURN OLD;
END;
$$;

COMMENT ON FUNCTION public.set_publisher_credentials(uuid, jsonb) IS
  'Stores or rotates publisher credentials in Supabase Vault. Edge functions call this via rpc().';
COMMENT ON FUNCTION public.get_publisher_credentials(uuid) IS
  'Reads decrypted publisher credentials for Edge Functions. Returns null when credentials are missing.';

DROP TRIGGER IF EXISTS publishers_cleanup_credentials ON public.publishers;
CREATE TRIGGER publishers_cleanup_credentials
  BEFORE DELETE ON public.publishers
  FOR EACH ROW EXECUTE FUNCTION public.delete_publisher_credentials_trigger();

CREATE TABLE IF NOT EXISTS public.publish_attempts (
  id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  post_id uuid REFERENCES public.content_posts(id) ON DELETE SET NULL,
  publisher_id uuid NOT NULL REFERENCES public.publishers(id) ON DELETE CASCADE,
  idempotency_key text NOT NULL,
  attempt_seq integer NOT NULL DEFAULT 1,
  phase text NOT NULL,
  outcome text NOT NULL,
  error_code text,
  error_message text,
  recovery_action text,
  request_payload jsonb,
  response_body jsonb,
  remote_id text,
  remote_url text,
  latency_ms integer,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (idempotency_key, phase)
);

ALTER TABLE public.publish_attempts
  ADD COLUMN IF NOT EXISTS org_id uuid,
  ADD COLUMN IF NOT EXISTS post_id uuid,
  ADD COLUMN IF NOT EXISTS publisher_id uuid,
  ADD COLUMN IF NOT EXISTS idempotency_key text,
  ADD COLUMN IF NOT EXISTS attempt_seq integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS phase text,
  ADD COLUMN IF NOT EXISTS outcome text,
  ADD COLUMN IF NOT EXISTS error_code text,
  ADD COLUMN IF NOT EXISTS error_message text,
  ADD COLUMN IF NOT EXISTS recovery_action text,
  ADD COLUMN IF NOT EXISTS request_payload jsonb,
  ADD COLUMN IF NOT EXISTS response_body jsonb,
  ADD COLUMN IF NOT EXISTS remote_id text,
  ADD COLUMN IF NOT EXISTS remote_url text,
  ADD COLUMN IF NOT EXISTS latency_ms integer,
  ADD COLUMN IF NOT EXISTS started_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS completed_at timestamptz;

ALTER TABLE public.publish_attempts
  ALTER COLUMN attempt_seq SET DEFAULT 1,
  ALTER COLUMN started_at SET DEFAULT now();

ALTER TABLE public.publish_attempts
  DROP CONSTRAINT IF EXISTS publish_attempts_phase_check,
  DROP CONSTRAINT IF EXISTS publish_attempts_outcome_check,
  DROP CONSTRAINT IF EXISTS publish_attempts_error_code_check;

ALTER TABLE public.publish_attempts
  ADD CONSTRAINT publish_attempts_phase_check CHECK (
    phase IN ('dry_run', 'image_upload', 'taxonomy_reconcile', 'create_post', 'set_metadata', 'publish', 'verify', 'unpublish')
  ),
  ADD CONSTRAINT publish_attempts_outcome_check CHECK (
    outcome IN ('success', 'failed', 'in_progress', 'cancelled', 'skipped')
  ),
  ADD CONSTRAINT publish_attempts_error_code_check CHECK (
    error_code IS NULL OR error_code IN (
      'auth_expired',
      'auth_invalid',
      'permission_denied',
      'target_not_found',
      'validation_failed',
      'slug_collision',
      'image_upload_failed',
      'rate_limited',
      'network_timeout',
      'target_misconfigured',
      'payload_too_large',
      'unknown_error'
    )
  );

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'publish_attempts_org_id_fkey'
      AND conrelid = 'public.publish_attempts'::regclass
  ) THEN
    ALTER TABLE public.publish_attempts
      ADD CONSTRAINT publish_attempts_org_id_fkey
      FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'publish_attempts_post_id_fkey'
      AND conrelid = 'public.publish_attempts'::regclass
  ) THEN
    ALTER TABLE public.publish_attempts
      ADD CONSTRAINT publish_attempts_post_id_fkey
      FOREIGN KEY (post_id) REFERENCES public.content_posts(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'publish_attempts_publisher_id_fkey'
      AND conrelid = 'public.publish_attempts'::regclass
  ) THEN
    ALTER TABLE public.publish_attempts
      ADD CONSTRAINT publish_attempts_publisher_id_fkey
      FOREIGN KEY (publisher_id) REFERENCES public.publishers(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'publish_attempts_idempotency_key_phase_key'
      AND conrelid = 'public.publish_attempts'::regclass
  ) THEN
    ALTER TABLE public.publish_attempts
      ADD CONSTRAINT publish_attempts_idempotency_key_phase_key UNIQUE (idempotency_key, phase);
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS publish_attempts_idempotency_idx
  ON public.publish_attempts(idempotency_key);
CREATE INDEX IF NOT EXISTS publish_attempts_post_idx
  ON public.publish_attempts(post_id, started_at DESC);
CREATE INDEX IF NOT EXISTS publish_attempts_publisher_idx
  ON public.publish_attempts(publisher_id, started_at DESC);
CREATE INDEX IF NOT EXISTS publish_attempts_failures_idx
  ON public.publish_attempts(error_code, started_at DESC)
  WHERE outcome = 'failed';

COMMENT ON TABLE public.publish_attempts IS
  'Append-only audit trail. Every phase of every connected publish lands here.';

CREATE TABLE IF NOT EXISTS public.publish_locks (
  post_id uuid NOT NULL,
  publisher_id uuid NOT NULL,
  locked_at timestamptz NOT NULL DEFAULT now(),
  locked_by uuid,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '5 minutes'),
  PRIMARY KEY (post_id, publisher_id)
);

ALTER TABLE public.publish_locks
  ADD COLUMN IF NOT EXISTS locked_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS locked_by uuid,
  ADD COLUMN IF NOT EXISTS expires_at timestamptz NOT NULL DEFAULT (now() + interval '5 minutes');

COMMENT ON TABLE public.publish_locks IS
  'Single-flight guard. Prevents two operators from publishing the same post to the same target concurrently.';

CREATE OR REPLACE FUNCTION public.acquire_publish_lock(
  p_post_id uuid,
  p_publisher_id uuid,
  p_locked_by uuid
)
RETURNS boolean
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  inserted boolean;
BEGIN
  DELETE FROM public.publish_locks
  WHERE expires_at < now();

  INSERT INTO public.publish_locks (post_id, publisher_id, locked_by)
  VALUES (p_post_id, p_publisher_id, p_locked_by)
  ON CONFLICT (post_id, publisher_id) DO NOTHING;

  GET DIAGNOSTICS inserted = ROW_COUNT;
  RETURN inserted > 0;
END;
$$;

CREATE OR REPLACE FUNCTION public.release_publish_lock(
  p_post_id uuid,
  p_publisher_id uuid
)
RETURNS void
LANGUAGE sql
SET search_path = public
AS $$
  DELETE FROM public.publish_locks
  WHERE post_id = p_post_id
    AND publisher_id = p_publisher_id;
$$;

ALTER TABLE public.publishers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.publish_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.publish_locks ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.publishers FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.publishers TO authenticated, service_role;

REVOKE ALL ON public.publish_attempts FROM anon;
GRANT SELECT ON public.publish_attempts TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.publish_attempts TO service_role;

REVOKE ALL ON public.publish_locks FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.publish_locks TO service_role;

REVOKE ALL ON FUNCTION public.set_publisher_credentials(uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_publisher_credentials(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.delete_publisher_credentials_trigger() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_publisher_credentials(uuid, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_publisher_credentials(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.delete_publisher_credentials_trigger() TO service_role;

REVOKE ALL ON FUNCTION public.acquire_publish_lock(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_publish_lock(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.acquire_publish_lock(uuid, uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_publish_lock(uuid, uuid) TO service_role;

DROP POLICY IF EXISTS publishers_member_all ON public.publishers;
CREATE POLICY publishers_member_all ON public.publishers
  FOR ALL TO authenticated
  USING (private.is_org_member(org_id))
  WITH CHECK (private.is_org_member(org_id));

DROP POLICY IF EXISTS publish_attempts_member_select ON public.publish_attempts;
DROP POLICY IF EXISTS publish_attempts_member_all ON public.publish_attempts;
CREATE POLICY publish_attempts_member_select ON public.publish_attempts
  FOR SELECT TO authenticated
  USING (private.is_org_member(org_id) OR private.is_post_member(post_id));

DROP POLICY IF EXISTS publish_locks_member_all ON public.publish_locks;
