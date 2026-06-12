import type { AdminClient } from "./auth.ts"

export type PublishLockGuard =
  | { ok: true }
  | { ok: false; message: string; recoveryAction: string }

export async function acquirePublishLockForOpenPost(
  supabase: AdminClient,
  postId: string,
  publisherId: string,
  lockedBy: string | null,
): Promise<PublishLockGuard> {
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

  const { data: post, error: postError } = await supabase
    .from("content_posts")
    .select("id, posted_at")
    .eq("id", postId)
    .maybeSingle()

  if (postError || !post) {
    await releasePublishLock(supabase, postId, publisherId)
    return {
      ok: false,
      message: postError ? `Post lookup failed: ${postError.message}` : "Post not found.",
      recoveryAction: "Refresh the post and try again.",
    }
  }

  if ((post as { posted_at?: string | null }).posted_at) {
    await releasePublishLock(supabase, postId, publisherId)
    return {
      ok: false,
      message: "Post is already marked posted; refusing to publish again.",
      recoveryAction: "Refresh the post detail page before publishing.",
    }
  }

  return { ok: true }
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
