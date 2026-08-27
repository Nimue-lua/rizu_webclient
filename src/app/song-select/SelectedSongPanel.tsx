import { useState } from "react";
import type { ChartfileSetView, Chartview } from "../../library/views";
import type { ScoreResult } from "../../gameplay/scoring/ScoreResult";
import type { StoredPlay } from "../../replay/ReplayStore";
import { SongSelectIcon } from "./SongSelectUi";

const GRADE_COLORS: Readonly<Record<string, string>> = {
  X: "#00b4fc",
  S: "#FFE342",
  A: "#95FF74",
  B: "#c57ffd",
  C: "#f96baf",
  D: "#ff6a78",
};

interface ReplayBaseSummary {
  readonly rate?: unknown;
  readonly mode?: unknown;
  readonly const?: unknown;
  readonly tap_only?: unknown;
}

interface ScoreRow {
  readonly play: StoredPlay;
  readonly grade: string;
  readonly color: string;
  readonly accuracy: number;
  readonly mods: string;
}

function scoreRow(play: StoredPlay): ScoreRow | null {
  if (play.accuracy === null) return null;
  try {
    const score = JSON.parse(play.score_json) as ScoreResult;
    const replay_base = JSON.parse(play.replay_base_json) as ReplayBaseSummary;
    const grade = typeof score.grade === "string" && GRADE_COLORS[score.grade.toUpperCase()] ? score.grade.toUpperCase() : "D";
    const mods: string[] = [];
    if (typeof replay_base.rate === "number" && replay_base.rate !== 1) mods.push(`${replay_base.rate.toFixed(2).replace(/0+$/, "").replace(/\.$/, "")}x`);
    if (replay_base.mode === "mania" && replay_base.const === true) mods.push("Const");
    if (replay_base.mode === "mania" && replay_base.tap_only === true) mods.push("No Long Note");
    return { play, grade, color: GRADE_COLORS[grade] ?? GRADE_COLORS.D, accuracy: play.accuracy, mods: mods.join(" ") || "No mods" };
  } catch {
    return null;
  }
}

function formatPlayDate(played_at: string): string {
  const date = new Date(played_at);
  if (Number.isNaN(date.getTime())) return played_at;
  const elapsed_seconds = Math.floor((Date.now() - date.getTime()) / 1_000);
  if (elapsed_seconds >= 0 && elapsed_seconds < 7 * 24 * 60 * 60) {
    const units = [
      [24 * 60 * 60, "day"],
      [60 * 60, "hour"],
      [60, "minute"],
      [1, "second"],
    ] as const;
    const [seconds_per_unit, unit] = units.find(([seconds]) => elapsed_seconds >= seconds) ?? units.at(-1)!;
    const value = Math.floor(elapsed_seconds / seconds_per_unit);
    return `${value} ${unit}${value === 1 ? "" : "s"} ago`;
  }
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" }).format(date);
}

interface SelectedSongPanelProps {
  background_url: string | null;
  background_loaded: boolean;
  selected_chart: Chartview | undefined;
  selected_song: ChartfileSetView | undefined;
  stored_plays: readonly StoredPlay[];
  onBackgroundLoaded: () => void;
  onReplay: (play: StoredPlay) => void;
}

export function SelectedSongPanel({ background_url, background_loaded, selected_chart, selected_song, stored_plays, onBackgroundLoaded, onReplay }: SelectedSongPanelProps) {
  const [score_source, setScoreSource] = useState<"local" | "online">("local");
  const scores = stored_plays.map(scoreRow).filter((score): score is ScoreRow => score !== null)
    .sort((left, right) => right.accuracy - left.accuracy || right.play.played_at.localeCompare(left.play.played_at)).slice(0, 5);
  const personal_best = scores[0];

  return (
    <div className="song-select-column left-column">
      <article className={`song-hero${background_loaded ? " loaded" : ""}`}>
        {background_url && <img key={background_url} className="song-hero-background" src={background_url} alt="" onLoad={onBackgroundLoaded} onError={onBackgroundLoaded} />}
        <div className="song-hero-chart"><strong>{selected_chart?.name ?? "Loading chart..."}</strong><span>{selected_chart?.creator || "Unknown creator"}</span></div>
        <div className="song-hero-metadata"><h1>{selected_song?.title ?? "Loading catalog..."}</h1><p>{selected_song?.artist ?? "Please wait"}</p></div>
      </article>
      <section className="score-list" aria-label="Scores">
        <header><span>{personal_best ? <>Personal Best: <strong>{(personal_best.accuracy * 100).toFixed(2)}%</strong></> : "Not played yet"}</span><div className="score-source">
          <button className={score_source === "local" ? "active" : ""} onClick={() => setScoreSource("local")} aria-label="Local scores" aria-pressed={score_source === "local"}><SongSelectIcon name="monitor" /></button>
          <button className={score_source === "online" ? "active" : ""} onClick={() => setScoreSource("online")} aria-label="Online scores" aria-pressed={score_source === "online"}><SongSelectIcon name="globe" /></button>
        </div></header>
        {score_source === "local" && scores.length > 0 ? <div className="score-rows">
          {Array.from({ length: 5 }, (_, index) => {
            const score = scores[index];
            if (!score) return <div className="score-row" key={`empty-${index}`} aria-hidden="true" />;
            return <button type="button" className="score-row filled" key={score.play.id ?? score.play.played_at}
              style={{ "--grade-color": score.color } as React.CSSProperties} onClick={() => onReplay(score.play)} aria-label={`Watch replay for rank ${index + 1}, ${(score.accuracy * 100).toFixed(2)} percent`}>
              <div className="score-avatar" aria-label="Avatar placeholder" />
              <span className="score-player">#{index + 1} Guest</span>
              <span className="score-details">
                <strong>{(score.accuracy * 100).toFixed(2)}%</strong>
                <span><b>{score.mods}</b><time dateTime={score.play.played_at}>{formatPlayDate(score.play.played_at)}</time></span>
              </span>
            </button>;
          })}
        </div> : <div className="no-records"><SongSelectIcon name="trophy" /><span>{score_source === "online" ? "Online scores unavailable" : "No Records Set!"}</span></div>}
      </section>
    </div>
  );
}
