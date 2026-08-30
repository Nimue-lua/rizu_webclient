import { ArrowUpRight, Play } from "lucide-react";

interface WelcomeScreenProps {
  onPlay: () => void;
}

export function WelcomeScreen({ onPlay }: WelcomeScreenProps) {
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

        <div className="welcome-intro">
          <p>
            This is a toy project, but I will try to fix bugs you find or add features you want.
            I have no space left on the server, so I can&apos;t add more songs.
          </p>
          <div className="welcome-actions">
            <button className="welcome-play" type="button" onClick={onPlay} autoFocus>
              <span>Play</span>
              <Play aria-hidden="true" fill="currentColor" />
            </button>
          </div>
        </div>

        <div className="welcome-details">
          <p>
            DMCA takedowns go to <a href="mailto:nimue.rua@gmail.com">nimue.rua@gmail.com</a>
          </p>
          <p>
            All bug reports, feature requests, complaints, and everything else should go to
            <a href="https://github.com/Nimue-lua/rizu_webclient/issues" target="_blank" rel="noreferrer">
              GitHub issues <ArrowUpRight aria-hidden="true" />
            </a>
          </p>
          <p>The only thing I collect is your IP address and a timestamp when you make a GET request for index.html.</p>
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
          <p className="welcome-note">
            Everything else I made myself. I don&apos;t use any of peppy&apos;s assets. I made them myself.
          </p>
        </div>
      </section>
    </main>
  );
}
