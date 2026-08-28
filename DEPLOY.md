# VPS Deployment

This guide deploys the static web client, client catalog, generated previews, and required gameplay assets behind Nginx.

The current production deployment uses:

- Host: `rizu.nimue.mom`
- VPS: `root@nimue.mom`
- Application root: `/srv/rizu`
- Chart library URL: `charts.kuudere.fun`
- Chart library root: `/srv/charts.kuudere.fun`

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

Application deployment replaces only the frontend under `/srv/rizu`. It does not modify the separate chart library.

Song and catalog uploads are deliberately separate:

```bash
./rizu upload-songs
./rizu upload-catalog
```

Song upload sends referenced `.osu` and audio files plus generated previews to the chart library root. Catalog upload sends the existing `public/catalog.sqlite` there. Neither operation rebuilds the application.

The defaults can be overridden without editing the script:

```bash
DEPLOY_HOST=root@example.com DEPLOY_ROOT=/srv/rizu DEPLOY_URL=https://rizu.example.com \
  LIBRARY_ROOT=/srv/charts.example.com LIBRARY_URL=https://charts.example.com ./rizu
```

Catalogs and previews are generated from local `public/charts`. Deployment uploads only `.osu` files and audio referenced by the generated catalog. Original background images, videos, storyboards, and unrelated files are excluded because song select uses generated WebP thumbnails. `CHARTS_DIR` can override the chart source, `STAGE_DIR` can override the local staging path, and `MIN_FREE_BYTES` can change the default 512 MiB post-upload safety margin.

Unchanged gameplay assets are hard-linked from the active library with `rsync --link-dest`, so they are not uploaded again or duplicated on disk. Song upload removes full backgrounds left by older releases from the active chart tree. No rollback copy is retained because VPS storage is limited.

## Architecture

Nginx terminates HTTPS and serves all application and gameplay files directly:

```text
Browser -- HTTPS :443 --> Nginx
                           |-- /               -> /srv/rizu/dist
                           |-- charts.kuudere.fun/catalog.sqlite
                           |-- charts.kuudere.fun/charts/
                           |-- charts.kuudere.fun/chart-previews/
                           `-- charts.kuudere.fun/audio-previews/
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
curl -fsSI https://charts.kuudere.fun/catalog.sqlite
curl -fsSI 'https://charts.kuudere.fun/charts/<collection>/<song>/<audio-file>'
```

If gameplay assets return 404, regenerate the catalog from the same chart tree that exists under `/srv/charts.kuudere.fun/public/charts` and avoid renaming files after catalog generation.
