import type { Library } from "../library/Library";
import type { ChartfileSetView, Chartview, LibraryView, Location } from "../library/views";
import type { PreviewClient } from "../preview/PreviewClient";

export interface ChartSelectorSnapshot {
  locations: readonly Location[];
  songs: readonly ChartfileSetView[];
  selected_location_id: number | null;
  selected_song_id: string | null;
  selected_chart_id: string | null;
  selected_mode: number | null;
  query: string;
  error: string | null;
}

type Listener = () => void;

export class ChartSelector {
  private readonly library: Library;
  private readonly listeners = new Set<Listener>();
  private preview_client: PreviewClient | null = null;
  private preview_timer: number | null = null;
  private snapshot: ChartSelectorSnapshot = {
    locations: [],
    songs: [],
    selected_location_id: null,
    selected_song_id: null,
    selected_chart_id: null,
    selected_mode: null,
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

  async load(signal: AbortSignal): Promise<void> {
    try {
      const library = await this.library.load(signal);
      if (signal.aborted) return;
      this.applyLibrary(library);
    } catch (reason) {
      if (!signal.aborted) this.update({ error: reason instanceof Error ? reason.message : "Failed to load song catalog" });
    }
  }

  setPreviewClient(preview_client: PreviewClient | null): void {
    this.preview_client = preview_client;
    if (preview_client && this.snapshot.selected_chart_id) this.schedulePreview(this.snapshot.selected_chart_id);
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

  selectSong(song_id: string): void {
    const song = this.getSongs().find((candidate) => candidate.id === song_id);
    if (!song) return;
    this.update({ selected_song_id: song.id });
    this.selectChart(song.charts.at(-1)?.id ?? null);
  }

  selectChart(chart_id: string | null): void {
    if (chart_id === this.snapshot.selected_chart_id) return;
    this.update({ selected_chart_id: chart_id });
    if (chart_id) this.schedulePreview(chart_id);
  }

  scrollLevel(direction: number): void {
    const songs = this.getFilteredSongs();
    if (!songs.length) return;
    const index = songs.findIndex((song) => song.id === this.snapshot.selected_song_id);
    const next_index = Math.min(Math.max((index < 0 ? 0 : index) + direction, 0), songs.length - 1);
    const song = songs[next_index];
    if (song) this.selectSong(song.id);
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
    const query = this.snapshot.query.trim().toLocaleLowerCase();
    if (!query) return songs;
    return songs.filter((song) => `${song.title}\n${song.artist}\n${song.charts.map((chart) => `${chart.name} ${chart.creator}`).join("\n")}`.toLocaleLowerCase().includes(query));
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
    if (this.preview_timer !== null) window.clearTimeout(this.preview_timer);
    this.listeners.clear();
    this.preview_client = null;
  }

  private applyLibrary(library: LibraryView): void {
    this.update({ locations: library.locations, songs: library.songs, error: null });
    this.ensureSelection();
  }

  private ensureSelection(force_first = false): void {
    const songs = this.getFilteredSongs();
    const current = force_first ? undefined : songs.find((song) => song.id === this.snapshot.selected_song_id);
    const song = current ?? songs[0];
    const chart = song?.charts.find((candidate) => candidate.id === this.snapshot.selected_chart_id) ?? song?.charts.at(-1);
    this.update({ selected_song_id: song?.id ?? null, selected_chart_id: chart?.id ?? null });
    if (chart) this.schedulePreview(chart.id);
  }

  private schedulePreview(chart_id: string): void {
    if (this.preview_timer !== null) window.clearTimeout(this.preview_timer);
    this.preview_timer = window.setTimeout(() => {
      this.preview_client?.select({ chart_id });
      this.preview_timer = null;
    }, 200);
  }

  private update(change: Partial<ChartSelectorSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...change };
    for (const listener of this.listeners) listener();
  }
}
