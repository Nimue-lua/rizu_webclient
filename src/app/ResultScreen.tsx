import { useEffect } from "react";
import type { ScoreResult } from "../gameplay/scoring/ScoreEngine";
import { JudgeSegmentsCanvas } from "./JudgeSegmentsCanvas";

interface ResultScreenProps {
  score: ScoreResult | null;
  background_url: string | null;
  title: string;
  artist: string;
  chart_name: string;
  onExit: () => void;
}

export function ResultScreen({ score, background_url, title, artist, chart_name, onExit }: ResultScreenProps) {
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
      {background_url && <img className="result-background" src={background_url} alt="" />}
      <div className="result-bottom-gradient" />
      <div className="result-panels" aria-hidden="true">
        <div className="result-side-panel" />
        <div className="result-circle-panel">
          {score?.judge_names && score.judges && (
            <JudgeSegmentsCanvas judges={score.judge_names.map((name) => score.judges?.[name] ?? 0)} />
          )}
          {score?.accuracy !== undefined && <span className="result-accuracy">{(score.accuracy * 100).toFixed(2)}%</span>}
        </div>
      </div>
      <div className="result-song-metadata">
        <div><h2>{title}</h2><p>{artist}</p></div>
        <strong>{chart_name}</strong>
      </div>
    </main>
  );
}
