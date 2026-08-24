import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import {
  ArrowUpDown,
  Bell,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Download,
  File,
  Globe2,
  Keyboard,
  ListFilter,
  Metronome,
  Monitor,
  Music2,
  Paintbrush,
  Play,
  Puzzle,
  Search,
  Settings,
  Terminal,
  Trophy,
  Undo2,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { inputLayout, loadInputBindings } from "../gameplay/InputBindings";
import type { Chartview } from "../library/views";
import type { ChartSelector } from "../select/ChartSelector";
import { InputBindingsModal } from "./InputBindingsModal";
import { GameplayModifiersModal } from "./GameplayModifiersModal";
import { GamemodeFiltersModal } from "./GamemodeFiltersModal";
import type { NoteSkinSelections } from "../gameplay/renderer/NoteSkinSelection";
import { NoteSkinsModal } from "./NoteSkinsModal";

const ROW_HEIGHT = 82;
const OVERSCAN = 5;
const BACKGROUND_DEBOUNCE_MS = 200;
const AUDIO_PREVIEW_DEBOUNCE_MS = 200;
const SESSION_STARTED_AT = Date.now();

type IconName = "arrow-up-down" | "bell" | "chevron-down" | "chevron-left" |
  "chevron-right" | "clock" | "download" | "file" | "filter" | "globe" | "keyboard" |
  "metronome" | "monitor" | "music" | "paintbrush" | "play" | "puzzle" | "search" |
  "settings" | "terminal" | "trophy" | "undo" | "zap";

const icons: Record<IconName, LucideIcon> = {
  "arrow-up-down": ArrowUpDown,
  bell: Bell,
  "chevron-down": ChevronDown,
  "chevron-left": ChevronLeft,
  "chevron-right": ChevronRight,
  clock: Clock3,
  download: Download,
  file: File,
  filter: ListFilter,
  globe: Globe2,
  keyboard: Keyboard,
  metronome: Metronome,
  monitor: Monitor,
  music: Music2,
  paintbrush: Paintbrush,
  play: Play,
  puzzle: Puzzle,
  search: Search,
  settings: Settings,
  terminal: Terminal,
  trophy: Trophy,
  undo: Undo2,
  zap: Zap,
};

function Icon({ name }: { name: IconName }) {
  const Component = icons[name];
  return <Component aria-hidden="true" />;
}

interface SongSelectScreenProps {
  chart_selector: ChartSelector;
  onPlay: (chart: Chartview, input_bindings: readonly (string | null)[], song: { title: string; artist: string }) => void;
  onSettings: () => void;
  master_volume: number;
  music_rate: number;
  constant_scroll: boolean;
  tap_only: boolean;
  note_skin_selections: NoteSkinSelections;
  onMusicRateChange: (music_rate: number) => void;
  onConstantScrollChange: (constant_scroll: boolean) => void;
  onTapOnlyChange: (tap_only: boolean) => void;
  onNoteSkinSelectionChange: (key: string, skin_id: string | undefined) => void;
}

const mode_names = ["OSU!", "TAIKO", "FRUITS", "MANIA"] as const;

function chartMode(chart: Chartview): string {
  const mode = mode_names[chart.mode] ?? "UNKNOWN";
  return chart.mode === 3 && chart.keys !== null ? `${chart.keys}K ${mode}` : mode;
}

function chartSummaryMode(chart: Chartview): string {
  return chart.mode === 3 && chart.keys !== null ? `${chart.keys}K` : mode_names[chart.mode] ?? "UNKNOWN";
}

function formatDuration(duration_seconds: number): string {
  const seconds = Math.round(duration_seconds);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function formatSessionDuration(duration_seconds: number): string {
  const hours = Math.floor(duration_seconds / 3600);
  const minutes = Math.floor((duration_seconds % 3600) / 60);
  const seconds = duration_seconds % 60;
  return [hours, minutes, seconds].map((value) => String(value).padStart(2, "0")).join(":");
}

function difficultyColor(difficulty: number): string {
  const hue = Math.max(0, 135 - difficulty * 18);
  return `hsl(${hue} 92% 52%)`;
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
  onMusicRateChange,
  onConstantScrollChange,
  onTapOnlyChange,
  onNoteSkinSelectionChange,
}: SongSelectScreenProps) {
  const viewport_ref = useRef<HTMLDivElement>(null);
  const difficulty_strip_ref = useRef<HTMLDivElement>(null);
  const selected_difficulty_ref = useRef<HTMLButtonElement>(null);
  const restored_song_scroll_ref = useRef(false);
  const audio_ref = useRef<HTMLAudioElement>(null);
  const preview_unlocked_ref = useRef(false);
  const last_preview_change_ref = useRef<number | null>(null);
  const rate_drag_ref = useRef<{ pointer_id: number; start_x: number; start_rate: number } | null>(null);
  const selection = useSyncExternalStore(chart_selector.subscribe, chart_selector.getSnapshot);
  const [scroll_top, setScrollTop] = useState(0);
  const [viewport_height, setViewportHeight] = useState(0);
  const [score_source, setScoreSource] = useState<"local" | "online">("online");
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

  const filtered_songs = chart_selector.getFilteredSongs();
  const selected_song = chart_selector.getSelectedSong();
  const selected_chart = chart_selector.getSelectedChart();

  useEffect(() => {
    if (restored_song_scroll_ref.current) return;
    const viewport = viewport_ref.current;
    const selected_index = filtered_songs.findIndex((song) => song.id === selected_song?.id);
    if (!viewport || selected_index < 0 || viewport.clientHeight === 0) return;
    const centered_scroll_top = Math.max(0, selected_index * ROW_HEIGHT + ROW_HEIGHT / 2 - viewport.clientHeight / 2);
    viewport.scrollTop = centered_scroll_top;
    setScrollTop(centered_scroll_top);
    restored_song_scroll_ref.current = true;
  }, [filtered_songs.length, selected_song?.id, viewport_height]);

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
  const visible_songs = filtered_songs.slice(first_index, first_index + visible_count);

  const selectSong = (song_id: string) => {
    chart_selector.selectSong(song_id);
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

  const moveSelection = (offset: number) => {
    if (!filtered_songs.length) return;
    const selected_index = filtered_songs.findIndex((song) => song.id === selection.selected_song_id);
    const next_index = Math.min(Math.max((selected_index < 0 ? 0 : selected_index) + offset, 0), filtered_songs.length - 1);
    const next_song = filtered_songs[next_index];
    if (!next_song) return;
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
  const speed_progress = (music_rate - 0.25) / 3.75;
  const speed_style = {
    "--rate-angle": `${speed_progress * 270}deg`,
    "--rate-rotation": `${-135 + speed_progress * 270}deg`,
  } as CSSProperties;
  const hero_loaded = background_url === null || background_url === loaded_background_url;
  const unlockPreview = () => {
    if (preview_unlocked_ref.current) return;
    preview_unlocked_ref.current = true;
    const audio = audio_ref.current;
    if (!audio || !selected_chart?.audio_preview_url) return;
    audio.src = selected_chart.audio_preview_url;
    void audio.play().catch(() => undefined);
  };
  const playChart = (chart: Chartview) => {
    audio_ref.current?.pause();
    onPlay(chart, loadInputBindings(inputLayout(chart)), {
      title: selected_song?.title ?? "Unknown title",
      artist: selected_song?.artist ?? "Unknown artist",
    });
  };
  const moveRateDrag = (client_x: number) => {
    const drag = rate_drag_ref.current;
    if (!drag) return;
    const value = drag.start_rate + (client_x - drag.start_x) / 360 * 3.75;
    onMusicRateChange(Math.min(4, Math.max(0.25, Math.round(value / 0.05) * 0.05)));
  };

  return (
    <main className="song-select-screen" onPointerDownCapture={unlockPreview} onKeyDownCapture={unlockPreview}>
      <audio ref={audio_ref} preload="auto" />
      <header className="song-select-header">
        <div className="game-brand"><img src="/rizu-logo.svg" alt="" /><span>RIZU.SU | WEBCLIENT</span></div>
        <div className="session-info"><time>{date_text}</time><span className="session-elapsed">{session_duration}</span><span className="online-status">OFFLINE</span></div>
        <nav className="header-actions" aria-label="Account and settings">
          <div className="player-info"><span><strong>Guest</strong></span><i /></div>
          <div className="header-icon-dock">
            <button aria-label="Settings" onClick={onSettings}><Icon name="settings" /></button><button aria-label="Downloads"><Icon name="download" /></button>
            <button aria-label="Command palette"><Icon name="terminal" /></button><button aria-label="Notifications"><Icon name="bell" /></button>
          </div>
        </nav>
      </header>

      <section className="library-toolbar" aria-label="Chart library controls">
         <label className="collection-button"><span><small>COLLECTION</small><strong>{selection.selected_location_id === null ? "All songs" : selection.locations.find((location) => location.id === selection.selected_location_id)?.name ?? "All songs"}</strong></span><select aria-label="Collection" value={selection.selected_location_id ?? ""} onChange={(event) => selectLocation(event.target.value === "" ? null : Number(event.target.value))}><option value="">All songs</option>{selection.locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select><Icon name="chevron-down" /></label>
        <button className="toolbar-button"><Icon name="arrow-up-down" /><span><small>SORT</small><strong>Title</strong></span></button>
        <button className="toolbar-button" aria-haspopup="dialog" aria-expanded={filters_open} onClick={() => setFiltersOpen(true)}><Icon name="filter" /><span><small>FILTERS</small><strong>{selection.selected_mode === null ? "None" : mode_names[selection.selected_mode]}</strong></span></button>
        <label className="chart-search"><Icon name="search" /><input value={selection.query} onChange={(event) => { chart_selector.setQuery(event.target.value); setScrollTop(0); if (viewport_ref.current) viewport_ref.current.scrollTop = 0; }} type="search" placeholder="Search songs, artists, or creators" aria-label="Search charts" /></label>
      </section>

      <section className="song-select-content">
        <div className="song-select-column left-column">
          <article className={`song-hero${hero_loaded ? " loaded" : ""}`}>
            {background_url && <img key={background_url} className="song-hero-background" src={background_url} alt="" onLoad={() => setLoadedBackgroundUrl(background_url)} onError={() => setLoadedBackgroundUrl(background_url)} />}
            <div className="song-hero-chart"><strong>{selected_chart?.name ?? "Loading chart..."}</strong><span>{selected_chart?.creator || "Unknown creator"}</span></div>
            <div className="song-hero-metadata"><h1>{selected_song?.title ?? "Loading catalog..."}</h1><p>{selected_song?.artist ?? "Please wait"}</p></div>
          </article>
          <section className="score-list" aria-label="Scores">
            <header><span>Not played yet</span><div className="score-source">
              <button className={score_source === "local" ? "active" : ""} onClick={() => setScoreSource("local")} aria-label="Local scores" aria-pressed={score_source === "local"}><Icon name="monitor" /></button>
              <button className={score_source === "online" ? "active" : ""} onClick={() => setScoreSource("online")} aria-label="Online scores" aria-pressed={score_source === "online"}><Icon name="globe" /></button>
            </div></header>
            <div className="no-records"><Icon name="trophy" /><span>No Records Set!</span></div>
          </section>
        </div>

        <div className="song-select-column right-column">
          <section className="chart-summary" aria-label="Selected chart information">
            <div className="chart-difficulty" style={{ "--difficulty-color": difficultyColor(selected_chart?.difficulty ?? 0) } as CSSProperties}><span className="chart-rating"><b>{selected_chart?.difficulty.toFixed(1) ?? "0.0"}</b><em>NPS</em></span><span className="chart-mode">{selected_chart ? chartSummaryMode(selected_chart) : "NO CHART"}</span></div>
            <div className="chart-metadata"><span><Icon name="clock" /><b>{formatDuration(selected_chart?.duration_seconds ?? 0)}</b></span><span><Icon name="music" /><b>{selected_chart?.note_count.toLocaleString() ?? "0"}</b></span><span title={selected_chart ? `${Math.round(selected_chart.bpm_min)}-${Math.round(selected_chart.bpm_max)} BPM` : undefined}><Icon name="metronome" /><b>{Math.round(selected_chart?.bpm_avg ?? 0)} BPM</b></span><span><strong>LN</strong><b className="accent">{Math.round((selected_chart?.long_note_ratio ?? 0) * 100)}%</b></span><span><Icon name="file" /><b>{selected_chart?.format.toUpperCase() ?? "-"}</b></span></div>
          </section>
          <section className="chart-browser" aria-label="Chart browser">
            <div className="difficulty-strip"><button aria-label="Previous difficulty" onClick={() => selectDifficulty(-1)}><Icon name="chevron-left" /></button><div ref={difficulty_strip_ref}>
              {selected_song?.charts.map((chart) => <button ref={chart.id === selected_chart?.id ? selected_difficulty_ref : undefined} className={chart.id === selected_chart?.id ? "selected" : ""} key={chart.id} onClick={() => chart_selector.selectChart(chart.id)} style={{ "--difficulty-color": difficultyColor(chart.difficulty) } as CSSProperties} title={`${chart.name} by ${chart.creator}`}><strong>{chart.difficulty.toFixed(1)}</strong><span>{chartMode(chart)}</span></button>)}
            </div><button aria-label="Next difficulty" onClick={() => selectDifficulty(1)}><Icon name="chevron-right" /></button></div>
            {selection.error ? <p className="song-library-error">{selection.error}</p> : <div className="chart-list" ref={viewport_ref} role="listbox" aria-label="Songs" tabIndex={0} onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)} onKeyDown={(event) => {
              if (event.key === "ArrowUp" || event.key === "ArrowDown") { event.preventDefault(); moveSelection(event.key === "ArrowUp" ? -1 : 1); }
              if (event.key === "Enter" && selected_chart) playChart(selected_chart);
            }}><div className="chart-list-space" style={{ height: filtered_songs.length * ROW_HEIGHT }}>
               {visible_songs.map((song, offset) => { const hardest_chart = song.charts.at(-1); return <button aria-selected={song.id === selection.selected_song_id} className={`chart-row${song.id === selection.selected_song_id ? " selected" : ""}`} key={song.id} onClick={() => selectSong(song.id)} onDoubleClick={() => hardest_chart && playChart(hardest_chart)} role="option" style={{ "--row-offset": `${(first_index + offset) * ROW_HEIGHT}px`, "--difficulty-color": difficultyColor(hardest_chart?.difficulty ?? 0) } as CSSProperties}><span><strong>{song.title}</strong><small>{song.artist}</small></span><i className={(first_index + offset) % 3 === 0 ? "ranked" : ""} /></button>; })}
            </div>{filtered_songs.length === 0 && <p className="empty-library">{selection.query ? `No songs match “${selection.query}”` : "No songs in this collection"}</p>}</div>}
          </section>
        </div>
      </section>

      <footer className="song-select-footer">
        <button className="back-control" type="button"><Icon name="undo" /><span>BACK</span></button>
        <nav className="loadout-controls" aria-label="Loadout"><button className={`mods${constant_scroll || tap_only ? " active" : ""}`} aria-haspopup="dialog" aria-expanded={modifiers_open} onClick={() => setModifiersOpen(true)}><Icon name="puzzle" /><span>MODS</span><b>{Number(constant_scroll) + Number(tap_only)}</b></button><button className="mutators"><Icon name="zap" /><span>MUTATORS</span><b>0</b></button><button className="inputs" disabled={!selected_chart} onClick={() => setInputBindingsOpen(true)}><Icon name="keyboard" /><span>INPUTS</span></button><button className="skins" aria-haspopup="dialog" aria-expanded={skins_open} onClick={() => setSkinsOpen(true)}><Icon name="paintbrush" /><span>SKINS</span></button></nav>
        <div className="play-controls"><div className="play-modifiers"><strong>MUSIC SPEED</strong><label className="rate-control"><output htmlFor="music-rate">{music_rate.toFixed(2)}x</output><span className="rate-knob" style={speed_style}><span /><input id="music-rate" type="range" min="0.25" max="4" step="0.05" value={music_rate} aria-label="Music speed" onChange={(event) => onMusicRateChange(Number(event.target.value))} onPointerDown={(event) => { event.preventDefault(); event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId); rate_drag_ref.current = { pointer_id: event.pointerId, start_x: event.clientX, start_rate: music_rate }; }} onPointerMove={(event) => { if (rate_drag_ref.current?.pointer_id === event.pointerId) moveRateDrag(event.clientX); }} onPointerUp={(event) => { if (rate_drag_ref.current?.pointer_id === event.pointerId) rate_drag_ref.current = null; }} onPointerCancel={(event) => { if (rate_drag_ref.current?.pointer_id === event.pointerId) rate_drag_ref.current = null; }} /></span></label></div><button className="play-control" disabled={!selected_chart} onClick={() => selected_chart && playChart(selected_chart)}><span>PLAY</span><Icon name="play" /></button></div>
      </footer>
      {input_bindings_open && selected_chart && <InputBindingsModal chart={selected_chart} onExit={() => setInputBindingsOpen(false)} />}
      {modifiers_open && <GameplayModifiersModal constant_scroll={constant_scroll} tap_only={tap_only} onConstantScrollChange={onConstantScrollChange} onTapOnlyChange={onTapOnlyChange} onExit={() => setModifiersOpen(false)} />}
      {filters_open && <GamemodeFiltersModal selected_mode={selection.selected_mode} onModeChange={selectMode} onExit={() => setFiltersOpen(false)} />}
      {skins_open && <NoteSkinsModal selections={note_skin_selections} selected_column_count={selected_chart?.mode === 3 ? selected_chart.keys : null} onSelectionChange={onNoteSkinSelectionChange} onExit={() => setSkinsOpen(false)} />}
    </main>
  );
}
