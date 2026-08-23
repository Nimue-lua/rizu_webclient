import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { cacheCharts, parseOsuMetadata } from "./chart-catalog.mjs";

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

test("caches chart collections as locations", async () => {
  const temporary_directory = await mkdtemp(path.join(os.tmpdir(), "rizu-catalog-"));
  const charts_directory = path.join(temporary_directory, "public", "charts");
  const chart_directory = path.join(charts_directory, "Collection One", "Chart One");
  const client_database = path.join(temporary_directory, "client.sqlite");
  const server_database = path.join(temporary_directory, "server.sqlite");

  try {
    await mkdir(chart_directory, { recursive: true });
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
      server_database,
      schema_directory: path.dirname(fileURLToPath(import.meta.url)),
    });

    assert.deepEqual(result.locations, [{
      id: 1,
      name: "Collection One",
      path: "charts/Collection One",
    }]);
    assert.equal(result.charts[0]?.location_id, 1);
    assert.equal(result.charts[0]?.chart_path, "charts/Collection One/Chart One/chart.osu");

    const client = new DatabaseSync(client_database, { readOnly: true });
    const server = new DatabaseSync(server_database, { readOnly: true });
    try {
      assert.deepEqual({ ...client.prepare("SELECT * FROM locations").get() }, {
        id: 1,
        name: "Collection One",
        path: "charts/Collection One",
      });
      assert.equal(client.prepare("SELECT location_id FROM charts").get()?.location_id, 1);
      assert.equal(server.prepare("SELECT chart_path FROM charts").get()?.chart_path, "charts/Collection One/Chart One/chart.osu");
    } finally {
      client.close();
      server.close();
    }
  } finally {
    await rm(temporary_directory, { recursive: true, force: true });
  }
});
