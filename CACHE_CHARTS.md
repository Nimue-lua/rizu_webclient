# Generate The Chart Cache

This guide explains how to make Rizu find your songs and charts.

## What This Does

The cache command scans your chart folders and creates:

- `public/catalog.sqlite`: the song list used by the web client.
- `public/chart-previews/`: small background images used on song select.
- `public/audio-previews/`: compact audio clips streamed on song select.

Run the command again whenever you add, remove, rename, or move charts.

## 1. Install Requirements

You need:

- Node.js 22 or newer.
- FFmpeg.

On Ubuntu or Debian:

```bash
sudo apt update
sudo apt install nodejs npm ffmpeg
```

Check that they work:

```bash
node --version
npm --version
ffmpeg -version
```

## 2. Install Project Packages

Open a terminal in the project directory and run:

```bash
npm install
```

You normally only need to do this once.

## 3. Add Charts

Put chart collections inside `public/charts`.

The expected layout is:

```text
public/charts/
└── My Collection/
    └── My Song/
        ├── chart.osu
        ├── audio.ogg
        └── background.jpg
```

Important:

- The first folder is the collection shown by Rizu.
- Each song should have its own folder inside the collection.
- The `.osu` file must point to an audio file that exists in the same song folder.

If your charts are stored elsewhere, you may use a symbolic link:

```bash
ln -s "/path/to/my/charts" "public/charts/My Charts"
```

Make sure the link target exists and can be read.

## 4. Generate The Cache

From the project directory, run:

```bash
npm run cache:charts
```

A successful run looks similar to:

```text
Cached 1 locations, 659 songs, and 2367 charts (4 skipped).
Catalog version: c9394375...
```

`skipped` means some chart files were invalid, unsupported, or missing their audio. A small number does not stop valid charts from being cached.

Audio previews use each `.osu` file's `PreviewTime`. They are 10-second mono Opus/WebM clips encoded at 32 kbps, normally around 40 KB each. Charts that use the same audio and preview time share one generated file.

Existing previews are reused. Files no longer referenced by any chart are removed after a successful rebuild.

## 5. Start The Client

```bash
npm run dev
```

Open the address printed by Vite, usually:

```text
http://localhost:5173
```

Refresh the page after rebuilding the cache. If the old song list remains, perform a hard refresh with `Ctrl+Shift+R`.

## Use A Different Chart Directory

You do not need to copy charts into the project. Pass their directory directly:

```bash
npm run cache:charts -- --charts "/path/to/charts"
```

That directory must still contain collection folders, followed by song folders:

```text
/path/to/charts/
└── Collection/
    └── Song/
        ├── chart.osu
        └── audio.ogg
```

## Use Custom Output Paths

```bash
npm run cache:charts -- \
  --charts "/path/to/charts" \
  --background-previews "/path/to/chart-previews" \
  --audio-previews "/path/to/audio-previews" \
  --client-database "/path/to/catalog.sqlite"
```

The web client expects the normal output paths unless its server configuration is also changed.

## Common Problems

### `ENOENT: no such file or directory`

A file, directory, or symbolic-link target does not exist. Check every path in the error. Recreate or remove broken symbolic links.

### `ffmpeg: command not found`

Install FFmpeg:

```bash
sudo apt install ffmpeg
```

### `no such column: charts.audio_path`

The browser or project has an old catalog. Generate it again:

```bash
npm run cache:charts
```

Then hard-refresh the browser with `Ctrl+Shift+R`.

### The command reports skipped charts

Check that:

- The `.osu` file contains a valid `AudioFilename` value.
- The named audio file exists in the song folder.
- File names match exactly, including uppercase and lowercase letters.
- The current user can read the chart and audio files.

### Preview audio starts in the wrong place

Open the chart's `.osu` file and check the `[General]` section:

```ini
[General]
AudioFilename: audio.ogg
PreviewTime: 45000
```

`PreviewTime` is measured in milliseconds. In this example the preview starts 45 seconds into the song. Run `npm run cache:charts` again after changing it.

### The song appears but gameplay returns 404

The generated catalog contains paths relative to the chart directory. The web server must expose the same chart tree at `/charts/`. Do not rename or move chart files after generating the catalog.

## Quick Version

If everything is already installed and charts are under `public/charts`, these are the only commands you need:

```bash
npm install
npm run cache:charts
npm run dev
```
