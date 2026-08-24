export interface NoteSkinOption {
  id: string;
  name: string;
  mode: string;
  columnCount: number | null;
  url: string;
}

export type NoteSkinSelections = Readonly<Record<string, string>>;

export const note_skin_options: readonly NoteSkinOption[] = [
  { id: "skin1", name: "skin1", mode: "mania", columnCount: null, url: "/skins/skin1.osk" },
];

const STORAGE_KEY = "rizu.note-skins";

export function noteSkinSelectionKey(mode: string, column_count: number): string {
  return `${mode}.${column_count}`;
}

export function loadNoteSkinSelections(): NoteSkinSelections {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value)
      .filter((entry): entry is [string, string] => typeof entry[1] === "string")
      .map(([key, id]) => [key, id === "circles" || id === "DefaultCircles" ? "" : id]));
  } catch {
    return {};
  }
}

export function saveNoteSkinSelections(selections: NoteSkinSelections): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(selections));
  } catch {
    // Keep the selection usable for this session when storage is unavailable.
  }
}

export function selectedNoteSkin(mode: string, column_count: number,
  selections: NoteSkinSelections): NoteSkinOption | undefined {
  const id = selections[noteSkinSelectionKey(mode, column_count)];
  const compatible = note_skin_options.filter((skin) => skin.mode === mode &&
    (skin.columnCount === null || skin.columnCount === column_count));
  return compatible.find((skin) => skin.id === id);
}
