-- ── KAI Migration 006: Skills ─────────────────────────────────────────────────

CREATE TYPE skill_type AS ENUM (
  'platform',
  'content',
  'brand',
  'persona',
  'enrichment',
  'tool'
);

CREATE TYPE skill_agent AS ENUM (
  'strategist',
  'writer',
  'brand_guard',
  'publisher',
  'all'
);

CREATE TABLE skills (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid REFERENCES organisations(id) ON DELETE CASCADE,
  parent_id       uuid REFERENCES skills(id) ON DELETE SET NULL,
  type            skill_type    NOT NULL,
  name            text          NOT NULL,
  description     text          NOT NULL,
  injected_into   skill_agent   NOT NULL DEFAULT 'writer',
  prompt_module   text          NOT NULL,
  trigger_when    jsonb         NOT NULL DEFAULT '{}',
  tags            text[]        NOT NULL DEFAULT '{}',
  is_active       boolean       NOT NULL DEFAULT true,
  is_system       boolean       NOT NULL DEFAULT false,
  sort_order      integer       NOT NULL DEFAULT 0,
  created_at      timestamptz   NOT NULL DEFAULT now(),
  updated_at      timestamptz   NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS skill_invocations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  skill_id    uuid NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  org_id      uuid REFERENCES organisations(id) ON DELETE SET NULL,
  post_id     uuid REFERENCES content_posts(id) ON DELETE SET NULL,
  applied_in  text NOT NULL,
  applied_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  applied_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS post_outcomes (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id      uuid NOT NULL REFERENCES content_posts(id) ON DELETE CASCADE,
  outcome      text NOT NULL CHECK (outcome IN ('approved','posted','rejected','changes_requested','edited')),
  feedback     text,
  edit_summary jsonb,
  recorded_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  recorded_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX skills_org_id_idx        ON skills(org_id);
CREATE INDEX skills_type_idx          ON skills(type);
CREATE INDEX skills_injected_into_idx ON skills(injected_into);
CREATE INDEX skills_is_system_idx     ON skills(is_system);
CREATE INDEX skills_tags_idx          ON skills USING gin(tags);
CREATE INDEX skills_trigger_when_idx  ON skills USING gin(trigger_when);
CREATE INDEX skill_invocations_skill_idx ON skill_invocations(skill_id);
CREATE INDEX skill_invocations_org_idx ON skill_invocations(org_id);
CREATE INDEX skill_invocations_post_idx ON skill_invocations(post_id);
CREATE INDEX post_outcomes_post_idx ON post_outcomes(post_id, recorded_at DESC);

CREATE TRIGGER skills_updated_at
  BEFORE UPDATE ON skills
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE skills ENABLE ROW LEVEL SECURITY;
ALTER TABLE skill_invocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE post_outcomes ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE VIEW post_final_outcome
WITH (security_invoker = true) AS
SELECT DISTINCT ON (post_id)
  post_id,
  outcome,
  feedback,
  edit_summary,
  recorded_at
FROM post_outcomes
ORDER BY post_id, recorded_at DESC;

-- Orgs can see system/library skills + their own
CREATE POLICY "skills_select" ON skills
  FOR SELECT USING (org_id IS NULL OR org_id = kai_org_id());

-- Orgs can only modify their own non-system skills
CREATE POLICY "skills_insert" ON skills
  FOR INSERT WITH CHECK (org_id = kai_org_id() AND is_system = false);

CREATE POLICY "skills_update" ON skills
  FOR UPDATE USING (org_id = kai_org_id() AND is_system = false);

CREATE POLICY "skills_delete" ON skills
  FOR DELETE USING (org_id = kai_org_id() AND is_system = false);

-- Dev bypass (remove when auth is wired)
CREATE POLICY "skills_anon_all" ON skills
  FOR ALL TO anon USING (true) WITH CHECK (true);

-- ── Seed: KAI system skill library ───────────────────────────────────────────
INSERT INTO skills (type, name, description, injected_into, prompt_module, trigger_when, tags, is_system, sort_order) VALUES

('platform', 'LinkedIn Post',
 'Formats content for LinkedIn feed: professional tone, short paragraphs, strong opening hook.',
 'writer',
 'Format this as a LinkedIn post. Use short paragraphs (1–3 lines max). Open with a hook that stops the scroll — a bold claim, a surprising number, or a short story. End with a clear CTA or question. No hashtags in the body; they go at the end. Professional but human tone.',
 '{"platform": "linkedin", "content_type": "post"}', ARRAY['linkedin','post','format'], true, 10),

('platform', 'LinkedIn Thread',
 'Structures content as a multi-post LinkedIn numbered thread.',
 'writer',
 'Structure this as a LinkedIn thread of 6–10 numbered posts. Post 1 is the hook (bold claim or question). Posts 2–8 are the substance — one idea per post, max 3 lines each. Final post is the CTA or summary.',
 '{"platform": "linkedin", "content_type": "thread"}', ARRAY['linkedin','thread','format'], true, 11),

('platform', 'Twitter / X Hook',
 'Short punchy copy optimised for Twitter/X — under 280 characters, high engagement.',
 'writer',
 'Write for Twitter/X. Max 280 characters per tweet. Lead with a contrarian claim, a surprising stat, or a question. Be direct — no preamble.',
 '{"platform": "twitter"}', ARRAY['twitter','x','short-form'], true, 20),

('platform', 'Instagram Caption',
 'Casual, visual-first caption with strong first line and hashtag block.',
 'writer',
 'Write an Instagram caption. First line must hook before the "more" fold. Body is warm and conversational. End with a question or CTA. Add 5–10 relevant hashtags after two line breaks.',
 '{"platform": "instagram"}', ARRAY['instagram','caption','social'], true, 30),

('platform', 'Quora Answer',
 'Long-form authoritative answer — structured, credible, no fluff.',
 'writer',
 'Write a Quora answer. Open by directly answering the question in 1–2 sentences. Expand with structured reasoning. Include a concrete example. End with a nuanced takeaway.',
 '{"platform": "quora"}', ARRAY['quora','long-form','answer'], true, 40),

('content', 'Thought Leadership',
 'Positions the author as a credible expert — opinion-led, insight-driven, not promotional.',
 'writer',
 'This is a thought leadership post. Lead with a non-obvious insight or contrarian take. Support with a specific example or experience. Avoid generic advice. No product pitches.',
 '{"content_type": "thought_leadership"}', ARRAY['thought-leadership','authority','brand'], true, 100),

('content', 'Cold Outreach',
 'Short personalised outreach — problem-aware, no fluff, clear ask.',
 'writer',
 'Write cold outreach copy. Max 3 short paragraphs: (1) specific reason you''re reaching out, (2) the problem you solve in one sentence, (3) a low-friction CTA. No "I hope this finds you well."',
 '{"content_type": "cold_outreach"}', ARRAY['outreach','email','sales'], true, 110),

('content', 'Product / Feature Launch',
 'Announces a product or feature — benefit-led, precise, builds excitement.',
 'writer',
 'Lead with the customer benefit, not the feature name. Structure: problem → solution → proof → CTA. Be specific about what changed and why it matters.',
 '{"content_type": "product_launch"}', ARRAY['product','launch','announcement'], true, 120),

('content', 'Case Study / Story',
 'Narrative success story — situation, action, result, lesson.',
 'writer',
 'Structure as: (1) situation/problem, (2) action taken, (3) result with a specific metric, (4) lesson or takeaway. Make it concrete — names, numbers, timeframes where available.',
 '{"content_type": "case_study"}', ARRAY['case-study','story','proof'], true, 130),

('persona', 'B2B Decision Maker',
 'Writing for VP / Director / C-suite — outcome-focused, ROI-driven.',
 'strategist',
 'The target reader is a B2B decision maker (VP, Director, or C-suite). They are time-poor and ROI-focused. Frame everything in terms of business impact: revenue, efficiency, risk, scale.',
 '{"persona_type": "b2b_decision_maker"}', ARRAY['b2b','executive','decision-maker'], true, 200),

('persona', 'Solo Founder / Bootstrapper',
 'Writing for solo founders — wearing all hats, resource-constrained.',
 'strategist',
 'The target reader is a solo founder or bootstrapper. No team, limited budget, doing everything themselves. Speak peer-to-peer. Give practical leverage.',
 '{"persona_type": "solo_founder"}', ARRAY['founder','bootstrapper','smb'], true, 210),

('enrichment', 'SEO Optimisation',
 'Weaves target keywords naturally, structures for featured snippets.',
 'writer',
 'Optimise this content for search. Use the primary keyword in the first 100 words and naturally 2–3 more times. Structure with clear headers matching search intent. Include a direct answer early for featured snippet eligibility.',
 '{"enrichment_type": "seo"}', ARRAY['seo','search','keywords'], true, 300);
