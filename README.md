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

# Add songs before generating the cache:
# public/charts/<collection>/<song>/{chart.osu,audio.ogg,background.jpg}
npm run cache:charts
npm run dev
```

Each song goes in its own directory inside a collection under `public/charts`. A song directory must contain at least one `.osu` chart and the audio file named by its `AudioFilename`; a background image is optional. Multiple difficulties can be placed in the same song directory.

`npm run cache:charts` scans the songs and generates everything else required by the library:

- `public/catalog.sqlite`: the song and chart database.
- `public/chart-previews/`: generated background previews.
- `public/audio-previews/`: generated song previews.

Run the cache command again whenever songs or charts are added, removed, renamed, or moved. The existing files in `public/skins` and `public/rizu-logo.svg` are also required by the client and are included in the repository.
