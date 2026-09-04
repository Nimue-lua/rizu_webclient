import type { SongPreviewPlayer } from "../audio/SongPreviewPlayer";
import type { GameplayModifiersController } from "../config/GameplaySettingsController";
import type { GameplayController } from "../gameplay/GameplayController";
import type { LibraryController } from "../library/LibraryController";
import type { NoteSkinController } from "../noteskin/NoteSkinController";
import type { OnlineController } from "../online/OnlineController";
import type { ResultsController } from "../replay/ResultsController";

export interface GameState {
  readonly library: LibraryController;
  readonly gameplay: GameplayController;
  readonly modifiers: GameplayModifiersController;
  readonly note_skins: NoteSkinController;
  readonly online: OnlineController;
  readonly results: ResultsController;
  readonly preview_player: SongPreviewPlayer;
}
