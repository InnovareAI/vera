#!/usr/bin/env bash
set -euo pipefail

TARGET_HOST="${TARGET_HOST:-root@157.90.255.28}"
TARGET_SSH_KEY="${TARGET_SSH_KEY:-}"

if [[ -z "$TARGET_SSH_KEY" && -f "$HOME/.ssh/vera_hetzner_ed25519" ]]; then
  TARGET_SSH_KEY="$HOME/.ssh/vera_hetzner_ed25519"
fi

SSH_ARGS=(-o BatchMode=yes -o ConnectTimeout=8)
if [[ -n "$TARGET_SSH_KEY" ]]; then
  SSH_ARGS=(-i "$TARGET_SSH_KEY" -o IdentitiesOnly=yes "${SSH_ARGS[@]}")
fi

log() {
  printf '%s [audience-scope] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"
}

log "checking audience client-space scope"

marker_line="$(awk '/^__REMOTE_SCRIPT__$/{print NR + 1; exit}' "$0")"
if [[ -z "$marker_line" ]]; then
  printf 'Could not find remote script marker in %s\n' "$0" >&2
  exit 1
fi

tail -n +"$marker_line" "$0" | ssh "${SSH_ARGS[@]}" "$TARGET_HOST" bash -s
exit $?

__REMOTE_SCRIPT__
set -euo pipefail

psql_cmd() {
  docker exec content-supabase-db psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -qAtc "$1"
}

project_column="$(psql_cmd "select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'audiences' and column_name = 'project_id';")"
if [[ "$project_column" != "1" ]]; then
  printf 'Expected audiences.project_id to exist, found %s columns\n' "$project_column" >&2
  exit 1
fi

table_state="$(psql_cmd "select relrowsecurity::text || '|' || relforcerowsecurity::text from pg_class where oid = 'public.audiences'::regclass;")"
if [[ "$table_state" != "true|true" ]]; then
  printf 'Expected audiences RLS and FORCE RLS to both be true, got %s\n' "$table_state" >&2
  exit 1
fi

policy_text="$(psql_cmd "select coalesce(qual, '') || '|' || coalesce(with_check, '') from pg_policies where schemaname = 'public' and tablename = 'audiences' and policyname = 'audiences_member_all';")"
if [[ "$policy_text" != *"private.can_project_read(project_id)"* || "$policy_text" != *"private.can_project_write(project_id)"* ]]; then
  printf 'Audience policy is not project-scoped:\n%s\n' "$policy_text" >&2
  exit 1
fi

anon_grants="$(psql_cmd "select count(*) from information_schema.role_table_grants where table_schema = 'public' and table_name = 'audiences' and grantee = 'anon';")"
if [[ "$anon_grants" != "0" ]]; then
  printf 'Expected zero anon grants on audiences, found %s\n' "$anon_grants" >&2
  exit 1
fi

project_row="$(psql_cmd "select p.id || '|' || p.org_id from public.projects p where coalesce(p.is_archived, false) = false order by p.created_at nulls last, p.id limit 1;")"
if [[ -z "$project_row" ]]; then
  printf 'No project row available for audience scope smoke test\n' >&2
  exit 1
fi

project_id="${project_row%%|*}"
org_id="${project_row##*|}"
audience_id=""

cleanup() {
  if [[ -n "$audience_id" ]]; then
    psql_cmd "delete from public.audiences where id = '$audience_id';" >/dev/null || true
  fi
}
trap cleanup EXIT

audience_id="$(psql_cmd "insert into public.audiences (org_id, project_id, kind, name, is_primary, pain_points, goals)
  values ('$org_id', '$project_id', 'audience', 'Audience scope smoke', false, '[]'::jsonb, '[]'::jsonb)
  returning id;")"

if [[ -z "$audience_id" ]]; then
  printf 'Audience smoke insert did not return an id\n' >&2
  exit 1
fi

stored_scope="$(psql_cmd "select org_id || '|' || project_id from public.audiences where id = '$audience_id';")"
if [[ "$stored_scope" != "$org_id|$project_id" ]]; then
  printf 'Audience smoke row stored unexpected scope: %s\n' "$stored_scope" >&2
  exit 1
fi

counts="$(psql_cmd "select count(*) || '|' || count(*) filter (where project_id is null) || '|' || count(*) filter (where project_id is not null) from public.audiences;")"
printf 'PASS project_id=true rls=true force_rls=true anon_grants=0 smoke_row=%s counts=%s\n' "$audience_id" "$counts"
