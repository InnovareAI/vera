#!/usr/bin/env bash
set -euo pipefail

TARGET_HOST="${TARGET_HOST:-root@157.90.255.28}"
TARGET_STACK="${TARGET_STACK:-/srv/supabase-content}"
TARGET_SSH_KEY="${TARGET_SSH_KEY:-}"
PROJECT_SLUG="${PROJECT_SLUG:-rdf-style}"

if [[ -z "$TARGET_SSH_KEY" && -f "$HOME/.ssh/vera_hetzner_ed25519" ]]; then
  TARGET_SSH_KEY="$HOME/.ssh/vera_hetzner_ed25519"
fi

SSH_ARGS=(-o BatchMode=yes -o ConnectTimeout=8)
if [[ -n "$TARGET_SSH_KEY" ]]; then
  SSH_ARGS=(-i "$TARGET_SSH_KEY" -o IdentitiesOnly=yes "${SSH_ARGS[@]}")
fi

log() {
  printf '%s [publish-claim] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"
}

log "checking atomic publish claim lock for $PROJECT_SLUG"

marker_line="$(awk '/^__REMOTE_SCRIPT__$/{print NR + 1; exit}' "$0")"
if [[ -z "$marker_line" ]]; then
  printf 'Could not find remote script marker in %s\n' "$0" >&2
  exit 1
fi

remote_env="TARGET_STACK='$TARGET_STACK' PROJECT_SLUG='$PROJECT_SLUG'"
tail -n +"$marker_line" "$0" | ssh "${SSH_ARGS[@]}" "$TARGET_HOST" "$remote_env bash -s"
exit $?

__REMOTE_SCRIPT__
set -euo pipefail

psql_cmd() {
  docker exec content-supabase-db psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -qAtc "$1"
}

project_row="$(psql_cmd "select id || '|' || org_id from public.projects where slug = '$PROJECT_SLUG' limit 1;")"
if [[ -z "$project_row" ]]; then
  printf 'Project slug not found: %s\n' "$PROJECT_SLUG" >&2
  exit 1
fi

project_id="${project_row%%|*}"
org_id="${project_row##*|}"
post_id=""

cleanup() {
  if [[ -n "$post_id" ]]; then
    psql_cmd "delete from public.content_post_publish_claims where post_id = '$post_id'; delete from public.content_posts where id = '$post_id';" >/dev/null || true
  fi
}
trap cleanup EXIT

post_id="$(psql_cmd "insert into public.content_posts (org_id, project_id, channel, copy, status, title)
  values ('$org_id', '$project_id', 'linkedin', 'publish claim smoke', 'pending', 'publish claim smoke')
  returning id;")"

first="$(psql_cmd "select ok || '|' || status || '|' || message
  from public.claim_content_post_publish('$post_id', '$org_id', '$project_id', 'linkedin', 'claim-smoke-a', interval '15 minutes');")"
second="$(psql_cmd "select ok || '|' || status || '|' || message
  from public.claim_content_post_publish('$post_id', '$org_id', '$project_id', 'linkedin', 'claim-smoke-b', interval '15 minutes');")"

first_ok="${first%%|*}"
first_rest="${first#*|}"
first_status="${first_rest%%|*}"
second_ok="${second%%|*}"
second_rest="${second#*|}"
second_status="${second_rest%%|*}"

if [[ "$first_ok" != "true" || "$first_status" != "200" ]]; then
  printf 'Expected first claim true|200, got %s\n' "$first" >&2
  exit 1
fi

if [[ "$second_ok" != "false" || "$second_status" != "409" ]]; then
  printf 'Expected second claim false|409, got %s\n' "$second" >&2
  exit 1
fi

claim_count="$(psql_cmd "select count(*) from public.content_post_publish_claims where post_id = '$post_id' and claim_status = 'in_progress';")"
if [[ "$claim_count" != "1" ]]; then
  printf 'Expected exactly one in-progress claim, got %s\n' "$claim_count" >&2
  exit 1
fi

printf 'PASS project=%s post=%s first=%s second=%s in_progress_claims=%s\n' "$PROJECT_SLUG" "$post_id" "$first_status" "$second_status" "$claim_count"
