import { unzipSync } from "fflate";
import { loadOsuManiaSkin } from "./OsuSkin";

export const NOTE_SKIN_LOGICAL_HEIGHT = 480;

export interface NoteSkinConfig {
  mode: "mania";
  columnCount: number;
  columnStart: number;
  columnWidths: readonly number[];
  columnSpacing: readonly number[];
  hitPosition: number;
  comboPosition: number;
  judgePosition: number;
  shortNotes: readonly string[];
  longNoteHeads: readonly string[];
  longNoteBodies: readonly string[];
  longNoteTails: readonly string[];
  receptorReleased: readonly string[];
  receptorPressed: readonly string[];
}

export interface NoteSkinFrame {
  frame: { x: number; y: number; w: number; h: number };
  spriteSourceSize: { x: number; y: number; w: number; h: number };
  sourceSize: { w: number; h: number };
  pixelSize: { w: number; h: number };
}

export interface NoteSkin {
  config: NoteSkinConfig;
  frames: Readonly<Record<string, NoteSkinFrame>>;
  image: ImageBitmap;
}

export async function loadNoteSkinZip(url: string, column_count: number, signal?: AbortSignal): Promise<NoteSkin> {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`Failed to fetch skin ${url}: ${response.status} ${response.statusText}`);
  const files = unzipSync(new Uint8Array(await response.arrayBuffer()));
  return loadOsuManiaSkin(files, column_count);
}
