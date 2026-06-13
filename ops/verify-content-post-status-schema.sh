#!/usr/bin/env bash
set -euo pipefail

TARGET_HOST="${TARGET_HOST:-root@157.90.255.28}"
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
  printf '%s [post-status-schema] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"
}

log "checking content_posts editorial status schema for $PROJECT_SLUG"

marker_line="$(awk '/^__REMOTE_SCRIPT__$/{print NR + 1; exit}' "$0")"
if [[ -z "$marker_line" ]]; then
  printf 'Could not find remote script marker in %s\n' "$0" >&2
  exit 1
fi

remote_env="PROJECT_SLUG='$PROJECT_SLUG'"
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
    psql_cmd "delete from public.content_posts where id = '$post_id';" >/dev/null || true
  fi
}
trap cleanup EXIT

constraint_def="$(psql_cmd "select pg_get_constraintdef(oid) from pg_constraint where conrelid = 'public.content_posts'::regclass and conname = 'content_posts_status_check';")"
if [[ "$constraint_def" != *"draft"* || "$constraint_def" != *"pending"* || "$constraint_def" != *"approved"* || "$constraint_def" != *"rejected"* || "$constraint_def" != *"changes_requested"* ]]; then
  printf 'content_posts_status_check does not contain the editorial statuses:\n%s\n' "$constraint_def" >&2
  exit 1
fi

required_columns=(
  "org_id|uuid|uuid"
  "project_id|uuid|uuid"
  "scheduled_at|timestamp with time zone|timestamptz"
  "hashtags|ARRAY|_text"
  "posted_at|timestamp with time zone|timestamptz"
  "posted_url|text|text"
  "provider_post_id|text|text"
)

for expected in "${required_columns[@]}"; do
  column_name="${expected%%|*}"
  actual="$(psql_cmd "select column_name || '|' || data_type || '|' || udt_name from information_schema.columns where table_schema = 'public' and table_name = 'content_posts' and column_name = '$column_name';")"
  if [[ "$actual" != "$expected" ]]; then
    printf 'content_posts column mismatch for %s: expected %s, got %s\n' "$column_name" "$expected" "${actual:-missing}" >&2
    exit 1
  fi
done

post_id="$(psql_cmd "insert into public.content_posts (org_id, project_id, channel, copy, status, title)
  values ('$org_id', '$project_id', 'linkedin', 'draft status schema smoke', 'draft', 'draft status schema smoke')
  returning id;")"
if [[ -z "$post_id" ]]; then
  printf 'Draft status insert did not return an id\n' >&2
  exit 1
fi

set +e
scheduled_output="$(docker exec content-supabase-db psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -qAtc \
  "insert into public.content_posts (org_id, project_id, channel, copy, status, title)
   values ('$org_id', '$project_id', 'linkedin', 'scheduled status schema smoke', 'scheduled', 'scheduled status schema smoke');" 2>&1)"
scheduled_exit=$?
set -e

if [[ "$scheduled_exit" -eq 0 ]]; then
  printf 'Expected raw scheduled status insert to fail, but it succeeded\n' >&2
  exit 1
fi
if [[ "$scheduled_output" != *"content_posts_status_check"* ]]; then
  printf 'Expected scheduled insert to fail on content_posts_status_check, got:\n%s\n' "$scheduled_output" >&2
  exit 1
fi

printf 'PASS project=%s draft_post=%s scheduled_rejected=true\n' "$PROJECT_SLUG" "$post_id"
