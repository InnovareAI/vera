import Anthropic from 'npm:@anthropic-ai/sdk'
import { createClient } from 'npm:@supabase/supabase-js'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
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
        // ── STEP 1: Fetch org skills from Supabase ────────────────────────────
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
        const skillList = strategistSkills
          .map(s => `- "${s.name}": ${s.description}`)
          .join('\n')

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
  "selected_skill_names": ["exact skill name 1", "exact skill name 2"],
  "brief_for_writer": "detailed brief for the writer including angle, tone, key points, CTA"
}`,
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
            platform: 'linkedin',
            content_type: 'post',
            tone: 'professional',
            brief_for_writer: prompt,
            selected_skill_names: [],
          }
        }

        await delay(300)

        // ── STEP 3: Resolve writer skill prompt modules ───────────────────────
        const selectedNames: string[] = (strategy.selected_skill_names as string[]) ?? []
        const platform = (strategy.platform as string) ?? 'linkedin'
        const contentType = (strategy.content_type as string) ?? 'post'

        const writerSkills = skills?.filter(s =>
          s.injected_into === 'writer' && (
            selectedNames.includes(s.name) ||
            s.trigger_when?.platform === platform ||
            s.trigger_when?.content_type === contentType
          )
        ) ?? []

        const skillBlocks = writerSkills.map(s => s.prompt_module).join('\n\n---\n\n')

        // ── STEP 4: WRITER ────────────────────────────────────────────────────
        let writerText = ''

        const writerStream = anthropic.messages.stream({
          model: 'claude-sonnet-4-6',
          max_tokens: 2048,
          system: `You are KAI's Writer. Write the content based on the strategy brief below.

${skillBlocks ? `Apply these platform and content guidelines:\n\n${skillBlocks}\n\n---` : ''}

Write only the final content — no preamble, no explanation, no labels. Just the post.`,
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

        // ── STEP 5: BRAND GUARD ───────────────────────────────────────────────
        let brandRules = ''

        if (org_id) {
          const { data: bv } = await supabase
            .from('brand_voice')
            .select('*')
            .eq('org_id', org_id)
            .maybeSingle()

          if (bv) {
            const parts = [
              bv.tone?.length        ? `Tone: ${bv.tone.join(', ')}` : '',
              bv.forbidden_phrases?.length ? `Forbidden phrases: ${bv.forbidden_phrases.join(', ')}` : '',
              bv.required_phrases?.length  ? `Required phrases: ${bv.required_phrases.join(', ')}` : '',
              bv.writing_rules?.length     ? `Writing rules:\n${bv.writing_rules.map((r: string) => `• ${r}`).join('\n')}` : '',
              bv.system_prompt || '',
            ]
            brandRules = parts.filter(Boolean).join('\n\n')
          }
        }

        // Also inject any brand-type skills
        const brandSkills = skills?.filter(s => s.type === 'brand' && s.injected_into === 'brand_guard') ?? []
        if (brandSkills.length) {
          brandRules += '\n\n' + brandSkills.map(s => s.prompt_module).join('\n\n')
        }

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
            content: `Review this content for platform: ${platform}\n\n${writerText}`,
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

        // ── STEP 6: PUBLISHER ─────────────────────────────────────────────────
        const hashtags = (writerText.match(/#\w+/g) ?? []).slice(0, 5)
        const approved = !brandText.includes('✗')

        const platformLabel = platform.charAt(0).toUpperCase() + platform.slice(1)
        const formatLabel = contentType
          .split('_')
          .map((w: string) => w.charAt(0).toUpperCase() + w.slice(1))
          .join(' ')

        let publisherText = `📋 Platform: ${platformLabel}\n📝 Format: ${formatLabel}\n#️⃣ Hashtags: ${hashtags.join(' ') || 'none'}\n📅 Suggested schedule: Tomorrow 08:00–09:00 (peak B2B engagement)\n\n`
        publisherText += approved
          ? `Saving to Supabase as Draft — head to Review to approve and schedule.`
          : `Brand Guard flagged issues — saving as Draft for revision.`

        send('Publisher', publisherText, false)

        // Write to content_posts
        const { data: savedPost, error: saveError } = await supabase
          .from('content_posts')
          .insert({
            org_id: org_id ?? null,
            title: prompt.slice(0, 100),
            copy: writerText,
            channel: platformLabel,
            format: formatLabel,
            hashtags,
            status: 'Draft',
            model_used: 'claude-sonnet-4-6',
            agent_outputs: {
              strategy,
              brand_check: brandText,
              approved,
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
