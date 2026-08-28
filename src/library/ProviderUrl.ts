export const DEFAULT_REMOTE_PROVIDER = {
  id: "builtin",
  name: "charts.kuudere.fun",
  catalog_url: "https://charts.kuudere.fun/catalog.sqlite",
} as const;

export function catalogUrl(value: string): string {
  const trimmed = value.trim();
  const url = new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`);
  if (url.protocol !== "https:" && url.hostname !== "localhost") throw new Error("Remote providers must use HTTPS");
  if (!url.pathname.endsWith(".sqlite")) url.pathname = `${url.pathname.replace(/\/$/, "")}/catalog.sqlite`;
  url.hash = "";
  return url.href;
}

export function remoteAssetUrl(catalog_url: string, asset_path: unknown): string | null {
  if (typeof asset_path !== "string") return null;
  const encoded_path = asset_path.replace(/^\/+/, "").split("/").map(encodeURIComponent).join("/");
  return new URL(encoded_path, catalog_url).href;
}
