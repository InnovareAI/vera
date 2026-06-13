import type { AdminClient } from "./auth.ts"

export type PublishLockPost = {
  id: string
  org_id?: string | null
  project_id?: string | null
  channel?: string | null
  posted_at?: string | null
}

type PublishLockPublisher = {
  id: string
  org_id?: string | null
  project_id?: string | null
}

export type PublishLockGuard =
  | { ok: true; post: PublishLockPost }
  | { ok: false; message: string; recoveryAction: string }

export async function acquirePublishLockForOpenPost(
  supabase: AdminClient,
  postId: string,
  publisherId: string,
  lockedBy: string | null,
): Promise<PublishLockGuard> {
  const [postResult, publisherResult] = await Promise.all([
    supabase
      .from("content_posts")
      .select("id, org_id, project_id, channel, posted_at")
      .eq("id", postId)
      .maybeSingle(),
    supabase
      .from("publishers")
      .select("id, org_id, project_id")
      .eq("id", publisherId)
      .maybeSingle(),
  ])

  if (postResult.error || !postResult.data) {
    return {
      ok: false,
      message: postResult.error ? `Post lookup failed: ${postResult.error.message}` : "Post not found.",
      recoveryAction: "Refresh the post and try again.",
    }
  }

  if (publisherResult.error || !publisherResult.data) {
    return {
      ok: false,
      message: publisherResult.error ? `Publisher lookup failed: ${publisherResult.error.message}` : "Publisher not found.",
      recoveryAction: "Reconnect the publishing target in settings.",
    }
  }

  const post = postResult.data as PublishLockPost
  const publisher = publisherResult.data as PublishLockPublisher
  const scopeCheck = validatePublisherScope(post, publisher)
  if (!scopeCheck.ok) return scopeCheck

  if (post.posted_at) {
    return {
      ok: false,
      message: "Post is already marked posted; refusing to publish again.",
      recoveryAction: "Refresh the post detail page before publishing.",
    }
  }

  const { data: lockData, error: lockError } = await supabase.rpc("acquire_publish_lock", {
    p_post_id: postId,
    p_publisher_id: publisherId,
    p_locked_by: lockedBy as unknown as string,
  })
  if (lockError || !lockData) {
    if (lockError) console.error("publish lock acquisition failed", lockError)
    return {
      ok: false,
      message: "Concurrent publish in progress.",
      recoveryAction: "Wait for it to complete, or wait 5 minutes for the lock to expire.",
    }
  }

  const { data: lockedPost, error: postError } = await supabase
    .from("content_posts")
    .select("id, org_id, project_id, channel, posted_at")
    .eq("id", postId)
    .maybeSingle()

  if (postError || !lockedPost) {
    await releasePublishLock(supabase, postId, publisherId)
    return {
      ok: false,
      message: postError ? `Post lookup failed: ${postError.message}` : "Post not found.",
      recoveryAction: "Refresh the post and try again.",
    }
  }

  const lockedPostRow = lockedPost as PublishLockPost
  if (lockedPostRow.posted_at) {
    await releasePublishLock(supabase, postId, publisherId)
    return {
      ok: false,
      message: "Post is already marked posted; refusing to publish again.",
      recoveryAction: "Refresh the post detail page before publishing.",
    }
  }

  return { ok: true, post: lockedPostRow }
}

function validatePublisherScope(
  post: PublishLockPost,
  publisher: PublishLockPublisher,
): PublishLockGuard {
  if (!publisher.org_id || publisher.org_id !== post.org_id) {
    return {
      ok: false,
      message: "Publisher is not connected to this workspace.",
      recoveryAction: "Reconnect the publishing target for the correct workspace.",
    }
  }

  const postProjectId = post.project_id ?? null
  const publisherProjectId = publisher.project_id ?? null
  if (postProjectId && publisherProjectId !== postProjectId) {
    return {
      ok: false,
      message: "Publisher is not connected to this client space.",
      recoveryAction: "Reconnect the CMS/blog publisher inside this client space before publishing.",
    }
  }

  if (!postProjectId && publisherProjectId) {
    return {
      ok: false,
      message: "Publisher is client-scoped and cannot publish workspace-level posts.",
      recoveryAction: "Use a workspace-level publisher or move the post into the matching client space.",
    }
  }

  return { ok: true, post }
}

export async function releasePublishLock(
  supabase: AdminClient,
  postId: string,
  publisherId: string,
): Promise<void> {
  const { error } = await supabase.rpc("release_publish_lock", {
    p_post_id: postId,
    p_publisher_id: publisherId,
  })
  if (error) console.error("publish lock release failed", { postId, publisherId, error })
}
