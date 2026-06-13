#!/usr/bin/env bash
set -euo pipefail

TARGET_HOST="${TARGET_HOST:-root@157.90.255.28}"
TARGET_STACK="${TARGET_STACK:-/srv/supabase-content}"
TARGET_SSH_KEY="${TARGET_SSH_KEY:-}"
SUPABASE_PUBLIC_URL="${SUPABASE_PUBLIC_URL:-https://supabase-content-eu.innovareai.com}"

if [[ -z "$TARGET_SSH_KEY" && -f "$HOME/.ssh/vera_hetzner_ed25519" ]]; then
  TARGET_SSH_KEY="$HOME/.ssh/vera_hetzner_ed25519"
fi

SSH_ARGS=(-o BatchMode=yes -o ConnectTimeout=8)
if [[ -n "$TARGET_SSH_KEY" ]]; then
  SSH_ARGS=(-i "$TARGET_SSH_KEY" -o IdentitiesOnly=yes "${SSH_ARGS[@]}")
fi

log() {
  printf '%s [vera-chat-auth] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"
}

log "checking vera-chat auth gate"

marker_line="$(awk '/^__REMOTE_SCRIPT__$/{print NR + 1; exit}' "$0")"
if [[ -z "$marker_line" ]]; then
  printf 'Could not find remote script marker in %s\n' "$0" >&2
  exit 1
fi

remote_env="TARGET_STACK='$TARGET_STACK' SUPABASE_PUBLIC_URL='$SUPABASE_PUBLIC_URL'"
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

response_file="$(mktemp)"
trap 'rm -f "$response_file"' EXIT

chat_url="$SUPABASE_PUBLIC_URL/functions/v1/vera-chat"
valid_body='{"org_id":"00000000-0000-4000-8000-000000000000","project_id":"00000000-0000-4000-8000-000000000001","messages":[{"role":"user","content":"auth smoke"}]}'

no_auth_status="$(curl -sS -o "$response_file" -w '%{http_code}' --max-time 20 \
  -H "Content-Type: application/json" \
  -d "$valid_body" \
  "$chat_url")"
no_auth_body="$(cat "$response_file")"
if [[ "$no_auth_status" != "401" || "$no_auth_body" != *"Unauthorized"* ]]; then
  printf 'Expected no-auth 401 Unauthorized, got HTTP %s\n%s\n' "$no_auth_status" "$no_auth_body" >&2
  exit 1
fi

service_status="$(curl -sS -o "$response_file" -w '%{http_code}' --max-time 20 \
  -H "Authorization: Bearer $service_key" \
  -H "apikey: $service_key" \
  -H "Content-Type: application/json" \
  -d "$valid_body" \
  "$chat_url")"
service_body="$(cat "$response_file")"
if [[ "$service_status" != "401" || "$service_body" != *"User session required"* ]]; then
  printf 'Expected service-role 401 User session required, got HTTP %s\n%s\n' "$service_status" "$service_body" >&2
  exit 1
fi

invalid_status="$(curl -sS -o "$response_file" -w '%{http_code}' --max-time 20 \
  -H "Content-Type: application/json" \
  -d '{"org_id":"not-a-uuid","messages":[{"role":"user","content":"auth smoke"}]}' \
  "$chat_url")"
invalid_body="$(cat "$response_file")"
if [[ "$invalid_status" != "400" || "$invalid_body" != *"Invalid org_id"* ]]; then
  printf 'Expected invalid-org 400 Invalid org_id, got HTTP %s\n%s\n' "$invalid_status" "$invalid_body" >&2
  exit 1
fi

printf 'PASS no_auth=%s service_role=%s invalid_org=%s\n' "$no_auth_status" "$service_status" "$invalid_status"
