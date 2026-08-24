import assert from "node:assert/strict";
import test from "node:test";
import type { Library } from "../src/library/Library";
import type { ChartfileSetView, Chartview, LibraryView } from "../src/library/views";
import { ChartSelector } from "../src/select/ChartSelector";

function chart(id: string, difficulty: number, duration_seconds: number, location_id = 1, mode = 3): Chartview {
  return {
    audio_preview_url: "",
    audio_url: "",
    background_url: null,
    bpm_avg: 120,
    bpm_max: 120,
    bpm_min: 120,
    chart_url: "",
    creator: `Creator ${id}`,
    difficulty,
    duration_seconds,
    format: "osu",
    id,
    keys: 4,
    location_id,
    long_note_ratio: 0,
    mode,
    name: `Chart ${id}`,
    note_count: 100,
  };
}

const songs: ChartfileSetView[] = [
  { id: "zeta", title: "Zeta", artist: "Alpha", charts: [chart("zeta-easy", 2, 180), chart("zeta-hard", 7, 120)] },
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
