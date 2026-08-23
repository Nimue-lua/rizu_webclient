#!/usr/bin/env bash

set -Eeuo pipefail
export LC_ALL=C

readonly ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly DEPLOY_HOST="${DEPLOY_HOST:-root@nimue.mom}"
readonly DEPLOY_ROOT="${DEPLOY_ROOT:-/srv/rizu}"
readonly DEPLOY_URL="${DEPLOY_URL:-https://rizu.nimue.mom}"
readonly STAGE_DIR="${STAGE_DIR:-/tmp/rizu-deploy}"
readonly MIN_FREE_BYTES="${MIN_FREE_BYTES:-536870912}"
readonly SSH_OPTIONS=(-o ServerAliveInterval=15 -o ServerAliveCountMax=6)

for command in npm node go ffmpeg rsync ssh curl; do
  command -v "$command" >/dev/null || {
    printf 'Required command not found: %s\n' "$command" >&2
    exit 1
  }
done

if [[ ! -d "$ROOT_DIR/public/charts" ]]; then
  printf 'Chart directory not found: %s\n' "$ROOT_DIR/public/charts" >&2
  exit 1
fi

printf 'Checking VPS access and available storage...\n'
ssh "${SSH_OPTIONS[@]}" "$DEPLOY_HOST" \
  "set -eu; rm -rf -- '$DEPLOY_ROOT.new'; mkdir -p '$DEPLOY_ROOT.new'; df -h '$DEPLOY_ROOT.new'"

printf 'Installing dependencies and running checks...\n'
npm --prefix "$ROOT_DIR" ci
npm --prefix "$ROOT_DIR" run typecheck
npm --prefix "$ROOT_DIR" test
go -C "$ROOT_DIR/preview-server" test ./...

printf 'Building deployment bundle...\n'
rm -rf -- "$STAGE_DIR"
mkdir -p -- "$STAGE_DIR/bin" "$STAGE_DIR/dist" "$STAGE_DIR/public/charts" "$STAGE_DIR/public/chart-previews" "$STAGE_DIR/server"
npm --prefix "$ROOT_DIR" run build
go -C "$ROOT_DIR/preview-server" build -o "$STAGE_DIR/bin/rizu-preview" .
cp -a -- "$ROOT_DIR/dist/." "$STAGE_DIR/dist/"
location_directories=("$ROOT_DIR/public/charts"/*/)
if (( ${#location_directories[@]} == 0 )); then
  printf 'No chart locations are available.\n' >&2
  exit 1
fi
printf 'Staging %d chart locations...\n' "${#location_directories[@]}"
cp -aL -- "${location_directories[@]}" "$STAGE_DIR/public/charts/"

printf 'Refreshing chart previews and catalogs...\n'
npm --prefix "$ROOT_DIR" run cache:charts -- \
  --charts "$STAGE_DIR/public/charts" \
  --background-previews "$STAGE_DIR/public/chart-previews" \
  --client-database "$STAGE_DIR/public/catalog.sqlite" \
  --server-database "$STAGE_DIR/server/catalog.sqlite"

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
  --link-dest="$DEPLOY_ROOT" \
  -e "ssh ${SSH_OPTIONS[*]}" \
  "$STAGE_DIR/" "$DEPLOY_HOST:$DEPLOY_ROOT.new/"

printf 'Activating deployment and checking the preview service...\n'
ssh "${SSH_OPTIONS[@]}" "$DEPLOY_HOST" "bash -s" -- "$DEPLOY_ROOT" <<'REMOTE'
set -Eeuo pipefail
deploy_root="$1"

chown -R www-data:www-data "$deploy_root.new"
rm -rf -- "$deploy_root.old"
if [[ -e "$deploy_root" ]]; then
  mv -- "$deploy_root" "$deploy_root.old"
fi
mv -- "$deploy_root.new" "$deploy_root"

healthy=false
if systemctl restart rizu-preview; then
  for _ in {1..20}; do
    if systemctl is-active --quiet rizu-preview && curl -fsS http://127.0.0.1:8090/health >/dev/null; then
      healthy=true
      break
    fi
    sleep 0.5
  done
fi

if [[ "$healthy" != true ]]; then
  systemctl stop rizu-preview || true
  rm -rf -- "$deploy_root.failed"
  mv -- "$deploy_root" "$deploy_root.failed"
  if [[ -e "$deploy_root.old" ]]; then
    mv -- "$deploy_root.old" "$deploy_root"
    systemctl start rizu-preview
  fi
  printf 'Deployment health check failed; the previous deployment was restored.\n' >&2
  exit 1
fi
REMOTE

printf 'Verifying public endpoints...\n'
curl -fsS "$DEPLOY_URL/" >/dev/null
curl -fsS "$DEPLOY_URL/catalog.sqlite" >/dev/null

printf 'Deployment complete: %s\n' "$DEPLOY_URL"
