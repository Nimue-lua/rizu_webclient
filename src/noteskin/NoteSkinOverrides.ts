export interface NoteSkinOverrides {
  readonly mania?: {
    readonly hitPosition?: number;
    readonly columnStart?: number;
    readonly judgePosition?: number;
    readonly comboPosition?: number;
  };
}

const STORAGE_KEY = "rizu.note-skin-overrides";

interface PersistedOverrides {
  readonly version: 1;
  readonly values: Readonly<Record<string, NoteSkinOverrides>>;
}

export function noteSkinOverrideKey(skin_id: string, mode: string, column_count: number | null): string {
  return `${skin_id}:${column_count === null ? mode : `${mode}.${column_count}`}`;
}

export function loadNoteSkinOverrides(key: string): NoteSkinOverrides {
  try {
    const document: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    if (!isRecord(document) || document.version !== 1 || !isRecord(document.values)) return {};
    const value = document.values[key];
    if (!isRecord(value) || !isRecord(value.mania)) return {};
    const hit_position = validNumber(value.mania.hitPosition, 0, 480);
    const column_start = validNumber(value.mania.columnStart, 0, 854);
    const judge_position = validNumber(value.mania.judgePosition, 0, 480);
    const combo_position = validNumber(value.mania.comboPosition, 0, 480);
    return hit_position === undefined && column_start === undefined && judge_position === undefined && combo_position === undefined ? {} : {
      mania: {
        ...(hit_position === undefined ? {} : { hitPosition: hit_position }),
        ...(column_start === undefined ? {} : { columnStart: column_start }),
        ...(judge_position === undefined ? {} : { judgePosition: judge_position }),
        ...(combo_position === undefined ? {} : { comboPosition: combo_position }),
      },
    };
  } catch {
    return {};
  }
}

export function saveManiaHitPositionOverride(key: string, hit_position: number | undefined): void {
  if (hit_position !== undefined && (!Number.isFinite(hit_position) || hit_position < 0 || hit_position > 480)) {
    throw new Error("Invalid mania hit position override");
  }
  saveManiaOverride(key, "hitPosition", hit_position);
}

export function saveManiaColumnStartOverride(key: string, column_start: number | undefined): void {
  if (column_start !== undefined && (!Number.isFinite(column_start) || column_start < 0 || column_start > 854)) {
    throw new Error("Invalid mania column start override");
  }
  saveManiaOverride(key, "columnStart", column_start);
}

export function saveManiaJudgePositionOverride(key: string, judge_position: number | undefined): void {
  if (judge_position !== undefined && (!Number.isFinite(judge_position) || judge_position < 0 || judge_position > 480)) {
    throw new Error("Invalid mania judge position override");
  }
  saveManiaOverride(key, "judgePosition", judge_position);
}

export function saveManiaComboPositionOverride(key: string, combo_position: number | undefined): void {
  if (combo_position !== undefined && (!Number.isFinite(combo_position) || combo_position < 0 || combo_position > 480)) {
    throw new Error("Invalid mania combo position override");
  }
  saveManiaOverride(key, "comboPosition", combo_position);
}

export function deleteNoteSkinOverrides(skin_id: string): void {
  try {
    const current = readDocument();
    const prefix = `${skin_id}:`;
    const values = Object.fromEntries(Object.entries(current.values).filter(([key]) => !key.startsWith(prefix)));
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, values } satisfies PersistedOverrides));
  } catch {
    // Deleting the skin remains useful when override storage is unavailable.
  }
}

function readDocument(): PersistedOverrides {
  const document: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
  return isRecord(document) && document.version === 1 && isRecord(document.values)
    ? { version: 1, values: document.values as Record<string, NoteSkinOverrides> }
    : { version: 1, values: {} };
}

function saveManiaOverride(key: string,
  field: "hitPosition" | "columnStart" | "judgePosition" | "comboPosition", value: number | undefined): void {
  try {
    const current = readDocument();
    const values = { ...current.values };
    const mania = { ...values[key]?.mania };
    if (value === undefined) delete mania[field];
    else mania[field] = value;
    if (Object.keys(mania).length === 0) delete values[key];
    else values[key] = { ...values[key], mania };
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, values } satisfies PersistedOverrides));
  } catch {
    // Keep the live editor usable when browser storage is unavailable.
  }
}

function validNumber(value: unknown, minimum: number, maximum: number): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
