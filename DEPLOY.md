# VPS Deployment

This guide deploys the static web client, client catalog, generated previews, and required gameplay assets behind Nginx.

The current production deployment uses:

- Host: `rizu.nimue.mom`
- VPS: `root@nimue.mom`
- Application root: `/srv/rizu`

## One-Command Update

Open the maintenance CLI:

```bash
./rizu
```

The menu exposes preview generation, catalog creation, song upload, catalog upload, and application deployment as separate operations.

To deploy a new frontend build non-interactively, run:

```bash
./rizu deploy
```

Application deployment preserves the active catalog, chart previews, audio previews, gameplay assets, and Nginx configuration.

Song and catalog uploads are deliberately separate:

```bash
./rizu upload-songs
./rizu upload-catalog
```

Song upload sends referenced `.osu` and audio files plus generated previews. Catalog upload sends the existing `public/catalog.sqlite`. Neither operation rebuilds the application.

The defaults can be overridden without editing the script:

```bash
DEPLOY_HOST=root@example.com DEPLOY_ROOT=/srv/rizu DEPLOY_URL=https://rizu.example.com ./rizu
```

Catalogs and previews are generated from local `public/charts`. Deployment uploads only `.osu` files and audio referenced by the generated catalog. Original background images, videos, storyboards, and unrelated files are excluded because song select uses generated WebP thumbnails. `CHARTS_DIR` can override the chart source, `STAGE_DIR` can override the local staging path, and `MIN_FREE_BYTES` can change the default 512 MiB post-upload safety margin.

Unchanged gameplay assets are hard-linked from the active release with `rsync --link-dest`, so they are not uploaded again or duplicated on disk. Deployment removes full backgrounds left by older releases from the active chart tree. No rollback copy is retained because VPS storage is limited; any existing `/srv/rizu.old` is deleted at the start of deployment.

## Architecture

Nginx terminates HTTPS and serves all application and gameplay files directly:

```text
Browser -- HTTPS :443 --> Nginx
                           |-- /               -> /srv/rizu/dist
                           |-- /catalog.sqlite -> client catalog
                           |-- /charts/        -> chart and audio assets
                           |-- /chart-previews/ -> background thumbnails
                           `-- /audio-previews/ -> compact song previews
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

The checked-in Nginx configuration expects an existing Let's Encrypt certificate for the deployment hostname. Install it after obtaining the certificate, updating its hostname and certificate paths first when necessary:

```bash
scp deploy/rizu.nginx root@nimue.mom:/etc/nginx/sites-available/rizu
ssh root@nimue.mom '
  ln -sfn /etc/nginx/sites-available/rizu /etc/nginx/sites-enabled/rizu
  nginx -t
  systemctl reload nginx
'
```

If the certificate does not exist yet, use a temporary HTTP virtual host and obtain it after DNS resolves publicly:

```bash
ssh root@nimue.mom \
  'certbot --nginx -d rizu.nimue.mom --non-interactive --agree-tos --redirect'
```

The Nginx configuration is managed separately. Application deployment only replaces the built `dist` directory.

## Verify Deployment

```bash
curl -fsSI https://rizu.nimue.mom/
curl -fsSI https://rizu.nimue.mom/catalog.sqlite
curl -fsSI 'https://rizu.nimue.mom/charts/<collection>/<song>/<audio-file>'
```

If gameplay assets return 404, regenerate the catalog from the same chart tree that exists under `/srv/rizu/public/charts` and avoid renaming files after catalog generation.
