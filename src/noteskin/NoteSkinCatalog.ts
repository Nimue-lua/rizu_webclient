import {
  deleteLocalNoteSkin,
  inspectLocalNoteSkin,
  loadLocalNoteSkins,
  localNoteSkinOptions,
  saveLocalNoteSkin,
  shouldPersistLocalNoteSkin,
} from "./LocalNoteSkinStore";
import { note_skin_options, type NoteSkinOption } from "./NoteSkinSelection";

export interface NoteSkinImportResult {
  readonly options: readonly NoteSkinOption[];
  readonly persisted: boolean;
}

export class NoteSkinCatalog {
  private options: readonly NoteSkinOption[] = note_skin_options;
  private readonly local_urls = new Map<string, string>();
  private revision = 0;

  getOptions(): readonly NoteSkinOption[] {
    return this.options;
  }

  async load(): Promise<readonly NoteSkinOption[]> {
    const revision = this.revision;
    const skins = await loadLocalNoteSkins();
    if (revision !== this.revision) return this.options;
    const options: NoteSkinOption[] = [...note_skin_options];
    for (const skin of skins) {
      const url = URL.createObjectURL(skin.archive);
      this.replaceUrl(skin.id, url);
      options.push(...localNoteSkinOptions(skin, url));
    }
    this.options = options;
    return options;
  }

  async import(file: File): Promise<NoteSkinImportResult> {
    const skin = await inspectLocalNoteSkin(file);
    const persisted = shouldPersistLocalNoteSkin(file.size);
    if (persisted) await saveLocalNoteSkin(skin);

    const url = URL.createObjectURL(skin.archive);
    this.replaceUrl(skin.id, url);
    const imported_options = localNoteSkinOptions(skin, url, !persisted);
    this.options = [...this.options.filter((option) => option.id !== skin.id), ...imported_options];
    return { options: imported_options, persisted };
  }

  async delete(id: string): Promise<readonly NoteSkinOption[]> {
    const imported = this.options.filter((option) => option.id === id && option.local);
    if (imported.length === 0) {
      throw new Error("Only imported skins can be deleted");
    }
    if (imported.some((option) => !option.sessionOnly)) await deleteLocalNoteSkin(id);
    const url = this.local_urls.get(id);
    if (url) URL.revokeObjectURL(url);
    this.local_urls.delete(id);
    this.options = this.options.filter((option) => option.id !== id);
    return this.options;
  }

  dispose(): void {
    this.revision += 1;
    for (const url of this.local_urls.values()) URL.revokeObjectURL(url);
    this.local_urls.clear();
  }

  private replaceUrl(id: string, url: string): void {
    const previous = this.local_urls.get(id);
    if (previous) URL.revokeObjectURL(previous);
    this.local_urls.set(id, url);
  }
}
