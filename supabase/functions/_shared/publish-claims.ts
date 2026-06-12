import type { AdminClient } from "./auth.ts"

export type ClaimablePost = {
  id: string
  org_id?: string | null
  project_id?: string | null
}

export type PublishClaim =
  | { ok: true }
  | { ok: false; message: string; status: number }

export const DEFAULT_PUBLISH_CLAIM_STALE_MS = 15 * 60 * 1000

export async function claimPublish(
  supabase: AdminClient,
  post: ClaimablePost,
  channel: string,
  claimedBy: string,
  staleMs = DEFAULT_PUBLISH_CLAIM_STALE_MS,
): Promise<PublishClaim> {
  const row = {
    post_id: post.id,
    org_id: post.org_id ?? null,
    project_id: post.project_id ?? null,
    channel,
    claim_status: "in_progress",
    claimed_by: claimedBy,
    locked_at: new Date().toISOString(),
  }

  const firstAttempt = await supabase.from("content_post_publish_claims").insert(row)
  if (!firstAttempt.error) return { ok: true }
  if (firstAttempt.error.code !== "23505") {
    console.error("publish claim insert failed", firstAttempt.error)
    return { ok: false, status: 500, message: `Publish claim failed: ${firstAttempt.error.message}` }
  }

  const { data: existingData, error: lookupError } = await supabase
    .from("content_post_publish_claims")
    .select("post_id, claim_status, locked_at, completed_at")
    .eq("post_id", post.id)
    .maybeSingle()

  if (lookupError) {
    console.error("publish claim lookup failed", lookupError)
    return { ok: false, status: 500, message: `Publish claim lookup failed: ${lookupError.message}` }
  }

  const existing = existingData as { claim_status?: string; locked_at?: string; completed_at?: string | null } | null
  if (!existing) {
    const retry = await supabase.from("content_post_publish_claims").insert(row)
    if (!retry.error) return { ok: true }
    return { ok: false, status: 409, message: "Publish is already in progress for this post." }
  }

  if (existing.claim_status === "completed" || existing.completed_at) {
    return { ok: false, status: 409, message: "Post has already been published or claimed as published." }
  }

  const lockedAt = existing.locked_at ? Date.parse(existing.locked_at) : Number.NaN
  const isStale = Number.isFinite(lockedAt) && Date.now() - lockedAt > staleMs
  if (!isStale) {
    return { ok: false, status: 409, message: "Publish is already in progress for this post." }
  }

  const staleCutoff = new Date(Date.now() - staleMs).toISOString()
  const staleDelete = await supabase
    .from("content_post_publish_claims")
    .delete()
    .eq("post_id", post.id)
    .eq("claim_status", "in_progress")
    .lte("locked_at", staleCutoff)

  if (staleDelete.error) {
    console.error("stale publish claim cleanup failed", staleDelete.error)
    return { ok: false, status: 500, message: `Stale publish claim cleanup failed: ${staleDelete.error.message}` }
  }

  const retry = await supabase.from("content_post_publish_claims").insert(row)
  if (!retry.error) return { ok: true }
  if (retry.error.code === "23505") {
    return { ok: false, status: 409, message: "Publish is already in progress for this post." }
  }
  console.error("stale publish claim retry failed", retry.error)
  return { ok: false, status: 500, message: `Publish claim retry failed: ${retry.error.message}` }
}

export async function releasePublishClaim(supabase: AdminClient, postId: string, reason: string) {
  const { error } = await supabase
    .from("content_post_publish_claims")
    .delete()
    .eq("post_id", postId)
    .eq("claim_status", "in_progress")
  if (error) console.error("publish claim release failed", { postId, reason, error })
}

export async function markPublishClaimError(supabase: AdminClient, postId: string, reason: string) {
  const { error } = await supabase
    .from("content_post_publish_claims")
    .update({ last_error: reason.slice(0, 1000) })
    .eq("post_id", postId)
    .eq("claim_status", "in_progress")
  if (error) console.error("publish claim error update failed", { postId, reason, error })
}

export async function completePublishClaim(
  supabase: AdminClient,
  post: ClaimablePost,
  remoteId?: string,
  remoteUrl?: string,
) {
  const { error } = await supabase
    .from("content_post_publish_claims")
    .update({
      claim_status: "completed",
      completed_at: new Date().toISOString(),
      org_id: post.org_id ?? null,
      project_id: post.project_id ?? null,
      remote_id: remoteId ?? null,
      remote_url: remoteUrl ?? null,
      last_error: null,
    })
    .eq("post_id", post.id)
  if (error) console.error("publish claim completion update failed", { post_id: post.id, error })
}
