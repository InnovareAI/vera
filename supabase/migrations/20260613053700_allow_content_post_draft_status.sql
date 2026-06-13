-- Keep the Review queue status model aligned with the UI.
--
-- content_posts.status stores editorial review state only:
--   draft, pending, approved, rejected, changes_requested
--
-- Scheduled and Posted are delivery states derived from scheduled_at,
-- publish_date, posted_at, posted_url, and provider ids. Do not add
-- scheduled or posted back to this CHECK unless the app changes that model.

ALTER TABLE public.content_posts
  DROP CONSTRAINT IF EXISTS content_posts_status_check;

ALTER TABLE public.content_posts
  ADD CONSTRAINT content_posts_status_check
  CHECK (status IN ('draft', 'pending', 'approved', 'rejected', 'changes_requested'));
