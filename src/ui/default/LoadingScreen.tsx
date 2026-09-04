import { Clock3, Star } from "lucide-react";
import { useLayoutEffect, useRef, type CSSProperties } from "react";
import type { GameplayLocation, GameplayLoadProgress } from "../../library/GameplayLoader";
import { difficultyColor, formatDuration } from "./song-select/SongSelectUi";
import { DownloadProgressList } from "./DownloadProgressList";

const MODE_NAMES = ["OSU!", "TAIKO", "FRUITS", "MANIA"] as const;

interface LoadingScreenProps {
  location: GameplayLocation;
  onCancel: () => void;
  background_url: string | null;
  progress: ReadonlyMap<string, GameplayLoadProgress>;
  error: string | null;
}

export function LoadingScreen({
  location,
  onCancel,
  background_url,
  progress,
  error,
}: LoadingScreenProps) {
  const title_container_ref = useRef<HTMLHeadingElement>(null);
  const title_ref = useRef<HTMLSpanElement>(null);
  const mode_name = location.mode === 3 && location.keys !== null
    ? `${location.keys}K`
    : MODE_NAMES[location.mode] ?? "UNKNOWN";

  useLayoutEffect(() => {
    const container = title_container_ref.current;
    const title = title_ref.current;
    if (!container || !title) return;

    const fitTitle = () => {
      title.style.setProperty("--title-scale", String(Math.min(1, container.clientWidth / title.scrollWidth)));
    };
    const observer = new ResizeObserver(fitTitle);
    observer.observe(container);
    fitTitle();
    document.fonts.ready.then(fitTitle).catch(() => undefined);
    return () => observer.disconnect();
  }, [location.title]);

  return (
    <main
      className="loading-screen"
      style={{ "--difficulty-color": difficultyColor(location.difficulty) } as CSSProperties}
    >
      <div className="loading-shade" />
      <p className="loading-heading">Now loading</p>
      <div className="loading-content">
        <div className="loading-artwork" aria-hidden="true">
          {background_url
            ? <img src={background_url} alt="" />
            : <span>{location.title.slice(0, 1)}</span>}
        </div>
        <section className="loading-chart">
          <h1 ref={title_container_ref}><span ref={title_ref}>{location.title}</span></h1>
          <p className="loading-artist">{location.artist}</p>
          <p className="loading-difficulty-name">{location.chart_name}</p>
          <div className="loading-stats">
            <span className="loading-difficulty-stat"><Star aria-hidden="true" /><strong>{location.difficulty.toFixed(1)}</strong><small>STARS</small></span>
            <span><Clock3 aria-hidden="true" /><strong>{formatDuration(location.duration_seconds)}</strong><small>DURATION</small></span>
            <span className="loading-mode-stat"><strong>{mode_name}</strong><small>MODE</small></span>
          </div>
        </section>
      </div>
      <div className="loading-status">
        {!error && <DownloadProgressList items={[...progress.values()]} />}
        {error && (
          <div className="loading-error">
            <p>{error}</p>
            <button type="button" onClick={onCancel}>Back to song select</button>
          </div>
        )}
      </div>
    </main>
  );
}
