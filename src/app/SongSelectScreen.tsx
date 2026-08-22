import { useEffect, useRef, useState, type CSSProperties } from "react";
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
  Undo2,
  Zap,
  type LucideIcon,
} from "lucide-react";
import type { CatalogChart, CatalogProvider, CatalogSong } from "../catalog/CatalogProvider";
import { PreviewClient } from "../preview/PreviewClient";

const ROW_HEIGHT = 82;
const OVERSCAN = 5;
const PREVIEW_DEBOUNCE_MS = 200;

type IconName = "activity" | "arrow-up-down" | "bell" | "chevron-down" | "chevron-left" |
  "chevron-right" | "clock" | "download" | "file" | "filter" | "globe" | "keyboard" |
  "metronome" | "monitor" | "music" | "paintbrush" | "play" | "puzzle" | "search" |
  "settings" | "terminal" | "undo" | "zap";

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
  undo: Undo2,
  zap: Zap,
};

function Icon({ name }: { name: IconName }) {
  const Component = icons[name];
  return <Component aria-hidden="true" />;
}

interface SongSelectScreenProps {
  catalog_provider: CatalogProvider;
  selected_song_id: string | null;
  onPlay: (chart_id: string) => void;
  onSongSelect: (song_id: string) => void;
  scroll_speed: number;
  onScrollSpeedChange: (scroll_speed: number) => void;
}

const mode_names = ["OSU!", "TAIKO", "FRUITS", "MANIA"] as const;

function chartMode(chart: CatalogChart): string {
  const mode = mode_names[chart.mode] ?? "UNKNOWN";
  return chart.mode === 3 && chart.keys !== null ? `${chart.keys}K ${mode}` : mode;
}

function formatDuration(duration_seconds: number): string {
  const seconds = Math.round(duration_seconds);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function difficultyColor(difficulty: number): string {
  const hue = Math.max(0, 135 - difficulty * 18);
  return `hsl(${hue} 92% 52%)`;
}

export function SongSelectScreen({
  catalog_provider,
  selected_song_id,
  onPlay,
  onSongSelect,
  scroll_speed,
  onScrollSpeedChange,
}: SongSelectScreenProps) {
  const viewport_ref = useRef<HTMLDivElement>(null);
  const audio_ref = useRef<HTMLAudioElement>(null);
  const preview_client_ref = useRef<PreviewClient | null>(null);
  const [songs, setSongs] = useState<CatalogSong[]>([]);
  const [selected_chart_id, setSelectedChartId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [scroll_top, setScrollTop] = useState(0);
  const [viewport_height, setViewportHeight] = useState(0);
  const [score_source, setScoreSource] = useState<"local" | "online">("online");
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());
  const [background_url, setBackgroundUrl] = useState<string | null>(null);

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
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const audio = audio_ref.current;
    if (!audio) return;
    audio.volume = 0.2;
    const abort_controller = new AbortController();
    const preview_client = new PreviewClient();
    preview_client_ref.current = preview_client;
    void preview_client.connect(audio, abort_controller.signal).catch((reason: unknown) => {
      if (!abort_controller.signal.aborted) console.error("Preview connection failed", reason);
    });
    return () => {
      abort_controller.abort();
      preview_client.close();
      preview_client_ref.current = null;
    };
  }, []);

  useEffect(() => {
    if (!selected_chart_id) return;
    const timer = window.setTimeout(() => {
      preview_client_ref.current?.select({ chart_id: selected_chart_id });
    }, PREVIEW_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [selected_chart_id]);

  useEffect(() => {
    const abort_controller = new AbortController();
    void catalog_provider.getSongs(abort_controller.signal).then((loaded_songs) => {
      setSongs(loaded_songs);
      if (!loaded_songs.some((song) => song.id === selected_song_id) && loaded_songs[0]) {
        onSongSelect(loaded_songs[0].id);
      }
    }).catch((reason: unknown) => {
      if (!abort_controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Failed to load song catalog");
    });
    return () => abort_controller.abort();
  }, [catalog_provider, onSongSelect]);

  useEffect(() => {
    const song = songs.find((candidate) => candidate.id === selected_song_id) ?? songs[0];
    if (song && !song.charts.some((chart) => chart.id === selected_chart_id)) {
      setSelectedChartId(song.charts.at(-1)?.id ?? null);
    }
  }, [selected_chart_id, selected_song_id, songs]);

  useEffect(() => {
    const viewport = viewport_ref.current;
    if (!viewport) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setViewportHeight(entry.contentRect.height);
    });
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);

  const normalized_query = query.trim().toLocaleLowerCase();
  const filtered_songs = normalized_query
    ? songs.filter((song) => `${song.title}\n${song.artist}\n${song.charts.map((chart) => `${chart.name} ${chart.creator}`).join("\n")}`.toLocaleLowerCase().includes(normalized_query))
    : songs;
  const selected_song = songs.find((song) => song.id === selected_song_id) ?? songs[0];
  const selected_chart = selected_song?.charts.find((chart) => chart.id === selected_chart_id)
    ?? selected_song?.charts.at(-1);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setBackgroundUrl(selected_song?.background_url ?? null);
    }, PREVIEW_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [selected_song?.background_url]);

  const first_index = Math.max(0, Math.floor(scroll_top / ROW_HEIGHT) - OVERSCAN);
  const visible_count = Math.ceil(viewport_height / ROW_HEIGHT) + OVERSCAN * 2;
  const visible_songs = filtered_songs.slice(first_index, first_index + visible_count);

  const selectSong = (song_id: string) => {
    void audio_ref.current?.play().catch(() => undefined);
    const song = songs.find((candidate) => candidate.id === song_id);
    setSelectedChartId(song?.charts.at(-1)?.id ?? null);
    onSongSelect(song_id);
  };

  const moveSelection = (offset: number) => {
    if (!filtered_songs.length) return;
    const selected_index = filtered_songs.findIndex((song) => song.id === selected_song_id);
    const next_index = Math.min(Math.max((selected_index < 0 ? 0 : selected_index) + offset, 0), filtered_songs.length - 1);
    const next_song = filtered_songs[next_index];
    if (!next_song) return;
    selectSong(next_song.id);
    const viewport = viewport_ref.current;
    if (!viewport) return;
    const row_top = next_index * ROW_HEIGHT;
    if (row_top < viewport.scrollTop) viewport.scrollTop = row_top;
    else if (row_top + ROW_HEIGHT > viewport.scrollTop + viewport.clientHeight) viewport.scrollTop = row_top + ROW_HEIGHT - viewport.clientHeight;
  };

  const date_text = new Intl.DateTimeFormat("en-GB", {
    day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(now).replace(",", "");
  const speed_progress = (scroll_speed - 400) / 1600;
  const speed_style = {
    "--rate-angle": `${speed_progress * 270}deg`,
    "--rate-rotation": `${-135 + speed_progress * 270}deg`,
  } as CSSProperties;

  return (
    <main className="song-select-screen">
      <audio ref={audio_ref} autoPlay />
      <header className="song-select-header">
        <div className="game-brand"><img src="/rizu-logo.svg" alt="" /><span>RIZU</span></div>
        <div className="session-info"><time>{date_text}</time><span className="session-elapsed">00:00:45</span><span className="online-status"><b>238</b> ONLINE</span></div>
        <nav className="header-actions" aria-label="Account and settings">
          <div className="player-info"><span><strong>Username</strong><small><b>12,450</b> PP</small></span><i /></div>
          <div className="header-icon-dock">
            <button aria-label="Settings"><Icon name="settings" /></button><button aria-label="Downloads"><Icon name="download" /></button>
            <button aria-label="Command palette"><Icon name="terminal" /></button><button aria-label="Notifications"><Icon name="bell" /><i className="notification-dot" /></button>
          </div>
        </nav>
      </header>

      <section className="library-toolbar" aria-label="Chart library controls">
        <button className="collection-button"><span><small>COLLECTION</small><strong>All songs</strong></span><Icon name="chevron-down" /></button>
        <button className="toolbar-button"><Icon name="arrow-up-down" /><span><small>SORT</small><strong>Title</strong></span></button>
        <button className="toolbar-button"><Icon name="filter" /><span><small>FILTERS</small><strong>None</strong></span></button>
        <label className="chart-search"><Icon name="search" /><input value={query} onChange={(event) => { setQuery(event.target.value); setScrollTop(0); if (viewport_ref.current) viewport_ref.current.scrollTop = 0; }} type="search" placeholder="Search songs, artists, or creators" aria-label="Search charts" /><kbd>CTRL K</kbd></label>
      </section>

      <section className="song-select-content">
        <div className="song-select-column left-column">
          <article className="song-hero">
            {background_url && <img className="song-hero-background" src={background_url} alt="" />}
            <div className="song-hero-chart"><strong>{selected_chart?.name ?? "Loading chart..."}</strong><span>{selected_chart?.creator || "Unknown creator"}</span></div>
            <div className="song-hero-metadata"><h1>{selected_song?.title ?? "Loading catalog..."}</h1><p>{selected_song?.artist ?? "Please wait"}</p></div>
          </article>
          <section className="score-list" aria-label="Scores">
            <header><span>Personal Best: <strong>95.46%</strong></span><div className="score-source">
              <button className={score_source === "local" ? "active" : ""} onClick={() => setScoreSource("local")} aria-label="Local scores" aria-pressed={score_source === "local"}><Icon name="monitor" /></button>
              <button className={score_source === "online" ? "active" : ""} onClick={() => setScoreSource("online")} aria-label="Online scores" aria-pressed={score_source === "online"}><Icon name="globe" /></button>
            </div></header>
            <button className="score-row filled"><span className="score-avatar" aria-hidden="true">U</span><span className="score-player">#1 Username</span><span className="score-details"><strong>99.33%</strong><span><b>CONST 1.05x</b> 1 second ago</span></span></button>
            {[0, 1, 2, 3].map((row) => <div className="score-row" key={row} aria-hidden="true" />)}
          </section>
        </div>

        <div className="song-select-column right-column">
          <section className="chart-summary" aria-label="Selected chart information">
            <div className="chart-difficulty"><span className="chart-mode"><span>{selected_chart ? chartMode(selected_chart) : "NO CHART"}</span><b>{selected_chart?.difficulty.toFixed(1) ?? "0.0"}</b><em>NPS</em></span></div>
            <div className="chart-metadata"><span><Icon name="clock" /><b>{formatDuration(selected_chart?.duration_seconds ?? 0)}</b></span><span><Icon name="music" /><b>{selected_chart?.note_count.toLocaleString() ?? "0"}</b></span><span title={selected_chart ? `${Math.round(selected_chart.bpm_min)}-${Math.round(selected_chart.bpm_max)} BPM` : undefined}><Icon name="metronome" /><b>{Math.round(selected_chart?.bpm_avg ?? 0)} BPM</b></span><span><strong>LN</strong><b className="accent">{Math.round((selected_chart?.long_note_ratio ?? 0) * 100)}%</b></span><span><Icon name="file" /><b>{selected_chart?.format.toUpperCase() ?? "-"}</b></span></div>
          </section>
          <section className="chart-browser" aria-label="Chart browser">
            <div className="difficulty-strip"><button aria-label="Previous difficulties"><Icon name="chevron-left" /></button><div>
              {selected_song?.charts.map((chart) => <button className={chart.id === selected_chart?.id ? "selected" : ""} key={chart.id} onClick={() => setSelectedChartId(chart.id)} style={{ "--difficulty-color": difficultyColor(chart.difficulty) } as CSSProperties} title={`${chart.name} by ${chart.creator}`}><strong>{chart.difficulty.toFixed(1)}</strong><span>{chartMode(chart)}</span></button>)}
            </div><button aria-label="Next difficulties"><Icon name="chevron-right" /></button></div>
            {error ? <p className="song-library-error">{error}</p> : <div className="chart-list" ref={viewport_ref} role="listbox" aria-label="Songs" tabIndex={0} onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)} onKeyDown={(event) => {
              if (event.key === "ArrowUp" || event.key === "ArrowDown") { event.preventDefault(); moveSelection(event.key === "ArrowUp" ? -1 : 1); }
              if (event.key === "Enter" && selected_chart) onPlay(selected_chart.id);
            }}><div className="chart-list-space" style={{ height: filtered_songs.length * ROW_HEIGHT }}>
               {visible_songs.map((song, offset) => { const hardest_chart = song.charts.at(-1); return <button aria-selected={song.id === selected_song_id} className={`chart-row${song.id === selected_song_id ? " selected" : ""}`} key={song.id} onClick={() => selectSong(song.id)} onDoubleClick={() => hardest_chart && onPlay(hardest_chart.id)} role="option" style={{ "--row-offset": `${(first_index + offset) * ROW_HEIGHT}px`, "--difficulty-color": difficultyColor(hardest_chart?.difficulty ?? 0) } as CSSProperties}><span><strong>{song.title}</strong><small>{song.artist}</small></span><i className={(first_index + offset) % 3 === 0 ? "ranked" : ""} /></button>; })}
            </div>{filtered_songs.length === 0 && <p className="empty-library">No songs match “{query}”</p>}</div>}
          </section>
        </div>
      </section>

      <footer className="song-select-footer">
        <button className="back-control" type="button"><Icon name="undo" /><span>BACK</span></button>
        <nav className="loadout-controls" aria-label="Loadout"><button className="mods"><Icon name="puzzle" /><span>MODS</span></button><button className="mutators"><Icon name="zap" /><span>MUTATORS</span><b>0</b></button><button className="inputs"><Icon name="keyboard" /><span>INPUTS</span></button><button className="skins"><Icon name="paintbrush" /><span>SKINS</span></button></nav>
        <div className="play-controls"><div className="play-modifiers"><strong>SCROLL SPEED</strong><label className="rate-control"><output htmlFor="scroll-speed">{scroll_speed}</output><span className="rate-knob" style={speed_style}><span /><input id="scroll-speed" type="range" min="400" max="2000" step="100" value={scroll_speed} aria-label="Scroll speed" onChange={(event) => onScrollSpeedChange(Number(event.target.value))} /></span></label><span className="modifier-flag"><Icon name="activity" /><small>CONST</small></span></div><button className="play-control" disabled={!selected_chart} onClick={() => selected_chart && onPlay(selected_chart.id)}><span>PLAY</span><Icon name="play" /></button></div>
      </footer>
    </main>
  );
}
