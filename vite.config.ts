import path from "node:path";
import { execFileSync } from "node:child_process";
import { createReadStream, readFileSync } from "node:fs";
import { stat } from "node:fs/promises";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const public_directory = path.resolve(import.meta.dirname, "public");
const git_hash = execFileSync("git", ["rev-parse", "--short", "HEAD"], {
  cwd: import.meta.dirname,
  encoding: "utf8",
}).trim();

function chartAssetPath(url: string): string | null {
  const pathname = url.split("?", 1)[0] ?? "";
  if (!pathname.startsWith("/charts/")) return null;

  try {
    const segments = pathname.slice(1).split("/").map(decodeURIComponent);
    if (segments.some((segment) => segment === "" || segment === "." || segment === ".." || /[\\/]/.test(segment))) {
      return null;
    }
    return path.join(public_directory, ...segments);
  } catch {
    return null;
  }
}

export default defineConfig({
  define: {
    __GIT_HASH__: JSON.stringify(git_hash),
  },
  build: {
    copyPublicDir: false,
  },
  server: {
    proxy: {
      "/api": {
        target: "https://rizu.nimue.mom",
        changeOrigin: true,
      },
    },
  },
  plugins: [
    react(),
    {
      name: "chart-assets",
      configureServer(server) {
        server.middlewares.use((request, response, next) => {
          if (request.method !== "GET" && request.method !== "HEAD") return next();
          const asset_path = chartAssetPath(request.url ?? "");
          if (!asset_path) return next();

          void stat(asset_path).then((asset_stat) => {
            if (!asset_stat.isFile()) return next();
            response.statusCode = 200;
            response.setHeader("Content-Length", asset_stat.size);
            if (request.method === "HEAD") return response.end();
            createReadStream(asset_path).pipe(response);
          }).catch(() => next());
        });
      },
    },
    {
      name: "public-logo",
      buildStart() {
        for (const fileName of ["rizu-logo.svg", "skins/osu-default.osk", "skins/pivnoi_skoof.osk"]) {
          this.emitFile({
            type: "asset",
            fileName,
            source: readFileSync(path.resolve(import.meta.dirname, "public", fileName)),
          });
        }
      },
    },
  ],
});
