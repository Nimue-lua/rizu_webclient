import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { strToU8, zlibSync } from "fflate";
import { parseOsuChart } from "../../src/chart/format/osu/OsuParser.ts";
import { createManiaAutoplayReplay, createOsuAutoplayReplay } from "../../src/gameplay/AutoplayReplay.ts";
import { Subtimings } from "../../src/gameplay/timing/Subtimings.ts";
import { Timings } from "../../src/gameplay/timing/Timings.ts";
import { ManiaReplayBase } from "../../src/replay/mania/ManiaReplayBase.ts";
import { createOsuReplayBase } from "../../src/replay/osu/OsuReplayBase.ts";
import { ChartStore } from "./chart-store.ts";
import { createReplayValidator } from "./replay-verifier.ts";

function catalog(bytes: Uint8Array, mode: number, keys: number | null): { database: DatabaseSync; md5: string } {
  const md5 = createHash("md5").update(bytes).digest("hex");
  const database = new DatabaseSync(":memory:");
  database.exec(`CREATE TABLE songs (id TEXT PRIMARY KEY, title TEXT, artist TEXT);
    CREATE TABLE charts (chart_md5 TEXT, chart_index INTEGER, chart_path TEXT, difficulty REAL, speed REAL,
      dexterity REAL, stamina REAL, technical REAL, duration_seconds REAL, mode INTEGER, keys INTEGER,
      name TEXT, background_preview_path TEXT, song_id TEXT);
    INSERT INTO songs VALUES ('song', 'Song', 'Artist');`);
  database.prepare("INSERT INTO charts VALUES (?, 1, ?, 1, 1, 1, 1, 1, 1, ?, ?, 'Test', NULL, 'song')")
    .run(md5, `chart-files/v1/${md5}.osu`, mode, keys);
  return { database, md5 };
}

async function withStore(source: string, mode: number, keys: number | null,
  run: (store: ChartStore, md5: string, database: DatabaseSync, requests: () => number) => Promise<void>): Promise<void> {
  const bytes = strToU8(source);
  const { database, md5 } = catalog(bytes, mode, keys);
  const directory = await mkdtemp(path.join(os.tmpdir(), "rizu-chart-cache-"));
  let request_count = 0;
  const store = new ChartStore(database, { cache_directory: directory, asset_base_url: "https://assets.example/",
    request: async () => { request_count++; return new Response(bytes); } });
  try {
    await run(store, md5, database, () => request_count);
  } finally {
    database.close();
    await rm(directory, { recursive: true, force: true });
  }
}

test("downloads, verifies, and reuses content-addressed chart files", async () => {
  await withStore("osu file format v14\n[General]\nMode:3", 3, 4, async (store, md5, _database, requests) => {
    assert.deepEqual(await store.load(md5, 1), await store.load(md5, 1));
    assert.equal(requests(), 1);
    assert.equal(createHash("md5").update(await readFile(path.join((store as unknown as { options: { cache_directory: string } }).options.cache_directory,
      `${md5}.osu`))).digest("hex"), md5);
  });
});

test("rejects downloaded chart bytes with the wrong hash", async () => {
  const expected = strToU8("osu file format v14\n[General]\nMode:3");
  const { database, md5 } = catalog(expected, 3, 4);
  const directory = await mkdtemp(path.join(os.tmpdir(), "rizu-chart-cache-"));
  const store = new ChartStore(database, { cache_directory: directory, asset_base_url: "https://assets.example/",
    request: async () => new Response("changed") });
  await assert.rejects(store.load(md5, 1), /hash does not match/);
  database.close();
  await rm(directory, { recursive: true, force: true });
});

test("treats temporary chart download failures as retryable", async () => {
  const expected = strToU8("osu file format v14\n[General]\nMode:3");
  const { database, md5 } = catalog(expected, 3, 4);
  const directory = await mkdtemp(path.join(os.tmpdir(), "rizu-chart-cache-"));
  const store = new ChartStore(database, { cache_directory: directory, asset_base_url: "https://assets.example/",
    request: async () => new Response("unavailable", { status: 503 }) });
  await assert.rejects(store.load(md5, 1), (reason: unknown) => reason instanceof Error &&
    reason.constructor.name === "RetryableChartError");
  database.close();
  await rm(directory, { recursive: true, force: true });
});

test("recomputes mania accuracy and judges from replay input", async () => {
  const source = `osu file format v14\n[General]\nMode:3\n[Difficulty]\nCircleSize:4\nOverallDifficulty:5\n[HitObjects]\n64,192,1000,1,0,0:0:0:0:`;
  await withStore(source, 3, 4, async (store, md5) => {
    const chart = parseOsuChart(source);
    assert.equal(chart.mode, "mania");
    const replay_base = new ManiaReplayBase();
    replay_base.setTimingIdentity(new Timings("osuod", 5), new Subtimings("scorev", 2));
    const replay = createManiaAutoplayReplay(chart, false);
    const verified = await createReplayValidator(store)({ id: 1, chart_md5: md5, chart_index: 1, mode: "mania",
      replay: zlibSync(strToU8(JSON.stringify(replay))), replay_base: replay_base.exportReplayBase() });
    assert.equal(verified.score, 0);
    assert.equal(verified.accuracy, 1);
    assert.equal(verified.music_rate, 1);
    assert.equal(verified.judges?.perfect, 1);
  });
});

test("recomputes osu score and accuracy from replay input", async () => {
  const source = `osu file format v14\n[General]\nMode:0\n[Difficulty]\nCircleSize:5\nOverallDifficulty:5\nHPDrainRate:5\n[HitObjects]\n256,192,1000,1,0,0:0:0:0:`;
  await withStore(source, 0, null, async (store, md5) => {
    const chart = parseOsuChart(source);
    assert.equal(chart.mode, "osu");
    const replay = createOsuAutoplayReplay(chart);
    const verified = await createReplayValidator(store)({ id: 1, chart_md5: md5, chart_index: 1, mode: "osu",
      replay: zlibSync(strToU8(JSON.stringify(replay))), replay_base: createOsuReplayBase(1, 5) });
    assert.ok(verified.score > 0);
    assert.equal(verified.accuracy, 1);
    assert.equal(verified.judges?.["300"], 1);
  });
});

test("accepts negative lead-in and adjacent out-of-order osu events produced by the client", async () => {
  const source = `osu file format v14\n[General]\nMode:0\n[Difficulty]\nCircleSize:5\nOverallDifficulty:5\nHPDrainRate:5\n[HitObjects]\n256,192,1000,1,0,0:0:0:0:`;
  await withStore(source, 0, null, async (store, md5) => {
    const replay = {
      version: 1, mode: "osu", time_unit: "1/8192 second", judgment_events: [], input_events: [
        { type: "aim", time: -4090, x: 256 * 8192, y: 192 * 8192 },
        { type: "aim", time: 8193, x: 256 * 8192, y: 192 * 8192 },
        { type: "action", time: 8192, action: "primary", pressed: true },
        { type: "action", time: 8194, action: "primary", pressed: false },
      ],
    } as const;
    const verified = await createReplayValidator(store)({ id: 1, chart_md5: md5, chart_index: 1, mode: "osu",
      replay: zlibSync(strToU8(JSON.stringify(replay))), replay_base: createOsuReplayBase(1, 5) });
    assert.equal(verified.accuracy, 1);
  });
});

test("accepts client-supported negative AR and quantized gameplay-end timestamps", async () => {
  const source = `osu file format v14\n[General]\nMode:0\n[Difficulty]\nCircleSize:5\nOverallDifficulty:5\nHPDrainRate:5\n[HitObjects]\n256,192,1000,1,0,0:0:0:0:`;
  await withStore(source, 0, null, async (store, md5) => {
    const replay_base = { ...createOsuReplayBase(1, 5), approach_rate: -10 };
    const replay = { version: 1, mode: "osu", time_unit: "1/8192 second", judgment_events: [], input_events: [
      { type: "aim", time: Math.round(2.2 * 8192), x: 256 * 8192, y: 192 * 8192 },
    ] } as const;
    const verified = await createReplayValidator(store)({ id: 1, chart_md5: md5, chart_index: 1, mode: "osu",
      replay: zlibSync(strToU8(JSON.stringify(replay))), replay_base });
    assert.equal(verified.accuracy, 0);
  });
});

test("allows up to ten seconds of replay input after the last object", async () => {
  const source = `osu file format v14\n[General]\nMode:0\n[Difficulty]\nCircleSize:5\nOverallDifficulty:5\nHPDrainRate:5\n[HitObjects]\n256,192,1000,1,0,0:0:0:0:`;
  await withStore(source, 0, null, async (store, md5) => {
    const replay = { version: 1, mode: "osu", time_unit: "1/8192 second", judgment_events: [], input_events: [
      { type: "aim", time: Math.round(10.9 * 8192), x: 256 * 8192, y: 192 * 8192 },
    ] } as const;
    const verified = await createReplayValidator(store)({ id: 1, chart_md5: md5, chart_index: 1, mode: "osu",
      replay: zlibSync(strToU8(JSON.stringify(replay))), replay_base: createOsuReplayBase(1, 5) });
    assert.equal(verified.accuracy, 0);
  });
});

test("rejects osu input more than ten seconds after the last object", async () => {
  const source = `osu file format v14\n[General]\nMode:0\n[Difficulty]\nCircleSize:5\nOverallDifficulty:5\nHPDrainRate:5\n[HitObjects]\n256,192,1000,1,0,0:0:0:0:`;
  await withStore(source, 0, null, async (store, md5) => {
    const replay = { version: 1, mode: "osu", time_unit: "1/8192 second", judgment_events: [], input_events: [
      { type: "aim", time: Math.round(11.1 * 8192), x: 256 * 8192, y: 192 * 8192 },
    ] } as const;
    await assert.rejects(createReplayValidator(store)({ id: 1, chart_md5: md5, chart_index: 1, mode: "osu",
      replay: zlibSync(strToU8(JSON.stringify(replay))), replay_base: createOsuReplayBase(1, 5) }),
    /Replay continues after gameplay ends/);
  });
});
