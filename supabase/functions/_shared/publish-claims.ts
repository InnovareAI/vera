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
  const staleSeconds = Math.max(1, Math.ceil(staleMs / 1000))
  const { data, error } = await supabase
    .rpc("claim_content_post_publish", {
      p_post_id: post.id,
      p_org_id: post.org_id ?? null,
      p_project_id: post.project_id ?? null,
      p_channel: channel,
      p_claimed_by: claimedBy,
      p_stale_after: `${staleSeconds} seconds`,
    })
    .maybeSingle()

  if (error) {
    console.error("publish claim rpc failed", error)
    return { ok: false, status: 500, message: `Publish claim failed: ${error.message}` }
  }

  const result = data as { ok?: boolean | null; status?: number | null; message?: string | null } | null
  if (result?.ok) return { ok: true }
  return {
    ok: false,
    status: result?.status ?? 409,
    message: result?.message ?? "Publish is already in progress for this post.",
  }
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
