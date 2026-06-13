#!/usr/bin/env bash
set -euo pipefail

# Production-safe guardrail suite for VERA's sellable-client baseline.
#
# This wrapper intentionally runs only checks that avoid real provider spend and
# clean up their smoke data. Use it before onboarding another client workspace,
# changing provider key policy, or shipping publishing changes.
#
# Optional env inherited by child checks:
#   TARGET_HOST, TARGET_STACK, TARGET_SSH_KEY, PROJECT_SLUG,
#   ORG_PROJECT_SLUG, SUPABASE_PUBLIC_URL, IMAGE_MODEL, VIDEO_MODEL.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

checks=(
  "verify-vera-chat-auth.sh"
  "verify-media-key-scope.sh"
  "verify-unipile-client-scope.sh"
  "verify-unipile-research-profile.sh"
  "verify-publish-claim-lock.sh"
  "verify-post-marked-atomic.sh"
  "verify-content-post-status-schema.sh"
  "verify-audience-client-scope.sh"
  "verify-platform-configs-retired.sh"
)

log() {
  printf '%s [saleability] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"
}

log "running ${#checks[@]} production-safe guardrail checks"

for check in "${checks[@]}"; do
  log "start $check"
  "$ROOT_DIR/ops/$check"
  log "pass $check"
done

log "PASS all saleability guardrails"
