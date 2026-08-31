import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";

const root = path.resolve(process.argv[2] ?? "/media/SSD/s3_test");
const port = Number(process.argv[3] ?? 4174);
const types = new Map([
  [".avif", "image/avif"],
  [".osu", "text/plain; charset=utf-8"],
  [".sqlite", "application/vnd.sqlite3"],
  [".webm", "audio/webm"],
]);

createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url ?? "/", "http://localhost").pathname);
    const filePath = path.resolve(root, `.${pathname}`);
    if (filePath !== root && !filePath.startsWith(`${root}${path.sep}`)) throw new Error("Invalid path");
    const servesGzip = pathname === "/catalog.sqlite" && request.headers["accept-encoding"]?.includes("gzip");
    const responsePath = servesGzip ? `${filePath}.gz` : filePath;
    const info = await stat(responsePath);
    if (!info.isFile()) throw new Error("Not a file");

    response.setHeader("Access-Control-Allow-Origin", "*");
    response.setHeader("Accept-Ranges", "bytes");
    response.setHeader("Content-Type", types.get(path.extname(filePath).toLowerCase()) ?? "application/octet-stream");
    if (servesGzip) response.setHeader("Content-Encoding", "gzip");
    response.setHeader("Cache-Control", pathname === "/catalog.sqlite" ? "no-cache" : "public, max-age=31536000, immutable");
    response.setHeader("Last-Modified", info.mtime.toUTCString());
    const modifiedSince = request.headers["if-modified-since"];
    if (pathname === "/catalog.sqlite" && modifiedSince && info.mtimeMs <= new Date(modifiedSince).getTime() + 999) {
      response.writeHead(304).end();
      return;
    }
    const range = request.headers.range?.match(/^bytes=(\d*)-(\d*)$/);
    if (range) {
      const start = range[1] ? Number(range[1]) : 0;
      const end = range[2] ? Math.min(Number(range[2]), info.size - 1) : info.size - 1;
      if (start > end || start >= info.size) {
        response.writeHead(416, { "Content-Range": `bytes */${info.size}` }).end();
        return;
      }
      response.writeHead(206, {
        "Content-Length": end - start + 1,
        "Content-Range": `bytes ${start}-${end}/${info.size}`,
      });
      createReadStream(responsePath, { start, end }).pipe(response);
      return;
    }
    response.setHeader("Content-Length", info.size);
    response.writeHead(200);
    createReadStream(responsePath).pipe(response);
  } catch {
    response.writeHead(404).end("Not found");
  }
}).listen(port, "localhost", () => {
  console.log(`Serving ${root} at http://localhost:${port}`);
});
