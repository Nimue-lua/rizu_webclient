import assert from "node:assert/strict";
import test from "node:test";
import type { Library } from "../src/library/Library";
import type { ChartfileSetView, Chartview, LibraryView } from "../src/library/views";
import { ChartSelector } from "../src/select/ChartSelector";

function chart(id: string, difficulty: number, duration_seconds: number, location_id = 1, mode = 3, keys = 4): Chartview {
  return {
    audio_url: "",
    background_url: null,
    bpm_avg: 120,
    bpm_max: 120,
    bpm_min: 120,
    chart_url: "",
    chart_md5: id.padEnd(32, "0"),
    chart_index: 1,
    creator: `Creator ${id}`,
    difficulty,
    duration_seconds,
    format: "osu",
    id,
    keys,
    location_id,
    long_note_ratio: 0,
    mode,
    name: `Chart ${id}`,
    note_count: 100,
  };
}

const songs: ChartfileSetView[] = [
  { id: "zeta", title: "Zeta", artist: "Alpha", charts: [chart("zeta-easy", 2, 180), chart("zeta-hard", 7, 120, 1, 3, 7)] },
  { id: "alpha", title: "Alpha", artist: "Zulu", charts: [chart("alpha-only", 4, 90, 2), chart("alpha-osu", 3, 60, 1, 0)] },
];

function selectorFor(library: LibraryView = { locations: [{ id: 1, name: "Local" }, { id: 2, name: "Online" }], songs }): ChartSelector {
  const source: Library = { load: async () => library };
  return new ChartSelector(source);
}

async function loadedSelector(): Promise<ChartSelector> {
  const selector = selectorFor();
  await selector.load(new AbortController().signal);
  return selector;
}

test("sorts title and artist modes as chart sets", async () => {
  const selector = await loadedSelector();
  assert.deepEqual(selector.getSelectionEntries().map((entry) => [entry.song.id, entry.chart]), [
    ["alpha", null],
    ["zeta", null],
  ]);

  selector.setSortMode("artist");
  assert.deepEqual(selector.getSelectionEntries().map((entry) => [entry.song.id, entry.chart]), [
    ["zeta", null],
    ["alpha", null],
  ]);
});

test("sorts difficulty and duration modes as individual charts", async () => {
  const selector = await loadedSelector();
  selector.setSortMode("difficulty");
  assert.deepEqual(selector.getSelectionEntries().map((entry) => entry.chart?.id), [
    "zeta-easy",
    "alpha-osu",
    "alpha-only",
    "zeta-hard",
  ]);

  selector.setSortMode("duration");
  assert.deepEqual(selector.getSelectionEntries().map((entry) => entry.chart?.id), [
    "alpha-osu",
    "alpha-only",
    "zeta-hard",
    "zeta-easy",
  ]);
});

test("selects and navigates exact sibling charts in chart modes", async () => {
  const selector = await loadedSelector();
  selector.setSortMode("difficulty");
  const entries = selector.getSelectionEntries();
  selector.selectEntry(entries[0]!);
  assert.equal(selector.getSelectedChart()?.id, "zeta-easy");

  selector.scrollLevel(3);
  assert.equal(selector.getSelectedChart()?.id, "zeta-hard");
  assert.equal(selector.getSelectedSong()?.charts.length, 2);
});

test("selects a chart by its portable catalog identity", async () => {
  const selector = await loadedSelector();
  const target = songs[0]!.charts[0]!;

  assert.equal(selector.selectChartIdentity(target.chart_md5.toUpperCase(), target.chart_index), true);
  assert.equal(selector.getSelectedSong()?.id, "zeta");
  assert.equal(selector.getSelectedChart()?.id, "zeta-easy");
  assert.equal(selector.selectChartIdentity("ffffffffffffffffffffffffffffffff", 1), false);
  assert.equal(selector.getSelectedChart()?.id, "zeta-easy");
});

test("applies chart filters before flattening", async () => {
  const selector = await loadedSelector();
  selector.setSortMode("difficulty");
  selector.selectLocation(1);
  selector.selectMode(3);
  assert.deepEqual(selector.getSelectionEntries().map((entry) => entry.chart?.id), [
    "zeta-easy",
    "zeta-hard",
  ]);
});

test("filters mania charts by exact key count", async () => {
  const selector = await loadedSelector();
  selector.setSortMode("difficulty");

  selector.setQuery("keys=7");
  assert.deepEqual(selector.getSelectionEntries().map((entry) => entry.chart?.id), ["zeta-hard"]);

  selector.setQuery("KEY=4");
  assert.deepEqual(selector.getSelectionEntries().map((entry) => entry.chart?.id), [
    "zeta-easy",
    "alpha-only",
  ]);
});

test("combines key filters with text search and excludes non-mania charts", async () => {
  const selector = await loadedSelector();
  selector.setSortMode("difficulty");

  selector.setQuery("Zeta key=4");
  assert.deepEqual(selector.getSelectionEntries().map((entry) => entry.chart?.id), ["zeta-easy"]);

  selector.setQuery("key=4 Chart alpha-osu");
  assert.deepEqual(selector.getSelectionEntries(), []);
});

test("supports numeric comparison operators and native aliases", async () => {
  const selector = await loadedSelector();
  selector.setSortMode("difficulty");

  const cases: [string, string[]][] = [
    ["difficulty>3", ["alpha-only", "zeta-hard"]],
    ["diff<=3", ["zeta-easy", "alpha-osu"]],
    ["d!=4", ["zeta-easy", "alpha-osu", "zeta-hard"]],
    ["d~=2", ["alpha-osu", "alpha-only", "zeta-hard"]],
    ["length<2m", ["alpha-osu", "alpha-only"]],
    ["dur>=120", ["zeta-easy", "zeta-hard"]],
    ["keys>4", ["zeta-hard"]],
    ["key!=4", ["zeta-hard"]],
  ];
  for (const [query, expected] of cases) {
    selector.setQuery(query);
    assert.deepEqual(selector.getSelectionEntries().map((entry) => entry.chart?.id), expected, query);
  }
});

test("ANDs filters and separate text terms", async () => {
  const selector = await loadedSelector();
  selector.setSortMode("difficulty");

  selector.setQuery("zeta hard d>=7 duration<=2m keys=7");
  assert.deepEqual(selector.getSelectionEntries().map((entry) => entry.chart?.id), ["zeta-hard"]);

  selector.setQuery("zeta alpha");
  assert.deepEqual(selector.getSelectionEntries().map((entry) => entry.chart?.id), ["zeta-easy", "zeta-hard"]);
});

test("ignores unknown and invalid filter expressions like native search", async () => {
  const selector = await loadedSelector();
  selector.setQuery("unknown=5 difficulty=hard length=1.5m");
  assert.deepEqual(selector.getFilteredSongs().map((song) => song.id), ["zeta", "alpha"]);
});
