import assert from "node:assert/strict";
import test from "node:test";
import { parseOsuMetadata } from "./chart-catalog.mjs";

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
[Events]
0,0,"background.jpg",0,0
`, "folder", "chart.osu");

  assert.equal(metadata.song_id, "123");
  assert.equal(metadata.chart_id, "456");
  assert.equal(metadata.preview_seconds, 12.5);
  assert.equal(metadata.audio_file, "song.ogg");
  assert.equal(metadata.background_file, "background.jpg");
  assert.equal(metadata.keys, 7);
});

test("rejects asset paths outside a chart folder", () => {
  const metadata = parseOsuMetadata("AudioFilename: ../song.ogg\nMode: 3\nCircleSize:4", "folder", "chart.osu");
  assert.equal(metadata.audio_file, null);
});
