#!/usr/bin/env bash
set -euo pipefail

TARGET_HOST="${TARGET_HOST:-root@157.90.255.28}"
TARGET_STACK="${TARGET_STACK:-/srv/supabase-content}"
TARGET_SSH_KEY="${TARGET_SSH_KEY:-}"
PROJECT_SLUG="${PROJECT_SLUG:-rdf-style}"
SUPABASE_PUBLIC_URL="${SUPABASE_PUBLIC_URL:-https://supabase-content-eu.innovareai.com}"

if [[ -z "$TARGET_SSH_KEY" && -f "$HOME/.ssh/vera_hetzner_ed25519" ]]; then
  TARGET_SSH_KEY="$HOME/.ssh/vera_hetzner_ed25519"
fi

SSH_ARGS=(-o BatchMode=yes -o ConnectTimeout=8)
if [[ -n "$TARGET_SSH_KEY" ]]; then
  SSH_ARGS=(-i "$TARGET_SSH_KEY" -o IdentitiesOnly=yes "${SSH_ARGS[@]}")
fi

log() {
  printf '%s [post-marked-atomic] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"
}

log "checking atomic mark-posted path for $PROJECT_SLUG"

marker_line="$(awk '/^__REMOTE_SCRIPT__$/{print NR + 1; exit}' "$0")"
if [[ -z "$marker_line" ]]; then
  printf 'Could not find remote script marker in %s\n' "$0" >&2
  exit 1
fi

remote_env="TARGET_STACK='$TARGET_STACK' PROJECT_SLUG='$PROJECT_SLUG' SUPABASE_PUBLIC_URL='$SUPABASE_PUBLIC_URL'"
tail -n +"$marker_line" "$0" | ssh "${SSH_ARGS[@]}" "$TARGET_HOST" "$remote_env bash -s"
exit $?

__REMOTE_SCRIPT__
set -euo pipefail

env_file="$TARGET_STACK/.env"
if [[ ! -f "$env_file" ]]; then
  printf 'Missing env file: %s\n' "$env_file" >&2
  exit 1
fi

service_key="$(grep -m1 -E '^(SUPABASE_SERVICE_ROLE_KEY|SERVICE_ROLE_KEY)=' "$env_file" | cut -d= -f2-)"
if [[ -z "$service_key" ]]; then
  printf 'SUPABASE_SERVICE_ROLE_KEY or SERVICE_ROLE_KEY is missing in %s\n' "$env_file" >&2
  exit 1
fi

psql_cmd() {
  docker exec content-supabase-db psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -qAtc "$1"
}

sql_escape() {
  printf "%s" "$1" | sed "s/'/''/g"
}

project_row="$(psql_cmd "select id || '|' || org_id from public.projects where slug = '$(sql_escape "$PROJECT_SLUG")' limit 1;")"
if [[ -z "$project_row" ]]; then
  printf 'Project slug not found: %s\n' "$PROJECT_SLUG" >&2
  exit 1
fi

project_id="${project_row%%|*}"
org_id="${project_row##*|}"
post_id=""
response_file="$(mktemp)"

cleanup() {
  rm -f "$response_file" || true
  if [[ -n "$post_id" ]]; then
    psql_cmd "delete from public.content_post_publish_claims where post_id = '$post_id'; delete from public.content_posts where id = '$post_id';" >/dev/null || true
  fi
}
trap cleanup EXIT

post_id="$(psql_cmd "insert into public.content_posts (org_id, project_id, channel, copy, status, title)
  values ('$org_id', '$project_id', 'linkedin', 'atomic mark-posted smoke', 'pending', 'atomic mark-posted smoke')
  returning id;")"

first_status="$(curl -sS -o "$response_file" -w '%{http_code}' --max-time 20 \
  -H "Authorization: Bearer $service_key" \
  -H "apikey: $service_key" \
  -H "Content-Type: application/json" \
  -d "{\"post_id\":\"$post_id\",\"action\":\"posted\",\"posted_url\":\"https://example.com/first\",\"provider_post_id\":\"first-provider-id\"}" \
  "$SUPABASE_PUBLIC_URL/functions/v1/approval-webhook")"
first_body="$(cat "$response_file")"
if [[ "$first_status" != "200" || "$first_body" != *"\"success\":true"* ]]; then
  printf 'Expected first mark-posted call to succeed, got HTTP %s\n%s\n' "$first_status" "$first_body" >&2
  exit 1
fi

row_after_first="$(psql_cmd "select posted_url || '|' || provider_post_id || '|' || (posted_at is not null)::text from public.content_posts where id = '$post_id';")"
if [[ "$row_after_first" != "https://example.com/first|first-provider-id|true" ]]; then
  printf 'Unexpected row after first mark-posted call: %s\n' "$row_after_first" >&2
  exit 1
fi

second_status="$(curl -sS -o "$response_file" -w '%{http_code}' --max-time 20 \
  -H "Authorization: Bearer $service_key" \
  -H "apikey: $service_key" \
  -H "Content-Type: application/json" \
  -d "{\"post_id\":\"$post_id\",\"action\":\"posted\",\"posted_url\":\"https://example.com/second\",\"provider_post_id\":\"second-provider-id\"}" \
  "$SUPABASE_PUBLIC_URL/functions/v1/approval-webhook")"
second_body="$(cat "$response_file")"
if [[ "$second_status" != "409" || "$second_body" != *"already marked posted"* ]]; then
  printf 'Expected second mark-posted call to be rejected, got HTTP %s\n%s\n' "$second_status" "$second_body" >&2
  exit 1
fi

row_after_second="$(psql_cmd "select posted_url || '|' || provider_post_id || '|' || (posted_at is not null)::text from public.content_posts where id = '$post_id';")"
if [[ "$row_after_second" != "$row_after_first" ]]; then
  printf 'Second mark-posted call mutated the row:\nfirst=%s\nsecond=%s\n' "$row_after_first" "$row_after_second" >&2
  exit 1
fi

printf 'PASS project=%s post=%s first=%s second=%s row_preserved=true\n' "$PROJECT_SLUG" "$post_id" "$first_status" "$second_status"
