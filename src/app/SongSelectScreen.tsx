import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import {
  Activity,
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
import { PreviewClient } from "../preview/PreviewClient";
import type { ChartSelector } from "../select/ChartSelector";
import { InputBindingsModal } from "./InputBindingsModal";

const ROW_HEIGHT = 82;
const OVERSCAN = 5;
const BACKGROUND_DEBOUNCE_MS = 200;
const SESSION_STARTED_AT = Date.now();

type IconName = "activity" | "arrow-up-down" | "bell" | "chevron-down" | "chevron-left" |
  "chevron-right" | "clock" | "download" | "file" | "filter" | "globe" | "keyboard" |
  "metronome" | "monitor" | "music" | "paintbrush" | "play" | "puzzle" | "search" |
  "settings" | "terminal" | "trophy" | "undo" | "zap";

const icons: Record<IconName, LucideIcon> = {
  activity: Activity,
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
  onPlay: (chart_id: string, input_bindings: readonly (string | null)[]) => void;
  onSettings: () => void;
  master_volume: number;
  scroll_speed: number;
  onScrollSpeedChange: (scroll_speed: number) => void;
}

const mode_names = ["OSU!", "TAIKO", "FRUITS", "MANIA"] as const;

function chartMode(chart: Chartview): string {
  const mode = mode_names[chart.mode] ?? "UNKNOWN";
  return chart.mode === 3 && chart.keys !== null ? `${chart.keys}K ${mode}` : mode;
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
  scroll_speed,
  onScrollSpeedChange,
}: SongSelectScreenProps) {
  const viewport_ref = useRef<HTMLDivElement>(null);
  const audio_ref = useRef<HTMLAudioElement>(null);
  const selection = useSyncExternalStore(chart_selector.subscribe, chart_selector.getSnapshot);
  const [scroll_top, setScrollTop] = useState(0);
  const [viewport_height, setViewportHeight] = useState(0);
  const [score_source, setScoreSource] = useState<"local" | "online">("online");
  const [now, setNow] = useState(() => new Date());
  const [background_url, setBackgroundUrl] = useState<string | null>(null);
  const [loaded_background_url, setLoadedBackgroundUrl] = useState<string | null>(null);
  const [input_bindings_open, setInputBindingsOpen] = useState(false);

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
    const audio = audio_ref.current;
    if (!audio) return;
    const abort_controller = new AbortController();
    const preview_client = new PreviewClient();
    chart_selector.setPreviewClient(preview_client);
    void preview_client.connect(audio, abort_controller.signal).catch((reason: unknown) => {
      if (!abort_controller.signal.aborted) console.error("Preview connection failed", reason);
    });
    return () => {
      abort_controller.abort();
      preview_client.close();
      chart_selector.setPreviewClient(null);
    };
  }, [chart_selector]);

  useEffect(() => {
    if (audio_ref.current) audio_ref.current.volume = master_volume;
  }, [master_volume]);

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
    setLoadedBackgroundUrl(null);
    const timer = window.setTimeout(() => {
      setBackgroundUrl(selected_song?.background_url ?? null);
    }, BACKGROUND_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [selected_song?.background_url]);

  const first_index = Math.max(0, Math.floor(scroll_top / ROW_HEIGHT) - OVERSCAN);
  const visible_count = Math.ceil(viewport_height / ROW_HEIGHT) + OVERSCAN * 2;
  const visible_songs = filtered_songs.slice(first_index, first_index + visible_count);

  const selectSong = (song_id: string) => {
    void audio_ref.current?.play().catch(() => undefined);
    chart_selector.selectSong(song_id);
  };

  const selectLocation = (location_id: number | null) => {
    chart_selector.selectLocation(location_id);
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

  const date_text = new Intl.DateTimeFormat("en-GB", {
    day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(now).replace(",", "");
  const session_duration = formatSessionDuration(Math.floor((now.getTime() - SESSION_STARTED_AT) / 1_000));
  const speed_progress = (scroll_speed - 100) / 3900;
  const speed_style = {
    "--rate-angle": `${speed_progress * 270}deg`,
    "--rate-rotation": `${-135 + speed_progress * 270}deg`,
  } as CSSProperties;
  const hero_loaded = background_url === null || background_url === loaded_background_url;
  const playChart = (chart: Chartview) => onPlay(chart.id, loadInputBindings(inputLayout(chart)));

  return (
    <main className="song-select-screen">
      <audio ref={audio_ref} autoPlay />
      <header className="song-select-header">
        <div className="game-brand"><img src="/rizu-logo.svg" alt="" /><span>RIZU</span></div>
        <div className="session-info"><time>{date_text}</time><span className="session-elapsed">{session_duration}</span><span className="online-status"><b>1</b> ONLINE</span></div>
        <nav className="header-actions" aria-label="Account and settings">
          <div className="player-info"><span><strong>Username</strong><small><b>12,450</b> PP</small></span><i /></div>
          <div className="header-icon-dock">
            <button aria-label="Settings" onClick={onSettings}><Icon name="settings" /></button><button aria-label="Downloads"><Icon name="download" /></button>
            <button aria-label="Command palette"><Icon name="terminal" /></button><button aria-label="Notifications"><Icon name="bell" /><i className="notification-dot" /></button>
          </div>
        </nav>
      </header>

      <section className="library-toolbar" aria-label="Chart library controls">
         <label className="collection-button"><span><small>COLLECTION</small><strong>{selection.selected_location_id === null ? "All songs" : selection.locations.find((location) => location.id === selection.selected_location_id)?.name ?? "All songs"}</strong></span><select aria-label="Collection" value={selection.selected_location_id ?? ""} onChange={(event) => selectLocation(event.target.value === "" ? null : Number(event.target.value))}><option value="">All songs</option>{selection.locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select><Icon name="chevron-down" /></label>
        <button className="toolbar-button"><Icon name="arrow-up-down" /><span><small>SORT</small><strong>Title</strong></span></button>
        <button className="toolbar-button"><Icon name="filter" /><span><small>FILTERS</small><strong>None</strong></span></button>
        <label className="chart-search"><Icon name="search" /><input value={selection.query} onChange={(event) => { chart_selector.setQuery(event.target.value); setScrollTop(0); if (viewport_ref.current) viewport_ref.current.scrollTop = 0; }} type="search" placeholder="Search songs, artists, or creators" aria-label="Search charts" /><kbd>CTRL K</kbd></label>
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
            <div className="chart-difficulty"><span className="chart-mode"><span>{selected_chart ? chartMode(selected_chart) : "NO CHART"}</span><b>{selected_chart?.difficulty.toFixed(1) ?? "0.0"}</b><em>NPS</em></span></div>
            <div className="chart-metadata"><span><Icon name="clock" /><b>{formatDuration(selected_chart?.duration_seconds ?? 0)}</b></span><span><Icon name="music" /><b>{selected_chart?.note_count.toLocaleString() ?? "0"}</b></span><span title={selected_chart ? `${Math.round(selected_chart.bpm_min)}-${Math.round(selected_chart.bpm_max)} BPM` : undefined}><Icon name="metronome" /><b>{Math.round(selected_chart?.bpm_avg ?? 0)} BPM</b></span><span><strong>LN</strong><b className="accent">{Math.round((selected_chart?.long_note_ratio ?? 0) * 100)}%</b></span><span><Icon name="file" /><b>{selected_chart?.format.toUpperCase() ?? "-"}</b></span></div>
          </section>
          <section className="chart-browser" aria-label="Chart browser">
            <div className="difficulty-strip"><button aria-label="Previous difficulties"><Icon name="chevron-left" /></button><div>
              {selected_song?.charts.map((chart) => <button className={chart.id === selected_chart?.id ? "selected" : ""} key={chart.id} onClick={() => chart_selector.selectChart(chart.id)} style={{ "--difficulty-color": difficultyColor(chart.difficulty) } as CSSProperties} title={`${chart.name} by ${chart.creator}`}><strong>{chart.difficulty.toFixed(1)}</strong><span>{chartMode(chart)}</span></button>)}
            </div><button aria-label="Next difficulties"><Icon name="chevron-right" /></button></div>
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
        <nav className="loadout-controls" aria-label="Loadout"><button className="mods"><Icon name="puzzle" /><span>MODS</span></button><button className="mutators"><Icon name="zap" /><span>MUTATORS</span><b>0</b></button><button className="inputs" disabled={!selected_chart} onClick={() => setInputBindingsOpen(true)}><Icon name="keyboard" /><span>INPUTS</span></button><button className="skins"><Icon name="paintbrush" /><span>SKINS</span></button></nav>
        <div className="play-controls"><div className="play-modifiers"><strong>SCROLL SPEED</strong><label className="rate-control"><output htmlFor="scroll-speed">{scroll_speed}</output><span className="rate-knob" style={speed_style}><span /><input id="scroll-speed" type="range" min="100" max="4000" step="100" value={scroll_speed} aria-label="Scroll speed" onChange={(event) => onScrollSpeedChange(Number(event.target.value))} /></span></label><span className="modifier-flag"><Icon name="activity" /><small>CONST</small></span></div><button className="play-control" disabled={!selected_chart} onClick={() => selected_chart && playChart(selected_chart)}><span>PLAY</span><Icon name="play" /></button></div>
      </footer>
      {input_bindings_open && selected_chart && <InputBindingsModal chart={selected_chart} onExit={() => setInputBindingsOpen(false)} />}
    </main>
  );
}
