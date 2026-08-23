export interface NoteSkinOption {
  id: string;
  name: string;
  mode: string;
  columnCount: number;
  url: string;
}

export type NoteSkinSelections = Readonly<Record<string, string>>;

export const note_skin_options: readonly NoteSkinOption[] = [
  { id: "circles", name: "Circles", mode: "mania", columnCount: 4, url: "/skins/circles.zip" },
  { id: "diamonds", name: "Diamonds", mode: "mania", columnCount: 4, url: "/skins/diamonds.zip" },
];

const STORAGE_KEY = "rizu.note-skins";

export function noteSkinSelectionKey(mode: string, column_count: number): string {
  return `${mode}.${column_count}`;
}

export function loadNoteSkinSelections(): NoteSkinSelections {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return { [noteSkinSelectionKey("mania", 4)]: "circles" };
    }
    return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
  } catch {
    return { [noteSkinSelectionKey("mania", 4)]: "circles" };
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
  return note_skin_options.find((skin) => skin.id === id && skin.mode === mode && skin.columnCount === column_count);
}
