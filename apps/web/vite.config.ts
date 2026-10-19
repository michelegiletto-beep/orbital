import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  plugins: [react()],
  build: {
    outDir: "../../dist/web",
    emptyOutDir: true,
    sourcemap: false,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: "renderer",
              test: /node_modules[\\/]three/,
              maxSize: 300000,
            },
            {
              name: "react",
              test: /node_modules[\\/](react|react-dom|scheduler)/,
            },
          ],
        },
      },
    },
  },
  server: {
    port: 4317,
    strictPort: true,
    fs: { allow: ["../.."] },
    proxy: {
      "/v1": "http://127.0.0.1:4318",
      "/health": "http://127.0.0.1:4318",
    },
  },
});
