import { useEffect, useState } from "react";
import { Trophy, X } from "lucide-react";
import { listGlobalRankings, type GlobalRanking } from "../replay/ReplayServer";

interface GlobalLeaderboardModalProps {
  onExit: () => void;
}

export function GlobalLeaderboardModal({ onExit }: GlobalLeaderboardModalProps) {
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
    <div className="global-leaderboard-layer" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onExit();
    }}>
      <section className="global-leaderboard-modal" role="dialog" aria-modal="true" aria-labelledby="global-leaderboard-title">
        <header>
          <div><Trophy aria-hidden="true" /><span><small>RIZU.SU</small><h1 id="global-leaderboard-title">Global Leaderboard</h1></span></div>
          <button type="button" aria-label="Close global leaderboard" onClick={onExit}><X aria-hidden="true" /></button>
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
        <footer>Best score per chart, top 50 plays weighted by 95% decay.</footer>
      </section>
    </div>
  );
}
