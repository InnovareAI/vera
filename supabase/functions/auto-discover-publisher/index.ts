// Zero-friction publisher discovery.
//
// Operator pastes a URL. We auto-discover EVERYTHING we can from public
// signals — platform, site title, REST API endpoint, public categories
// and tags (where unauthenticated probes work), GitHub repo (when the
// site exposes "Edit this page" / source links), default branch, content
// folder.
//
// The wizard then shows a single summary screen + asks for ONLY the
// credential the platform requires (Application Password, Admin API Key,
// or GitHub PAT). Every other field is pre-filled.
//
// POST { url } → {
//   platform: 'wordpress' | 'ghost' | 'github_mdx' | 'webflow' | ...,
//   recommended_path: 'cms_direct' | 'headless_cms' | 'git_backed' | 'manual_paste',
//   confidence: 0-1,
//   hint: {
//     connection_name: "string",           // from OG title / meta
//     base_url: "string",                   // normalized
//     api_endpoint?: "string",              // platform-specific
//     // platform-specific extras:
//     wp_categories?: string[],
//     wp_tags?: string[],
//     repo?: "owner/name",                  // when sniffed from HTML
//     branch?: "main",
//     content_dir?: "docs",
//   },
//   credential_needed: { kind, label, hint, format_example },
// }

import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'npm:@supabase/supabase-js'
import { requireSignedInOrService } from '../_shared/auth.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY)
  const auth = await requireSignedInOrService(req, supabase, SERVICE_KEY, corsHeaders)
  if (!auth.ok) return auth.response

  const { url: rawUrl } = await req.json().catch(() => ({}))
  if (!rawUrl || typeof rawUrl !== 'string') {
    return json({ error: 'url required' }, 400)
  }

  let url: URL
  try {
    url = new URL(/^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`)
  } catch {
    return json({ error: 'invalid URL' }, 400)
  }

  // Step 0: try the URL as pasted. If detection returns 'unknown' / low
  // confidence on a host-root URL (e.g. example.com custom marketing
  // site while the blog is at example.com/blog or blog.example.com),
  // probe common blog locations and re-detect against the best hit.
  const original_url = url.toString()
  url = await sniffBetterBlogUrl(url) ?? url

  // Step 1: Run the existing 3-layer detection
  const detectRes = await fetch(`${SUPABASE_URL}/functions/v1/detect-cms`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': req.headers.get('Authorization') ?? '',
      'apikey': req.headers.get('apikey') ?? '',
    },
    body: JSON.stringify({ url: url.toString() }),
  })
  if (!detectRes.ok) {
    return json({ error: 'detect-cms failed', status: detectRes.status }, 502)
  }
  const detection = await detectRes.json() as DetectionResponse

  // Step 2: Fetch homepage HTML for platform-specific signal extraction.
  // Cheaper than re-doing detect-cms's work — we just need the raw HTML.
  const homepageHtml = await fetchText(url.toString())

  // Step 3: Extract universal hints (title, description, suggested name)
  const connection_name = sniffSiteTitle(homepageHtml ?? '', url) ?? 'Main blog'
  const base_url = `${url.protocol}//${url.host}`

  // Step 4: Platform-specific public discovery
  let hint: Record<string, unknown> = { connection_name, base_url }
  let credential_needed: CredentialPrompt | null
  let platform: string = detection.detected_cms

  if (detection.detected_cms === 'wordpress') {
    hint = await discoverWordPress(base_url, hint)
    credential_needed = {
      kind: 'wordpress',
      label: 'Application Password',
      hint: 'Generate in WP Admin → Users → Profile → Application Passwords. You also need your WordPress username.',
      fields: [
        { name: 'username', label: 'WordPress username', type: 'text',
          placeholder: 'your-wp-username', note: 'The username, not your email.' },
        { name: 'app_password', label: 'Application Password', type: 'password',
          placeholder: 'xxxx xxxx xxxx xxxx xxxx xxxx', note: 'Copy exactly — spaces are fine.' },
      ],
    }
  } else if (detection.detected_cms === 'ghost') {
    hint.api_endpoint = `${base_url}/ghost/api/admin/`
    credential_needed = {
      kind: 'ghost',
      label: 'Admin API Key',
      hint: 'Generate in Ghost Admin → Integrations → Add custom integration → Admin API Key.',
      fields: [
        { name: 'api_key', label: 'Admin API Key', type: 'password',
          placeholder: '<24-char id>:<64-char secret>', note: 'Format is id:secret — copy exactly.' },
      ],
    }
  } else if (detection.detected_cms === 'webflow') {
    credential_needed = {
      kind: 'webflow',
      label: 'Webflow API Token + Site/Collection IDs',
      hint: 'Generate the token in Webflow → Site Settings → Apps & Integrations → Generate API Token. Site ID is in the Designer URL; Collection ID is in the CMS Collections list.',
      fields: [
        { name: 'site_id', label: 'Site ID', type: 'text', placeholder: '67890abcdef1234567890ab', note: 'Find in Webflow Designer URL or via API /sites.' },
        { name: 'collection_id', label: 'Collection ID', type: 'text', placeholder: '67890abcdef1234567890cd', note: 'The "Blog Posts" collection ID from Webflow CMS.' },
        { name: 'token', label: 'Webflow API Token', type: 'password', placeholder: '...', note: 'Site Settings → Apps & Integrations → Generate API Token.' },
      ],
    }
  } else if (detection.detected_cms === 'contentful') {
    credential_needed = {
      kind: 'contentful',
      label: 'Contentful CMA Token + Space/Content Type',
      hint: 'Generate a Personal Access Token at Contentful → Settings → API keys → Personal Access Tokens. Space ID is at Settings → General settings.',
      fields: [
        { name: 'space_id', label: 'Space ID', type: 'text', placeholder: 'abc12345xyz', note: 'Contentful → Settings → General.' },
        { name: 'environment_id', label: 'Environment', type: 'text', placeholder: 'master', note: 'Default: master.' },
        { name: 'content_type_id', label: 'Content type ID', type: 'text', placeholder: 'blogPost', note: 'The content model for blog posts (e.g. blogPost, post, article).' },
        { name: 'token', label: 'CMA Personal Access Token', type: 'password', placeholder: '...', note: 'Settings → API keys → Personal Access Tokens.' },
      ],
    }
  } else if (detection.detected_cms === 'hubspot') {
    credential_needed = {
      kind: 'hubspot',
      label: 'HubSpot Private App Token + Blog ID',
      hint: 'Generate a Private App token in HubSpot → Settings → Integrations → Private Apps with scopes: cms.blogs.posts (read + write + publish).',
      fields: [
        { name: 'access_token', label: 'Private App Access Token', type: 'password',
          placeholder: 'pat-na1-...', note: 'From Private Apps page → your app → Auth tab.' },
        { name: 'content_group_id', label: 'Blog ID (contentGroupId)', type: 'text',
          placeholder: '123456789', note: 'Numeric ID of the blog. After entering the token, the connector will list available blogs.' },
      ],
    }
  } else if (detection.detected_cms === 'sanity') {
    credential_needed = {
      kind: 'sanity',
      label: 'Sanity Project + Dataset + Write Token',
      hint: 'Generate a write-scoped robot token at sanity.io/manage → your project → API → Tokens.',
      fields: [
        { name: 'project_id', label: 'Project ID', type: 'text', placeholder: '10-char id', note: 'Find at sanity.io/manage.' },
        { name: 'dataset', label: 'Dataset', type: 'text', placeholder: 'production', note: 'Default: production.' },
        { name: 'document_type', label: 'Document type', type: 'text', placeholder: 'post', note: 'Schema type for blog posts (e.g. post, article).' },
        { name: 'token', label: 'Sanity Token (write scope)', type: 'password', placeholder: '...', note: 'sanity.io/manage → API → Tokens.' },
      ],
    }
  } else if (detection.recommended_path === 'git_backed') {
    platform = 'github_mdx'
    hint = await discoverGitBacked(base_url, homepageHtml ?? '', hint)
    credential_needed = {
      kind: 'github_mdx',
      label: 'GitHub Personal Access Token',
      hint: hint.repo
        ? `We sniffed the repo as ${hint.repo}. Confirm or change below, then provide a fine-grained PAT with Contents: Read+Write.`
        : 'We couldn\'t auto-detect the repo. Add the GitHub repo (owner/name) and a fine-grained PAT with Contents: Read+Write.',
      fields: [
        ...(hint.repo ? [] : [
          { name: 'repo', label: 'GitHub repo', type: 'text',
            placeholder: 'owner/repo-name', note: 'Where your blog content lives.' },
        ]),
        { name: 'github_pat', label: 'Personal Access Token', type: 'password',
          placeholder: 'github_pat_...', note: 'Fine-grained PAT with Contents: Read+Write on this repo.' },
      ],
    }
  } else {
    // Unknown / coming-soon platform
    return json({
      platform,
      recommended_path: detection.recommended_path,
      confidence: detection.cms_confidence,
      hint,
      credential_needed: null,
      message: detection.recommendation_reason,
    })
  }

  return json({
    platform,
    recommended_path: detection.recommended_path,
    confidence: Math.max(detection.cms_confidence, detection.hosting_confidence, detection.ssg_confidence),
    detection_summary: detection.recommendation_reason,
    detected_cms: detection.detected_cms,
    detected_hosting: detection.detected_hosting,
    detected_ssg: detection.detected_ssg,
    original_url,
    sniffed_blog_url: url.toString() !== original_url ? url.toString() : null,
    hint,
    credential_needed,
  })
})

// Probe common blog subpaths + subdomains. Returns a better URL when a
// candidate has STRONGER CMS signal than what the operator pasted.
//
// Fires only when the operator pasted a host-root-ish URL (no specific
// path). If they pasted `acme.com/blog/some-post` they know what they
// want — we don't second-guess. If they pasted `acme.com`, we probe.
//
// Scoring approach: each candidate gets a numeric "CMS-likeliness" score
// based on multiple signals. We pick the candidate (including the
// operator's original URL) with the highest score, and only override if
// a candidate scores meaningfully higher than the original.
async function sniffBetterBlogUrl(url: URL): Promise<URL | null> {
  const path = url.pathname.replace(/\/+$/, '')
  if (path && path !== '' && !/^\/(home|about|index|index\.html?)$/i.test(path)) {
    return null
  }

  const originalScore = (await scoreCmsLikeliness(url.toString())).score

  const candidates: string[] = [
    `${url.origin}/blog`,
    `${url.origin}/blog/`,
    `${url.origin}/posts`,
    `${url.origin}/articles`,
    `${url.origin}/insights`,
    `${url.origin}/resources`,
    `${url.origin}/news`,
    `${url.origin}/learn`,
    `${url.protocol}//blog.${stripWww(url.hostname)}`,
    `${url.protocol}//news.${stripWww(url.hostname)}`,
    `${url.protocol}//insights.${stripWww(url.hostname)}`,
  ]

  let bestScore = originalScore
  let bestUrl: string | null = null
  for (const candidate of candidates) {
    const { score } = await scoreCmsLikeliness(candidate)
    // Require the candidate to score meaningfully higher (gap > 1) to
    // avoid noisy ties when the marketing site has incidental CMS signals
    // (e.g. uses Contentful for marketing-page images).
    if (score >= bestScore + 2) {
      bestScore = score
      bestUrl = candidate
    }
  }
  return bestUrl ? (() => { try { return new URL(bestUrl) } catch { return null } })() : null
}

// Higher score = more likely to be a real CMS-backed blog/content page.
// - Strong CMS meta-generator: +3
// - WordPress-specific paths: +3
// - Ghost-specific paths: +3
// - Multiple article links: +2 (a blog index has many post links)
// - Just CMS CDN images: +1 (could be a marketing page incidentally using a CMS for assets)
// - Non-OK response: 0
async function scoreCmsLikeliness(url: string): Promise<{ score: number }> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'VERA-auto-discover/1.0' },
      signal: AbortSignal.timeout(6_000),
      redirect: 'follow',
    })
    if (!res.ok) return { score: 0 }
    const ct = res.headers.get('content-type') ?? ''
    if (!ct.includes('html') && !ct.includes('text')) return { score: 0 }
    const html = (await res.text()).slice(0, 100_000)
    let score = 0
    if (/<meta[^>]*name=["']generator["'][^>]*content=["'][^"']*(wordpress|ghost|webflow|hubspot|squarespace|wix|framer|drupal)/i.test(html)) score += 3
    if (/\/wp-(content|json|includes)\//i.test(html)) score += 3
    if (/\/ghost\/(api|content)\//i.test(html)) score += 3
    // Article-list signal: many <article> tags or many links to /blog/ or /posts/
    const articleTagCount = (html.match(/<article\b/gi) ?? []).length
    if (articleTagCount >= 3) score += 2
    const blogLinkCount = (html.match(/href=["'][^"']*\/(blog|posts|articles|insights)\/[^"']+["']/gi) ?? []).length
    if (blogLinkCount >= 5) score += 2
    if (/(cdn\.sanity\.io|images\.ctfassets\.net|cdn\.prod\.website-files\.com)/i.test(html)) score += 1
    return { score }
  } catch {
    return { score: 0 }
  }
}

function stripWww(hostname: string): string {
  return hostname.replace(/^www\./, '')
}

// ─── WordPress public discovery ────────────────────────────────────────────
// Public REST endpoints work without auth for category/tag listings. We sniff
// them to pre-fill the operator's options.
async function discoverWordPress(base_url: string, hint: Record<string, unknown>): Promise<Record<string, unknown>> {
  hint.api_endpoint = `${base_url}/wp-json/wp/v2`

  const [catRes, tagRes] = await Promise.all([
    fetchJson(`${base_url}/wp-json/wp/v2/categories?per_page=100&_fields=id,name,slug`),
    fetchJson(`${base_url}/wp-json/wp/v2/tags?per_page=50&_fields=id,name,slug`),
  ])

  if (Array.isArray(catRes)) {
    hint.wp_categories = (catRes as Array<{ name?: string }>).map(c => c.name).filter(Boolean).slice(0, 30)
  }
  if (Array.isArray(tagRes)) {
    hint.wp_tags = (tagRes as Array<{ name?: string }>).map(t => t.name).filter(Boolean).slice(0, 30)
  }
  return hint
}

// ─── Git-backed discovery ──────────────────────────────────────────────────
// Sniff GitHub repo URLs from HTML: "Edit this page", "Source", footer, etc.
// Common patterns:
//   Docusaurus / Nextra: github.com/owner/repo/edit/<branch>/<content_dir>/<path>.mdx
//   Generic footers: github.com/owner/repo
async function discoverGitBacked(base_url: string, html: string, hint: Record<string, unknown>): Promise<Record<string, unknown>> {
  // Pattern 1: edit/branch/path links (highest confidence — gives us repo + branch + content_dir)
  const editMatch = html.match(/github\.com\/([\w.-]+)\/([\w.-]+)\/edit\/([\w.-]+)\/([\w/.-]+)/i)
  if (editMatch) {
    hint.repo = `${editMatch[1]}/${editMatch[2]}`
    hint.branch = editMatch[3]
    // Extract the content_dir from the path (drop the filename)
    const pathParts = editMatch[4].split('/')
    pathParts.pop()  // drop the file
    if (pathParts.length) hint.content_dir = pathParts.join('/')
    hint.file_format = editMatch[4].endsWith('.mdx') ? 'mdx' : 'md'
    hint.sniff_source = 'edit-this-page link'
    return hint
  }

  // Pattern 2: blob/branch/path links (same shape, different verb)
  const blobMatch = html.match(/github\.com\/([\w.-]+)\/([\w.-]+)\/blob\/([\w.-]+)\/([\w/.-]+)/i)
  if (blobMatch) {
    hint.repo = `${blobMatch[1]}/${blobMatch[2]}`
    hint.branch = blobMatch[3]
    const pathParts = blobMatch[4].split('/')
    pathParts.pop()
    if (pathParts.length) hint.content_dir = pathParts.join('/')
    hint.file_format = blobMatch[4].endsWith('.mdx') ? 'mdx' : 'md'
    hint.sniff_source = 'blob link'
    return hint
  }

  // Pattern 3: plain github.com/owner/repo link in HTML (lower confidence —
  // only the repo, no branch/content_dir hints)
  const repoMatch = html.match(/github\.com\/([\w.-]+)\/([\w.-]+)(?:["'\s/]|$)/i)
  if (repoMatch && !['orgs', 'features', 'topics', 'sponsors', 'github', 'about', 'enterprise'].includes(repoMatch[1].toLowerCase())) {
    hint.repo = `${repoMatch[1]}/${repoMatch[2].replace(/[#?].*$/, '')}`
    hint.branch = 'main'
    hint.content_dir = 'content/blog'  // common default
    hint.file_format = 'mdx'
    hint.sniff_source = 'footer/nav link'
    return hint
  }

  // No sniff hits — leave the operator to provide repo manually
  hint.branch = 'main'
  hint.content_dir = 'content/blog'
  hint.file_format = 'mdx'
  return hint
}

// ─── Site title extraction ─────────────────────────────────────────────────
// Prefers OG title (cleanest), falls back to <title>, then to the hostname.
function sniffSiteTitle(html: string, url: URL): string | null {
  const ogTitle = html.match(/<meta[^>]*property=["']og:site_name["'][^>]*content=["']([^"']+)["']/i)?.[1]
    ?? html.match(/<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i)?.[1]
  if (ogTitle?.trim()) return ogTitle.trim().slice(0, 80)
  const titleTag = html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim()
  if (titleTag) {
    // Often "Blog | Brand Name" — keep the brand part
    return titleTag.split(/\s*[|·—]\s*/).pop()?.slice(0, 80) ?? titleTag.slice(0, 80)
  }
  return url.hostname.replace(/^www\./, '').split('.')[0] || null
}

// ─── HTTP helpers ──────────────────────────────────────────────────────────
async function fetchText(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'VERA-auto-discover/1.0' },
      signal: AbortSignal.timeout(8_000),
      redirect: 'follow',
    })
    if (!res.ok) return null
    const ct = res.headers.get('content-type') ?? ''
    if (!ct.includes('html') && !ct.includes('text')) return null
    return await res.text()
  } catch { return null }
}

async function fetchJson(url: string): Promise<unknown> {
  try {
    const res = await fetch(url, {
      headers: { 'Accept': 'application/json', 'User-Agent': 'VERA-auto-discover/1.0' },
      signal: AbortSignal.timeout(6_000),
      redirect: 'follow',
    })
    if (!res.ok) return null
    const ct = res.headers.get('content-type') ?? ''
    if (!ct.includes('json')) return null
    return await res.json()
  } catch { return null }
}

// ─── Types ─────────────────────────────────────────────────────────────────
interface DetectionResponse {
  detected_cms: string
  cms_confidence: number
  detected_hosting: string
  hosting_confidence: number
  detected_ssg: string
  ssg_confidence: number
  recommended_path: 'cms_direct' | 'headless_cms' | 'git_backed' | 'manual_paste'
  recommendation_reason: string
}

interface CredentialPrompt {
  kind: string
  label: string
  hint: string
  fields: Array<{
    name: string
    label: string
    type: 'text' | 'password'
    placeholder?: string
    note?: string
  }>
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
