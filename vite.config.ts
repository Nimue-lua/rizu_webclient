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
    // XP.css is already minified and contains a legacy selector rejected by Lightning CSS.
    cssMinify: "esbuild",
  },
  server: {
    proxy: {
      "/api": {
        target: process.env.RIZU_API_URL ?? "http://127.0.0.1:8765",
        changeOrigin: true,
      },
    },
  },
  plugins: [
    react(),
    {
      name: "public-assets",
      buildStart() {
        for (const fileName of ["rizu-logo.svg", "skins/osu-default.osk", "skins/pivnoi_skoof.osk",
          "dmca_incoming/music_folder.png", "dmca_incoming/people.avif", "dmca_incoming/display.avif",
          "dmca_incoming/game_controller.avif", "dmca_incoming/system_properties.avif"]) {
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
