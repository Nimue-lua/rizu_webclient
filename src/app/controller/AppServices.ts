import { SongPreviewPlayer } from "../../audio/SongPreviewPlayer";
import { HttpGameplayLoader, type GameplayLoader } from "../../library/GameplayLoader";
import { CombinedLibrary } from "../../library/Library";
import { LocalLibraryCatalog } from "../../library/LocalLibraryStore";
import { RemoteLibraryStore } from "../../library/RemoteLibraryStore";
import { NoteSkinCatalog } from "../../noteskin/NoteSkinCatalog";
import { ChartSelector } from "../../select/ChartSelector";

export interface AppServices {
  readonly gameplay_loader: GameplayLoader;
  readonly local_library: LocalLibraryCatalog;
  readonly remote_libraries: RemoteLibraryStore;
  readonly chart_selector: ChartSelector;
  readonly note_skin_catalog: NoteSkinCatalog;
  readonly preview_player: SongPreviewPlayer;
}

export function createAppServices(): AppServices {
  const local_library = new LocalLibraryCatalog();
  const remote_libraries = new RemoteLibraryStore();
  return {
    gameplay_loader: new HttpGameplayLoader(),
    local_library,
    remote_libraries,
    chart_selector: new ChartSelector(new CombinedLibrary([remote_libraries, local_library])),
    note_skin_catalog: new NoteSkinCatalog(),
    preview_player: new SongPreviewPlayer(),
  };
}
