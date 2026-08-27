import type { CSSProperties, KeyboardEvent, RefObject } from "react";
import { Star } from "lucide-react";
import type { ChartfileSetView, Chartview } from "../../library/views";
import type { ChartSelectionEntry, ChartSortMode } from "../../select/ChartSelector";
import { ChartModeBadge, chartSummaryMode, difficultyColor, formatDuration, SongSelectIcon } from "./SongSelectUi";

interface ChartBrowserProps {
  chart_level_sort: boolean;
  difficulty_strip_ref: RefObject<HTMLDivElement | null>;
  error: string | null;
  first_index: number;
  query: string;
  selected_chart: Chartview | undefined;
  selected_difficulty_ref: RefObject<HTMLButtonElement | null>;
  selected_song: ChartfileSetView | undefined;
  selection_entries: readonly ChartSelectionEntry[];
  sort_mode: ChartSortMode;
  viewport_ref: RefObject<HTMLDivElement | null>;
  visible_entries: readonly ChartSelectionEntry[];
  onChartSelect: (chart_id: string) => void;
  onEntryPlay: (entry: ChartSelectionEntry) => void;
  onEntrySelect: (entry: ChartSelectionEntry) => void;
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
  onMoveDifficulty: (offset: -1 | 1) => void;
  onScroll: (scroll_top: number) => void;
  isEntrySelected: (entry: ChartSelectionEntry) => boolean;
}

export function ChartBrowser({ chart_level_sort, difficulty_strip_ref, error, first_index, query, selected_chart,
  selected_difficulty_ref, selected_song, selection_entries, sort_mode, viewport_ref, visible_entries,
  onChartSelect, onEntryPlay, onEntrySelect, onKeyDown, onMoveDifficulty, onScroll, isEntrySelected }: ChartBrowserProps) {
  return (
    <div className="song-select-column right-column">
      <section className="chart-summary" aria-label="Selected chart information">
        <div className="chart-difficulty" style={{ "--difficulty-color": difficultyColor(selected_chart?.difficulty ?? 0) } as CSSProperties}>
          <span className="chart-rating"><b>{selected_chart?.difficulty.toFixed(1) ?? "0.0"}</b><em><Star aria-label="stars" /></em></span>
          <span className="chart-mode">{selected_chart ? chartSummaryMode(selected_chart) : "NO CHART"}</span>
        </div>
        <div className="chart-metadata">
          <span><SongSelectIcon name="clock" /><b>{formatDuration(selected_chart?.duration_seconds ?? 0)}</b></span>
          <span><SongSelectIcon name="music" /><b>{selected_chart?.note_count.toLocaleString() ?? "0"}</b></span>
          <span title={selected_chart ? `${Math.round(selected_chart.bpm_min)}-${Math.round(selected_chart.bpm_max)} BPM` : undefined}><SongSelectIcon name="metronome" /><b>{Math.round(selected_chart?.bpm_avg ?? 0)} BPM</b></span>
          <span><strong>LN</strong><b className="accent">{Math.round((selected_chart?.long_note_ratio ?? 0) * 100)}%</b></span>
          <span><SongSelectIcon name="file" /><b>{selected_chart?.format.toUpperCase() ?? "-"}</b></span>
        </div>
      </section>
      <section className={`chart-browser${chart_level_sort ? " chart-level-browser" : ""}`} aria-label="Chart browser">
        {!chart_level_sort && <div className="difficulty-strip">
          <button aria-label="Previous difficulty" onClick={() => onMoveDifficulty(-1)}><SongSelectIcon name="chevron-left" /></button>
          <div ref={difficulty_strip_ref}>{selected_song?.charts.map((chart) =>
            <button ref={chart.id === selected_chart?.id ? selected_difficulty_ref : undefined} className={chart.id === selected_chart?.id ? "selected" : ""} key={chart.id} onClick={() => onChartSelect(chart.id)} style={{ "--difficulty-color": difficultyColor(chart.difficulty) } as CSSProperties} title={`${chart.name} by ${chart.creator}`}>
              <strong>{chart.difficulty.toFixed(1)}</strong><ChartModeBadge chart={chart} />
            </button>)}</div>
          <button aria-label="Next difficulty" onClick={() => onMoveDifficulty(1)}><SongSelectIcon name="chevron-right" /></button>
        </div>}
        {error ? <p className="song-library-error">{error}</p> :
          <div className="chart-list" ref={viewport_ref} role="listbox" aria-label="Songs" tabIndex={0} onScroll={(event) => onScroll(event.currentTarget.scrollTop)} onKeyDown={onKeyDown}>
            <div className="chart-list-space" style={{ height: selection_entries.length * 82 }}>
              {visible_entries.map((entry, offset) => {
                const chart = entry.chart ?? entry.song.charts.at(-1);
                const selected = isEntrySelected(entry);
                return <button aria-selected={selected} className={`chart-row${entry.chart ? " chart-entry-row" : ""}${selected ? " selected" : ""}`} key={entry.key} onClick={() => onEntrySelect(entry)} onDoubleClick={() => onEntryPlay(entry)} role="option" style={{ "--row-offset": `${(first_index + offset) * 82}px`, "--difficulty-color": difficultyColor(chart?.difficulty ?? 0) } as CSSProperties}>
                  <span className="chart-row-copy">{entry.chart
                    ? <><strong>{entry.song.title} <span className="chart-row-artist"><span className="chart-row-separator">//</span> {entry.song.artist}</span></strong><em>{entry.chart.name}{sort_mode === "duration" && ` // ${formatDuration(entry.chart.duration_seconds)}`}</em></>
                    : <><strong>{entry.song.title}</strong><small>{entry.song.artist}</small></>}
                  </span><i className={(first_index + offset) % 3 === 0 ? "ranked" : ""} />
                </button>;
              })}
            </div>
            {selection_entries.length === 0 && <p className="empty-library">{query ? `No songs match “${query}”` : "No songs in this collection"}</p>}
          </div>}
      </section>
    </div>
  );
}
