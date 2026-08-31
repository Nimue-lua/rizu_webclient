import { useEffect, useState } from "react";
import { ArrowLeft, Trophy } from "lucide-react";
import { listRecentPlays, type OnlineScore } from "../replay/ReplayServer";

interface GlobalLeaderboardScreenProps {
  onExit: () => void;
}

export function GlobalLeaderboardScreen({ onExit }: GlobalLeaderboardScreenProps) {
  const [plays, setPlays] = useState<readonly OnlineScore[]>([]);
  const [state, setState] = useState<"loading" | "loaded" | "error">("loading");

  useEffect(() => {
    const abort_controller = new AbortController();
    void listRecentPlays(abort_controller.signal).then((scores) => {
      setPlays(scores);
      setState("loaded");
    }).catch((error: unknown) => {
      if (abort_controller.signal.aborted) return;
      console.error("Could not load recent plays", error);
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
        <div><Trophy aria-hidden="true" /><h1 id="global-leaderboard-title">Recent Plays</h1></div>
        <button type="button" onClick={onExit}><ArrowLeft aria-hidden="true" />Back to song select</button>
      </header>
      <div className="global-leaderboard-table-wrap">
        {state === "loaded" && plays.length > 0 ? <table className="global-leaderboard-table">
          <thead><tr><th>Mode</th><th>Player</th><th>Accuracy</th><th>Played</th></tr></thead>
          <tbody>{plays.map((play) => <tr key={play.id}>
            <td>{play.mode}</td><td>{play.nickname}</td><td>{typeof play.accuracy === "number" ? `${(play.accuracy * 100).toFixed(2)}%` : "-"}</td>
            <td>{new Date(play.played_at).toLocaleString()}</td>
          </tr>)}</tbody>
        </table> : <div className="global-leaderboard-status">
          <Trophy aria-hidden="true" />
          <span>{state === "loading" ? "Loading recent plays..." : state === "error" ? "Could not load recent plays" : "No plays submitted yet"}</span>
        </div>}
      </div>
    </section>
  );
}
