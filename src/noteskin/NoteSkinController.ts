import type { NoteSkinOption, NoteSkinSelections } from "./NoteSkinSelection";

export interface NoteSkinController {
  readonly selections: NoteSkinSelections;
  readonly options: readonly NoteSkinOption[];
  select(key: string, skin_id: string | undefined): void;
  import(file: File): Promise<{ options: readonly NoteSkinOption[]; persisted: boolean }>;
  delete(skin_id: string): Promise<void>;
}
