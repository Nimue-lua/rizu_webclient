import type { GameplayLocation } from "../../library/GameplayLoader";
import type { CompletedGameplay } from "../../replay/RecordedReplay";

function formatDuration(seconds: number) {
  const rounded = Math.max(0, Math.round(seconds));
  return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, "0")}`;
}

function judgeLabel(name: string) {
  return name.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function PlayResultWindow({ completed, location, overallDifficulty, onReplay }: {
  completed: CompletedGameplay;
  location: GameplayLocation;
  overallDifficulty: number;
  onReplay: () => void;
}) {
  const score = completed.score;
  const rate = completed.replay_base.rate;
  const judge_names = score.judge_names ?? Object.keys(score.judges ?? {});
  const max_combo = score.max_combo ?? score.combo;

  return (
    <section className="windows-xp-play-result">
      <header className="windows-xp-result-song">
        <div>
          <strong>{location.title}</strong>
          <span>{location.artist}</span>
        </div>
        <span>{location.chart_name}</span>
      </header>

      <div className="windows-xp-result-summary">
        <div className={`windows-xp-result-grade grade-${(score.grade ?? "d").toLowerCase()}`}>
          <small>Grade</small>
          <strong>{score.grade ?? "-"}</strong>
        </div>
        <dl>
          <div><dt>Accuracy</dt><dd>{score.accuracy === undefined ? "-" : `${(score.accuracy * 100).toFixed(2)}%`}</dd></div>
          <div><dt>Score</dt><dd>{score.score?.toLocaleString() ?? "-"}</dd></div>
          <div><dt>Max combo</dt><dd>{max_combo === undefined ? "-" : `${max_combo.toLocaleString()}x`}</dd></div>
          <div><dt>Misses</dt><dd>{score.judges?.miss?.toLocaleString() ?? "0"}</dd></div>
        </dl>
      </div>

      <fieldset className="windows-xp-result-judgments">
        <legend>Judgments</legend>
        <div>
          {judge_names.map((name) => (
            <dl key={name}>
              <dt>{judgeLabel(name)}</dt>
              <dd>{score.judges?.[name]?.toLocaleString() ?? "0"}</dd>
            </dl>
          ))}
          {judge_names.length === 0 && <p>No judgment information is available.</p>}
        </div>
      </fieldset>

      <fieldset className="windows-xp-result-details">
        <legend>Play information</legend>
        <dl>
          <div><dt>Mode</dt><dd>{completed.replay.mode === "osu" ? "osu!standard" : "osu!mania V2"}</dd></div>
          <div><dt>Difficulty</dt><dd>{location.difficulty.toFixed(1)} stars</dd></div>
          <div><dt>Overall difficulty</dt><dd>OD{overallDifficulty.toFixed(1).replace(/\.0$/, "")}</dd></div>
          <div><dt>Music rate</dt><dd>{rate.toFixed(2)}x</dd></div>
          <div><dt>Duration</dt><dd>{formatDuration(location.duration_seconds / rate)}</dd></div>
          <div><dt>Tempo</dt><dd>{Math.round(location.bpm * rate)} BPM</dd></div>
          <div><dt>Long notes</dt><dd>{Math.round(location.long_note_ratio * 100)}%</dd></div>
          <div><dt>Final combo</dt><dd>{score.combo === undefined ? "-" : `${score.combo.toLocaleString()}x`}</dd></div>
        </dl>
      </fieldset>

      <footer>
        <span>Play completed successfully.</span>
        <button type="button" onClick={onReplay}>Watch Replay</button>
      </footer>
    </section>
  );
}
