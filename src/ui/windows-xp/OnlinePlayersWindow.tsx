import { Sigma } from "lucide-react";
import type { OnlinePlayer } from "../../replay/ReplayServer";

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
          {players.map((player, index) => (
            <article className="windows-xp-online-player" key={player.id}>
              <div className="windows-xp-online-avatar" aria-hidden="true">
                {player.name.charAt(0).toUpperCase() || "?"}
              </div>
              <strong title={player.name}>{player.name}</strong>
              {player.accuracy === null ? (
                <span className="windows-xp-online-no-stats">No stats</span>
              ) : (
                <div className="windows-xp-online-stats">
                  <span title="Combined skill rating">
                    <b>{Math.hypot(player.speed, player.stamina, player.dexterity, player.technical).toFixed(2)}</b>
                    <Sigma aria-hidden="true" />
                  </span>
                  <b className="windows-xp-online-accuracy">{(player.accuracy * 100).toFixed(2)}%</b>
                  <b className="windows-xp-online-rank">{index + 1}#</b>
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
