import { unzipSync } from "fflate";

export type SkinArchiveFiles = Readonly<Record<string, Uint8Array>>;

export function unzipSkinArchive(bytes: Uint8Array, invalid_message: string): SkinArchiveFiles {
  try {
    return unzipSync(bytes);
  } catch {
    throw new Error(invalid_message);
  }
}

export function findSkinIni(files: SkinArchiveFiles): string | undefined {
  return Object.keys(files).find((path) => /(^|\/)skin\.ini$/i.test(path.replace(/\\/g, "/")));
}

export async function fetchSkinArchive(url: string, signal?: AbortSignal): Promise<SkinArchiveFiles> {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`Failed to fetch skin ${url}: ${response.status} ${response.statusText}`);
  return unzipSkinArchive(new Uint8Array(await response.arrayBuffer()), `Skin ${url} is not a valid archive`);
}
