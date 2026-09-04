import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { SongPreviewPlayer } from "../../audio/SongPreviewPlayer";
import type { LibraryController } from "../../library/LibraryController";
import { readLocalFile } from "../../library/LocalLibraryStore";
import type { ChartfileSetView, Chartview } from "../../library/views";
import type { ChartSortMode } from "../../select/ChartSelector";

interface LocalPreviewMedia {
  chart_id: string;
  audio_url: string;
  background_url: string | null;
}

const SONG_ROW_HEIGHT = 52;
const SONG_ROW_OVERSCAN = 5;

function formatDuration(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
}

function chartMode(chart: Chartview) {
  if (chart.mode === 3) return `${chart.keys ?? "?"}K Mania`;
  if (chart.mode === 0) return "osu!standard";
  return `Mode ${chart.mode}`;
}

function sortSongs(songs: readonly ChartfileSetView[], mode: ChartSortMode) {
  return [...songs].sort((left, right) => {
    if (mode === "artist") return left.artist.localeCompare(right.artist) || left.title.localeCompare(right.title);
    if (mode === "difficulty") {
      return Math.max(...left.charts.map((chart) => chart.difficulty)) - Math.max(...right.charts.map((chart) => chart.difficulty));
    }
    if (mode === "duration") {
      return Math.max(...left.charts.map((chart) => chart.duration_seconds)) - Math.max(...right.charts.map((chart) => chart.duration_seconds));
    }
    return left.title.localeCompare(right.title) || left.artist.localeCompare(right.artist);
  });
}

export function ChartBrowserWindow({ library, previewPlayer, masterVolume, onOpenFilter, onOpenModifiers, onPlay }: {
  library: LibraryController;
  previewPlayer: SongPreviewPlayer;
  masterVolume: number;
  onOpenFilter: () => void;
  onOpenModifiers: () => void;
  onPlay: (chart: Chartview, song: ChartfileSetView) => void;
}) {
  const selector = library.chart_selector;
  const selection = useSyncExternalStore(selector.subscribe, selector.getSnapshot);
  const preview_paused = useSyncExternalStore(previewPlayer.subscribe, previewPlayer.getPaused);
  const [local_media, setLocalMedia] = useState<LocalPreviewMedia | null>(null);
  const song_list_ref = useRef<HTMLDivElement>(null);
  const restored_song_scroll_ref = useRef(false);
  const chart_list_ref = useRef<HTMLDivElement>(null);
  const selected_chart_ref = useRef<HTMLButtonElement>(null);
  const [song_window, setSongWindow] = useState({ first_index: 0, visible_count: SONG_ROW_OVERSCAN * 2 + 1 });

  useEffect(() => {
    void library.load().catch(() => undefined);
    return () => previewPlayer.stop(200);
  }, [library.load, previewPlayer]);

  useEffect(() => {
    previewPlayer.setVolume(masterVolume);
  }, [masterVolume, previewPlayer]);

  const songs = useMemo(() => sortSongs(selector.getFilteredSongs(), selection.sort_mode), [selector, selection]);
  const selected_song = songs.find((song) => song.id === selection.selected_song_id) ?? songs[0];
  const selected_chart = selected_song?.charts.find((chart) => chart.id === selection.selected_chart_id) ?? selected_song?.charts.at(-1);
  const visible_songs = songs.slice(song_window.first_index, song_window.first_index + song_window.visible_count);

  useLayoutEffect(() => {
    const song_list = song_list_ref.current;
    if (!song_list) return;
    const updateVisibleCount = (height: number) => {
      const visible_count = Math.ceil(height / SONG_ROW_HEIGHT) + SONG_ROW_OVERSCAN * 2;
      setSongWindow((current) => current.visible_count === visible_count ? current : { ...current, visible_count });
    };
    updateVisibleCount(song_list.clientHeight);
    const observer = new ResizeObserver(([entry]) => {
      if (entry) updateVisibleCount(entry.contentRect.height);
    });
    observer.observe(song_list);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    if (restored_song_scroll_ref.current) return;
    const song_list = song_list_ref.current;
    const selected_index = songs.findIndex((song) => song.id === selected_song?.id);
    if (!song_list || selected_index < 0 || song_list.clientHeight === 0) return;
    const centered_scroll_top = Math.max(0,
      selected_index * SONG_ROW_HEIGHT + SONG_ROW_HEIGHT / 2 - song_list.clientHeight / 2);
    song_list.scrollTop = centered_scroll_top;
    const first_index = Math.max(0, Math.floor(centered_scroll_top / SONG_ROW_HEIGHT) - SONG_ROW_OVERSCAN);
    setSongWindow((current) => current.first_index === first_index ? current : { ...current, first_index });
    restored_song_scroll_ref.current = true;
  }, [selected_song?.id, selection.sort_mode, songs]);

  useLayoutEffect(() => {
    const chart_list = chart_list_ref.current;
    const selected_button = selected_chart_ref.current;
    if (!chart_list || !selected_button) return;
    const list_bounds = chart_list.getBoundingClientRect();
    const button_bounds = selected_button.getBoundingClientRect();
    chart_list.scrollTop += button_bounds.top + button_bounds.height / 2
      - (list_bounds.top + list_bounds.height / 2);
  }, [selected_chart?.id, selected_song?.id]);

  useEffect(() => {
    setLocalMedia(null);
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
      if (active) setLocalMedia({ chart_id: selected_chart.id, audio_url, background_url });
    }).catch(() => {
      if (active) previewPlayer.stop(200);
    });
    return () => {
      active = false;
      for (const url of urls) URL.revokeObjectURL(url);
    };
  }, [previewPlayer, selected_chart?.audio_path, selected_chart?.background_path, selected_chart?.id,
    selected_chart?.source_id, selected_chart?.source_type]);

  const selected_local_media = local_media?.chart_id === selected_chart?.id ? local_media : null;
  const background_url = selected_local_media?.background_url ?? selected_chart?.background_url ?? null;
  const audio_url = selected_local_media?.audio_url ?? selected_chart?.preview_audio_url ?? selected_chart?.audio_url ?? "";
  const preview_time = selected_local_media ? selected_chart?.preview_time ?? 0
    : selected_chart?.preview_audio_url ? 0 : selected_chart?.preview_time ?? 0;

  useEffect(() => {
    if (selected_chart?.source_type === "local" && !selected_local_media) return;
    previewPlayer.select(selected_song?.id ?? "", audio_url, preview_time);
  }, [audio_url, previewPlayer, preview_time, selected_chart?.source_type, selected_local_media, selected_song?.id]);

  const loading = library.loading_progress.size > 0;

  return (
    <section className="windows-xp-chart-browser" onPointerDownCapture={() => previewPlayer.unlock()}>
      <div className="windows-xp-chart-toolbar">
        <label>
          <span>Collection</span>
          <select value={selection.selected_location_id ?? ""} onChange={(event) =>
            selector.selectLocation(event.target.value ? Number(event.target.value) : null)}>
            <option value="">All songs</option>
            {selection.locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}
          </select>
        </label>
        <label className="windows-xp-chart-search">
          <span>Search</span>
          <input type="search" value={selection.query} placeholder="Title, artist, chart..."
            onChange={(event) => selector.setQuery(event.target.value)} />
        </label>
        <label>
          <span>Sort by</span>
          <select value={selection.sort_mode} onChange={(event) => selector.setSortMode(event.target.value as ChartSortMode)}>
            <option value="title">Title</option>
            <option value="artist">Artist</option>
            <option value="difficulty">Difficulty</option>
            <option value="duration">Length</option>
          </select>
        </label>
        <button type="button" onClick={onOpenFilter}>Filter...</button>
      </div>

      <div className="windows-xp-chart-workspace">
        <aside className="windows-xp-song-pane" aria-label="Songs">
          <div className="windows-xp-pane-heading">Music Library</div>
          <div className="windows-xp-song-list" ref={song_list_ref} role="listbox" tabIndex={0} onScroll={(event) => {
            const first_index = Math.max(0, Math.floor(event.currentTarget.scrollTop / SONG_ROW_HEIGHT) - SONG_ROW_OVERSCAN);
            setSongWindow((current) => current.first_index === first_index ? current : { ...current, first_index });
          }} onKeyDown={(event) => {
            if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
            event.preventDefault();
            selector.scrollLevel(event.key === "ArrowUp" ? -1 : 1);
          }}>
            <div className="windows-xp-song-list-space" style={{ height: songs.length * SONG_ROW_HEIGHT }}>
            {visible_songs.map((song, offset) => (
              <button key={song.id} type="button" role="option" aria-selected={song.id === selected_song?.id}
                style={{ transform: `translateY(${(song_window.first_index + offset) * SONG_ROW_HEIGHT}px)` }}
                className={song.id === selected_song?.id ? "selected" : ""} onClick={() => selector.selectSong(song.id)}>
                <strong>{song.title}</strong>
                <span>{song.artist}</span>
              </button>
            ))}
            </div>
            {!loading && songs.length === 0 && <p>{selection.query ? "No matching songs." : "No songs in this collection."}</p>}
          </div>
        </aside>

        <div className="windows-xp-chart-details">
          <div className="windows-xp-chart-hero">
            {background_url ? <img src={background_url} alt="" /> : <div className="windows-xp-chart-no-art">No album art</div>}
            <div className="windows-xp-chart-hero-copy">
              <strong>{selected_song?.title ?? "Select a song"}</strong>
              <span>{selected_song?.artist ?? "Choose an item from the music library"}</span>
            </div>
            <button type="button" disabled={!audio_url} onClick={() => previewPlayer.togglePaused()}>
              {preview_paused ? "Play preview" : "Pause preview"}
            </button>
          </div>

          <fieldset className="windows-xp-difficulty-group">
            <legend>Available charts</legend>
            <div className="windows-xp-difficulty-list" ref={chart_list_ref}>
              {selected_song?.charts.map((chart) => (
                <button key={chart.id} type="button" ref={chart.id === selected_chart?.id ? selected_chart_ref : undefined}
                  className={chart.id === selected_chart?.id ? "selected" : ""}
                  onClick={() => selector.selectChart(chart.id)}>
                  <span className="windows-xp-chart-rating">{chart.difficulty.toFixed(1)}</span>
                  <span className="windows-xp-chart-name"><strong>{chart.name}</strong><small>Mapped by {chart.creator}</small></span>
                  <span className="windows-xp-chart-mode">{chartMode(chart)}</span>
                  <span className="windows-xp-chart-length">{formatDuration(chart.duration_seconds)}</span>
                </button>
              ))}
            </div>
          </fieldset>

          {selected_chart && selected_song && <div className="windows-xp-chart-properties">
            <span><b>{Math.round(selected_chart.bpm_avg)}</b> BPM</span>
            <span><b>{selected_chart.note_count.toLocaleString()}</b> notes</span>
            <span><b>{Math.round(selected_chart.long_note_ratio * 100)}%</b> LN</span>
            <span><b>{selected_chart.format.toUpperCase()}</b> format</span>
            <button type="button" onClick={onOpenModifiers}>Mods...</button>
            <button type="button" onClick={() => onPlay(selected_chart, selected_song)}>Play</button>
          </div>}
        </div>
      </div>

      <footer className="windows-xp-chart-status">
        <span>{selection.error ?? library.loading_error ?? `${songs.length} song${songs.length === 1 ? "" : "s"}`}</span>
        <span>{selected_chart ? `${selected_chart.name} | ${chartMode(selected_chart)}` : "No chart selected"}</span>
      </footer>
    </section>
  );
}
