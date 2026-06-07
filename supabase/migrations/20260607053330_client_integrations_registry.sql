-- Client-scoped integration registry for agentic source and publishing access.
-- This table stores non-secret connection state only. OAuth tokens, API keys,
-- and passwords stay in encrypted service-managed stores.

CREATE TABLE IF NOT EXISTS public.client_integrations (
  id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  provider text NOT NULL,
  category text NOT NULL,
  display_name text NOT NULL,
  status text NOT NULL DEFAULT 'not_connected',
  connection_kind text NOT NULL DEFAULT 'manual',
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  capabilities jsonb NOT NULL DEFAULT '{}'::jsonb,
  scopes text[] NOT NULL DEFAULT '{}',
  credential_ref uuid REFERENCES public.client_api_keys(id) ON DELETE SET NULL,
  external_ref jsonb NOT NULL DEFAULT '{}'::jsonb,
  health_status text NOT NULL DEFAULT 'unknown',
  health_detail text,
  last_sync_at timestamptz,
  last_health_check timestamptz,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT client_integrations_provider_check CHECK (
    provider IN (
      'google_search_console',
      'google_analytics_4',
      'wordpress',
      'webflow',
      'contentful',
      'sanity',
      'strapi',
      'hubspot_cms',
      'ghost',
      'shopify_blog',
      'custom_cms'
    )
  ),
  CONSTRAINT client_integrations_category_check CHECK (
    category IN ('analytics', 'seo', 'publisher', 'cms', 'content_source')
  ),
  CONSTRAINT client_integrations_status_check CHECK (
    status IN ('not_connected', 'pending', 'connected', 'error', 'paused', 'revoked')
  ),
  CONSTRAINT client_integrations_connection_kind_check CHECK (
    connection_kind IN ('oauth', 'api_key', 'app_password', 'webhook', 'manual', 'publisher')
  ),
  CONSTRAINT client_integrations_health_check CHECK (
    health_status IN ('unknown', 'healthy', 'stale', 'error')
  ),
  UNIQUE (project_id, provider, display_name)
);

CREATE INDEX IF NOT EXISTS client_integrations_org_idx ON public.client_integrations(org_id);
CREATE INDEX IF NOT EXISTS client_integrations_project_idx ON public.client_integrations(project_id);
CREATE INDEX IF NOT EXISTS client_integrations_provider_idx ON public.client_integrations(provider);
CREATE INDEX IF NOT EXISTS client_integrations_category_idx ON public.client_integrations(category);
CREATE INDEX IF NOT EXISTS client_integrations_status_idx ON public.client_integrations(status);
CREATE INDEX IF NOT EXISTS client_integrations_capabilities_idx ON public.client_integrations USING gin(capabilities);
CREATE INDEX IF NOT EXISTS client_integrations_scopes_idx ON public.client_integrations USING gin(scopes);

DROP TRIGGER IF EXISTS client_integrations_updated_at ON public.client_integrations;
CREATE TRIGGER client_integrations_updated_at
  BEFORE UPDATE ON public.client_integrations
  FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();

ALTER TABLE public.client_integrations ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.client_integrations FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_integrations TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_integrations TO service_role;

DROP POLICY IF EXISTS client_integrations_select ON public.client_integrations;
DROP POLICY IF EXISTS client_integrations_insert ON public.client_integrations;
DROP POLICY IF EXISTS client_integrations_update ON public.client_integrations;
DROP POLICY IF EXISTS client_integrations_delete ON public.client_integrations;

CREATE POLICY client_integrations_select ON public.client_integrations
  FOR SELECT TO authenticated
  USING (private.can_project_read(project_id));

CREATE POLICY client_integrations_insert ON public.client_integrations
  FOR INSERT TO authenticated
  WITH CHECK (
    private.can_project_manage(project_id)
    AND org_id = private.project_org_id(project_id)
  );

CREATE POLICY client_integrations_update ON public.client_integrations
  FOR UPDATE TO authenticated
  USING (private.can_project_manage(project_id))
  WITH CHECK (
    private.can_project_manage(project_id)
    AND org_id = private.project_org_id(project_id)
  );

CREATE POLICY client_integrations_delete ON public.client_integrations
  FOR DELETE TO authenticated
  USING (private.can_project_manage(project_id));
