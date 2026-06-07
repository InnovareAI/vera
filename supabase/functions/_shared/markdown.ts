// Shared markdown → HTML renderer. Same input, same output, every connector.
//
// Uses `marked` (lightweight, Deno-friendly, GFM-compatible) plus a small
// sanitization pass that allow-lists tags WP/Ghost/Webflow all accept.
//
// If we later need fancier rendering (footnotes, raw HTML passthrough,
// custom shortcodes), swap to remark + rehype-sanitize behind this same
// function signature — callers don't change.

import { marked } from 'npm:marked@12'

const ALLOWED_TAGS = new Set([
  'p', 'br', 'hr',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'strong', 'em', 'b', 'i', 'u', 's', 'del', 'ins', 'mark',
  'blockquote', 'pre', 'code',
  'ul', 'ol', 'li',
  'a', 'img',
  'table', 'thead', 'tbody', 'tr', 'th', 'td',
  'figure', 'figcaption',
  'div', 'span',  // some CMSes need these — sanitize attrs
])

const ALLOWED_ATTRS_PER_TAG: Record<string, Set<string>> = {
  a:   new Set(['href', 'title', 'rel', 'target']),
  img: new Set(['src', 'alt', 'title', 'width', 'height']),
  code: new Set(['class']),  // for language hints
  pre:  new Set(['class']),
  span: new Set(['class']),
  div:  new Set(['class']),
  th:  new Set(['colspan', 'rowspan', 'scope']),
  td:  new Set(['colspan', 'rowspan']),
}

const DEFAULT_ALLOWED_ATTRS = new Set<string>([])

// Render markdown to HTML, then strip anything not on the allow list.
// Throws if input is unmistakably broken (so callers fail at dry_run, not publish).
export function renderMarkdown(md: string): string {
  marked.setOptions({
    gfm: true,
    breaks: false,
    pedantic: false,
  })
  const rawHtml = marked.parse(md, { async: false }) as string
  return sanitizeHtml(rawHtml)
}

// Cheap sanitizer — regex-walk every tag, drop non-allowed tags + attrs.
// Inline-script and event-handler attributes are stripped unconditionally.
function sanitizeHtml(html: string): string {
  // Remove <script>, <style>, <iframe> entirely (content too)
  let s = html.replace(/<(script|style|iframe)\b[\s\S]*?<\/\1>/gi, '')

  // Walk every opening + self-closing tag
  s = s.replace(/<([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g, (full, tagRaw, attrsRaw) => {
    const tag = tagRaw.toLowerCase()
    if (!ALLOWED_TAGS.has(tag)) return ''
    const allowedAttrs = ALLOWED_ATTRS_PER_TAG[tag] ?? DEFAULT_ALLOWED_ATTRS
    const kept: string[] = []
    for (const m of attrsRaw.matchAll(/\b([a-zA-Z_:][a-zA-Z0-9_:.\-]*)\s*(?:=\s*("([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g)) {
      const attr = m[1].toLowerCase()
      const value = m[3] ?? m[4] ?? m[5] ?? ''
      // Drop event handlers (onclick, onload, etc.) unconditionally
      if (attr.startsWith('on')) continue
      // Drop javascript: URLs
      if ((attr === 'href' || attr === 'src') && /^\s*javascript:/i.test(value)) continue
      if (!allowedAttrs.has(attr)) continue
      kept.push(`${attr}="${escapeAttr(value)}"`)
    }
    return kept.length ? `<${tag} ${kept.join(' ')}>` : `<${tag}>`
  })

  // Also strip closing tags for disallowed elements
  s = s.replace(/<\/([a-zA-Z][a-zA-Z0-9]*)>/g, (full, tagRaw) => {
    const tag = tagRaw.toLowerCase()
    return ALLOWED_TAGS.has(tag) ? full : ''
  })

  return s.trim()
}

function escapeAttr(v: string): string {
  return v.replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// Slugify a title for use as a URL fragment. Same algorithm WordPress uses:
// lowercase, strip non-alphanumerics, collapse to dashes, trim leading/trailing.
export function slugify(title: string): string {
  return title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')        // strip combining diacritics
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
}

// Hash the canonical post content. Used as the idempotency key's
// content-fingerprint component — same content, same key, no double-publish.
export async function contentFingerprint(post: {
  title?: string; body_md?: string; tags?: string[]; categories?: string[]; status?: string
}): Promise<string> {
  const canonical = JSON.stringify({
    title: post.title ?? '',
    body_md: post.body_md ?? '',
    tags: [...(post.tags ?? [])].sort(),
    categories: [...(post.categories ?? [])].sort(),
    status: post.status ?? 'draft',
  })
  const bytes = new TextEncoder().encode(canonical)
  const hash = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(hash))
    .slice(0, 12)
    .map(b => b.toString(16).padStart(2, '0')).join('')
}
