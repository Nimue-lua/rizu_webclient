# Rizu Web Client

TRY IT RIGHT NOW: https://rizu.nimue.mom/

Original and a source of truth: https://github.com/semyon422/rizu

WebGL + TS + React Rhythm game for those who don't want to use native game

## Development

Requirements: Node.js 22 or newer, npm, and FFmpeg.

```bash
git clone https://github.com/Nimue-lua/rizu_webclient.git
cd rizu_webclient
npm install

# Add songs before generating previews and the catalog:
# /media/SSD/s3/charts/<location>/<set>/{chart.osu,audio.ogg,background.jpg}
./rizu
npm run dev
```

Each song goes in its own directory inside a location under `/media/SSD/s3/charts`. A song directory must contain at least one `.osu` chart and the audio file named by its `AudioFilename`; a background image is optional. Multiple difficulties can be placed in the same song directory.

`./rizu` provides one menu for maintaining and deploying Rizu:

- Generate missing chart background previews.
- Create or update `library/catalog.sqlite`, including calculated difficulty.
- Upload songs and previews.
- Upload the catalog.
- Build and deploy the application.

The same actions can be scripted with `./rizu previews`, `./rizu catalog`, `./rizu upload-songs`, `./rizu upload-catalog`, and `./rizu deploy`.

Run the cache command again whenever songs or charts are added, removed, renamed, or moved. The existing files in `public/skins` and `public/rizu-logo.svg` are also required by the client and are included in the repository.

## Upload The Catalog With rclone

The `catalog:` rclone remote points to Selectel S3 and `rizu.catalog` is the bucket. Upload immutable assets first:

```bash
rclone copy "/media/SSD/s3_test/chart-files/v1" "catalog:rizu.catalog/chart-files/v1" \
  --metadata \
  --metadata-set "cache-control=public, max-age=31536000, immutable" \
  --metadata-set "content-type=text/plain; charset=utf-8" \
  --progress

rclone copy "/media/SSD/s3_test/audio/v1" "catalog:rizu.catalog/audio/v1" \
  --metadata \
  --metadata-set "cache-control=public, max-age=31536000, immutable" \
  --metadata-set "content-type=audio/webm" \
  --progress

rclone copy "/media/SSD/s3_test/audio-previews/v1" "catalog:rizu.catalog/audio-previews/v1" \
  --metadata \
  --metadata-set "cache-control=public, max-age=31536000, immutable" \
  --metadata-set "content-type=audio/webm" \
  --progress

rclone copy "/media/SSD/s3_test/backgrounds/v2" "catalog:rizu.catalog/backgrounds/v2" \
  --metadata \
  --metadata-set "cache-control=public, max-age=31536000, immutable" \
  --metadata-set "content-type=image/avif" \
  --progress
```

Publish the compressed database last, under the `catalog.sqlite` object name:

```bash
rclone copyto "/media/SSD/s3_test/catalog.sqlite.gz" "catalog:rizu.catalog/catalog.sqlite" \
  --metadata \
  --metadata-set "cache-control=no-cache" \
  --metadata-set "content-type=application/vnd.sqlite3" \
  --metadata-set "content-encoding=gzip" \
  --ignore-times \
  --progress
```

The immutable asset commands skip files already present. Add `--ignore-times` once when repairing metadata on previously uploaded assets. Do not use `rclone sync`: old immutable files may still be referenced by clients with a cached catalog.

Verify public headers with an origin so the response also shows the bucket's CORS policy:

```bash
curl -I -H "Origin: https://rizu.kuudere.fun" "https://<storage-host>/chart-files/v1/<chart-md5>.osu"
curl -I --compressed -H "Origin: https://rizu.kuudere.fun" "https://<storage-host>/catalog.sqlite"
```
