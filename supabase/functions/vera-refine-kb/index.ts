// VERA weekly KB refinement.
//
// For each org with KB activity in the last week:
//   1. Cluster recent raw items via embedding similarity into theme groups
//   2. For each cluster of ≥3 raw items with no covering article, propose
//      a new wiki article (kind='create')
//   3. For each article older than 60 days with new related raw items,
//      propose an update (kind='update')
//   4. Cross-article pass via Claude: surface contradictions, mark stale
//
// All proposals land in kb_article_revisions with status='pending'. HITL.
//
// Trigger: pg_cron Saturdays 06:00 UTC. Or manually:
//   curl -X POST .../functions/v1/vera-refine-kb -H "Authorization: Bearer $KEY"

import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import Anthropic from 'npm:@anthropic-ai/sdk'
import { createClient } from 'npm:@supabase/supabase-js'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, content-type',
}

const MODEL = 'claude-sonnet-4-6'
const MIN_CLUSTER_SIZE = 3
const STALE_DAYS = 60

interface RawItem {
  id: string
  org_id: string
  title: string | null
  content: string
  kind: string
  source: string | null
  ingested_at: string
}

interface ArticleSnap {
  id: string
  title: string
  summary: string | null
  body: string
  themes: string[]
  source_ids: string[]
  updated_at: string
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'method not allowed' }), {
      status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )
  const anthropic = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY')! })

  // Iterate orgs with any KB activity ever (cheap — small table)
  const { data: orgs } = await supabase.from('organizations').select('id, name')
  if (!orgs?.length) {
    return new Response(JSON.stringify({ orgs_processed: 0 }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const orgResults: Array<{
    org_id: string; org_name: string
    proposed_create: number; proposed_update: number; flagged_stale: number
    errors: string[]
  }> = []

  for (const org of orgs) {
    const orgId = org.id as string
    const orgName = org.name as string
    const result = { org_id: orgId, org_name: orgName, proposed_create: 0, proposed_update: 0, flagged_stale: 0, errors: [] as string[] }

    try {
      // Pull unsourced + recent raw items (not yet cited by any article)
      const { data: raws } = await supabase.from('kb_raw')
        .select('id, org_id, title, content, kind, source, ingested_at')
        .eq('org_id', orgId)
        .not('embedding', 'is', null)
        .gte('ingested_at', new Date(Date.now() - 30 * 86400000).toISOString())
        .limit(80)
      if (!raws?.length) { orgResults.push(result); continue }

      const { data: articles } = await supabase.from('kb_articles')
        .select('id, title, summary, body, themes, source_ids, updated_at')
        .eq('org_id', orgId)
        .eq('status', 'published')
        .limit(100)
      const existingSourceIds = new Set<string>()
      for (const a of (articles ?? []) as ArticleSnap[]) {
        for (const sid of a.source_ids) existingSourceIds.add(sid)
      }

      // Unsourced raws — candidates for new article clustering
      const orphans = (raws as RawItem[]).filter(r => !existingSourceIds.has(r.id))
      if (orphans.length < MIN_CLUSTER_SIZE) {
        orgResults.push(result)
        continue
      }

      // Ask Claude to cluster orphans into themes + propose article candidates.
      const orphanDigest = orphans.slice(0, 40).map(r =>
        `[${r.id.slice(0, 8)}] ${r.kind} · "${r.title ?? '(untitled)'}" · ${r.content.slice(0, 400).replace(/\s+/g, ' ')}`,
      ).join('\n\n')

      const prop = await anthropic.messages.create({
        model: MODEL,
        max_tokens: 4096,
        system: 'You are a knowledge base curator. Output JSON only — no preamble, no markdown fences.',
        messages: [{
          role: 'user',
          content: `${orphans.length} raw KB items are not yet cited by any wiki article. Cluster them into themes and propose new wiki articles where ≥${MIN_CLUSTER_SIZE} items support a coherent theme.

Existing wiki article titles (for de-duplication — do NOT propose articles that overlap with these):
${((articles ?? []) as ArticleSnap[]).map(a => `- ${a.title}`).join('\n') || '(none yet)'}

Orphan raw items (id prefix · kind · title · excerpt):
${orphanDigest}

Output format (JSON only):
{
  "proposals": [
    {
      "topic": "<4-8 word claim-style article title>",
      "themes": ["tag1", "tag2"],
      "source_id_prefixes": ["abc12345", "..."],
      "rationale": "<1-2 sentence why this cluster justifies an article>",
      "confidence": <0.0-1.0>
    }
  ]
}

Rules:
- Only propose if ≥${MIN_CLUSTER_SIZE} orphans support the theme
- confidence < 0.5 → skip (not worth queuing)
- Don't propose articles that duplicate existing titles
- Empty array if no good clusters`,
        }],
      })

      const text = prop.content
        .filter(b => b.type === 'text')
        .map(b => b.text)
        .join('')
      let parsed: { proposals?: Array<{ topic: string; themes?: string[]; source_id_prefixes: string[]; rationale: string; confidence: number }> } = {}
      try {
        parsed = JSON.parse(text.replace(/^```(json)?\s*|\s*```$/g, '').trim())
      } catch {
        result.errors.push('LLM JSON parse failed')
        orgResults.push(result)
        continue
      }

      for (const p of parsed.proposals ?? []) {
        if (p.confidence < 0.5) continue
        // Resolve prefixes back to full ids
        const matchedIds = orphans
          .filter(o => p.source_id_prefixes.some(pref => o.id.startsWith(pref)))
          .map(o => o.id)
        if (matchedIds.length < MIN_CLUSTER_SIZE) continue

        await supabase.from('kb_article_revisions').insert({
          org_id: orgId,
          kind: 'create',
          proposed_title: p.topic,
          proposed_body: null,  // body composed at approval time via kb_synthesize
          changes_summary: p.rationale,
          confidence: p.confidence,
          evidence: { source_ids: matchedIds, themes: p.themes ?? [] },
          status: 'pending',
        })
        result.proposed_create++
      }

      // Mark articles stale if they haven't been updated in STALE_DAYS days
      const stalecutoff = new Date(Date.now() - STALE_DAYS * 86400000).toISOString()
      const staleCandidates = ((articles ?? []) as ArticleSnap[])
        .filter(a => a.updated_at < stalecutoff)
      for (const a of staleCandidates.slice(0, 10)) {
        await supabase.from('kb_article_revisions').insert({
          article_id: a.id,
          org_id: orgId,
          kind: 'mark_stale',
          changes_summary: `Article "${a.title}" not updated in ${STALE_DAYS}+ days. Review and either refresh or archive.`,
          confidence: 0.7,
          evidence: { last_updated: a.updated_at },
          status: 'pending',
        })
        result.flagged_stale++
      }

      // Audit log
      await supabase.from('kb_change_log').insert({
        org_id: orgId,
        event: 'refine',
        detail: {
          orphans_examined: orphans.length,
          proposals: result.proposed_create,
          stale_flagged: result.flagged_stale,
        },
      })
    } catch (err) {
      result.errors.push(err instanceof Error ? err.message : String(err))
    }
    orgResults.push(result)
  }

  return new Response(JSON.stringify({
    orgs_processed: orgResults.length,
    total_proposed_create: orgResults.reduce((s, r) => s + r.proposed_create, 0),
    total_flagged_stale:   orgResults.reduce((s, r) => s + r.flagged_stale, 0),
    results: orgResults,
  }, null, 2), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
})
