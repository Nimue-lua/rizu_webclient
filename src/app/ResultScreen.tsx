import { useEffect } from "react";
import { Clock3, Metronome, Play, Star } from "lucide-react";
import type { ScoreResult } from "../gameplay/scoring/ScoreResult";
import { JudgeSegmentsCanvas } from "./JudgeSegmentsCanvas";

const GRADE_COLORS: Readonly<Record<string, string>> = {
  X: "rgb(153 204 255)",
  S: "rgb(242 203 48)",
  A: "rgb(18 204 143)",
  B: "rgb(26 99 255)",
  C: "rgb(107 122 130)",
  D: "rgb(130 94 0)",
};
const FALLBACK_GRADE_COLOR = "rgb(130 94 0)";

function formatDuration(duration_seconds: number): string {
  const seconds = Math.max(0, Math.round(duration_seconds));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

interface ResultScreenProps {
  score: ScoreResult | null;
  title: string;
  artist: string;
  chart_name: string;
  duration_seconds: number;
  long_note_ratio: number;
  bpm: number;
  music_rate: number;
  difficulty: number;
  overall_difficulty: number;
  mode: "mania" | "osu";
  onReplay: () => void;
  onExit: () => void;
}

export function ResultScreen({ score, title, artist, chart_name, duration_seconds,
  long_note_ratio, bpm, music_rate, difficulty, overall_difficulty, mode, onReplay, onExit }: ResultScreenProps) {
  const grade_color = GRADE_COLORS[score?.grade ?? ""] ?? FALLBACK_GRADE_COLOR;

  useEffect(() => {
    const handle_key_down = (event: KeyboardEvent) => {
      if (event.code === "Escape") {
        onExit();
      }
    };

    window.addEventListener("keydown", handle_key_down);
    return () => window.removeEventListener("keydown", handle_key_down);
  }, [onExit]);

  return (
    <main className="screen result-screen">
      <div className="result-bottom-gradient" />
      <button className="result-replay" type="button" onClick={onReplay}>
        <Play fill="currentColor" aria-hidden="true" /> Watch replay
      </button>
      <div className="result-panels">
        <div className="result-side-panel">
          <div className="result-chart-meta">
            <span><Clock3 aria-hidden="true" /><b>{formatDuration(duration_seconds / music_rate)}</b></span>
            <span><em>LN</em><b>{Math.round(long_note_ratio * 100)}%</b></span>
            <span><Metronome aria-hidden="true" /><b>{Math.round(bpm * music_rate)}</b></span>
          </div>
          <div className="result-play-meta">
            <span>{music_rate.toFixed(2)}x</span>
            <strong>{difficulty.toFixed(1)}</strong><small><Star aria-label="stars" /></small>
          </div>
          <div className="result-score-system">
            {mode === "osu" ? "osu!standard" : "osu!mania V2"} OD{overall_difficulty.toFixed(1).replace(/\.0$/, "")}
          </div>
        </div>
        <div className="result-circle-panel">
          {score?.judge_names && score.judges && (
            <JudgeSegmentsCanvas
              judges={score.judge_names.map((name) => score.judges?.[name] ?? 0)}
              judge_names={score.judge_names}
            />
          )}
          {score?.grade && <span className="result-grade" style={{ color: grade_color }}>{score.grade}</span>}
          {score?.accuracy !== undefined && (
            <span className="result-accuracy" style={{ color: grade_color }}>
              {(score.accuracy * 100).toFixed(2)}%
            </span>
          )}
          {score?.judges && <span className="result-misses">{score.judges.miss ?? 0}x</span>}
        </div>
      </div>
      <div className="result-song-metadata">
        <div><h2>{title}</h2><p>{artist}</p></div>
        <strong>{chart_name}</strong>
      </div>
    </main>
  );
}
