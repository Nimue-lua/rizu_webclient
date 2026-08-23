# VPS Deployment

This guide deploys the web client, chart assets, SQLite catalogs, and the Go WebRTC preview server behind Nginx.

The current production deployment uses:

- Host: `rizu.nimue.mom`
- VPS: `root@nimue.mom`
- Public IP: `64.188.126.79`
- Application root: `/srv/rizu`
- Signaling/API address: `127.0.0.1:8090`
- WebRTC media port: `50000/udp`

Change those values in the commands and files when deploying elsewhere.

## One-Command Update

For a normal production update with the first 100 chart folders, run:

```bash
npm run deploy
```

This runs the frontend and Go checks, builds both applications, refreshes chart previews and both SQLite catalogs, checks VPS disk space, uploads only changed files, atomically activates the release, restarts the preview service, and verifies the private health check and public endpoints. If activation fails, it restores the previous release automatically.

The defaults match the production values above. They can be overridden without editing the script:

```bash
DEPLOY_HOST=root@example.com DEPLOY_ROOT=/srv/rizu DEPLOY_URL=https://rizu.example.com npm run deploy
```

Chart folders are selected deterministically by sorted folder name. Set `CHART_LIMIT` to change the count, for example `CHART_LIMIT=150 npm run deploy`. `STAGE_DIR` can override the local staging path, and `MIN_FREE_BYTES` can change the default 512 MiB post-upload safety margin. The VPS must already have the service, Nginx, TLS, and firewall configured as described below.

## Architecture

Nginx terminates HTTPS and serves the frontend, catalog, and chart files. It proxies `/api/` to the Go service. WebRTC media travels directly between the browser and the Go service over UDP port 50000.

```text
Browser
  |-- HTTPS :443 ----------> Nginx
  |                            |-- /              -> /srv/rizu/dist
  |                            |-- /catalog.sqlite -> public client catalog
  |                            |-- /charts/        -> chart assets
  |                            `-- /api/           -> Go on 127.0.0.1:8090
  `-- WebRTC UDP :50000 ----> Go/Pion
```

## Requirements

Local machine:

- Node.js 22 or newer
- Go 1.26 or compatible
- `rsync`, `tar`, and SSH access to the VPS
- Chart folders available under `public/charts`

VPS:

- Ubuntu or another systemd-based Linux distribution
- Nginx
- FFmpeg with `libopus`
- Certbot with the Nginx plugin
- TCP ports 80 and 443 open
- UDP port 50000 open

The DNS `A` record must point the deployment hostname at the VPS before requesting a certificate:

```text
rizu.nimue.mom -> 64.188.126.79
```

## First-Time VPS Setup

Install packages:

```bash
ssh root@nimue.mom
apt-get update
apt-get install -y nginx ffmpeg certbot python3-certbot-nginx
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 50000/udp comment "Rizu WebRTC"
```

The service only listens for HTTP on `127.0.0.1:8090`; that port should not be exposed publicly.

## Build A Deployment Bundle

Run these commands from `webclient/`.

Create a clean staging directory:

```bash
rm -rf /tmp/rizu-deploy
mkdir -p /tmp/rizu-deploy/{bin,dist,public/charts,server}
```

Build the frontend and preview server:

```bash
npm ci
npm run typecheck
npm test
npm run build
go -C preview-server test ./...
go -C preview-server build -o /tmp/rizu-deploy/bin/rizu-preview .
cp -a dist/. /tmp/rizu-deploy/dist/
```

Vite is configured with `copyPublicDir: false`. This is intentional: chart assets are uploaded separately and should not be copied into `dist`.

## Select Chart Folders

Copy the chart folders that should be published into the staging directory. To deploy every chart:

```bash
cp -aL public/charts/. /tmp/rizu-deploy/public/charts/
```

For a smaller pilot, copy only selected folders. For example:

```bash
cp -aL "public/charts/2200770 Feryquitous - Ai Drew" /tmp/rizu-deploy/public/charts/
cp -aL "public/charts/2277451 celtix - CosmographY" /tmp/rizu-deploy/public/charts/
cp -aL "public/charts/2323413 Kou_ - A.O.E__area_of_effect" /tmp/rizu-deploy/public/charts/
```

`public/charts` may be a symlink. Use `cp -aL` so the actual files, rather than the symlink, are included.

Check the bundle size before uploading:

```bash
du -sh /tmp/rizu-deploy/public/charts
ssh root@nimue.mom df -h /
```

## Generate Matching Catalogs

Always generate catalogs from the staged chart directory. This prevents the client catalog from showing songs whose files were not uploaded.

```bash
npm run cache:charts -- \
  --charts /tmp/rizu-deploy/public/charts \
  --client-database /tmp/rizu-deploy/public/catalog.sqlite \
  --server-database /tmp/rizu-deploy/server/catalog.sqlite
```

The command also uses FFmpeg to generate low-quality, 445px-high WebP previews in `public/chart-previews`. Existing previews newer than their source images are reused. It then prints the number of cached songs, charts, and skipped invalid files.

## Upload

For the first deployment, upload the staging directory with rsync:

```bash
rsync -a --delete --info=progress2 \
  -e 'ssh -o ServerAliveInterval=15 -o ServerAliveCountMax=6' \
  /tmp/rizu-deploy/ root@nimue.mom:/srv/rizu.new/
```

For an unreliable connection, `--partial` preserves incomplete files:

```bash
rsync -a --delete --partial --info=progress2 \
  -e 'ssh -o ServerAliveInterval=15 -o ServerAliveCountMax=6' \
  /tmp/rizu-deploy/ root@nimue.mom:/srv/rizu.new/
```

Set ownership and atomically activate the upload:

```bash
ssh root@nimue.mom '
  set -eu
  chown -R www-data:www-data /srv/rizu.new
  rm -rf /srv/rizu.old
  if [ -e /srv/rizu ]; then mv /srv/rizu /srv/rizu.old; fi
  mv /srv/rizu.new /srv/rizu
'
```

The previous deployment remains in `/srv/rizu.old` until the next update.

## Install The Service

The checked-in service file contains the current VPS public IP. Update `deploy/rizu-preview.service` before deploying to another server.

```bash
scp deploy/rizu-preview.service root@nimue.mom:/etc/systemd/system/rizu-preview.service
ssh root@nimue.mom '
  systemctl daemon-reload
  systemctl enable --now rizu-preview
  systemctl --no-pager --full status rizu-preview
'
```

Important service arguments:

- `-address 127.0.0.1:8090`: private HTTP signaling/API listener.
- `-udp-address :50000`: one shared Pion UDP media port.
- `-public-ip 64.188.126.79`: public address placed in ICE candidates.
- `-catalog /srv/rizu/server/catalog.sqlite`: private path catalog.
- `-public /srv/rizu/public`: root used to resolve audio files.

## Install Nginx And TLS

The checked-in Nginx file contains the current hostname. Update `deploy/rizu.nginx` before using another hostname.

```bash
scp deploy/rizu.nginx root@nimue.mom:/etc/nginx/sites-available/rizu
ssh root@nimue.mom '
  ln -sfn /etc/nginx/sites-available/rizu /etc/nginx/sites-enabled/rizu
  nginx -t
  systemctl reload nginx
'
```

After DNS resolves publicly, obtain and install the certificate:

```bash
ssh root@nimue.mom \
  'certbot --nginx -d rizu.nimue.mom --non-interactive --agree-tos --redirect'
```

Certbot modifies the Nginx virtual host to add TLS and installs automatic renewal.

## Verify Deployment

Check services and storage:

```bash
ssh root@nimue.mom '
  nginx -t
  systemctl is-active nginx rizu-preview
  ss -lunp | grep 50000
  ufw status | grep 50000
  df -h /
  du -sh /srv/rizu
'
```

Check public endpoints:

```bash
curl -fsSI https://rizu.nimue.mom/
curl -fsSI https://rizu.nimue.mom/catalog.sqlite
curl -fsS https://rizu.nimue.mom/api/charts/song/2200770
```

Check service logs while selecting songs in a browser:

```bash
ssh root@nimue.mom 'journalctl -u rizu-preview -f'
```

The SDP answer returned by `POST /api/preview/offer` should advertise the public endpoint:

```text
64.188.126.79 50000 typ host
```

## Updating The Deployment

For normal updates:

1. Rebuild the frontend and Go binary.
2. Copy the desired chart folders into a clean `/tmp/rizu-deploy`.
3. Regenerate both catalogs from that staged chart directory.
4. Rsync the bundle to `/srv/rizu.new`.
5. Atomically swap `/srv/rizu.new` into `/srv/rizu`.
6. Restart the Go service.
7. Reload Nginx only if its configuration changed.

After activating an update:

```bash
ssh root@nimue.mom '
  systemctl restart rizu-preview
  systemctl is-active rizu-preview
  curl -fsS http://127.0.0.1:8090/health
'
```

Do not update only one SQLite database. The public and server catalogs must be generated together from the same chart set.

## Rollback

If verification fails after an atomic swap:

```bash
ssh root@nimue.mom '
  set -eu
  systemctl stop rizu-preview
  mv /srv/rizu /srv/rizu.failed
  mv /srv/rizu.old /srv/rizu
  systemctl start rizu-preview
  systemctl is-active rizu-preview
'
```

Keep `/srv/rizu.failed` until the cause has been inspected. Remove it manually after a successful recovery.

## Troubleshooting

Preview signaling works but audio is silent:

- Confirm UDP 50000 is allowed by the VPS firewall and hosting provider firewall.
- Confirm the service uses the correct `-public-ip` value.
- Inspect the SDP answer for the public IP and port 50000.
- Check `journalctl -u rizu-preview` for FFmpeg errors.
- Confirm `www-data` can read the audio file.

Catalog loads but gameplay assets return 404:

- Regenerate both catalogs from `/tmp/rizu-deploy/public/charts`.
- Confirm the chart folder exists under `/srv/rizu/public/charts`.
- Avoid renaming chart files after catalog generation.

Nginx returns 502 for `/api/`:

- Run `systemctl status rizu-preview`.
- Check `curl http://127.0.0.1:8090/health` on the VPS.
- Confirm the Go service is bound to `127.0.0.1:8090`.

Certificate issuance fails:

- Confirm the hostname resolves publicly to the VPS.
- Confirm TCP ports 80 and 443 are open.
- Check with public resolvers such as `dig @1.1.1.1 rizu.nimue.mom A`.
