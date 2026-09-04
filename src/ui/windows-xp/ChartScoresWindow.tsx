import { useEffect, useState, useSyncExternalStore } from "react";
import { inputLayout, loadInputBindings } from "../../gameplay/InputBindings";
import type { GameplayController } from "../../gameplay/GameplayController";
import type { ChartfileSetView, Chartview } from "../../library/views";
import { listOnlineScores, type OnlineScore } from "../../replay/ReplayServer";
import { completedGameplayFromStoredPlay, listPlaysByChart, type StoredPlay } from "../../replay/ReplayStore";
import type { ChartSelector } from "../../select/ChartSelector";

interface ReplayBaseSummary {
  readonly rate?: unknown;
  readonly mode?: unknown;
  readonly const?: unknown;
  readonly tap_only?: unknown;
}

function formatPlayDate(played_at: string): string {
  const date = new Date(played_at);
  if (Number.isNaN(date.getTime())) return played_at;
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function replayMods(value: unknown): string {
  const replay_base = typeof value === "object" && value !== null ? value as ReplayBaseSummary : {};
  const mods: string[] = [];
  if (typeof replay_base.rate === "number" && replay_base.rate !== 1) {
    mods.push(`${replay_base.rate.toFixed(2).replace(/0+$/, "").replace(/\.$/, "")}x`);
  }
  if (replay_base.mode === "mania" && replay_base.const === true) mods.push("Const");
  if (replay_base.mode === "mania" && replay_base.tap_only === true) mods.push("No LN");
  return mods.join(", ") || "No mods";
}

function localMods(play: StoredPlay): string {
  try {
    return replayMods(JSON.parse(play.replay_base_json));
  } catch {
    return "Unknown";
  }
}

function normalizedGrade(grade: string | null): string {
  const normalized = grade?.toUpperCase();
  return normalized && ["X", "S", "A", "B", "C", "D"].includes(normalized) ? normalized : "D";
}

function playReplay(gameplay: GameplayController, play: StoredPlay, chart: Chartview, song: ChartfileSetView) {
  try {
    gameplay.begin({
      kind: "replay",
      request: {
        chart,
        song: { title: song.title, artist: song.artist },
        input_bindings: loadInputBindings(inputLayout(chart)),
      },
      playback: completedGameplayFromStoredPlay(play),
    });
    void gameplay.prepare().catch(() => undefined);
  } catch (error) {
    console.error("Could not play stored replay", error);
  }
}

export function ChartScoresWindow({ selector, gameplay, nickname, scoreRevision }: {
  selector: ChartSelector;
  gameplay: GameplayController;
  nickname: string;
  scoreRevision: number;
}) {
  useSyncExternalStore(selector.subscribe, selector.getSnapshot);
  const [source, setSource] = useState<"local" | "online">("online");
  const [local_scores, setLocalScores] = useState<readonly StoredPlay[]>([]);
  const [online_scores, setOnlineScores] = useState<readonly OnlineScore[]>([]);
  const [state, setState] = useState<"loading" | "loaded" | "error">("loading");
  const selected_song = selector.getSelectedSong();
  const selected_chart = selector.getSelectedChart();

  useEffect(() => {
    let active = true;
    setLocalScores([]);
    if (!selected_chart) return () => { active = false; };
    void listPlaysByChart(selected_chart.id).then((plays) => {
      if (active) setLocalScores(plays);
    }).catch((error: unknown) => console.error("Could not load chart scores", error));
    return () => { active = false; };
  }, [scoreRevision, selected_chart?.id]);

  useEffect(() => {
    if (source !== "online" || !selected_chart) return;
    const abort_controller = new AbortController();
    setOnlineScores([]);
    setState("loading");
    void listOnlineScores(selected_chart.chart_md5, selected_chart.chart_index, abort_controller.signal).then((scores) => {
      setOnlineScores(scores);
      setState("loaded");
    }).catch((error: unknown) => {
      if (abort_controller.signal.aborted) return;
      console.error("Could not load online scores", error);
      setState("error");
    });
    return () => abort_controller.abort();
  }, [source, selected_chart?.chart_md5, selected_chart?.chart_index]);

  const sorted_local_scores = [...local_scores]
    .filter((play) => play.accuracy !== null)
    .sort((left, right) => right.accuracy! - left.accuracy! || right.played_at.localeCompare(left.played_at))
    .slice(0, 5);

  const rows = source === "local" ? sorted_local_scores : online_scores.filter((score) => score.accuracy !== null);
  const empty_message = !selected_chart ? "Select a chart in Music Library to view its scores."
    : source === "online" && state === "loading" ? "Loading online scores..."
      : source === "online" && state === "error" ? "Could not load online scores."
        : source === "local" ? "No local records set." : "No online scores yet.";

  return (
    <section className="windows-xp-chart-scores">
      <header>
        <div>
          <strong>{selected_song?.title ?? "No chart selected"}</strong>
          <span>{selected_chart ? `${selected_song?.artist ?? "Unknown artist"} - ${selected_chart.name}` : "Open Music Library and select a chart."}</span>
        </div>
        <div className="windows-xp-score-source" role="group" aria-label="Score source">
          <button type="button" className={source === "online" ? "selected" : ""} aria-pressed={source === "online"}
            onClick={() => setSource("online")}>Online</button>
          <button type="button" className={source === "local" ? "selected" : ""} aria-pressed={source === "local"}
            onClick={() => setSource("local")}>My Computer</button>
        </div>
      </header>

      <div className="windows-xp-score-table">
        <div className="windows-xp-score-table-header" aria-hidden="true">
          <span>Rank</span><span>Player</span><span>Grade</span><span>Accuracy</span><span>Details</span><span>Played</span>
        </div>
        {rows.map((entry, index) => {
          if (source === "local") {
            const play = entry as StoredPlay;
            return <button type="button" className="windows-xp-score-row" key={play.id ?? play.played_at}
              onClick={() => selected_chart && selected_song && playReplay(gameplay, play, selected_chart, selected_song)}>
              <span>#{index + 1}</span><span>{nickname}</span>
              <strong className={`grade-${normalizedGrade(play.grade).toLowerCase()}`}>{normalizedGrade(play.grade)}</strong>
              <span>{(play.accuracy! * 100).toFixed(2)}%</span><span>{localMods(play)}</span>
              <time dateTime={play.played_at}>{formatPlayDate(play.played_at)}</time>
            </button>;
          }
          const score = entry as OnlineScore;
          return <div className="windows-xp-score-row" key={score.id}>
            <span>#{index + 1}</span><span title={score.nickname}>{score.nickname || "Anonymous"}</span>
            <strong className={`grade-${normalizedGrade(score.grade).toLowerCase()}`}>{normalizedGrade(score.grade)}</strong>
            <span>{(score.accuracy! * 100).toFixed(2)}%</span><span>{replayMods(score.replay_base)}</span>
            <time dateTime={score.played_at}>{formatPlayDate(score.played_at)}</time>
          </div>;
        })}
        {rows.length === 0 && <p>{empty_message}</p>}
      </div>
    </section>
  );
}
