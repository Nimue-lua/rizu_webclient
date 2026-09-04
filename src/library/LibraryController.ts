import type { ChartSelector } from "../select/ChartSelector";
import type { LibraryLoadProgress } from "./Library";
import type { LocalLibraryStatus } from "./LocalLibraryStore";
import type { RemoteProviderView } from "./RemoteLibraryStore";

export type { LibraryLoadProgress } from "./Library";

export interface LibraryController {
  readonly chart_selector: ChartSelector;
  readonly local_status: LocalLibraryStatus;
  readonly remote_providers: readonly RemoteProviderView[];
  readonly loading_progress: ReadonlyMap<string, LibraryLoadProgress>;
  readonly loading_error: string | null;
  readonly load: () => Promise<void>;
  readonly cancel_loading: () => void;
  readonly add_local: () => Promise<void>;
  readonly add_remote: (url: string) => Promise<void>;
  readonly refresh: () => void;
}
