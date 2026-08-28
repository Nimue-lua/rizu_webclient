import { useEffect, useState } from "react";
import { ArrowLeft, FolderOpen, Globe2, HardDrive, Link2 } from "lucide-react";
import type { LocalLibraryStatus } from "../library/LocalLibraryStore";
import type { RemoteProviderView } from "../library/RemoteLibraryStore";

interface LibrarySourcesScreenProps {
  local_status: LocalLibraryStatus;
  remote_providers: readonly RemoteProviderView[];
  onAddLocal: () => Promise<void>;
  onAddRemote: (url: string, description?: string) => Promise<void>;
  onExit: () => void;
}

export function LibrarySourcesScreen({ local_status, remote_providers, onAddLocal, onAddRemote, onExit }: LibrarySourcesScreenProps) {
  const [url, setUrl] = useState("");
  const [description, setDescription] = useState("");
  const [adding_local, setAddingLocal] = useState(false);
  const [adding_remote, setAddingRemote] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onExit();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onExit]);

  const addRemote = async () => {
    if (adding_remote || !url.trim()) return;
    setAddingRemote(true);
    setError(null);
    try {
      await onAddRemote(url, description);
      setUrl("");
      setDescription("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not add remote provider");
    } finally {
      setAddingRemote(false);
    }
  };

  const addLocal = async () => {
    if (adding_local) return;
    setAddingLocal(true);
    setError(null);
    try {
      await onAddLocal();
    } catch (reason) {
      if (!(reason instanceof DOMException && reason.name === "AbortError")) {
        setError(reason instanceof Error ? reason.message : "Could not add local folder");
      }
    } finally {
      setAddingLocal(false);
    }
  };

  return (
    <section className="library-sources-screen" aria-labelledby="library-sources-title">
      <header className="library-sources-heading">
        <div><Globe2 aria-hidden="true" /><h1 id="library-sources-title">Library Sources</h1></div>
        <button type="button" onClick={onExit}><ArrowLeft aria-hidden="true" />Back to song select</button>
      </header>

      <div className="library-sources-content">
        <section className="library-source-section remote">
          <div className="library-source-title">
            <div><Globe2 aria-hidden="true" /><span><h2>Remote catalogs</h2><p>Connect to a hosted Rizu library over HTTPS.</p></span></div>
            <form className="library-source-remote-form" onSubmit={(event) => { event.preventDefault(); void addRemote(); }}>
              <input autoFocus type="text" value={url} onChange={(event) => setUrl(event.target.value)}
                placeholder="s3.kuudere.fun" aria-label="Remote chart provider URL" />
              <input type="text" value={description} onChange={(event) => setDescription(event.target.value)}
                placeholder="Description (optional)" aria-label="Remote chart provider description" />
              <button type="submit" disabled={adding_remote || !url.trim()}>{adding_remote ? "CHECKING..." : "ADD REMOTE"}</button>
            </form>
          </div>
          <div className="library-source-list">
            {remote_providers.length === 0 && <p>No custom remote providers configured.</p>}
            {remote_providers.map((provider) => <div className="library-source-row" key={provider.id}>
              <Link2 aria-hidden="true" />
              <span><strong>{provider.name}</strong>{provider.description && <small>{provider.description}</small>}</span>
              <b className={provider.status}>{provider.status.toUpperCase()}</b>
            </div>)}
          </div>
        </section>

        {error && <p className="library-source-error">{error}</p>}

        <section className="library-source-section local">
          <div className="library-source-title">
            <div><HardDrive aria-hidden="true" /><span><h2>Local folders</h2><p>Read charts directly from this computer.</p></span></div>
            <button className="library-source-add-local" type="button" disabled={adding_local} onClick={() => void addLocal()}>
              <FolderOpen aria-hidden="true" />{adding_local ? "OPENING..." : "ADD FOLDER"}
            </button>
          </div>
          <div className="library-source-list">
            {local_status.sources.length === 0 && <p>No local folders configured.</p>}
            {local_status.sources.map((source) => <div className="library-source-row" key={source.id}>
              <FolderOpen aria-hidden="true" />
              <span><strong>{source.name}</strong></span>
              <b className={source.available ? "available" : "unavailable"}>{source.available ? "AVAILABLE" : "PERMISSION NEEDED"}</b>
            </div>)}
          </div>
        </section>

        <p className="library-source-note">Refresh the library after adding a source to show its charts.</p>
      </div>
    </section>
  );
}
