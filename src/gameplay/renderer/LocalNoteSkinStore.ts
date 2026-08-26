import { unzipSync } from "fflate";
import { parseSkinIni } from "./OsuSkin";
import type { NoteSkinOption } from "./NoteSkinSelection";

const DATABASE_NAME = "rizu-local-skins";
const STORE_NAME = "skins";
const MAX_PERSISTED_ARCHIVE_SIZE = 100 * 1024 * 1024;
const MAX_SESSION_ARCHIVE_SIZE = 250 * 1024 * 1024;
const MAX_EXTRACTED_SIZE = 500 * 1024 * 1024;

export interface StoredLocalNoteSkin {
  readonly id: string;
  readonly name: string;
  readonly archive: Blob;
  readonly supportsOsu: boolean;
  readonly maniaColumnCounts: readonly number[];
}

export function shouldPersistLocalNoteSkin(archive_size: number): boolean {
  return archive_size <= MAX_PERSISTED_ARCHIVE_SIZE;
}

interface SkinArchiveFile {
  readonly name: string;
  readonly size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME, { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open local skin storage"));
  });
}

export async function loadLocalNoteSkins(): Promise<readonly StoredLocalNoteSkin[]> {
  const database = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const request = database.transaction(STORE_NAME).objectStore(STORE_NAME).getAll();
      request.onsuccess = () => resolve(request.result as StoredLocalNoteSkin[]);
      request.onerror = () => reject(request.error ?? new Error("Could not load local skins"));
    });
  } finally {
    database.close();
  }
}

export async function saveLocalNoteSkin(skin: StoredLocalNoteSkin): Promise<void> {
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).put(skin);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("Could not save local skin"));
      transaction.onabort = () => reject(transaction.error ?? new Error("Could not save local skin"));
    });
  } finally {
    database.close();
  }
}

export async function inspectLocalNoteSkin(file: SkinArchiveFile): Promise<StoredLocalNoteSkin> {
  if (!/\.osk$/i.test(file.name)) throw new Error("Choose an .osk skin archive");
  if (file.size > MAX_SESSION_ARCHIVE_SIZE) throw new Error("Skin archives must be 250 MB or smaller");

  const archive_data = await file.arrayBuffer();
  let files: Readonly<Record<string, Uint8Array>>;
  try {
    files = unzipSync(new Uint8Array(archive_data));
  } catch {
    throw new Error("The selected file is not a valid .osk archive");
  }
  const extracted_size = Object.values(files).reduce((total, bytes) => total + bytes.byteLength, 0);
  if (extracted_size > MAX_EXTRACTED_SIZE) throw new Error("The extracted skin is too large");

  const ini_path = Object.keys(files).find((path) => /(^|\/)skin\.ini$/i.test(path.replace(/\\/g, "/")));
  if (!ini_path) throw new Error("The .osk archive does not contain skin.ini");
  const directory = ini_path.replace(/\\/g, "/").replace(/[^/]*$/, "");
  const ini = parseSkinIni(new TextDecoder().decode(files[ini_path]!));
  const mania_column_counts = [...new Set(ini.mania.map((section) => Number(section.Keys))
    .filter((count) => Number.isInteger(count) && count > 0 && count <= 100))].sort((a, b) => a - b);
  const standard_sprite = /^(hitcircle|hitcircleoverlay|approachcircle|sliderb\d*|sliderfollowcircle|sliderendcircle(?:overlay)?|reversearrow|sliderscorepoint|cursor|spinner-(?:background|circle|metre|approachcircle|rpm|top|bottom|middle))(@2x)?\.png$/i;
  const supports_osu = Object.keys(files).some((path) => {
    const normalized = path.replace(/\\/g, "/");
    return normalized.toLowerCase().startsWith(directory.toLowerCase()) && standard_sprite.test(normalized.slice(directory.length));
  });
  if (!supports_osu && mania_column_counts.length === 0) {
    throw new Error("This archive has no supported osu or mania gameplay skin");
  }

  const digest = await crypto.subtle.digest("SHA-256", archive_data);
  const id = `local:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
  const fallback_name = file.name.replace(/\.osk$/i, "");
  return {
    id,
    name: ini.sections.General?.Name?.trim() || fallback_name,
    archive: new Blob([archive_data], { type: "application/zip" }),
    supportsOsu: supports_osu,
    maniaColumnCounts: mania_column_counts,
  };
}

export function localNoteSkinOptions(skin: StoredLocalNoteSkin, url: string,
  session_only = false): readonly NoteSkinOption[] {
  return [
    ...(skin.supportsOsu ? [{
      id: skin.id, name: skin.name, mode: "osu", columnCount: null, url, local: true, sessionOnly: session_only,
    }] : []),
    ...skin.maniaColumnCounts.map((columnCount) => ({
      id: skin.id, name: skin.name, mode: "mania", columnCount, url, local: true, sessionOnly: session_only,
    })),
  ];
}
