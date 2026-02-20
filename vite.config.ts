import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import path from "path";

const host = process.env.TAURI_DEV_HOST;

export default defineConfig(async () => ({
  plugins: [svelte()],

  resolve: {
    alias: {
      $lib: path.resolve(__dirname, "./src/lib"),
    },
  },

  // Vitest config
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.ts"],
    alias: [
      // Force Svelte to use the browser (client) build in test — without this,
      // jsdom resolves the server build and `mount()` throws lifecycle_function_unavailable
      {
        find: /^svelte$/,
        replacement: path.resolve(
          __dirname,
          "node_modules/svelte/src/index-client.js"
        ),
      },
    ],
  },

  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: 1421 } : undefined,
    watch: { ignored: ["**/src-tauri/**"] },
  },
}));
