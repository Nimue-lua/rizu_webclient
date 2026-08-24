import { unzipSync } from "fflate";
import JSON5 from "json5";
import { getColumnColorNames, type ColumnColorName } from "../ColumnColors";

export const NOTE_SKIN_LOGICAL_HEIGHT = 480;
const DEFAULT_COLUMN_SIZE = 60;

export interface NoteSkinConfig {
  mode: string;
  columnCount: number;
  columnSize: number;
  gap: number;
  align: number;
  hitPosition: number;
  comboPosition: number;
  judgePosition: number;
  shortNotes?: readonly (string | undefined)[];
  longNoteHeads?: readonly (string | undefined)[];
  longNoteBodies?: readonly (string | undefined)[];
  longNoteTails?: readonly (string | undefined)[];
  receptorReleased?: readonly (string | undefined)[];
  receptorPressed?: readonly (string | undefined)[];
}

type AnyKeySprites = Readonly<Record<ColumnColorName, string | undefined>>;

export interface AnyKeyNoteSkinConfig extends Omit<NoteSkinConfig, "columnCount" | "shortNotes" | "longNoteHeads" |
  "longNoteBodies" | "longNoteTails" | "receptorReleased" | "receptorPressed"> {
  shortNotes?: AnyKeySprites;
  longNoteHeads?: AnyKeySprites;
  longNoteBodies?: AnyKeySprites;
  longNoteTails?: AnyKeySprites;
  receptorReleased?: AnyKeySprites;
  receptorPressed?: AnyKeySprites;
}

export interface NoteSkinFrame {
  frame: { x: number; y: number; w: number; h: number };
  spriteSourceSize: { x: number; y: number; w: number; h: number };
  sourceSize: { w: number; h: number };
}

export interface NoteSkin {
  config: NoteSkinConfig;
  frames: Readonly<Record<string, NoteSkinFrame>>;
  image: ImageBitmap;
}

interface PhaserAtlas {
  frames: Record<string, NoteSkinFrame & { rotated?: boolean }>;
  meta: { image: string };
}

function readJson(files: Readonly<Record<string, Uint8Array>>, path: string): unknown {
  const file = files[path];
  if (!file) throw new Error(`Skin is missing ${path}`);
  return JSON5.parse(new TextDecoder().decode(file));
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function stringArray(value: unknown, column_count: number, field: string): readonly (string | undefined)[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((item) => item !== undefined && typeof item !== "string")) {
    throw new Error(`${field} must be an array of sprite names`);
  }
  return Array.from({ length: column_count }, (_, column) => value[column] as string | undefined);
}

function spritesByColor(value: unknown, field: string): AnyKeySprites | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${field} must map column colors to sprite names`);
  }
  const raw = value as Record<string, unknown>;
  for (const color of ["white", "pink", "yellow"] as const) {
    if (raw[color] !== undefined && typeof raw[color] !== "string") {
      throw new Error(`${field}.${color} must be a sprite name`);
    }
  }
  return { white: raw.white as string | undefined, pink: raw.pink as string | undefined, yellow: raw.yellow as string | undefined };
}

function parseLayout(raw: Record<string, unknown>) {
  if (raw.columnSize !== undefined && (!finiteNumber(raw.columnSize) || raw.columnSize <= 0)) {
    throw new Error("columnSize must be a positive width");
  }
  if (raw.align !== undefined && (!finiteNumber(raw.align) || raw.align < 0 || raw.align > 1)) {
    throw new Error("align must be a number from 0 to 1");
  }
  if (raw.gap !== undefined && (!finiteNumber(raw.gap) || raw.gap < 0)) {
    throw new Error("gap must be a non-negative number");
  }
  for (const field of ["hitPosition", "comboPosition", "judgePosition"] as const) {
    if (raw[field] !== undefined && !finiteNumber(raw[field])) throw new Error(`${field} must be a number`);
  }
  return {
    columnSize: raw.columnSize as number | undefined ?? DEFAULT_COLUMN_SIZE,
    gap: raw.gap as number | undefined ?? 0,
    align: raw.align as number | undefined ?? 0.5,
    hitPosition: raw.hitPosition as number | undefined ?? 380,
    comboPosition: raw.comboPosition as number | undefined ?? 200,
    judgePosition: raw.judgePosition as number | undefined ?? 250,
  };
}

function configObject(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null) throw new Error("Skin config must be an object");
  const raw = value as Record<string, unknown>;
  if (typeof raw.mode !== "string" || raw.mode.length === 0) throw new Error("Skin mode is required");
  return raw;
}

export function parseNoteSkinConfig(value: unknown): NoteSkinConfig {
  const raw = configObject(value);
  if (!Number.isInteger(raw.columnCount) || (raw.columnCount as number) <= 0) throw new Error("Skin columnCount is required");
  const columnCount = raw.columnCount as number;
  return {
    mode: raw.mode as string,
    columnCount,
    ...parseLayout(raw),
    shortNotes: stringArray(raw.shortNotes, columnCount, "shortNotes"),
    longNoteHeads: stringArray(raw.longNoteHeads, columnCount, "longNoteHeads"),
    longNoteBodies: stringArray(raw.longNoteBodies, columnCount, "longNoteBodies"),
    longNoteTails: stringArray(raw.longNoteTails, columnCount, "longNoteTails"),
    receptorReleased: stringArray(raw.receptorReleased, columnCount, "receptorReleased"),
    receptorPressed: stringArray(raw.receptorPressed, columnCount, "receptorPressed"),
  };
}

export function parseAnyKeyNoteSkinConfig(value: unknown): AnyKeyNoteSkinConfig {
  const raw = configObject(value);
  return {
    mode: raw.mode as string,
    ...parseLayout(raw),
    shortNotes: spritesByColor(raw.shortNotes, "shortNotes"),
    longNoteHeads: spritesByColor(raw.longNoteHeads, "longNoteHeads"),
    longNoteBodies: spritesByColor(raw.longNoteBodies, "longNoteBodies"),
    longNoteTails: spritesByColor(raw.longNoteTails, "longNoteTails"),
    receptorReleased: spritesByColor(raw.receptorReleased, "receptorReleased"),
    receptorPressed: spritesByColor(raw.receptorPressed, "receptorPressed"),
  };
}

export function expandAnyKeyNoteSkinConfig(config: AnyKeyNoteSkinConfig, column_count: number): NoteSkinConfig {
  if (!Number.isInteger(column_count) || column_count <= 0) throw new Error("Skin column count must be positive");
  const colors = getColumnColorNames(column_count);
  const expand = (sprites: AnyKeySprites | undefined) => sprites && colors.map((color) => sprites[color]);
  return {
    ...config,
    columnCount: column_count,
    shortNotes: expand(config.shortNotes),
    longNoteHeads: expand(config.longNoteHeads),
    longNoteBodies: expand(config.longNoteBodies),
    longNoteTails: expand(config.longNoteTails),
    receptorReleased: expand(config.receptorReleased),
    receptorPressed: expand(config.receptorPressed),
  };
}

export async function loadNoteSkinZip(url: string, column_count: number, signal?: AbortSignal): Promise<NoteSkin> {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`Failed to fetch skin ${url}: ${response.status} ${response.statusText}`);
  const files = unzipSync(new Uint8Array(await response.arrayBuffer()));
  const paths = Object.keys(files);
  const fixed_pattern = new RegExp(`(^|/)skin\\.${column_count}k\\.json$`, "i");
  const config_path = paths.find((path) => fixed_pattern.test(path)) ?? paths.find((path) => /(^|\/)anykey\.skin\.json$/i.test(path));
  if (!config_path) throw new Error(`Skin does not support ${column_count}K`);
  const value = readJson(files, config_path);
  const config = /(^|\/)anykey\.skin\.json$/i.test(config_path)
    ? expandAnyKeyNoteSkinConfig(parseAnyKeyNoteSkinConfig(value), column_count)
    : parseNoteSkinConfig(value);
  if (config.columnCount !== column_count) {
    throw new Error(`${config_path} declares ${config.columnCount} columns instead of ${column_count}`);
  }
  const config_directory = config_path.slice(0, config_path.lastIndexOf("/") + 1);
  const atlas_path = `${config_directory}spritesheet.json`;
  const atlas = readJson(files, atlas_path) as PhaserAtlas;
  if (typeof atlas !== "object" || atlas === null || typeof atlas.meta?.image !== "string" || typeof atlas.frames !== "object") {
    throw new Error("Invalid Phaser spritesheet.json");
  }
  for (const [name, frame] of Object.entries(atlas.frames)) {
    if (frame.rotated) throw new Error(`Rotated atlas frame is not supported: ${name}`);
  }
  const image_file = files[`${config_directory}${atlas.meta.image}`];
  if (!image_file) throw new Error(`Skin is missing ${atlas.meta.image}`);
  const image = await createImageBitmap(new Blob([image_file as Uint8Array<ArrayBuffer>], { type: "image/png" }), {
    premultiplyAlpha: "none",
  });
  return { config, frames: atlas.frames, image };
}
