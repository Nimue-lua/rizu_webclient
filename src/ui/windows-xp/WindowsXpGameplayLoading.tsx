import type { GameplayController } from "../../gameplay/GameplayController";

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function WindowsXpGameplayLoading({ gameplay }: { gameplay: GameplayController }) {
  const location = gameplay.location;
  if (!location) return null;
  const progress = [...gameplay.loading_progress.values()];

  return (
    <main className="windows-xp-game-loading">
      <section className="windows-xp-game-loading-copy">
        <p>Rizu Game Loader</p>
        <h1>Preparing your chart...</h1>
        <div className="windows-xp-game-loading-rule" />
        <h2>{location.artist} - {location.title}</h2>
        <p>{location.chart_name}</p>
      </section>

      <section className="windows-xp-game-loading-panel">
        <strong>Loading game resources</strong>
        <p>Please wait while Rizu loads the music, chart data, and note skin.</p>
        <div className="windows-xp-game-loading-items">
          {progress.length > 0 ? progress.map((item) => {
            const percent = item.total_bytes && item.total_bytes > 0
              ? Math.min(100, item.loaded_bytes / item.total_bytes * 100)
              : null;
            return (
              <div className="windows-xp-game-loading-item" key={item.id}>
                <span>{item.label}</span>
                <span>{percent === null ? formatBytes(item.loaded_bytes) : `${Math.round(percent)}%`}</span>
                <progress value={percent ?? undefined} max={100} />
              </div>
            );
          }) : <div className="windows-xp-game-loading-item">
            <span>Initializing</span><span>Please wait...</span><progress />
          </div>}
        </div>
        {gameplay.loading_error && <div className="windows-xp-game-loading-error">
          <p>{gameplay.loading_error}</p>
          <button type="button" onClick={gameplay.cancel}>Return to desktop</button>
        </div>}
      </section>

      <footer>
        <span>Copyright (C) Rizu</span>
        {!gameplay.loading_error && <button type="button" onClick={gameplay.cancel}>Cancel</button>}
      </footer>
    </main>
  );
}
