# VPS Deployment

This guide deploys the static web client, client catalog, and background previews behind Nginx. Chart assets are managed separately and preserved across application deployments.

The current production deployment uses:

- Host: `rizu.nimue.mom`
- VPS: `root@nimue.mom`
- Application root: `/srv/rizu`

## One-Command Update

For a normal production update, run:

```bash
npm run deploy
```

This runs the frontend checks, builds the application, refreshes the background previews and client catalog, checks VPS disk space, uploads changed application files, preserves existing VPS chart assets, atomically activates the release, and verifies the public endpoints.

The defaults can be overridden without editing the script:

```bash
DEPLOY_HOST=root@example.com DEPLOY_ROOT=/srv/rizu DEPLOY_URL=https://rizu.example.com npm run deploy
```

Catalogs and previews are generated from local `public/charts`, but chart assets are not uploaded by this command. `CHARTS_DIR` can override the catalog source, `STAGE_DIR` can override the local staging path, and `MIN_FREE_BYTES` can change the default 512 MiB post-upload safety margin.

## Architecture

Nginx terminates HTTPS and serves all application and gameplay files directly:

```text
Browser -- HTTPS :443 --> Nginx
                           |-- /               -> /srv/rizu/dist
                           |-- /catalog.sqlite -> client catalog
                           |-- /charts/        -> chart and audio assets
                           `-- /chart-previews/ -> background thumbnails
```

No application service or non-HTTP media port is required.

## Requirements

Local machine:

- Node.js 22 or newer
- `ffmpeg`, `rsync`, and SSH access to the VPS
- Chart folders available under `public/charts`

VPS:

- Nginx
- Certbot with the Nginx plugin
- TCP ports 80 and 443 open

## First-Time VPS Setup

```bash
ssh root@nimue.mom
apt-get update
apt-get install -y nginx certbot python3-certbot-nginx
ufw allow 80/tcp
ufw allow 443/tcp
```

Install the checked-in Nginx configuration, updating its hostname first when necessary:

```bash
scp deploy/rizu.nginx root@nimue.mom:/etc/nginx/sites-available/rizu
ssh root@nimue.mom '
  ln -sfn /etc/nginx/sites-available/rizu /etc/nginx/sites-enabled/rizu
  nginx -t
  systemctl reload nginx
'
```

After DNS resolves publicly:

```bash
ssh root@nimue.mom \
  'certbot --nginx -d rizu.nimue.mom --non-interactive --agree-tos --redirect'
```

## Manual Bundle

```bash
rm -rf /tmp/rizu-deploy
mkdir -p /tmp/rizu-deploy/{dist,public/chart-previews}
npm ci
npm run typecheck
npm test
npm run build
cp -a dist/. /tmp/rizu-deploy/dist/
npm run cache:charts -- \
  --charts public/charts \
  --background-previews /tmp/rizu-deploy/public/chart-previews \
  --client-database /tmp/rizu-deploy/public/catalog.sqlite
```

Vite uses `copyPublicDir: false`; chart assets are uploaded and managed separately rather than copied into `dist`.

## Verify Deployment

```bash
curl -fsSI https://rizu.nimue.mom/
curl -fsSI https://rizu.nimue.mom/catalog.sqlite
curl -fsSI 'https://rizu.nimue.mom/charts/<collection>/<song>/<audio-file>'
```

If gameplay assets return 404, regenerate the catalog from the same chart tree that exists under `/srv/rizu/public/charts` and avoid renaming files after catalog generation.

## Rollback

The deployment script leaves the previous release in `/srv/rizu.old`. To restore it:

```bash
ssh root@nimue.mom '
  set -eu
  mv /srv/rizu /srv/rizu.failed
  mv /srv/rizu.old /srv/rizu
'
```

Keep `/srv/rizu.failed` until the failure has been inspected.
