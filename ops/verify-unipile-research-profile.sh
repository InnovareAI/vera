#!/usr/bin/env bash
set -euo pipefail

TARGET_HOST="${TARGET_HOST:-root@157.90.255.28}"
TARGET_SSH_KEY="${TARGET_SSH_KEY:-}"
OPERATOR_EMAIL="${OPERATOR_EMAIL:-tl@innovareai.com}"

if [[ -z "$TARGET_SSH_KEY" && -f "$HOME/.ssh/vera_hetzner_ed25519" ]]; then
  TARGET_SSH_KEY="$HOME/.ssh/vera_hetzner_ed25519"
fi

SSH_ARGS=(-o BatchMode=yes -o ConnectTimeout=8)
if [[ -n "$TARGET_SSH_KEY" ]]; then
  SSH_ARGS=(-i "$TARGET_SSH_KEY" -o IdentitiesOnly=yes "${SSH_ARGS[@]}")
fi

log() {
  printf '%s [unipile-research] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"
}

log "checking shared LinkedIn research profile for $OPERATOR_EMAIL"

marker_line="$(awk '/^__REMOTE_SCRIPT__$/{print NR + 1; exit}' "$0")"
if [[ -z "$marker_line" ]]; then
  printf 'Could not find remote script marker in %s\n' "$0" >&2
  exit 1
fi

remote_env="OPERATOR_EMAIL='$OPERATOR_EMAIL'"
tail -n +"$marker_line" "$0" | ssh "${SSH_ARGS[@]}" "$TARGET_HOST" "$remote_env bash -s"
exit $?

__REMOTE_SCRIPT__
set -euo pipefail

psql_cmd() {
  docker exec content-supabase-db psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -qAtc "$1"
}

sql_escape() {
  printf "%s" "$1" | sed "s/'/''/g"
}

operator_row="$(psql_cmd "select id || '|' || email from auth.users where lower(email) = lower('$(sql_escape "$OPERATOR_EMAIL")') limit 1;")"
if [[ -z "$operator_row" ]]; then
  printf 'Operator user not found: %s\n' "$OPERATOR_EMAIL" >&2
  exit 1
fi

operator_id="${operator_row%%|*}"

master_row="$(psql_cmd "
  select id || '|' || coalesce(name, 'master') || '|' || coalesce(unipile_health_status, '') || '|' || left(unipile_account_id, 6) || '...' || right(unipile_account_id, 4)
  from public.organizations
  where coalesce(is_master, false) = true
    and unipile_account_id is not null
    and coalesce(lower(unipile_health_status), '') not in ('stale', 'error', 'disconnected', 'revoked')
  order by updated_at desc
  limit 1;
")"
if [[ -z "$master_row" ]]; then
  printf 'No usable master org LinkedIn research profile found\n' >&2
  exit 1
fi

master_id="${master_row%%|*}"
membership_count="$(psql_cmd "select count(*) from public.org_members where org_id = '$master_id' and user_id = '$operator_id';")"
if [[ "$membership_count" != "1" ]]; then
  printf 'Operator %s is not a member of master research org %s\n' "$OPERATOR_EMAIL" "$master_id" >&2
  exit 1
fi

client_org_count="$(psql_cmd "select count(*) from public.organizations where coalesce(is_master, false) = false;")"

printf 'PASS operator=%s master_profile=%s client_orgs=%s\n' "$OPERATOR_EMAIL" "$master_row" "$client_org_count"
