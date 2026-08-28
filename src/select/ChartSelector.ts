import type { Library } from "../library/Library";
import type { ChartfileSetView, Chartview, LibraryView, Location } from "../library/views";

export type ChartSortMode = "title" | "artist" | "difficulty" | "duration";

export interface ChartSelectionEntry {
  chart: Chartview | null;
  key: string;
  song: ChartfileSetView;
}

export interface ChartSelectorSnapshot {
  locations: readonly Location[];
  songs: readonly ChartfileSetView[];
  selected_location_id: number | null;
  selected_song_id: string | null;
  selected_chart_id: string | null;
  selected_mode: number | null;
  sort_mode: ChartSortMode;
  query: string;
  error: string | null;
}

type Listener = () => void;

type NumericFilter = {
  field: "difficulty" | "duration" | "keys";
  operator: "=" | "!=" | "<" | ">" | "<=" | ">=";
  value: number;
};

const numeric_filter_fields: Record<string, NumericFilter["field"]> = {
  d: "difficulty",
  diff: "difficulty",
  difficulty: "difficulty",
  dur: "duration",
  duration: "duration",
  l: "duration",
  len: "duration",
  length: "duration",
  key: "keys",
  keys: "keys",
};

function matchesNumericFilter(value: number, filter: NumericFilter): boolean {
  switch (filter.operator) {
    case "=": return value === filter.value;
    case "!=": return value !== filter.value;
    case "<": return value < filter.value;
    case ">": return value > filter.value;
    case "<=": return value <= filter.value;
    case ">=": return value >= filter.value;
  }
}

export class ChartSelector {
  private readonly library: Library;
  private readonly listeners = new Set<Listener>();
  private loaded = false;
  private snapshot: ChartSelectorSnapshot = {
    locations: [],
    songs: [],
    selected_location_id: null,
    selected_song_id: null,
    selected_chart_id: null,
    selected_mode: null,
    sort_mode: "title",
    query: "",
    error: null,
  };

  constructor(library: Library) {
    this.library = library;
  }

  getSnapshot = (): ChartSelectorSnapshot => this.snapshot;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  async load(signal: AbortSignal, force = false): Promise<void> {
    if (this.loaded && !force) return;
    try {
      const library = await this.library.load(signal);
      if (signal.aborted) return;
      this.applyLibrary(library);
      this.loaded = true;
    } catch (reason) {
      if (!signal.aborted) this.update({ error: reason instanceof Error ? reason.message : "Failed to load song catalog" });
    }
  }

  setQuery(query: string): void {
    this.update({ query });
    this.ensureSelection();
  }

  selectLocation(location_id: number | null): void {
    this.update({ selected_location_id: location_id, query: "" });
    this.ensureSelection(true);
  }

  selectMode(mode: number | null): void {
    this.update({ selected_mode: mode });
    this.ensureSelection();
  }

  setSortMode(sort_mode: ChartSortMode): void {
    this.update({ sort_mode });
    this.ensureSelection();
  }

  selectSong(song_id: string): void {
    const song = this.getSongs().find((candidate) => candidate.id === song_id);
    if (!song) return;
    this.update({ selected_song_id: song.id });
    this.selectChart(song.charts.at(-1)?.id ?? null);
  }

  selectChart(chart_id: string | null): void {
    if (chart_id === this.snapshot.selected_chart_id) return;
    this.update({ selected_chart_id: chart_id });
  }

  selectEntry(entry: ChartSelectionEntry): void {
    if (entry.chart) {
      this.update({ selected_song_id: entry.song.id, selected_chart_id: entry.chart.id });
      return;
    }
    this.selectSong(entry.song.id);
  }

  scrollLevel(direction: number): void {
    const entries = this.getSelectionEntries();
    if (!entries.length) return;
    const index = entries.findIndex((entry) => this.isEntrySelected(entry));
    const next_index = Math.min(Math.max((index < 0 ? 0 : index) + direction, 0), entries.length - 1);
    const entry = entries[next_index];
    if (entry) this.selectEntry(entry);
  }

  getSongs(): ChartfileSetView[] {
    const { selected_location_id, selected_mode, songs } = this.snapshot;
    return songs.flatMap((song) => {
      const charts = song.charts.filter((chart) =>
        (selected_location_id === null || chart.location_id === selected_location_id) &&
        (selected_mode === null || chart.mode === selected_mode)
      );
      return charts.length ? [{ ...song, charts }] : [];
    });
  }

  getFilteredSongs(): ChartfileSetView[] {
    const songs = this.getSongs();
    const filters: NumericFilter[] = [];
    const terms: string[] = [];
    for (const token of this.snapshot.query.trim().split(/\s+/)) {
      if (!token) continue;
      const expression = token.match(/^(.+?)(~=|!=|>=|<=|=|>|<)(.+)$/);
      if (!expression) {
        terms.push(token.toLocaleLowerCase());
        continue;
      }

      const [, raw_field, raw_operator, raw_value] = expression;
      const field = numeric_filter_fields[raw_field.toLocaleLowerCase()];
      if (!field) continue;
      const duration_minutes = field === "duration" ? raw_value.match(/^(\d+)m$/) : null;
      const value = duration_minutes ? Number(duration_minutes[1]) * 60 : Number(raw_value);
      if (!Number.isFinite(value)) continue;
      filters.push({ field, operator: raw_operator === "~=" ? "!=" : raw_operator as NumericFilter["operator"], value });
    }
    if (!terms.length && !filters.length) return songs;

    return songs.flatMap((song) => {
      const song_text = `${song.title}\n${song.artist}`.toLocaleLowerCase();
      const charts = song.charts.filter((chart) => {
        const matches_filters = filters.every((filter) => {
          if (filter.field === "keys") return chart.mode === 3 && chart.keys !== null && matchesNumericFilter(chart.keys, filter);
          return matchesNumericFilter(filter.field === "duration" ? chart.duration_seconds : chart.difficulty, filter);
        });
        const chart_text = `${chart.name}\n${chart.creator}`.toLocaleLowerCase();
        return matches_filters && terms.every((term) => song_text.includes(term) || chart_text.includes(term));
      });
      if (!charts.length) return [];
      return [{ ...song, charts }];
    });
  }

  getSelectionEntries(): ChartSelectionEntry[] {
    const songs = this.getFilteredSongs();
    const { sort_mode } = this.snapshot;
    if (sort_mode === "title" || sort_mode === "artist") {
      return [...songs]
        .sort((left, right) => this.compareSongs(left, right, sort_mode))
        .map((song) => ({ chart: null, key: `song:${song.id}`, song }));
    }

    return songs
      .flatMap((song) => song.charts.map((chart) => ({ chart, key: `chart:${chart.id}`, song })))
      .sort((left, right) => {
        const difference = sort_mode === "difficulty"
          ? left.chart.difficulty - right.chart.difficulty
          : left.chart.duration_seconds - right.chart.duration_seconds;
        return difference || this.compareSongs(left.song, right.song, "title") ||
          left.chart.name.localeCompare(right.chart.name, undefined, { sensitivity: "base" }) ||
          left.chart.id.localeCompare(right.chart.id);
      });
  }

  isEntrySelected(entry: ChartSelectionEntry): boolean {
    return entry.song.id === this.snapshot.selected_song_id &&
      (entry.chart === null || entry.chart.id === this.snapshot.selected_chart_id);
  }

  getSelectedSong(): ChartfileSetView | undefined {
    const songs = this.getFilteredSongs();
    return songs.find((song) => song.id === this.snapshot.selected_song_id) ?? songs[0];
  }

  getSelectedChart(): Chartview | undefined {
    const song = this.getSelectedSong();
    return song?.charts.find((chart) => chart.id === this.snapshot.selected_chart_id) ?? song?.charts.at(-1);
  }

  destroy(): void {
    this.listeners.clear();
  }

  private applyLibrary(library: LibraryView): void {
    this.update({ locations: library.locations, songs: library.songs, error: null });
    this.ensureSelection();
  }

  private ensureSelection(force_first = false): void {
    const entries = this.getSelectionEntries();
    const current = force_first ? undefined : entries.find((entry) => this.isEntrySelected(entry));
    const entry = current ?? entries[0];
    const chart = entry?.chart ?? entry?.song.charts.find((candidate) => candidate.id === this.snapshot.selected_chart_id) ?? entry?.song.charts.at(-1);
    this.update({ selected_song_id: entry?.song.id ?? null, selected_chart_id: chart?.id ?? null });
  }

  private compareSongs(left: ChartfileSetView, right: ChartfileSetView, sort_mode: "title" | "artist"): number {
    const primary = sort_mode === "title" ? "title" : "artist";
    const secondary = sort_mode === "title" ? "artist" : "title";
    return left[primary].localeCompare(right[primary], undefined, { sensitivity: "base" }) ||
      left[secondary].localeCompare(right[secondary], undefined, { sensitivity: "base" }) ||
      left.id.localeCompare(right.id);
  }

  private update(change: Partial<ChartSelectorSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...change };
    for (const listener of this.listeners) listener();
  }
}
