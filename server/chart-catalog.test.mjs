import assert from "node:assert/strict";
import { access, chmod, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
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
  assert.ok(metadata.difficulty > 0);
  assert.equal(metadata.bpm_min, 120);
  assert.equal(metadata.bpm_max, 150);
  assert.equal(metadata.bpm_avg, 123);
});

test("caches all osu modes and only assigns keys to mania", () => {
  const metadata = parseOsuMetadata("Mode:1\nCircleSize:5", "folder", "chart.osu");
  assert.equal(metadata.mode, 1);
  assert.equal(metadata.keys, null);
});

test("uses mode-specific difficulty calculators", () => {
  const chart = (mode, times, positions) => `Mode:${mode}\n[HitObjects]\n${times.map((time, index) => `${positions[index] ?? 256},192,${time},1,0,0:0:0:0:`).join("\n")}`;
  const even = parseOsuMetadata(chart(0, [0, 500, 1000, 1500], [256, 256, 256, 256]), "folder", "even.osu");
  const technical = parseOsuMetadata(chart(0, [0, 500, 750, 875], [0, 300, 0, 300]), "folder", "technical.osu");
  const mania = parseOsuMetadata(chart(3, [0, 500, 1000], []), "folder", "mania.osu");

  assert.ok(technical.difficulty > even.difficulty);
  assert.ok(mania.difficulty > 0);
});

test("adds strain for alternating jump angles", () => {
  const chart = (positions) => `Mode:0\n[HitObjects]\n${positions.map((x, index) => `${x},192,${index * 200},1,0,0:0:0:0:`).join("\n")}`;
  const straight = parseOsuMetadata(chart([0, 150, 300]), "folder", "straight.osu");
  const alternating = parseOsuMetadata(chart([0, 150, 0]), "folder", "alternating.osu");
  assert.ok(alternating.difficulty > straight.difficulty + 0.5);
});

test("builds stamina strain during long streams", () => {
  const chart = (count) => `Mode:0\n[HitObjects]\n${Array.from({ length: count }, (_, index) => `256,192,${index * 100},1,0,0:0:0:0:`).join("\n")}`;
  const short_stream = parseOsuMetadata(chart(21), "folder", "short.osu");
  const long_stream = parseOsuMetadata(chart(601), "folder", "long.osu");
  assert.ok(long_stream.difficulty > short_stream.difficulty + 0.2);
});

test("discounts short osu charts", () => {
  const chart = (mode, end_time) => `Mode:${mode}\n[HitObjects]\n0,192,0,1,0,0:0:0:0:\n300,192,200,1,0,0:0:0:0:\n300,192,${end_time},8,0,${end_time}`;
  const short = parseOsuMetadata(chart(0, 34_999), "folder", "short.osu");
  const full = parseOsuMetadata(chart(0, 120_000), "folder", "full.osu");
  assert.ok(Math.abs(short.difficulty / full.difficulty - 0.8) < 1e-10);
});

test("uses mania LN releases in difficulty timing", () => {
  const taps = parseOsuMetadata(`Mode:3\nCircleSize:4\n[HitObjects]\n64,192,0,1,0,0:0:0:0:\n192,192,400,1,0,0:0:0:0:`, "folder", "taps.osu");
  const hold = parseOsuMetadata(`Mode:3\nCircleSize:4\n[HitObjects]\n64,192,0,128,0,200:0:0:0:0:\n192,192,400,1,0,0:0:0:0:`, "folder", "hold.osu");
  assert.ok(hold.difficulty > taps.difficulty);
});

test("rates dense regular mania notes above dense LN actions", () => {
  const regular_objects = Array.from({ length: 101 }, (_, index) => `${64 + index % 4 * 128},192,${index * 100},1,0,0:0:0:0:`).join("\n");
  const hold_objects = Array.from({ length: 50 }, (_, index) => `${64 + index % 4 * 128},192,${index * 200},128,0,${index * 200 + 100}:0:0:0:0:`).join("\n");
  const regular = parseOsuMetadata(`Mode:3\nCircleSize:4\n[HitObjects]\n${regular_objects}`, "folder", "regular.osu");
  const holds = parseOsuMetadata(`Mode:3\nCircleSize:4\n[HitObjects]\n${hold_objects}`, "folder", "holds.osu");
  assert.ok(regular.difficulty > holds.difficulty + 0.5);
});

test("distinguishes extreme mania stream interval speeds", () => {
  const chart = (interval) => `Mode:3\nCircleSize:4\n[HitObjects]\n${Array.from({ length: 401 }, (_, index) => `${64 + index % 4 * 128},192,${index * interval},1,0,0:0:0:0:`).join("\n")}`;
  const delta_like = parseOsuMetadata(chart(39), "folder", "delta.osu");
  const epsilon_like = parseOsuMetadata(chart(32), "folder", "epsilon.osu");
  const final_like = parseOsuMetadata(chart(30), "folder", "final.osu");
  assert.ok(final_like.difficulty > epsilon_like.difficulty);
  assert.ok(epsilon_like.difficulty > delta_like.difficulty);
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
    const chart_source = `osu file format v14
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
`;
    await writeFile(path.join(chart_directory, "chart.osu"), chart_source);
    await writeFile(path.join(chart_directory, "duplicate.osu"), chart_source.replace("Version:Hard", "Version:Duplicate"));

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
    assert.equal(result.charts[0]?.chart_id, "456");
    assert.match(result.charts[1]?.chart_id ?? "", /^chart-[a-f0-9]{24}$/);
    assert.equal(result.charts[1]?.beatmap_id, 456);

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
      assert.equal(client.prepare("SELECT COUNT(*) AS count FROM charts").get().count, 2);
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

test("updates the database without creating previews", async () => {
  const temporary_directory = await mkdtemp(path.join(os.tmpdir(), "rizu-catalog-database-"));
  const charts_directory = path.join(temporary_directory, "public", "charts");
  const chart_directory = path.join(charts_directory, "Collection", "Song");
  const client_database = path.join(temporary_directory, "catalog.sqlite");
  const background_previews_directory = path.join(temporary_directory, "chart-previews");
  const audio_previews_directory = path.join(temporary_directory, "audio-previews");

  try {
    await mkdir(chart_directory, { recursive: true });
    await writeFile(path.join(chart_directory, "song.ogg"), "audio");
    await writeFile(path.join(chart_directory, "background.png"), "background");
    await writeFile(path.join(chart_directory, "chart.osu"), `Mode:0
[General]
AudioFilename:song.ogg
[Events]
0,0,"background.png",0,0
[HitObjects]
256,192,1000,1,0,0:0:0:0:
`);

    const result = await cacheCharts({
      charts_directory,
      client_database,
      schema_directory: path.dirname(fileURLToPath(import.meta.url)),
      background_previews_directory,
      audio_previews_directory,
      ffmpeg_path: path.join(temporary_directory, "missing-ffmpeg"),
      generate_previews: false,
    });

    assert.equal(result.charts.length, 1);
    assert.match(result.charts[0]?.audio_preview_path ?? "", /^audio-previews\/[a-f0-9]{24}\.webm$/);
    assert.match(result.charts[0]?.background_preview_path ?? "", /^chart-previews\/[a-f0-9]{24}\.webp$/);
    await access(client_database);
    await assert.rejects(access(background_previews_directory));
    await assert.rejects(access(audio_previews_directory));
  } finally {
    await rm(temporary_directory, { recursive: true, force: true });
  }
});
