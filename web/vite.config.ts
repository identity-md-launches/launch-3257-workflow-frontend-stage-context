import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Relative base so the export works from an IPFS gateway subpath or an ENS name without rewrites.
export default defineConfig({
  base: "./",
  plugins: [react()],
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 2000,
  },
});
