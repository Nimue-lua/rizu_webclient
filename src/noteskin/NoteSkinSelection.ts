export interface NoteSkinOption {
  id: string;
  name: string;
  mode: string;
  columnCount: number | null;
  url: string;
  local?: boolean;
  sessionOnly?: boolean;
  builtIn?: boolean;
}

export type NoteSkinSelections = Readonly<Record<string, string>>;

export const note_skin_options: readonly NoteSkinOption[] = [
  { id: "osu-default", name: "osu! Default", mode: "osu", columnCount: null, url: "/skins/osu-default.osk", builtIn: true },
  { id: "osu-default", name: "osu! Default", mode: "mania", columnCount: null, url: "/skins/osu-default.osk", builtIn: true },
  { id: "pivnoi_skoof", name: "~ Pivnoi Skoof 🍺~", mode: "osu", columnCount: null, url: "/skins/pivnoi_skoof.osk", builtIn: true },
];

const STORAGE_KEY = "rizu.note-skins";
const mode_names = ["osu", "taiko", "fruits", "mania"] as const;

export function noteSkinMode(chart_mode: number): string | null {
  return mode_names[chart_mode] ?? null;
}

export function noteSkinSelectionKey(mode: string, column_count: number | null): string {
  return column_count === null ? mode : `${mode}.${column_count}`;
}

export function compatibleNoteSkins(mode: string | null, column_count: number | null,
  options: readonly NoteSkinOption[] = note_skin_options): readonly NoteSkinOption[] {
  if (mode === null || (mode === "mania" && column_count === null)) return [];
  return options.filter((skin) => skin.mode === mode &&
    (skin.columnCount === null || skin.columnCount === column_count));
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

export function selectedNoteSkin(mode: string, column_count: number | null,
  selections: NoteSkinSelections, options: readonly NoteSkinOption[] = note_skin_options): NoteSkinOption | undefined {
  const id = selections[noteSkinSelectionKey(mode, column_count)];
  const compatible = compatibleNoteSkins(mode, column_count, options);
  return compatible.find((skin) => skin.id === id) ?? compatible.find((skin) => skin.id === "osu-default") ?? compatible[0];
}
