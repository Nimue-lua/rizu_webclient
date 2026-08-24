import type { NoteSkin, NoteSkinConfig, NoteSkinSprite } from "./NoteSkin";

export type SkinIniSection = Readonly<Record<string, string>>;

export interface SkinIni {
  readonly sections: Readonly<Record<string, SkinIniSection>>;
  readonly mania: readonly SkinIniSection[];
}

const DEFAULT_SPRITE_PATH = "/osu-defaults";
const DEFAULT_SPRITE_NAMES = [
  "mania-key1", "mania-key1D", "mania-key2", "mania-key2D", "mania-keyS", "mania-keySD",
  "mania-note1", "mania-note1L", "mania-note1T", "mania-note2", "mania-note2L", "mania-note2T",
  "mania-noteS", "mania-noteSL", "mania-noteST",
  "mania-stage-hint", "mania-stage-left", "mania-stage-right",
] as const;

export function parseSkinIni(source: string): SkinIni {
  const sections: Record<string, Record<string, string>> = {};
  const mania: Record<string, string>[] = [];
  let current: Record<string, string> | undefined;

  for (const source_line of source.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const line = source_line.trim();
    const header = /^\[([^\]]+)\]$/.exec(line);
    if (header) {
      const name = header[1]!.trim();
      if (name.toLowerCase() === "mania") {
        current = {};
        mania.push(current);
      } else {
        current = sections[name] ??= {};
      }
      continue;
    }
    const separator = line.indexOf(":");
    if (!current || separator < 0) continue;
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).replace(/\/\/.*$/, "").trim();
    if (key) current[key] = value;
  }
  return { sections, mania };
}

function numberValue(section: SkinIniSection, key: string, fallback: number): number {
  const value = Number(section[key]);
  return Number.isFinite(value) ? value : fallback;
}

function booleanValue(section: SkinIniSection, key: string): boolean | undefined {
  const value = section[key];
  if (value === undefined || value === "") return undefined;
  return value === "1" || value.toLowerCase() === "true";
}

function flipWhenUpsideDown(section: SkinIniSection, kind: "Key" | "Note", column: number,
  suffix: string, fallback: boolean, upside_down: boolean): boolean {
  if (!upside_down) return false;
  return booleanValue(section, `${kind}FlipWhenUpsideDown${column}${suffix}`) ??
    booleanValue(section, `${kind}FlipWhenUpsideDown${suffix}`) ?? fallback;
}

function numberList(section: SkinIniSection, key: string, length: number, fallback: number): number[] {
  const values = section[key]?.split(",") ?? [];
  return Array.from({ length }, (_, index) => {
    const value = Number(values[index]?.trim());
    return values[index] !== undefined && Number.isFinite(value) ? value : fallback;
  });
}

export function osuManiaColumnType(column: number, column_count: number, special_style: number): "1" | "2" | "S" {
  let key = column + 1;
  if (special_style === 1) {
    if (key === 1) return "S";
    key -= 1;
    column_count -= 1;
  } else if (special_style === 2) {
    if (key === column_count) return "S";
    column_count -= 1;
  }
  const modulo2 = (value: number) => ((value % 2) + 2) % 2;
  if (column_count % 2 === 1) {
    if (key === (column_count + 1) / 2) return special_style === 0 ? "S" : "2";
    return modulo2((column_count - 1) / 2 - key + 1) === 1 ? "1" : "2";
  }
  const odd = modulo2(column_count / 2 - key + 1) === 1;
  return odd === (key <= column_count / 2) ? "1" : "2";
}

export function parseOsuManiaConfig(ini: SkinIni, column_count: number): NoteSkinConfig {
  const section = ini.mania.find((candidate) => Number(candidate.Keys) === column_count);
  if (!section) throw new Error(`Skin does not contain a ${column_count}K [Mania] section`);
  const special_style = numberValue(section, "SpecialStyle", 0);
  const upsideDown = numberValue(section, "UpsideDown", 0) === 1;
  const version_value = ini.sections.General?.Version;
  const skin_version = version_value?.toLowerCase() === "latest" ? Infinity : Number(version_value ?? 1);
  const noteFlip = (column: number, suffix = "", fallback = true) =>
    skin_version >= 2.5 && flipWhenUpsideDown(section, "Note", column, suffix, fallback, upsideDown);
  const shortNoteFlipY = Array.from({ length: column_count }, (_, column) => noteFlip(column));
  const columnWidths = numberList(section, "ColumnWidth", column_count, 30);
  const columnSpacing = numberList(section, "ColumnSpacing", Math.max(0, column_count - 1), 0)
    .map((spacing, index) => Math.max(spacing, -columnWidths[index + 1]!));
  const spriteList = (key: (column: number) => string, suffix: string) =>
    Array.from({ length: column_count }, (_, column) => section[key(column)]?.replace(/\\/g, "/") ??
      `mania-${key(column).startsWith("Key") ? "key" : "note"}${osuManiaColumnType(column, column_count, special_style)}${suffix}`);

  return {
    mode: "mania",
    columnCount: column_count,
    columnStart: numberValue(section, "ColumnStart", 136),
    columnWidths,
    columnSpacing,
    hitPosition: numberValue(section, "HitPosition", 402),
    comboPosition: numberValue(section, "ComboPosition", 111),
    judgePosition: numberValue(section, "ScorePosition", 325),
    upsideDown,
    shortNotes: spriteList((column) => `NoteImage${column}`, ""),
    shortNoteFlipY,
    longNoteHeads: spriteList((column) => `NoteImage${column}H`, "H"),
    longNoteHeadFlipY: shortNoteFlipY.map((flip, column) => noteFlip(column, "H", flip)),
    longNoteBodies: spriteList((column) => `NoteImage${column}L`, "L"),
    longNoteBodyFlipY: Array.from({ length: column_count }, (_, column) => noteFlip(column, "L")),
    longNoteTails: spriteList((column) => `NoteImage${column}T`, "T"),
    longNoteTailFlipY: Array.from({ length: column_count }, (_, column) => !noteFlip(column, "T")),
    receptorReleased: spriteList((column) => `KeyImage${column}`, ""),
    receptorPressed: spriteList((column) => `KeyImage${column}D`, "D"),
    receptorFlipY: Array.from({ length: column_count }, (_, column) =>
      flipWhenUpsideDown(section, "Key", column, "", true, upsideDown)),
    stageHint: section.StageHint?.replace(/\\/g, "/") ?? "mania-stage-hint",
    stageLeft: section.StageLeft?.replace(/\\/g, "/") ?? "mania-stage-left",
    stageRight: section.StageRight?.replace(/\\/g, "/") ?? "mania-stage-right",
    stageBottom: section.StageBottom?.replace(/\\/g, "/") ?? "mania-stage-bottom",
  };
}

interface SpriteFile {
  bytes: Uint8Array;
  dpi: number;
}

const MAX_TEXTURE_SIZE = 4096;

function pngSize(bytes: Uint8Array): { width: number; height: number } {
  if (bytes.length < 24 || bytes[0] !== 0x89 || bytes[1] !== 0x50 || bytes[2] !== 0x4e || bytes[3] !== 0x47) {
    throw new Error("Invalid PNG sprite");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

function spriteFiles(files: Readonly<Record<string, Uint8Array>>, directory: string): ReadonlyMap<string, SpriteFile> {
  const sprites = new Map<string, SpriteFile>();
  for (const [path, bytes] of Object.entries(files)) {
    if (!path.toLowerCase().startsWith(directory.toLowerCase()) || !/\.png$/i.test(path)) continue;
    const relative = path.slice(directory.length).replace(/\\/g, "/");
    const dpi = /@2x\.png$/i.test(relative) ? 2 : 1;
    const name = relative.replace(/@2x(?=\.png$)/i, "").replace(/\.png$/i, "").toLowerCase();
    if (!sprites.has(name) || dpi > sprites.get(name)!.dpi) sprites.set(name, { bytes, dpi });
  }
  return sprites;
}

function normalizedSpriteName(name: string): string {
  return name.replace(/\\/g, "/").replace(/\.(png|jpg|jpeg|bmp|tga)$/i, "").toLowerCase();
}

export function resolveOsuManiaTail(tail_name: string, resolved_head: string,
  default_tail: string, skin_sprites: ReadonlySet<string>, default_sprites: ReadonlySet<string>): string {
  if (skin_sprites.has(normalizedSpriteName(tail_name))) return tail_name;
  if (skin_sprites.has(normalizedSpriteName(resolved_head))) return resolved_head;
  return default_sprites.has(normalizedSpriteName(default_tail)) ? default_tail : resolved_head;
}

let default_sprites: Promise<ReadonlyMap<string, SpriteFile>> | undefined;

function defaultSpriteFiles(): Promise<ReadonlyMap<string, SpriteFile>> {
  if (default_sprites) return default_sprites;
  const sprites = new Map<string, SpriteFile>();
  default_sprites = Promise.all(DEFAULT_SPRITE_NAMES.map(async (name) => {
    const response = await fetch(`${DEFAULT_SPRITE_PATH}/${name}@2x.png`);
    if (!response.ok) throw new Error(`Failed to fetch default osu sprite ${name}: ${response.status} ${response.statusText}`);
    sprites.set(name.toLowerCase(), { bytes: new Uint8Array(await response.arrayBuffer()), dpi: 2 });
  })).then(() => sprites);
  return default_sprites;
}

export async function loadOsuManiaSkin(files: Readonly<Record<string, Uint8Array>>, column_count: number): Promise<NoteSkin> {
  const ini_path = Object.keys(files).find((path) => /(^|\/)skin\.ini$/i.test(path));
  if (!ini_path) throw new Error("osu skin archive is missing skin.ini");
  const directory = ini_path.slice(0, ini_path.lastIndexOf("/") + 1);
  const ini = parseSkinIni(new TextDecoder().decode(files[ini_path]!));
  const config = parseOsuManiaConfig(ini, column_count);
  const available = spriteFiles(files, directory);
  const defaults = await defaultSpriteFiles();
  const section = ini.mania.find((candidate) => Number(candidate.Keys) === column_count)!;
  const types = Array.from({ length: column_count }, (_, column) =>
    osuManiaColumnType(column, column_count, numberValue(section, "SpecialStyle", 0)));
  const resolve = (name: string, fallback: string) => {
    const normalized = name.replace(/\.(png|jpg|jpeg|bmp|tga)$/i, "").toLowerCase();
    if (available.has(normalized)) return name;
    return fallback;
  };
  const shortNotes = config.shortNotes.map((name, column) => resolve(name, `mania-note${types[column]}`));
  const longNoteHeads = config.longNoteHeads.map((name, column) => resolve(name, shortNotes[column]!));
  const longNoteTails = config.longNoteTails.map((name, column) => resolveOsuManiaTail(
    name, longNoteHeads[column]!, `mania-note${types[column]}T`,
    new Set(available.keys()), new Set(defaults.keys()),
  ));
  const resolved_config: NoteSkinConfig = {
    ...config,
    shortNotes,
    longNoteHeads,
    longNoteBodies: config.longNoteBodies.map((name, column) => resolve(name, `mania-note${types[column]}L`)),
    longNoteTails,
    receptorReleased: config.receptorReleased.map((name, column) => resolve(name, `mania-key${types[column]}`)),
    receptorPressed: config.receptorPressed.map((name, column) => resolve(name, `mania-key${types[column]}D`)),
    stageHint: resolveOptional(config.stageHint, "mania-stage-hint", available, defaults),
    stageLeft: resolveOptional(config.stageLeft, "mania-stage-left", available, defaults),
    stageRight: resolveOptional(config.stageRight, "mania-stage-right", available, defaults),
    stageBottom: resolveOptional(config.stageBottom, "mania-stage-bottom", available, defaults),
  };
  const names = [...new Set([
    ...resolved_config.shortNotes, ...resolved_config.longNoteHeads, ...resolved_config.longNoteBodies, ...resolved_config.longNoteTails,
    ...resolved_config.receptorReleased, ...resolved_config.receptorPressed,
    ...[resolved_config.stageHint, resolved_config.stageLeft, resolved_config.stageRight, resolved_config.stageBottom]
      .filter((name): name is string => name !== undefined),
  ])];
  const decoded = await Promise.all(names.map(async (name) => {
    const normalized = name.replace(/\.(png|jpg|jpeg|bmp|tga)$/i, "").toLowerCase();
    const file = available.get(normalized) ?? defaults.get(normalized);
    if (!file) throw new Error(`Skin is missing sprite ${name}`);
    const source = pngSize(file.bytes);
    const scale = Math.min(1, MAX_TEXTURE_SIZE / source.width, MAX_TEXTURE_SIZE / source.height);
    const image = await createImageBitmap(new Blob([file.bytes as Uint8Array<ArrayBuffer>], { type: "image/png" }), {
      premultiplyAlpha: "none",
      resizeWidth: Math.max(1, Math.round(source.width * scale)),
      resizeHeight: Math.max(1, Math.round(source.height * scale)),
      resizeQuality: "high",
    });
    return { name, image, dpi: file.dpi, source };
  }));
  const sprites: Record<string, NoteSkinSprite> = {};
  for (const { name, image, dpi, source } of decoded) {
    sprites[name] = {
      image,
      sourceSize: { w: source.width / dpi, h: source.height / dpi },
      pixelSize: { w: source.width, h: source.height },
    };
  }
  return { config: resolved_config, sprites };
}

function resolveOptional(name: string | undefined, fallback: string, available: ReadonlyMap<string, SpriteFile>,
  defaults: ReadonlyMap<string, SpriteFile>): string | undefined {
  if (name && available.has(normalizedSpriteName(name))) return name;
  if (available.has(normalizedSpriteName(fallback)) || defaults.has(normalizedSpriteName(fallback))) return fallback;
  return undefined;
}
