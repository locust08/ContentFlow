import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

export default defineConfig({
  root: path.join(rootDir, "src", "frontend"),
  plugins: [react()],
  build: {
    outDir: path.join(rootDir, "public"),
    emptyOutDir: false,
    assetsDir: "assets",
    rollupOptions: {
      output: {
        entryFileNames: "assets/contentflow-[hash].js",
        chunkFileNames: "assets/contentflow-[hash].js",
        assetFileNames: "assets/contentflow-[hash][extname]"
      }
    }
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:4173",
      "/media": "http://localhost:4173"
    }
  },
  test: {
    environment: "jsdom",
    setupFiles: [path.join(rootDir, "src", "frontend", "vitest", "setup.js")],
    include: ["**/*.vitest.{js,jsx}"]
  }
});
