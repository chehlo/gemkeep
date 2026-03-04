import { defineConfig } from "vitest/config";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import path from "path";

const host = process.env.TAURI_DEV_HOST;

export default defineConfig(() => ({
  plugins: [svelte()],

  resolve: {
    alias: {
      $lib: path.resolve(__dirname, "./src/lib"),
      $test: path.resolve(__dirname, "./src/test"),
    },
  },

  // Vitest config — two projects: jsdom (existing) + browser (new)
  test: {
    projects: [
      // Project 1: existing jsdom-based component/unit tests
      {
        extends: true,
        test: {
          name: "jsdom",
          environment: "jsdom",
          globals: true,
          setupFiles: ["./src/test/setup.ts"],
          include: ["src/**/*.test.ts"],
          // Exclude browser tests from jsdom project
          exclude: ["src/**/*.browser.test.ts", "node_modules/**"],
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
      },
      // Project 2: browser-mode visual tests (vitest-browser-svelte + Playwright)
      {
        extends: true,
        optimizeDeps: {
          // Pre-bundle Tauri API mocks to avoid mid-test Vite reloads
          include: [
            "@tauri-apps/api/core",
            "@tauri-apps/plugin-dialog",
            "@tauri-apps/api/event",
          ],
        },
        test: {
          name: "browser",
          include: ["src/**/*.browser.test.ts"],
          setupFiles: ["./src/test/browser-setup.ts"],
          browser: {
            enabled: true,
            provider: "playwright",
            headless: true,
            instances: [{ browser: "chromium" }],
          },
        },
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
