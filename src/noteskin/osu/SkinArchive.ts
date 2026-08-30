import { unzipSync } from "fflate";
import { downloadArrayBuffer, type DownloadProgressCallback } from "../../download/Download";

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

export async function fetchSkinArchive(url: string, signal?: AbortSignal,
  onProgress?: DownloadProgressCallback): Promise<SkinArchiveFiles> {
  const data = await downloadArrayBuffer(url, { signal }, onProgress);
  return unzipSkinArchive(new Uint8Array(data), `Skin ${url} is not a valid archive`);
}
