import { useEffect, useState } from "react";
import type { ChartCatalogProvider } from "../assets/ChartCatalogProvider";
import type {
  GameplayAssetProvider,
  LoadedGameplayAssets,
} from "../assets/GameplayAssetProvider";

interface LoadingScreenProps {
  asset_provider: GameplayAssetProvider;
  catalog_provider: ChartCatalogProvider;
  chart_id: string;
  audio_context: AudioContext;
  onCancel: () => void;
  onLoaded: (assets: LoadedGameplayAssets) => void;
}

export function LoadingScreen({
  asset_provider,
  catalog_provider,
  chart_id,
  audio_context,
  onCancel,
  onLoaded,
}: LoadingScreenProps) {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const abort_controller = new AbortController();

    void catalog_provider
      .getChart(chart_id, abort_controller.signal)
      .then((reference) => asset_provider.load(
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
  }, [asset_provider, audio_context, catalog_provider, onLoaded, chart_id]);

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
