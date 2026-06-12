-- Atomic claim helper for direct publishing functions that use
-- content_post_publish_claims. The TypeScript helper used to claim in several
-- client-side PostgREST calls, which left a small stale-read window between
-- checking content_posts.posted_at and claiming the publish row.

CREATE OR REPLACE FUNCTION public.claim_content_post_publish(
  p_post_id uuid,
  p_org_id uuid,
  p_project_id uuid,
  p_channel text,
  p_claimed_by text,
  p_stale_after interval DEFAULT interval '15 minutes'
)
RETURNS TABLE(ok boolean, status integer, message text)
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_post record;
  v_existing record;
  v_rows integer;
BEGIN
  SELECT id, org_id, project_id, posted_at
  INTO v_post
  FROM public.content_posts
  WHERE id = p_post_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 404, 'Post not found.'::text;
    RETURN;
  END IF;

  IF v_post.org_id IS DISTINCT FROM p_org_id
    OR v_post.project_id IS DISTINCT FROM p_project_id THEN
    RETURN QUERY SELECT false, 403, 'Forbidden'::text;
    RETURN;
  END IF;

  IF v_post.posted_at IS NOT NULL THEN
    RETURN QUERY SELECT false, 409, 'Post is already marked posted; refusing to publish again.'::text;
    RETURN;
  END IF;

  INSERT INTO public.content_post_publish_claims (
    post_id,
    org_id,
    project_id,
    channel,
    claim_status,
    claimed_by,
    locked_at,
    completed_at,
    remote_id,
    remote_url,
    last_error
  )
  VALUES (
    p_post_id,
    p_org_id,
    p_project_id,
    p_channel,
    'in_progress',
    p_claimed_by,
    now(),
    null,
    null,
    null,
    null
  )
  ON CONFLICT (post_id) DO UPDATE
  SET
    org_id = excluded.org_id,
    project_id = excluded.project_id,
    channel = excluded.channel,
    claim_status = 'in_progress',
    claimed_by = excluded.claimed_by,
    locked_at = excluded.locked_at,
    completed_at = null,
    remote_id = null,
    remote_url = null,
    last_error = null
  WHERE public.content_post_publish_claims.claim_status = 'in_progress'
    AND public.content_post_publish_claims.locked_at <= now() - p_stale_after;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows > 0 THEN
    RETURN QUERY SELECT true, 200, 'Publish claim acquired.'::text;
    RETURN;
  END IF;

  SELECT claim_status, locked_at, completed_at
  INTO v_existing
  FROM public.content_post_publish_claims
  WHERE post_id = p_post_id;

  IF v_existing.claim_status = 'completed' OR v_existing.completed_at IS NOT NULL THEN
    RETURN QUERY SELECT false, 409, 'Post has already been published or claimed as published.'::text;
    RETURN;
  END IF;

  RETURN QUERY SELECT false, 409, 'Publish is already in progress for this post.'::text;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_content_post_publish(uuid, uuid, uuid, text, text, interval)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_content_post_publish(uuid, uuid, uuid, text, text, interval)
  TO service_role;
