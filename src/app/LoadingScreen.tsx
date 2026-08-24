import { useEffect, useState } from "react";
import type { GameplayData, GameplayLoader, GameplayLocation } from "../library/GameplayLoader";

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

  useEffect(() => {
    const abort_controller = new AbortController();

    void gameplay_loader
      .load(location, audio_context, abort_controller.signal)
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
