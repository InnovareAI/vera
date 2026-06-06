#!/usr/bin/env bash
set -euo pipefail

SOURCE_HOST="${SOURCE_HOST:-root@178.104.187.43}"
TARGET_HOST="${TARGET_HOST:-root@157.90.255.28}"
SOURCE_STACK="${SOURCE_STACK:-/srv/supabase-content}"
TARGET_STACK="${TARGET_STACK:-/srv/supabase-content}"
REMOTE_STAGE="${REMOTE_STAGE:-/root/vera-migration}"
DOMAIN="${DOMAIN:-supabase-content-eu.innovareai.com}"
SWAP_SIZE="${SWAP_SIZE:-8G}"

log() {
  printf '%s [vera-migrate] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"
}

ssh_source() {
  ssh -o BatchMode=yes -o ConnectTimeout=8 "$SOURCE_HOST" "$@"
}

ssh_target() {
  ssh -o BatchMode=yes -o ConnectTimeout=8 "$TARGET_HOST" "$@"
}

require_target_access() {
  log "checking target SSH access: $TARGET_HOST"
  ssh_target 'hostname >/dev/null'
}

stage_source() {
  log "creating fresh source backup and migration bundle on $SOURCE_HOST"
  ssh -o BatchMode=yes -o ConnectTimeout=8 "$SOURCE_HOST" \
    "SOURCE_STACK='$SOURCE_STACK' REMOTE_STAGE='$REMOTE_STAGE' bash -s" <<'REMOTE'
set -euo pipefail

"$SOURCE_STACK/scripts/content-supabase-backup" </dev/null >/tmp/vera-content-backup-run.log
"$SOURCE_STACK/scripts/content-supabase-backup-verify" </dev/null >/tmp/vera-content-backup-verify-run.log

mkdir -p "$REMOTE_STAGE/systemd" "$REMOTE_STAGE/root-ssh" "$REMOTE_STAGE/notification-secrets"
chmod 700 "$REMOTE_STAGE"

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
stack_bundle="$REMOTE_STAGE/vera-supabase-stack-${stamp}.tar.gz"
systemd_bundle="$REMOTE_STAGE/vera-supabase-systemd-${stamp}.tar.gz"
root_ssh_bundle="$REMOTE_STAGE/vera-supabase-root-ssh-${stamp}.tar.gz"
notify_bundle="$REMOTE_STAGE/vera-supabase-notification-secrets-${stamp}.tar.gz"

tar -C "$SOURCE_STACK" \
  --exclude="./backups" \
  --exclude="./volumes/db/data" \
  --exclude="./volumes/storage" \
  --exclude="./.git" \
  -czf "$stack_bundle" .
sha256sum "$stack_bundle" > "$stack_bundle.sha256"

for unit in \
  content-supabase-backup.service \
  content-supabase-backup.timer \
  content-supabase-backup-verify.service \
  content-supabase-backup-verify.timer
do
  test -f "/etc/systemd/system/$unit" && cp -a "/etc/systemd/system/$unit" "$REMOTE_STAGE/systemd/"
done
tar -C "$REMOTE_STAGE/systemd" -czf "$systemd_bundle" .
sha256sum "$systemd_bundle" > "$systemd_bundle.sha256"

if test -f /root/.ssh/sam_supabase_storagebox_ed25519; then
  cp -a /root/.ssh/sam_supabase_storagebox_ed25519 "$REMOTE_STAGE/root-ssh/"
  test -f /root/.ssh/sam_supabase_storagebox_ed25519.pub && cp -a /root/.ssh/sam_supabase_storagebox_ed25519.pub "$REMOTE_STAGE/root-ssh/"
fi
tar -C "$REMOTE_STAGE/root-ssh" -czf "$root_ssh_bundle" .
sha256sum "$root_ssh_bundle" > "$root_ssh_bundle.sha256"

if test -f /srv/supabase/secrets/google-chat-webhook.url; then
  mkdir -p "$REMOTE_STAGE/notification-secrets/srv/supabase/secrets"
  cp -a /srv/supabase/secrets/google-chat-webhook.url "$REMOTE_STAGE/notification-secrets/srv/supabase/secrets/"
fi
tar -C "$REMOTE_STAGE/notification-secrets" -czf "$notify_bundle" .
sha256sum "$notify_bundle" > "$notify_bundle.sha256"

latest_db="$(readlink -f "$SOURCE_STACK/backups/latest/latest.dump")"
latest_storage="$(readlink -f "$SOURCE_STACK/backups/latest/latest.storage.tar.gz")"
latest_schema="$(readlink -f "$SOURCE_STACK/backups/latest/latest.schema.sql")"

cat > "$REMOTE_STAGE/manifest.env" <<EOF
CREATED_UTC=$stamp
SOURCE_HOST=$(hostname -s)
STACK_BUNDLE=$stack_bundle
SYSTEMD_BUNDLE=$systemd_bundle
ROOT_SSH_BUNDLE=$root_ssh_bundle
NOTIFY_BUNDLE=$notify_bundle
LATEST_DB=$latest_db
LATEST_STORAGE=$latest_storage
LATEST_SCHEMA=$latest_schema
EOF

printf 'CREATED_UTC=%s\n' "$stamp"
printf 'STACK_BUNDLE=%s\n' "$stack_bundle"
printf 'LATEST_DB=%s\n' "$latest_db"
printf 'LATEST_STORAGE=%s\n' "$latest_storage"
tail -1 /tmp/vera-content-backup-verify-run.log
REMOTE
}

copy_artifacts() {
  log "copying migration artifacts through local temp storage"
  local tmp
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' RETURN

  rsync -az "$SOURCE_HOST:$REMOTE_STAGE/manifest.env" "$tmp/"
  # shellcheck disable=SC1091
  source "$tmp/manifest.env"

  rsync -az \
    "$SOURCE_HOST:$STACK_BUNDLE" \
    "$SOURCE_HOST:$STACK_BUNDLE.sha256" \
    "$SOURCE_HOST:$SYSTEMD_BUNDLE" \
    "$SOURCE_HOST:$SYSTEMD_BUNDLE.sha256" \
    "$SOURCE_HOST:$ROOT_SSH_BUNDLE" \
    "$SOURCE_HOST:$ROOT_SSH_BUNDLE.sha256" \
    "$SOURCE_HOST:$NOTIFY_BUNDLE" \
    "$SOURCE_HOST:$NOTIFY_BUNDLE.sha256" \
    "$SOURCE_HOST:$LATEST_DB" \
    "$SOURCE_HOST:$LATEST_DB.sha256" \
    "$SOURCE_HOST:$LATEST_STORAGE" \
    "$SOURCE_HOST:$LATEST_STORAGE.sha256" \
    "$SOURCE_HOST:$LATEST_SCHEMA" \
    "$tmp/"

  ssh_target "mkdir -p '$REMOTE_STAGE' && chmod 700 '$REMOTE_STAGE'"
  rsync -az "$tmp/" "$TARGET_HOST:$REMOTE_STAGE/"
}

bootstrap_target() {
  log "installing target packages and baseline system config"
  ssh -o BatchMode=yes -o ConnectTimeout=8 "$TARGET_HOST" \
    "SWAP_SIZE='$SWAP_SIZE' bash -s" <<'REMOTE'
set -euo pipefail

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y ca-certificates curl jq openssl rsync docker.io docker-compose-v2 caddy
systemctl enable --now docker

if ! swapon --show=NAME | grep -Fxq /swapfile; then
  fallocate -l "$SWAP_SIZE" /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
fi
grep -q '^/swapfile ' /etc/fstab || printf '/swapfile none swap sw 0 0\n' >> /etc/fstab
cat >/etc/sysctl.d/99-vera-swap.conf <<'EOF'
vm.swappiness=10
vm.vfs_cache_pressure=50
EOF
sysctl --system >/dev/null
REMOTE
}

restore_target() {
  log "restoring Vera Supabase on target"
  ssh -o BatchMode=yes -o ConnectTimeout=8 "$TARGET_HOST" \
    "REMOTE_STAGE='$REMOTE_STAGE' TARGET_STACK='$TARGET_STACK' DOMAIN='$DOMAIN' bash -s" <<'REMOTE'
set -euo pipefail

cd "$REMOTE_STAGE"
latest_stack="$(ls -1t vera-supabase-stack-*.tar.gz | head -1)"
latest_systemd="$(ls -1t vera-supabase-systemd-*.tar.gz | head -1)"
latest_root_ssh="$(ls -1t vera-supabase-root-ssh-*.tar.gz | head -1)"
latest_notify="$(ls -1t vera-supabase-notification-secrets-*.tar.gz | head -1)"
latest_db="$(ls -1t content-pipeline-supabase-*.dump.enc | head -1)"
latest_storage="$(ls -1t content-pipeline-supabase-*.storage.tar.gz.enc | head -1)"

verify_sha() {
  local file="$1"
  local expected actual
  expected="$(awk '{print $1}' "$file.sha256")"
  actual="$(sha256sum "$file" | awk '{print $1}')"
  test -n "$expected"
  test "$expected" = "$actual"
}

verify_sha "$latest_stack"
verify_sha "$latest_systemd"
verify_sha "$latest_root_ssh"
verify_sha "$latest_notify"
verify_sha "$latest_db"
verify_sha "$latest_storage"

systemctl stop caddy || true
mkdir -p "$TARGET_STACK"
tar -C "$TARGET_STACK" -xzf "$latest_stack"
mkdir -p "$TARGET_STACK/volumes/db/data" "$TARGET_STACK/volumes/storage"
chmod 700 "$TARGET_STACK/secrets" || true

tar -C / -xzf "$latest_notify"
mkdir -p /root/.ssh
chmod 700 /root/.ssh
tar -C /root/.ssh -xzf "$latest_root_ssh"
chmod 600 /root/.ssh/* 2>/dev/null || true
chmod 644 /root/.ssh/*.pub 2>/dev/null || true

tar -C /etc/systemd/system -xzf "$latest_systemd"
systemctl daemon-reload

cat >/etc/caddy/Caddyfile <<EOF
$DOMAIN {
  encode zstd gzip
  reverse_proxy 127.0.0.1:8002
}
EOF
caddy fmt --overwrite /etc/caddy/Caddyfile
systemctl enable caddy

cd "$TARGET_STACK"
docker compose down --remove-orphans || true
docker compose up -d db

for _ in $(seq 1 90); do
  status="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' content-supabase-db 2>/dev/null || true)"
  test "$status" = healthy && break
  sleep 2
done
test "$(docker inspect -f '{{.State.Health.Status}}' content-supabase-db)" = healthy

tmp_db="$(mktemp /tmp/vera-restore.XXXXXX.dump)"
trap 'rm -f "$tmp_db"' EXIT
openssl enc -d -aes-256-cbc -pbkdf2 \
  -pass "file:$TARGET_STACK/secrets/backup-passphrase" \
  -in "$REMOTE_STAGE/$latest_db" \
  -out "$tmp_db"

docker exec -i content-supabase-db pg_restore \
  --clean --if-exists --no-owner \
  -U postgres -d postgres < "$tmp_db"

rm -rf "$TARGET_STACK/volumes/storage"
mkdir -p "$TARGET_STACK/volumes/storage"
openssl enc -d -aes-256-cbc -pbkdf2 \
  -pass "file:$TARGET_STACK/secrets/backup-passphrase" \
  -in "$REMOTE_STAGE/$latest_storage" \
  | tar -C "$TARGET_STACK/volumes/storage" -xzf -

docker compose up -d
systemctl restart caddy || true
systemctl enable --now content-supabase-backup.timer content-supabase-backup-verify.timer || true
REMOTE
}

smoke_target() {
  log "running target smoke tests over localhost Kong"
  ssh -o BatchMode=yes -o ConnectTimeout=8 "$TARGET_HOST" \
    "TARGET_STACK='$TARGET_STACK' bash -s" <<'REMOTE'
set -euo pipefail

cd "$TARGET_STACK"
read_env_key() {
  local key="$1"
  grep -E "^${key}=" .env | head -1 | cut -d= -f2- | sed "s/^['\"]//;s/['\"]$//"
}

ANON_KEY="$(read_env_key ANON_KEY)"
POST_ID="$(docker exec content-supabase-db psql -U supabase_admin -d postgres -Atqc "select id from public.content_posts where review_token is not null limit 1")"
REVIEW_TOKEN="$(docker exec content-supabase-db psql -U supabase_admin -d postgres -Atqc "select review_token from public.content_posts where id = '$POST_ID'")"

for _ in $(seq 1 90); do
  code="$(curl -sS -o /tmp/vera-target-health.json -w '%{http_code}' http://127.0.0.1:8002/rest/v1/ 2>/dev/null || true)"
  test "$code" != "000" && break
  sleep 2
done

review_code="$(curl -sS -o /tmp/vera-review-link.json -w '%{http_code}' "http://127.0.0.1:8002/functions/v1/review-link?token=$REVIEW_TOKEN")"
anon_code="$(curl -sS -o /tmp/vera-anon-posts.json -w '%{http_code}' "http://127.0.0.1:8002/rest/v1/content_posts?select=id&limit=1" -H "apikey: $ANON_KEY")"
unsafe_count="$(docker exec content-supabase-db psql -U supabase_admin -d postgres -Atqc "select count(*) from pg_policies where schemaname = 'public' and ('anon' = any(roles) or qual = 'true' or with_check = 'true')")"

printf 'review_link_http=%s\n' "$review_code"
jq -r '"review_link_has_post=" + ((.post.id != null)|tostring) + " review_link_exposes_token=" + ((.post.review_token != null)|tostring)' /tmp/vera-review-link.json
printf 'anon_content_posts_http=%s body=%s\n' "$anon_code" "$(cat /tmp/vera-anon-posts.json)"
printf 'unsafe_public_policy_count=%s\n' "$unsafe_count"
docker compose ps
REMOTE
}

run_all() {
  require_target_access
  stage_source
  copy_artifacts
  bootstrap_target
  restore_target
  smoke_target
  log "target restore is complete. DNS cutover is intentionally not performed by this script."
}

usage() {
  cat <<'EOF'
Usage: vera-migrate-supabase.sh [command]

Commands:
  all        Run full migration through target smoke tests, no DNS cutover.
  check      Check target SSH access only.
  stage      Create a fresh source backup and source-side migration bundle.
  copy       Copy the latest staged source artifacts to the target.
  bootstrap  Install target packages and baseline system config.
  restore    Restore Supabase database, storage, stack files, and timers.
  smoke      Run local target smoke tests.

Environment overrides:
  SOURCE_HOST=root@178.104.187.43
  TARGET_HOST=root@157.90.255.28
  SOURCE_STACK=/srv/supabase-content
  TARGET_STACK=/srv/supabase-content
  REMOTE_STAGE=/root/vera-migration
  DOMAIN=supabase-content-eu.innovareai.com
EOF
}

main() {
  local command="${1:-all}"

  case "$command" in
    all) run_all ;;
    check) require_target_access ;;
    stage) stage_source ;;
    copy) require_target_access; copy_artifacts ;;
    bootstrap) require_target_access; bootstrap_target ;;
    restore) require_target_access; restore_target ;;
    smoke) require_target_access; smoke_target ;;
    help|-h|--help) usage ;;
    *)
      usage >&2
      exit 2
      ;;
  esac
}

main "$@"
