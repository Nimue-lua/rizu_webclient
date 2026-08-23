import path from "node:path";
import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  build: {
    copyPublicDir: false,
  },
  plugins: [
    react(),
    {
      name: "public-logo",
      buildStart() {
        for (const fileName of ["rizu-logo.svg", "skins/circles.zip"]) {
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
