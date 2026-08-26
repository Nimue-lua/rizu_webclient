import { useState } from "react";
import type { ChartfileSetView, Chartview } from "../../library/views";
import { SongSelectIcon } from "./SongSelectUi";

interface SelectedSongPanelProps {
  background_url: string | null;
  background_loaded: boolean;
  selected_chart: Chartview | undefined;
  selected_song: ChartfileSetView | undefined;
  onBackgroundLoaded: () => void;
}

export function SelectedSongPanel({ background_url, background_loaded, selected_chart, selected_song, onBackgroundLoaded }: SelectedSongPanelProps) {
  const [score_source, setScoreSource] = useState<"local" | "online">("online");

  return (
    <div className="song-select-column left-column">
      <article className={`song-hero${background_loaded ? " loaded" : ""}`}>
        {background_url && <img key={background_url} className="song-hero-background" src={background_url} alt="" onLoad={onBackgroundLoaded} onError={onBackgroundLoaded} />}
        <div className="song-hero-chart"><strong>{selected_chart?.name ?? "Loading chart..."}</strong><span>{selected_chart?.creator || "Unknown creator"}</span></div>
        <div className="song-hero-metadata"><h1>{selected_song?.title ?? "Loading catalog..."}</h1><p>{selected_song?.artist ?? "Please wait"}</p></div>
      </article>
      <section className="score-list" aria-label="Scores">
        <header><span>Not played yet</span><div className="score-source">
          <button className={score_source === "local" ? "active" : ""} onClick={() => setScoreSource("local")} aria-label="Local scores" aria-pressed={score_source === "local"}><SongSelectIcon name="monitor" /></button>
          <button className={score_source === "online" ? "active" : ""} onClick={() => setScoreSource("online")} aria-label="Online scores" aria-pressed={score_source === "online"}><SongSelectIcon name="globe" /></button>
        </div></header>
        <div className="no-records"><SongSelectIcon name="trophy" /><span>No Records Set!</span></div>
      </section>
    </div>
  );
}
