import { defineConfig } from "vite";

export default defineConfig({
  root: "src",
  base: "./",
  server: {
    // Dedicated port so another local Vite project cannot hijack ETerminal dev.
    port: 5273,
    strictPort: true,
  },
  build: {
    outDir: "../dist/renderer",
    emptyOutDir: true,
    target: "chrome130",
    assetsInlineLimit: 4096,
  },
});
