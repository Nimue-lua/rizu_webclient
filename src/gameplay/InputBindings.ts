import type { ChartInput } from "../chart/Chart";

const INPUT_BINDINGS_STORAGE_PREFIX = "rizu.input-bindings";

const default_mania_bindings: Readonly<Record<number, readonly string[]>> = {
  1: ["Space"],
  2: ["KeyF", "KeyJ"],
  3: ["KeyF", "Space", "KeyJ"],
  4: ["KeyA", "KeyS", "Semicolon", "Quote"],
  5: ["KeyD", "KeyF", "Space", "KeyJ", "KeyK"],
  6: ["KeyS", "KeyD", "KeyF", "KeyJ", "KeyK", "KeyL"],
  7: ["KeyA", "KeyS", "KeyD", "Space", "KeyL", "Semicolon", "Quote"],
  8: ["KeyA", "KeyS", "KeyD", "KeyF", "KeyJ", "KeyK", "KeyL", "Semicolon"],
  9: ["KeyA", "KeyS", "KeyD", "KeyF", "Space", "KeyJ", "KeyK", "KeyL", "Semicolon"],
};

const mode_bindings: Readonly<Record<number, readonly string[]>> = {
  0: ["KeyZ", "KeyX"],
  1: ["KeyD", "KeyF", "KeyJ", "KeyK"],
  2: ["ArrowLeft", "ShiftLeft", "ArrowRight"],
};

export interface InputLayout {
  count: number;
  mode: number;
  name: string;
}

export function inputLayout(chart: ChartInput): InputLayout {
  if (chart.mode === 3) {
    const count = chart.keys ?? 4;
    return { count, mode: chart.mode, name: `${count}K` };
  }

  const count = mode_bindings[chart.mode]?.length ?? 0;
  const names = ["OSU!", "TAIKO", "FRUITS"];
  return { count, mode: chart.mode, name: names[chart.mode] ?? "UNKNOWN" };
}

function defaultBindings(layout: InputLayout): (string | null)[] {
  const defaults = layout.mode === 3
    ? default_mania_bindings[layout.count]
    : mode_bindings[layout.mode];

  return Array.from({ length: layout.count }, (_, index) => defaults?.[index] ?? null);
}

function storageKey(layout: InputLayout): string {
  return `${INPUT_BINDINGS_STORAGE_PREFIX}.${layout.mode}.${layout.count}`;
}

export function loadInputBindings(layout: InputLayout): (string | null)[] {
  const defaults = defaultBindings(layout);

  try {
    const stored_value = localStorage.getItem(storageKey(layout));
    if (stored_value === null) return defaults;
    const stored_bindings: unknown = JSON.parse(stored_value);
    if (!Array.isArray(stored_bindings) || stored_bindings.length !== layout.count) return defaults;
    if (!stored_bindings.every((binding) => binding === null || typeof binding === "string")) return defaults;
    return stored_bindings;
  } catch {
    return defaults;
  }
}

export function saveInputBindings(layout: InputLayout, bindings: readonly (string | null)[]) {
  try {
    localStorage.setItem(storageKey(layout), JSON.stringify(bindings));
  } catch {
    // Keep the binding usable for this session when storage is unavailable.
  }
}

export function inputCodeLabel(code: string): string {
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  if (code.startsWith("Numpad")) return `NUM ${code.slice(6).toUpperCase()}`;

  const labels: Readonly<Record<string, string>> = {
    ArrowDown: "DOWN",
    ArrowLeft: "LEFT",
    ArrowRight: "RIGHT",
    ArrowUp: "UP",
    Backquote: "`",
    Backslash: "\\",
    BracketLeft: "[",
    BracketRight: "]",
    Comma: ",",
    Equal: "=",
    Minus: "-",
    Period: ".",
    Quote: "'",
    Semicolon: ";",
    ShiftLeft: "L SHIFT",
    ShiftRight: "R SHIFT",
    Slash: "/",
    Space: "SPACE",
  };

  return labels[code] ?? code.replace(/([a-z])([A-Z])/g, "$1 $2").toUpperCase();
}
