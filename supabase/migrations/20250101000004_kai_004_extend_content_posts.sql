-- ── KAI Migration 004: Extend content_posts ──────────────────────────────────

ALTER TABLE content_posts
  ADD COLUMN IF NOT EXISTS org_id        uuid REFERENCES organisations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS campaign_id   uuid REFERENCES campaigns(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS brief_id      uuid REFERENCES content_briefs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS persona_id    uuid REFERENCES personas(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS model_used    text,
  ADD COLUMN IF NOT EXISTS agent_outputs jsonb,
  ADD COLUMN IF NOT EXISTS hashtags      text[],
  ADD COLUMN IF NOT EXISTS scheduled_at  timestamptz,
  ADD COLUMN IF NOT EXISTS published_at  timestamptz,
  ADD COLUMN IF NOT EXISTS created_by    uuid REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS content_posts_org_id_idx      ON content_posts(org_id);
CREATE INDEX IF NOT EXISTS content_posts_campaign_id_idx ON content_posts(campaign_id);
CREATE INDEX IF NOT EXISTS content_posts_status_idx      ON content_posts(status);
CREATE INDEX IF NOT EXISTS content_posts_scheduled_at_idx ON content_posts(scheduled_at);

DROP TRIGGER IF EXISTS content_posts_updated_at ON content_posts;
CREATE TRIGGER content_posts_updated_at
  BEFORE UPDATE ON content_posts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
