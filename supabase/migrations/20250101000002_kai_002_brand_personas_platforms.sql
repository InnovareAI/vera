-- ── KAI Migration 002: Brand Voice, Personas, Platform Configs ───────────────

CREATE TABLE brand_voice (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              uuid NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  tone                text[],
  writing_rules       text[],
  forbidden_phrases   text[],
  required_phrases    text[],
  persona_name        text,
  persona_gender      text,
  persona_descriptor  text,
  sample_posts        text[],
  system_prompt       text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE personas (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  name        text NOT NULL,
  title       text,
  pain_points text[],
  goals       text[],
  channels    text[],
  seniority   text,
  industry    text,
  is_primary  boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE platform_configs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           uuid NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  platform         text NOT NULL,
  is_active        boolean NOT NULL DEFAULT true,
  char_limit       integer,
  best_times       text[],
  hashtag_limit    integer NOT NULL DEFAULT 5,
  default_hashtags text[],
  content_types    text[],
  model_override   text,
  tone_override    text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE(org_id, platform)
);

CREATE INDEX brand_voice_org_id_idx    ON brand_voice(org_id);
CREATE INDEX personas_org_id_idx       ON personas(org_id);
CREATE INDEX platform_configs_org_idx  ON platform_configs(org_id);

CREATE TRIGGER brand_voice_updated_at
  BEFORE UPDATE ON brand_voice FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER personas_updated_at
  BEFORE UPDATE ON personas FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER platform_configs_updated_at
  BEFORE UPDATE ON platform_configs FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE brand_voice      ENABLE ROW LEVEL SECURITY;
ALTER TABLE personas         ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_configs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "brand_voice_all"      ON brand_voice      FOR ALL USING (org_id = kai_org_id());
CREATE POLICY "personas_all"         ON personas         FOR ALL USING (org_id = kai_org_id());
CREATE POLICY "platform_configs_all" ON platform_configs FOR ALL USING (org_id = kai_org_id());

-- Dev bypass
CREATE POLICY "brand_voice_anon_all"      ON brand_voice      FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "personas_anon_all"         ON personas         FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "platform_configs_anon_all" ON platform_configs FOR ALL TO anon USING (true) WITH CHECK (true);
