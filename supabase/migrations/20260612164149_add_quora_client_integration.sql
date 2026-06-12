-- Add Quora as a manual content and answer platform in the client integration registry.
-- Quora is source and handoff first: no official live publishing adapter is implied.

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
      'medium',
      'quora',
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
