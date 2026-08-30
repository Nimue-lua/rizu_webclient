export interface DownloadProgress {
  readonly loaded_bytes: number;
  readonly total_bytes: number | null;
}

export type DownloadProgressCallback = (progress: DownloadProgress) => void;

export async function downloadArrayBuffer(
  url: string,
  init: RequestInit = {},
  onProgress?: DownloadProgressCallback,
): Promise<ArrayBuffer> {
  const response = await fetch(url, init);
  if (!response.ok) throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);

  const content_length_header = response.headers.get("content-length");
  const content_length = content_length_header === null ? NaN : Number(content_length_header);
  const total_bytes = Number.isFinite(content_length) && content_length >= 0 ? content_length : null;
  const reader = response.body?.getReader();
  if (!reader) {
    const data = await response.arrayBuffer();
    onProgress?.({ loaded_bytes: data.byteLength, total_bytes: total_bytes ?? data.byteLength });
    return data;
  }

  const chunks: Uint8Array[] = [];
  let loaded_bytes = 0;
  onProgress?.({ loaded_bytes, total_bytes });
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded_bytes += value.byteLength;
    onProgress?.({ loaded_bytes, total_bytes });
  }

  const data = new Uint8Array(loaded_bytes);
  let offset = 0;
  for (const chunk of chunks) {
    data.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return data.buffer;
}
