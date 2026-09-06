import { useEffect, useRef, useState } from "react";
import type { DanController } from "../../dan/DanCourse";
import { danAccuracy } from "../../dan/DanCourse";

const accuracy = (value: number | undefined) => `${((value ?? 0) * 100).toFixed(2)}%`;
const BREAK_DURATION_SECONDS = 8;

export function DanBreakScreen({ dan, onContinue, onExit }: {
  dan: DanController;
  onContinue?: () => void;
  onExit: () => void;
}) {
  const [seconds_remaining, setSecondsRemaining] = useState(BREAK_DURATION_SECONDS);
  const continued = useRef(false);
  const final = dan.result;
  const total = final?.accuracy ?? danAccuracy(dan.completed_stages.map((stage) => stage.score), dan.course?.mode);
  const misses = dan.completed_stages.reduce((sum, stage) => sum + (stage.score.judges?.miss ?? 0), 0);
  const continueCourse = () => {
    if (!onContinue || continued.current) return;
    continued.current = true;
    onContinue();
  };

  useEffect(() => {
    if (!onContinue) return;
    const deadline = performance.now() + BREAK_DURATION_SECONDS * 1_000;
    const interval = window.setInterval(() => {
      setSecondsRemaining(Math.max(0, Math.ceil((deadline - performance.now()) / 1_000)));
    }, 100);
    const timeout = window.setTimeout(continueCourse, BREAK_DURATION_SECONDS * 1_000);
    return () => {
      window.clearInterval(interval);
      window.clearTimeout(timeout);
    };
  }, [onContinue]);

  return <main className={`dan-break-screen ${final?.cleared ? "cleared" : ""}`}>
    <header className="dan-break-header">
      <h1>{dan.course?.name}</h1>
      {final && <strong className="dan-course-outcome">{final.cleared ? "DAN CLEAR" : "NOT CLEARED"}</strong>}
    </header>
    <section className="dan-break-summary">
      <div className="dan-summary-stat"><span>Total accuracy</span><strong>{accuracy(total)}</strong></div>
      <div className="dan-summary-stat"><span>Required accuracy</span><strong>{accuracy(dan.course?.goal_accuracy)}</strong></div>
      <div className="dan-summary-stat"><span>Total misses</span><strong>{misses}</strong></div>
    </section>
    <section className="dan-result-stage-list" aria-label="Course stages">
      {dan.course?.stages.map((stage, index) => {
        const result = dan.completed_stages[index]?.score;
        return <article key={stage.chart.id} className={result ? "complete" : index === dan.completed_stages.length ? "next" : "pending"}>
          <div className="dan-result-stage-number"><span>STAGE</span><strong>{String(index + 1).padStart(2, "0")}</strong></div>
          <div className="dan-result-stage-song"><strong>{stage.song.title}</strong><span>{stage.song.artist}</span><small>{stage.chart.name}</small></div>
          <div className="dan-result-stage-score"><span>{result ? "Accuracy" : index === dan.completed_stages.length ? "Up next" : "Pending"}</span>
            <strong>{result ? accuracy(result.accuracy) : "--.--%"}</strong></div>
        </article>;
      })}
    </section>
    <footer className="dan-result-actions">
      <button className="dan-exit-course" type="button" onClick={onExit}>Exit course</button>
      {onContinue && <div className="dan-break-countdown"><span>Next stage in</span><strong>{seconds_remaining}</strong></div>}
      {onContinue && <button className="primary" type="button" onClick={continueCourse}>Continue <span>Stage {dan.stage_index + 2}</span></button>}
    </footer>
  </main>;
}
