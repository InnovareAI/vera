// Server-side Open Graph tags for public review links (/r/<token>).
//
// VERA is a single-page app, so social crawlers (Slack, LinkedIn, iMessage,
// WhatsApp, Facebook, X) that don't run JavaScript only ever see the static
// index.html head. To make a shared /r/<token> link unfurl with the post's
// title and preview image, we inject per-post OG tags at the edge: fetch the
// post from the public review-link function, rewrite the <head>, and serve the
// same SPA shell to humans (React still boots and renders the interactive page).
import type { Context } from 'https://edge.netlify.com'

const SUPA = 'https://supabase-content-eu.innovareai.com'
const TOKEN_RE = /^[a-f0-9]{32,128}$/i

type PreviewPost = {
  title?: string | null
  copy?: string | null
  media_url?: string | null
  media_type?: string | null
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export default async function handler(request: Request, context: Context): Promise<Response> {
  // Always serve the real SPA shell first — we only decorate its <head>.
  const response = await context.next()

  const url = new URL(request.url)
  const token = url.pathname.split('/r/')[1]?.split('/')[0]?.trim() ?? ''
  if (!TOKEN_RE.test(token)) return response

  const ct = response.headers.get('content-type') ?? ''
  if (!ct.includes('text/html')) return response

  // Pull the post (public, no auth — the review-link function runs as service role).
  let post: PreviewPost | null = null
  try {
    const res = await fetch(`${SUPA}/functions/v1/review-link?token=${encodeURIComponent(token)}`)
    if (res.ok) post = (await res.json())?.post ?? null
  } catch {
    // network hiccup — fall back to the untouched shell
  }
  if (!post) return response

  const title = post.title ? `${post.title} · Review request` : 'Review request · VERA'
  const desc = (post.copy ?? 'Open this link to review the post and leave feedback. No account needed.')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180)
  // og:image must be an actual image. Image + carousel posts store an image in
  // media_url; video posts store an mp4, which isn't a valid preview image.
  const image = post.media_url && post.media_type !== 'video' ? post.media_url : null
  const canonical = `${url.origin}/r/${token}`

  const tags = [
    `<meta property="og:type" content="article" />`,
    `<meta property="og:site_name" content="VERA" />`,
    `<meta property="og:title" content="${esc(title)}" />`,
    `<meta property="og:description" content="${esc(desc)}" />`,
    `<meta property="og:url" content="${esc(canonical)}" />`,
    `<meta name="description" content="${esc(desc)}" />`,
    `<meta name="twitter:title" content="${esc(title)}" />`,
    `<meta name="twitter:description" content="${esc(desc)}" />`,
    image ? `<meta property="og:image" content="${esc(image)}" />` : '',
    image ? `<meta name="twitter:image" content="${esc(image)}" />` : '',
    image
      ? `<meta name="twitter:card" content="summary_large_image" />`
      : `<meta name="twitter:card" content="summary" />`,
  ].filter(Boolean).join('\n    ')

  let html = await response.text()
  html = html
    .replace(/<title>[\s\S]*?<\/title>/, `<title>${esc(title)}</title>`)
    .replace('</head>', `    ${tags}\n  </head>`)

  const headers = new Headers(response.headers)
  headers.set('content-type', 'text/html; charset=utf-8')
  // Per-token path, so caching is safe; keep it short so edits to the post
  // refresh the preview within a few minutes.
  headers.set('cache-control', 'public, max-age=300, must-revalidate')
  headers.delete('content-length')

  return new Response(html, { status: response.status, headers })
}

export const config = { path: '/r/*' }
