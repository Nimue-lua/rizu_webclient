import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
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

export function ChartBrowserWindow({ library, previewPlayer }: {
  library: LibraryController;
  previewPlayer: SongPreviewPlayer;
}) {
  const selector = library.chart_selector;
  const selection = useSyncExternalStore(selector.subscribe, selector.getSnapshot);
  const preview_paused = useSyncExternalStore(previewPlayer.subscribe, previewPlayer.getPaused);
  const [local_media, setLocalMedia] = useState<LocalPreviewMedia | null>(null);

  useEffect(() => {
    void library.load().catch(() => undefined);
    return () => previewPlayer.stop(200);
  }, [library.load, previewPlayer]);

  const songs = useMemo(() => sortSongs(selector.getFilteredSongs(), selection.sort_mode), [selector, selection]);
  const selected_song = selector.getSelectedSong();
  const selected_chart = selector.getSelectedChart();

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
        <button type="button" onClick={library.refresh} disabled={loading}>{loading ? "Loading..." : "Refresh"}</button>
      </div>

      <div className="windows-xp-chart-workspace">
        <aside className="windows-xp-song-pane" aria-label="Songs">
          <div className="windows-xp-pane-heading">Music Library</div>
          <div className="windows-xp-song-list" role="listbox" tabIndex={0} onKeyDown={(event) => {
            if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
            event.preventDefault();
            selector.scrollLevel(event.key === "ArrowUp" ? -1 : 1);
          }}>
            {songs.map((song) => (
              <button key={song.id} type="button" role="option" aria-selected={song.id === selected_song?.id}
                className={song.id === selected_song?.id ? "selected" : ""} onClick={() => selector.selectSong(song.id)}>
                <strong>{song.title}</strong>
                <span>{song.artist}</span>
                <small>{song.charts.length} chart{song.charts.length === 1 ? "" : "s"}</small>
              </button>
            ))}
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
            <div className="windows-xp-difficulty-list">
              {selected_song?.charts.map((chart) => (
                <button key={chart.id} type="button" className={chart.id === selected_chart?.id ? "selected" : ""}
                  onClick={() => selector.selectChart(chart.id)}>
                  <span className="windows-xp-chart-rating">{chart.difficulty.toFixed(1)}</span>
                  <span className="windows-xp-chart-name"><strong>{chart.name}</strong><small>Mapped by {chart.creator}</small></span>
                  <span className="windows-xp-chart-mode">{chartMode(chart)}</span>
                  <span className="windows-xp-chart-length">{formatDuration(chart.duration_seconds)}</span>
                </button>
              ))}
            </div>
          </fieldset>

          {selected_chart && <div className="windows-xp-chart-properties">
            <span><b>{Math.round(selected_chart.bpm_avg)}</b> BPM</span>
            <span><b>{selected_chart.note_count.toLocaleString()}</b> notes</span>
            <span><b>{Math.round(selected_chart.long_note_ratio * 100)}%</b> LN</span>
            <span><b>{selected_chart.format.toUpperCase()}</b> format</span>
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
