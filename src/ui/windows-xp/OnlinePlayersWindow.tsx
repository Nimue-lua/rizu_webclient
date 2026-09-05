import type { OnlinePlayer } from "../../replay/ReplayServer";
import { formatScore } from "../formatScore";

export function OnlinePlayersWindow({ count, players }: {
  count: number | null;
  players: readonly OnlinePlayer[];
}) {
  return (
    <section className="windows-xp-online-players">
      <header className="windows-xp-online-header">
        <div>
          <strong>Online Players</strong>
          <span>Players currently connected to Rizu</span>
        </div>
        <span className={`windows-xp-online-count${count === null ? " offline" : ""}`}>
          {count === null ? "Offline" : `${count} online`}
        </span>
      </header>

      {players.length > 0 ? (
        <div className="windows-xp-online-grid">
          {players.map((player) => (
            <article className="windows-xp-online-player" key={player.id}>
              <div className="windows-xp-online-avatar" aria-hidden="true">
                {player.name.charAt(0).toUpperCase() || "?"}
              </div>
              <strong title={player.name}>{player.name}</strong>
              {player.accuracy === null ? (
                <span className="windows-xp-online-no-stats">No stats</span>
              ) : (
                <div className="windows-xp-online-stats">
                  <span title={`Total score: ${Math.round(player.total_score).toLocaleString()}`}><b>{formatScore(player.total_score)}</b></span>
                  <b className="windows-xp-online-accuracy">{(player.accuracy * 100).toFixed(2)}%</b>
                  <b title="Total play time">{Math.floor(player.play_time_seconds / 3600)}h</b>
                  {player.rank !== null && <b className="windows-xp-online-rank">#{player.rank}</b>}
                </div>
              )}
            </article>
          ))}
        </div>
      ) : (
        <div className="windows-xp-online-empty">
          {count === null ? "Could not load online players." : "No players are online."}
        </div>
      )}

      <footer className="windows-xp-online-status">
        <span>{players.length} player{players.length === 1 ? "" : "s"} listed</span>
      </footer>
    </section>
  );
}
