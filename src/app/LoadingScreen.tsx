import { useEffect, useState } from "react";
import type { GameplayData, GameplayLoader } from "../library/GameplayLoader";

interface LoadingScreenProps {
  gameplay_loader: GameplayLoader;
  chart_id: string;
  audio_context: AudioContext;
  onCancel: () => void;
  onLoaded: (assets: GameplayData) => void;
}

export function LoadingScreen({
  gameplay_loader,
  chart_id,
  audio_context,
  onCancel,
  onLoaded,
}: LoadingScreenProps) {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const abort_controller = new AbortController();

    void gameplay_loader
      .getLocation(chart_id, abort_controller.signal)
      .then((reference) => gameplay_loader.load(
        reference,
        audio_context,
        abort_controller.signal,
      ))
      .then((assets) => {
        if (!abort_controller.signal.aborted) {
          onLoaded(assets);
        }
      })
      .catch((reason: unknown) => {
        if (!abort_controller.signal.aborted) {
          setError(reason instanceof Error ? reason.message : "Failed to load gameplay assets");
        }
      });

    return () => abort_controller.abort();
  }, [audio_context, gameplay_loader, onLoaded, chart_id]);

  return (
    <main className="screen loading-screen">
      {error ? (
        <div>
          <p>{error}</p>
          <button type="button" onClick={onCancel}>Back</button>
        </div>
      ) : (
        <span>Loading...</span>
      )}
    </main>
  );
}
