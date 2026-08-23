import { useEffect } from "react";
import type { ScoreResult } from "../gameplay/scoring/ScoreEngine";

interface ResultScreenProps {
  score: ScoreResult | null;
  onExit: () => void;
}

export function ResultScreen({ score, onExit }: ResultScreenProps) {
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
      {score?.score !== undefined && <h1>{Math.round(score.score)}</h1>}
      {score?.accuracy !== undefined && <h1>{(score.accuracy * 100).toFixed(2)}%</h1>}
      {score?.combo !== undefined && <p>{score.combo}x combo, {score.max_combo}x maximum</p>}
      {score?.judges && score.judge_names && (
        <dl>
          {score.judge_names.map((judge) => (
            <div key={judge}>
              <dt>{judge}</dt>
              <dd>{score.judges?.[judge] ?? 0}</dd>
            </div>
          ))}
        </dl>
      )}
      <span>Escape: song select</span>
    </main>
  );
}
