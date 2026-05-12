-- ── KAI Migration 001: Organisations & Users ─────────────────────────────────

CREATE TABLE organisations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  slug        text NOT NULL UNIQUE,
  plan        text NOT NULL DEFAULT 'starter' CHECK (plan IN ('starter','growth','scale','enterprise')),
  logo_url    text,
  website     text,
  industry    text,
  timezone    text NOT NULL DEFAULT 'UTC',
  locale      text NOT NULL DEFAULT 'en',
  airtable_base_id text,
  settings    jsonb NOT NULL DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  email       text NOT NULL UNIQUE,
  full_name   text,
  role        text NOT NULL DEFAULT 'member' CHECK (role IN ('owner','admin','member','viewer')),
  avatar_url  text,
  last_seen   timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX users_org_id_idx ON users(org_id);

-- Helper: returns the org_id for the current authenticated user
CREATE OR REPLACE FUNCTION kai_org_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT org_id FROM users WHERE id = auth.uid()
$$;

-- Auto-updated_at trigger function
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER organisations_updated_at
  BEFORE UPDATE ON organisations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE organisations ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "orgs_select"  ON organisations FOR SELECT USING (id = kai_org_id());
CREATE POLICY "users_select" ON users         FOR SELECT USING (org_id = kai_org_id());
CREATE POLICY "users_insert" ON users         FOR INSERT WITH CHECK (org_id = kai_org_id());
CREATE POLICY "users_update" ON users         FOR UPDATE USING (org_id = kai_org_id());

-- Dev bypass (remove when auth is wired)
CREATE POLICY "orgs_anon_all"  ON organisations FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "users_anon_all" ON users         FOR ALL TO anon USING (true) WITH CHECK (true);
