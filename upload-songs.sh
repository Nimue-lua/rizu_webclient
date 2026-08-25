#!/usr/bin/env bash

set -Eeuo pipefail
export LC_ALL=C

readonly ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly DEPLOY_HOST="${DEPLOY_HOST:-root@nimue.mom}"
readonly DEPLOY_ROOT="${DEPLOY_ROOT:-/srv/rizu}"
readonly DEPLOY_URL="${DEPLOY_URL:-https://rizu.nimue.mom}"
readonly CHARTS_DIR="${CHARTS_DIR:-$ROOT_DIR/public/charts}"
readonly STAGE_DIR="${STAGE_DIR:-/tmp/rizu-song-upload}"
readonly SSH_OPTIONS=(-o ServerAliveInterval=15 -o ServerAliveCountMax=6)

case "${1:-}" in
  -h|--help)
    printf 'Usage: %s\n' "${0##*/}"
    printf 'Uploads songs, previews, and catalog.sqlite without rebuilding the web client.\n'
    exit 0
    ;;
  '') ;;
  *)
    printf 'Unknown argument: %s\nUsage: %s\n' "$1" "${0##*/}" >&2
    exit 2
    ;;
esac

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

rm -rf -- "$STAGE_DIR"
mkdir -p -- "$STAGE_DIR" "$ROOT_DIR/public/chart-previews" "$ROOT_DIR/public/audio-previews"

printf 'Refreshing previews and catalog...\n'
npm --prefix "$ROOT_DIR" run cache:charts -- \
  --charts "$CHARTS_DIR" \
  --background-previews "$ROOT_DIR/public/chart-previews" \
  --audio-previews "$ROOT_DIR/public/audio-previews" \
  --client-database "$STAGE_DIR/catalog.sqlite" \
  --asset-manifest "$STAGE_DIR/chart-assets.list"

printf 'Preparing remote upload...\n'
ssh "${SSH_OPTIONS[@]}" "$DEPLOY_HOST" "bash -s" -- "$DEPLOY_ROOT" <<'REMOTE'
set -Eeuo pipefail
deploy_root="$1"

test -d "$deploy_root/dist"
rm -rf -- "$deploy_root.new" "$deploy_root.old"
cp -al -- "$deploy_root" "$deploy_root.new"
rm -rf -- "$deploy_root.new/public"
mkdir -p -- "$deploy_root.new/public/charts" \
  "$deploy_root.new/public/chart-previews" \
  "$deploy_root.new/public/audio-previews"
df -h "$deploy_root.new"
REMOTE

printf 'Uploading catalog and previews...\n'
rsync -a --partial --info=progress2 \
  -e "ssh ${SSH_OPTIONS[*]}" \
  "$STAGE_DIR/catalog.sqlite" "$DEPLOY_HOST:$DEPLOY_ROOT.new/public/catalog.sqlite"
rsync -a --delete --partial --info=progress2 \
  --link-dest="$DEPLOY_ROOT/public/chart-previews" \
  -e "ssh ${SSH_OPTIONS[*]}" \
  "$ROOT_DIR/public/chart-previews/" "$DEPLOY_HOST:$DEPLOY_ROOT.new/public/chart-previews/"
rsync -a --delete --partial --info=progress2 \
  --link-dest="$DEPLOY_ROOT/public/audio-previews" \
  -e "ssh ${SSH_OPTIONS[*]}" \
  "$ROOT_DIR/public/audio-previews/" "$DEPLOY_HOST:$DEPLOY_ROOT.new/public/audio-previews/"

printf 'Uploading referenced chart and audio files...\n'
rsync -a --partial --info=progress2 \
  --from0 --files-from="$STAGE_DIR/chart-assets.list" \
  --link-dest="$DEPLOY_ROOT/public/charts" \
  -e "ssh ${SSH_OPTIONS[*]}" \
  "$CHARTS_DIR/" "$DEPLOY_HOST:$DEPLOY_ROOT.new/public/charts/"

printf 'Activating song library...\n'
ssh "${SSH_OPTIONS[@]}" "$DEPLOY_HOST" "bash -s" -- "$DEPLOY_ROOT" <<'REMOTE'
set -Eeuo pipefail
deploy_root="$1"

chown -R www-data:www-data "$deploy_root.new/public"
rm -rf -- "$deploy_root"
mv -- "$deploy_root.new" "$deploy_root"
REMOTE

printf 'Verifying catalog...\n'
curl -fsS "$DEPLOY_URL/catalog.sqlite" >/dev/null
printf 'Song upload complete: %s\n' "$DEPLOY_URL"
