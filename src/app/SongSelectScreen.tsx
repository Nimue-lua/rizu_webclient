import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { inputLayout, loadInputBindings } from "../gameplay/InputBindings";
import type { Chartview } from "../library/views";
import type { ChartSelectionEntry, ChartSelector, ChartSortMode } from "../select/ChartSelector";
import { InputBindingsModal } from "./InputBindingsModal";
import { GameplayModifiersModal } from "./GameplayModifiersModal";
import { GamemodeFiltersModal } from "./GamemodeFiltersModal";
import { noteSkinMode, type NoteSkinOption, type NoteSkinSelections } from "../gameplay/renderer/NoteSkinSelection";
import { NoteSkinsModal } from "./NoteSkinsModal";
import { ChartBrowser } from "./song-select/ChartBrowser";
import { LibraryToolbar } from "./song-select/LibraryToolbar";
import { SelectedSongPanel } from "./song-select/SelectedSongPanel";
import { SongSelectFooter } from "./song-select/SongSelectFooter";
import { SongSelectHeader } from "./song-select/SongSelectHeader";

const ROW_HEIGHT = 82;
const OVERSCAN = 5;
const BACKGROUND_DEBOUNCE_MS = 200;
const AUDIO_PREVIEW_DEBOUNCE_MS = 200;
const SESSION_STARTED_AT = Date.now();

interface SongSelectScreenProps {
  chart_selector: ChartSelector;
  onPlay: (chart: Chartview, input_bindings: readonly (string | null)[], song: { title: string; artist: string }) => void;
  onSettings: () => void;
  master_volume: number;
  music_rate: number;
  constant_scroll: boolean;
  tap_only: boolean;
  note_skin_selections: NoteSkinSelections;
  available_note_skins: readonly NoteSkinOption[];
  onMusicRateChange: (music_rate: number) => void;
  onConstantScrollChange: (constant_scroll: boolean) => void;
  onTapOnlyChange: (tap_only: boolean) => void;
  onNoteSkinSelectionChange: (key: string, skin_id: string | undefined) => void;
  onNoteSkinImport: (file: File) => Promise<{ options: readonly NoteSkinOption[]; persisted: boolean }>;
}

function formatSessionDuration(duration_seconds: number): string {
  const hours = Math.floor(duration_seconds / 3600);
  const minutes = Math.floor((duration_seconds % 3600) / 60);
  const seconds = duration_seconds % 60;
  return [hours, minutes, seconds].map((value) => String(value).padStart(2, "0")).join(":");
}

export function SongSelectScreen({
  chart_selector,
  onPlay,
  onSettings,
  master_volume,
  music_rate,
  constant_scroll,
  tap_only,
  note_skin_selections,
  available_note_skins,
  onMusicRateChange,
  onConstantScrollChange,
  onTapOnlyChange,
  onNoteSkinSelectionChange,
  onNoteSkinImport,
}: SongSelectScreenProps) {
  const viewport_ref = useRef<HTMLDivElement>(null);
  const difficulty_strip_ref = useRef<HTMLDivElement>(null);
  const selected_difficulty_ref = useRef<HTMLButtonElement>(null);
  const restored_song_scroll_ref = useRef(false);
  const audio_ref = useRef<HTMLAudioElement>(null);
  const preview_unlocked_ref = useRef(false);
  const last_preview_change_ref = useRef<number | null>(null);
  const selection = useSyncExternalStore(chart_selector.subscribe, chart_selector.getSnapshot);
  const [scroll_top, setScrollTop] = useState(0);
  const [viewport_height, setViewportHeight] = useState(0);
  const [now, setNow] = useState(() => new Date());
  const [background_url, setBackgroundUrl] = useState<string | null>(null);
  const [loaded_background_url, setLoadedBackgroundUrl] = useState<string | null>(null);
  const [input_bindings_open, setInputBindingsOpen] = useState(false);
  const [modifiers_open, setModifiersOpen] = useState(false);
  const [filters_open, setFiltersOpen] = useState(false);
  const [skins_open, setSkinsOpen] = useState(false);

  useEffect(() => {
    const resizeUi = () => {
      const scale = window.innerHeight / 1080;
      document.documentElement.style.setProperty("--ui-scale", String(scale));
      document.documentElement.style.setProperty("--logical-width", `${window.innerWidth / scale}px`);
    };

    window.addEventListener("resize", resizeUi);
    resizeUi();
    return () => window.removeEventListener("resize", resizeUi);
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const abort_controller = new AbortController();
    void chart_selector.load(abort_controller.signal);
    return () => abort_controller.abort();
  }, [chart_selector]);

  useEffect(() => {
    const viewport = viewport_ref.current;
    if (!viewport) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setViewportHeight(entry.contentRect.height);
    });
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);

  const selection_entries = chart_selector.getSelectionEntries();
  const selected_song = chart_selector.getSelectedSong();
  const selected_chart = chart_selector.getSelectedChart();
  const chart_level_sort = selection.sort_mode === "difficulty" || selection.sort_mode === "duration";

  useEffect(() => {
    if (restored_song_scroll_ref.current) return;
    const viewport = viewport_ref.current;
    const selected_index = selection_entries.findIndex((entry) => chart_selector.isEntrySelected(entry));
    if (!viewport || selected_index < 0 || viewport.clientHeight === 0) return;
    const centered_scroll_top = Math.max(0, selected_index * ROW_HEIGHT + ROW_HEIGHT / 2 - viewport.clientHeight / 2);
    viewport.scrollTop = centered_scroll_top;
    setScrollTop(centered_scroll_top);
    restored_song_scroll_ref.current = true;
  }, [selection_entries.length, selection.selected_chart_id, selection.selected_song_id, selection.sort_mode, viewport_height]);

  useEffect(() => {
    if (selection.sort_mode !== "difficulty" && selection.sort_mode !== "duration") return;
    const viewport = viewport_ref.current;
    const selected_index = selection_entries.findIndex((entry) => chart_selector.isEntrySelected(entry));
    if (!viewport || selected_index < 0) return;
    const row_top = selected_index * ROW_HEIGHT;
    let next_scroll_top = viewport.scrollTop;
    if (row_top < viewport.scrollTop) next_scroll_top = row_top;
    else if (row_top + ROW_HEIGHT > viewport.scrollTop + viewport.clientHeight) next_scroll_top = row_top + ROW_HEIGHT - viewport.clientHeight;
    if (next_scroll_top === viewport.scrollTop) return;
    viewport.scrollTop = next_scroll_top;
    setScrollTop(next_scroll_top);
  }, [selection.selected_chart_id, selection.sort_mode, selection_entries.length]);

  useEffect(() => {
    const strip = difficulty_strip_ref.current;
    const button = selected_difficulty_ref.current;
    if (!strip || !button) return;
    const strip_bounds = strip.getBoundingClientRect();
    const button_bounds = button.getBoundingClientRect();
    const center_offset = button_bounds.left + button_bounds.width / 2 - (strip_bounds.left + strip_bounds.width / 2);
    strip.scrollTo({ left: strip.scrollLeft + center_offset, behavior: "smooth" });
  }, [selected_chart?.id]);

  useLayoutEffect(() => {
    setLoadedBackgroundUrl(null);
    const timer = window.setTimeout(() => {
      setBackgroundUrl(selected_chart?.background_url ?? null);
    }, BACKGROUND_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [selected_chart?.background_url]);

  useEffect(() => {
    const audio = audio_ref.current;
    if (audio) audio.volume = master_volume;
  }, [master_volume]);

  useEffect(() => {
    const audio = audio_ref.current;
    if (!audio) return;
    const now = performance.now();
    const previous_change = last_preview_change_ref.current;
    last_preview_change_ref.current = now;
    const switchPreview = () => {
      const preview_url = selected_chart?.audio_preview_url ?? "";
      audio.pause();
      audio.src = preview_url;
      if (preview_unlocked_ref.current && preview_url) {
        void audio.play().catch(() => undefined);
      }
    };
    if (previous_change === null || now - previous_change >= AUDIO_PREVIEW_DEBOUNCE_MS) {
      switchPreview();
      return;
    }
    const timer = window.setTimeout(switchPreview, AUDIO_PREVIEW_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [selected_chart?.audio_preview_url]);

  const first_index = Math.max(0, Math.floor(scroll_top / ROW_HEIGHT) - OVERSCAN);
  const visible_count = Math.ceil(viewport_height / ROW_HEIGHT) + OVERSCAN * 2;
  const visible_entries = selection_entries.slice(first_index, first_index + visible_count);

  const selectEntry = (entry: ChartSelectionEntry) => {
    chart_selector.selectEntry(entry);
  };

  const selectLocation = (location_id: number | null) => {
    chart_selector.selectLocation(location_id);
    setScrollTop(0);
    if (viewport_ref.current) viewport_ref.current.scrollTop = 0;
  };

  const selectMode = (mode: number | null) => {
    chart_selector.selectMode(mode);
    setScrollTop(0);
    if (viewport_ref.current) viewport_ref.current.scrollTop = 0;
  };

  const selectSortMode = (sort_mode: ChartSortMode) => {
    chart_selector.setSortMode(sort_mode);
    setScrollTop(0);
    if (viewport_ref.current) viewport_ref.current.scrollTop = 0;
  };

  const moveSelection = (offset: number) => {
    if (!selection_entries.length) return;
    const selected_index = selection_entries.findIndex((entry) => chart_selector.isEntrySelected(entry));
    const next_index = Math.min(Math.max((selected_index < 0 ? 0 : selected_index) + offset, 0), selection_entries.length - 1);
    if (!selection_entries[next_index]) return;
    chart_selector.scrollLevel(offset);
    const viewport = viewport_ref.current;
    if (!viewport) return;
    const row_top = next_index * ROW_HEIGHT;
    if (row_top < viewport.scrollTop) viewport.scrollTop = row_top;
    else if (row_top + ROW_HEIGHT > viewport.scrollTop + viewport.clientHeight) viewport.scrollTop = row_top + ROW_HEIGHT - viewport.clientHeight;
  };

  const selectDifficulty = (offset: -1 | 1) => {
    if (!selected_song?.charts.length) return;
    const selected_index = selected_song.charts.findIndex((chart) => chart.id === selected_chart?.id);
    const next_chart = selected_song.charts[Math.min(Math.max(selected_index + offset, 0), selected_song.charts.length - 1)];
    if (next_chart) chart_selector.selectChart(next_chart.id);
  };

  const date_text = new Intl.DateTimeFormat("en-GB", {
    day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(now).replace(",", "");
  const session_duration = formatSessionDuration(Math.floor((now.getTime() - SESSION_STARTED_AT) / 1_000));
  const hero_loaded = background_url === null || background_url === loaded_background_url;
  const unlockPreview = () => {
    if (preview_unlocked_ref.current) return;
    preview_unlocked_ref.current = true;
    const audio = audio_ref.current;
    if (!audio || !selected_chart?.audio_preview_url) return;
    audio.src = selected_chart.audio_preview_url;
    void audio.play().catch(() => undefined);
  };
  const playChart = (chart: Chartview, song = selected_song) => {
    audio_ref.current?.pause();
    onPlay(chart, loadInputBindings(inputLayout(chart)), {
      title: song?.title ?? "Unknown title",
      artist: song?.artist ?? "Unknown artist",
    });
  };
  return (
    <main className="song-select-screen" onPointerDownCapture={unlockPreview} onKeyDownCapture={unlockPreview}>
      <audio ref={audio_ref} preload="auto" />
      <SongSelectHeader date_text={date_text} session_duration={session_duration} onSettings={onSettings} />
      <LibraryToolbar selection={selection} onLocationChange={selectLocation} onOpenFilters={() => setFiltersOpen(true)}
        onQueryChange={(query) => { chart_selector.setQuery(query); setScrollTop(0); if (viewport_ref.current) viewport_ref.current.scrollTop = 0; }}
        onSortChange={selectSortMode} />

      <section className="song-select-content">
        <SelectedSongPanel background_url={background_url} background_loaded={hero_loaded} selected_chart={selected_chart}
          selected_song={selected_song} onBackgroundLoaded={() => setLoadedBackgroundUrl(background_url)} />
        <ChartBrowser chart_level_sort={chart_level_sort} difficulty_strip_ref={difficulty_strip_ref} error={selection.error}
          first_index={first_index} query={selection.query} selected_chart={selected_chart} selected_difficulty_ref={selected_difficulty_ref}
          selected_song={selected_song} selection_entries={selection_entries} sort_mode={selection.sort_mode} viewport_ref={viewport_ref}
          visible_entries={visible_entries} onChartSelect={(chart_id) => chart_selector.selectChart(chart_id)}
          onEntryPlay={(entry) => { const chart = entry.chart ?? entry.song.charts.at(-1); if (chart) playChart(chart, entry.song); }}
          onEntrySelect={selectEntry} onKeyDown={(event) => {
            if (event.key === "ArrowUp" || event.key === "ArrowDown") { event.preventDefault(); moveSelection(event.key === "ArrowUp" ? -1 : 1); }
            if (event.key === "Enter" && selected_chart) playChart(selected_chart);
          }} onMoveDifficulty={selectDifficulty} onScroll={setScrollTop} isEntrySelected={(entry) => chart_selector.isEntrySelected(entry)} />
      </section>

      <SongSelectFooter constant_scroll={constant_scroll} music_rate={music_rate} selected_chart_available={Boolean(selected_chart)} tap_only={tap_only}
        onMusicRateChange={onMusicRateChange} onOpenInputs={() => setInputBindingsOpen(true)} onOpenModifiers={() => setModifiersOpen(true)}
        onOpenSkins={() => setSkinsOpen(true)} onPlay={() => selected_chart && playChart(selected_chart)} />
      {input_bindings_open && selected_chart && <InputBindingsModal chart={selected_chart} onExit={() => setInputBindingsOpen(false)} />}
      {modifiers_open && <GameplayModifiersModal constant_scroll={constant_scroll} tap_only={tap_only} onConstantScrollChange={onConstantScrollChange} onTapOnlyChange={onTapOnlyChange} onExit={() => setModifiersOpen(false)} />}
      {filters_open && <GamemodeFiltersModal selected_mode={selection.selected_mode} onModeChange={selectMode} onExit={() => setFiltersOpen(false)} />}
      {skins_open && <NoteSkinsModal selections={note_skin_selections} options={available_note_skins} selected_mode={selected_chart ? noteSkinMode(selected_chart.mode) : null} selected_column_count={selected_chart?.mode === 3 ? selected_chart.keys : null} onSelectionChange={onNoteSkinSelectionChange} onImport={onNoteSkinImport} onExit={() => setSkinsOpen(false)} />}
    </main>
  );
}
