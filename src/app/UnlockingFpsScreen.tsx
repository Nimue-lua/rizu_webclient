import { ArrowLeft } from "lucide-react";

interface UnlockingFpsScreenProps {
  onBack: () => void;
}

export function UnlockingFpsScreen({ onBack }: UnlockingFpsScreenProps) {
  return (
    <main className="fps-screen">
      <article className="fps-card">
        <header className="fps-header">
          <button type="button" onClick={onBack} autoFocus>
            <ArrowLeft aria-hidden="true" />
            Back
          </button>
          <div>
            <h1>Unlocking FPS</h1>
            <p>Only useful for osu gamemode and if you are on 60hz monitor. Absolutely useless for mania since we have &quot;threaded&quot; input.</p>
          </div>
        </header>

        <div className="fps-platforms">
          <section className="fps-platform">
            <h2>Windows</h2>

            <div className="fps-browser">
              <h3>Chromium and Chrome</h3>
              <p><strong>Not tested on Windows. It might not work.</strong></p>
              <p>Create a shortcut to the browser executable and add these flags:</p>
              <code>--disable-gpu-vsync --disable-frame-rate-limit</code>
            </div>

            <div className="fps-browser">
              <h3>Firefox</h3>
              <p><strong>Not tested on Windows.</strong></p>
              <p>Open <code>about:config</code> and set <code>layout.frame_rate</code> to <code>0</code>.</p>
            </div>
          </section>

          <section className="fps-platform">
            <h2>Linux</h2>

            <div className="fps-browser">
              <h3>Firefox</h3>
              <p>Firefox allows VSync to be completely disabled for unlimited FPS. Open <code>about:config</code> and set <code>layout.frame_rate</code> to <code>0</code>.</p>
            </div>

            <div className="fps-browser">
              <h3>Chromium and Chrome</h3>
              <p>FPS can be unlocked, but input latency still behaves as if VSync and the frame limit are enabled. You can try launching from a terminal:</p>
              <pre><code>chromium --disable-gpu-vsync --disable-frame-rate-limit</code></pre>
              <span className="fps-or">or</span>
              <pre><code>google-chrome --disable-gpu-vsync --disable-frame-rate-limit</code></pre>
            </div>
          </section>
        </div>
      </article>
    </main>
  );
}
