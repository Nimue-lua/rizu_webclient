import assert from "node:assert/strict";
import { chmod, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { cacheCharts, gameplayAssetManifest, parseOsuMetadata } from "./chart-catalog.mjs";

test("parses public and private osu catalog metadata", () => {
  const metadata = parseOsuMetadata(`osu file format v14
[General]
AudioFilename: song.ogg
PreviewTime: 12500
Mode: 3
[Metadata]
Title:Test Song
TitleUnicode:テスト
Artist:Test Artist
Creator:Mapper
Version:Hard
BeatmapID:456
BeatmapSetID:123
[Difficulty]
CircleSize:7
[TimingPoints]
0,500,4,2,1,70,1,0
10000,400,4,2,1,70,1,0
[Events]
0,0,"background.jpg",0,0
[HitObjects]
64,192,1000,1,0,0:0:0:0:
192,192,2000,128,0,5000:0:0:0:0:
320,192,11000,1,0,0:0:0:0:
`, "folder", "chart.osu");

  assert.equal(metadata.song_id, "123");
  assert.equal(metadata.chart_id, "456");
  assert.equal(metadata.preview_seconds, 12.5);
  assert.equal(metadata.audio_file, "song.ogg");
  assert.equal(metadata.background_file, "background.jpg");
  assert.equal(metadata.keys, 7);
  assert.equal(metadata.mode, 3);
  assert.equal(metadata.format, "osu");
  assert.equal(metadata.duration_seconds, 10);
  assert.equal(metadata.note_count, 3);
  assert.equal(metadata.long_note_ratio, 1 / 3);
  assert.equal(metadata.difficulty, 0.3);
  assert.equal(metadata.bpm_min, 120);
  assert.equal(metadata.bpm_max, 150);
  assert.equal(metadata.bpm_avg, 123);
});

test("caches all osu modes and only assigns keys to mania", () => {
  const metadata = parseOsuMetadata("Mode:1\nCircleSize:5", "folder", "chart.osu");
  assert.equal(metadata.mode, 1);
  assert.equal(metadata.keys, null);
});

test("rejects asset paths outside a chart folder", () => {
  const metadata = parseOsuMetadata("AudioFilename: ../song.ogg\nMode: 3\nCircleSize:4", "folder", "chart.osu");
  assert.equal(metadata.audio_file, null);
});

test("gameplay asset manifest excludes full backgrounds", () => {
  const manifest = gameplayAssetManifest([{
    audio_path: "charts/Collection/Song/audio.ogg",
    background_path: "charts/Collection/Song/background.png",
    chart_path: "charts/Collection/Song/chart.osu",
  }, {
    audio_path: "charts/Collection/Song/audio.ogg",
    background_path: "charts/Collection/Song/other.png",
    chart_path: "charts/Collection/Song/hard.osu",
  }]);

  assert.deepEqual(manifest.split("\0").filter(Boolean), [
    "Collection/Song/audio.ogg",
    "Collection/Song/chart.osu",
    "Collection/Song/hard.osu",
  ]);
});

test("caches chart collections as locations", async () => {
  const temporary_directory = await mkdtemp(path.join(os.tmpdir(), "rizu-catalog-"));
  const charts_directory = path.join(temporary_directory, "public", "charts");
  const chart_directory = path.join(charts_directory, "Collection One", "Chart One");
  const client_database = path.join(temporary_directory, "client.sqlite");
  const ffmpeg_path = path.join(temporary_directory, "fake-ffmpeg");

  try {
    await mkdir(chart_directory, { recursive: true });
    await writeFile(ffmpeg_path, "#!/bin/sh\nfor output; do :; done\n: > \"$output\"\n");
    await chmod(ffmpeg_path, 0o700);
    await writeFile(path.join(chart_directory, "song.ogg"), "audio");
    await writeFile(path.join(chart_directory, "chart.osu"), `osu file format v14
[General]
AudioFilename: song.ogg
Mode: 3
[Metadata]
Title:Collection Song
Artist:Collection Artist
Creator:Mapper
Version:Hard
BeatmapID:456
BeatmapSetID:123
[Difficulty]
CircleSize:4
[TimingPoints]
0,500,4,2,1,70,1,0
[HitObjects]
64,192,1000,1,0,0:0:0:0:
`);

    const result = await cacheCharts({
      charts_directory,
      client_database,
      schema_directory: path.dirname(fileURLToPath(import.meta.url)),
      ffmpeg_path,
    });

    assert.deepEqual(result.locations, [{
      id: 1,
      name: "Collection One",
      path: "charts/Collection One",
    }]);
    assert.equal(result.charts[0]?.location_id, 1);
    assert.equal(result.charts[0]?.chart_path, "charts/Collection One/Chart One/chart.osu");

    const client = new DatabaseSync(client_database, { readOnly: true });
    try {
      assert.deepEqual({ ...client.prepare("SELECT * FROM locations").get() }, {
        id: 1,
        name: "Collection One",
        path: "charts/Collection One",
      });
      assert.deepEqual({ ...client.prepare("SELECT location_id, chart_path, audio_path FROM charts").get() }, {
        location_id: 1,
        chart_path: "charts/Collection One/Chart One/chart.osu",
        audio_path: "charts/Collection One/Chart One/song.ogg",
      });
    } finally {
      client.close();
    }
  } finally {
    await rm(temporary_directory, { recursive: true, force: true });
  }
});

test("stores audio and backgrounds for every chart in a set", async () => {
  const temporary_directory = await mkdtemp(path.join(os.tmpdir(), "rizu-catalog-media-"));
  const charts_directory = path.join(temporary_directory, "public", "charts");
  const chart_directory = path.join(charts_directory, "Collection", "Song");
  const client_database = path.join(temporary_directory, "client.sqlite");
  const ffmpeg_path = path.join(temporary_directory, "fake-ffmpeg");

  try {
    await mkdir(chart_directory, { recursive: true });
    await writeFile(ffmpeg_path, "#!/bin/sh\nfor output; do :; done\n: > \"$output\"\n");
    await chmod(ffmpeg_path, 0o700);

    for (const [id, version, audio, background] of [
      ["101", "Easy", "Easy.ogg", "Easy.png"],
      ["102", "Hard", "Hard.ogg", "Hard.png"],
      ["103", "Normal", "Easy.ogg", "Easy.png"],
    ]) {
      await writeFile(path.join(chart_directory, audio), "audio");
      await writeFile(path.join(chart_directory, background), "background");
      await writeFile(path.join(chart_directory, `${version}.osu`), `osu file format v14
[General]
AudioFilename: ${audio}
PreviewTime: ${id}00
Mode: 3
[Metadata]
Title:Multi Media Song
Artist:Artist
Creator:Mapper
Version:${version}
BeatmapID:${id}
BeatmapSetID:100
[Difficulty]
CircleSize:4
[Events]
//Background and Video events
0,0,"${background}",0,0
[HitObjects]
64,192,1000,1,0,0:0:0:0:
`);
    }

    await cacheCharts({
      charts_directory,
      client_database,
      schema_directory: path.dirname(fileURLToPath(import.meta.url)),
      ffmpeg_path,
    });

    const client = new DatabaseSync(client_database, { readOnly: true });
    try {
      const media = client.prepare("SELECT id, audio_path, chart_path, preview_seconds, audio_preview_path FROM charts ORDER BY id").all().map((row) => ({ ...row }));
      assert.deepEqual(media.map(({ audio_preview_path: _, ...row }) => row), [{
        id: "101",
        audio_path: "charts/Collection/Song/Easy.ogg",
        chart_path: "charts/Collection/Song/Easy.osu",
        preview_seconds: 10.1,
      }, {
        id: "102",
        audio_path: "charts/Collection/Song/Hard.ogg",
        chart_path: "charts/Collection/Song/Hard.osu",
        preview_seconds: 10.2,
      }, {
        id: "103",
        audio_path: "charts/Collection/Song/Easy.ogg",
        chart_path: "charts/Collection/Song/Normal.osu",
        preview_seconds: 10.3,
      }]);
      assert.match(media[0]?.audio_preview_path, /^audio-previews\/[a-f0-9]{24}\.webm$/);
      assert.match(media[1]?.audio_preview_path, /^audio-previews\/[a-f0-9]{24}\.webm$/);
      assert.match(media[2]?.audio_preview_path, /^audio-previews\/[a-f0-9]{24}\.webm$/);
      assert.notEqual(media[0]?.audio_preview_path, media[2]?.audio_preview_path);
      const previews = client.prepare("SELECT id, background_preview_path FROM charts ORDER BY id").all().map((row) => ({ ...row }));
      assert.equal(previews.length, 3);
      assert.match(previews[0]?.background_preview_path, /^chart-previews\/[a-f0-9]{24}\.webp$/);
      assert.match(previews[1]?.background_preview_path, /^chart-previews\/[a-f0-9]{24}\.webp$/);
      assert.notEqual(previews[0]?.background_preview_path, previews[1]?.background_preview_path);
      assert.equal(previews[0]?.background_preview_path, previews[2]?.background_preview_path);
    } finally {
      client.close();
    }
  } finally {
    await rm(temporary_directory, { recursive: true, force: true });
  }
});
