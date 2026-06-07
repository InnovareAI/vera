-- Expand the client integration registry to include organic social channels.
-- The registry still stores non-secret state only. OAuth tokens and refresh
-- tokens belong in service-managed encrypted stores.

ALTER TABLE public.client_integrations
  DROP CONSTRAINT IF EXISTS client_integrations_provider_check;

ALTER TABLE public.client_integrations
  ADD CONSTRAINT client_integrations_provider_check CHECK (
    provider IN (
      'google_search_console',
      'google_analytics_4',
      'meta_facebook_pages',
      'meta_instagram',
      'meta_threads',
      'linkedin',
      'x',
      'youtube',
      'tiktok',
      'pinterest',
      'reddit',
      'bluesky',
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
  );

ALTER TABLE public.client_integrations
  DROP CONSTRAINT IF EXISTS client_integrations_category_check;

ALTER TABLE public.client_integrations
  ADD CONSTRAINT client_integrations_category_check CHECK (
    category IN ('analytics', 'seo', 'social', 'publisher', 'cms', 'content_source')
  );
