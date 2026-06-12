// Infographic generation — thin wrapper over generate-image that scaffolds
// a Nano Banana (Gemini 2.5 Flash Image) prompt with layout discipline.
//
// NotebookLM-style infographics are Gemini under the hood. The quality gap
// vs free-form generate-image isn't the model — it's the structured prompt
// template that tells the model exactly what frame to draw, what each panel
// holds, and which visual elements to repeat.
//
// POST { title, subtitle?, sections, stats?, audience?, style?, model? }
// Returns: same SSE stream as generate-image (started / status / done / error)
//
// `sections`: array of { heading, body, visual_cue?, icon? }
//   - heading: 2-5 word claim, the section's title in-image
//   - body: ≤25 word explanation
//   - visual_cue: a brief description of the illustration element for that section
//   - icon: short hint for an icon ("calendar", "robot", "graph")
//
// `stats`: array of {label, value} — surfaced as big-number callouts
// `style`: 'editorial' | 'technical' | 'playful' | 'minimal' (default 'editorial')

import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'npm:@supabase/supabase-js'
import type { Database } from '../_shared/database.types.ts'
import { requireProjectMember } from '../_shared/auth.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey',
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

interface Section {
  heading: string
  body: string
  visual_cue?: string
  icon?: string
}

interface Stat {
  label: string
  value: string
}

type Style = 'editorial' | 'technical' | 'playful' | 'minimal'

const STYLE_GUIDES: Record<Style, string> = {
  editorial: `Modern editorial illustration style — clean 2D vector art, soft cream/off-white background, cohesive 3-color palette (one dominant blue, one accent orange/green, dark navy for typography). Stylized characters and objects with rounded forms. Inspired by NotebookLM and high-end SaaS marketing infographics. Generous whitespace.`,
  technical: `Technical diagram style — flat geometric shapes, monospace-style accents, structured grid layout. Minimal illustration, more boxes-and-arrows. Limited palette: black/white/one accent color (electric blue or warm orange). Suited for system architecture and engineering content.`,
  playful: `Playful editorial illustration — slightly looser linework, soft pastel palette (peach, sage, periwinkle, cream). Characters with friendly proportions, rounded UI elements, organic curves. Suited for consumer brands and approachable B2B.`,
  minimal: `Minimal monochrome editorial — single accent color (deep oxblood or forest green) against cream/off-white. Typographic-led with restrained illustration. Heavy negative space. Inspired by The Browser Company / Linear / Notion editorial.`,
}

function buildPrompt({
  title, subtitle, sections, stats, audience, style,
}: {
  title: string
  subtitle?: string
  sections: Section[]
  stats?: Stat[]
  audience?: string
  style: Style
}): string {
  const styleGuide = STYLE_GUIDES[style]

  const sectionDescriptions = sections.map((s, i) => {
    const num = i + 1
    const parts: string[] = []
    parts.push(`Section ${num}: heading "${s.heading}", body "${s.body}"`)
    if (s.visual_cue) parts.push(`visual element: ${s.visual_cue}`)
    if (s.icon) parts.push(`icon hint: ${s.icon}`)
    return parts.join('. ')
  }).join('\n')

  const statsBlock = stats?.length
    ? `\nKey stats to feature prominently as big-number callouts:\n${stats.map(s => `- ${s.value}: ${s.label}`).join('\n')}`
    : ''

  return `A horizontal landscape B2B marketing infographic, 16:9 aspect ratio (much wider than tall — width should be roughly 1.78× the height). NOT a square. NOT a portrait. Imagine a presentation slide or a banner that fits across a desktop monitor.

${styleGuide}

OVERALL COMPOSITION (landscape, panels arranged HORIZONTALLY across the canvas):

TOP BAND (top 15% of canvas, full width):
- Bold sans-serif title, very large (huge typography — must dominate the top): "${title}"
${subtitle ? `- Subtitle below in smaller weight: "${subtitle}"` : ''}

MAIN BAND (middle 70% of canvas, full width):
- ${sections.length} connected panels arranged LEFT-TO-RIGHT (NOT stacked, NOT in a grid — a single horizontal row)
- Each panel is approximately ${Math.round(85 / sections.length)}% of the canvas width
- Directional curved arrows in an accent color FLOW between adjacent panels left-to-right
- Each panel contains, stacked vertically inside it:
    1. A stylized 2D vector illustration or character (the visual hook for that section)
    2. A short bold heading underneath (3-6 words, sentence case)
    3. 1-2 lines of supporting body text (clearly readable — body text must NOT be tiny)

BOTTOM BAND (bottom 15% of canvas):
${stats?.length ? `- Stat callouts arranged horizontally — BIG numbers in the accent color with short labels beneath` : '- Decorative footer flourish or accent line'}

PANELS (in order, left to right):
${sectionDescriptions}
${statsBlock}

${audience ? `Audience tone reference: ${audience}` : ''}

CRITICAL VISUAL DISCIPLINE:
- Text inside the image must be CRISP, LEGIBLE, properly spelled
- All headings and body text large enough to read from 6 feet away — no microscopic copy
- Use ONE consistent illustration style and character vocabulary across all panels
- The background is one soft cohesive color (cream, off-white, or pale tinted neutral) — NEVER pure #FFFFFF
- Strong typographic hierarchy: title huge, section headings medium, body text small but readable
- White space matters — do not cram everything edge-to-edge
- No watermarks, no stock-photo elements, no generic shutterstock-style clipart
- Quality reference: NotebookLM editorial infographics, modern SaaS marketing infographics, Stripe / Linear / Vercel landing-page hero illustrations

Output: ONE polished horizontal landscape infographic image. Do not output multiple variants. Do not output a grid of options.`
}

async function jsonError(message: string, status: number): Promise<Response> {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })
  if (req.method !== 'POST') return jsonError('Method not allowed', 405)
  const supabase = createClient<Database>(SUPABASE_URL, SERVICE_KEY)

  let body: {
    title?: string
    subtitle?: string
    sections?: Section[]
    stats?: Stat[]
    audience?: string
    style?: Style
    model?: string
    project_id?: string
  }
  try {
    body = await req.json()
  } catch {
    return jsonError('Invalid JSON body', 400)
  }

  // Default to Seedream 4.5 for cheap, fast prototype-quality marketing
  // assets. Operators can explicitly override to Qwen Image for text-heavy
  // layouts or a premium model for final brand-critical output.
  const { title, subtitle, sections, stats, audience, style = 'editorial', model = 'seedream-4.5' } = body
  const projectId = typeof body.project_id === 'string' ? body.project_id.trim() : ''

  if (!title) return jsonError('title is required', 400)
  if (!sections?.length) return jsonError('sections (non-empty array) is required', 400)
  if (sections.length > 6) return jsonError('Up to 6 sections supported — split into multiple infographics if needed', 400)
  if (!projectId) return jsonError('project_id is required for infographic generation', 400)

  const access = await requireProjectMember(req, supabase, SERVICE_KEY, projectId, corsHeaders)
  if (!access.ok) return access.response

  const prompt = buildPrompt({
    title,
    subtitle,
    sections,
    stats,
    audience,
    style,
  })

  // Forward to generate-image with the composed prompt. We pipe its SSE
  // stream straight back to the caller so the frontend gets the same
  // started/status/done events with no buffering.
  const imageRes = await fetch(`${SUPABASE_URL}/functions/v1/generate-image`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': req.headers.get('Authorization') ?? '',
      'apikey': req.headers.get('apikey') ?? '',
    },
    body: JSON.stringify({
      prompt,
      model,
      image_size: 'landscape_16_9',
      num_images: 1,
      quality: 'high',
      project_id: projectId,
    }),
  })

  // Pass-through the SSE stream + status + headers
  return new Response(imageRes.body, {
    status: imageRes.status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  })
})
