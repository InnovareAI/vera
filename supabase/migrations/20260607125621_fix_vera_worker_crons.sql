-- Fix VERA worker cron jobs so they call deployed Edge Functions through
-- internal Kong URLs and read the service key from Supabase Vault at runtime.
-- Prerequisite: vault.decrypted_secrets contains name = 'service_role_key'.

DO $$
BEGIN
IF to_regclass('cron.job') IS NULL THEN
  RETURN;
END IF;

UPDATE cron.job
SET command = $cmd$
select net.http_post(
  url := 'http://kong:8000/functions/v1/vera-refine-skills',
  headers := jsonb_build_object(
    'Content-Type', 'application/json',
    'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key'),
    'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key')
  ),
  body := '{}'::jsonb,
  timeout_milliseconds := 120000
);
$cmd$,
active = true
WHERE jobname = 'vera-weekly-skill-refine';

UPDATE cron.job
SET command = $cmd$
select net.http_post(
  url := 'http://kong:8000/functions/v1/unipile-health-check',
  headers := jsonb_build_object(
    'Content-Type', 'application/json',
    'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key'),
    'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key')
  ),
  body := '{}'::jsonb,
  timeout_milliseconds := 120000
);
$cmd$,
active = true
WHERE jobname = 'vera-daily-unipile-health';

UPDATE cron.job
SET command = $cmd$
select net.http_post(
  url := 'http://kong:8000/functions/v1/vera-refine-kb',
  headers := jsonb_build_object(
    'Content-Type', 'application/json',
    'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key'),
    'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key')
  ),
  body := '{}'::jsonb,
  timeout_milliseconds := 180000
);
$cmd$,
active = true
WHERE jobname = 'vera-weekly-kb-refine';

UPDATE cron.job
SET command = $cmd$
select net.http_post(
  url := 'http://kong:8000/functions/v1/publish-health-check',
  headers := jsonb_build_object(
    'Content-Type', 'application/json',
    'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key'),
    'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key')
  ),
  body := '{}'::jsonb,
  timeout_milliseconds := 120000
);
$cmd$,
active = true
WHERE jobname = 'vera-daily-publish-health';

UPDATE cron.job
SET command = $cmd$
select net.http_post(
  url := 'http://kong:8000/functions/v1/vera-notice',
  headers := jsonb_build_object(
    'Content-Type', 'application/json',
    'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key'),
    'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key')
  ),
  body := '{}'::jsonb,
  timeout_milliseconds := 120000
);
$cmd$,
active = true
WHERE jobname = 'vera-notice-every-30min';

END
$$;
