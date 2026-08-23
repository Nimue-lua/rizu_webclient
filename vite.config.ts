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
        this.emitFile({
          type: "asset",
          fileName: "rizu-logo.svg",
          source: readFileSync(path.resolve(import.meta.dirname, "public/rizu-logo.svg")),
        });
      },
    },
  ],
});
