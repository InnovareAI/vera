// VERA ambient chat — the always-on partner with workspace awareness.
//
// Separate from vera-orchestrator (the 9-agent brief→draft pipeline). This
// one is conversational, sub-second TTFB, knows the workspace it's in,
// remembers what operators have told it across sessions.
//
// POST { messages: [{role, content}, ...], org_id, user_id?, route? }
//
// Response: text/event-stream
//   data: {"type":"delta","text":"…"}
//   data: {"type":"done","usage":{…}}
//   data: {"type":"error","message":"…"}
//
// Context strategy:
//   - Base persona prompt: static, ~300 tokens
//   - Workspace context block: rebuilt per request from live DB state
//     (campaigns, brand voice, audiences, latest audit, pending count,
//     pinned memories). Anthropic prompt caching marks this block as
//     ephemeral so repeated turns hit the cache instead of re-billing.
//   - Conversation messages: variable, uncached
//
// Persistence:
//   - User turn written to chat_messages BEFORE streaming (crash-safe)
//   - Assistant turn written AFTER stream completes with usage stats
//
// vera_memories table (migration 014) is the persistent-memory store.
// Pinned rows are always injected. Future: tool calls for write +
// retrieval of unpinned rows.

import Anthropic from 'npm:@anthropic-ai/sdk'
import { createClient } from 'npm:@supabase/supabase-js'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Sonnet, not Haiku: the chat loop must RELIABLY call tools (save_draft,
// run_pipeline, generate_image). Haiku would narrate "Draft saved" in prose
// without actually invoking save_draft — leaving an empty draft card.
const MODEL = 'claude-sonnet-4-6'
// Roomy enough for a full post written into save_draft's `copy` arg plus the
// rest of the tool call — 1024 risked truncating before the tool call landed.
const MAX_TOKENS = 2048
const STORAGE_BUCKET = 'vera-images'
const EMBEDDING_MODEL = 'text-embedding-3-small'  // 1536 dim, $0.02/M tokens
const EMBEDDING_DIM = 1536

const VERA_MARKETING_EXPERTISE = `
Marketing and content strategy expertise:
- You are a senior marketing strategist, content strategist, creative director,
  editor, copy chief, campaign planner, and production lead in one assistant.
  Treat every request as a business communication problem, not a writing task.
- Start from the strategy spine: audience, business objective, offer, category
  context, positioning, promise, proof, objections, channel, format, CTA, and
  distribution path. Use that spine silently before you write.
- Think in campaigns, not isolated assets. Connect one post to a larger angle,
  narrative arc, content pillar, launch, sales motion, or trust-building job
  whenever it helps.
- Know the difference between awareness, demand creation, lead generation,
  nurture, retention, recruiting, founder brand, product education, and sales
  enablement. Choose the right job for the piece.
- Build content around a real point of view. Prefer sharp premises, useful
  frameworks, lived experience, specific trade-offs, examples, proof, and
  tension. Reject generic advice, empty inspiration, and category boilerplate.
- Copywriting bar: strong first line, one clear reader, one clear promise, one
  idea per piece, concrete nouns and verbs, specific proof, no fake statistics,
  no vague superlatives, no filler transitions, no corporate throat-clearing.
- Content production bar: make the work usable. When relevant, provide hooks,
  outlines, captions, variants, repurposing cuts, content calendars, briefs,
  shot directions, review notes, and platform-specific formatting.
- Channel fluency: adapt structure and voice for LinkedIn, Instagram, X,
  Facebook, Medium, newsletters, blogs, email, Reddit, Quora, short video, and
  carousel formats. Do not flatten every platform into the same LinkedIn post.
- Strategic pushback: if the ask is weak, improve it through the output. Make
  one practical assumption and produce a stronger version. Ask a question only
  when the missing detail would materially change the work.
- Quality control: every draft should pass five tests: would the right person
  stop, would they recognize their problem, would they trust the claim, would
  they know what to do next, and does it sound like this brand rather than a
  generic AI writer.
`.trim()

const VERA_KNOWLEDGE_LIBRARIAN = `
Client Brain and knowledge-librarian operating model:
- Treat each workspace and active project as a living client knowledge base.
  The goal is not storage. The goal is compounding judgment, sources, brand
  context, and strategic memory that make every future answer sharper.
- Think in four layers:
  1. Raw source: articles, transcripts, notes, links, meetings, PDFs,
     screenshots, social posts, audits, operator context, and pasted text.
     Preserve sources with provenance. Do not pre-organize raw material.
  2. Wiki synthesis: canonical, sourced articles that organize raw material
     into positioning, audiences, offers, proof, competitors, voice, content
     pillars, objections, campaigns, and decisions.
  3. Outputs: answers, briefings, strategy memos, reports, content plans,
     messaging maps, audits, and useful generated work that should inform
     future decisions.
  4. Memory and health: what changed, what has been processed, contradictions,
     stale claims, missing sources, open gaps, and candidate wiki articles.
- When the operator pastes source material or says to remember it, call
  kb_ingest with the raw text. Store the source verbatim. Summarize only after
  ingestion, or when asked.
- When multiple raw items point to a durable theme, call kb_synthesize or
  recommend synthesis into a wiki article so future chats inherit the context.
- When the operator asks for strategy, positioning, content ideas, brand voice,
  audience insight, campaign planning, or copy, use injected knowledge first.
  Call kb_search when the answer needs deeper source context than the snippets
  already provided.
- When a chat answer becomes a useful output, offer to save it into the Brain.
  If the current tool can only ingest raw notes, say that plainly and save the
  output as a note only when the operator wants it retained.
- For Brain health checks, call kb_audit_summary, then assess coverage, source
  provenance, stale wiki articles older than 90 days, unsupported claims,
  contradictions, orphaned raw items, and new article candidates. Separate
  findings from recommended actions.
- Treat source material as evidence. Cite KB titles when using snippets. Never
  invent client facts, research, performance numbers, or historical decisions.
- The day-100 goal: every client Brain should become a unique business asset,
  with the client's perspective, sources, judgment, voice, and content history
  cross-referenced and ready to query.
`.trim()

const VERA_SPECIALIST_ADVISOR_MODEL = `
Specialist advisor model:
- You are not a generic chatbot. You are the orchestration layer for a set of
  specialist marketing advisors. Pick the right lens silently: marketing
  strategy, positioning, copywriting, content strategy, production, brand voice,
  distribution, audience research, source ingestion, or Brain health.
- A specialist is made of three things: instructions, skills, and knowledge.
  Instructions define the job and standards. Skills define repeatable
  processes. Knowledge holds trusted principles, examples, case studies, and
  source-backed frameworks.
- When the Brain contains trusted frameworks, books, expert notes, or internal
  playbooks, use them as the specialist's source of truth. Prefer curated
  knowledge over generic model knowledge for client-specific advice.
- If the relevant Brain is empty or weak, say confidence is low in one line,
  offer the best default marketing judgment separately, and recommend what to
  ingest next.
- Useful knowledge entries should be atomized: topic, category, key insight,
  when to apply, source, confidence level, related concepts, and example use.
  When ingesting long books or frameworks, ask for or infer the chapter list
  first so extraction follows a stable structure.
- Confidence matters. Prioritize validated client data, active brand voice,
  published case studies, sales calls, performance reports, and named sources
  over untested ideas. Label speculation as speculation.
- Anti-drift rule: stay inside the selected specialist lens. Do not turn a
  positioning question into generic content tips, a copy task into strategy
  theater, or a source-grounded advisor into unsupported opinion.
- When the operator teaches you a reusable method, create or update a skill.
  Keep skills compact, process-oriented, and reusable across clients when
  possible.
`.trim()

// Embed text via OpenAI. Returns null on failure so callers can decide
// whether to skip indexing or hard-fail. Bounded retry + truncation on
// the embedding API's 8192-token input cap (rough char approximation).
async function embedText(text: string): Promise<number[] | null> {
  const key = Deno.env.get('OPENAI_API_KEY')
  if (!key) {
    console.warn('OPENAI_API_KEY missing — embedding skipped')
    return null
  }
  // Truncate to ~28k chars (≈7k tokens, safe margin under 8192 cap)
  const input = text.length > 28_000 ? text.slice(0, 28_000) : text
  try {
    const res = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: EMBEDDING_MODEL, input }),
    })
    if (!res.ok) {
      console.warn('embed failed', res.status, (await res.text()).slice(0, 200))
      return null
    }
    const data = await res.json() as { data?: Array<{ embedding: number[] }> }
    const v = data.data?.[0]?.embedding
    if (!v || v.length !== EMBEDDING_DIM) {
      console.warn('embed shape unexpected', v?.length)
      return null
    }
    return v
  } catch (e) {
    console.warn('embed threw', e)
    return null
  }
}

// Format a vector as the Postgres array literal pgvector accepts.
function vec(v: number[]): string {
  return `[${v.join(',')}]`
}

// Upload a generated image (base64 data URL OR remote URL) to Supabase
// Storage and return a stable public URL. Replaces the previous flow where
// base64 inlined into the SSE stream and never got persisted.
async function uploadImageToStorage(
  supabase: ReturnType<typeof createClient>,
  orgId: string,
  source: string,
): Promise<string> {
  let bytes: Uint8Array
  let contentType = 'image/png'

  if (source.startsWith('data:')) {
    // data:image/png;base64,XXXX
    const match = source.match(/^data:([^;]+);base64,(.+)$/s)
    if (!match) throw new Error('invalid data URL')
    contentType = match[1]
    const b64 = match[2]
    bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0))
  } else {
    // fetch the remote image (fal.media url, etc.)
    const res = await fetch(source)
    if (!res.ok) throw new Error(`image fetch failed: HTTP ${res.status}`)
    contentType = res.headers.get('content-type') ?? 'image/png'
    bytes = new Uint8Array(await res.arrayBuffer())
  }

  const ext = contentType.split('/')[1]?.split('+')[0] ?? 'png'
  const key = `${orgId}/${crypto.randomUUID()}.${ext}`

  const { error } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(key, bytes, { contentType, upsert: false })
  if (error) throw new Error(`storage upload failed: ${error.message}`)

  const { data: { publicUrl } } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(key)
  // getPublicUrl builds the URL from the edge function's SUPABASE_URL, which
  // on this self-hosted stack is the INTERNAL gateway (http://kong:8000) —
  // unreachable from a browser, so the <img> silently breaks. Rewrite the
  // origin to the public DSN so the stored image actually loads.
  const publicBase = Deno.env.get('PUBLIC_SUPABASE_URL') || 'https://supabase-content-eu.innovareai.com'
  return publicUrl.replace(/^https?:\/\/[^/]+/, publicBase.replace(/\/$/, ''))
}

// Generate ONE image via the generate-image edge function and return a stable
// stored URL. Factored out of the generate_image tool so the carousel tool can
// fan out many frames in parallel (Promise.all) and stay under the gateway's
// SSE timeout. Throws on failure so the caller can count successes.
async function generateOneImage(
  supabaseUrl: string,
  serviceKey: string,
  supabase: ReturnType<typeof createClient>,
  orgId: string,
  prompt: string,
  aspect = 'square_hd',
): Promise<string> {
  const res = await fetch(`${supabaseUrl}/functions/v1/generate-image`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${serviceKey}`, 'apikey': serviceKey },
    body: JSON.stringify({ prompt, model: 'nano-banana-pro', image_size: aspect, quality: 'high' }),
  })
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let imageUrl: string | undefined
  let errMsg: string | undefined
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let idx
    while ((idx = buffer.indexOf('\n\n')) !== -1) {
      const frame = buffer.slice(0, idx)
      buffer = buffer.slice(idx + 2)
      const line = frame.split('\n').find(l => l.startsWith('data: '))
      if (!line) continue
      try {
        const event = JSON.parse(line.slice(6)) as Record<string, unknown>
        if (event.event === 'done') { const images = event.images as Array<{ url: string }> | undefined; imageUrl = images?.[0]?.url }
        else if (event.event === 'error') errMsg = String(event.message ?? 'image error')
      } catch { /* skip malformed frame */ }
    }
  }
  if (errMsg) throw new Error(errMsg)
  if (!imageUrl) throw new Error('no image url returned')
  try { return await uploadImageToStorage(supabase, orgId, imageUrl) } catch { return imageUrl }
}

const BASE_PERSONA = `
You are VERA — InnovareAI's creative AI partner. The always-on chat dock at
the bottom of every page. You're not a brief workshop — that's the
/generate route. You're here for everything else: thinking through what
to write, summarising what's in flight, sharpening copy, answering
questions about the workspace.

${VERA_MARKETING_EXPERTISE}

${VERA_KNOWLEDGE_LIBRARIAN}

${VERA_SPECIALIST_ADVISOR_MODEL}

Personality:
- Sharp, warm, direct. No filler. No "great question!" preamble.
- Senior creative who's been working with this brand for months —
  confident opinions, never preachy.
- American spelling. Short paragraphs. Cut anything that isn't
  load-bearing.

Output mechanics (these separate writing that reads as human from writing that
reads as AI, and they apply to BOTH your chat replies AND every post, caption,
hook, and campaign you generate). Not optional:
- NEVER use em dashes (—) or en dashes (–) as punctuation. They are the
  clearest AI tell. Use a period, a comma, parentheses, or a colon, or just
  rewrite the sentence. This overrides any dash habit you have.
- NEVER use emojis unless the operator explicitly asks for them.
- Concise and confident: state it, then stop. At most one short framing line
  around a result. No throat-clearing, no "great question," no recap of what
  you just did.
- When you return a draft, the post is the star. Keep your own words to a
  single tight line. Do not enumerate what you changed unless the operator asks.

Behaviour:
- The <workspace_context> block below is the live state of the operator's
  workspace. Treat it as ground truth. If something isn't in there, say
  so plainly — don't fabricate posts, scores, or campaign names.
- When you don't have data access (e.g. specific post content, full
  audit transcripts), tell the operator and offer the closest useful
  alternative.
- For real multi-channel content generation, recommend the operator hit
  /generate (which runs the full 9-agent pipeline). For quick sketches
  and one-offs, just draft it inline.
- Never post on the operator's behalf, never approve drafts. Anything
  that mutates data needs an explicit UI action.

Project scope:
- When <active_project> is present in workspace_context, that project's
  custom instructions define your scope for the turn. Apply them when
  drafting; they outrank generic brand-voice defaults.
- If the operator asks for something outside the active project's scope
  (e.g. drafting Coca Cola style copy while in InnovareAI brand), DON'T
  refuse, and DON'T lead with a wall of options. Just draft it in the
  requested style, then add ONE short line offering to save it to a
  dedicated project if it looks worth keeping. Only ask which project
  when the operator's intent is genuinely ambiguous.
- You are an editorial tool. Writing ABOUT a subject is not endorsing or
  building it. Edgy, controversial, competitive, or technical topics
  (security, the bot-detection arms race, growth tactics, industry
  criticism, anything in the news) are all fair game as thought leadership.
  Your DEFAULT for any content brief is to WRITE it: take the legitimate
  explainer / opinion / arms-race angle, grounded and specific. Do not refuse
  a brief because the SUBJECT sounds edgy, and do not water it down into a
  disclaimer.
- NEVER moralize, lecture, or judge the operator's brief. Never say a request
  "causes harm regardless of how it's framed" or similar. That tone is banned.
- The only thing you don't write is literal step-by-step operational
  instructions to carry out clear, serious harm (e.g. a working guide to
  defeat a live security / anti-fraud system, build a weapon, run a real
  attack). Even then: don't announce it, don't justify it, don't compare
  angles. Just write a strong explainer / opinion piece ON THE TOPIC THEY
  ASKED ABOUT and let it stand. NEVER frame your version as the one that
  "lands better," is "smarter," or is what they "really" want — that judges
  the brief and is banned. A reflective blog post or explainer on the same
  subject is always fine; write it without the preamble.
- "This isn't current campaign work" is NEVER a reason to refuse. Style
  references, prospect pitches, capability demos, benchmarks, hypothetical
  brands, and voice calibration are all in scope.
- If no <active_project> is in the context, you're in a workspace-level
  chat. Draft whatever the operator asks; offer to save the output to a
  project after the fact if it looks worth keeping.

Using skills:
- The Skills section in <workspace_context> lists reusable patterns
  (content frames, platform formats, persona lenses). When you draft
  something, apply the relevant skill by name and tell the operator
  which one you used ("Applying the Gap-opening hook skill: ...").
- If the operator names a skill explicitly ("use the Cold Outreach
  skill"), use it. If they ask vaguely ("write a LinkedIn post"), pick
  the best fit and surface your choice.
- If a useful pattern isn't in the skills list, just write good copy —
  don't invent a skill name. Skills are the operator's vocabulary, not
  yours.

Tool use:
You have a tool palette. Call tools without asking permission — just use
them when intent matches. After a tool returns, briefly acknowledge what
you did and what's next — don't narrate the tool call itself.

Tools-first defaults — don't outsource work the tools can do:
- Before asking the operator to paste content from a public URL, try
  web_search. The operator should never have to copy-paste a public web
  page into chat for you to read — that's what web_search is for.
- Before asking "what should the post highlight?" or "what's the key
  message?", check whether you can answer that yourself by fetching the
  source (web_search), checking the workspace context (brand voice,
  audit, memories, kb_hits), or applying a relevant skill. Use the
  operator's input for things only they know (preferences, context,
  decisions) — not for things you can research.
- "I don't have access to X" is the wrong answer if X is on the public
  web — try web_search first. If web_search fails, then say what failed
  and offer kb_ingest as a fallback.
- Action over interrogation: draft a first version with what you can
  gather, then ask one targeted question. Don't run a multi-question
  intake before producing anything.

InnovareAI products (this workspace's own context):
- SAM — InnovareAI's sales-side outbound agent. HITL prospecting,
  cadence, lead engagement. Marketing content ABOUT SAM is in your
  scope (you draft the LinkedIn post, the landing page copy, the
  positioning). Outbound prospecting messages FOR SAM's customers are
  not — that's SAM's domain. Don't conflate the two.
- VERA — this tool. The content-side AI partner. Same scope rule:
  drafting marketing content about VERA is yours; replacing VERA in
  somebody's pipeline is not.
- When asked to draft anything about InnovareAI's products, default
  to web_search on innovareai.com (and product subpaths like /sam)
  for current positioning before drafting.

Generation tools:
- TEXT-FIRST, ALWAYS. Default every draft to copy only. NEVER generate an
  image, infographic, or video unless the operator EXPLICITLY asks for a
  visual ("add an image", "make a video", "create a carousel/quote card").
  Drafting a post does NOT mean attaching a picture. When unsure, write the
  text and stop.
- save_draft — YOUR DEFAULT for drafting a post. When the operator briefs a
  single post ("draft/write/make a post about X", "give me hooks on Y", "I
  want one post"): WRITE the post yourself THIS TURN — in the brand voice,
  grounded in <workspace_context> + knowledge — and call save_draft with the
  copy. Default to TEXT ONLY: do NOT auto-generate an image. After saving the
  copy, offer one in a single short line ("Want a matching image?") and only
  call generate_image if the operator says yes (or asked for an image up
  front). This keeps the operator in control of visuals instead of forcing one
  on every post. One step for the copy. The Draft card carries the post for
  Approve / Tweak / Regenerate. Do NOT announce "drafting", do NOT stall, do
  NOT ask permission to write, just write it and save it in the same turn, then
  reply in ONE short line.
  HARD RULE: writing the post as a chat message does NOT save it. A draft
  exists ONLY after you CALL save_draft. NEVER say "draft saved", "saved to
  review", or "ready to review" unless you actually called save_draft in THIS
  turn. Put the post copy in save_draft's "copy" argument — do not write the
  post in prose and then claim it's saved.
  HARD RULE — A VIDEO/REEL IS STILL A POST: when the operator wants a video
  post (a reel, "a post with a movie", an animated post, a brief that is mostly
  a video), you MUST call save_draft for the caption/copy FIRST — that creates
  the post's card in the right rail — and THEN call generate_video, which
  attaches the clip to THAT draft. generate_video alone has no post to attach to,
  so the clip + caption end up stranded in the chat with nothing to review,
  approve, or schedule. NEVER deliver a video as a chat-only message. Every
  finished post — text, image, or video — must live on a saved draft card.
  HARD RULE — THE CAPTION IS NOT THE BRIEF: save_draft's "copy" is the PUBLISHED
  post caption only — the words that go live under the video. NEVER put the
  production brief into it: no "Scene 01 / Scene 02", no shot lists, no camera /
  lens / lighting / grade / overhead-shot / "the chest rises" stage directions,
  no timing breakdowns. All of that is shoot direction and belongs ONLY in
  generate_video's prompt argument. The operator briefing you in cinematic
  detail describes the VIDEO; it does not become the caption. Write a short,
  clean, publishable caption in the brand voice and put ONLY that in "copy".
  HARD RULE — ONE VISUAL AT A TIME, NEVER MIX MEDIA: start AT MOST ONE visual
  generation (generate_image, generate_carousel, OR generate_video) per turn, and
  NEVER more than one KIND in the same turn. Do not run an image and a video, or a
  carousel and a Reel, together — pick ONE post, generate its ONE visual, let it
  attach to ITS draft, say in one short line that it's rendering, and STOP. Wait
  for the operator before the next. Saving the text captions for several posts up
  front is fine — only the VISUALS must be sequential and unmixed.
  VIDEOS ESPECIALLY — NEVER GENERATE MORE THAN ONE MOVIE CLIP AT A TIME: each Reel
  takes ~1–2 minutes and renders in the background. Generate at most ONE video
  clip, ever — never two, never in parallel, never queued back-to-back in the same
  turn, and never alongside any other visual. One Reel, then stop and let it
  finish before anything else. Parallel or mixed generation
  makes finishing media attach to the WRONG post, risks timeouts, and overwhelms
  the operator; strictly one-at-a-time keeps every visual pinned to the right
  draft and the work calm.
- plan_campaign — YOUR PATH FOR ANY BATCH / MULTI-POST ask: "plan the month",
  "plan next month for <client>", "a month of LinkedIn posts", "build a campaign
  on X", "the next 4 weeks", "a week of content". In ONE call it writes the whole
  arc, dates each post by cadence, saves them all as Pending, and lays them on a
  campaign calendar. Do the whole job in a single turn — NEVER hand-draft a batch
  one save_draft at a time, and NEVER announce a plan you haven't generated yet.
  After it runs, reply in ONE short line: the calendar's ready to review, and you
  can refine any post or generate images on approval.
- run_pipeline — the SLOW (~1 min) 9-agent pipeline for ONE deeply-researched
  piece. Use ONLY when the operator explicitly asks for "the full team" or a
  single heavily-researched post — never for a quick post, and never for a batch
  (that's plan_campaign). CRITICAL: never call a generation tool more than once
  for the same brief, and never retry a failed pipeline — if anything stalls or
  fails, immediately write the post yourself and save_draft. You must never loop
  or keep saying you'll "run it now".
- generate_infographic — multi-section visuals (hub diagrams, flows, comparisons)
- generate_image — single visuals (hero, social card, poster); composes
  a Gemini-grade prompt via the "Image generation prompt" skill
- generate_carousel — a multi-FRAME image carousel (2–10 slides). The instant the
  operator asks for a "carousel", a multi-slide/multi-frame post, or hands you
  several frame descriptions (Frame 01, Frame 02, …): save_draft the caption
  FIRST, then call generate_carousel with ONE entry per frame. HARD RULE: a
  carousel ask gets EVERY frame generated — NEVER answer it with a single
  generate_image. If they describe five frames, you produce five.
- generate_video — generates a real video clip (MP4) via fal.ai (Veo 3 text-to-video,
  or image-to-video when given an image_url); it streams into the thread + attaches to the draft.
  If the ask is a video POST and no draft exists yet, save_draft the caption FIRST, then call this.
- generate_video_brief — produces a written video-production brief (no clip)

Workspace tools:
- list_pending_posts — "what's pending?" / "queue summary"
- get_post_detail — fetch a specific post by id or title
- summarize_recent_activity — "what happened this week?"
- schedule_post — set publish time on an approved post
- run_audit — kick off LinkedIn / brew360 / content audits

Knowledge tools:
- search_skills — find skills by keyword, returns FULL prompt_module
- recall_memory — search unpinned memories beyond the workspace context
- web_search — Anthropic-managed live web search. Your DEFAULT for any
  public web content: company sites (including InnovareAI's own —
  innovareai.com, sam.innovareai.com), product pages, articles, posts,
  LinkedIn profiles, press releases, blogs, stats, news. Don't restrict
  it to "competitors" or "breaking news" — use it any time the source
  is a public URL. Capped at 5 searches per turn — be deliberate but
  don't be stingy.
- kb_search — semantic search across the workspace knowledge base
  (curated wiki + raw items). Use whenever the operator asks about
  workspace-specific things — competitors, past decisions, customer
  insights, campaign themes. The context block already auto-injects
  the top 5 KB hits for the current turn; kb_search is for going
  deeper or wider.
- kb_ingest — when the operator pastes an article, transcript, note,
  or excerpt and wants VERA to remember it. Store verbatim — don't
  paraphrase the source.
- kb_synthesize — when several raw items address the same theme,
  merge them into a canonical wiki article. The article becomes part
  of every future workspace context block.
- kb_audit_summary — KB health snapshot for "how's my knowledge base"
  questions.

When the <relevant_kb_snippets> block in the workspace context has
hits, ground your answer in those snippets and cite by title. Don't
fabricate workspace-specific claims — if it's not in the KB and not
in workspace_context, say so and offer to ingest the source.

Learning tools:
- remember — durable workspace fact (voice.*, focus.*, fact.*)
- feedback — operator critique → per-operator instruction
- create_skill — "teach yourself X" → permanent reusable pattern
- update_brand_voice — refine tone/forbidden/required from chat

Vision: operators can paste or drop images directly into chat. When you
see an image in the user's message, look at it carefully — review the
copy, critique a competitor's post, evaluate a generated draft. Be
specific about what's in the image.

Extended thinking (auto-enabled for analytical intents): when the operator
asks you to analyze, think through trade-offs, deep-dive, or strategize,
you'll have an internal thinking budget before you respond. Use it.

Choosing the right visual — only when a visual is asked for, but then make it FIT:

Text-first is the rule: you generate an image, infographic, or video only when
the operator asks for one. But when they DO ask, NEVER default to a generic
hero image. Read the content first, understand what the post is actually about,
then pick the kind of visual that fits THAT content:

- Stats / data (3+ numbers with context) → generate_infographic, dashboard layout
- A process or sequence (3+ steps: lifecycle, funnel, pipeline) → generate_infographic, flow layout
- A comparison (3+ things: vendors, tiers, approaches) → generate_infographic, grid/comparison layout
- A system or framework (named parts + relationships) → generate_infographic, hub / structured diagram
- One punchy, quotable line from the post → a quote-card image: that line set in type, on-brand, minimal
- A story, POV, emotional or brand moment → an editorial photo or illustration that carries the mood
- An abstract concept or metaphor → one strong illustrative image of that metaphor

For a POST specifically: read the copy, find its core — a stat? a story? a
contrarian line? a framework? — and choose the matching visual above. The image
must reinforce the post's actual point, not be generic stock filler. Always
build a concrete prompt for the chosen type: subject, composition, a named
style, an on-brand palette (lead with the brand accent), mood — and for any
photo/illustration end with "no text, no words, no logos".

When you do add a visual, say so in one short line, then generate it. If you're
unsure a visual helps at all, default to text — a clear text answer beats a
weak image.
`.trim()

interface WorkspaceContext {
  orgName: string
  brandVoice?: {
    tone?: string[]
    forbidden?: string[]
    persona_name?: string
    persona_descriptor?: string
  }
  campaigns: Array<{ name: string; theme?: string | null; status?: string }>
  audiences: Array<{ kind: string; name: string; is_primary?: boolean }>
  latestAudit?: { kind: string; score?: number; grade?: string; created_at: string } | null
  pendingCount: number
  memories: Array<{ key: string; value: string; kind: string }>
  skills: Array<{ name: string; type: string; description: string }>
  skillPerformance: Map<string, { invocations: number; approval_rate: number | null }>
  kbStats: { raw_count: number; article_count: number; recent_titles: string[] }
  kbHits: Array<{ source: string; title: string; excerpt: string; similarity: number }>
  // Phase 2b — active project scope + its top-N relevant knowledge items.
  // When project_id is supplied, this defines VERA's scope for the turn.
  // Absent / null = workspace-level chat (default brand context only).
  activeProject?: {
    id: string
    name: string
    slug: string
    description: string | null
    instructions: string | null
    is_default: boolean
  }
  projectKnowledge: Array<{ title: string; excerpt: string; similarity: number; source_kind: string }>
  // Phase 3 — agent observations. VERA's notice log: things she
  // spotted (stale audit, empty queue, knowledge gap, etc.) that may
  // warrant a proactive prompt to the operator. When non-empty, the
  // persona instructs VERA to lead the conversation with these.
  observations: Array<{
    id: string
    kind: string
    severity: 'low' | 'medium' | 'high'
    title: string
    detail: string | null
    proposed_action: string | null
    project_id: string | null
  }>
}

// Brand voice, preferring a PROJECT-scoped row, falling back to the org default
// (project_id null = what Settings writes). Uses limit(1) — never maybeSingle —
// so per-project rows can coexist with the org default without erroring. Returns
// the { data } shape so existing callers (brandRes.data) are unchanged.
async function loadBrandVoice(
  supabase: ReturnType<typeof createClient>,
  orgId: string,
  projectId?: string | null,
): Promise<{ data: Record<string, unknown> | null }> {
  const cols = 'tone, writing_rules, forbidden_phrases, required_phrases, persona_name, persona_descriptor'
  if (projectId) {
    const { data } = await supabase.from('brand_voice').select(cols).eq('project_id', projectId).limit(1)
    if (data && data.length) return { data: data[0] as Record<string, unknown> }
  }
  const { data } = await supabase.from('brand_voice').select(cols).eq('org_id', orgId).order('project_id', { nullsFirst: true }).limit(1)
  return { data: (data && data.length) ? (data[0] as Record<string, unknown>) : null }
}

async function loadContext(
  supabase: ReturnType<typeof createClient>,
  orgId: string,
  userId: string | null,
  lastUserMessage?: string,
  projectId?: string | null,
): Promise<WorkspaceContext> {
  // Parallel fetch — each query is small, no need to serialise.
  const [
    orgRes, brandRes, campRes, audRes, auditRes, pendingRes, memRes, skillsRes, perfRes,
  ] = await Promise.all([
    supabase.from('organizations').select('name').eq('id', orgId).maybeSingle(),
    loadBrandVoice(supabase, orgId, projectId),
    supabase.from('campaigns').select('name, theme, status').eq('org_id', orgId).eq('status', 'active').limit(10),
    supabase.from('audiences').select('kind, name, is_primary').eq('org_id', orgId).limit(10),
    supabase.from('linkedin_audits').select('kind, result, created_at').eq('org_id', orgId).order('created_at', { ascending: false }).limit(2),
    supabase.from('content_posts').select('id', { count: 'exact', head: true }).eq('org_id', orgId).eq('status', 'Pending Review'),
    // Workspace-wide memories (user_id null) + this user's personal memories.
    supabase.from('vera_memories').select('key, value, kind')
      .eq('org_id', orgId)
      .or(userId ? `user_id.is.null,user_id.eq.${userId}` : 'user_id.is.null')
      .eq('is_pinned', true)
      .order('created_at', { ascending: false })
      .limit(40),
    // Skills: org-specific + system-global (org_id null). System skills are
    // the platform/format library; org skills are operator-authored extensions.
    supabase.from('skills').select('name, type, description, sort_order')
      .or(`org_id.is.null,org_id.eq.${orgId}`)
      .eq('is_active', true)
      .order('type')
      .order('sort_order')
      .limit(60),
    // Skill performance — approval rate per skill (joined via the
    // skill_performance view). Only skills with at least 1 invocation
    // surface here; new skills with no signal stay description-only.
    supabase.from('skill_performance').select('name, total_invocations, approval_rate, last_used_at')
      .or(`org_id.is.null,org_id.eq.${orgId}`)
      .gt('total_invocations', 0)
      .order('total_invocations', { ascending: false })
      .limit(40),
  ])

  // Latest audit — pick the most recent regardless of kind, then pull score/grade
  // from whichever shape the result happens to be in.
  let latestAudit: WorkspaceContext['latestAudit'] = null
  const auditRow = (auditRes.data as Array<{ kind: string; result: unknown; created_at: string }> | null)?.[0]
  if (auditRow) {
    const r = auditRow.result as { score?: number; grade?: string; audit?: { overall_score?: number; grade?: string } }
    latestAudit = {
      kind: auditRow.kind,
      score: r?.score ?? r?.audit?.overall_score,
      grade: r?.grade ?? r?.audit?.grade,
      created_at: auditRow.created_at,
    }
  }

  return {
    orgName: (orgRes.data?.name as string) ?? 'this workspace',
    brandVoice: brandRes.data ? {
      tone: brandRes.data.tone as string[] | undefined,
      forbidden: brandRes.data.forbidden_phrases as string[] | undefined,
      persona_name: brandRes.data.persona_name as string | undefined,
      persona_descriptor: brandRes.data.persona_descriptor as string | undefined,
    } : undefined,
    campaigns: (campRes.data ?? []) as Array<{ name: string; theme?: string | null; status?: string }>,
    audiences: (audRes.data ?? []) as Array<{ kind: string; name: string; is_primary?: boolean }>,
    latestAudit,
    pendingCount: pendingRes.count ?? 0,
    memories: (memRes.data ?? []) as Array<{ key: string; value: string; kind: string }>,
    skills: (skillsRes.data ?? []) as Array<{ name: string; type: string; description: string }>,
    skillPerformance: new Map(
      ((perfRes.data ?? []) as Array<{ name: string; total_invocations: number; approval_rate: number | null }>)
        .map(r => [r.name, { invocations: r.total_invocations, approval_rate: r.approval_rate }]),
    ),
    kbStats: await loadKbStats(supabase, orgId),
    kbHits: lastUserMessage ? await retrieveKbHits(supabase, orgId, lastUserMessage) : [],
    activeProject: projectId ? await loadActiveProject(supabase, orgId, projectId) : undefined,
    projectKnowledge: projectId && lastUserMessage
      ? await retrieveProjectKnowledge(supabase, projectId, lastUserMessage)
      : [],
    observations: await loadObservations(supabase, orgId, projectId),
  }
}

// Open observations for the active org (scoped to project when set).
// Capped at 6 — anything more crowds the system prompt.
async function loadObservations(
  supabase: ReturnType<typeof createClient>,
  orgId: string,
  projectId: string | null,
): Promise<WorkspaceContext['observations']> {
  try {
    let q = supabase.from('agent_observations')
      .select('id, kind, severity, title, detail, proposed_action, project_id')
      .eq('org_id', orgId)
      .eq('status', 'open')
      .order('created_at', { ascending: false })
      .limit(6)
    if (projectId) q = q.eq('project_id', projectId)
    const { data } = await q
    return (data as WorkspaceContext['observations']) ?? []
  } catch { return [] }
}

// Project lookup — verifies the supplied project_id belongs to the org
// (defense against client mismatch), returns the row that drives scope.
async function loadActiveProject(
  supabase: ReturnType<typeof createClient>,
  orgId: string,
  projectId: string,
): Promise<WorkspaceContext['activeProject']> {
  try {
    const { data } = await supabase
      .from('projects')
      .select('id, org_id, name, slug, description, instructions, is_default')
      .eq('id', projectId)
      .eq('org_id', orgId)
      .maybeSingle()
    if (!data) return undefined
    return {
      id: data.id as string,
      name: data.name as string,
      slug: data.slug as string,
      description: (data.description as string | null) ?? null,
      instructions: (data.instructions as string | null) ?? null,
      is_default: (data.is_default as boolean) ?? false,
    }
  } catch (err) {
    // Migration 026 not applied — table doesn't exist. Silent fall-through.
    console.warn('[vera-chat] active project lookup failed:', err)
    return undefined
  }
}

// Top-K semantic retrieval over the active project's knowledge base.
// Same pattern as retrieveKbHits but scoped to project_knowledge instead
// of the workspace KB.
async function retrieveProjectKnowledge(
  supabase: ReturnType<typeof createClient>,
  projectId: string,
  query: string,
): Promise<WorkspaceContext['projectKnowledge']> {
  if (query.length < 24) return []
  try {
    const embedding = await embedText(query)
    const { data, error } = await supabase.rpc('project_knowledge_search', {
      p_project_id: projectId,
      p_embedding: embedding,
      p_match_count: 5,
      p_threshold: 0.5,
    })
    if (error) {
      // RPC may not exist yet — fall back to empty rather than error.
      // The Phase 3 migration will add it; until then knowledge isn't
      // semantically retrieved but the project still scopes the chat.
      return []
    }
    return (data ?? []) as WorkspaceContext['projectKnowledge']
  } catch {
    return []
  }
}

// Quick KB stats (count of raw, count of articles, 5 most-recent titles).
// Surfaced in the workspace context so VERA knows the KB exists + has scale.
async function loadKbStats(
  supabase: ReturnType<typeof createClient>,
  orgId: string,
): Promise<WorkspaceContext['kbStats']> {
  const [rawRes, artRes, recentRes] = await Promise.all([
    supabase.from('kb_raw').select('id', { count: 'exact', head: true }).eq('org_id', orgId),
    supabase.from('kb_articles').select('id', { count: 'exact', head: true }).eq('org_id', orgId).eq('status', 'published'),
    supabase.from('kb_articles').select('title').eq('org_id', orgId).eq('status', 'published').order('updated_at', { ascending: false }).limit(5),
  ])
  return {
    raw_count: rawRes.count ?? 0,
    article_count: artRes.count ?? 0,
    recent_titles: ((recentRes.data ?? []) as Array<{ title: string }>).map(r => r.title),
  }
}

// Semantic retrieval of the top-K relevant KB snippets for the current
// user turn. Auto-injected into the workspace context block so VERA reads
// real source material before responding — without needing to explicitly
// call kb_search.
async function retrieveKbHits(
  supabase: ReturnType<typeof createClient>,
  orgId: string,
  query: string,
): Promise<WorkspaceContext['kbHits']> {
  // Skip embedding cost for trivially short turns (greetings, yes/no, etc.)
  if (query.length < 24) return []
  const embedding = await embedText(query)
  if (!embedding) return []
  const { data, error } = await supabase.rpc('kb_semantic_search', {
    org_filter: orgId,
    query_embedding: vec(embedding),
    match_count: 5,
    threshold: 0.5,
  })
  if (error) {
    console.warn('kb retrieval failed', error.message)
    return []
  }
  return (data ?? []) as WorkspaceContext['kbHits']
}

function renderContext(ctx: WorkspaceContext, route: string): string {
  const lines: string[] = []
  lines.push(`<workspace_context>`)
  lines.push(`Org: ${ctx.orgName}`)
  lines.push(`Current route: ${route}`)

  // Active project — defines scope for this turn. When the project has
  // custom instructions, those are the authoritative system-prompt
  // addendum for this conversation. Knowledge snippets follow.
  if (ctx.activeProject) {
    const p = ctx.activeProject
    lines.push(``)
    lines.push(`<active_project>`)
    lines.push(`Name: ${p.name}${p.is_default ? ' (default — the org\'s primary brand work)' : ''}`)
    if (p.description) lines.push(`Description: ${p.description}`)
    if (p.instructions) {
      lines.push(`Custom instructions:`)
      lines.push(p.instructions.trim())
    } else if (!p.is_default) {
      lines.push(`(No custom instructions set — apply general brand voice from workspace.)`)
    }
    if (ctx.projectKnowledge.length) {
      lines.push(``)
      lines.push(`Top ${ctx.projectKnowledge.length} relevant knowledge items for this turn:`)
      for (const k of ctx.projectKnowledge) {
        lines.push(`  [${k.source_kind}] ${k.title} (sim ${(k.similarity * 100).toFixed(0)}%):\n    ${k.excerpt.replace(/\s+/g, ' ').trim()}`)
      }
    }
    lines.push(`</active_project>`)
    lines.push(``)
  }

  if (ctx.brandVoice) {
    const bv = ctx.brandVoice
    if (bv.persona_name || bv.persona_descriptor) {
      lines.push(`Brand persona: ${bv.persona_name ?? ''} — ${bv.persona_descriptor ?? ''}`.trim())
    }
    if (bv.tone?.length) lines.push(`Tone: ${bv.tone.join(', ')}`)
    if (bv.forbidden?.length) lines.push(`Forbidden phrases: ${bv.forbidden.join(', ')}`)
  }

  if (ctx.campaigns.length) {
    lines.push(`Active campaigns (${ctx.campaigns.length}):`)
    for (const c of ctx.campaigns) {
      lines.push(`  - ${c.name}${c.theme ? ` — ${c.theme}` : ''}`)
    }
  } else {
    lines.push(`Active campaigns: none`)
  }

  if (ctx.audiences.length) {
    lines.push(`Audiences (${ctx.audiences.length}):`)
    for (const a of ctx.audiences) {
      lines.push(`  - ${a.kind}${a.is_primary ? ' (primary)' : ''}: ${a.name}`)
    }
  }

  if (ctx.latestAudit) {
    const a = ctx.latestAudit
    const score = a.score !== undefined ? ` ${a.score}` : ''
    const grade = a.grade ? ` (${a.grade})` : ''
    lines.push(`Latest audit: ${a.kind}${score}${grade} — ${a.created_at.slice(0, 10)}`)
  }

  lines.push(`Pending review: ${ctx.pendingCount} post${ctx.pendingCount === 1 ? '' : 's'}`)

  if (ctx.memories.length) {
    lines.push(`Memories (${ctx.memories.length}):`)
    for (const m of ctx.memories) {
      lines.push(`  - [${m.kind}] ${m.key}: ${m.value}`)
    }
  }

  if (ctx.skills.length) {
    // Group by type so the operator can scan capabilities by category.
    const byType = ctx.skills.reduce<Record<string, typeof ctx.skills>>((acc, s) => {
      (acc[s.type] = acc[s.type] ?? []).push(s); return acc
    }, {})
    lines.push(`Skills (${ctx.skills.length}) — patterns you can apply when drafting. Performance stats (when present) come from real approval/rejection signal — bias toward higher-performing skills, treat untested ones with appropriate uncertainty:`)
    for (const [type, skills] of Object.entries(byType)) {
      lines.push(`  ${type}:`)
      for (const s of skills) {
        const perf = ctx.skillPerformance.get(s.name)
        const perfTag = perf
          ? ` [${perf.approval_rate ?? '?'}% approved · ${perf.invocations} uses]`
          : ''
        lines.push(`    - ${s.name}${perfTag}: ${s.description}`)
      }
    }
  }

  if (ctx.kbStats.raw_count > 0 || ctx.kbStats.article_count > 0) {
    lines.push(`Knowledge base: ${ctx.kbStats.raw_count} raw items, ${ctx.kbStats.article_count} wiki articles`)
    if (ctx.kbStats.recent_titles.length) {
      lines.push(`  Recent wiki entries: ${ctx.kbStats.recent_titles.join(' · ')}`)
    }
  } else {
    lines.push(`Knowledge base: empty. Use kb_ingest when operator pastes articles, notes, or transcripts they want VERA to remember.`)
  }

  if (ctx.kbHits.length) {
    lines.push(`\n<relevant_kb_snippets>`)
    lines.push(`Top ${ctx.kbHits.length} semantically-related KB items for this turn (cosine similarity). Treat as ground truth for workspace-specific claims; cite by title.`)
    for (const hit of ctx.kbHits) {
      lines.push(`  [${hit.source}] ${hit.title} (sim ${(hit.similarity * 100).toFixed(0)}%):\n    ${hit.excerpt.replace(/\s+/g, ' ').trim()}`)
    }
    lines.push(`</relevant_kb_snippets>`)
  }

  // ─── Active observations — VERA's notice log ─────────────────────
  // Things VERA noticed since last action that may warrant an
  // operator prompt. Persona tells her to mention these proactively
  // when chat opens, rather than waiting to be asked.
  if (ctx.observations && ctx.observations.length > 0) {
    lines.push(`\n<active_observations>`)
    lines.push(`Things you noticed about this workspace + project that the operator hasn't actioned yet. Lead the conversation with these when there's no other active topic — pick the highest-severity one, name it, propose its action. Don't dump the full list; mention the most important and offer the rest if asked.`)
    for (const obs of ctx.observations) {
      const sev = obs.severity.toUpperCase()
      lines.push(`  [${sev}] ${obs.title}${obs.detail ? ` — ${obs.detail}` : ''}${obs.proposed_action ? ` (suggested: ${obs.proposed_action})` : ''}`)
    }
    lines.push(`</active_observations>`)
  }

  lines.push(`</workspace_context>`)
  return lines.join('\n')
}

// ─── Tools VERA can call ─────────────────────────────────────────────────────
// Schemas use Anthropic's tool_use shape. Descriptions are written for the
// model — they directly shape when each tool fires.
const TOOLS = [
  {
    name: 'generate_infographic',
    description: 'Generate a polished B2B infographic via Gemini 3 Pro Image. Use when the operator asks for an infographic, hub diagram, flow chart, multi-section visual, or NotebookLM-style explainer. Returns an image rendered inline in the chat.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'The headline at the top of the infographic, ≤12 words.' },
        subtitle: { type: 'string', description: 'Optional subtitle ≤25 words.' },
        sections: {
          type: 'array',
          minItems: 2,
          maxItems: 6,
          items: {
            type: 'object',
            properties: {
              heading: { type: 'string', description: '3-6 word panel heading' },
              body: { type: 'string', description: '1-2 sentence supporting copy' },
              visual_cue: { type: 'string', description: 'Brief description of the illustration element for this panel' },
              icon: { type: 'string', description: 'Short icon hint (e.g. "robot", "calendar with checkmark")' },
            },
            required: ['heading', 'body'],
          },
        },
        stats: {
          type: 'array',
          maxItems: 4,
          items: {
            type: 'object',
            properties: {
              value: { type: 'string', description: 'The big-number callout (e.g. "150", "65%", "$60-80K")' },
              label: { type: 'string', description: 'Short label under the number' },
            },
            required: ['value', 'label'],
          },
        },
        style: {
          type: 'string',
          enum: ['editorial', 'technical', 'playful', 'minimal'],
          description: 'Visual style. Default: editorial (NotebookLM-like).',
        },
        audience: { type: 'string', description: 'Optional audience tone reference' },
      },
      required: ['title', 'sections'],
    },
  },
  {
    name: 'generate_image',
    description: 'Generate a single image via Gemini 3 Pro Image for cases that are NOT multi-panel infographics — hero images, social cards, posters, illustrations, brand visuals. The prompt argument must be a dense, specific image-gen prompt (see the "Image generation prompt (Gemini-tier)" skill).',
    input_schema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'The full image-gen prompt, 80-250 words. Include format declaration, layout, hex colors, verbatim text in quotes, named elements, style anchor, anti-patterns.' },
        aspect_ratio: {
          type: 'string',
          enum: ['square_hd', 'landscape_16_9', 'portrait_4_3'],
          description: 'Default: square_hd. Use landscape_16_9 for hero/banner. portrait_4_3 for vertical social.',
        },
      },
      required: ['prompt'],
    },
  },
  {
    name: 'generate_carousel',
    description: 'Generate a multi-FRAME image CAROUSEL (2–10 slides) and attach EVERY frame to the draft. Use whenever the operator asks for a "carousel", a multi-slide / multi-frame post, or hands you several frame descriptions (Frame 01, Frame 02, …). FIRST save_draft the caption to create the post, THEN call this with ONE entry per frame — each entry is rendered as its own image. NEVER answer a carousel ask with a single generate_image; produce every frame described. Frames render in parallel and land on the draft card as a swipeable set.',
    input_schema: {
      type: 'object',
      properties: {
        frames: {
          type: 'array',
          description: 'One entry per carousel frame, IN ORDER (2–10 frames). Generate every frame the operator described.',
          items: {
            type: 'object',
            properties: {
              image_prompt: { type: 'string', description: 'The full, dense image-gen prompt for THIS frame — scene, light, composition, hex colors, and any on-frame text in quotes. 80–250 words.' },
              text: { type: 'string', description: 'Optional short label/caption for this frame (for the operator\'s reference).' },
            },
            required: ['image_prompt'],
          },
        },
        post_id: { type: 'string', description: 'UUID of the draft to attach the carousel to. Omit to use the most recent media-less draft for this client.' },
        aspect_ratio: { type: 'string', enum: ['square_hd', 'landscape_16_9', 'portrait_4_3'], description: 'Default square_hd. All frames share one ratio.' },
      },
      required: ['frames'],
    },
  },
  {
    name: 'remember',
    description: 'Persist a memory across sessions. Use when the operator says "remember X", "always X", "never use X", or shares a workspace fact you should keep top-of-mind. Idempotent — calling with the same key updates the existing memory.',
    input_schema: {
      type: 'object',
      properties: {
        key: {
          type: 'string',
          description: 'Namespaced key: voice.* (forbidden phrases, tone), preference.* (workflow), focus.* (current campaign/quarter), fact.* (org knowledge), instruction.* (rules).',
        },
        value: { type: 'string', description: 'The memory content. Concise, durable.' },
        kind: {
          type: 'string',
          enum: ['fact', 'preference', 'voice', 'focus', 'instruction'],
          description: 'Default: fact.',
        },
      },
      required: ['key', 'value'],
    },
  },
  {
    name: 'feedback',
    description: 'Capture operator critique on a draft, opener, structure, skill, tone, or anything you produced. Use when the operator says things like "your openers are too generic", "I always rewrite the closer", "don\'t open with a question", or critiques your previous output. The constraint becomes a persistent per-operator instruction that shapes every future draft.',
    input_schema: {
      type: 'object',
      properties: {
        feedback: { type: 'string', description: 'The verbatim or paraphrased operator critique.' },
        about: {
          type: 'string',
          enum: ['opener', 'closer', 'tone', 'structure', 'cta', 'voice', 'format', 'skill', 'general'],
          description: 'What aspect of the output this feedback is about. Use the closest match.',
        },
        skill_name: { type: 'string', description: 'If the feedback is about a specific skill, name it verbatim.' },
        constraint: {
          type: 'string',
          description: 'Rewrite the feedback as a forward-looking constraint for future drafts. Imperative, specific.',
        },
      },
      required: ['feedback', 'about', 'constraint'],
    },
  },

  // ─── Workspace data access ───────────────────────────────────────────────
  {
    name: 'list_pending_posts',
    description: 'List posts currently in the review queue (status="Pending Review") for the active workspace. Use when the operator asks "what\'s pending?", "what\'s in the queue?", "what should I review next?", or wants a queue summary.',
    input_schema: {
      type: 'object',
      properties: {
        channel: { type: 'string', description: 'Optional filter by channel (linkedin, twitter, email, blog, etc.)' },
        limit: { type: 'number', description: 'Max rows to return. Default 10, max 50.' },
      },
    },
  },
  {
    name: 'get_post_detail',
    description: 'Fetch full detail of a specific post by id — copy, channel, status, hashtags, media_url, posted_url, feedback history. Use when the operator references a specific post by title, asks to review a post, or wants to iterate on existing copy.',
    input_schema: {
      type: 'object',
      properties: {
        post_id: { type: 'string', description: 'UUID of the content_posts row.' },
        match_title: { type: 'string', description: 'If post_id unknown, fuzzy-match by title (case-insensitive substring).' },
      },
    },
  },
  {
    name: 'search_skills',
    description: 'Search the skill library by keyword or description. Returns matching skills with their full prompt_module text. Use when the operator asks about an unfamiliar skill or you need the full recipe of a skill you only saw the description for.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query — skill name, type, or descriptive keyword.' },
        limit: { type: 'number', description: 'Default 5.' },
      },
      required: ['query'],
    },
  },
  {
    name: 'recall_memory',
    description: 'Search the persistent memory store by keyword. Returns matching memories beyond the pinned set already in your context. Use when the operator references a past decision, fact, or preference you don\'t see in the current workspace context.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Keyword to match against memory keys + values.' },
        limit: { type: 'number', description: 'Default 8.' },
      },
      required: ['query'],
    },
  },
  {
    name: 'create_skill',
    description: 'Add a new skill to the workspace library. Use when the operator says "teach yourself X", "remember to always do Y when drafting Z", "let\'s define a new pattern", or wants to encode a reusable craft pattern. The skill becomes available in every future chat turn via the workspace context.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '2-5 word skill name (claim-style).' },
        type: {
          type: 'string',
          enum: ['platform', 'content', 'persona', 'brand', 'enrichment', 'tool'],
          description: 'Best-fit category. "content" for narrative patterns, "platform" for format recipes, "persona" for audience lenses, "brand" for guardrails.',
        },
        description: { type: 'string', description: 'One-line description that appears in the skills index.' },
        prompt_module: { type: 'string', description: 'The full instructional text — the recipe a writer follows. 200-400 words typical, opinionated and specific.' },
      },
      required: ['name', 'type', 'description', 'prompt_module'],
    },
  },
  {
    name: 'update_brand_voice',
    description: 'Update a specific field of the workspace\'s brand_voice row. Use when the operator says "add X to forbidden phrases", "our tone should be more Y", or refines voice attributes. Pass field name and new value.',
    input_schema: {
      type: 'object',
      properties: {
        field: {
          type: 'string',
          enum: ['tone', 'forbidden_phrases', 'required_phrases', 'writing_rules', 'persona_name', 'persona_descriptor', 'system_prompt'],
        },
        operation: {
          type: 'string',
          enum: ['set', 'append', 'remove'],
          description: 'For array fields (tone, forbidden_phrases, etc.) use append/remove. For text fields use set.',
        },
        value: { type: 'string', description: 'For arrays: single item to add/remove. For text: full replacement value.' },
      },
      required: ['field', 'operation', 'value'],
    },
  },
  {
    name: 'summarize_recent_activity',
    description: 'Roll up what happened in the workspace over the last N days — posts created, approved, rejected, posted, audits run. Use when the operator asks "what happened this week?", "summarize last week", "weekly review".',
    input_schema: {
      type: 'object',
      properties: {
        days: { type: 'number', description: 'Lookback window. Default 7.' },
      },
    },
  },
  {
    name: 'schedule_post',
    description: 'Set a publish-time on an approved post. Use when the operator says "schedule X for Wednesday 9am", "queue this for next Monday". The post stays approved; only the scheduled_at timestamp gets updated.',
    input_schema: {
      type: 'object',
      properties: {
        post_id: { type: 'string', description: 'UUID of the post to schedule.' },
        scheduled_at: { type: 'string', description: 'ISO 8601 timestamp. Resolve relative phrases ("Wednesday 9am") to absolute UTC before passing.' },
      },
      required: ['post_id', 'scheduled_at'],
    },
  },
  {
    name: 'run_audit',
    description: 'Trigger a workspace audit. Use when the operator says "run the audit", "refresh LinkedIn scores", "let\'s see the latest brew360". Fires async — results land in the LinkedIn audit page within ~30s.',
    input_schema: {
      type: 'object',
      properties: {
        kind: {
          type: 'string',
          enum: ['profile', 'brew360', 'content', 'all'],
          description: 'Which audit to refresh. "all" runs everything via the refresh RPC.',
        },
      },
      required: ['kind'],
    },
  },
  {
    name: 'generate_video_brief',
    description: 'Compose a video production brief (YouTube long-form, Shorts/Reels, webinar, animated explainer) based on a topic and intent. Returns the brief as structured text — operator runs generate-video separately if they want the video itself.',
    input_schema: {
      type: 'object',
      properties: {
        format: { type: 'string', enum: ['youtube_long', 'short_form_vertical', 'webinar', 'animated_explainer'] },
        topic: { type: 'string', description: 'The video\'s subject matter.' },
        duration_sec: { type: 'number', description: 'Target spoken length. Default depends on format.' },
        audience: { type: 'string', description: 'Optional audience descriptor.' },
      },
      required: ['format', 'topic'],
    },
  },
  {
    name: 'generate_video',
    description: 'Generate an actual video clip (MP4) via fal.ai and stream it into the thread. Use when the operator asks to "make/create a video", "animate this", "turn this image into a video", or wants a short motion clip for a post. Text-to-video by default (Veo 3); pass image_url to animate an existing still (an image-to-video engine is chosen automatically). The finished clip renders in the thread and attaches to the active draft. IMPORTANT: this attaches to an EXISTING draft — if the operator wants a video POST and you have not saved a draft yet, call save_draft for the caption FIRST so the clip has a post card to attach to (otherwise it is stranded in the chat with nothing to review). For a written production brief instead of a real clip, use generate_video_brief.',
    input_schema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'What the video should show — subject, motion, camera, mood. Be vivid and concrete; this drives the generation.' },
        image_url: { type: 'string', description: 'Optional. A still image URL to animate (image-to-video). When set, an image-to-video model is used.' },
        aspect_ratio: { type: 'string', enum: ['16:9', '9:16', '1:1'], description: 'Optional. Default 16:9. Use 9:16 for Reels / Shorts / TikTok.' },
        model: { type: 'string', description: 'Optional engine override: "veo-3" (default text-to-video), "sora-2" (premium), "kling-3" (image-to-video).' },
      },
      required: ['prompt'],
    },
  },

  // ─── Knowledge base ──────────────────────────────────────────────────────
  {
    name: 'kb_ingest',
    description: 'Add content to the workspace knowledge base. Use when the operator pastes an article, book excerpt, framework, notes, meeting transcript, social content, or URL excerpt. The content gets embedded and becomes searchable. Store raw material verbatim first. Do not pre-organize it because synthesis belongs in the wiki layer.',
    input_schema: {
      type: 'object',
      properties: {
        content: { type: 'string', description: 'The raw text to ingest. Don\'t summarize — store the source verbatim.' },
        kind: {
          type: 'string',
          enum: ['article', 'transcript', 'note', 'pdf', 'email', 'screenshot', 'web_capture', 'meeting', 'other'],
        },
        title: { type: 'string', description: 'Optional. If absent, will be inferred from the first line / heading.' },
        source: { type: 'string', description: 'URL, filename, author, or "manual". Helps future audits.' },
      },
      required: ['content', 'kind'],
    },
  },
  {
    name: 'kb_search',
    description: 'Semantic search across the workspace knowledge base — both curated wiki articles and raw items. Use proactively whenever the operator asks about something workspace-specific: a competitor, a past decision, a customer insight, a campaign theme. Better to consult the KB than guess.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Natural-language query. Cosine similarity finds semantically related content even with different vocabulary.' },
        limit: { type: 'number', description: 'Max results. Default 6.' },
      },
      required: ['query'],
    },
  },
  {
    name: 'kb_synthesize',
    description: 'Generate a canonical wiki article from a topic plus supporting raw items. Use when several raw items address the same theme, framework, source, audience, positioning point, proof point, or content pillar and should be merged into a single sourced article. The article becomes part of the workspace context for all future turns.',
    input_schema: {
      type: 'object',
      properties: {
        topic: { type: 'string', description: 'The wiki article\'s subject. 4-8 words.' },
        themes: { type: 'array', items: { type: 'string' }, description: 'Tag-like themes for filtering' },
        source_ids: { type: 'array', items: { type: 'string' }, description: 'Optional. If absent, runs a semantic search on the topic to find sources.' },
      },
      required: ['topic'],
    },
  },
  {
    name: 'kb_audit_summary',
    description: 'Fetch a Brain health check: raw items, wiki articles, stale pages, source provenance gaps, raw items not yet synthesized, pending revisions, recent changes, and suggested article candidates. Use when the operator asks "how is my knowledge base?", "what should I clean up?", "what is missing from the Brain?", or wants a monthly health check.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'save_draft',
    description: 'Save a post you (VERA) just wrote so it appears as a Draft card in the thread (Approve / Tweak / Regenerate) and lands in Review as Pending. THIS IS YOUR DEFAULT for a single post: write the copy yourself in the brand voice — grounded in <workspace_context> + knowledge — then call save_draft with it. Fast and reliable. Use this for "draft/write a post on X", "I want one post", "give me a LinkedIn post about Y". Do NOT narrate "drafting…" — write it and save it in the same turn.',
    input_schema: {
      type: 'object',
      properties: {
        copy: { type: 'string', description: 'The full post copy, ready to publish. Write it well — this is the deliverable.' },
        title: { type: 'string', description: 'Short internal title for the queue (4-8 words).' },
        channel: { type: 'string', description: 'LinkedIn | Blog | Email | X | Instagram. Default LinkedIn.' },
        format: { type: 'string', description: 'e.g. Text-only, Carousel, Thread, Article. Default Text-only.' },
        hashtags: { type: 'array', items: { type: 'string' }, description: 'Optional hashtags, without the leading #.' },
        image_prompt: { type: 'string', description: 'OMIT BY DEFAULT. Posts are text-first: only pass this when the operator EXPLICITLY asks for an image/visual. When passed, save_draft generates the image, attaches it, and persists it. Never include it just because the channel is visual.' },
      },
      required: ['copy'],
    },
  },
  {
    name: 'refine_post',
    description: 'Improve an EXISTING post in place (used from the Review/approval screen when the operator gives feedback like "punch up the hook" or "make the image warmer"). Edit only what the feedback asks for: pass `copy` to rewrite the text, `image_prompt` to regenerate the image, or `video_prompt` to regenerate the video — one or more. The post is updated in the queue and the card refreshes. Do NOT create a new post; this edits post_id.',
    input_schema: {
      type: 'object',
      properties: {
        post_id: { type: 'string', description: 'The id of the post being refined (from <refine_target> in context).' },
        copy: { type: 'string', description: 'Full rewritten copy — only when the feedback is about the text. Apply the feedback; keep the brand voice.' },
        image_prompt: { type: 'string', description: 'A fresh image prompt — only when the feedback is about the visual. Vivid + specific, no text in the image.' },
        video_prompt: { type: 'string', description: 'A fresh video prompt — only when the feedback is about the video.' },
      },
      required: ['post_id'],
    },
  },
  {
    name: 'run_pipeline',
    description: 'HEAVYWEIGHT 9-agent pipeline (Strategist → Researcher → Writer → SEO → Persona → Brand Guard → Compliance → Publisher). SLOW (~1 minute). Use ONLY when the operator explicitly asks for "the full team", a deeply researched / multi-pass piece, or campaign-scale work. For a normal single post, DO NOT use this — write it yourself and call save_draft. Never call run_pipeline more than once for the same brief; if it fails, fall back to writing the post yourself + save_draft.',
    input_schema: {
      type: 'object',
      properties: {
        brief: { type: 'string', description: 'The brief in plain language — what to create, the angle, channel, any must-haves. Pass the operator\'s intent faithfully; the pipeline expands it.' },
        campaign_id: { type: 'string', description: 'Optional. A real campaign UUID copied verbatim from workspace_context — NEVER a campaign name/title. Omit it entirely if you do not have an exact UUID.' },
        audience_id: { type: 'string', description: 'Optional. A real audience/persona UUID from workspace_context — never a name. Omit if unsure.' },
      },
      required: ['brief'],
    },
  },
  {
    name: 'plan_campaign',
    description: 'THE AGENTIC BATCH PATH — your move whenever the operator wants more than one post: "plan the month", "plan next month for <client>", "give me a month of LinkedIn posts", "build a campaign on X", "plan the next 4 weeks", "a week of content". In ONE call you generate a coherent content arc AND write every post, assign each a date by cadence, save them all as Pending, and surface a campaign calendar. Do this in a single turn — do NOT draft posts one at a time with save_draft when the ask is for a batch. After it runs, say in one line that the calendar is ready to review and offer to refine any post or generate the images. (save_draft is only for a SINGLE post; run_pipeline is only for one deeply-researched piece.)',
    input_schema: {
      type: 'object',
      properties: {
        brief: { type: 'string', description: 'What the campaign is about — theme, goal, any must-haves. Faithful to the operator\'s intent; you expand it into the arc.' },
        count: { type: 'number', description: 'How many posts to produce. Default 8. Max 12. For "a month" of weekly content use ~4-8; for a denser month use 8-12.' },
        channel: { type: 'string', description: 'LinkedIn | Blog | Email | X | Instagram. Default LinkedIn.' },
        cadence: { type: 'string', description: 'How far apart to schedule: "weekly" (default), "biweekly", or "daily". One post per slot.' },
        start_date: { type: 'string', description: 'Optional ISO date (YYYY-MM-DD) for the first post. Default: the upcoming Monday.' },
        campaign_name: { type: 'string', description: 'Optional short campaign name. If omitted, VERA names it from the brief.' },
      },
      required: ['brief'],
    },
  },
] as const

// Tool execution. Each tool returns { result: string for the model, image_url?: string for the UI }.
async function executeTool(
  name: string,
  input: Record<string, unknown>,
  ctx: {
    orgId: string
    userId: string | null
    projectId: string | null
    supabase: ReturnType<typeof createClient>
    supabaseUrl: string
    serviceKey: string
    emit: (event: Record<string, unknown>) => void
    userPrompt?: string | null
  },
): Promise<{ result: string; image_url?: string; video_url?: string }> {
  try {
    switch (name) {
      // ─── save_draft — VERA wrote the post; persist it + surface the card ──
      // The fast, reliable default. No external orchestrator: VERA composes
      // the copy in-turn, we insert it as Pending Review and emit a `draft`
      // event so the thread renders the artifact immediately.
      case 'save_draft': {
        const copy = String(input.copy ?? '').trim()
        if (!copy) return { result: 'No copy was provided — write the post first, then save it.' }
        const row: Record<string, unknown> = {
          org_id: ctx.orgId,
          project_id: ctx.projectId ?? null,
          title: (input.title as string)?.trim() || null,
          copy,
          channel: (input.channel as string)?.trim() || 'LinkedIn',
          format: (input.format as string)?.trim() || 'Text-only',
          // 'pending' is the content_posts.status default + passes the CHECK
          // constraint (migration 001). Review classifies it into the
          // "Pending Review" tab via tabFor()/isPending(). Do NOT use the
          // display label 'Pending Review' here — it violates the constraint.
          status: 'pending',
        }
        // Store the originating brief so the review link's "Original prompt"
        // panel populates automatically. Strip any injected draft-context tail
        // (the frontend appends it on tweaks) to keep the operator's real ask.
        const originatingPrompt = (ctx.userPrompt ?? '').split('\n\n---\n[The draft currently open')[0].trim()
        if (originatingPrompt) row.media_metadata = { prompt: originatingPrompt.slice(0, 8000) }
        if (Array.isArray(input.hashtags) && input.hashtags.length) {
          row.hashtags = (input.hashtags as unknown[]).map(h => String(h).replace(/^#/, ''))
        }
        const { data, error } = await ctx.supabase
          .from('content_posts').insert(row).select('*').single()
        if (error) return { result: `Couldn't save the draft: ${error.message}` }
        const post = data as Record<string, unknown>
        // Emit the copy immediately so the card appears fast…
        ctx.emit({ type: 'draft', post })

        // …then, if an image was requested, generate it, persist it to the
        // row, and emit an `image` event so it fills into the card. Best-effort:
        // the copy is already saved, so an image failure never loses the draft.
        // TEXT-FIRST: only generate an image when the operator explicitly
        // asked for one (Vera passes image_prompt then). Never auto-derive a
        // visual — a post stays text-only unless a visual was requested.
        const imagePrompt = (input.image_prompt as string)?.trim() || ''
        let imageNote = ''
        if (imagePrompt) {
          ctx.emit({ type: 'tool_progress', tool: 'save_draft', status: 'adding a visual…' })
          try {
            // 'nano-banana' = FAL gemini-flash (~8s). NOT 'nano-banana-pro'
            // (gemini-3-pro via OpenRouter, 45s+) which hung the whole turn.
            // Hard 28s cap so a slow/stuck image never blocks the draft —
            // the copy is already saved + on the card regardless.
            const imgRes = await fetch(`${ctx.supabaseUrl}/functions/v1/generate-image`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${ctx.serviceKey}`, 'apikey': ctx.serviceKey },
              body: JSON.stringify({ prompt: imagePrompt, model: 'nano-banana', image_size: 'square_hd' }),
              signal: AbortSignal.timeout(28000),
            })
            if (imgRes.ok && imgRes.body) {
              const reader = imgRes.body.getReader()
              const decoder = new TextDecoder()
              let buf = ''
              let imageUrl: string | undefined
              while (true) {
                const { done, value } = await reader.read()
                if (done) break
                buf += decoder.decode(value, { stream: true })
                let i
                while ((i = buf.indexOf('\n\n')) !== -1) {
                  const frame = buf.slice(0, i); buf = buf.slice(i + 2)
                  const ln = frame.split('\n').find(l => l.startsWith('data: '))
                  if (!ln) continue
                  try {
                    const e = JSON.parse(ln.slice(6)) as Record<string, unknown>
                    if (e.event === 'done') imageUrl = (e.images as Array<{ url: string }> | undefined)?.[0]?.url
                  } catch { /* skip */ }
                }
              }
              if (imageUrl) {
                let publicUrl = imageUrl
                try { publicUrl = await uploadImageToStorage(ctx.supabase, ctx.orgId, imageUrl) } catch { /* fall back to source */ }
                await ctx.supabase.from('content_posts').update({ media_url: publicUrl }).eq('id', post.id as string)
                post.media_url = publicUrl
                ctx.emit({ type: 'image', url: publicUrl, tool: 'save_draft' })
              } else {
                imageNote = ' (the image didn\'t generate — offer to retry the visual)'
              }
            } else {
              imageNote = ' (the image didn\'t generate — offer to retry the visual)'
            }
          } catch { imageNote = ' (the image didn\'t generate — offer to retry the visual)' }
        }
        return {
          result: `Saved "${post.title ?? 'Untitled'}" to Review as Pending${imageNote}. It's on the draft card now — reply in ONE short line telling the operator it's ready to Approve, Tweak, or Regenerate.`,
        }
      }

      // ─── plan_campaign — the agentic "do the whole job" path ──────────────
      // One ask ("plan the month") → a full content arc. VERA writes every
      // post in a single structured call, dates each by cadence, persists them
      // all as Pending under a new campaign, and emits a `campaign` event so
      // the thread renders a review calendar. Images are deferred (generated on
      // approval/refine) so a batch never hangs on per-post image gen.
      case 'plan_campaign': {
        const brief = String(input.brief ?? '').trim()
        if (!brief) return { result: 'No brief was provided — tell me what the campaign is about.' }
        const count = Math.max(1, Math.min(Number(input.count) || 8, 12))
        const channel = (input.channel as string)?.trim() || 'LinkedIn'
        const cadence = ((input.cadence as string)?.trim() || 'weekly').toLowerCase()
        const stepDays = cadence === 'daily' ? 1 : cadence === 'biweekly' ? 14 : 7

        // First slot: explicit start_date, else the upcoming Monday (09:00 UTC).
        let start = input.start_date ? new Date(String(input.start_date)) : new Date()
        if (isNaN(start.getTime())) start = new Date()
        if (!input.start_date) {
          const add = ((8 - start.getUTCDay()) % 7) || 7  // days to next Monday, never today
          start = new Date(start.getTime() + add * 86400000)
        }
        start.setUTCHours(9, 0, 0, 0)

        ctx.emit({ type: 'tool_progress', tool: 'plan_campaign', status: `planning ${count} ${channel} posts…` })

        // Ground the arc in the brand voice (one query, best-effort).
        const { data: bv } = await loadBrandVoice(ctx.supabase, ctx.orgId, ctx.projectId)
        let brandBrief = ''
        if (bv) {
          const b = bv as Record<string, unknown>
          const parts: string[] = []
          if (b.persona_name || b.persona_descriptor) parts.push(`Voice persona: ${b.persona_name ?? ''} — ${b.persona_descriptor ?? ''}`.trim())
          if (Array.isArray(b.tone) && (b.tone as unknown[]).length) parts.push(`Tone: ${(b.tone as string[]).join(', ')}`)
          if (Array.isArray(b.writing_rules) && (b.writing_rules as unknown[]).length) parts.push(`Rules: ${(b.writing_rules as string[]).join('; ')}`)
          if (Array.isArray(b.forbidden_phrases) && (b.forbidden_phrases as unknown[]).length) parts.push(`Never use: ${(b.forbidden_phrases as string[]).join(', ')}`)
          brandBrief = parts.join('\n')
        }

        // The client's content categories (SocialBee-style buckets) — Vera tags
        // each post so Calendar/Artifacts can filter and the library stays organised.
        let categoryClause = ''
        if (ctx.projectId) {
          const { data: catRows } = await ctx.supabase.from('content_categories').select('name').eq('project_id', ctx.projectId).order('sort_order')
          const names = (catRows ?? []).map(c => (c as { name: string }).name).filter(Boolean)
          if (names.length) categoryClause = `\n\nAssign each post exactly one CATEGORY from this client's set: ${names.join(', ')}. Put the exact category name in the post's "category" field, and spread the campaign sensibly across the categories.`
        }

        // One structured generation call for the whole arc.
        const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY')!
        const planRes = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'x-api-key': anthropicKey, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: MODEL,
            max_tokens: 6000,
            system: `You are VERA, InnovareAI's creative content partner. You write sharp, native ${channel} posts in the brand voice. American spelling. Never invent statistics or fake quotes.${brandBrief ? `\n\nBRAND VOICE:\n${brandBrief}` : ''}`,
            messages: [{
              role: 'user',
              content: `Plan a ${channel} content campaign and write every post.

Brief: ${brief}

Produce a coherent arc of EXACTLY ${count} posts that build on each other (no repeated angles). Each post: a scroll-stopping first line, 80-160 words, native to ${channel}, ending with a light CTA or question. Vary the formats across the arc (story, insight, how-to, contrarian take, list, question).${categoryClause}

Output ONLY valid JSON — no prose, no markdown fences — in exactly this shape:
{"campaign_name":"<short punchy name>","theme":"<one-line narrative anchor>","posts":[{"title":"<4-8 word internal title>","copy":"<the full post>","hashtags":["tag","tag"],"category":"<one category name from the set above, or empty if none>"}]}`,
            }],
          }),
        })
        if (!planRes.ok) return { result: `Campaign planning failed: ${planRes.status} ${(await planRes.text()).slice(0, 160)}` }
        const planData = await planRes.json() as { content?: Array<{ type: string; text?: string }> }
        const rawText = (planData.content ?? []).filter(b => b.type === 'text').map(b => b.text).join('').trim()
        const jsonStr = rawText.slice(rawText.indexOf('{'), rawText.lastIndexOf('}') + 1)
        let plan: { campaign_name?: string; theme?: string; posts?: Array<{ title?: string; copy?: string; hashtags?: string[]; image_prompt?: string; category?: string }> }
        try { plan = JSON.parse(jsonStr) } catch { return { result: 'Campaign planning returned malformed output — try again.' } }
        const planned = (plan.posts ?? []).filter(p => p && (p.copy ?? '').trim())
        if (!planned.length) return { result: 'Campaign planning produced no posts — try again with a clearer brief.' }

        const campaignName = (input.campaign_name as string)?.trim() || plan.campaign_name?.trim() || brief.slice(0, 60)
        const startISO = start.toISOString()
        const endISO = new Date(start.getTime() + (planned.length - 1) * stepDays * 86400000).toISOString()

        // Create the campaign, then insert all posts as Pending, dated by cadence.
        const { data: campaign, error: campErr } = await ctx.supabase.from('campaigns').insert({
          org_id: ctx.orgId,
          project_id: ctx.projectId ?? null,
          name: campaignName,
          theme: plan.theme ?? null,
          goal: brief.slice(0, 280),
          status: 'active',
          start_date: startISO.slice(0, 10),
          end_date: endISO.slice(0, 10),
          platforms: [channel],
          post_count: planned.length,
        }).select('id').single()
        if (campErr) return { result: `Couldn't create the campaign: ${campErr.message}` }
        const campaignId = (campaign as Record<string, unknown>).id as string

        const rows = planned.map((p, i) => ({
          org_id: ctx.orgId,
          project_id: ctx.projectId ?? null,
          campaign_id: campaignId,
          title: (p.title ?? '').trim() || `${campaignName} — ${i + 1}`,
          copy: (p.copy ?? '').trim(),
          channel,
          format: 'Text-only',
          status: 'pending',
          hashtags: Array.isArray(p.hashtags) ? p.hashtags.map(h => String(h).replace(/^#/, '')) : null,
          category: (p.category ?? '').trim() || null,
          scheduled_at: new Date(start.getTime() + i * stepDays * 86400000).toISOString(),
        }))
        const { data: inserted, error: postErr } = await ctx.supabase
          .from('content_posts').insert(rows)
          .select('id, title, copy, channel, status, scheduled_at, hashtags, category, campaign_id')
        if (postErr) return { result: `Drafted the plan but couldn't save the posts: ${postErr.message}` }

        ctx.emit({
          type: 'campaign',
          campaign: { id: campaignId, name: campaignName, theme: plan.theme ?? null, channel, cadence, count: (inserted ?? []).length },
          posts: inserted ?? [],
        })

        return {
          result: `Planned and drafted ${(inserted ?? []).length} ${channel} posts for "${campaignName}" (${cadence}, ${startISO.slice(0, 10)} → ${endISO.slice(0, 10)}). All saved as Pending and laid out on the campaign calendar in the panel. Reply in ONE short line: it's ready to review, and you can refine any post or generate the images on approval.`,
        }
      }

      // ─── refine_post — edit an EXISTING post in place (Review feedback) ──
      case 'refine_post': {
        const postId = String(input.post_id ?? '')
        if (!postId) return { result: 'No post_id was provided.' }
        const { data: existing } = await ctx.supabase.from('content_posts').select('id, title').eq('id', postId).maybeSingle()
        if (!existing) return { result: 'That post no longer exists.' }
        const updates: Record<string, unknown> = {}
        const newCopy = (input.copy as string)?.trim()
        if (newCopy) updates.copy = newCopy
        const imgPrompt = (input.image_prompt as string)?.trim()
        const vidPrompt = (input.video_prompt as string)?.trim()
        let changed = newCopy ? 'copy' : ''
        if (imgPrompt || vidPrompt) {
          ctx.emit({ type: 'tool_progress', tool: 'refine_post', status: imgPrompt ? 'regenerating the image…' : 'regenerating the video…' })
          try {
            const fn = imgPrompt ? 'generate-image' : 'generate-video'
            const body = imgPrompt
              ? { prompt: imgPrompt, model: 'nano-banana', image_size: 'square_hd' }
              : { prompt: vidPrompt, model: 'veo-3', aspect_ratio: '16:9' }
            const res = await fetch(`${ctx.supabaseUrl}/functions/v1/${fn}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${ctx.serviceKey}`, 'apikey': ctx.serviceKey },
              body: JSON.stringify(body),
              signal: AbortSignal.timeout(imgPrompt ? 30000 : 120000),
            })
            if (res.ok && res.body) {
              const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = ''; let url: string | undefined
              while (true) {
                const { done, value } = await reader.read(); if (done) break
                buf += dec.decode(value, { stream: true }); let i
                while ((i = buf.indexOf('\n\n')) !== -1) {
                  const fr = buf.slice(0, i); buf = buf.slice(i + 2)
                  const ln = fr.split('\n').find(l => l.startsWith('data: ')); if (!ln) continue
                  try {
                    const e = JSON.parse(ln.slice(6)) as Record<string, unknown>
                    if (e.event === 'done') url = imgPrompt ? (e.images as Array<{ url: string }> | undefined)?.[0]?.url : (e.video as { url?: string } | undefined)?.url
                  } catch { /* skip */ }
                }
              }
              if (url) {
                if (imgPrompt) { try { url = await uploadImageToStorage(ctx.supabase, ctx.orgId, url) } catch { /* keep source */ } }
                updates.media_url = url
                changed = imgPrompt ? 'image' : 'video'
              }
            }
          } catch { /* visual regen is best-effort; copy (if any) still applies */ }
        }
        if (Object.keys(updates).length === 0) {
          return { result: "I couldn't tell whether to change the copy, image, or video — ask the operator to be a touch more specific." }
        }
        updates.updated_at = new Date().toISOString()
        const { data: updated, error: upErr } = await ctx.supabase.from('content_posts').update(updates).eq('id', postId).select('*').single()
        if (upErr) return { result: `Couldn't save the change: ${upErr.message}` }
        if (updated) ctx.emit({ type: 'draft', post: updated })
        return { result: `Updated the ${changed || 'post'} on "${(updated as Record<string, unknown>)?.title ?? 'the post'}". Reply in ONE short line telling the operator what you changed.` }
      }

      // ─── run_pipeline — drive the 9-agent orchestrator from the thread ──
      // The single composer drives both chat and drafting: VERA calls this
      // when the operator briefs a post. We proxy the orchestrator's SSE,
      // surface each agent as a calm progress caption, then emit a `draft`
      // event with the saved post so the frontend renders a Draft card.
      case 'run_pipeline': {
        const brief = String(input.brief ?? '').trim()
        if (!brief) return { result: 'No brief was provided — ask the operator what to create.' }

        // The model sometimes passes a campaign/audience *name* instead of a
        // UUID. content_posts.campaign_id is a uuid FK, so a name makes the
        // orchestrator's INSERT fail and no draft lands. Forward only real
        // UUIDs; drop anything else to null.
        const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
        const asUuid = (v: unknown) => (typeof v === 'string' && UUID_RE.test(v.trim())) ? v.trim() : null

        const res = await fetch(`${ctx.supabaseUrl}/functions/v1/vera-orchestrator`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${ctx.serviceKey}`,
            'apikey': ctx.serviceKey,
          },
          body: JSON.stringify({
            prompt: brief,
            org_id: ctx.orgId,
            campaign_id: asUuid(input.campaign_id),
            audience_id: asUuid(input.audience_id),
          }),
        })
        if (!res.ok || !res.body) {
          return { result: `The pipeline failed to start (HTTP ${res.status}). Tell the operator and offer to retry.` }
        }

        // Plain-language captions — the operator never sees the agent roster.
        const STEP: Record<string, string> = {
          VERA: 'Getting started', Strategist: 'Planning the angle',
          Researcher: 'Gathering supporting facts', Writer: 'Writing the draft',
          'SEO Agent': 'Tuning for search', 'Persona Adapter': 'Tailoring to the audience',
          'Brand Guard': 'Checking brand voice', Compliance: 'Compliance review',
          Publisher: 'Finishing up',
        }
        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buf = ''
        let lastAgent = ''
        // The orchestrator streams { agent, chunk, done } frames. The final
        // Publisher agent prints a "✅ Saved … ID: <uuid>" line — capture its
        // text so we can fetch the EXACT row it wrote, instead of guessing
        // with an org-scoped "most recent" query (which misses if the
        // orchestrator saved under a different org or two runs race).
        let publisherText = ''
        let streamError = ''
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buf += decoder.decode(value, { stream: true })
          const lines = buf.split('\n')
          buf = lines.pop() ?? ''
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue
            try {
              const ev = JSON.parse(line.slice(6).trim())
              if (ev.agent && ev.agent !== lastAgent) {
                lastAgent = ev.agent
                ctx.emit({ type: 'tool_progress', tool: 'run_pipeline', status: STEP[ev.agent] ?? ev.agent })
              }
              if (ev.agent === 'Publisher' && typeof ev.chunk === 'string') publisherText += ev.chunk
              if (ev.error) streamError = String(ev.error)
            } catch { /* ignore malformed SSE frame */ }
          }
        }

        if (streamError) {
          return { result: `The pipeline hit an error: ${streamError.slice(0, 200)}. Tell the operator plainly and offer to retry.` }
        }

        // Resolve the saved post. Primary: the post id the Publisher printed
        // (fetch by primary key — no org filter needed, it's the exact row).
        // Fallback: freshest post for this org (older orchestrator builds
        // didn't print an id in the stream).
        let post: Record<string, unknown> | undefined
        const idMatch = publisherText.match(/ID:\s*([a-f0-9-]{8,})/i)
        if (idMatch) {
          const { data } = await ctx.supabase.from('content_posts').select('*').eq('id', idMatch[1]).maybeSingle()
          post = (data as Record<string, unknown> | null) ?? undefined
        }
        if (!post) {
          const { data } = await ctx.supabase
            .from('content_posts').select('*')
            .eq('org_id', ctx.orgId)
            .order('created_at', { ascending: false })
            .limit(1)
          post = data?.[0] as Record<string, unknown> | undefined
        }
        if (!post) {
          // Surface the Publisher's own words (e.g. a compliance ⚠️ block) so
          // the operator sees WHY rather than a generic failure.
          const why = publisherText.trim().slice(-280)
          return { result: why
            ? `The pipeline finished but didn't save a draft. The Publisher reported:\n${why}\nRelay the gist to the operator and offer to retry.`
            : 'The pipeline finished but no draft landed in the review queue — tell the operator and offer to retry.' }
        }

        if (ctx.projectId && !post.project_id) {
          await ctx.supabase.from('content_posts').update({ project_id: ctx.projectId }).eq('id', post.id as string)
          post.project_id = ctx.projectId
        }

        ctx.emit({ type: 'draft', post })
        return {
          result: `Draft created: "${post.title ?? 'Untitled'}" for ${post.channel ?? 'the feed'}. It's surfaced as a card in the thread and saved to Review as Pending. Reply in one short line — tell the operator it's ready to Approve, Tweak, or Regenerate.`,
        }
      }
      case 'generate_infographic':
      case 'generate_image': {
        // Both pipe to the same image stack via the relevant edge function.
        // Bridge progress events so the operator sees the work happening.
        const target = name === 'generate_infographic' ? 'generate-infographic' : 'generate-image'
        const body = name === 'generate_infographic'
          ? input
          : {
              prompt: input.prompt,
              model: 'nano-banana-pro',
              image_size: (input.aspect_ratio as string) ?? 'square_hd',
              quality: 'high',
            }

        const res = await fetch(`${ctx.supabaseUrl}/functions/v1/${target}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${ctx.serviceKey}`,
            'apikey': ctx.serviceKey,
          },
          body: JSON.stringify(body),
        })
        if (!res.ok || !res.body) {
          const errText = await res.text().catch(() => '')
          return { result: `Image generation failed: HTTP ${res.status} ${errText.slice(0, 150)}` }
        }

        // Drain the SSE stream from the upstream image function
        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        let imageUrl: string | undefined
        let lastStatus = ''

        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          let idx
          while ((idx = buffer.indexOf('\n\n')) !== -1) {
            const frame = buffer.slice(0, idx)
            buffer = buffer.slice(idx + 2)
            const line = frame.split('\n').find(l => l.startsWith('data: '))
            if (!line) continue
            try {
              const event = JSON.parse(line.slice(6)) as Record<string, unknown>
              if (event.event === 'status') {
                const elapsed = (event.elapsed_s as number) ?? 0
                lastStatus = `rendering… ${elapsed.toFixed(1)}s`
                ctx.emit({ type: 'tool_progress', tool: name, status: lastStatus })
              } else if (event.event === 'done') {
                const images = event.images as Array<{ url: string }> | undefined
                imageUrl = images?.[0]?.url
              } else if (event.event === 'error') {
                return { result: `Image generation error: ${event.message}` }
              }
            } catch { /* skip malformed frames */ }
          }
        }

        if (!imageUrl) {
          return { result: 'Image generation completed but no URL was returned.' }
        }

        // Upload to Supabase Storage so we get a stable public URL that
        // persists in chat_messages.attachments instead of an ephemeral
        // data URL or fal.media link.
        let publicUrl = imageUrl
        try {
          publicUrl = await uploadImageToStorage(ctx.supabase, ctx.orgId, imageUrl)
        } catch (uploadErr) {
          console.warn('storage upload failed, falling back to source URL', uploadErr)
        }

        return {
          result: `Image generated successfully and stored. URL: ${publicUrl.slice(0, 80)}${publicUrl.length > 80 ? '…' : ''}`,
          image_url: publicUrl,
        }
      }

      case 'generate_carousel': {
        const frames = Array.isArray(input.frames) ? (input.frames as Array<{ image_prompt?: string; text?: string }>) : []
        if (!frames.length) return { result: 'No carousel frames provided — pass one entry per frame.' }
        const aspect = (input.aspect_ratio as string) ?? 'square_hd'
        // Resolve the post to attach to (the caption save_draft just created).
        let postId = (input.post_id as string) ?? null
        if (!postId) {
          let q = ctx.supabase.from('content_posts').select('id').eq('org_id', ctx.orgId).is('media_url', null).order('created_at', { ascending: false }).limit(1)
          if (ctx.projectId) q = q.eq('project_id', ctx.projectId)
          const { data: latest } = await q.maybeSingle()
          postId = (latest as { id?: string } | null)?.id ?? null
        }
        // DON'T render the frames here. Generating 5 images inside this SSE turn
        // holds the edge isolate open past its wall-clock limit and it gets
        // force-killed ("early termination"). Hand off to the generate-carousel
        // background worker (EdgeRuntime.waitUntil): it enqueues a durable
        // media_jobs row, returns instantly, and renders the frames server-side,
        // writing them onto the post as they finish. The browser just watches the
        // post — generation survives a closed tab.
        try {
          const jobRes = await fetch(`${ctx.supabaseUrl}/functions/v1/generate-carousel`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${ctx.serviceKey}`, 'apikey': ctx.serviceKey },
            body: JSON.stringify({ post_id: postId, project_id: ctx.projectId ?? null, frames, aspect }),
            signal: AbortSignal.timeout(15000),
          })
          if (!jobRes.ok) {
            const errText = await jobRes.text().catch(() => '')
            return { result: `Carousel could not be queued: HTTP ${jobRes.status} ${errText.slice(0, 120)}. Tell the operator and offer to retry.` }
          }
        } catch (e) {
          return { result: `Carousel could not be queued: ${(e as Error).message}. Offer to retry.` }
        }
        ctx.emit({ type: 'carousel_job', post_id: postId, total: frames.length })
        return { result: `Carousel of ${frames.length} frames is rendering on the server now — the frames appear on the draft card as each one finishes (this keeps going even if the tab is closed). Reply in ONE short line; do NOT call this tool again.` }
      }

      case 'generate_video': {
        // Video gen takes 60-120s — far longer than the gateway will hold an
        // SSE connection open (it cuts ~47s in, surfacing as a "network error").
        // So we DON'T wait here. We submit the fal job, hand the request_id to
        // the browser via a `video_pending` event, and return immediately. The
        // frontend then polls generate-video (action:'status') with short
        // requests until the MP4 is ready — no long-held connection, no timeout.
        const body = {
          action: 'submit',
          prompt: input.prompt as string,
          model: (input.model as string) ?? (input.image_url ? 'kling-3' : 'veo-3'),
          image_url: (input.image_url as string) ?? undefined,
          aspect_ratio: (input.aspect_ratio as string) ?? '16:9',
        }
        const res = await fetch(`${ctx.supabaseUrl}/functions/v1/generate-video`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${ctx.serviceKey}`,
            'apikey': ctx.serviceKey,
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(20000),
        })
        if (!res.ok) {
          const errText = await res.text().catch(() => '')
          return { result: `Video submission failed: HTTP ${res.status} ${errText.slice(0, 150)}` }
        }
        const data = await res.json().catch(() => ({})) as { request_id?: string; slug?: string }
        if (!data.request_id) {
          return { result: 'Video submission failed: fal did not return a request id.' }
        }
        ctx.emit({
          type: 'video_pending',
          request_id: data.request_id,
          slug: data.slug ?? body.model,
          prompt: body.prompt,
        })
        return {
          result: `Video job submitted and rendering now (typically 1-2 minutes). The clip will appear in this chat automatically the moment it's ready — no need to wait, re-ask, or call this tool again.`,
        }
      }

      case 'remember': {
        const key = input.key as string
        const value = input.value as string
        const kind = (input.kind as string) ?? 'fact'

        const { error } = await ctx.supabase.from('vera_memories').upsert({
          org_id: ctx.orgId,
          user_id: ctx.userId,
          key,
          value,
          kind,
          source: 'chat',
          is_pinned: true,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'org_id,user_id,key' })

        if (error) return { result: `Failed to save memory: ${error.message}` }
        return { result: `Memory saved: ${key} = ${value.slice(0, 100)}${value.length > 100 ? '…' : ''}` }
      }

      case 'list_pending_posts': {
        const channel = input.channel as string | undefined
        const limit = Math.min((input.limit as number) ?? 10, 50)
        let q = ctx.supabase.from('content_posts')
          .select('id, title, channel, format, copy, created_at')
          .eq('org_id', ctx.orgId)
          .eq('status', 'Pending Review')
          .order('created_at', { ascending: false })
          .limit(limit)
        if (channel) q = q.eq('channel', channel)
        const { data, error } = await q
        if (error) return { result: `Query failed: ${error.message}` }
        if (!data?.length) return { result: 'No posts pending review.' }
        const lines = (data as Array<Record<string, unknown>>).map((p, i) => {
          const id = (p.id as string).slice(0, 8)
          const ch = p.channel ?? '?'
          const title = (p.title as string | null) ?? '(untitled)'
          const excerpt = ((p.copy as string | null) ?? '').slice(0, 80).replace(/\s+/g, ' ').trim()
          const days = Math.floor((Date.now() - new Date(p.created_at as string).getTime()) / 86400000)
          return `${i + 1}. [${id}] ${ch} · ${title} (${days}d old)\n   ${excerpt}…`
        })
        return { result: `${data.length} pending posts:\n${lines.join('\n')}` }
      }

      case 'get_post_detail': {
        const postId = input.post_id as string | undefined
        const match = input.match_title as string | undefined
        let q = ctx.supabase.from('content_posts')
          .select('id, title, channel, format, status, copy, hashtags, media_url, posted_url, scheduled_at, posted_at, feedback, created_at, updated_at')
          .eq('org_id', ctx.orgId)
          .limit(1)
        if (postId) q = q.eq('id', postId)
        else if (match) q = q.ilike('title', `%${match}%`)
        else return { result: 'Either post_id or match_title is required.' }
        const { data, error } = await q.maybeSingle()
        if (error) return { result: `Lookup failed: ${error.message}` }
        if (!data) return { result: 'No matching post found.' }
        const p = data as Record<string, unknown>
        const parts = [
          `Post ${(p.id as string).slice(0, 8)} — ${p.title ?? '(untitled)'}`,
          `Channel: ${p.channel} · Format: ${p.format} · Status: ${p.status}`,
          `Created: ${p.created_at} · Updated: ${p.updated_at}`,
        ]
        if (p.posted_url) parts.push(`Posted: ${p.posted_url}`)
        if (p.scheduled_at) parts.push(`Scheduled: ${p.scheduled_at}`)
        if (Array.isArray(p.hashtags) && (p.hashtags as string[]).length) {
          parts.push(`Hashtags: ${(p.hashtags as string[]).join(' ')}`)
        }
        if (p.feedback) parts.push(`Feedback: ${p.feedback}`)
        parts.push(`\nCopy:\n${p.copy ?? '(empty)'}`)
        return { result: parts.join('\n') }
      }

      case 'search_skills': {
        const query = input.query as string
        const limit = Math.min((input.limit as number) ?? 5, 20)
        const { data, error } = await ctx.supabase.from('skills')
          .select('name, type, description, prompt_module')
          .or(`org_id.is.null,org_id.eq.${ctx.orgId}`)
          .eq('is_active', true)
          .or(`name.ilike.%${query}%,description.ilike.%${query}%,tags.cs.{${query}}`)
          .limit(limit)
        if (error) return { result: `Search failed: ${error.message}` }
        if (!data?.length) return { result: `No skills matched "${query}".` }
        const lines = (data as Array<Record<string, unknown>>).map(s =>
          `${s.name} [${s.type}]\n  ${s.description}\n\nFull recipe:\n${(s.prompt_module as string).slice(0, 1200)}${(s.prompt_module as string).length > 1200 ? '…' : ''}`,
        )
        return { result: `${data.length} skill(s) match "${query}":\n\n${lines.join('\n\n---\n\n')}` }
      }

      case 'recall_memory': {
        const query = input.query as string
        const limit = Math.min((input.limit as number) ?? 8, 30)
        const { data, error } = await ctx.supabase.from('vera_memories')
          .select('key, value, kind, created_at')
          .eq('org_id', ctx.orgId)
          .or(`user_id.is.null${ctx.userId ? `,user_id.eq.${ctx.userId}` : ''}`)
          .or(`key.ilike.%${query}%,value.ilike.%${query}%`)
          .order('created_at', { ascending: false })
          .limit(limit)
        if (error) return { result: `Memory recall failed: ${error.message}` }
        if (!data?.length) return { result: `No memories matched "${query}".` }
        const lines = (data as Array<Record<string, unknown>>).map(m =>
          `[${m.kind}] ${m.key}: ${m.value}`,
        )
        return { result: `${data.length} memor${data.length === 1 ? 'y' : 'ies'} matching "${query}":\n${lines.join('\n')}` }
      }

      case 'create_skill': {
        const { name, type, description, prompt_module } = input as Record<string, string>
        const { error } = await ctx.supabase.from('skills').insert({
          org_id: ctx.orgId,
          type, name, description, prompt_module,
          injected_into: 'writer',
          is_active: true, is_system: false,
        })
        if (error) return { result: `Failed to create skill: ${error.message}` }
        return { result: `Skill created: "${name}" [${type}]. It will be available in your next chat turn.` }
      }

      case 'update_brand_voice': {
        const field = input.field as string
        const operation = input.operation as string
        const value = input.value as string
        const arrayFields = new Set(['tone', 'forbidden_phrases', 'required_phrases', 'writing_rules'])
        const { data: existing } = await ctx.supabase.from('brand_voice')
          .select('id, ' + field).eq('org_id', ctx.orgId).maybeSingle()
        if (!existing?.id) {
          // Bootstrap a row if none exists
          await ctx.supabase.from('brand_voice').insert({ org_id: ctx.orgId })
        }
        let newValue: unknown
        if (arrayFields.has(field)) {
          const current = ((existing as Record<string, unknown> | null)?.[field] as string[] | null) ?? []
          if (operation === 'append') newValue = Array.from(new Set([...current, value]))
          else if (operation === 'remove') newValue = current.filter(v => v !== value)
          else newValue = [value]
        } else {
          newValue = value
        }
        const { error } = await ctx.supabase.from('brand_voice')
          .update({ [field]: newValue, updated_at: new Date().toISOString() })
          .eq('org_id', ctx.orgId)
        if (error) return { result: `Brand voice update failed: ${error.message}` }
        return { result: `Brand voice updated: ${field} (${operation}) → ${typeof newValue === 'object' ? JSON.stringify(newValue).slice(0, 200) : value.slice(0, 200)}` }
      }

      case 'summarize_recent_activity': {
        const days = (input.days as number) ?? 7
        const since = new Date(Date.now() - days * 86400000).toISOString()
        const [postsRes, auditsRes] = await Promise.all([
          ctx.supabase.from('content_posts')
            .select('status, channel, created_at, posted_at, updated_at')
            .eq('org_id', ctx.orgId).gte('updated_at', since),
          ctx.supabase.from('linkedin_audits')
            .select('kind, created_at')
            .eq('org_id', ctx.orgId).gte('created_at', since),
        ])
        const posts = (postsRes.data ?? []) as Array<{ status: string; channel: string; created_at: string; posted_at: string | null }>
        const audits = (auditsRes.data ?? []) as Array<{ kind: string; created_at: string }>
        const created = posts.filter(p => new Date(p.created_at).getTime() >= Date.now() - days * 86400000).length
        const posted = posts.filter(p => p.posted_at).length
        const byStatus = posts.reduce<Record<string, number>>((acc, p) => {
          acc[p.status] = (acc[p.status] ?? 0) + 1
          return acc
        }, {})
        const byChannel = posts.reduce<Record<string, number>>((acc, p) => {
          acc[p.channel] = (acc[p.channel] ?? 0) + 1
          return acc
        }, {})
        const lines = [
          `Last ${days} days:`,
          `  ${created} posts created, ${posted} went live`,
          `  Status: ${Object.entries(byStatus).map(([s, n]) => `${n} ${s}`).join(', ') || 'no activity'}`,
          `  Channels: ${Object.entries(byChannel).map(([c, n]) => `${n} ${c}`).join(', ') || '—'}`,
          `  Audits run: ${audits.length} (${audits.map(a => a.kind).join(', ') || 'none'})`,
        ]
        return { result: lines.join('\n') }
      }

      case 'schedule_post': {
        const { post_id, scheduled_at } = input as { post_id: string; scheduled_at: string }
        const { error } = await ctx.supabase.from('content_posts')
          .update({ scheduled_at, updated_at: new Date().toISOString() })
          .eq('id', post_id).eq('org_id', ctx.orgId)
        if (error) return { result: `Schedule failed: ${error.message}` }
        return { result: `Post ${post_id.slice(0, 8)} scheduled for ${scheduled_at}.` }
      }

      case 'run_audit': {
        const kind = input.kind as string
        if (kind === 'all') {
          const { error } = await ctx.supabase.rpc('refresh_all_linkedin_audits')
          if (error) return { result: `Audit refresh failed: ${error.message}` }
          return { result: 'All audits queued — profile + brew360 + content. Results in ~30s on the LinkedIn audit page.' }
        }
        // Single audit kind: hit the corresponding edge function async
        const fnMap: Record<string, string> = {
          profile: 'linkedin-profile-score',
          brew360: 'brew360-audit',
          content: 'content-audit',
        }
        const fn = fnMap[kind]
        if (!fn) return { result: `Unknown audit kind: ${kind}` }
        // Fire-and-forget
        fetch(`${ctx.supabaseUrl}/functions/v1/${fn}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${ctx.serviceKey}`, 'apikey': ctx.serviceKey },
          body: JSON.stringify({ org_id: ctx.orgId }),
        }).catch(() => {})
        return { result: `${kind} audit kicked off — check the LinkedIn audit page in ~30s.` }
      }

      case 'generate_video_brief': {
        const format = input.format as string
        const topic = input.topic as string
        const audience = input.audience as string | undefined
        const skillNameMap: Record<string, string> = {
          youtube_long: 'YouTube long-form video script',
          short_form_vertical: 'Short-form vertical video script',
          webinar: 'Webinar / talk script',
          animated_explainer: 'Animated explainer brief',
        }
        const skillName = skillNameMap[format] ?? format
        const { data: skill } = await ctx.supabase.from('skills')
          .select('prompt_module').eq('name', skillName).is('org_id', null).maybeSingle()
        const recipe = (skill?.prompt_module as string) ?? '(recipe not found — improvise)'
        return {
          result: `Video brief template for "${topic}" (format: ${format}${audience ? `, audience: ${audience}` : ''}):\n\n${recipe.slice(0, 600)}…\n\nNext: feed this into the generate-video edge function, or expand inline if you want a draft script.`,
        }
      }

      case 'kb_ingest': {
        const content = input.content as string
        const kind = (input.kind as string) ?? 'note'
        const title = (input.title as string | undefined)
          ?? content.split('\n').find(l => l.trim().length > 0)?.replace(/^#+\s*/, '').slice(0, 120)
          ?? '(untitled)'
        const source = (input.source as string | undefined) ?? 'manual'

        const embedding = await embedText(content)
        const { data: row, error } = await ctx.supabase.from('kb_raw').insert({
          org_id: ctx.orgId,
          kind, source, title, content,
          embedding: embedding ? vec(embedding) : null,
          ingested_by: ctx.userId,
        }).select('id').single()
        if (error) return { result: `KB ingest failed: ${error.message}` }
        // Audit log
        ctx.supabase.from('kb_change_log').insert({
          org_id: ctx.orgId, event: 'ingest', ref_table: 'kb_raw',
          ref_id: (row as { id: string }).id,
          detail: { kind, title, source, embedded: !!embedding },
        }).then(() => {})
        return {
          result: `Ingested "${title}" [${kind}] into the knowledge base. ${embedding ? 'Embedded and searchable.' : 'Stored without embedding (OpenAI key issue) — still searchable by keyword.'}`,
        }
      }

      case 'kb_search': {
        const query = input.query as string
        const limit = Math.min((input.limit as number) ?? 6, 20)
        const embedding = await embedText(query)
        if (!embedding) {
          // Fallback: keyword search across raw + articles
          const { data, error } = await ctx.supabase.from('kb_raw')
            .select('id, title, content, kind, source')
            .eq('org_id', ctx.orgId)
            .or(`title.ilike.%${query}%,content.ilike.%${query}%`)
            .limit(limit)
          if (error) return { result: `KB search failed: ${error.message}` }
          if (!data?.length) return { result: `No KB matches for "${query}".` }
          return {
            result: (data as Array<Record<string, unknown>>).map((r, i) =>
              `${i + 1}. [${r.kind}] ${r.title}: ${((r.content as string) ?? '').slice(0, 200)}…`,
            ).join('\n'),
          }
        }
        // Semantic search via RPC
        const { data, error } = await ctx.supabase.rpc('kb_semantic_search', {
          org_filter: ctx.orgId,
          query_embedding: vec(embedding),
          match_count: limit,
          threshold: 0.4,
        })
        if (error) return { result: `Semantic search failed: ${error.message}` }
        if (!data?.length) return { result: `No KB matches for "${query}" (semantic search returned nothing above the relevance threshold).` }
        const rows = data as Array<{ source: string; id: string; title: string; excerpt: string; similarity: number }>
        const lines = rows.map((r, i) =>
          `${i + 1}. [${r.source}] ${r.title} (sim ${(r.similarity * 100).toFixed(0)}%)\n   ${r.excerpt}…`,
        )
        return { result: `${rows.length} KB match${rows.length === 1 ? '' : 'es'} for "${query}":\n${lines.join('\n')}` }
      }

      case 'kb_synthesize': {
        const topic = input.topic as string
        const themes = (input.themes as string[] | undefined) ?? []
        let sourceIds = (input.source_ids as string[] | undefined) ?? []

        // If no source_ids provided, find relevant raw items via semantic search
        if (sourceIds.length === 0) {
          const embedding = await embedText(topic)
          if (embedding) {
            const { data } = await ctx.supabase.rpc('kb_semantic_search', {
              org_filter: ctx.orgId,
              query_embedding: vec(embedding),
              match_count: 8,
              threshold: 0.35,
            })
            sourceIds = ((data ?? []) as Array<{ source: string; id: string }>)
              .filter(r => r.source === 'raw')
              .map(r => r.id)
          }
        }
        if (sourceIds.length === 0) {
          return { result: `Can't synthesize "${topic}" — no relevant raw items found. Ingest some source material first.` }
        }

        // Fetch the source content
        const { data: sources } = await ctx.supabase.from('kb_raw')
          .select('id, title, content, source, kind')
          .in('id', sourceIds)
          .eq('org_id', ctx.orgId)
          .limit(8)
        if (!sources?.length) return { result: 'Source items not found.' }

        // Compose the article via Claude (use the same anthropic instance)
        const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY')!
        const synthRes = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'x-api-key': anthropicKey,
            'anthropic-version': '2023-06-01',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'claude-sonnet-4-6',
            max_tokens: 3000,
            system: 'You are a research librarian synthesizing source material into a canonical wiki article. Output Markdown only.',
            messages: [{
              role: 'user',
              content: `Synthesize a wiki article on the topic: "${topic}".

Sources (verbatim, cite by [source N] inline where you draw a claim from one):

${(sources as Array<Record<string, unknown>>).map((s, i) =>
  `[source ${i + 1}] ${s.title} (${s.kind}, ${s.source ?? 'unknown'}):\n${(s.content as string).slice(0, 4000)}`,
).join('\n\n---\n\n')}

Write the article with:
- A clear opener stating what this article is about (1-2 sentences)
- Body organized in markdown headings, citing sources inline
- A "Sources" section at the bottom listing the references
- 400-1000 words

Do NOT fabricate claims. If sources contradict, surface the contradiction.`,
            }],
          }),
        })
        if (!synthRes.ok) {
          return { result: `Synthesis failed: ${synthRes.status} ${(await synthRes.text()).slice(0, 200)}` }
        }
        const synthData = await synthRes.json() as { content?: Array<{ type: string; text?: string }> }
        const body = (synthData.content ?? []).filter(b => b.type === 'text').map(b => b.text).join('').trim()
        if (!body) return { result: 'Synthesis returned empty body.' }

        // Extract a 1-2 sentence summary (first 2 sentences after any frontmatter)
        const summary = body.replace(/^#.*\n+/g, '').split(/(?<=[.!?])\s+/).slice(0, 2).join(' ').slice(0, 240)

        // Slug from topic
        const slug = topic.toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, '')
          .slice(0, 60)

        const embedding = await embedText(`${topic}\n${summary}\n${body}`)
        const { data: article, error: artErr } = await ctx.supabase.from('kb_articles').upsert({
          org_id: ctx.orgId,
          slug,
          title: topic,
          summary,
          body,
          themes,
          source_ids: sourceIds,
          status: 'published',
          embedding: embedding ? vec(embedding) : null,
        }, { onConflict: 'org_id,slug' }).select('id').single()
        if (artErr) return { result: `Save failed: ${artErr.message}` }

        ctx.supabase.from('kb_change_log').insert({
          org_id: ctx.orgId, event: 'synthesize', ref_table: 'kb_articles',
          ref_id: (article as { id: string }).id,
          detail: { topic, slug, source_count: sources.length, themes },
        }).then(() => {})

        return {
          result: `Wiki article "${topic}" (${slug}) synthesized from ${sources.length} source${sources.length === 1 ? '' : 's'}. ${body.length} chars, ${embedding ? 'embedded' : 'not embedded'}. It's now part of the workspace context.`,
        }
      }

      case 'kb_audit_summary': {
        const projectKnowledgeQuery = ctx.projectId
          ? ctx.supabase.from('project_knowledge')
            .select('id, title, kind, source_kind, classified_at, created_at', { count: 'exact' })
            .eq('project_id', ctx.projectId)
            .order('created_at', { ascending: false })
            .limit(100)
          : Promise.resolve({ data: [], count: 0 })

        const [rawRes, articlesRes, revisionsRes, recentRes, rawDetailRes, changeRes, projectRes] = await Promise.all([
          ctx.supabase.from('kb_raw').select('id', { count: 'exact', head: true }).eq('org_id', ctx.orgId),
          ctx.supabase.from('kb_articles')
            .select('id, title, summary, themes, source_ids, status, updated_at', { count: 'exact' })
            .eq('org_id', ctx.orgId)
            .order('updated_at', { ascending: true })
            .limit(100),
          ctx.supabase.from('kb_article_revisions').select('id, kind, confidence, changes_summary').eq('org_id', ctx.orgId).eq('status', 'pending').order('created_at', { ascending: false }).limit(10),
          ctx.supabase.from('kb_raw').select('title, kind, ingested_at').eq('org_id', ctx.orgId).order('ingested_at', { ascending: false }).limit(5),
          ctx.supabase.from('kb_raw')
            .select('id, title, kind, source, ingested_at')
            .eq('org_id', ctx.orgId)
            .order('ingested_at', { ascending: false })
            .limit(100),
          ctx.supabase.from('kb_change_log')
            .select('event, ref_table, detail, recorded_at')
            .eq('org_id', ctx.orgId)
            .order('recorded_at', { ascending: false })
            .limit(6),
          projectKnowledgeQuery,
        ])
        const articles = (articlesRes.data ?? []) as Array<{
          id: string
          title: string
          summary: string | null
          themes: string[] | null
          source_ids: string[] | null
          status: string
          updated_at: string
        }>
        const rawItems = (rawDetailRes.data ?? []) as Array<{
          id: string
          title: string | null
          kind: string
          source: string | null
          ingested_at: string
        }>
        const byStatus = articles.reduce<Record<string, number>>((acc, a) => {
          acc[a.status] = (acc[a.status] ?? 0) + 1; return acc
        }, {})
        const revisions = (revisionsRes.data ?? []) as Array<{ kind: string; confidence: number | string | null; changes_summary: string | null }>
        const recent = (recentRes.data ?? []) as Array<{ title: string; kind: string; ingested_at: string }>
        const changes = (changeRes.data ?? []) as Array<{
          event: string
          ref_table: string | null
          detail: Record<string, unknown> | null
          recorded_at: string
        }>
        const projectRows = (projectRes.data ?? []) as Array<{
          title: string
          kind: string | null
          source_kind: string
          classified_at: string | null
          created_at: string
        }>

        const cutoffMs = Date.now() - 90 * 86400000
        const sourceIds = new Set(articles.flatMap(a => a.source_ids ?? []))
        const staleArticles = articles
          .filter(a => a.status === 'published' && new Date(a.updated_at).getTime() < cutoffMs)
          .slice(0, 8)
        const unsourcedArticles = articles
          .filter(a => a.status === 'published' && (!a.source_ids || a.source_ids.length === 0))
          .slice(0, 8)
        const orphanRaw = rawItems
          .filter(r => !sourceIds.has(r.id))
          .slice(0, 10)
        const weakProvenance = rawItems
          .filter(r => !r.source || ['manual', 'unknown', ''].includes(r.source.trim().toLowerCase()))
          .slice(0, 8)
        const rawByKind = rawItems.reduce<Record<string, number>>((acc, r) => {
          acc[r.kind] = (acc[r.kind] ?? 0) + 1
          return acc
        }, {})
        const projectByKind = projectRows.reduce<Record<string, number>>((acc, r) => {
          const key = r.kind ?? 'unclassified'
          acc[key] = (acc[key] ?? 0) + 1
          return acc
        }, {})
        const unclassifiedProject = projectRows.filter(r => !r.classified_at).slice(0, 5)
        const candidateLines = Object.entries(rawByKind)
          .filter(([, n]) => n >= 2)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 4)
          .map(([kind, n]) => `Create a wiki article from ${n} raw ${kind} source${n === 1 ? '' : 's'}`)
        for (const r of orphanRaw.slice(0, 3)) {
          if (candidateLines.length >= 5) break
          candidateLines.push(`Synthesize "${r.title ?? '(untitled raw item)'}"`)
        }

        const lines = [
          `Client Brain health check:`,
          `  Raw items: ${rawRes.count ?? 0}`,
          `  Articles: ${articlesRes.count ?? 0} (${Object.entries(byStatus).map(([s, n]) => `${n} ${s}`).join(', ') || 'none'})`,
          `  Pending revisions: ${revisions.length}`,
        ]
        if (ctx.projectId) {
          lines.push(`  Active project knowledge: ${projectRes.count ?? 0}${Object.keys(projectByKind).length ? ` (${Object.entries(projectByKind).map(([k, n]) => `${n} ${k}`).join(', ')})` : ''}`)
        }
        if (revisions.length) {
          lines.push('  Recent proposed revisions:')
          for (const r of revisions.slice(0, 5)) {
            const confidence = Number(r.confidence ?? 0)
            lines.push(`    [${r.kind}] (${(confidence * 100).toFixed(0)}%): ${(r.changes_summary ?? '').slice(0, 140)}`)
          }
        }
        if (staleArticles.length) {
          lines.push('  Stale wiki articles older than 90 days:')
          for (const a of staleArticles.slice(0, 5)) {
            const days = Math.floor((Date.now() - new Date(a.updated_at).getTime()) / 86400000)
            lines.push(`    ${a.title} (${days}d old)`)
          }
        }
        if (unsourcedArticles.length) {
          lines.push('  Wiki articles with no raw source IDs:')
          for (const a of unsourcedArticles.slice(0, 5)) lines.push(`    ${a.title}`)
        }
        if (orphanRaw.length) {
          lines.push('  Raw items not yet synthesized into wiki articles:')
          for (const r of orphanRaw.slice(0, 7)) lines.push(`    [${r.kind}] ${r.title ?? '(untitled)'}`)
        }
        if (weakProvenance.length) {
          lines.push('  Raw items with weak source provenance:')
          for (const r of weakProvenance.slice(0, 5)) lines.push(`    [${r.kind}] ${r.title ?? '(untitled)'} (${r.source || 'no source'})`)
        }
        if (unclassifiedProject.length) {
          lines.push('  Active project knowledge waiting for classification:')
          for (const r of unclassifiedProject) lines.push(`    [${r.source_kind}] ${r.title}`)
        }
        if (candidateLines.length) {
          lines.push('  Suggested new wiki article candidates:')
          for (const c of candidateLines.slice(0, 5)) lines.push(`    ${c}`)
        }
        if (recent.length) {
          lines.push('  Most recent ingestions:')
          for (const r of recent) {
            const days = Math.floor((Date.now() - new Date(r.ingested_at).getTime()) / 86400000)
            lines.push(`    [${r.kind}] ${r.title} (${days}d ago)`)
          }
        }
        if (changes.length) {
          lines.push('  Recent Brain changes:')
          for (const c of changes) {
            const title = typeof c.detail?.title === 'string' ? `: ${c.detail.title}` : ''
            lines.push(`    ${c.event}${c.ref_table ? ` ${c.ref_table}` : ''}${title}`)
          }
        }
        lines.push('  Health-check instruction: answer with findings first, then practical actions. Do not claim contradictions unless you can point to conflicting titles or sources from search results.')
        return { result: lines.join('\n') }
      }

      case 'feedback': {
        const feedback = input.feedback as string
        const about = input.about as string
        const skill_name = input.skill_name as string | undefined
        const constraint = input.constraint as string

        // Slugify the constraint into a key fragment so multiple feedback
        // items in the same category coexist (no clobber).
        const slug = constraint
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '_')
          .replace(/^_+|_+$/g, '')
          .slice(0, 40)
        const key = skill_name
          ? `feedback.skill.${skill_name.toLowerCase().replace(/\s+/g, '_').slice(0, 30)}.${slug}`
          : `feedback.${about}.${slug}`

        // Per-operator (user_id set) so different operators can have
        // different feedback patterns within the same workspace.
        const { error } = await ctx.supabase.from('vera_memories').upsert({
          org_id: ctx.orgId,
          user_id: ctx.userId,
          key,
          value: `${constraint}\n(source: operator feedback — "${feedback.slice(0, 200)}${feedback.length > 200 ? '…' : ''}")`,
          kind: 'instruction',
          source: 'chat',
          is_pinned: true,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'org_id,user_id,key' })

        if (error) return { result: `Failed to save feedback: ${error.message}` }
        return { result: `Feedback captured as instruction (${key}): ${constraint.slice(0, 100)}` }
      }

      default:
        return { result: `Unknown tool: ${name}` }
    }
  } catch (err) {
    console.error(`tool ${name} threw`, err)
    return { result: `Tool ${name} crashed: ${err instanceof Error ? err.message : String(err)}` }
  }
}

const MAX_TOOL_ROUNDS = 5  // safety cap so a tool loop can't run forever

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  // content can be a plain string (text-only) OR an array of content blocks
  // (text + image, for vision). The image block shape:
  //   { type: 'image', source: { type: 'base64', media_type: 'image/png', data: '<b64>' } }
  // Frontend paste/drop sends the array form. Anthropic accepts both natively.
  type ImageBlock = { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }
  type TextBlock = { type: 'text'; text: string }
  let body: {
    messages?: Array<{ role: 'user' | 'assistant'; content: string | Array<TextBlock | ImageBlock> }>
    org_id?: string
    user_id?: string | null
    project_id?: string | null    // Phase 2b — active project for scope
    session_id?: string | null    // chat session — groups a "New chat" thread
    route?: string
  }
  try {
    body = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: 'invalid JSON' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const { messages, org_id, user_id, project_id, session_id, route = '/' } = body
  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return new Response(JSON.stringify({ error: 'messages required (non-empty array)' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
  if (!org_id) {
    return new Response(JSON.stringify({ error: 'org_id required' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!anthropicKey) {
    return new Response(JSON.stringify({ error: 'ANTHROPIC_API_KEY not configured' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const anthropic = new Anthropic({ apiKey: anthropicKey })
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  // Resolve the last user turn's text for semantic KB retrieval. Multi-block
  // content (vision) just uses the text portion.
  const lastUserBlock = messages.filter(m => m.role === 'user').slice(-1)[0]
  const lastUserText = typeof lastUserBlock?.content === 'string'
    ? lastUserBlock.content
    : Array.isArray(lastUserBlock?.content)
      ? lastUserBlock.content.filter((b): b is { type: 'text'; text: string } => b.type === 'text').map(b => b.text).join(' ')
      : ''

  // Fetch workspace context (including KB hits for this turn). Non-fatal —
  // if it fails we fall back to a minimal prompt so chat still works.
  let contextBlock = ''
  try {
    const ctx = await loadContext(supabase, org_id, user_id ?? null, lastUserText, project_id ?? null)
    contextBlock = renderContext(ctx, route)
  } catch (err) {
    console.error('vera-chat: context load failed', err)
    contextBlock = `<workspace_context>\nOrg lookup failed — operating without live state.\n</workspace_context>`
  }

  // Persist user turn pre-stream. Multi-block content (vision) needs to
  // separate text from inline images — text goes in `content`, images get
  // uploaded to Storage and referenced in `attachments`.
  const lastTurn = messages[messages.length - 1]
  if (lastTurn?.role === 'user') {
    let userText = ''
    const userAttachments: Array<{ kind: 'image'; url: string; alt?: string }> = []
    if (typeof lastTurn.content === 'string') {
      userText = lastTurn.content
    } else if (Array.isArray(lastTurn.content)) {
      for (const block of lastTurn.content) {
        if (block.type === 'text') userText += block.text
        else if (block.type === 'image') {
          // Upload the uploaded image to Storage for permanence
          try {
            const dataUrl = `data:${block.source.media_type};base64,${block.source.data}`
            const url = await uploadImageToStorage(supabase, org_id, dataUrl)
            userAttachments.push({ kind: 'image', url })
          } catch (e) {
            console.warn('user image upload failed', e)
          }
        }
      }
    }
    await supabase.from('chat_messages').insert({
      org_id, user_id: user_id ?? null, role: 'user',
      project_id: project_id ?? null,
      session_id: session_id ?? null,
      content: userText, route,
      attachments: userAttachments,
    })
  }

  // System prompt as a two-block array so Anthropic prompt caching can
  // mark the workspace context as ephemeral. ttl=1h instead of the default
  // 5-min so the cache survives an idle operator coming back from lunch.
  const systemBlocks = [
    { type: 'text' as const, text: BASE_PERSONA },
    {
      type: 'text' as const,
      text: contextBlock,
      cache_control: { type: 'ephemeral' as const, ttl: '1h' as const },
    },
  ]

  // Extended thinking: enable when the operator's intent is analytical.
  // Keyword heuristic + length cue — explicit "think hard" / "analyze" /
  // "strategy" / "deep dive" lights it up. Standard turns stay fast.
  // (lastUserText already computed above for KB retrieval.)
  const analyticalCues = /\b(analy[sz]e|think hard|deep dive|deep take|strategy|strategi[sz]e|teardown|critique|interpret|reason through|walk through the trade|trade-?offs?)\b/
  const enableThinking = analyticalCues.test(lastUserText.toLowerCase())

  // Anthropic-managed web search — server-side tool. Adds live world
  // knowledge ("what did competitors publish this week?", "latest stat on
  // X"). Capped at 5 searches per turn to bound cost.
  const SERVER_TOOLS = [
    { type: 'web_search_20250305', name: 'web_search', max_uses: 5 },
  ]

  const encoder = new TextEncoder()
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
      }

      // Build the conversation as content-block messages so we can append
      // tool_use / tool_result blocks during the loop.
      type CBlock =
        | { type: 'text'; text: string }
        | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
        | { type: 'tool_result'; tool_use_id: string; content: string }
      type Msg = { role: 'user' | 'assistant'; content: string | CBlock[] }
      const convo: Msg[] = messages.map(m => ({ role: m.role, content: m.content }))

      let fullText = ''
      const generatedImages: string[] = []
      let totalTokensIn = 0
      let totalTokensOut = 0
      let totalCacheRead = 0
      let totalCacheCreate = 0

      try {
        // Tool-use loop: call Anthropic, check stop_reason, execute any
        // tool calls, append tool_result, repeat. Capped at MAX_TOOL_ROUNDS.
        for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
          const createParams: Parameters<typeof anthropic.messages.create>[0] = {
            model: MODEL,
            max_tokens: enableThinking ? Math.max(MAX_TOKENS, 4096) : MAX_TOKENS,
            system: systemBlocks,
            tools: [
              ...SERVER_TOOLS,
              ...TOOLS,
            ] as unknown as Parameters<typeof anthropic.messages.create>[0]['tools'],
            messages: convo as Parameters<typeof anthropic.messages.create>[0]['messages'],
            stream: true,
          }
          if (enableThinking) {
            (createParams as Record<string, unknown>).thinking = {
              type: 'enabled', budget_tokens: 3000,
            }
          }
          const response = await anthropic.messages.create(createParams)

          // Per-round state: collected content blocks for the assistant turn
          const assistantBlocks: CBlock[] = []
          let currentTextBuf = ''
          let currentToolUse: { id: string; name: string; inputBuf: string } | null = null
          let stopReason: string | null = null

          for await (const event of response) {
            if (event.type === 'message_start' && event.message.usage) {
              const u = event.message.usage as {
                input_tokens?: number
                cache_read_input_tokens?: number
                cache_creation_input_tokens?: number
              }
              totalTokensIn += u.input_tokens ?? 0
              totalCacheRead += u.cache_read_input_tokens ?? 0
              totalCacheCreate += u.cache_creation_input_tokens ?? 0
            } else if (event.type === 'content_block_start') {
              const block = event.content_block as { type: string; id?: string; name?: string }
              if (block.type === 'tool_use') {
                currentToolUse = { id: block.id!, name: block.name!, inputBuf: '' }
                send({ type: 'tool_start', tool: block.name, id: block.id })
              } else if (block.type === 'text') {
                currentTextBuf = ''
              }
            } else if (event.type === 'content_block_delta') {
              const delta = event.delta as { type: string; text?: string; partial_json?: string }
              if (delta.type === 'text_delta' && delta.text) {
                currentTextBuf += delta.text
                fullText += delta.text
                send({ type: 'delta', text: delta.text })
              } else if (delta.type === 'input_json_delta' && currentToolUse) {
                currentToolUse.inputBuf += delta.partial_json ?? ''
              }
            } else if (event.type === 'content_block_stop') {
              if (currentToolUse) {
                let parsedInput: Record<string, unknown> = {}
                try {
                  parsedInput = currentToolUse.inputBuf ? JSON.parse(currentToolUse.inputBuf) : {}
                } catch (e) {
                  console.error('failed to parse tool input', e, currentToolUse.inputBuf)
                }
                assistantBlocks.push({
                  type: 'tool_use',
                  id: currentToolUse.id,
                  name: currentToolUse.name,
                  input: parsedInput,
                })
                currentToolUse = null
              } else if (currentTextBuf) {
                assistantBlocks.push({ type: 'text', text: currentTextBuf })
                currentTextBuf = ''
              }
            } else if (event.type === 'message_delta') {
              const md = event as { delta?: { stop_reason?: string }; usage?: { output_tokens?: number } }
              if (md.delta?.stop_reason) stopReason = md.delta.stop_reason
              if (md.usage?.output_tokens) totalTokensOut += md.usage.output_tokens
            }
          }

          // Append the assistant's turn (text + any tool_use blocks) to convo
          convo.push({ role: 'assistant', content: assistantBlocks })

          // If the model called tools, execute them and feed results back
          if (stopReason === 'tool_use') {
            const toolUses = assistantBlocks.filter(b => b.type === 'tool_use') as Array<
              Extract<CBlock, { type: 'tool_use' }>
            >
            const toolResults: CBlock[] = []
            for (const tu of toolUses) {
              const exec = await executeTool(tu.name, tu.input, {
                orgId: org_id,
                userId: user_id ?? null,
                projectId: project_id ?? null,
                supabase,
                supabaseUrl,
                serviceKey,
                emit: send,
                userPrompt: lastUserText ?? null,
              })
              if (exec.image_url) {
                generatedImages.push(exec.image_url)
                send({ type: 'image', url: exec.image_url, tool: tu.name })
              }
              if (exec.video_url) {
                send({ type: 'video', url: exec.video_url, tool: tu.name })
              }
              send({ type: 'tool_end', tool: tu.name, id: tu.id, result: exec.result })
              toolResults.push({
                type: 'tool_result',
                tool_use_id: tu.id,
                content: exec.result,
              })
            }
            convo.push({ role: 'user', content: toolResults })
            // Loop again — Anthropic will compose its next turn with tool results
            continue
          }

          // No more tools — stream is done
          break
        }

        // Persist assistant turn. fullText covers all text deltas across all
        // rounds. Image URLs go in the attachments jsonb sidecar so they
        // survive history reloads.
        const attachments = generatedImages.map(url => ({
          kind: 'image' as const,
          url,
          generated_by: 'tool',
        }))
        await supabase.from('chat_messages').insert({
          org_id, user_id: user_id ?? null, role: 'assistant',
          project_id: project_id ?? null,
          session_id: session_id ?? null,
          content: fullText, route,
          tokens_in: totalTokensIn, tokens_out: totalTokensOut,
          attachments,
        })

        send({
          type: 'done',
          usage: {
            input_tokens: totalTokensIn,
            output_tokens: totalTokensOut,
            cache_read_input_tokens: totalCacheRead,
            cache_creation_input_tokens: totalCacheCreate,
            images_generated: generatedImages.length,
          },
        })
      } catch (err) {
        console.error('vera-chat stream failed', err)
        send({ type: 'error', message: err instanceof Error ? err.message : String(err) })
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      ...corsHeaders,
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  })
})
