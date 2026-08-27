import { useEffect, useState } from "react";
import { ArrowLeft, Trophy } from "lucide-react";
import { listGlobalRankings, type GlobalRanking } from "../replay/ReplayServer";

interface GlobalLeaderboardScreenProps {
  onExit: () => void;
}

export function GlobalLeaderboardScreen({ onExit }: GlobalLeaderboardScreenProps) {
  const [rankings, setRankings] = useState<readonly GlobalRanking[]>([]);
  const [state, setState] = useState<"loading" | "loaded" | "error">("loading");

  useEffect(() => {
    const abort_controller = new AbortController();
    void listGlobalRankings(abort_controller.signal).then((players) => {
      setRankings(players);
      setState("loaded");
    }).catch((error: unknown) => {
      if (abort_controller.signal.aborted) return;
      console.error("Could not load global rankings", error);
      setState("error");
    });
    return () => abort_controller.abort();
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onExit();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onExit]);

  return (
    <section className="global-leaderboard-screen" aria-labelledby="global-leaderboard-title">
      <header className="global-leaderboard-heading">
        <div><Trophy aria-hidden="true" /><h1 id="global-leaderboard-title">Global Leaderboard</h1></div>
        <button type="button" onClick={onExit}><ArrowLeft aria-hidden="true" />Back to song select</button>
      </header>
      <div className="global-leaderboard-table-wrap">
        {state === "loaded" && rankings.length > 0 ? <table className="global-leaderboard-table">
          <thead><tr><th>Rank</th><th>Player</th><th>Performance</th><th>Best plays</th></tr></thead>
          <tbody>{rankings.map((player) => <tr key={`${player.rank}-${player.nickname}`}>
            <td>#{player.rank}</td><td>{player.nickname}</td><td>{player.pp.toFixed(2)} pp</td><td>{player.play_count}</td>
          </tr>)}</tbody>
        </table> : <div className="global-leaderboard-status">
          <Trophy aria-hidden="true" />
          <span>{state === "loading" ? "Loading rankings..." : state === "error" ? "Could not load rankings" : "No ranked players yet"}</span>
        </div>}
      </div>
    </section>
  );
}
