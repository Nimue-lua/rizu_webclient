import { useEffect, useEffectEvent, useState } from "react";
import type { LocalLibraryCatalog } from "../library/LocalLibraryStore";
import type { ChartSelector } from "../select/ChartSelector";
import { DownloadProgressList, type DownloadProgressItem } from "./DownloadProgressList";

interface CatalogLoadingScreenProps {
  chart_selector: ChartSelector;
  local_library: LocalLibraryCatalog;
  onLoaded: () => void;
}

export function CatalogLoadingScreen({ chart_selector, local_library, onLoaded }: CatalogLoadingScreenProps) {
  const [progress, setProgress] = useState<ReadonlyMap<string, DownloadProgressItem>>(() => new Map());
  const [error, setError] = useState<string | null>(null);
  const finishLoading = useEffectEvent(onLoaded);

  useEffect(() => {
    const abort_controller = new AbortController();
    void local_library.reconnectSources().then(async () => {
      await chart_selector.load(abort_controller.signal, false, (item) => {
        setProgress((current) => new Map(current).set(item.id, item));
      });
      const load_error = chart_selector.getSnapshot().error;
      if (load_error) throw new Error(load_error);
    }).then(() => {
      if (!abort_controller.signal.aborted) finishLoading();
    }).catch((reason: unknown) => {
      if (!abort_controller.signal.aborted) {
        setError(reason instanceof Error ? reason.message : "Failed to load song catalogs");
      }
    });
    return () => abort_controller.abort();
  }, [chart_selector, local_library]);

  return (
    <main className="catalog-loading-screen">
      <section className="catalog-loading-card">
        <img src="/rizu-logo.svg" alt="" />
        <div>
          <p className="catalog-loading-eyebrow">RIZU.SU WEBCLIENT</p>
          <h1>Loading song library</h1>
          <DownloadProgressList items={[...progress.values()]} />
          {error && <p className="catalog-loading-error" role="alert">{error}</p>}
        </div>
      </section>
    </main>
  );
}
