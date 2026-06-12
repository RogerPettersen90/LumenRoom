import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

// Tauri expects a fixed dev port and ignores Vite's HMR websocket noise.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  resolve: {
    // Mirror the "@/*" -> "src/*" alias declared in tsconfig.json.
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      // Don't let Vite watch the Rust backend.
      ignored: ["**/src-tauri/**"],
    },
  },
  // Produce a build the Tauri webview can load from the bundled dist/.
  build: {
    target: "esnext",
    minify: "esbuild",
    sourcemap: false,
  },
});
