import { useEffect, useState } from "react";
import { ArrowUpRight, Play, Trophy } from "lucide-react";
import { listRecentPlays, loadScoreStats, type OnlineScore, type ScoreStats } from "../replay/ReplayServer";

interface WelcomeScreenProps {
  onPlay: () => void;
}

const relative_time = new Intl.RelativeTimeFormat("en", { numeric: "always" });

function timeAgo(timestamp: string, now: number): string {
  const elapsed_seconds = Math.max(0, (now - new Date(timestamp).getTime()) / 1_000);
  const units: readonly [Intl.RelativeTimeFormatUnit, number][] = [
    ["year", 365 * 24 * 60 * 60],
    ["month", 30 * 24 * 60 * 60],
    ["day", 24 * 60 * 60],
    ["hour", 60 * 60],
    ["minute", 60],
  ];
  for (const [unit, seconds] of units) {
    if (elapsed_seconds >= seconds) return relative_time.format(-Math.floor(elapsed_seconds / seconds), unit);
  }
  return relative_time.format(-Math.floor(elapsed_seconds), "second");
}

function constantScroll(play: OnlineScore): boolean {
  return typeof play.replay_base === "object" && play.replay_base !== null &&
    "const" in play.replay_base && play.replay_base.const === true;
}

export function WelcomeScreen({ onPlay }: WelcomeScreenProps) {
  const [active_tab, setActiveTab] = useState<"home" | "readme" | "privacy">("home");
  const [plays, setPlays] = useState<readonly OnlineScore[]>([]);
  const [plays_state, setPlaysState] = useState<"loading" | "loaded" | "error">("loading");
  const [score_stats, setScoreStats] = useState<ScoreStats | null>(null);
  const [now, setNow] = useState(Date.now);

  useEffect(() => {
    const abort_controller = new AbortController();
    void listRecentPlays(abort_controller.signal).then((scores) => {
      setPlays(scores);
      setPlaysState("loaded");
    }).catch((error: unknown) => {
      if (abort_controller.signal.aborted) return;
      console.error("Could not load recent plays", error);
      setPlaysState("error");
    });
    void loadScoreStats(abort_controller.signal).then(setScoreStats).catch((error: unknown) => {
      if (!abort_controller.signal.aborted) console.error("Could not load score stats", error);
    });
    return () => abort_controller.abort();
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <main className="welcome-screen">
      <section className="welcome-card">
        <header className="welcome-brand">
          <img src="/rizu-logo.svg" alt="" />
          <div>
            <span>RIZU.SU</span>
            <strong>WEBCLIENT</strong>
          </div>
        </header>

        <nav className="welcome-tabs" aria-label="Welcome pages">
          {(["home", "readme", "privacy"] as const).map((tab) => (
            <button key={tab} className={active_tab === tab ? "active" : ""} type="button"
              aria-current={active_tab === tab ? "page" : undefined} onClick={() => setActiveTab(tab)}>
              {tab === "readme" ? "README" : tab[0]?.toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </nav>

        {active_tab === "home" && <div className="welcome-home">
          <div className="welcome-start">
            <button className="welcome-play" type="button" onClick={onPlay} autoFocus>
              <span>Play</span>
              <Play aria-hidden="true" fill="currentColor" />
            </button>
            <dl className="welcome-score-stats" aria-label="Submitted score statistics">
              <div><dt>Scores set</dt><dd>{score_stats?.total.toLocaleString() ?? "-"}</dd></div>
              <div><dt>Set today</dt><dd>{score_stats?.today.toLocaleString() ?? "-"}</dd></div>
            </dl>
          </div>
          <section className="welcome-recent" aria-labelledby="welcome-recent-title">
            <h1 id="welcome-recent-title"><Trophy aria-hidden="true" />Recent Plays</h1>
            <div className="welcome-recent-table-wrap">
              {plays_state === "loaded" && plays.length > 0 ? <div className="welcome-score-feed">
                {plays.map((play) => <article className={`welcome-score-entry grade-${(play.grade ?? "-").toLowerCase()}`} key={play.id}>
                  <div className="welcome-score-chart">
                    <strong title={play.nickname}>{play.nickname}</strong>
                    <span title={`${play.artist} - ${play.title} · ${play.chart_name}`}>
                      {play.artist} - {play.title} · {play.keys ? `[${play.keys}K] ` : ""}{play.chart_name}
                      {play.replay_base && typeof play.replay_base === "object" && "rate" in play.replay_base && typeof play.replay_base.rate === "number" && play.replay_base.rate !== 1
                        ? ` ${play.replay_base.rate.toFixed(2)}X` : ""}{constantScroll(play) ? " CONST" : ""}
                    </span>
                  </div>
                  <div className="welcome-score-result">
                    <strong>{typeof play.accuracy === "number" ? `${(play.accuracy * 100).toFixed(2)}%` : "-"}</strong>
                    <time dateTime={play.submitted_at} title={new Date(play.submitted_at).toLocaleString()}>{timeAgo(play.submitted_at, now)}</time>
                  </div>
                  <strong className={`welcome-score-grade grade-${(play.grade ?? "-").toLowerCase()}`}>{play.grade ?? "-"}</strong>
                  <div className="welcome-score-pp"><strong>{play.pp.toFixed(2)}</strong><span>PP</span></div>
                </article>)}
              </div> : <div className="welcome-recent-status">
                {plays_state === "loading" ? "Loading recent plays..." : plays_state === "error" ? "Could not load recent plays" : "No plays submitted yet"}
              </div>}
            </div>
          </section>
        </div>}

        {active_tab === "readme" && <div className="welcome-copy">
          <h1>README</h1>
          <p>This is a toy project, but I will try to fix bugs you find or add features you want. I have no space left on the server, so I can&apos;t add more songs.</p>
          <p>DMCA takedowns go to <a href="mailto:nimue.rua@gmail.com">nimue.rua@gmail.com</a>.</p>
          <p>All bug reports, feature requests, complaints, and everything else should go to <a href="https://github.com/Nimue-lua/rizu_webclient/issues" target="_blank" rel="noreferrer">GitHub issues <ArrowUpRight aria-hidden="true" /></a>.</p>
          <div className="welcome-attribution">
            <p>
              This is a webclient for the original game
              <a href="https://rizu.su/" target="_blank" rel="noreferrer">
                rizu.su <ArrowUpRight aria-hidden="true" />
              </a>
            </p>
            <p>
              Many mechanics were taken from
              <a href="https://osu.ppy.sh/" target="_blank" rel="noreferrer">
                osu! <ArrowUpRight aria-hidden="true" />
              </a>
            </p>
            <p>
              The code for osu!standard is based on
              <a href="https://github.com/ppy/osu" target="_blank" rel="noreferrer">
                ppy/osu <ArrowUpRight aria-hidden="true" />
              </a>
              and a bit of osu!stable code.
            </p>
          </div>
          <p>Everything else I made myself. I don&apos;t use any of peppy&apos;s assets. I made them myself.</p>
          <p>I stole the hitsounds for ~ Pivnoi Skoof 🍺 ~. I don&apos;t know who made them, but everyone uses them, so I&apos;m just joining the party.</p>
        </div>}

        {active_tab === "privacy" && <div className="welcome-copy">
          <h1>Privacy Policy</h1>
          <p>When your browser makes a GET request for <code>index.html</code>, we collect your IP address and the timestamp of the request.</p>
          <p>We also collect the scores you submit while using this service.</p>
          <p>This service is not intended for, and must not be used by, anyone under 13 years old.</p>
        </div>}
      </section>
    </main>
  );
}
