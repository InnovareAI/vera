#!/usr/bin/env bash
# Deploy one (or all) edge functions to the self-hosted content-pipeline
# Supabase stack on Hetzner. The git push only updates the repo — functions
# are served from the box filesystem, so they must be copied + the runtime
# restarted.
#
# Usage:
#   scripts/deploy-function.sh vera-orchestrator        # one function
#   scripts/deploy-function.sh vera-orchestrator vera-chat
#   scripts/deploy-function.sh --all                    # every function + _shared
#   scripts/deploy-function.sh --shared vera-chat       # also sync _shared/
#
# Requires SSH access to the box (root@HOST with your id_ed25519).

set -euo pipefail

HOST="root@178.104.187.43"
REMOTE_DIR="/srv/supabase-content/volumes/functions"
CONTAINER="content-supabase-edge-functions"
LOCAL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/supabase/functions"

sync_shared=false
targets=()

for arg in "$@"; do
  case "$arg" in
    --all)    targets=("$(ls "$LOCAL_DIR" | grep -v '^_shared$')"); sync_shared=true ;;
    --shared) sync_shared=true ;;
    *)        targets+=("$arg") ;;
  esac
done

if [ "${#targets[@]}" -eq 0 ] && [ "$sync_shared" = false ]; then
  echo "usage: $0 <function-name> [more...] | --all | --shared <function>" >&2
  exit 1
fi

# _shared is imported by most functions; sync it whenever asked or on --all.
if [ "$sync_shared" = true ]; then
  echo "→ syncing _shared/"
  scp -q -r "$LOCAL_DIR/_shared" "$HOST:$REMOTE_DIR/"
fi

for fn in ${targets[@]+"${targets[@]}"}; do
  if [ ! -f "$LOCAL_DIR/$fn/index.ts" ]; then
    echo "✗ $fn: no index.ts found locally, skipping" >&2
    continue
  fi
  echo "→ deploying $fn"
  scp -q -r "$LOCAL_DIR/$fn" "$HOST:$REMOTE_DIR/"
done

echo "→ restarting $CONTAINER"
ssh "$HOST" "docker restart $CONTAINER" >/dev/null

echo "✓ done — give it a few seconds to come up, then test the endpoint."
