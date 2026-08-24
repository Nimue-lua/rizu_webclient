import { loadOsuManiaSkinUrl } from "./OsuSkin";

export const NOTE_SKIN_LOGICAL_HEIGHT = 480;

export interface NoteSkinConfig {
  mode: "mania";
  columnCount: number;
  columnStart: number;
  columnWidths: readonly number[];
  columnSpacing: readonly number[];
  columnLineWidths: readonly number[];
  columnLineColor: readonly [number, number, number, number];
  hitPosition: number;
  comboPosition: number;
  judgePosition: number;
  upsideDown: boolean;
  shortNotes: readonly string[];
  shortNoteFlipY: readonly boolean[];
  longNoteHeads: readonly string[];
  longNoteHeadFlipY: readonly boolean[];
  longNoteBodies: readonly string[];
  longNoteBodyFlipY: readonly boolean[];
  longNoteTails: readonly string[];
  longNoteTailFlipY: readonly boolean[];
  receptorReleased: readonly string[];
  receptorPressed: readonly string[];
  receptorFlipY: readonly boolean[];
  stageHint?: string;
  stageLeft?: string;
  stageRight?: string;
  stageBottom?: string;
  judgments: Readonly<Record<string, readonly string[]>>;
  scoreGlyphs: Readonly<Record<string, string>>;
  comboGlyphs: Readonly<Record<string, string>>;
  scoreOverlap: number;
  comboOverlap: number;
  hpBackground?: string;
  hpFill?: string;
}

export interface NoteSkinSprite {
  image: ImageBitmap;
  sourceSize: { w: number; h: number };
  pixelSize: { w: number; h: number };
}

export interface SpriteSkin {
  sprites: Readonly<Record<string, NoteSkinSprite>>;
}

export interface NoteSkin {
  config: NoteSkinConfig;
  sprites: Readonly<Record<string, NoteSkinSprite>>;
}

export function destroyNoteSkin(skin: SpriteSkin): void {
  for (const sprite of new Set(Object.values(skin.sprites))) sprite.image.close();
}

export async function loadNoteSkinZip(url: string, column_count: number, signal?: AbortSignal): Promise<NoteSkin> {
  return loadOsuManiaSkinUrl(url, column_count, signal);
}
