import Anthropic from 'npm:@anthropic-ai/sdk'
import { createClient } from 'npm:@supabase/supabase-js'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// DB-safe label maps
const PLATFORM_LABELS: Record<string, string> = {
  linkedin: 'LinkedIn', twitter: 'Twitter', instagram: 'Instagram',
  facebook: 'Facebook', quora: 'Quora', blog: 'Blog', email: 'Email',
}
const FORMAT_LABELS: Record<string, string> = {
  thought_leadership: 'Thought Leadership', thread: 'Thread',
  cold_outreach: 'Cold Outreach', product_launch: 'Product Launch',
  case_study: 'Case Study', post: 'Post', article: 'Article', newsletter: 'Newsletter',
}

async function braveSearch(query: string): Promise<string> {
  const apiKey = Deno.env.get('BRAVE_SEARCH_API_KEY')
  if (!apiKey) return '(Brave Search not configured — skipping research)'

  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=5`
  const res = await fetch(url, {
    headers: { 'Accept': 'application/json', 'X-Subscription-Token': apiKey },
  })
  if (!res.ok) return `(Brave Search error: ${res.status})`

  const data = await res.json()
  const results = (data?.web?.results ?? []) as Array<{ title: string; description: string; url: string }>
  return results.map((r, i) => `[${i + 1}] ${r.title}\n${r.description}\n${r.url}`).join('\n\n')
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const { prompt, org_id } = await req.json()

  if (!prompt) {
    return new Response(JSON.stringify({ error: 'prompt is required' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const anthropic = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY')! })
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      const send = (agent: string, chunk: string, done: boolean) => {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ agent, chunk, done })}\n\n`)
        )
      }

      const delay = (ms: number) => new Promise(r => setTimeout(r, ms))

      try {
        // ── STEP 1: Fetch org skills ──────────────────────────────────────────
        const skillsQuery = supabase
          .from('skills')
          .select('*')
          .eq('is_active', true)
          .order('sort_order')

        if (org_id) {
          skillsQuery.or(`org_id.is.null,org_id.eq.${org_id}`)
        } else {
          skillsQuery.is('org_id', null)
        }

        const { data: skills } = await skillsQuery

        // ── STEP 2: STRATEGIST ────────────────────────────────────────────────
        const strategistSkills = skills?.filter(s => s.injected_into === 'strategist') ?? []
        const skillList = strategistSkills.map(s => `- "${s.name}": ${s.description}`).join('\n')

        let strategyRaw = ''

        const strategistStream = anthropic.messages.stream({
          model: 'claude-sonnet-4-6',
          max_tokens: 1024,
          system: `You are KAI's Strategist. Analyse the content brief and output a strategy as valid JSON only — no prose, no markdown fences.

Available skills:
${skillList || '(none configured yet)'}

Output exactly this JSON structure:
{
  "persona": "target audience description",
  "platform": "linkedin|twitter|instagram|quora|blog|email",
  "content_type": "thought_leadership|thread|cold_outreach|product_launch|case_study|post",
  "angle": "specific hook or angle",
  "tone": "professional|casual|authoritative|conversational",
  "selected_skill_names": ["exact skill name 1"],
  "brief_for_writer": "detailed brief including angle, tone, key points, CTA",
  "run_researcher": true,
  "research_query": "specific web search query to find supporting data/evidence",
  "run_seo": false,
  "target_keywords": ["keyword1", "keyword2"],
  "run_persona_adapter": false,
  "persona_detail": "detailed description of the specific persona's pain points and goals"
}

Set run_researcher to true when data, stats, recent news, or supporting evidence would strengthen the content.
Set run_seo to true only for blog posts or long-form content where SEO matters.
Set run_persona_adapter to true when the brief specifies a very specific persona (e.g. a named job title, industry, or company type).`,
          messages: [{ role: 'user', content: prompt }],
        })

        for await (const event of strategistStream) {
          if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
            strategyRaw += event.delta.text
            send('Strategist', strategyRaw, false)
          }
        }
        send('Strategist', strategyRaw, true)

        // Parse strategy
        let strategy: Record<string, unknown> = {}
        try {
          const match = strategyRaw.match(/\{[\s\S]*\}/)
          if (match) strategy = JSON.parse(match[0])
        } catch {
          strategy = {
            platform: 'linkedin', content_type: 'post', tone: 'professional',
            brief_for_writer: prompt, selected_skill_names: [],
            run_researcher: false, run_seo: false, run_persona_adapter: false,
          }
        }

        await delay(300)

        const platform = (strategy.platform as string) ?? 'linkedin'
        const contentType = (strategy.content_type as string) ?? 'post'
        const platformLabel = PLATFORM_LABELS[platform] ?? 'LinkedIn'
        const formatLabel = FORMAT_LABELS[contentType] ?? 'Post'

        // ── STEP 3: RESEARCHER (conditional) ─────────────────────────────────
        let researchFindings = ''
        const agentsRun: Record<string, boolean> = {
          researcher: false, seo: false, persona_adapter: false,
        }

        if (strategy.run_researcher && strategy.research_query) {
          send('Researcher', 'Searching the web…', false)
          const rawResults = await braveSearch(strategy.research_query as string)

          let researchText = ''
          const researchStream = anthropic.messages.stream({
            model: 'claude-haiku-4-5',
            max_tokens: 512,
            system: `You are a research assistant. Synthesise the following web search results into 3-5 concise bullet points of key facts, stats, or insights that would strengthen a piece of content. Be specific — include numbers, dates, and source context where available. Output only the bullet points.`,
            messages: [{ role: 'user', content: `Search query: ${strategy.research_query}\n\nResults:\n${rawResults}` }],
          })

          for await (const event of researchStream) {
            if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
              researchText += event.delta.text
              send('Researcher', researchText, false)
            }
          }
          send('Researcher', researchText, true)
          researchFindings = researchText
          agentsRun.researcher = true
          await delay(300)
        }

        // ── STEP 4: Resolve writer skill modules ──────────────────────────────
        const selectedNames: string[] = (strategy.selected_skill_names as string[]) ?? []
        const writerSkills = skills?.filter(s =>
          s.injected_into === 'writer' && (
            selectedNames.includes(s.name) ||
            s.trigger_when?.platform === platform ||
            s.trigger_when?.content_type === contentType
          )
        ) ?? []
        const skillBlocks = writerSkills.map(s => s.prompt_module).join('\n\n---\n\n')

        // ── STEP 5: WRITER ────────────────────────────────────────────────────
        let writerText = ''

        const writerStream = anthropic.messages.stream({
          model: 'claude-sonnet-4-6',
          max_tokens: 2048,
          system: `You are KAI's Writer. Write the content based on the strategy brief below.

## Target platform: ${platformLabel}
${platformGuide(platform)}

${skillBlocks ? `Apply these platform and content guidelines:\n\n${skillBlocks}\n\n---` : ''}
${researchFindings ? `\nSupporting research to weave in naturally:\n${researchFindings}\n\n---` : ''}

Write only the final content — no preamble, no explanation, no labels, no markdown fences. Just the ${platformLabel} ${formatLabel.toLowerCase()}.`,
          messages: [{
            role: 'user',
            content: (strategy.brief_for_writer as string) || prompt,
          }],
        })

        for await (const event of writerStream) {
          if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
            writerText += event.delta.text
            send('Writer', writerText, false)
          }
        }
        send('Writer', writerText, true)
        await delay(300)

        let currentCopy = writerText

        // ── STEP 6: SEO AGENT (conditional) ──────────────────────────────────
        let seoNotes = ''
        if (strategy.run_seo && strategy.target_keywords) {
          let seoText = ''
          const seoStream = anthropic.messages.stream({
            model: 'claude-haiku-4-5',
            max_tokens: 1024,
            system: `You are KAI's SEO Agent. Optimise the given content for search engines while preserving its voice and quality.

Target keywords: ${(strategy.target_keywords as string[]).join(', ')}

Output your response in exactly two sections:
OPTIMISED COPY:
[the rewritten content with keywords naturally integrated]

SEO NOTES:
[2-3 bullet points explaining the optimisation changes made]`,
            messages: [{ role: 'user', content: currentCopy }],
          })

          for await (const event of seoStream) {
            if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
              seoText += event.delta.text
              send('SEO Agent', seoText, false)
            }
          }
          send('SEO Agent', seoText, true)

          // Extract optimised copy
          const copyMatch = seoText.match(/OPTIMISED COPY:\s*([\s\S]*?)(?=SEO NOTES:|$)/i)
          const notesMatch = seoText.match(/SEO NOTES:\s*([\s\S]*?)$/i)
          if (copyMatch?.[1]?.trim()) currentCopy = copyMatch[1].trim()
          if (notesMatch?.[1]?.trim()) seoNotes = notesMatch[1].trim()
          agentsRun.seo = true
          await delay(300)
        }

        // ── STEP 7: PERSONA ADAPTER (conditional) ─────────────────────────────
        let personaAdapterNotes = ''
        if (strategy.run_persona_adapter && strategy.persona_detail) {
          let personaText = ''
          const personaStream = anthropic.messages.stream({
            model: 'claude-haiku-4-5',
            max_tokens: 1024,
            system: `You are KAI's Persona Adapter. Rewrite the given content to resonate specifically with the target persona described below. Adjust language, examples, pain points, and benefits to match their world — while keeping the core message and length.

Target persona: ${strategy.persona_detail}

Output the rewritten content only — no labels, no explanation.`,
            messages: [{ role: 'user', content: currentCopy }],
          })

          for await (const event of personaStream) {
            if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
              personaText += event.delta.text
              send('Persona Adapter', personaText, false)
            }
          }
          send('Persona Adapter', personaText, true)
          if (personaText.trim()) currentCopy = personaText.trim()
          personaAdapterNotes = `Adapted for: ${strategy.persona_detail}`
          agentsRun.persona_adapter = true
          await delay(300)
        }

        // ── STEP 8: BRAND GUARD ───────────────────────────────────────────────
        let brandRules = ''
        if (org_id) {
          const { data: bv } = await supabase
            .from('brand_voice')
            .select('*')
            .eq('org_id', org_id)
            .maybeSingle()

          if (bv) {
            const parts = [
              bv.tone?.length ? `Tone: ${bv.tone.join(', ')}` : '',
              bv.forbidden_phrases?.length ? `Forbidden phrases: ${bv.forbidden_phrases.join(', ')}` : '',
              bv.required_phrases?.length ? `Required phrases: ${bv.required_phrases.join(', ')}` : '',
              bv.writing_rules?.length ? `Writing rules:\n${bv.writing_rules.map((r: string) => `• ${r}`).join('\n')}` : '',
              bv.system_prompt || '',
            ]
            brandRules = parts.filter(Boolean).join('\n\n')
          }
        }

        const brandSkills = skills?.filter(s => s.type === 'brand' && s.injected_into === 'brand_guard') ?? []
        if (brandSkills.length) brandRules += '\n\n' + brandSkills.map(s => s.prompt_module).join('\n\n')

        let brandText = ''
        const brandStream = anthropic.messages.stream({
          model: 'claude-sonnet-4-6',
          max_tokens: 512,
          system: `You are KAI's Brand Guard. Review the content against brand guidelines.

${brandRules || 'No specific brand rules configured. Check for general quality, clarity, and professionalism.'}

Respond concisely:
- First line: "Brand check ✓" (approved) or "Brand check ✗" (needs changes)
- Bullet list: what's correct, what needs adjustment
- One suggestion if applicable`,
          messages: [{
            role: 'user',
            content: `Review this content for platform: ${platformLabel}\n\n${currentCopy}`,
          }],
        })

        for await (const event of brandStream) {
          if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
            brandText += event.delta.text
            send('Brand Guard', brandText, false)
          }
        }
        send('Brand Guard', brandText, true)
        await delay(300)

        // ── STEP 9: COMPLIANCE CHECKER (always) ───────────────────────────────
        let complianceText = ''
        const complianceStream = anthropic.messages.stream({
          model: 'claude-haiku-4-5',
          max_tokens: 512,
          system: `You are KAI's Compliance Checker. Review the content for the following compliance issues:

1. FALSE CLAIMS — any unverified statistics, guarantees, or factual claims that could mislead
2. COMPETITOR ATTACKS — negative comparisons, disparaging language, or unfair competitor references
3. FTC/DISCLOSURE — sponsored content, affiliate links, or paid partnerships that require disclosure
4. INDUSTRY-SPECIFIC — regulated industries (finance, health, legal) require disclaimers

For each category output:
[PASS] or [FLAG] followed by a brief note.

End with either:
COMPLIANCE: APPROVED
or
COMPLIANCE: CHANGES REQUESTED
followed by a summary of what must be fixed.`,
          messages: [{
            role: 'user',
            content: `Platform: ${platformLabel}\nContent type: ${formatLabel}\n\n${currentCopy}`,
          }],
        })

        for await (const event of complianceStream) {
          if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
            complianceText += event.delta.text
            send('Compliance', complianceText, false)
          }
        }
        send('Compliance', complianceText, true)
        await delay(300)

        // ── STEP 10: PUBLISHER ────────────────────────────────────────────────
        const hashtags = (currentCopy.match(/#\w+/g) ?? []).slice(0, 5)
        const brandApproved = !brandText.includes('✗')
        const complianceApproved = complianceText.includes('COMPLIANCE: APPROVED')
        const fullyApproved = brandApproved && complianceApproved
        const postStatus = fullyApproved ? 'pending' : 'pending' // always pending for human review

        let publisherText = `📋 Platform: ${platformLabel}\n📝 Format: ${formatLabel}\n#️⃣ Hashtags: ${hashtags.join(' ') || 'none'}\n📅 Suggested schedule: Tomorrow 08:00–09:00 (peak B2B engagement)\n\n`

        if (!brandApproved) publisherText += `⚠️ Brand Guard flagged issues — review before approving.\n`
        if (!complianceApproved) publisherText += `⚠️ Compliance issues found — changes required before publishing.\n`
        if (fullyApproved) publisherText += `All checks passed — head to Review to approve and schedule.`

        send('Publisher', publisherText, false)

        const complianceChecks = {
          false_claims: complianceText.includes('[FLAG]') && complianceText.includes('FALSE CLAIMS') ? 'flagged' : 'pass',
          competitor_attacks: complianceText.includes('[FLAG]') && complianceText.includes('COMPETITOR') ? 'flagged' : 'pass',
          ftc_disclosure: complianceText.includes('[FLAG]') && complianceText.includes('FTC') ? 'flagged' : 'pass',
          industry_specific: complianceText.includes('[FLAG]') && complianceText.includes('INDUSTRY') ? 'flagged' : 'pass',
        }

        const { data: savedPost, error: saveError } = await supabase
          .from('content_posts')
          .insert({
            org_id: org_id ?? null,
            title: prompt.slice(0, 100),
            copy: currentCopy,
            channel: platformLabel,
            format: formatLabel,
            hashtags,
            status: postStatus,
            model_used: 'claude-sonnet-4-6',
            compliance_checks: complianceChecks,
            agent_outputs: {
              strategy,
              brand_check: brandText,
              brand_approved: brandApproved,
              compliance_check: complianceText,
              compliance_approved: complianceApproved,
              seo_notes: seoNotes,
              persona_adapter_notes: personaAdapterNotes,
              agents_run: agentsRun,
            },
          })
          .select('id')
          .single()

        if (saveError) {
          publisherText += `\n⚠️ Save error: ${saveError.message}`
        } else {
          publisherText += `\n✅ Saved · ID: ${savedPost.id.slice(0, 8)}`
        }

        send('Publisher', publisherText, true)
        controller.close()

      } catch (err) {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ error: String(err) })}\n\n`)
        )
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

// Platform-specific Writer shape constraints. Each platform has a distinct
// optimal post shape; the Writer needs to know which one it's targeting.
function platformGuide(platform: string): string {
  switch (platform) {
    case 'linkedin':
      return `Shape: ≤1,300 chars (sweet spot). The first 2-3 lines are the HOOK — they appear before "see more". Open with a sharp observation or contrarian claim, not a greeting. Use short paragraphs (1-3 lines each), generous line breaks for scannability. Plain text only — no markdown, no headings. End with an open question or a clear CTA. No hashtag stuffing (0-3 hashtags max).`
    case 'twitter':
      return `Shape: single tweet ≤280 chars OR a numbered thread with each tweet ≤280 chars separated by blank lines.
- Single: punchy, complete thought, one idea. Optional 1-2 hashtags.
- Thread: open with a hook tweet that earns the click. Each subsequent tweet is one beat — a stat, a contrast, a reframe. Number them ("1/", "2/", …). Last tweet has the CTA.
No emoji-spam. No "🧵" — let the content do it.`
    case 'instagram':
      return `Shape: caption with a strong first line (≤125 chars, what appears above "more"). Use line breaks generously. End with a hashtag block of 10-20 relevant niche hashtags. Emoji are fine but sparingly. Caption can be longer than LinkedIn — up to 2,200 chars.`
    case 'quora':
      return `Shape: long-form answer (500-1,500 words). First sentence = direct answer to the question. Then explain with examples, data, and structure (numbered points or short sub-sections are fine — use bold via markdown). End with a concrete takeaway. Avoid "thanks for asking" preamble.`
    case 'blog':
      return `Shape: 800-2,000 word post. Use markdown — H2/H3 headings, lists where useful, occasional bold for emphasis. Open with a hook paragraph that frames the problem or the surprising finding. Each section advances one beat. Close with a clear takeaway and/or CTA. SEO-aware: include the target keywords naturally in the H1, opening, and one subhead.`
    case 'email':
      return `Shape: two parts — SUBJECT (≤55 chars, intriguing, not clickbait) on the first line, then a blank line, then the BODY. Body: ≤200 words for cold outreach / ≤500 words for newsletter. Conversational, one idea. Plain text only. Greeting then one short opening line then the substance then a clear CTA (one ask). Optional P.S. line.

Format your output exactly as:
Subject: <subject line>

<body>`
    default:
      return `Shape: optimise for ${platform}. Be concise, lead with the value, no fluff.`
  }
}
