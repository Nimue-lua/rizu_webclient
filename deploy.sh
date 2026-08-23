#!/usr/bin/env bash

set -Eeuo pipefail
export LC_ALL=C

readonly ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly DEPLOY_HOST="${DEPLOY_HOST:-root@nimue.mom}"
readonly DEPLOY_ROOT="${DEPLOY_ROOT:-/srv/rizu}"
readonly DEPLOY_URL="${DEPLOY_URL:-https://rizu.nimue.mom}"
readonly STAGE_DIR="${STAGE_DIR:-/tmp/rizu-deploy}"
readonly CHARTS_DIR="${CHARTS_DIR:-$ROOT_DIR/public/charts}"
readonly MIN_FREE_BYTES="${MIN_FREE_BYTES:-536870912}"
readonly SSH_OPTIONS=(-o ServerAliveInterval=15 -o ServerAliveCountMax=6)

for command in npm node ffmpeg rsync ssh curl; do
  command -v "$command" >/dev/null || {
    printf 'Required command not found: %s\n' "$command" >&2
    exit 1
  }
done

if [[ ! -d "$CHARTS_DIR" ]]; then
  printf 'Chart directory not found: %s\n' "$CHARTS_DIR" >&2
  exit 1
fi

printf 'Checking VPS access and available storage...\n'
ssh "${SSH_OPTIONS[@]}" "$DEPLOY_HOST" \
  "set -eu; rm -rf -- '$DEPLOY_ROOT.new'; mkdir -p '$DEPLOY_ROOT.new/public'; if [ -d '$DEPLOY_ROOT/public/charts' ]; then cp -al -- '$DEPLOY_ROOT/public/charts' '$DEPLOY_ROOT.new/public/charts'; else mkdir -p '$DEPLOY_ROOT.new/public/charts'; fi; df -h '$DEPLOY_ROOT.new'"

printf 'Installing dependencies and running checks...\n'
npm --prefix "$ROOT_DIR" ci
npm --prefix "$ROOT_DIR" run typecheck
npm --prefix "$ROOT_DIR" test

printf 'Building deployment bundle...\n'
rm -rf -- "$STAGE_DIR"
mkdir -p -- "$STAGE_DIR/dist" "$STAGE_DIR/public/chart-previews"
npm --prefix "$ROOT_DIR" run build
cp -a -- "$ROOT_DIR/dist/." "$STAGE_DIR/dist/"

printf 'Refreshing chart previews and catalogs...\n'
npm --prefix "$ROOT_DIR" run cache:charts -- \
  --charts "$CHARTS_DIR" \
  --background-previews "$STAGE_DIR/public/chart-previews" \
  --client-database "$STAGE_DIR/public/catalog.sqlite"

bundle_bytes="$(du -sb "$STAGE_DIR" | cut -f1)"
available_bytes="$(ssh "${SSH_OPTIONS[@]}" "$DEPLOY_HOST" "df --output=avail -B1 '$DEPLOY_ROOT.new'" | tr -dc '0-9')"
required_bytes=$((bundle_bytes + MIN_FREE_BYTES))
if (( available_bytes < required_bytes )); then
  printf 'Insufficient VPS space: bundle needs %d bytes plus %d bytes free; only %d bytes available.\n' \
    "$bundle_bytes" "$MIN_FREE_BYTES" "$available_bytes" >&2
  exit 1
fi

printf 'Uploading deployment...\n'
rsync -a --delete --partial --info=progress2 \
  --exclude='/public/charts/***' \
  --link-dest="$DEPLOY_ROOT" \
  -e "ssh ${SSH_OPTIONS[*]}" \
  "$STAGE_DIR/" "$DEPLOY_HOST:$DEPLOY_ROOT.new/"

printf 'Activating deployment...\n'
ssh "${SSH_OPTIONS[@]}" "$DEPLOY_HOST" "bash -s" -- "$DEPLOY_ROOT" <<'REMOTE'
set -Eeuo pipefail
deploy_root="$1"

chown -R www-data:www-data "$deploy_root.new"
rm -rf -- "$deploy_root.old"
if [[ -e "$deploy_root" ]]; then
  mv -- "$deploy_root" "$deploy_root.old"
fi
mv -- "$deploy_root.new" "$deploy_root"
REMOTE

printf 'Verifying public endpoints...\n'
curl -fsS "$DEPLOY_URL/" >/dev/null
curl -fsS "$DEPLOY_URL/catalog.sqlite" >/dev/null

printf 'Deployment complete: %s\n' "$DEPLOY_URL"
