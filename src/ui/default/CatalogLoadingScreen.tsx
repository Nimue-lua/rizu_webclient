import type { LibraryLoadProgress } from "../../library/LibraryController";
import { DownloadProgressList } from "./DownloadProgressList";

interface CatalogLoadingScreenProps {
  progress: ReadonlyMap<string, LibraryLoadProgress>;
  error: string | null;
}

export function CatalogLoadingScreen({ progress, error }: CatalogLoadingScreenProps) {
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
