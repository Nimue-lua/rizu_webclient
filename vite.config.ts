import path from "node:path";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const git_hash = execFileSync("git", ["rev-parse", "--short", "HEAD"], {
  cwd: import.meta.dirname,
  encoding: "utf8",
}).trim();

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
      name: "public-assets",
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
