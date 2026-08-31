#!/usr/bin/env bash

set -Eeuo pipefail

readonly DEPLOY_HOST="${DEPLOY_HOST:-root@nimue.mom}"
readonly REPOSITORY_URL="${REPOSITORY_URL:-https://github.com/Nimue-lua/rizu_webclient.git}"
readonly BRANCH="${BRANCH:-main}"
readonly SERVER_ROOT="${SERVER_ROOT:-/srv/rizu-replay/repo}"

ssh "$DEPLOY_HOST" "bash -s" -- "$REPOSITORY_URL" "$BRANCH" "$SERVER_ROOT" <<'REMOTE'
set -Eeuo pipefail

repository_url="$1"
branch="$2"
server_root="$3"

if [[ ! -d "$server_root/.git" ]]; then
  git clone --branch "$branch" --single-branch "$repository_url" "$server_root"
else
  git -C "$server_root" fetch origin "$branch"
  git -C "$server_root" merge --ff-only FETCH_HEAD
fi

systemctl restart rizu-replay
systemctl --quiet is-active rizu-replay
curl --fail --silent --show-error --retry 30 --retry-delay 1 --retry-connrefused \
  http://127.0.0.1:8765/api/health
REMOTE

printf '\nReplay server deployed from %s (%s).\n' "$REPOSITORY_URL" "$BRANCH"
