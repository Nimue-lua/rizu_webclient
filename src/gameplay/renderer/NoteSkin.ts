import { unzipSync } from "fflate";
import JSON5 from "json5";

export const NOTE_SKIN_LOGICAL_HEIGHT = 480;
const DEFAULT_COLUMN_SIZE = 60;

export interface NoteSkinConfig {
  mode: string;
  columnCount: number;
  columnSize: readonly number[];
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

export function parseNoteSkinConfig(value: unknown): NoteSkinConfig {
  if (typeof value !== "object" || value === null) throw new Error("Skin config must be an object");
  const raw = value as Record<string, unknown>;
  if (typeof raw.mode !== "string" || raw.mode.length === 0) throw new Error("Skin mode is required");
  if (!Number.isInteger(raw.columnCount) || (raw.columnCount as number) <= 0) throw new Error("Skin columnCount is required");
  const columnCount = raw.columnCount as number;
  const columnSize = raw.columnSize;
  if (columnSize !== undefined && (!Array.isArray(columnSize) ||
    columnSize.some((size) => !finiteNumber(size) || size <= 0))) {
    throw new Error("columnSize must contain positive widths");
  }
  if (raw.align !== undefined && (!finiteNumber(raw.align) || raw.align < 0 || raw.align > 1)) {
    throw new Error("align must be a number from 0 to 1");
  }
  for (const field of ["hitPosition", "comboPosition", "judgePosition"] as const) {
    if (raw[field] !== undefined && !finiteNumber(raw[field])) throw new Error(`${field} must be a number`);
  }
  return {
    mode: raw.mode,
    columnCount,
    columnSize: Array.from({ length: columnCount }, (_, column) => (columnSize as number[] | undefined)?.[column] ?? DEFAULT_COLUMN_SIZE),
    align: raw.align as number | undefined ?? 0.5,
    hitPosition: raw.hitPosition as number | undefined ?? 380,
    comboPosition: raw.comboPosition as number | undefined ?? 200,
    judgePosition: raw.judgePosition as number | undefined ?? 250,
    shortNotes: stringArray(raw.shortNotes, columnCount, "shortNotes"),
    longNoteHeads: stringArray(raw.longNoteHeads, columnCount, "longNoteHeads"),
    longNoteBodies: stringArray(raw.longNoteBodies, columnCount, "longNoteBodies"),
    longNoteTails: stringArray(raw.longNoteTails, columnCount, "longNoteTails"),
    receptorReleased: stringArray(raw.receptorReleased, columnCount, "receptorReleased"),
    receptorPressed: stringArray(raw.receptorPressed, columnCount, "receptorPressed"),
  };
}

export async function loadNoteSkinZip(url: string, signal?: AbortSignal): Promise<NoteSkin> {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`Failed to fetch skin ${url}: ${response.status} ${response.statusText}`);
  const files = unzipSync(new Uint8Array(await response.arrayBuffer()));
  const config_path = Object.keys(files).find((path) => /(^|\/)skin\.[^.\/]+\.json$/i.test(path));
  if (!config_path) throw new Error("Skin is missing skin.<variant>.json");
  const config = parseNoteSkinConfig(readJson(files, config_path));
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
