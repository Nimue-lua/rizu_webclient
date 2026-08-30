import { Clock3, Star } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import type { GameplayData, GameplayLoader, GameplayLocation, GameplayLoadProgress } from "../library/GameplayLoader";
import { readLocalAsset } from "../library/LocalLibraryStore";
import { difficultyColor, formatDuration } from "./song-select/SongSelectUi";
import { DownloadProgressList, type DownloadProgressItem } from "./DownloadProgressList";

const MODE_NAMES = ["OSU!", "TAIKO", "FRUITS", "MANIA"] as const;

interface LoadingScreenProps {
  gameplay_loader: GameplayLoader;
  location: GameplayLocation;
  audio_context: AudioContext;
  onCancel: () => void;
  onLoaded: (assets: GameplayData) => void;
}

export function LoadingScreen({
  gameplay_loader,
  location,
  audio_context,
  onCancel,
  onLoaded,
}: LoadingScreenProps) {
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<ReadonlyMap<string, DownloadProgressItem>>(() => new Map());
  const [background_url, setBackgroundUrl] = useState(location.background_url);
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

  useEffect(() => {
    if (!location.source_id || !location.background_path) return;

    let cancelled = false;
    let object_url: string | null = null;
    void readLocalAsset(location.source_id, location.background_path)
      .then((data) => {
        if (cancelled) return;
        object_url = URL.createObjectURL(new Blob([data]));
        setBackgroundUrl(object_url);
      })
      .catch((reason: unknown) => {
        console.warn("Failed to load chart background", reason);
      });

    return () => {
      cancelled = true;
      if (object_url) URL.revokeObjectURL(object_url);
    };
  }, [location.background_path, location.source_id]);

  useEffect(() => {
    const abort_controller = new AbortController();

    void gameplay_loader
      .load(location, audio_context, abort_controller.signal, (item: GameplayLoadProgress) => {
        setProgress((current) => new Map(current).set(item.id, item));
      })
      .then((assets) => {
        if (!abort_controller.signal.aborted) {
          onLoaded(assets);
        }
      })
      .catch((reason: unknown) => {
        if (!abort_controller.signal.aborted) {
          console.error("Failed to load gameplay assets", reason);
          setError(reason instanceof Error ? reason.message : "Failed to load gameplay assets");
        }
      });

    return () => abort_controller.abort();
  }, [audio_context, gameplay_loader, location, onLoaded]);

  return (
    <main
      className="loading-screen"
      style={{ "--difficulty-color": difficultyColor(location.difficulty) } as CSSProperties}
    >
      {background_url && <img className="loading-background" src={background_url} alt="" />}
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
