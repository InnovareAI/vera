#!/usr/bin/env bash
set -euo pipefail

TARGET_HOST="${TARGET_HOST:-root@157.90.255.28}"
TARGET_STACK="${TARGET_STACK:-/srv/supabase-content}"
TARGET_SSH_KEY="${TARGET_SSH_KEY:-}"
PROJECT_SLUG="${PROJECT_SLUG:-rdf-style}"
IMAGE_MODEL="${IMAGE_MODEL:-${MODEL:-seedream}}"
VIDEO_MODEL="${VIDEO_MODEL:-hailuo}"
SUPABASE_PUBLIC_URL="${SUPABASE_PUBLIC_URL:-https://supabase-content-eu.innovareai.com}"

if [[ -z "$TARGET_SSH_KEY" && -f "$HOME/.ssh/vera_hetzner_ed25519" ]]; then
  TARGET_SSH_KEY="$HOME/.ssh/vera_hetzner_ed25519"
fi

SSH_ARGS=(-o BatchMode=yes -o ConnectTimeout=8)
if [[ -n "$TARGET_SSH_KEY" ]]; then
  SSH_ARGS=(-i "$TARGET_SSH_KEY" -o IdentitiesOnly=yes "${SSH_ARGS[@]}")
fi

log() {
  printf '%s [media-scope] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"
}

log "checking $PROJECT_SLUG with FAL-only image model '$IMAGE_MODEL' and video model '$VIDEO_MODEL'"

marker_line="$(awk '/^__REMOTE_SCRIPT__$/{print NR + 1; exit}' "$0")"
if [[ -z "$marker_line" ]]; then
  printf 'Could not find remote script marker in %s\n' "$0" >&2
  exit 1
fi

remote_env="TARGET_STACK='$TARGET_STACK' PROJECT_SLUG='$PROJECT_SLUG' IMAGE_MODEL='$IMAGE_MODEL' VIDEO_MODEL='$VIDEO_MODEL' SUPABASE_PUBLIC_URL='$SUPABASE_PUBLIC_URL'"
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

project_id="$(docker exec content-supabase-db psql -U supabase_admin -d postgres -Atc \
  "select id from public.projects where slug = '$PROJECT_SLUG' limit 1;")"
if [[ -z "$project_id" ]]; then
  printf 'Project slug not found: %s\n' "$PROJECT_SLUG" >&2
  exit 1
fi

fal_key_count="$(docker exec content-supabase-db psql -U supabase_admin -d postgres -Atc \
  "select count(*) from public.client_api_keys where project_id = '$project_id' and provider in ('fal','fal_ai') and status = 'active';")"
if [[ "$fal_key_count" != "0" ]]; then
  printf 'Expected zero active client FAL keys for %s, found %s\n' "$PROJECT_SLUG" "$fal_key_count" >&2
  exit 1
fi

global_media_entitlements="$(docker exec content-supabase-db psql -U supabase_admin -d postgres -Atc \
  "select count(*) from public.ai_user_entitlements
   where enabled = true
     and capability in ('platform_fal_image','platform_fal_video','platform_premium_video')
     and org_id is null
     and project_id is null;")"
if [[ "$global_media_entitlements" != "0" ]]; then
  printf 'Expected zero unscoped active platform media entitlements, found %s\n' "$global_media_entitlements" >&2
  exit 1
fi

response_file="$(mktemp)"
trap 'rm -f "$response_file"' EXIT

image_status="$(curl -sS -o "$response_file" -w '%{http_code}' --max-time 20 \
  -H "Authorization: Bearer $service_key" \
  -H "apikey: $service_key" \
  -H "Content-Type: application/json" \
  -d "{\"project_id\":\"$project_id\",\"model\":\"$IMAGE_MODEL\",\"prompt\":\"media key scope smoke\"}" \
  "$SUPABASE_PUBLIC_URL/functions/v1/generate-image")"

body="$(cat "$response_file")"
if [[ "$image_status" != "403" ]]; then
  printf 'Expected image HTTP 403, got HTTP %s\n%s\n' "$image_status" "$body" >&2
  exit 1
fi
if [[ "$body" != *"requires this space to use its own OpenRouter, OpenAI, or FAL key"* ]]; then
  printf 'Unexpected image response body:\n%s\n' "$body" >&2
  exit 1
fi

video_submit_status="$(curl -sS -o "$response_file" -w '%{http_code}' --max-time 20 \
  -H "Authorization: Bearer $service_key" \
  -H "apikey: $service_key" \
  -H "Content-Type: application/json" \
  -d "{\"project_id\":\"$project_id\",\"model\":\"$VIDEO_MODEL\",\"action\":\"submit\",\"prompt\":\"media key scope smoke\"}" \
  "$SUPABASE_PUBLIC_URL/functions/v1/generate-video")"

video_submit_body="$(cat "$response_file")"
if [[ "$video_submit_status" != "403" ]]; then
  printf 'Expected video submit HTTP 403, got HTTP %s\n%s\n' "$video_submit_status" "$video_submit_body" >&2
  exit 1
fi
if [[ "$video_submit_body" != *"Video generation requires this space to use its own FAL key"* \
   && "$video_submit_body" != *"Video generation is disabled for this space"* ]]; then
  printf 'Unexpected video submit response body:\n%s\n' "$video_submit_body" >&2
  exit 1
fi

request_id="media-scope-smoke-$(date +%s)-$$"
docker exec content-supabase-db psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -Atc \
  "insert into public.video_jobs (request_id, project_id, slug, status, prompt, key_source)
   values ('$request_id', '$project_id', 'fal-ai/minimax', 'rendering', 'media key scope smoke', 'client');" >/dev/null

cleanup_video_job() {
  docker exec content-supabase-db psql -U supabase_admin -d postgres -Atc \
    "delete from public.video_jobs where request_id = '$request_id';" >/dev/null || true
}
trap 'rm -f "$response_file"; cleanup_video_job' EXIT

video_status="$(curl -sS -o "$response_file" -w '%{http_code}' --max-time 20 \
  -H "Authorization: Bearer $service_key" \
  -H "apikey: $service_key" \
  -H "Content-Type: application/json" \
  -d "{\"project_id\":\"$project_id\",\"model\":\"$VIDEO_MODEL\",\"action\":\"status\",\"request_id\":\"$request_id\"}" \
  "$SUPABASE_PUBLIC_URL/functions/v1/generate-video")"

video_body="$(cat "$response_file")"
if [[ "$video_status" != "403" ]]; then
  printf 'Expected video HTTP 403, got HTTP %s\n%s\n' "$video_status" "$video_body" >&2
  exit 1
fi
if [[ "$video_body" != *"Video generation requires this space to use its own FAL key"* ]]; then
  printf 'Unexpected video response body:\n%s\n' "$video_body" >&2
  exit 1
fi

printf 'PASS project=%s image_model=%s image_status=%s video_model=%s video_submit_status=%s video_status=%s\n' "$PROJECT_SLUG" "$IMAGE_MODEL" "$image_status" "$VIDEO_MODEL" "$video_submit_status" "$video_status"
