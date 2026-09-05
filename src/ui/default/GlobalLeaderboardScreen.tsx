import { useEffect, useState } from "react";
import { ArrowLeft, Trophy } from "lucide-react";
import { listScoreLeaderboard, type LeaderboardDefinition, type ScoreRanking } from "../../replay/ReplayServer";
import { formatScore } from "../formatScore";

interface GlobalLeaderboardScreenProps {
  onExit: () => void;
}

function playTime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor(seconds % 3600 / 60);
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

export function GlobalLeaderboardScreen({ onExit }: GlobalLeaderboardScreenProps) {
  const [rankings, setRankings] = useState<readonly ScoreRanking[]>([]);
  const [available, setAvailable] = useState<readonly LeaderboardDefinition[]>([]);
  const [selected, setSelected] = useState("all");
  const [state, setState] = useState<"loading" | "loaded" | "error">("loading");

  useEffect(() => {
    const abort_controller = new AbortController();
    setState("loading");
    void listScoreLeaderboard(abort_controller.signal, undefined, selected).then((result) => {
      setRankings(result.rankings);
      setAvailable(result.available);
      setState("loaded");
    }).catch((error: unknown) => {
      if (abort_controller.signal.aborted) return;
      console.error("Could not load global rankings", error);
      setState("error");
    });
    return () => abort_controller.abort();
  }, [selected]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") onExit(); };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onExit]);

  return (
    <section className="global-leaderboard-screen" aria-labelledby="global-leaderboard-title">
      <header className="global-leaderboard-heading">
        <div><Trophy aria-hidden="true" /><div><h1 id="global-leaderboard-title">Global Leaderboard</h1><p>Ranked by total score across every validated play</p></div></div>
        <label>Ruleset <select value={selected} onChange={(event) => setSelected(event.target.value)}>
          {available.length ? available.map((item) => <option value={item.slug} key={item.slug}>{item.name}</option>) : <option value="all">All modes</option>}
        </select></label>
        <button type="button" onClick={onExit}><ArrowLeft aria-hidden="true" />Back to song select</button>
      </header>
      {state === "loaded" ? <div className="global-score-leaderboard">
        {rankings.length > 0 ? <div className="global-score-table">
          <div className="global-score-table-header"><span>Rank</span><span>Player</span><span>Total score</span><span>Accuracy</span><span>Play time</span></div>
          <ol>{rankings.map((player) => <li key={player.user_id}>
            <b>#{player.rank}</b><strong title={player.nickname}>{player.nickname}</strong>
            <span title={Math.round(player.total_score).toLocaleString()}>{formatScore(player.total_score)}</span>
            <span>{(player.accuracy * 100).toFixed(2)}%</span>
            <span>{playTime(player.play_time_seconds)}</span>
          </li>)}</ol>
        </div> : <p>No ranked players</p>}
      </div> : <div className="global-leaderboard-status"><Trophy aria-hidden="true" /><span>{state === "loading" ? "Loading rankings..." : "Could not load rankings"}</span></div>}
    </section>
  );
}
