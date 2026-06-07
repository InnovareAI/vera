// DRAFT — the 6-verb contract every blog/CMS publisher implements.
//
// The error taxonomy, idempotency layer, audit log, health-check cron, and
// publish UI all live ABOVE this interface — written once, reused for
// every connector. Each platform (WordPress, Ghost, Webflow, ...) only
// implements the platform-specific glue.
//
// Social publishing (Unipile/LinkedIn) is a separate track — drafts /
// featured images / categories / scheduled posts don't apply there.

// ─── Identity ──────────────────────────────────────────────────────────────
export type PublisherKind =
  | 'wordpress' | 'ghost' | 'webflow' | 'hubspot'
  | 'notion' | 'sanity' | 'contentful' | 'github_mdx'

// ─── Error taxonomy ────────────────────────────────────────────────────────
export type PublisherErrorCode =
  | 'auth_expired'         // refresh / re-auth needed
  | 'auth_invalid'         // credentials wrong from the start
  | 'permission_denied'    // creds valid but role insufficient
  | 'target_not_found'     // site/collection/category id wrong
  | 'validation_failed'    // payload rejected (missing required field, etc.)
  | 'slug_collision'       // slug already used; need rewrite
  | 'image_upload_failed'  // featured image step blew up
  | 'rate_limited'         // 429; retry after window
  | 'network_timeout'      // transient; safe to retry
  | 'target_misconfigured' // REST disabled, Auth header stripped, etc.
  | 'payload_too_large'    // hit the platform's body-size cap
  | 'unknown_error'        // catch-all; always surface raw response in detail

export interface PublisherError {
  code: PublisherErrorCode
  message: string             // operator-language ("WordPress rejected the password")
  recovery_action: string     // concrete next step
  detail?: Record<string, unknown>  // raw response body, status, headers, etc.
}

// ─── Post payload (canonical) ──────────────────────────────────────────────
export interface PostInput {
  title: string
  body_md: string                // canonical markdown source
  excerpt?: string
  slug?: string                  // operator-set, else derived
  tags?: string[]
  categories?: string[]
  featured_image_url?: string
  status?: 'draft' | 'published' | 'scheduled'
  scheduled_at?: string          // ISO 8601 UTC
  metadata?: Record<string, unknown>  // platform-specific overrides
}

// ─── Results ───────────────────────────────────────────────────────────────
export interface DryRunResult {
  ok: boolean
  preview: {
    rendered_html: string
    final_slug: string             // after collision check + slug rewrite
    target_categories: string[]    // resolved to existing ids where possible
    target_tags: string[]
    image_will_upload: boolean
    will_create_taxonomies: {      // non-existent on target, would auto-create
      categories: string[]
      tags: string[]
    }
    scheduled_at_utc: string | null
    scheduled_at_target_tz: string | null  // shown to operator for confirmation
  }
  warnings: string[]               // non-fatal but worth surfacing
  error?: PublisherError
}

export interface PublishResult {
  ok: boolean
  remote_id?: string
  remote_url?: string
  verified?: boolean               // verify() ran and passed
  attempt_id: string               // points at publish_attempts row chain
  latency_ms: number
  error?: PublisherError
}

export interface HealthCheckResult {
  ok: boolean
  status: 'healthy' | 'stale' | 'unknown'
  detail?: string
  checked_at: string
}

export interface VerifyResult {
  ok: boolean
  status: 'draft' | 'published' | 'scheduled' | 'missing'
  remote_url?: string
  featured_image_set?: boolean
  detail?: string
}

export interface UnpublishResult {
  ok: boolean
  error?: PublisherError
}

// ─── The contract ──────────────────────────────────────────────────────────
export interface Publisher {
  /** Run at connect time — validate creds + connection end-to-end. */
  connect(): Promise<HealthCheckResult>

  /** Daily cron probe; marks publishers.health_status. */
  health_check(): Promise<HealthCheckResult>

  /** Render the post for the target. Writes nothing remote. Returns
   *  a preview + warnings + would-create taxonomies so the operator
   *  can confirm before committing. */
  dry_run(post: PostInput): Promise<DryRunResult>

  /** Idempotent on idempotency_key. Same key replays the same outcome
   *  (success or failure) instead of re-executing. Atomic across phases:
   *  image upload, taxonomy reconcile, create post, set metadata, publish,
   *  verify. If any phase fails, the prior phases are NOT rolled back
   *  automatically — the audit log shows where to resume / unpublish. */
  publish(post: PostInput, idempotency_key: string): Promise<PublishResult>

  /** Re-fetch the published post and confirm visible status. Runs as
   *  the last phase of publish() AND can be invoked standalone to
   *  re-verify a previously-published post. */
  verify(remote_id: string): Promise<VerifyResult>

  /** Rollback. Sets the remote post to 'draft' or deletes (per platform). */
  unpublish(remote_id: string): Promise<UnpublishResult>
}

// ─── Shared helpers (implemented in this file, used by every connector) ─────

/** Builds a deterministic idempotency key for a (post_id, publisher_id) +
 *  the post's content fingerprint. Same content + same target + same day =
 *  same key, so a retry doesn't double-publish. New content = new key. */
export function idempotencyKeyFor(post_id: string, publisher_id: string, content_hash: string): string {
  return `${post_id}:${publisher_id}:${content_hash}`
}

/** Strip credentials from any payload before logging to publish_attempts. */
export function redactForAudit(payload: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(payload)) {
    if (/auth|token|key|password|secret/i.test(k)) {
      out[k] = '<redacted>'
    } else if (v && typeof v === 'object' && !Array.isArray(v)) {
      out[k] = redactForAudit(v as Record<string, unknown>)
    } else {
      out[k] = v
    }
  }
  return out
}
