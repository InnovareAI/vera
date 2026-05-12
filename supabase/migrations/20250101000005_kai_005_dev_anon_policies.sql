-- ── KAI Migration 005: Dev anon bypass policies ───────────────────────────────
-- REMOVE BEFORE PRODUCTION — replaced by Supabase Auth (Task #8)

ALTER TABLE content_posts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "content_posts_anon_all" ON content_posts
  FOR ALL TO anon USING (true) WITH CHECK (true);
