// Blog auto-publish — commits a content_posts row as an MDX file to the
// InnovareAI-Website repo on GitHub. Netlify picks up the push and rebuilds
// the site (~2 min). On a successful commit, chains back to approval-webhook
// with action:'posted' + posted_url so the row is marked posted and the Slack
// notify fires with the live URL.
//
// POST { post_id, auto_mark_posted?, repo? }
//   - post_id: content_posts row to publish
//   - auto_mark_posted: default true. When true, chains back to approval-
//                       webhook on success.
//   - repo: optional override, format "owner/repo". Defaults to the value of
//           BLOG_GITHUB_REPO (e.g. "InnovareAI/InnovareAI-Website").
//
// Blog post layout on disk:
//   content/blog/{slug}.mdx                 — the post body + frontmatter
//   public/images/blog/{slug}.{ext}         — hero image (optional)
//
// Frontmatter shape (matches existing posts in the repo):
//   title, description, date, author, category, tags, image, imageAlt,
//   primaryKeyword, excerpt
//
// The function will NOT overwrite an existing slug — if {slug}.mdx already
// exists in the repo it appends "-2", "-3", etc. until a free slug is found.

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "npm:@supabase/supabase-js"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey",
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
const GITHUB_TOKEN = Deno.env.get("BLOG_GITHUB_TOKEN") ?? Deno.env.get("GITHUB_TOKEN")
const DEFAULT_REPO = Deno.env.get("BLOG_GITHUB_REPO") ?? "InnovareAI/InnovareAI-Website"
const DEFAULT_BRANCH = Deno.env.get("BLOG_GITHUB_BRANCH") ?? "main"
const PUBLIC_BLOG_BASE = Deno.env.get("BLOG_PUBLIC_BASE_URL") ?? "https://innovareai.com/blog"

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders })
  if (req.method !== "POST") return jsonError("Method not allowed", 405)
  if (!GITHUB_TOKEN) return jsonError("BLOG_GITHUB_TOKEN not configured on the server.", 500)

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return jsonError("Invalid JSON body", 400)
  }

  const post_id = body.post_id as string | undefined
  const repo = (body.repo as string | undefined) ?? DEFAULT_REPO
  const autoMarkPosted = body.auto_mark_posted !== false

  if (!post_id) return jsonError("post_id is required", 400)
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) return jsonError(`Invalid repo format: ${repo}`, 400)

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  // 1. Fetch the post
  const { data: post, error: postErr } = await supabase
    .from("content_posts")
    .select("id, channel, title, copy, hashtags, media_url, profile_name, posted_at, agent_outputs")
    .eq("id", post_id)
    .maybeSingle()
  if (postErr) return jsonError(`Post lookup failed: ${postErr.message}`, 500)
  if (!post) return jsonError(`No post with id ${post_id}`, 404)
  if (post.posted_at) return jsonError("Post is already marked posted; refusing to re-publish.", 409)
  if ((post.channel ?? "").toLowerCase() !== "blog") {
    return jsonError(`blog-publish only handles blog posts; got channel='${post.channel}'`, 400)
  }
  if (!post.title) return jsonError("Post has no title — required for a blog slug.", 400)
  if (!post.copy) return jsonError("Post has no copy.", 400)

  // 2. Pick a unique slug
  const baseSlug = slugify(post.title as string)
  const slug = await findFreeSlug(repo, baseSlug)
  const liveUrl = `${PUBLIC_BLOG_BASE.replace(/\/$/, "")}/${slug}`

  // 3. Optional: commit the hero image first so the .mdx commit points at a
  //    file that actually exists in the repo.
  let imagePath: string | undefined
  if (post.media_url) {
    const img = await fetchImageAsBase64(post.media_url as string)
    if (img) {
      const ext = img.contentType.split("/")[1]?.split(";")[0] ?? "jpg"
      imagePath = `public/images/blog/${slug}.${ext}`
      const imgRes = await githubPutFile({
        repo,
        path: imagePath,
        branch: DEFAULT_BRANCH,
        contentBase64: img.base64,
        message: `Add hero image for ${slug}`,
      })
      if (!imgRes.ok) {
        return jsonError(`GitHub image commit failed: ${imgRes.error}`, 502)
      }
    }
  }

  // 4. Build the MDX file
  const mdx = buildMdx({
    title: post.title as string,
    excerpt: deriveExcerpt(post.copy as string),
    author: (post.profile_name as string | undefined) ?? "InnovareAI Team",
    tags: (post.hashtags as string[] | undefined)?.map(h => h.replace(/^#/, "")) ?? [],
    imagePath: imagePath ? `/${imagePath.replace(/^public\//, "")}` : undefined,
    imageAlt: post.title as string,
    body: post.copy as string,
    primaryKeyword: deriveKeyword(post.agent_outputs as Record<string, unknown> | undefined),
  })

  const mdxRes = await githubPutFile({
    repo,
    path: `content/blog/${slug}.mdx`,
    branch: DEFAULT_BRANCH,
    contentBase64: btoa(unescape(encodeURIComponent(mdx))),
    message: `Publish blog post: ${(post.title as string).slice(0, 70)}`,
  })
  if (!mdxRes.ok) {
    return jsonError(`GitHub MDX commit failed: ${mdxRes.error}`, 502)
  }

  // 5. Chain back to approval-webhook so the row is marked posted + Slack notify fires
  if (autoMarkPosted) {
    try {
      await fetch(`${SUPABASE_URL}/functions/v1/approval-webhook`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          "apikey": SUPABASE_SERVICE_ROLE_KEY,
        },
        body: JSON.stringify({ post_id, action: "posted", posted_url: liveUrl }),
      })
    } catch (e) {
      console.error("approval-webhook chain failed after successful blog commit", e)
    }
  }

  return new Response(JSON.stringify({
    success: true,
    slug,
    posted_url: liveUrl,
    commit_url: mdxRes.commit_url,
    image_committed: !!imagePath,
    note: "Netlify will deploy this within ~2 minutes.",
  }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  })
})

// ──────────────────────────────────────────────────────────────────────────────
// GitHub API helpers
// ──────────────────────────────────────────────────────────────────────────────

type GhPutResult = { ok: true; commit_url?: string } | { ok: false; error: string }

async function githubPutFile(args: {
  repo: string
  path: string
  branch: string
  contentBase64: string
  message: string
}): Promise<GhPutResult> {
  const url = `https://api.github.com/repos/${args.repo}/contents/${args.path}`
  const res = await fetch(url, {
    method: "PUT",
    headers: {
      "Authorization": `Bearer ${GITHUB_TOKEN}`,
      "Accept": "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      message: args.message,
      content: args.contentBase64,
      branch: args.branch,
    }),
  })
  if (!res.ok) {
    const errText = await res.text()
    return { ok: false, error: `${res.status}: ${errText.slice(0, 300)}` }
  }
  const data = await res.json() as { commit?: { html_url?: string } }
  return { ok: true, commit_url: data.commit?.html_url }
}

async function githubFileExists(repo: string, path: string): Promise<boolean> {
  const res = await fetch(`https://api.github.com/repos/${repo}/contents/${path}`, {
    headers: {
      "Authorization": `Bearer ${GITHUB_TOKEN}`,
      "Accept": "application/vnd.github+json",
    },
  })
  return res.ok
}

async function findFreeSlug(repo: string, baseSlug: string): Promise<string> {
  if (!(await githubFileExists(repo, `content/blog/${baseSlug}.mdx`))) return baseSlug
  for (let i = 2; i < 20; i++) {
    const candidate = `${baseSlug}-${i}`
    if (!(await githubFileExists(repo, `content/blog/${candidate}.mdx`))) return candidate
  }
  // Fall back to timestamp suffix if we somehow burned through 18 retries
  return `${baseSlug}-${Date.now()}`
}

async function fetchImageAsBase64(url: string): Promise<{ base64: string; contentType: string } | null> {
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    const buf = new Uint8Array(await res.arrayBuffer())
    // btoa requires a binary string. Build it without blowing the call stack on large buffers.
    let bin = ""
    for (let i = 0; i < buf.length; i += 0x8000) {
      bin += String.fromCharCode.apply(null, Array.from(buf.subarray(i, i + 0x8000)))
    }
    return {
      base64: btoa(bin),
      contentType: res.headers.get("content-type") ?? "image/jpeg",
    }
  } catch {
    return null
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// MDX generation
// ──────────────────────────────────────────────────────────────────────────────

interface MdxArgs {
  title: string
  excerpt: string
  author: string
  tags: string[]
  imagePath?: string
  imageAlt: string
  body: string
  primaryKeyword?: string
}

function buildMdx(args: MdxArgs): string {
  const dateIso = new Date().toISOString().slice(0, 10)
  const fm: Record<string, unknown> = {
    title: args.title,
    description: args.excerpt,
    date: dateIso,
    author: args.author,
    category: args.tags[0] ?? "Insights",
    tags: args.tags.length ? args.tags : ["Insights"],
  }
  if (args.imagePath) {
    fm.image = args.imagePath
    fm.imageAlt = args.imageAlt
  }
  if (args.primaryKeyword) fm.primaryKeyword = args.primaryKeyword
  fm.excerpt = args.excerpt

  const yaml = Object.entries(fm).map(([k, v]) => {
    if (Array.isArray(v)) return `${k}: [${v.map(x => JSON.stringify(String(x))).join(", ")}]`
    return `${k}: ${JSON.stringify(String(v))}`
  }).join("\n")

  return `---\n${yaml}\n---\n\n${args.body.trim()}\n`
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")  // strip diacritics
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
}

function deriveExcerpt(body: string): string {
  // First non-heading paragraph, capped at 180 chars
  const paras = body.split(/\n{2,}/).map(p => p.trim()).filter(Boolean)
  const firstProse = paras.find(p => !p.startsWith("#"))
  if (!firstProse) return body.slice(0, 180)
  const flat = firstProse.replace(/[#*_>`]/g, "").replace(/\s+/g, " ").trim()
  return flat.length > 180 ? flat.slice(0, 177) + "..." : flat
}

function deriveKeyword(agentOutputs: Record<string, unknown> | undefined): string | undefined {
  if (!agentOutputs) return undefined
  const seo = agentOutputs.seo as Record<string, unknown> | undefined
  return (seo?.primary_keyword as string | undefined)
    ?? (seo?.keyword as string | undefined)
    ?? undefined
}

function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  })
}
