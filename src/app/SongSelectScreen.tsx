import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { inputLayout, loadInputBindings } from "../gameplay/InputBindings";
import type { Chartview } from "../library/views";
import type { ChartSelectionEntry, ChartSelector, ChartSortMode } from "../select/ChartSelector";
import { InputBindingsModal } from "./InputBindingsModal";
import { GameplayModifiersModal } from "./GameplayModifiersModal";
import { GamemodeFiltersModal } from "./GamemodeFiltersModal";
import { noteSkinMode, type NoteSkinOption, type NoteSkinSelections } from "../noteskin/NoteSkinSelection";
import { NoteSkinsModal } from "./NoteSkinsModal";
import { ChartBrowser } from "./song-select/ChartBrowser";
import { LibraryToolbar } from "./song-select/LibraryToolbar";
import { SelectedSongPanel } from "./song-select/SelectedSongPanel";
import { SongSelectFooter } from "./song-select/SongSelectFooter";
import { SongSelectHeader } from "./song-select/SongSelectHeader";
import { completedGameplayFromStoredPlay, listPlaysByChart, type StoredPlay } from "../replay/ReplayStore";
import type { CompletedGameplay } from "../replay/RecordedReplay";
import { readLocalFile } from "../library/LocalLibraryStore";
import { LibrarySourcesScreen } from "./LibrarySourcesScreen";
import type { LocalLibraryStatus } from "../library/LocalLibraryStore";
import type { RemoteProviderView } from "../library/RemoteLibraryStore";
import type { SongPreviewPlayer } from "../audio/SongPreviewPlayer";

const ROW_HEIGHT = 82;
const BACKGROUND_DEBOUNCE_MS = 200;
const SESSION_STARTED_AT = Date.now();

interface LocalPreviewMedia {
  readonly chart_id: string;
  readonly audio_url: string;
  readonly background_url: string | null;
}

interface SongSelectScreenProps {
  chart_selector: ChartSelector;
  nickname: string;
  onPlay: (chart: Chartview, input_bindings: readonly (string | null)[], song: { title: string; artist: string }) => void;
  preview_player: SongPreviewPlayer;
  onAutoplay: (chart: Chartview, input_bindings: readonly (string | null)[], song: { title: string; artist: string }) => void;
  onReplay: (chart: Chartview, input_bindings: readonly (string | null)[], song: { title: string; artist: string }, playback: CompletedGameplay) => void;
  onExit: () => void;
  onSettings: () => void;
  master_volume: number;
  music_rate: number;
  constant_scroll: boolean;
  tap_only: boolean;
  note_skin_selections: NoteSkinSelections;
  available_note_skins: readonly NoteSkinOption[];
  score_storage_revision: number;
  onMusicRateChange: (music_rate: number) => void;
  onConstantScrollChange: (constant_scroll: boolean) => void;
  onTapOnlyChange: (tap_only: boolean) => void;
  onNoteSkinSelectionChange: (key: string, skin_id: string | undefined) => void;
  onNoteSkinImport: (file: File) => Promise<{ options: readonly NoteSkinOption[]; persisted: boolean }>;
  onNoteSkinDelete: (skin_id: string) => Promise<void>;
  onNoteSkinEdit: (chart: Chartview, input_bindings: readonly (string | null)[], song: { title: string; artist: string }) => void;
  onAddLocalLibrary: () => Promise<void>;
  onAddRemoteLibrary: (url: string) => Promise<void>;
  onRefreshLibrary: () => void;
  local_library_status: LocalLibraryStatus;
  remote_providers: readonly RemoteProviderView[];
}

function formatSessionDuration(duration_seconds: number): string {
  const hours = Math.floor(duration_seconds / 3600);
  const minutes = Math.floor((duration_seconds % 3600) / 60);
  const seconds = duration_seconds % 60;
  return [hours, minutes, seconds].map((value) => String(value).padStart(2, "0")).join(":");
}

export function SongSelectScreen({
  chart_selector,
  nickname,
  onPlay,
  preview_player,
  onAutoplay,
  onReplay,
  onExit,
  onSettings,
  master_volume,
  music_rate,
  constant_scroll,
  tap_only,
  note_skin_selections,
  available_note_skins,
  score_storage_revision,
  onMusicRateChange,
  onConstantScrollChange,
  onTapOnlyChange,
  onNoteSkinSelectionChange,
  onNoteSkinImport,
  onNoteSkinDelete,
  onNoteSkinEdit,
  onAddLocalLibrary,
  onAddRemoteLibrary,
  onRefreshLibrary,
  local_library_status,
  remote_providers,
}: SongSelectScreenProps) {
  const viewport_ref = useRef<HTMLDivElement>(null);
  const difficulty_strip_ref = useRef<HTMLDivElement>(null);
  const selected_difficulty_ref = useRef<HTMLButtonElement>(null);
  const restored_song_scroll_ref = useRef(false);
  const selection = useSyncExternalStore(chart_selector.subscribe, chart_selector.getSnapshot);
  const preview_paused = useSyncExternalStore(preview_player.subscribe, preview_player.getPaused);
  const scroll_top_ref = useRef(0);
  const [now, setNow] = useState(() => new Date());
  const [background_url, setBackgroundUrl] = useState<string | null>(null);
  const [loaded_background_url, setLoadedBackgroundUrl] = useState<string | null>(null);
  const [input_bindings_open, setInputBindingsOpen] = useState(false);
  const [modifiers_open, setModifiersOpen] = useState(false);
  const [filters_open, setFiltersOpen] = useState(false);
  const [skins_open, setSkinsOpen] = useState(false);
  const [library_sources_open, setLibrarySourcesOpen] = useState(false);
  const [stored_plays, setStoredPlays] = useState<readonly StoredPlay[]>([]);
  const [local_preview_media, setLocalPreviewMedia] = useState<LocalPreviewMedia | null>(null);

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

  const { selection_entries, selected_song, selected_chart } = useMemo(() => ({
    selection_entries: chart_selector.getSelectionEntries(),
    selected_song: chart_selector.getSelectedSong(),
    selected_chart: chart_selector.getSelectedChart(),
  }), [selection]);
  const chart_level_sort = selection.sort_mode === "difficulty" || selection.sort_mode === "duration";
  const selected_local_media = local_preview_media?.chart_id === selected_chart?.id ? local_preview_media : null;
  const selected_background_url = selected_local_media?.background_url ?? selected_chart?.background_url ?? null;
  const selected_preview_audio_url = selected_local_media?.audio_url
    ?? selected_chart?.preview_audio_url
    ?? selected_chart?.audio_url
    ?? "";
  const selected_preview_time = selected_local_media ? selected_chart?.preview_time ?? 0 : selected_chart?.preview_audio_url ? 0 : selected_chart?.preview_time ?? 0;

  useEffect(() => {
    setLocalPreviewMedia(null);
    const source_id = selected_chart?.source_id;
    const audio_path = selected_chart?.audio_path;
    if (selected_chart?.source_type !== "local" || !source_id || !audio_path) return;

    let active = true;
    const urls: string[] = [];
    void Promise.all([
      readLocalFile(source_id, audio_path).then((file) => {
        const url = URL.createObjectURL(file);
        urls.push(url);
        return url;
      }),
      selected_chart.background_path
        ? readLocalFile(source_id, selected_chart.background_path).then((file) => {
          const url = URL.createObjectURL(file);
          urls.push(url);
          return url;
        }).catch(() => null)
        : Promise.resolve(null),
    ]).then(([audio_url, background_url]) => {
      if (active) setLocalPreviewMedia({ chart_id: selected_chart.id, audio_url, background_url });
    }).catch((reason: unknown) => {
      if (!active) return;
      console.warn("Could not load local song-select media", reason);
      preview_player.stop(300);
    });
    return () => {
      active = false;
      for (const url of urls) URL.revokeObjectURL(url);
    };
  }, [preview_player, selected_chart?.audio_path, selected_chart?.background_path, selected_chart?.id, selected_chart?.source_id, selected_chart?.source_type]);

  useEffect(() => {
    let active = true;
    setStoredPlays([]);
    if (!selected_chart) return () => { active = false; };
    void listPlaysByChart(selected_chart.id).then((plays) => {
      if (active) setStoredPlays(plays);
    }).catch((error: unknown) => {
      console.error("Could not load chart scores", error);
    });
    return () => { active = false; };
  }, [selected_chart?.id, score_storage_revision]);

  useEffect(() => {
    if (restored_song_scroll_ref.current) return;
    const viewport = viewport_ref.current;
    const selected_index = selection_entries.findIndex((entry) => chart_selector.isEntrySelected(entry));
    if (!viewport || selected_index < 0 || viewport.clientHeight === 0) return;
    const centered_scroll_top = Math.max(0, selected_index * ROW_HEIGHT + ROW_HEIGHT / 2 - viewport.clientHeight / 2);
    viewport.scrollTop = centered_scroll_top;
    scroll_top_ref.current = centered_scroll_top;
    restored_song_scroll_ref.current = true;
  }, [selection_entries.length, selection.selected_chart_id, selection.selected_song_id, selection.sort_mode]);

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
    scroll_top_ref.current = next_scroll_top;
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
      setBackgroundUrl(selected_background_url);
    }, BACKGROUND_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [selected_background_url]);

  useEffect(() => {
    preview_player.setVolume(master_volume);
  }, [master_volume, preview_player]);

  useEffect(() => {
    preview_player.setPlaybackRate(music_rate);
  }, [music_rate, preview_player]);

  useEffect(() => {
    if (selected_chart?.source_type === "local" && !selected_local_media) return;
    preview_player.select(selected_song?.id ?? "", selected_preview_audio_url, selected_preview_time);
  }, [preview_player, selected_local_media, selected_preview_audio_url, selected_preview_time,
    selected_chart?.source_type, selected_song?.id]);

  const selectEntry = (entry: ChartSelectionEntry) => {
    chart_selector.selectEntry(entry);
  };

  const selectLocation = (location_id: number | null) => {
    chart_selector.selectLocation(location_id);
    scroll_top_ref.current = 0;
    if (viewport_ref.current) viewport_ref.current.scrollTop = 0;
  };

  const selectMode = (mode: number | null) => {
    chart_selector.selectMode(mode);
    scroll_top_ref.current = 0;
    if (viewport_ref.current) viewport_ref.current.scrollTop = 0;
  };

  const selectSortMode = (sort_mode: ChartSortMode) => {
    chart_selector.setSortMode(sort_mode);
    scroll_top_ref.current = 0;
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

  const changeMusicRateFromKeyboard = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key !== "[" && event.key !== "]") return;
    const target = event.target;
    if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement ||
      target instanceof HTMLInputElement && target.type !== "range" ||
      target instanceof HTMLElement && target.isContentEditable) return;
    if (input_bindings_open || modifiers_open || filters_open || skins_open ||
      library_sources_open) return;
    event.preventDefault();
    const offset = event.key === "[" ? -0.05 : 0.05;
    onMusicRateChange(Math.min(4, Math.max(0.25, Math.round((music_rate + offset) * 100) / 100)));
  };

  const date_text = new Intl.DateTimeFormat("en-GB", {
    day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(now).replace(",", "");
  const session_duration = formatSessionDuration(Math.floor((now.getTime() - SESSION_STARTED_AT) / 1_000));
  const hero_loaded = background_url === null || background_url === loaded_background_url;
  const unlockPreview = () => {
    preview_player.unlock();
  };
  const playChart = (chart: Chartview, song = selected_song) => {
    onPlay(chart, loadInputBindings(inputLayout(chart)), {
      title: song?.title ?? "Unknown title",
      artist: song?.artist ?? "Unknown artist",
    });
  };
  const autoplayChart = (chart: Chartview, song = selected_song) => {
    onAutoplay(chart, loadInputBindings(inputLayout(chart)), {
      title: song?.title ?? "Unknown title",
      artist: song?.artist ?? "Unknown artist",
    });
  };
  const editNoteSkin = () => {
    if (!selected_chart) return;
    setSkinsOpen(false);
    onNoteSkinEdit(selected_chart, loadInputBindings(inputLayout(selected_chart)), {
      title: selected_song?.title ?? "Unknown title",
      artist: selected_song?.artist ?? "Unknown artist",
    });
  };
  const playReplay = (play: StoredPlay) => {
    if (!selected_chart || play.chart_id !== selected_chart.id) return;
    try {
      const playback = completedGameplayFromStoredPlay(play);
      onReplay(selected_chart, loadInputBindings(inputLayout(selected_chart)), {
        title: selected_song?.title ?? "Unknown title",
        artist: selected_song?.artist ?? "Unknown artist",
      }, playback);
    } catch (error) {
      console.error("Could not play stored replay", error);
    }
  };
  return (
    <main className="song-select-screen" onPointerDownCapture={unlockPreview} onKeyDownCapture={(event) => {
      unlockPreview();
      changeMusicRateFromKeyboard(event);
    }}>
      <SongSelectHeader nickname={nickname} date_text={date_text} session_duration={session_duration}
        onSettings={onSettings}
        onOpenLibrarySources={() => setLibrarySourcesOpen(true)} onRefreshLibrary={onRefreshLibrary} library_scanning={local_library_status.scanning} />
      {library_sources_open ? <LibrarySourcesScreen local_status={local_library_status} remote_providers={remote_providers}
          onAddLocal={onAddLocalLibrary} onAddRemote={onAddRemoteLibrary} onExit={() => setLibrarySourcesOpen(false)} /> : <>
        <LibraryToolbar selection={selection} onLocationChange={selectLocation} onOpenFilters={() => setFiltersOpen(true)}
          onQueryChange={(query) => { chart_selector.setQuery(query); scroll_top_ref.current = 0; if (viewport_ref.current) viewport_ref.current.scrollTop = 0; }}
          onSortChange={selectSortMode} />

        <section className="song-select-content">
          <SelectedSongPanel background_url={background_url} background_loaded={hero_loaded} selected_chart={selected_chart}
            selected_song={selected_song} stored_plays={stored_plays} nickname={nickname}
            onBackgroundLoaded={() => setLoadedBackgroundUrl(background_url)}
            onAutoplay={() => selected_chart && autoplayChart(selected_chart)} onTogglePreview={() => preview_player.togglePaused()}
            preview_paused={preview_paused} onReplay={playReplay} />
          <ChartBrowser chart_level_sort={chart_level_sort} difficulty_strip_ref={difficulty_strip_ref} error={selection.error}
            initial_scroll_top={scroll_top_ref.current} query={selection.query} selected_chart={selected_chart} selected_difficulty_ref={selected_difficulty_ref}
            selected_song={selected_song} selection_entries={selection_entries} sort_mode={selection.sort_mode} viewport_ref={viewport_ref}
            onChartSelect={(chart_id) => chart_selector.selectChart(chart_id)}
            onEntryPlay={(entry) => { const chart = entry.chart ?? entry.song.charts.at(-1); if (chart) playChart(chart, entry.song); }}
            onEntrySelect={selectEntry} onKeyDown={(event) => {
              if (event.key === "ArrowUp" || event.key === "ArrowDown") { event.preventDefault(); moveSelection(event.key === "ArrowUp" ? -1 : 1); }
              if (event.key === "Enter" && selected_chart) playChart(selected_chart);
            }} onMoveDifficulty={selectDifficulty} onScrollPositionChange={(scroll_top) => { scroll_top_ref.current = scroll_top; }}
            isEntrySelected={(entry) => chart_selector.isEntrySelected(entry)} />
        </section>

        <SongSelectFooter constant_scroll={constant_scroll} music_rate={music_rate} selected_chart_available={Boolean(selected_chart)} tap_only={tap_only}
          onMusicRateChange={onMusicRateChange} onOpenInputs={() => setInputBindingsOpen(true)} onOpenModifiers={() => setModifiersOpen(true)}
          onOpenSkins={() => setSkinsOpen(true)} onExit={onExit} onPlay={() => selected_chart && playChart(selected_chart)}
        />
      </>}
      {input_bindings_open && selected_chart && <InputBindingsModal chart={selected_chart} onExit={() => setInputBindingsOpen(false)} />}
      {modifiers_open && <GameplayModifiersModal constant_scroll={constant_scroll} tap_only={tap_only} onConstantScrollChange={onConstantScrollChange} onTapOnlyChange={onTapOnlyChange} onExit={() => setModifiersOpen(false)} />}
      {filters_open && <GamemodeFiltersModal selected_mode={selection.selected_mode} onModeChange={selectMode} onExit={() => setFiltersOpen(false)} />}
      {skins_open && <NoteSkinsModal selections={note_skin_selections} options={available_note_skins} selected_mode={selected_chart ? noteSkinMode(selected_chart.mode) : null} selected_column_count={selected_chart?.mode === 3 ? selected_chart.keys : null} onSelectionChange={onNoteSkinSelectionChange} onImport={onNoteSkinImport} onDelete={onNoteSkinDelete} onEdit={editNoteSkin} onExit={() => setSkinsOpen(false)} />}
    </main>
  );
}
