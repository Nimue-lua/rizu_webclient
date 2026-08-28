# Generate The Chart Cache

This guide explains how to make Rizu find your songs and charts.

## What This Does

The cache command scans your chart folders and creates:

- `library/catalog.sqlite`: the remote provider catalog.
- `library/chart-previews/`: small background images used on song select.

Song select streams the original audio file and seeks to the `.osu` file's `PreviewTime`.

Run `./rizu` again whenever you add, remove, rename, or move charts.

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

Put chart locations inside `/media/SSD/s3/charts`.

The expected layout is:

```text
/media/SSD/s3/charts/
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
ln -s "/path/to/my/charts" "/media/SSD/s3/charts/My Charts"
```

Make sure the link target exists and can be read.

## 4. Generate Previews And Catalog

From the project directory, run the CLI:

```bash
./rizu
```

Choose option 1 to generate only missing previews, then option 2 to create or update the catalog. A successful catalog run looks similar to:

```text
Cached 1 locations, 659 songs, and 2367 charts (4 skipped).
Catalog version: c9394375...
```

`skipped` means some chart files were invalid, unsupported, or missing their audio. A small number does not stop valid charts from being cached.

Existing background previews are reused.

## 5. Upload The Library

Use `./rizu upload-songs` and `./rizu upload-catalog` to publish the generated files to `charts.kuudere.fun`. Vite does not serve this workspace.

The directory must contain location folders, followed by song folders:

```text
/media/SSD/s3/charts/
└── Collection/
    └── Song/
        ├── chart.osu
        └── audio.ogg
```

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
./rizu catalog
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

`PreviewTime` is measured in milliseconds. In this example the preview starts 45 seconds into the song. Run `./rizu previews` again after changing it.

### The song appears but gameplay returns 404

The generated catalog contains paths relative to the chart directory. The web server must expose the same chart tree at `/charts/`. Do not rename or move chart files after generating the catalog.

## Quick Version

If everything is already installed and charts are under `/media/SSD/s3/charts`, these are the only commands you need:

```bash
npm install
./rizu
```
