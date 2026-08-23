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

code_only=false
case "${1:-}" in
  --code-only)
    code_only=true
    shift
    ;;
  -h|--help)
    printf 'Usage: %s [--code-only]\n' "${0##*/}"
    exit 0
    ;;
esac

if (( $# > 0 )); then
  printf 'Unknown argument: %s\nUsage: %s [--code-only]\n' "$1" "${0##*/}" >&2
  exit 2
fi

required_commands=(npm node rsync ssh curl)
if [[ "$code_only" == false ]]; then
  required_commands+=(ffmpeg scp)
fi

for command in "${required_commands[@]}"; do
  command -v "$command" >/dev/null || {
    printf 'Required command not found: %s\n' "$command" >&2
    exit 1
  }
done

if [[ "$code_only" == false && ! -d "$CHARTS_DIR" ]]; then
  printf 'Chart directory not found: %s\n' "$CHARTS_DIR" >&2
  exit 1
fi

printf 'Checking VPS access and available storage...\n'
if [[ "$code_only" == true ]]; then
  ssh "${SSH_OPTIONS[@]}" "$DEPLOY_HOST" \
    "set -eu; test -d '$DEPLOY_ROOT'; rm -rf -- '$DEPLOY_ROOT.new' '$DEPLOY_ROOT.old'; cp -al -- '$DEPLOY_ROOT' '$DEPLOY_ROOT.new'; rm -rf -- '$DEPLOY_ROOT.new/dist'; mkdir -p '$DEPLOY_ROOT.new/dist'; df -h '$DEPLOY_ROOT.new'"
else
  ssh "${SSH_OPTIONS[@]}" "$DEPLOY_HOST" \
    "set -eu; rm -rf -- '$DEPLOY_ROOT.new' '$DEPLOY_ROOT.old'; mkdir -p '$DEPLOY_ROOT.new/public/charts'; df -h '$DEPLOY_ROOT.new'"
fi

printf 'Installing dependencies and running checks...\n'
npm --prefix "$ROOT_DIR" ci
npm --prefix "$ROOT_DIR" run typecheck
npm --prefix "$ROOT_DIR" test

printf 'Building deployment bundle...\n'
rm -rf -- "$STAGE_DIR"
mkdir -p -- "$STAGE_DIR/dist"
npm --prefix "$ROOT_DIR" run build
cp -a -- "$ROOT_DIR/dist/." "$STAGE_DIR/dist/"

if [[ "$code_only" == false ]]; then
  mkdir -p -- "$STAGE_DIR/public/chart-previews" "$STAGE_DIR/public/audio-previews"
  printf 'Refreshing chart previews and catalogs...\n'
  npm --prefix "$ROOT_DIR" run cache:charts -- \
    --charts "$CHARTS_DIR" \
    --background-previews "$STAGE_DIR/public/chart-previews" \
    --audio-previews "$ROOT_DIR/public/audio-previews" \
    --client-database "$STAGE_DIR/public/catalog.sqlite" \
    --asset-manifest "$STAGE_DIR/chart-assets.list"
  cp -a -- "$ROOT_DIR/public/audio-previews/." "$STAGE_DIR/public/audio-previews/"
fi

bundle_bytes="$(du -sb "$STAGE_DIR" | cut -f1)"
available_bytes="$(ssh "${SSH_OPTIONS[@]}" "$DEPLOY_HOST" "df --output=avail -B1 '$DEPLOY_ROOT.new'" | tr -dc '0-9')"
required_bytes=$((bundle_bytes + MIN_FREE_BYTES))
if (( available_bytes < required_bytes )); then
  printf 'Insufficient VPS space: bundle needs %d bytes plus %d bytes free; only %d bytes available.\n' \
    "$bundle_bytes" "$MIN_FREE_BYTES" "$available_bytes" >&2
  exit 1
fi

printf 'Uploading deployment...\n'
if [[ "$code_only" == true ]]; then
  rsync -a --delete --partial --info=progress2 \
    -e "ssh ${SSH_OPTIONS[*]}" \
    "$STAGE_DIR/dist/" "$DEPLOY_HOST:$DEPLOY_ROOT.new/dist/"
else
  rsync -a --delete --partial --info=progress2 \
    --exclude='/public/charts/***' \
    --exclude='/chart-assets.list' \
    --link-dest="$DEPLOY_ROOT" \
    -e "ssh ${SSH_OPTIONS[*]}" \
    "$STAGE_DIR/" "$DEPLOY_HOST:$DEPLOY_ROOT.new/"

  printf 'Uploading referenced gameplay assets without full backgrounds...\n'
  rsync -a --delete --partial --info=progress2 \
    --from0 --files-from="$STAGE_DIR/chart-assets.list" \
    --link-dest="$DEPLOY_ROOT/public/charts" \
    -e "ssh ${SSH_OPTIONS[*]}" \
    "$CHARTS_DIR/" "$DEPLOY_HOST:$DEPLOY_ROOT.new/public/charts/"
fi

printf 'Activating deployment...\n'
ssh "${SSH_OPTIONS[@]}" "$DEPLOY_HOST" "bash -s" -- "$DEPLOY_ROOT" <<'REMOTE'
set -Eeuo pipefail
deploy_root="$1"

chown -R www-data:www-data "$deploy_root.new"
rm -rf -- "$deploy_root"
mv -- "$deploy_root.new" "$deploy_root"
REMOTE

if [[ "$code_only" == false ]]; then
  printf 'Updating Nginx configuration...\n'
  scp "${SSH_OPTIONS[@]}" "$ROOT_DIR/deploy/rizu.nginx" "$DEPLOY_HOST:/etc/nginx/sites-available/rizu.new"
  ssh "${SSH_OPTIONS[@]}" "$DEPLOY_HOST" 'bash -s' <<'REMOTE'
set -Eeuo pipefail
config=/etc/nginx/sites-available/rizu
cp -- "$config" "$config.previous"
mv -- "$config.new" "$config"
if nginx -t; then
  systemctl reload nginx
  rm -f -- "$config.previous"
else
  mv -- "$config.previous" "$config"
  exit 1
fi
REMOTE
fi

printf 'Verifying public endpoints...\n'
curl -fsS "$DEPLOY_URL/" >/dev/null
curl -fsS "$DEPLOY_URL/catalog.sqlite" >/dev/null

printf 'Deployment complete: %s\n' "$DEPLOY_URL"
