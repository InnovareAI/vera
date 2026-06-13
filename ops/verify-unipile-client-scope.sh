#!/usr/bin/env bash
set -euo pipefail

TARGET_HOST="${TARGET_HOST:-root@157.90.255.28}"
TARGET_STACK="${TARGET_STACK:-/srv/supabase-content}"
TARGET_SSH_KEY="${TARGET_SSH_KEY:-}"
ORG_PROJECT_SLUG="${ORG_PROJECT_SLUG:-rdf-style}"
SUPABASE_PUBLIC_URL="${SUPABASE_PUBLIC_URL:-https://supabase-content-eu.innovareai.com}"

if [[ -z "$TARGET_SSH_KEY" && -f "$HOME/.ssh/vera_hetzner_ed25519" ]]; then
  TARGET_SSH_KEY="$HOME/.ssh/vera_hetzner_ed25519"
fi

SSH_ARGS=(-o BatchMode=yes -o ConnectTimeout=8)
if [[ -n "$TARGET_SSH_KEY" ]]; then
  SSH_ARGS=(-i "$TARGET_SSH_KEY" -o IdentitiesOnly=yes "${SSH_ARGS[@]}")
fi

log() {
  printf '%s [unipile-scope] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"
}

log "checking project-scoped Unipile publishing for org behind $ORG_PROJECT_SLUG"

marker_line="$(awk '/^__REMOTE_SCRIPT__$/{print NR + 1; exit}' "$0")"
if [[ -z "$marker_line" ]]; then
  printf 'Could not find remote script marker in %s\n' "$0" >&2
  exit 1
fi

remote_env="TARGET_STACK='$TARGET_STACK' ORG_PROJECT_SLUG='$ORG_PROJECT_SLUG' SUPABASE_PUBLIC_URL='$SUPABASE_PUBLIC_URL'"
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

project_row="$(psql_cmd "select id || '|' || org_id from public.projects where slug = '$(sql_escape "$ORG_PROJECT_SLUG")' limit 1;")"
if [[ -z "$project_row" ]]; then
  printf 'Project slug not found: %s\n' "$ORG_PROJECT_SLUG" >&2
  exit 1
fi

source_project_id="${project_row%%|*}"
org_id="${project_row##*|}"
run_id="$(date +%s)-$$"
temp_slug="unipile-scope-smoke-$run_id"
temp_project_id=""
fallback_post_id=""
mismatch_post_id=""
integration_id=""
had_legacy_value="false"
legacy_account=""

cleanup() {
  if [[ -n "$fallback_post_id" ]]; then
    psql_cmd "delete from public.content_post_publish_claims where post_id = '$fallback_post_id';" >/dev/null || true
    psql_cmd "delete from public.content_posts where id = '$fallback_post_id';" >/dev/null || true
  fi
  if [[ -n "$mismatch_post_id" ]]; then
    psql_cmd "delete from public.content_post_publish_claims where post_id = '$mismatch_post_id';" >/dev/null || true
    psql_cmd "delete from public.content_posts where id = '$mismatch_post_id';" >/dev/null || true
  fi
  if [[ -n "$integration_id" ]]; then
    psql_cmd "delete from public.client_integrations where id = '$integration_id';" >/dev/null || true
  fi
  if [[ -n "$temp_project_id" ]]; then
    psql_cmd "delete from public.projects where id = '$temp_project_id';" >/dev/null || true
  fi
  if [[ "$had_legacy_value" == "true" ]]; then
    psql_cmd "update public.organizations set unipile_account_id = '$(sql_escape "$legacy_account")' where id = '$org_id';" >/dev/null || true
  else
    psql_cmd "update public.organizations set unipile_account_id = null where id = '$org_id';" >/dev/null || true
  fi
}
trap cleanup EXIT

legacy_marker="$(psql_cmd "select case when unipile_account_id is null then '__NULL__' else unipile_account_id end from public.organizations where id = '$org_id';")"
if [[ "$legacy_marker" != "__NULL__" ]]; then
  had_legacy_value="true"
  legacy_account="$legacy_marker"
fi

psql_cmd "update public.organizations set unipile_account_id = 'legacy-unipile-smoke-account' where id = '$org_id';" >/dev/null

temp_project_id="$(psql_cmd "insert into public.projects (org_id, name, slug, is_default, is_archived)
  values ('$org_id', 'Unipile Scope Smoke', '$(sql_escape "$temp_slug")', false, false)
  returning id;")"
if [[ -z "$temp_project_id" ]]; then
  printf 'Failed to create temporary project for %s\n' "$ORG_PROJECT_SLUG" >&2
  exit 1
fi

fallback_post_id="$(psql_cmd "insert into public.content_posts (org_id, project_id, channel, copy, status, title)
  values ('$org_id', '$temp_project_id', 'linkedin', 'Unipile fallback smoke', 'pending', 'Unipile fallback smoke')
  returning id;")"

response_file="$(mktemp)"
trap 'rm -f "$response_file"; cleanup' EXIT

fallback_status="$(curl -sS -o "$response_file" -w '%{http_code}' --max-time 20 \
  -H "Authorization: Bearer $service_key" \
  -H "apikey: $service_key" \
  -H "Content-Type: application/json" \
  -d "{\"post_id\":\"$fallback_post_id\",\"auto_mark_posted\":false}" \
  "$SUPABASE_PUBLIC_URL/functions/v1/unipile-post")"
fallback_body="$(cat "$response_file")"
if [[ "$fallback_status" != "400" || "$fallback_body" != *"No connected linkedin Unipile account for this client"* ]]; then
  printf 'Expected project post without client integration to reject legacy org fallback, got HTTP %s\n%s\n' "$fallback_status" "$fallback_body" >&2
  exit 1
fi

integration_id="$(psql_cmd "insert into public.client_integrations (
    org_id, project_id, provider, category, display_name, status, connection_kind,
    config, external_ref, health_status
  )
  values (
    '$org_id',
    '$temp_project_id',
    'linkedin',
    'social',
    'Unipile scope smoke',
    'connected',
    'oauth',
    '{}'::jsonb,
    '{\"unipile_account_id\":\"client-unipile-smoke-account\",\"linkedin_organization_id\":\"12345\"}'::jsonb,
    'healthy'
  )
  returning id;")"

mismatch_post_id="$(psql_cmd "insert into public.content_posts (org_id, project_id, channel, copy, status, title)
  values ('$org_id', '$temp_project_id', 'linkedin', 'Unipile org mismatch smoke', 'pending', 'Unipile org mismatch smoke')
  returning id;")"

mismatch_status="$(curl -sS -o "$response_file" -w '%{http_code}' --max-time 20 \
  -H "Authorization: Bearer $service_key" \
  -H "apikey: $service_key" \
  -H "Content-Type: application/json" \
  -d "{\"post_id\":\"$mismatch_post_id\",\"as_organization\":\"urn:li:organization:99999\",\"auto_mark_posted\":false}" \
  "$SUPABASE_PUBLIC_URL/functions/v1/unipile-post")"
mismatch_body="$(cat "$response_file")"
if [[ "$mismatch_status" != "403" || "$mismatch_body" != *"LinkedIn company page is not connected to this client space"* ]]; then
  printf 'Expected mismatched LinkedIn company page to be rejected, got HTTP %s\n%s\n' "$mismatch_status" "$mismatch_body" >&2
  exit 1
fi

claim_count="$(psql_cmd "select count(*) from public.content_post_publish_claims where post_id in ('$fallback_post_id', '$mismatch_post_id');")"
if [[ "$claim_count" != "0" ]]; then
  printf 'Expected no publish claims before early rejection, got %s\n' "$claim_count" >&2
  exit 1
fi

printf 'PASS source_project=%s temp_project=%s fallback_status=%s mismatch_status=%s claims=%s\n' "$source_project_id" "$temp_project_id" "$fallback_status" "$mismatch_status" "$claim_count"
