-- Add Medium as a manual content platform and source.

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
