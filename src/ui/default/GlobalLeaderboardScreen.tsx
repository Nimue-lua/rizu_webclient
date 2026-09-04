import { useEffect, useState } from "react";
import { ArrowLeft, Trophy } from "lucide-react";
import { listSkillLeaderboards, type SkillLeaderboards, type SkillName } from "../../replay/ReplayServer";

interface GlobalLeaderboardScreenProps {
  onExit: () => void;
}

const skills: readonly SkillName[] = ["speed", "dexterity", "stamina", "technical"];
const empty_leaderboards: SkillLeaderboards = { speed: [], dexterity: [], stamina: [], technical: [] };

export function GlobalLeaderboardScreen({ onExit }: GlobalLeaderboardScreenProps) {
  const [leaderboards, setLeaderboards] = useState<SkillLeaderboards>(empty_leaderboards);
  const [state, setState] = useState<"loading" | "loaded" | "error">("loading");

  useEffect(() => {
    const abort_controller = new AbortController();
    void listSkillLeaderboards(abort_controller.signal).then((rankings) => {
      setLeaderboards(rankings);
      setState("loaded");
    }).catch((error: unknown) => {
      if (abort_controller.signal.aborted) return;
      console.error("Could not load global rankings", error);
      setState("error");
    });
    return () => abort_controller.abort();
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") onExit(); };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onExit]);

  return (
    <section className="global-leaderboard-screen" aria-labelledby="global-leaderboard-title">
      <header className="global-leaderboard-heading">
        <div><Trophy aria-hidden="true" /><div><h1 id="global-leaderboard-title">Global Leaderboards</h1><p>Average of each player&apos;s best 20 chart scores</p></div></div>
        <button type="button" onClick={onExit}><ArrowLeft aria-hidden="true" />Back to song select</button>
      </header>
      {state === "loaded" ? <div className="global-skill-leaderboards">
        {skills.map((skill) => <section className={`global-skill-board ${skill}`} key={skill}>
          <h2>{skill}</h2>
          {leaderboards[skill].length > 0 ? <ol>
            {leaderboards[skill].map((player) => <li key={player.user_id}>
              <b>#{player.rank}</b><span title={player.nickname}>{player.nickname}</span><strong>{player.rating.toFixed(2)}</strong>
            </li>)}
          </ol> : <p>No ranked players</p>}
        </section>)}
      </div> : <div className="global-leaderboard-status"><Trophy aria-hidden="true" /><span>{state === "loading" ? "Loading rankings..." : "Could not load rankings"}</span></div>}
    </section>
  );
}
