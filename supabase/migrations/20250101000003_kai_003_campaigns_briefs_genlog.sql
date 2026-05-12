-- ── KAI Migration 003: Campaigns, Content Briefs, Generation Log ─────────────

CREATE TABLE campaigns (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  name        text NOT NULL,
  description text,
  goal        text,
  status      text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','paused','completed')),
  start_date  date,
  end_date    date,
  platforms   text[],
  post_count  integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE content_briefs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           uuid NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  campaign_id      uuid REFERENCES campaigns(id) ON DELETE SET NULL,
  persona_id       uuid REFERENCES personas(id) ON DELETE SET NULL,
  title            text,
  objective        text NOT NULL,
  platform         text NOT NULL,
  content_type     text NOT NULL,
  key_messages     text[],
  angle            text,
  cta              text,
  model_preference text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE generation_log (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid REFERENCES organisations(id) ON DELETE SET NULL,
  post_id      uuid REFERENCES content_posts(id) ON DELETE SET NULL,
  model_used   text,
  input_tokens integer,
  output_tokens integer,
  duration_ms  integer,
  cost_usd     numeric(10,6),
  agent        text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX campaigns_org_id_idx      ON campaigns(org_id);
CREATE INDEX content_briefs_org_id_idx ON content_briefs(org_id);
CREATE INDEX generation_log_org_id_idx ON generation_log(org_id);
CREATE INDEX generation_log_post_id_idx ON generation_log(post_id);

CREATE TRIGGER campaigns_updated_at
  BEFORE UPDATE ON campaigns FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER content_briefs_updated_at
  BEFORE UPDATE ON content_briefs FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE campaigns      ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_briefs ENABLE ROW LEVEL SECURITY;
ALTER TABLE generation_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "campaigns_all"      ON campaigns      FOR ALL USING (org_id = kai_org_id());
CREATE POLICY "content_briefs_all" ON content_briefs FOR ALL USING (org_id = kai_org_id());
CREATE POLICY "generation_log_all" ON generation_log FOR ALL USING (org_id = kai_org_id());

-- Dev bypass
CREATE POLICY "campaigns_anon_all"      ON campaigns      FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "content_briefs_anon_all" ON content_briefs FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "generation_log_anon_all" ON generation_log FOR ALL TO anon USING (true) WITH CHECK (true);
