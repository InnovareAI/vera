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
  printf '%s [platform-configs] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"
}

log "checking retired platform_configs access"

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

table_state="$(psql_cmd "select relrowsecurity::text || '|' || relforcerowsecurity::text from pg_class where oid = 'public.platform_configs'::regclass;")"
if [[ "$table_state" != "true|true" ]]; then
  printf 'Expected platform_configs RLS and FORCE RLS to both be true, got %s\n' "$table_state" >&2
  exit 1
fi

policy_count="$(psql_cmd "select count(*) from pg_policies where schemaname = 'public' and tablename = 'platform_configs';")"
if [[ "$policy_count" != "0" ]]; then
  printf 'Expected zero platform_configs policies, found %s\n' "$policy_count" >&2
  psql_cmd "select policyname || '|' || cmd || '|' || roles::text from pg_policies where schemaname = 'public' and tablename = 'platform_configs' order by policyname;" >&2
  exit 1
fi

grant_count="$(psql_cmd "select count(*) from information_schema.role_table_grants where table_schema = 'public' and table_name = 'platform_configs' and grantee in ('anon','authenticated','service_role');")"
if [[ "$grant_count" != "0" ]]; then
  printf 'Expected zero Data API role grants on platform_configs, found %s\n' "$grant_count" >&2
  psql_cmd "select grantee || '|' || privilege_type from information_schema.role_table_grants where table_schema = 'public' and table_name = 'platform_configs' and grantee in ('anon','authenticated','service_role') order by grantee, privilege_type;" >&2
  exit 1
fi

comment_text="$(psql_cmd "select coalesce(obj_description('public.platform_configs'::regclass, 'pg_class'), '');")"
if [[ "$comment_text" != *"Retired legacy org-wide channel writing rules"* ]]; then
  printf 'Missing retirement comment on platform_configs:\n%s\n' "$comment_text" >&2
  exit 1
fi

row_count="$(psql_cmd "select count(*) from public.platform_configs;")"
printf 'PASS rls=true force_rls=true policies=0 grants=0 rows=%s\n' "$row_count"
