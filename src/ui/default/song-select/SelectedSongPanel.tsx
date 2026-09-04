import { useEffect, useState } from "react";
import { Sigma } from "lucide-react";
import type { ChartfileSetView, Chartview } from "../../../library/views";
import { listOnlineScores, type OnlineScore } from "../../../replay/ReplayServer";
import type { StoredPlay } from "../../../replay/ReplayStore";
import { SongSelectIcon } from "./SongSelectUi";

const GRADE_COLORS: Readonly<Record<string, string>> = {
  X: "#00b4fc",
  S: "#FFE342",
  A: "#95FF74",
  B: "#c57ffd",
  C: "#f96baf",
  D: "#ff6a78",
};

interface ScoreRow {
  readonly play: StoredPlay;
  readonly grade: string;
  readonly color: string;
  readonly accuracy: number;
  readonly mods: string;
}

interface OnlineScoreRow {
  readonly score: OnlineScore;
  readonly grade: string;
  readonly color: string;
  readonly accuracy: number;
  readonly mods: string;
}

interface ReplayBaseSummary {
  readonly rate?: unknown;
  readonly mode?: unknown;
  readonly const?: unknown;
  readonly tap_only?: unknown;
}

function scoreRow(play: StoredPlay): ScoreRow | null {
  if (play.accuracy === null) return null;
  try {
    const replay_base = JSON.parse(play.replay_base_json) as ReplayBaseSummary;
    const grade = play.grade && GRADE_COLORS[play.grade.toUpperCase()] ? play.grade.toUpperCase() : "D";
    const mods: string[] = [];
    if (typeof replay_base.rate === "number" && replay_base.rate !== 1) mods.push(`${replay_base.rate.toFixed(2).replace(/0+$/, "").replace(/\.$/, "")}x`);
    if (replay_base.mode === "mania" && replay_base.const === true) mods.push("Const");
    if (replay_base.mode === "mania" && replay_base.tap_only === true) mods.push("No Long Note");
    return { play, grade, color: GRADE_COLORS[grade] ?? GRADE_COLORS.D, accuracy: play.accuracy, mods: mods.join(" ") || "No mods" };
  } catch {
    return null;
  }
}

function replayMods(replay_base: ReplayBaseSummary): string {
  const mods: string[] = [];
  if (typeof replay_base.rate === "number" && replay_base.rate !== 1) mods.push(`${replay_base.rate.toFixed(2).replace(/0+$/, "").replace(/\.$/, "")}x`);
  if (replay_base.mode === "mania" && replay_base.const === true) mods.push("Const");
  if (replay_base.mode === "mania" && replay_base.tap_only === true) mods.push("No Long Note");
  return mods.join(" ") || "No mods";
}

function onlineScoreRow(score: OnlineScore): OnlineScoreRow | null {
  if (typeof score.accuracy !== "number") return null;
  const grade = score.grade && GRADE_COLORS[score.grade.toUpperCase()] ? score.grade.toUpperCase() : "D";
  const replay_base = typeof score.replay_base === "object" && score.replay_base !== null
    ? score.replay_base as ReplayBaseSummary
    : {};
  return { score, grade, color: GRADE_COLORS[grade] ?? GRADE_COLORS.D, accuracy: score.accuracy, mods: replayMods(replay_base) };
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
  nickname: string;
  background_url: string | null;
  background_loaded: boolean;
  selected_chart: Chartview | undefined;
  selected_song: ChartfileSetView | undefined;
  stored_plays: readonly StoredPlay[];
  onBackgroundLoaded: () => void;
  onAutoplay: () => void;
  onTogglePreview: () => void;
  preview_paused: boolean;
  onReplay: (play: StoredPlay) => void;
}

export function SelectedSongPanel({ nickname, background_url, background_loaded, selected_chart, selected_song,
  stored_plays, onBackgroundLoaded, onAutoplay, onTogglePreview, preview_paused, onReplay }: SelectedSongPanelProps) {
  const [score_source, setScoreSource] = useState<"local" | "online">("online");
  const [online_scores, setOnlineScores] = useState<readonly OnlineScore[]>([]);
  const [online_scores_state, setOnlineScoresState] = useState<"idle" | "loading" | "loaded" | "error">("idle");
  const scores = stored_plays.map(scoreRow).filter((score): score is ScoreRow => score !== null)
    .sort((left, right) => right.accuracy - left.accuracy || right.play.played_at.localeCompare(left.play.played_at)).slice(0, 5);
  const online_rows = online_scores.map(onlineScoreRow).filter((score): score is OnlineScoreRow => score !== null);
  const personal_best = scores[0];

  useEffect(() => {
    if (score_source !== "online" || !selected_chart) return;
    const abort_controller = new AbortController();
    setOnlineScores([]);
    setOnlineScoresState("loading");
    void listOnlineScores(selected_chart.chart_md5, selected_chart.chart_index, abort_controller.signal).then((loaded_scores) => {
      setOnlineScores(loaded_scores);
      setOnlineScoresState("loaded");
    }).catch((error: unknown) => {
      if (abort_controller.signal.aborted) return;
      console.error("Could not load online scores", error);
      setOnlineScoresState("error");
    });
    return () => abort_controller.abort();
  }, [score_source, selected_chart?.chart_md5, selected_chart?.chart_index]);

  return (
    <div className="song-select-column left-column">
      <article className={`song-hero${background_loaded ? " loaded" : ""}`}>
        {background_url && <img key={background_url} className="song-hero-background" src={background_url} alt="" onLoad={onBackgroundLoaded} onError={onBackgroundLoaded} />}
        <button className="song-hero-preview-toggle" type="button" disabled={!selected_chart}
          aria-label={preview_paused ? "Resume song preview" : "Pause song preview"} onClick={onTogglePreview}>
          <SongSelectIcon name={preview_paused ? "play" : "pause"} />
        </button>
        <button className="song-hero-autoplay" type="button" disabled={!selected_chart} onClick={onAutoplay}>
          <SongSelectIcon name="play" /><span>AUTO</span>
        </button>
        <div className="song-hero-chart" key={selected_chart?.id ?? "no-chart"}><strong>{selected_chart?.name ?? "Loading chart..."}</strong><span>{selected_chart?.creator || "Unknown creator"}</span></div>
        <table className="song-skill-table" aria-label="Chart skill ratings">
          <thead><tr><th>Speed</th><th>Dexterity</th><th>Stamina</th><th>Technical</th></tr></thead>
          <tbody><tr>
            {[selected_chart?.speed, selected_chart?.dexterity, selected_chart?.stamina, selected_chart?.technical]
              .map((skill, index) => <td key={index}>{skill == null ? "-" : skill.toFixed(2)}</td>)}
          </tr></tbody>
        </table>
        <div className="song-hero-metadata" key={selected_song?.id ?? "no-song"}><h1>{selected_song?.title ?? "Loading catalog..."}</h1><p>{selected_song?.artist ?? "Please wait"}</p></div>
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
              <span className="score-player">#{index + 1} {nickname}</span>
              <span className="score-details">
                <strong>{(score.accuracy * 100).toFixed(2)}%</strong>
                <span><b>{score.mods}</b><time dateTime={score.play.played_at}>{formatPlayDate(score.play.played_at)}</time></span>
              </span>
            </button>;
          })}
        </div> : score_source === "online" && online_rows.length > 0 ? <div className="score-rows">
          {Array.from({ length: 5 }, (_, index) => {
            const row = online_rows[index];
            if (!row) return <div className="score-row" key={`online-empty-${index}`} aria-hidden="true" />;
            return <div className="score-row filled" key={row.score.id}
              style={{ "--grade-color": row.color } as React.CSSProperties}>
              <div className="score-avatar" aria-label="Avatar placeholder" />
              <div className="score-player-block">
                <span className="score-player">#{index + 1} {row.score.nickname || "Anonymous"}</span>
                {row.score.comment && <span className="score-comment">{row.score.comment}</span>}
              </div>
              <span className="score-details">
                <strong>{(row.accuracy * 100).toFixed(2)}%</strong>
                <span><b>{row.score.max_skill_difficulty.toFixed(2)}<Sigma aria-hidden="true" /></b><time dateTime={row.score.played_at}>{formatPlayDate(row.score.played_at)}</time></span>
              </span>
            </div>;
          })}
        </div> : <div className="no-records"><SongSelectIcon name="trophy" /><span>{score_source === "local" ? "No Records Set!" : online_scores_state === "loading" ? "Loading online scores..." : online_scores_state === "error" ? "Could not load online scores" : "No online scores yet"}</span></div>}
      </section>
    </div>
  );
}
