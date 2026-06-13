// Universal Git-backed publisher.
//
// Writes Markdown/MDX files to a GitHub repo via the Contents API. Covers
// EVERY static site on Vercel/Netlify/Cloudflare Pages/GitHub Pages
// regardless of SSG (Next.js/Astro/Hugo/Gatsby/Eleventy/Docusaurus/etc.) —
// the SSG just rebuilds on the push.
//
// Two modes (operator chooses at connect time):
//   • direct push to branch (default) — file lands on main, deploy fires
//   • PR mode — file lands on feature branch + PR; merge triggers deploy
//
// Optional explicit build hook URL (Vercel/Netlify build hooks) for sites
// that don't auto-rebuild on every push (monorepos, deploy filters).
//
// Failure cases covered: bad PAT, repo not found, branch not found,
// file already exists (overwrite vs error), commit conflict, rate limit.

import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'npm:@supabase/supabase-js'
import type { Database } from '../_shared/database.types.ts'
import { publisherClientProjectId, requirePublisherActionAccess, type AdminClient } from '../_shared/auth.ts'
import { slugify } from '../_shared/markdown.ts'
import { acquirePublishLockForOpenPost, releasePublishLock } from '../_shared/publish-guard.ts'
import {
  claimPublish,
  completePublishClaim,
  releasePublishClaim,
} from '../_shared/publish-claims.ts'
import type {
  HealthCheckResult, DryRunResult, PublishResult, VerifyResult, UnpublishResult,
  PostInput, PublisherError,
} from '../_shared/publisher.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const GH_API = 'https://api.github.com'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return json({ error: 'invalid JSON' }, 400) }

  const action = body.action as string
  const supabase = createClient<Database>(SUPABASE_URL, SERVICE_KEY)
  const auth = await requirePublisherActionAccess(req, supabase, SERVICE_KEY, body, corsHeaders)
  if (!auth.ok) return auth.response

  try {
    switch (action) {
      case 'connect':       return json(await connect(supabase, body))
      case 'health_check':  return json(await health_check(supabase, body))
      case 'dry_run':       return json(await dry_run(supabase, body))
      case 'publish':       return json(await publish(supabase, body))
      case 'verify':        return json(await verify(supabase, body))
      case 'unpublish':     return json(await unpublish(supabase, body))
      default:              return json({ error: `unknown action: ${action}` }, 400)
    }
  } catch (err) {
    console.error('git-publish action', action, 'threw:', err)
    return json({ error: err instanceof Error ? err.message : String(err) }, 500)
  }
})

// ─── connect ────────────────────────────────────────────────────────────────
async function connect(supabase: AdminClient, input: Record<string, unknown>): Promise<{
  ok: boolean; publisher_id?: string; health?: HealthCheckResult; error?: PublisherError
}> {
  const org_id = input.org_id as string
  const client_project_id = publisherClientProjectId(input)
  const name = input.name as string
  const repo = input.repo as string  // "owner/repo"
  const branch = (input.branch as string)?.trim() || 'main'
  const content_dir = (input.content_dir as string)?.trim() || 'content/blog'
  const file_format = (input.file_format as string)?.trim() || 'mdx'
  const pr_mode = !!input.pr_mode
  const commit_author_name = (input.commit_author_name as string)?.trim() || 'VERA'
  const commit_author_email = (input.commit_author_email as string)?.trim() || 'vera@innovareai.com'
  const webhook_url = (input.webhook_url as string)?.trim() || null
  const github_pat = input.github_pat as string

  if (!org_id || !name || !repo || !github_pat) {
    return { ok: false, error: typed('validation_failed',
      'Missing required fields.', 'org_id, name, repo, github_pat all required.') }
  }
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) {
    return { ok: false, error: typed('validation_failed',
      'Repo must be in "owner/repo" format.', 'e.g. "innovareai/blog"') }
  }
  if (!['mdx', 'md', 'markdown'].includes(file_format.toLowerCase())) {
    return { ok: false, error: typed('validation_failed',
      `File format "${file_format}" not supported.`, 'Use mdx or md.') }
  }

  // Probe the repo
  const repoRes = await ghFetch(`${GH_API}/repos/${repo}`, github_pat)
  if (repoRes.status === 401 || repoRes.status === 403) {
    return { ok: false, error: typed('auth_invalid',
      'GitHub rejected the personal access token.',
      'Generate a new fine-grained PAT with Contents: Read+Write access on the target repo.') }
  }
  if (repoRes.status === 404) {
    return { ok: false, error: typed('target_not_found',
      `Repository ${repo} not found, or the PAT can\'t see it.`,
      'Check the repo name and confirm the PAT has access (private repos require explicit scope).') }
  }
  if (repoRes.status < 200 || repoRes.status >= 300) {
    return { ok: false, error: typed('unknown_error',
      `GitHub returned HTTP ${repoRes.status}.`, 'Try again, or check GitHub status.') }
  }

  const repoData = repoRes.json as { default_branch?: string; permissions?: { push?: boolean } }
  if (repoData.permissions && !repoData.permissions.push) {
    return { ok: false, error: typed('permission_denied',
      'PAT can see the repo but doesn\'t have push access.',
      'Update the PAT scopes to include Contents: Read+Write on this repo.') }
  }

  // Verify branch exists
  const branchRes = await ghFetch(`${GH_API}/repos/${repo}/branches/${encodeURIComponent(branch)}`, github_pat)
  if (branchRes.status === 404) {
    return { ok: false, error: typed('target_not_found',
      `Branch "${branch}" doesn\'t exist on ${repo}.`,
      `Confirm the branch name. Default for this repo is "${repoData.default_branch ?? 'main'}".`) }
  }

  // Save publisher row + Vault creds
  const { data: pub, error: insErr } = await supabase.from('publishers').insert({
    org_id, project_id: client_project_id, kind: 'github_mdx', name,
    config: {
      repo, branch, content_dir, file_format: file_format.toLowerCase(),
      pr_mode, commit_author_name, commit_author_email,
      default_branch: repoData.default_branch ?? 'main',
      webhook_url,
    },
    credentials_ref: 'pending',
    default_status: 'published',  // git-backed = published as soon as the build deploys
    health_status: 'healthy',
    health_detail: `Connected to ${repo}@${branch}`,
    last_health_check: new Date().toISOString(),
  }).select('id').single()
  if (insErr || !pub) {
    return { ok: false, error: typed('unknown_error', `Save failed: ${insErr?.message}`, 'Try again.') }
  }
  const { error: secretErr } = await supabase.rpc('set_publisher_credentials', {
    p_id: pub.id, p_creds: { github_pat },
  })
  if (secretErr) {
    await supabase.from('publishers').delete().eq('id', pub.id)
    return { ok: false, error: typed('unknown_error', `Credential save failed: ${secretErr.message}`, 'Try again.') }
  }

  return {
    ok: true, publisher_id: pub.id as string,
    health: { ok: true, status: 'healthy', detail: `Connected to ${repo}@${branch}`, checked_at: new Date().toISOString() },
  }
}

// ─── health_check ───────────────────────────────────────────────────────────
async function health_check(supabase: AdminClient, input: Record<string, unknown>): Promise<HealthCheckResult> {
  const publisher_id = input.publisher_id as string
  const { config, creds } = await loadPublisher(supabase, publisher_id)
  const res = await ghFetch(`${GH_API}/repos/${config.repo}/branches/${encodeURIComponent(config.branch as string)}`, creds.github_pat)
  const checked_at = new Date().toISOString()
  if (res.status === 200) {
    await updateHealth(supabase, publisher_id, 'healthy', null)
    return { ok: true, status: 'healthy', checked_at }
  }
  if (res.status === 401 || res.status === 403) {
    await updateHealth(supabase, publisher_id, 'stale', 'PAT rejected')
    return { ok: false, status: 'stale', detail: 'GitHub token rejected — likely revoked or expired', checked_at }
  }
  if (res.status === 404) {
    await updateHealth(supabase, publisher_id, 'stale', `Repo or branch missing`)
    return { ok: false, status: 'stale', detail: 'Repo or branch no longer exists', checked_at }
  }
  await updateHealth(supabase, publisher_id, 'unknown', `HTTP ${res.status}`)
  return { ok: false, status: 'unknown', detail: `HTTP ${res.status}`, checked_at }
}

// ─── dry_run ────────────────────────────────────────────────────────────────
async function dry_run(supabase: AdminClient, input: Record<string, unknown>): Promise<DryRunResult> {
  const publisher_id = input.publisher_id as string
  const post = input.post as PostInput
  const { config, creds } = await loadPublisher(supabase, publisher_id)
  const slug = post.slug?.trim() || slugify(post.title)
  const path = `${config.content_dir}/${slug}.${config.file_format}`.replace(/\/+/g, '/')

  // Check if the file already exists on the branch
  const collisionRes = await ghFetch(
    `${GH_API}/repos/${config.repo}/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(config.branch as string)}`,
    creds.github_pat,
  )
  const warnings: string[] = []
  let final_slug = slug
  if (collisionRes.status === 200) {
    // File exists — suffix until clear
    for (let i = 2; i <= 10; i++) {
      const candidate = `${slug}-${i}`
      const r = await ghFetch(
        `${GH_API}/repos/${config.repo}/contents/${encodeURIComponent(`${config.content_dir}/${candidate}.${config.file_format}`)}?ref=${encodeURIComponent(config.branch as string)}`,
        creds.github_pat,
      )
      if (r.status === 404) { final_slug = candidate; break }
    }
    warnings.push(`File ${path} already exists in the repo. Will commit as "${final_slug}.${config.file_format}".`)
  }

  const mdxContent = renderMdxWithFrontmatter(post, final_slug)
  return {
    ok: true,
    preview: {
      rendered_html: mdxContent,  // for git-publish we preview the file contents, not HTML
      final_slug,
      target_categories: post.categories ?? [],
      target_tags: post.tags ?? [],
      image_will_upload: false,
      will_create_taxonomies: { categories: [], tags: [] },
      scheduled_at_utc: post.scheduled_at ?? null,
      scheduled_at_target_tz: post.scheduled_at ?? null,
    },
    warnings: [
      ...warnings,
      config.pr_mode
        ? 'PR mode: file commits to a feature branch + opens a PR. Merge it to deploy.'
        : `Direct push: file commits to ${config.branch}. Site will rebuild automatically.`,
    ],
  }
}

// ─── publish ────────────────────────────────────────────────────────────────
async function publish(supabase: AdminClient, input: Record<string, unknown>): Promise<PublishResult> {
  const publisher_id = input.publisher_id as string
  const post = input.post as PostInput
  const idempotency_key = input.idempotency_key as string
  const post_id = (input.post_id as string | undefined) ?? null
  const t0 = Date.now()

  if (!idempotency_key) {
    return { ok: false, attempt_id: '', latency_ms: 0, error: typed('validation_failed', 'idempotency_key required.', '') }
  }

  if (!post_id) {
    return { ok: false, attempt_id: '', latency_ms: 0, error: typed('validation_failed', 'post_id required.', 'Publish actions must target a content post.') }
  }

  const { data: prior } = await supabase.from('publish_attempts')
    .select('id, outcome, remote_id, remote_url')
    .eq('idempotency_key', idempotency_key).eq('phase', 'publish').maybeSingle()
  if (prior && prior.outcome === 'success') {
    return { ok: true, remote_id: prior.remote_id as string | undefined, remote_url: prior.remote_url as string | undefined,
      attempt_id: prior.id as string, latency_ms: Date.now() - t0, verified: true }
  }

  const publishLock = await acquirePublishLockForOpenPost(supabase, post_id, publisher_id, null)
  if (!publishLock.ok) {
    return { ok: false, attempt_id: '', latency_ms: Date.now() - t0, error: typed('validation_failed',
      publishLock.message, publishLock.recoveryAction) }
  }

  const publishClaim = await claimPublish(supabase, publishLock.post, 'git', `git-publish:${publisher_id}`)
  if (!publishClaim.ok) {
    await releasePublishLock(supabase, post_id, publisher_id)
    return { ok: false, attempt_id: '', latency_ms: Date.now() - t0, error: typed('validation_failed',
      publishClaim.message,
      'Refresh the post detail page before retrying.') }
  }
  let publishClaimCompleted = false

  try {
    const { config, creds, org_id } = await loadPublisher(supabase, publisher_id)
    const repo = config.repo as string
    const branch = config.branch as string
    const content_dir = config.content_dir as string
    const file_format = config.file_format as string
    const pr_mode = !!config.pr_mode
    const author = { name: config.commit_author_name, email: config.commit_author_email }
    const webhook_url = config.webhook_url as string | null

    const slug = post.slug?.trim() || slugify(post.title)
    const path = `${content_dir}/${slug}.${file_format}`.replace(/\/+/g, '/')
    const fileContent = renderMdxWithFrontmatter(post, slug)
    const b64Content = btoa(unescape(encodeURIComponent(fileContent)))

    const { data: attempt } = await supabase.from('publish_attempts').insert({
      org_id, post_id, publisher_id, idempotency_key,
      phase: 'publish', outcome: 'in_progress',
      request_payload: { repo, branch, path, pr_mode, body_chars: fileContent.length },
    }).select('id').single()
    const attempt_id = attempt?.id as string

    let target_branch = branch
    if (pr_mode) {
      // Create a feature branch off the target
      const featureBranch = `vera/${slug}-${Date.now().toString(36).slice(-6)}`
      const refRes = await ghFetch(`${GH_API}/repos/${repo}/git/refs/heads/${encodeURIComponent(branch)}`, creds.github_pat)
      if (refRes.status !== 200) {
        await markAttempt(supabase, attempt_id, 'failed', 'target_not_found',
          `Couldn\'t read base branch ${branch}.`, 'Confirm the branch still exists.')
        return { ok: false, attempt_id, latency_ms: Date.now() - t0, error: typed('target_not_found',
          'Base branch missing.', 'Check git-publish settings.') }
      }
      const sha = (refRes.json as { object?: { sha: string } })?.object?.sha
      const newRefRes = await ghFetch(`${GH_API}/repos/${repo}/git/refs`, creds.github_pat, {
        method: 'POST',
        body: JSON.stringify({ ref: `refs/heads/${featureBranch}`, sha }),
      })
      if (newRefRes.status < 200 || newRefRes.status >= 300) {
        await markAttempt(supabase, attempt_id, 'failed', 'unknown_error',
          `Branch creation HTTP ${newRefRes.status}.`, 'Try direct-push mode if PRs are blocked.')
        return { ok: false, attempt_id, latency_ms: Date.now() - t0, error: typed('unknown_error',
          `Couldn\'t create feature branch.`, 'Direct push mode might work better here.') }
      }
      target_branch = featureBranch
    }

    // PUT the file
    const putRes = await ghFetch(
      `${GH_API}/repos/${repo}/contents/${encodeURIComponent(path)}`,
      creds.github_pat,
      {
        method: 'PUT',
        body: JSON.stringify({
          message: `Publish: ${post.title}`,
          content: b64Content,
          branch: target_branch,
          author, committer: author,
        }),
      },
    )

    if (putRes.status === 429) {
      await markAttempt(supabase, attempt_id, 'failed', 'rate_limited', 'GitHub rate-limited.', 'Wait and retry.')
      return { ok: false, attempt_id, latency_ms: Date.now() - t0, error: typed('rate_limited',
        'GitHub rate-limited the commit.', 'Wait a few minutes.') }
    }
    if (putRes.status === 401 || putRes.status === 403) {
      await markAttempt(supabase, attempt_id, 'failed', 'auth_expired', 'PAT rejected mid-publish.', 'Reconnect.')
      return { ok: false, attempt_id, latency_ms: Date.now() - t0, error: typed('auth_expired',
        'GitHub PAT rejected.', 'Reconnect from Settings → Integrations.') }
    }
    if (putRes.status === 422) {
      await markAttempt(supabase, attempt_id, 'failed', 'slug_collision',
        'File already exists with different content.',
        'Rerun dry_run; the slug-collision logic should suffix automatically.')
      return { ok: false, attempt_id, latency_ms: Date.now() - t0, error: typed('slug_collision',
        'A file with this name already exists.', 'Refresh and re-publish.') }
    }
    if (putRes.status < 200 || putRes.status >= 300) {
      await markAttempt(supabase, attempt_id, 'failed', 'unknown_error',
        `GitHub returned HTTP ${putRes.status}.`, 'Check the audit response_body.')
      return { ok: false, attempt_id, latency_ms: Date.now() - t0, error: typed('unknown_error',
        `HTTP ${putRes.status}`, 'Check the audit log.') }
    }

    const created = putRes.json as { content?: { html_url?: string; sha?: string; path?: string } }
    let remote_url = created.content?.html_url
    let remote_id = created.content?.sha

    // PR mode: open a PR after commit
    if (pr_mode && target_branch !== branch) {
      const prRes = await ghFetch(`${GH_API}/repos/${repo}/pulls`, creds.github_pat, {
        method: 'POST',
        body: JSON.stringify({
          title: `Publish: ${post.title}`,
          head: target_branch,
          base: branch,
          body: `Auto-generated by VERA from a content draft. Merge to deploy.\n\n**Slug:** \`${slug}\`\n**Path:** \`${path}\``,
        }),
      })
      if (prRes.status >= 200 && prRes.status < 300) {
        const pr = prRes.json as { html_url?: string; number?: number }
        remote_url = pr.html_url ?? remote_url
        remote_id = pr.number !== undefined ? String(pr.number) : remote_id
      }
    }

    // Optional explicit build hook fire (Vercel/Netlify)
    if (webhook_url) {
      fetch(webhook_url, { method: 'POST', signal: AbortSignal.timeout(5_000) }).catch(() => {})
    }

    await completePublishClaim(supabase, publishLock.post, remote_id, remote_url)
    publishClaimCompleted = true

    await markAttempt(supabase, attempt_id, 'success', null, null, null, {
      remote_id, remote_url: remote_url ?? null,
      response_body: { path, branch: target_branch, sha: created.content?.sha },
    })

    return { ok: true, remote_id, remote_url, verified: true, attempt_id, latency_ms: Date.now() - t0 }
  } finally {
    if (!publishClaimCompleted) {
      await releasePublishClaim(supabase, post_id, 'git publish did not complete')
    }
    await releasePublishLock(supabase, post_id, publisher_id)
  }
}

// ─── verify ─────────────────────────────────────────────────────────────────
async function verify(supabase: AdminClient, input: Record<string, unknown>): Promise<VerifyResult> {
  const publisher_id = input.publisher_id as string
  const remote_id = input.remote_id as string  // SHA or PR number
  const { config, creds } = await loadPublisher(supabase, publisher_id)
  // For git-publish, "verified" = file exists at the expected path. We can't
  // actually know if the deploy succeeded without polling Vercel/Netlify APIs
  // — that's a polish pass.
  // If remote_id looks like a SHA, fetch the blob; if a PR number, check the PR.
  if (/^\d+$/.test(remote_id)) {
    const prRes = await ghFetch(`${GH_API}/repos/${config.repo}/pulls/${remote_id}`, creds.github_pat)
    if (prRes.status === 404) return { ok: false, status: 'missing', detail: 'PR was closed/deleted' }
    if (prRes.status !== 200) return { ok: false, status: 'missing', detail: `HTTP ${prRes.status}` }
    const pr = prRes.json as { state?: string; merged?: boolean; html_url?: string }
    return {
      ok: true,
      status: pr.merged ? 'published' : (pr.state === 'open' ? 'draft' : 'missing'),
      remote_url: pr.html_url,
    }
  }
  return { ok: true, status: 'published', detail: 'File committed; deploy status not polled' }
}

// ─── unpublish ──────────────────────────────────────────────────────────────
async function unpublish(supabase: AdminClient, input: Record<string, unknown>): Promise<UnpublishResult> {
  // For git-publish, "unpublish" = delete the file via DELETE Contents API.
  // The next deploy will remove the post from the live site.
  const publisher_id = input.publisher_id as string
  const remote_id = input.remote_id as string  // SHA at publish time
  const path = input.path as string | undefined  // pass the path if known
  const { config, creds } = await loadPublisher(supabase, publisher_id)
  if (!path) {
    return { ok: false, error: typed('validation_failed',
      'Path required for git-publish unpublish.', 'Pass the file path that was published.') }
  }
  const res = await ghFetch(`${GH_API}/repos/${config.repo}/contents/${encodeURIComponent(path)}`, creds.github_pat, {
    method: 'DELETE',
    body: JSON.stringify({
      message: `Unpublish: ${path}`,
      sha: remote_id,
      branch: config.branch,
      author: { name: config.commit_author_name, email: config.commit_author_email },
    }),
  })
  if (res.status < 200 || res.status >= 300) {
    return { ok: false, error: typed('unknown_error', `Delete returned HTTP ${res.status}.`, 'Check PAT scopes and that the SHA is current.') }
  }
  return { ok: true }
}

// ─── helpers ────────────────────────────────────────────────────────────────
async function loadPublisher(supabase: AdminClient, publisher_id: string):
Promise<{ config: Record<string, unknown>; creds: { github_pat: string }; org_id: string }> {
  const { data: pub } = await supabase.from('publishers').select('config, org_id').eq('id', publisher_id).maybeSingle()
  if (!pub) throw new Error(`publisher ${publisher_id} not found`)
  const { data: creds } = await supabase.rpc('get_publisher_credentials', { p_id: publisher_id })
  if (!creds) throw new Error('credentials missing')
  return { config: pub.config as Record<string, unknown>, creds: creds as { github_pat: string }, org_id: pub.org_id as string }
}

async function updateHealth(supabase: AdminClient, id: string, status: 'healthy' | 'stale' | 'unknown', detail: string | null): Promise<void> {
  await supabase.from('publishers').update({
    health_status: status, health_detail: detail, last_health_check: new Date().toISOString(),
  }).eq('id', id)
}

async function markAttempt(supabase: AdminClient, attempt_id: string,
  outcome: 'success' | 'failed', error_code: string | null, error_message: string | null,
  recovery_action: string | null, extras?: Record<string, unknown>): Promise<void> {
  await supabase.from('publish_attempts').update({
    outcome, error_code, error_message, recovery_action,
    completed_at: new Date().toISOString(), ...(extras ?? {}),
  }).eq('id', attempt_id)
}

function renderMdxWithFrontmatter(post: PostInput, slug: string): string {
  const fm: string[] = ['---']
  fm.push(`title: ${quote(post.title)}`)
  if (post.excerpt) fm.push(`excerpt: ${quote(post.excerpt)}`)
  fm.push(`slug: ${slug}`)
  fm.push(`date: ${post.scheduled_at ?? new Date().toISOString()}`)
  if (post.featured_image_url) fm.push(`featured_image: ${quote(post.featured_image_url)}`)
  if (post.categories?.length) fm.push(`categories:\n${post.categories.map(c => `  - ${quote(c)}`).join('\n')}`)
  if (post.tags?.length) fm.push(`tags:\n${post.tags.map(t => `  - ${quote(t)}`).join('\n')}`)
  if (post.status) fm.push(`draft: ${post.status === 'draft'}`)
  fm.push('---')
  return `${fm.join('\n')}\n\n${post.body_md}\n`
}

function quote(s: string): string {
  // Always quote — keeps YAML happy with special chars
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

interface GhRes { status: number; json: unknown; headers: Record<string, string> }

async function ghFetch(url: string, token: string, opts: { method?: string; body?: string } = {}): Promise<GhRes> {
  try {
    const res = await fetch(url, {
      method: opts.method ?? 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'VERA-git-publish/1.0',
        'Content-Type': 'application/json',
      },
      body: opts.body,
      signal: AbortSignal.timeout(15_000),
    })
    const headers: Record<string, string> = {}
    res.headers.forEach((v, k) => { headers[k.toLowerCase()] = v })
    let bodyJson: unknown = null
    try {
      const ct = res.headers.get('content-type') ?? ''
      bodyJson = ct.includes('json') ? await res.json() : await res.text()
    } catch { /* leave null */ }
    return { status: res.status, json: bodyJson, headers }
  } catch (e) {
    console.warn('ghFetch error', url, e)
    return { status: 0, json: null, headers: {} }
  }
}

function typed(code: PublisherError['code'], message: string, recovery_action: string): PublisherError {
  return { code, message, recovery_action }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}
