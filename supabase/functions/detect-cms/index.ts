// CMS auto-detection. Operator pastes a blog URL; we sniff the homepage
// for platform fingerprints and return the best guess + confidence.
//
// Useful standalone (VERA can call this from chat) AND as the first step
// of the "Add a blog connection" wizard.
//
// POST { url }  →  { detected: <kind>, confidence: <0-1>, signals: [...],
//                    all_scores: { wordpress: 0.95, ghost: 0.0, ... } }
//
// Detection is best-effort. Below 0.4 confidence → "couldn't detect,
// pick manually" UX. Above 0.7 → pre-select with confirm. Between →
// surface candidates.

import 'jsr:@supabase/functions-js/edge-runtime.d.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

type CmsKind =
  | 'wordpress' | 'ghost' | 'webflow' | 'hubspot'
  | 'squarespace' | 'wix' | 'framer' | 'notion_super'
  | 'sanity' | 'contentful' | 'strapi' | 'hygraph' | 'tina'
  | 'shopify' | 'unknown'

// Hosting layer — where the site runs. Doesn't tell us how to publish
// directly, but combined with SSG detection it narrows the wizard path.
type HostingKind =
  | 'vercel' | 'netlify' | 'cloudflare_pages' | 'github_pages'
  | 'render' | 'fly' | 'aws_amplify' | 'azure_static'
  | 'unknown'

// SSG / framework — what generated the static output. Tells us whether
// a Git-backed publish flow is even feasible (Next.js MDX = yes, custom
// non-MDX React = harder).
type SsgKind =
  | 'nextjs' | 'astro' | 'hugo' | 'gatsby' | 'eleventy'
  | 'sveltekit' | 'nuxt' | 'jekyll' | 'remix' | 'docusaurus'
  | 'unknown'

// Each platform: weighted signals. A signal that hits contributes its weight
// to the platform's score. Score is clamped to 1.0 (sums above 1.0 = high
// confidence, not extra credit).
//
// Signal patterns are intentionally robust — accept variant spellings,
// minor punctuation differences, mixed case in headers.
interface Signal {
  weight: number
  // returns true if the signal hit; passes the full fetch context
  test: (ctx: FetchContext) => boolean
  label: string  // human-readable, surfaced in the UI
}

interface FetchContext {
  url: string
  html: string                            // body of homepage
  headers: Record<string, string>         // lowercased keys
  wpJsonOk: boolean
  wpJsonHasApiSig: boolean
  ghostApiAdminProbeOk: boolean
}

// Hosting layer signals (mostly response headers).
const HOSTING_SIGNATURES: Record<Exclude<HostingKind, 'unknown'>, Signal[]> = {
  vercel: [
    { weight: 0.9, label: 'x-vercel-id header', test: c => !!c.headers['x-vercel-id'] },
    { weight: 0.6, label: 'server: Vercel',     test: c => /vercel/i.test(c.headers['server'] ?? '') },
    { weight: 0.3, label: 'x-vercel-cache header', test: c => !!c.headers['x-vercel-cache'] },
  ],
  netlify: [
    { weight: 0.9, label: 'server: Netlify',    test: c => /netlify/i.test(c.headers['server'] ?? '') },
    { weight: 0.6, label: 'x-nf-request-id header', test: c => !!c.headers['x-nf-request-id'] },
  ],
  cloudflare_pages: [
    { weight: 0.8, label: 'cf-pages header',    test: c => !!c.headers['cf-pages'] },
    { weight: 0.3, label: 'cf-ray + pages-style cookies', test: c =>
      !!c.headers['cf-ray'] && /__cf_bm|cf_clearance/.test(c.headers['set-cookie'] ?? '') },
  ],
  github_pages: [
    { weight: 0.9, label: 'server: GitHub.com',  test: c => /github\.com/i.test(c.headers['server'] ?? '') },
  ],
  render: [
    { weight: 0.9, label: 'render hosting header', test: c => /render/i.test(c.headers['x-render-origin-server'] ?? '') },
  ],
  fly: [
    { weight: 0.9, label: 'fly-request-id header', test: c => !!c.headers['fly-request-id'] },
  ],
  aws_amplify: [
    { weight: 0.7, label: 'amplifyapp.com domain or x-amz-cf-id', test: c =>
      /amplifyapp\.com/.test(c.url) || !!c.headers['x-amz-cf-id'] },
  ],
  azure_static: [
    { weight: 0.7, label: 'azurestaticapps.net or x-azure-ref', test: c =>
      /azurestaticapps\.net/.test(c.url) || !!c.headers['x-azure-ref'] },
  ],
}

// SSG / framework signals.
const SSG_SIGNATURES: Record<Exclude<SsgKind, 'unknown'>, Signal[]> = {
  nextjs: [
    { weight: 0.7, label: '__next paths in HTML', test: c => /\b(__next|_next\/static)\b/.test(c.html) },
    { weight: 0.3, label: 'next/font CSS class pattern', test: c => /__next_font|--font-/.test(c.html) },
    { weight: 0.3, label: 'x-powered-by: Next.js',  test: c => /next/i.test(c.headers['x-powered-by'] ?? '') },
  ],
  astro: [
    { weight: 0.7, label: 'astro-island custom element', test: c => /<astro-island|astro-root/.test(c.html) },
    { weight: 0.5, label: '<meta name="generator" content="Astro"', test: c =>
      /<meta[^>]*name=["']generator["'][^>]*content=["'][^"']*astro/i.test(c.html) },
  ],
  hugo: [
    { weight: 0.7, label: '<meta name="generator" content="Hugo"', test: c =>
      /<meta[^>]*name=["']generator["'][^>]*content=["'][^"']*hugo/i.test(c.html) },
  ],
  gatsby: [
    { weight: 0.5, label: '<meta name="generator" content="Gatsby"', test: c =>
      /<meta[^>]*name=["']generator["'][^>]*content=["'][^"']*gatsby/i.test(c.html) },
    { weight: 0.5, label: '___gatsby div in HTML',       test: c => /id=["']___gatsby["']/.test(c.html) },
  ],
  eleventy: [
    { weight: 0.7, label: '<meta name="generator" content="Eleventy"', test: c =>
      /<meta[^>]*name=["']generator["'][^>]*content=["'][^"']*(eleventy|11ty)/i.test(c.html) },
  ],
  sveltekit: [
    { weight: 0.6, label: 'svelte-kit data attrs',  test: c => /data-sveltekit-/.test(c.html) },
  ],
  nuxt: [
    { weight: 0.6, label: '__NUXT__ runtime payload', test: c => /window\.__NUXT__|__nuxt-/.test(c.html) },
  ],
  jekyll: [
    { weight: 0.7, label: '<meta name="generator" content="Jekyll"', test: c =>
      /<meta[^>]*name=["']generator["'][^>]*content=["'][^"']*jekyll/i.test(c.html) },
  ],
  remix: [
    { weight: 0.6, label: 'remix data routing markers', test: c => /data-route=|__remix|remix:matches/.test(c.html) },
  ],
  docusaurus: [
    { weight: 0.7, label: '<meta name="generator" content="Docusaurus"', test: c =>
      /<meta[^>]*name=["']generator["'][^>]*content=["'][^"']*docusaurus/i.test(c.html) },
  ],
}

const SIGNATURES: Record<Exclude<CmsKind, 'unknown'>, Signal[]> = {
  wordpress: [
    {
      weight: 0.6, label: '<meta generator> says WordPress',
      test: c => /<meta[^>]*name=["']generator["'][^>]*content=["'][^"']*wordpress/i.test(c.html),
    },
    {
      weight: 0.4, label: '/wp-json/ responds with WP API shape',
      test: c => c.wpJsonHasApiSig,
    },
    {
      weight: 0.25, label: 'wp-content asset URLs in HTML',
      test: c => /\/wp-content\/(themes|plugins|uploads)\//.test(c.html),
    },
    {
      weight: 0.2, label: 'Link header references wp-json',
      test: c => /<[^>]*wp-json[^>]*>; rel=["']https:\/\/api\.w\.org\/["']/i.test(c.headers['link'] ?? ''),
    },
    {
      weight: 0.15, label: 'wp-includes referenced in HTML',
      test: c => /\/wp-includes\//.test(c.html),
    },
  ],
  ghost: [
    {
      weight: 0.6, label: '<meta generator> says Ghost',
      test: c => /<meta[^>]*name=["']generator["'][^>]*content=["'][^"']*ghost/i.test(c.html),
    },
    {
      weight: 0.3, label: 'Ghost theme assets at /assets/built/',
      test: c => /\/assets\/built\/[^"']+\.(js|css)/.test(c.html),
    },
    {
      weight: 0.2, label: '/rss/ feed link present',
      test: c => /<link[^>]*type=["']application\/rss\+xml["'][^>]*href=["'][^"']*\/rss\/?["']/i.test(c.html),
    },
    {
      weight: 0.15, label: 'Server header indicates Ghost/Express',
      test: c => /\b(ghost|express)\b/i.test(c.headers['server'] ?? '') ||
                /\b(ghost|express)\b/i.test(c.headers['x-powered-by'] ?? ''),
    },
  ],
  webflow: [
    {
      weight: 0.6, label: '<meta generator> says Webflow',
      test: c => /<meta[^>]*name=["']generator["'][^>]*content=["'][^"']*webflow/i.test(c.html),
    },
    {
      weight: 0.4, label: 'data-wf-site / data-wf-page attributes',
      test: c => /data-wf-(site|page)=/.test(c.html),
    },
    {
      weight: 0.3, label: 'website-files.com asset domain',
      test: c => /cdn\.prod\.website-files\.com|assets-global\.website-files\.com/.test(c.html),
    },
    {
      weight: 0.1, label: 'webflow.js loaded',
      test: c => /webflow(\.\w+)?\.js/i.test(c.html),
    },
  ],
  hubspot: [
    {
      weight: 0.5, label: '<meta generator> says HubSpot',
      test: c => /<meta[^>]*name=["']generator["'][^>]*content=["'][^"']*hubspot/i.test(c.html),
    },
    {
      weight: 0.4, label: '/_hcms/ paths referenced',
      test: c => /\/_hcms\//.test(c.html),
    },
    {
      weight: 0.3, label: 'hs-scripts.com or hs-analytics.net loaded',
      test: c => /hs-scripts\.com|hs-analytics\.net|hubspot\.com\/cms-cdn/.test(c.html),
    },
    {
      weight: 0.15, label: 'hs- prefixed class names',
      test: c => /\bclass=["'][^"']*\bhs-[a-z-]+/.test(c.html),
    },
  ],
  squarespace: [
    {
      weight: 0.7, label: '<meta generator> says Squarespace',
      test: c => /<meta[^>]*name=["']generator["'][^>]*content=["'][^"']*squarespace/i.test(c.html),
    },
    {
      weight: 0.3, label: 'static1.squarespace.com assets',
      test: c => /static1\.squarespace\.com/.test(c.html),
    },
  ],
  wix: [
    {
      weight: 0.7, label: '<meta generator> says Wix',
      test: c => /<meta[^>]*name=["']generator["'][^>]*content=["'][^"']*wix/i.test(c.html),
    },
    {
      weight: 0.3, label: 'wixstatic.com or wixsite.com referenced',
      test: c => /wixstatic\.com|wixsite\.com/.test(c.html),
    },
  ],
  framer: [
    {
      weight: 0.6, label: '<meta generator> says Framer',
      test: c => /<meta[^>]*name=["']generator["'][^>]*content=["'][^"']*framer/i.test(c.html),
    },
    {
      weight: 0.4, label: 'data-framer-root attribute',
      test: c => /data-framer-root/.test(c.html),
    },
    {
      weight: 0.3, label: 'framerusercontent.com assets',
      test: c => /framerusercontent\.com/.test(c.html),
    },
  ],
  notion_super: [
    {
      weight: 0.7, label: '<meta generator> says Super.so / Potion / Notion',
      test: c => /<meta[^>]*name=["']generator["'][^>]*content=["'][^"']*(super\.so|potion|notion)/i.test(c.html),
    },
    {
      weight: 0.3, label: 'super.so or potion.so referenced in HTML',
      test: c => /super\.so|potion\.so/.test(c.html),
    },
  ],
  sanity: [
    {
      weight: 0.5, label: 'cdn.sanity.io image domain',
      test: c => /cdn\.sanity\.io/.test(c.html),
    },
    {
      weight: 0.3, label: 'sanity-image-url referenced',
      test: c => /sanity-image-url|sanity-client/i.test(c.html),
    },
  ],
  contentful: [
    {
      weight: 0.5, label: 'images.ctfassets.net image domain',
      test: c => /images\.ctfassets\.net/.test(c.html),
    },
  ],
  strapi: [
    {
      weight: 0.4, label: 'Strapi-shaped media URLs',
      test: c => /\/uploads\/[a-z0-9_]+_[a-f0-9]{8,}\.(jpg|png|webp|svg)/i.test(c.html),
    },
  ],
  hygraph: [
    {
      weight: 0.5, label: 'media.graphcms.com or hygraph.com asset URLs',
      test: c => /media\.graphcms\.com|hygraph\.com/.test(c.html),
    },
  ],
  tina: [
    {
      weight: 0.5, label: 'tinacms.io referenced or _tina paths',
      test: c => /tinacms\.io|\/_tina\//.test(c.html),
    },
  ],
  shopify: [
    {
      weight: 0.6, label: '<meta generator> says Shopify',
      test: c => /<meta[^>]*name=["']generator["'][^>]*content=["'][^"']*shopify/i.test(c.html),
    },
    {
      weight: 0.3, label: 'cdn.shopify.com assets',
      test: c => /cdn\.shopify\.com/.test(c.html),
    },
  ],
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const { url: rawUrl } = await req.json().catch(() => ({}))
  if (!rawUrl || typeof rawUrl !== 'string') {
    return json({ error: 'url required' }, 400)
  }

  // Normalize — accept "acme.com/blog" or "https://acme.com/blog"
  let url: URL
  try {
    url = new URL(/^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`)
  } catch {
    return json({ error: 'invalid URL' }, 400)
  }

  // Fetch homepage + a couple of probes in parallel
  const [homepage, wpJson, ghostAdmin] = await Promise.all([
    fetchPage(url.toString()),
    fetchJson(new URL('/wp-json/', url).toString()),
    fetchPage(new URL('/ghost/api/admin/site/', url).toString(), 'HEAD'),
  ])

  if (!homepage.html) {
    return json({
      detected: 'unknown' as CmsKind,
      confidence: 0,
      signals: [],
      all_scores: {},
      error: `Could not fetch ${url.toString()} (HTTP ${homepage.status ?? 'network error'})`,
    })
  }

  const ctx: FetchContext = {
    url: url.toString(),
    html: homepage.html,
    headers: homepage.headers,
    wpJsonOk: !!wpJson.json,
    wpJsonHasApiSig: !!(
      wpJson.json &&
      typeof wpJson.json === 'object' &&
      ('namespaces' in (wpJson.json as Record<string, unknown>) ||
       'routes' in (wpJson.json as Record<string, unknown>))
    ),
    ghostApiAdminProbeOk: ghostAdmin.status === 200 || ghostAdmin.status === 401,  // 401 = exists but unauth
  }

  // Score CMS layer
  const cms_scores: Partial<Record<CmsKind, number>> = {}
  const cms_signals: Partial<Record<CmsKind, string[]>> = {}
  for (const [kind, signals] of Object.entries(SIGNATURES) as Array<[Exclude<CmsKind, 'unknown'>, Signal[]]>) {
    cms_scores[kind] = scoreOne(signals, ctx, cms_signals, kind)
  }
  const cms_ranked = (Object.entries(cms_scores) as Array<[CmsKind, number]>).sort((a, b) => b[1] - a[1])
  const [topCms, cmsConf] = cms_ranked[0] ?? ['unknown' as CmsKind, 0]
  const detected_cms: CmsKind = cmsConf >= 0.4 ? topCms : 'unknown'

  // Score hosting layer
  const host_scores: Partial<Record<HostingKind, number>> = {}
  const host_signals: Partial<Record<HostingKind, string[]>> = {}
  for (const [kind, signals] of Object.entries(HOSTING_SIGNATURES) as Array<[Exclude<HostingKind, 'unknown'>, Signal[]]>) {
    host_scores[kind] = scoreOne(signals, ctx, host_signals, kind)
  }
  const host_ranked = (Object.entries(host_scores) as Array<[HostingKind, number]>).sort((a, b) => b[1] - a[1])
  const [topHost, hostConf] = host_ranked[0] ?? ['unknown' as HostingKind, 0]
  const detected_hosting: HostingKind = hostConf >= 0.4 ? topHost : 'unknown'

  // Score SSG layer
  const ssg_scores: Partial<Record<SsgKind, number>> = {}
  const ssg_signals: Partial<Record<SsgKind, string[]>> = {}
  for (const [kind, signals] of Object.entries(SSG_SIGNATURES) as Array<[Exclude<SsgKind, 'unknown'>, Signal[]]>) {
    ssg_scores[kind] = scoreOne(signals, ctx, ssg_signals, kind)
  }
  const ssg_ranked = (Object.entries(ssg_scores) as Array<[SsgKind, number]>).sort((a, b) => b[1] - a[1])
  const [topSsg, ssgConf] = ssg_ranked[0] ?? ['unknown' as SsgKind, 0]
  const detected_ssg: SsgKind = ssgConf >= 0.4 ? topSsg : 'unknown'

  // Recommend a publish path. The wizard branches on this.
  //   cms_direct      → operator-friendly CMS connect (WordPress, Ghost, Webflow, HubSpot, etc.)
  //   headless_cms    → connect to the headless backend (Contentful, Sanity, Strapi, Hygraph, Tina, Notion)
  //   git_backed      → write to a Git repo, optional rebuild webhook
  //   manual_paste    → no auto-publish path; operator pastes
  const HEADLESS = new Set<CmsKind>(['contentful', 'sanity', 'strapi', 'hygraph', 'tina', 'notion_super'])
  const STATIC_HOSTING = new Set<HostingKind>(['vercel', 'netlify', 'cloudflare_pages', 'github_pages', 'aws_amplify', 'azure_static'])

  let recommended_path: 'cms_direct' | 'headless_cms' | 'git_backed' | 'manual_paste'
  let recommendation_reason: string

  if (detected_cms !== 'unknown' && HEADLESS.has(detected_cms)) {
    recommended_path = 'headless_cms'
    recommendation_reason = `Site renders content from ${detected_cms} (headless). Publish to ${detected_cms}; the static site will rebuild automatically.`
  } else if (detected_cms !== 'unknown') {
    recommended_path = 'cms_direct'
    recommendation_reason = `Site runs on ${detected_cms}. Publish directly via the ${detected_cms} API.`
  } else if (STATIC_HOSTING.has(detected_hosting) && detected_ssg !== 'unknown') {
    recommended_path = 'git_backed'
    recommendation_reason = `Static ${detected_ssg} site on ${detected_hosting}. No CMS detected — content likely lives in a Git repo. Connect via GitHub/GitLab.`
  } else if (STATIC_HOSTING.has(detected_hosting)) {
    recommended_path = 'git_backed'
    recommendation_reason = `Site is hosted on ${detected_hosting} but framework is unclear. Most likely Git-backed; confirm with operator.`
  } else {
    recommended_path = 'manual_paste'
    recommendation_reason = `Couldn\'t identify CMS, hosting, or SSG. Operator will need to tell us how they currently publish.`
  }

  return json({
    url: url.toString(),
    detected_cms,
    cms_confidence: cmsConf,
    cms_signals: cms_signals[topCms] ?? [],
    detected_hosting,
    hosting_confidence: hostConf,
    hosting_signals: host_signals[topHost] ?? [],
    detected_ssg,
    ssg_confidence: ssgConf,
    ssg_signals: ssg_signals[topSsg] ?? [],
    recommended_path,
    recommendation_reason,
    all_scores: { cms: cms_scores, hosting: host_scores, ssg: ssg_scores },
  })
})

function scoreOne<T extends string>(
  signals: Signal[],
  ctx: FetchContext,
  signalsMap: Partial<Record<T, string[]>>,
  kind: T,
): number {
  let score = 0
  const matched: string[] = []
  for (const sig of signals) {
    try {
      if (sig.test(ctx)) {
        score += sig.weight
        matched.push(sig.label)
      }
    } catch { /* skip broken signal */ }
  }
  if (matched.length) signalsMap[kind] = matched
  return Math.min(score, 1.0)
}

async function fetchPage(url: string, method: 'GET' | 'HEAD' = 'GET'): Promise<{
  html: string; status: number; headers: Record<string, string>
}> {
  try {
    const res = await fetch(url, {
      method,
      headers: { 'User-Agent': 'VERA-cms-detect/1.0' },
      signal: AbortSignal.timeout(8_000),
      redirect: 'follow',
    })
    const html = method === 'GET' ? await res.text() : ''
    const headers: Record<string, string> = {}
    res.headers.forEach((v, k) => { headers[k.toLowerCase()] = v })
    return { html, status: res.status, headers }
  } catch {
    return { html: '', status: 0, headers: {} }
  }
}

async function fetchJson(url: string): Promise<{ json: unknown; status: number }> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'VERA-cms-detect/1.0', 'Accept': 'application/json' },
      signal: AbortSignal.timeout(6_000),
      redirect: 'follow',
    })
    if (!res.ok) return { json: null, status: res.status }
    const ct = res.headers.get('content-type') ?? ''
    if (!ct.includes('json')) return { json: null, status: res.status }
    return { json: await res.json(), status: res.status }
  } catch {
    return { json: null, status: 0 }
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
