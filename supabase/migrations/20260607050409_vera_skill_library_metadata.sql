-- VERA skill library metadata.
-- Skills are not just prompt blobs: they need trigger guidance, gotchas,
-- examples, provenance, and optional client scope.

ALTER TABLE public.skills
  ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES public.projects(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS trigger_description text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS gotchas text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS good_examples jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS bad_examples jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS source_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS confidence text NOT NULL DEFAULT 'medium',
  ADD COLUMN IF NOT EXISTS performance_notes text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS last_reviewed_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'skills_confidence_check'
      AND conrelid = 'public.skills'::regclass
  ) THEN
    ALTER TABLE public.skills
      ADD CONSTRAINT skills_confidence_check
      CHECK (confidence IN ('low', 'medium', 'high', 'validated'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS skills_project_id_idx ON public.skills(project_id);
CREATE INDEX IF NOT EXISTS skills_scope_idx ON public.skills(org_id, project_id, is_system, is_active);
CREATE INDEX IF NOT EXISTS skills_good_examples_idx ON public.skills USING gin(good_examples);
CREATE INDEX IF NOT EXISTS skills_bad_examples_idx ON public.skills USING gin(bad_examples);
CREATE INDEX IF NOT EXISTS skills_source_refs_idx ON public.skills USING gin(source_refs);

DROP POLICY IF EXISTS skills_member_select ON public.skills;
DROP POLICY IF EXISTS skills_member_insert ON public.skills;
DROP POLICY IF EXISTS skills_member_update ON public.skills;
DROP POLICY IF EXISTS skills_member_delete ON public.skills;

CREATE POLICY skills_member_select ON public.skills
  FOR SELECT TO authenticated
  USING (
    (org_id IS NULL AND project_id IS NULL)
    OR private.is_org_member(org_id)
    OR private.can_project_read(project_id)
  );

CREATE POLICY skills_member_insert ON public.skills
  FOR INSERT TO authenticated
  WITH CHECK (
    is_system = false
    AND org_id IS NOT NULL
    AND (
      (project_id IS NULL AND private.is_org_member(org_id))
      OR (
        project_id IS NOT NULL
        AND private.can_project_write(project_id)
        AND org_id = private.project_org_id(project_id)
      )
    )
  );

CREATE POLICY skills_member_update ON public.skills
  FOR UPDATE TO authenticated
  USING (
    is_system = false
    AND org_id IS NOT NULL
    AND (
      (project_id IS NULL AND private.is_org_member(org_id))
      OR (project_id IS NOT NULL AND private.can_project_write(project_id))
    )
  )
  WITH CHECK (
    is_system = false
    AND org_id IS NOT NULL
    AND (
      (project_id IS NULL AND private.is_org_member(org_id))
      OR (
        project_id IS NOT NULL
        AND private.can_project_write(project_id)
        AND org_id = private.project_org_id(project_id)
      )
    )
  );

CREATE POLICY skills_member_delete ON public.skills
  FOR DELETE TO authenticated
  USING (
    is_system = false
    AND org_id IS NOT NULL
    AND (
      (project_id IS NULL AND private.is_org_member(org_id))
      OR (project_id IS NOT NULL AND private.can_project_write(project_id))
    )
  );

DROP VIEW IF EXISTS public.skill_performance;

CREATE VIEW public.skill_performance
WITH (security_invoker = true) AS
SELECT
  s.id AS skill_id,
  s.name,
  s.type,
  s.org_id,
  s.project_id,
  count(DISTINCT si.id) AS total_invocations,
  count(DISTINCT si.id) FILTER (WHERE pfo.outcome = ANY (ARRAY['approved'::text, 'posted'::text])) AS approved_count,
  count(DISTINCT si.id) FILTER (WHERE pfo.outcome = ANY (ARRAY['rejected'::text, 'changes_requested'::text])) AS rejected_count,
  count(DISTINCT si.id) FILTER (WHERE pfo.outcome = 'edited'::text) AS edited_count,
  CASE
    WHEN count(DISTINCT si.id) FILTER (WHERE pfo.outcome IS NOT NULL) > 0 THEN
      round(
        100.0
        * count(DISTINCT si.id) FILTER (WHERE pfo.outcome = ANY (ARRAY['approved'::text, 'posted'::text]))::numeric
        / count(DISTINCT si.id) FILTER (WHERE pfo.outcome IS NOT NULL)::numeric,
        1
      )
    ELSE NULL::numeric
  END AS approval_rate,
  max(si.applied_at) AS last_used_at
FROM public.skills s
LEFT JOIN public.skill_invocations si ON si.skill_id = s.id
LEFT JOIN public.post_final_outcome pfo ON pfo.post_id = si.post_id
GROUP BY s.id, s.name, s.type, s.org_id, s.project_id;

REVOKE ALL ON public.skill_performance FROM anon, authenticated;
GRANT SELECT ON public.skill_performance TO authenticated;

WITH seed(type, name, description, injected_into, trigger_description, prompt_module, trigger_when, tags, gotchas, good_examples, bad_examples, source_refs, confidence, sort_order) AS (
  VALUES
  (
    'platform'::public.skill_type,
    'LinkedIn Voice and Post Audit',
    'Use when reviewing LinkedIn posts, company pages, founder posts, or LinkedIn feed voice for strategy, structure, credibility, and platform fit.',
    'writer'::public.skill_agent,
    'Trigger for LinkedIn post reviews, LinkedIn company content audits, founder voice checks, and LinkedIn-specific rewrites.',
    'Purpose: make LinkedIn content sound credible, useful, and specific without becoming generic thought leadership.

Process:
1. Identify the reader and the business job of the post.
2. Test the first two lines for scroll-stop value.
3. Check whether the post has one clear idea, a proof path, a tension point, and a next step.
4. Make the structure native to LinkedIn: short paragraphs, strong opening, useful middle, clear close.
5. Preserve the brand voice. Do not flatten the post into generic executive content.

Gotchas:
- Do not open with "In today''s fast-paced world" or broad category claims.
- Do not turn every post into a list.
- Do not add claims that are not backed by client knowledge or source material.
- Do not use engagement bait.

Output: give the issue, the reason, and the rewrite.',
    '{"platform": "linkedin"}'::jsonb,
    ARRAY['linkedin','audit','voice','post-review'],
    ARRAY['Generic first line', 'Unsupported authority claim', 'CTA asks too much', 'Too polished for founder voice'],
    '[{"label":"Strong pattern","text":"Specific problem, sharp claim, proof, practical takeaway."}]'::jsonb,
    '[{"label":"Weak pattern","text":"Broad lesson, vague value, no proof, soft CTA."}]'::jsonb,
    '[{"label":"General Vera KB","ref":"LinkedIn audit rules and platform best practices"}]'::jsonb,
    'high',
    1000
  ),
  (
    'platform'::public.skill_type,
    'LinkedIn Headline Audit',
    'Use when evaluating or rewriting a LinkedIn profile headline, company headline, or short professional positioning line.',
    'writer'::public.skill_agent,
    'Trigger when the operator asks about a LinkedIn headline, profile positioning, founder profile, or company page top line.',
    'Purpose: make a LinkedIn headline clear, searchable, and credible.

Process:
1. Identify the buyer or audience.
2. Name the category or problem space.
3. State the outcome or transformation.
4. Add proof or specificity when available.
5. Keep it scannable and avoid stuffing buzzwords.

Gotchas:
- Do not write vague titles like "Helping businesses grow with AI".
- Do not overload the headline with every service.
- Do not use unsupported superlatives.
- Do not make it clever at the cost of clarity.

Output: score clarity, audience, searchability, proof, and differentiation. Then give 3 stronger options.',
    '{"platform": "linkedin", "content_type": "headline"}'::jsonb,
    ARRAY['linkedin','headline','profile','positioning'],
    ARRAY['Too broad', 'No audience', 'No outcome', 'Buzzword stuffing'],
    '[{"label":"Strong pattern","text":"Audience + problem + outcome + proof."}]'::jsonb,
    '[{"label":"Weak pattern","text":"Founder, advisor, builder, AI enthusiast."}]'::jsonb,
    '[{"label":"General Vera KB","ref":"LinkedIn headline audit rules"}]'::jsonb,
    'high',
    1010
  ),
  (
    'brand'::public.skill_type,
    '360 Brew Compliance Check',
    'Use when checking content against 360 Brew or regulated beverage brand rules before approval or publishing.',
    'brand_guard'::public.skill_agent,
    'Trigger for 360 Brew, compliance, alcohol, beverage, age-sensitive claims, health claims, giveaway language, or publishing approval checks.',
    'Purpose: prevent risky beverage and 360 Brew content from moving forward without review.

Process:
1. Identify the product, audience, platform, and geography if available.
2. Check for age-sensitive targeting, health claims, irresponsible consumption cues, prohibited promises, contests, and unclear disclosures.
3. Flag the exact phrase and the risk.
4. Rewrite toward safer, brand-appropriate language.
5. If the rule depends on jurisdiction or campaign policy, mark it for human review.

Gotchas:
- Do not imply health benefits unless sourced and approved.
- Do not target minors or youth culture.
- Do not encourage excessive consumption.
- Do not bury required disclaimers.
- Do not approve uncertain claims.

Output: pass, revise, or human review. Include exact fixes.',
    '{"brand": "360 Brew", "compliance": "beverage"}'::jsonb,
    ARRAY['360-brew','compliance','beverage','brand-guard'],
    ARRAY['Health claim', 'Age targeting risk', 'Missing disclaimer', 'Unclear promotion terms'],
    '[{"label":"Safer pattern","text":"Flavor, craft, occasion, and responsible enjoyment without medical or performance claims."}]'::jsonb,
    '[{"label":"Risky pattern","text":"Boosts your health, drink all night, perfect for students."}]'::jsonb,
    '[{"label":"General Vera KB","ref":"360 Brew compliance knowhow"}]'::jsonb,
    'medium',
    1020
  ),
  (
    'platform'::public.skill_type,
    'Instagram Voice Adaptation',
    'Use when adapting brand voice for Instagram captions, reels, visual posts, and community-oriented content.',
    'writer'::public.skill_agent,
    'Trigger for Instagram captions, reels, carousel captions, visual campaign copy, and Instagram tone audits.',
    'Purpose: adapt the core brand voice to Instagram without changing the brand identity.

Process:
1. Start from the core voice.
2. Make the first line visual, emotional, or concrete.
3. Keep the caption simpler than LinkedIn and more tied to the image or moment.
4. Use community language when it fits the brand.
5. Keep the CTA low friction.

Gotchas:
- Do not paste a LinkedIn essay into Instagram.
- Do not over-explain a visual.
- Do not add generic lifestyle language unless the brand actually uses it.
- Do not use hashtags unless the operator or client rules allow them.

Output: caption plus a note on why the tone fits Instagram.',
    '{"platform": "instagram"}'::jsonb,
    ARRAY['instagram','caption','voice','social'],
    ARRAY['Too LinkedIn', 'Visual mismatch', 'Generic lifestyle tone'],
    '[{"label":"Strong pattern","text":"Concrete moment, sensory detail, short caption, simple CTA."}]'::jsonb,
    '[{"label":"Weak pattern","text":"Long essay, abstract business advice, unrelated hashtags."}]'::jsonb,
    '[{"label":"General Vera KB","ref":"Instagram platform best practices"}]'::jsonb,
    'high',
    1030
  ),
  (
    'platform'::public.skill_type,
    'X Compression',
    'Use when turning ideas into X posts, X threads, or short sharp opinion content.',
    'writer'::public.skill_agent,
    'Trigger for X, Twitter, threads, short posts, punchy takes, and compressed distribution variants.',
    'Purpose: compress the idea without losing the point of view.

Process:
1. Extract one claim.
2. Remove setup and throat-clearing.
3. Make the language direct.
4. Keep one tension, one proof point, or one useful contrast.
5. For threads, make each post carry one job.

Gotchas:
- Do not shrink a LinkedIn post by cutting random sentences.
- Do not use vague punchiness with no substance.
- Do not overuse numbered threads.
- Do not turn every idea into a hot take.

Output: one short option and one thread option when useful.',
    '{"platform": "twitter"}'::jsonb,
    ARRAY['x','twitter','thread','compression'],
    ARRAY['Too vague', 'Forced hot take', 'Thread with no progression'],
    '[{"label":"Strong pattern","text":"One claim, one contrast, one useful consequence."}]'::jsonb,
    '[{"label":"Weak pattern","text":"Big claim with no context or proof."}]'::jsonb,
    '[{"label":"General Vera KB","ref":"X platform best practices"}]'::jsonb,
    'high',
    1040
  ),
  (
    'enrichment'::public.skill_type,
    'Blog SEO Strategy',
    'Use when planning, auditing, or rewriting blog posts, Medium posts, product pages, or SEO-driven articles.',
    'strategist'::public.skill_agent,
    'Trigger for SEO briefs, blog outlines, product page audits, website header analysis, and search-intent mapping.',
    'Purpose: connect search intent to useful content and business goals.

Process:
1. Identify the target search intent.
2. Map title, meta description, H1, H2s, and key claims.
3. Separate informational, commercial, and conversion jobs.
4. Build an outline that answers the query early and supports the offer later.
5. Avoid keyword stuffing. Use proof, examples, and internal links where available.

Gotchas:
- Do not optimize only for keywords.
- Do not bury the answer.
- Do not make product pages read like blog posts.
- Do not invent stats or claims.

Output: search intent, content gaps, outline, and rewrite notes.',
    '{"enrichment_type": "seo"}'::jsonb,
    ARRAY['seo','blog','medium','website','headers'],
    ARRAY['Keyword stuffing', 'No search intent', 'Unsupported claims', 'Weak CTA'],
    '[{"label":"Strong pattern","text":"Answer first, evidence next, product relevance after trust."}]'::jsonb,
    '[{"label":"Weak pattern","text":"SEO title with generic body and no proof."}]'::jsonb,
    '[{"label":"General Vera KB","ref":"SEO headers and blog best practices"}]'::jsonb,
    'high',
    1050
  ),
  (
    'platform'::public.skill_type,
    'Email Conversion Voice',
    'Use when drafting or auditing email, newsletter, nurture, campaign, and launch copy.',
    'writer'::public.skill_agent,
    'Trigger for newsletters, nurture emails, launch emails, subject lines, and conversion copy.',
    'Purpose: make email clear, human, and conversion-aware.

Process:
1. Clarify the relationship to the reader.
2. Put the main promise or reason to read early.
3. Keep paragraphs short and the CTA singular.
4. Match the sender voice and lifecycle stage.
5. Remove generic urgency unless the offer really has urgency.

Gotchas:
- Do not sound like a corporate template.
- Do not add multiple competing CTAs.
- Do not over-polish founder notes.
- Do not imply scarcity without evidence.

Output: subject line options, preview text, email body, CTA.',
    '{"platform": "email"}'::jsonb,
    ARRAY['email','newsletter','conversion','voice'],
    ARRAY['Multiple CTAs', 'Fake urgency', 'Corporate template tone'],
    '[{"label":"Strong pattern","text":"Clear reason, one promise, concise body, one next step."}]'::jsonb,
    '[{"label":"Weak pattern","text":"Hope you are well, broad update, several CTAs."}]'::jsonb,
    '[{"label":"General Vera KB","ref":"Email and newsletter best practices"}]'::jsonb,
    'high',
    1060
  ),
  (
    'brand'::public.skill_type,
    'Client TOV Extraction',
    'Use when extracting tone of voice from a website, social history, blog, sales page, or uploaded brand document.',
    'strategist'::public.skill_agent,
    'Trigger when pulling website, SEO headers, social posts, blogs, product pages, or brand documents into a client Brain.',
    'Purpose: derive a stable core brand voice plus platform adaptations.

Process:
1. Pull repeated language patterns, vocabulary, rhythm, claims, and CTAs.
2. Separate core voice from channel behavior.
3. Identify platform differences for LinkedIn, Instagram, X, blog, email, and Facebook when data exists.
4. Capture forbidden phrases and phrases worth reusing.
5. Mark confidence based on source volume and recency.

Gotchas:
- Do not define a separate brand for each platform.
- Do not overfit to one viral post.
- Do not treat old content as current voice without noting age.
- Do not confuse topic mix with tone.

Output: core TOV, platform adaptations, examples, avoid list, confidence, missing sources.',
    '{"skill_job": "voice_extraction"}'::jsonb,
    ARRAY['tone-of-voice','client-brain','audit','source-ingest'],
    ARRAY['Overfit to one source', 'Platform voice drift', 'Old content bias', 'Topic mistaken for voice'],
    '[{"label":"Strong pattern","text":"Core voice plus platform adaptations with source confidence."}]'::jsonb,
    '[{"label":"Weak pattern","text":"LinkedIn voice, Instagram voice, email voice as disconnected brands."}]'::jsonb,
    '[{"label":"General Vera KB","ref":"Voice extraction and social audit process"}]'::jsonb,
    'high',
    1070
  ),
  (
    'tool'::public.skill_type,
    'Skill Gotcha Capture',
    'Use when a draft is rejected, compliance issue appears, reviewer gives feedback, or a platform pattern fails.',
    'all'::public.skill_agent,
    'Trigger after rejected posts, reviewer feedback, compliance failures, low performance, or repeated manual edits.',
    'Purpose: turn failures into better future skills.

Process:
1. Identify the skill or platform involved.
2. Extract the failure as a gotcha, not a vague lesson.
3. Add a concrete avoid pattern and a better pattern.
4. Tie the update to evidence: rejection, edit, performance result, or compliance note.
5. Keep the skill compact. Do not add a long essay.

Gotchas:
- Do not update global Vera skills from one client preference unless it generalizes.
- Do not hide client-specific rules in global skills.
- Do not add subjective taste without an example.
- Do not remove useful flexibility.

Output: proposed gotcha, evidence, scope, and suggested skill update.',
    '{"skill_job": "skill_learning"}'::jsonb,
    ARRAY['skills','gotchas','learning-loop','performance'],
    ARRAY['Client preference globalized', 'Vague lesson', 'No evidence', 'Over-prescriptive update'],
    '[{"label":"Strong pattern","text":"When X happens, avoid Y because Z evidence showed it fails."}]'::jsonb,
    '[{"label":"Weak pattern","text":"Make it better next time."}]'::jsonb,
    '[{"label":"General Vera KB","ref":"Skill feedback and learning loop"}]'::jsonb,
    'medium',
    1080
  )
)
INSERT INTO public.skills (
  type,
  name,
  description,
  injected_into,
  trigger_description,
  prompt_module,
  trigger_when,
  tags,
  gotchas,
  good_examples,
  bad_examples,
  source_refs,
  confidence,
  is_system,
  is_active,
  sort_order,
  last_reviewed_at
)
SELECT
  seed.type,
  seed.name,
  seed.description,
  seed.injected_into,
  seed.trigger_description,
  seed.prompt_module,
  seed.trigger_when,
  seed.tags,
  seed.gotchas,
  seed.good_examples,
  seed.bad_examples,
  seed.source_refs,
  seed.confidence,
  true,
  true,
  seed.sort_order,
  now()
FROM seed
WHERE NOT EXISTS (
  SELECT 1
  FROM public.skills existing
  WHERE existing.org_id IS NULL
    AND existing.project_id IS NULL
    AND lower(existing.name) = lower(seed.name)
);
