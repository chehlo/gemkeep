// src/test/browser-setup.ts
// Browser-mode test setup for vitest-browser-svelte (Playwright/Chromium).
// Unlike jsdom setup.ts, this runs in a real browser context.
// Tauri IPC APIs still need mocking since there is no Tauri runtime.

import { vi } from "vitest";

// Import Tailwind CSS so that utility classes (bg-green-500, border-blue-500, opacity-50,
// grid-cols-4, etc.) are compiled and applied in the real browser environment.
// Without this, all getComputedStyle() assertions would see default/zero values.
import "../app.css";

// Mock @tauri-apps/api/core — Rule 9: default must throw on unmocked commands.
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn((cmd: string) => {
    throw new Error(
      `Unmocked invoke("${cmd}"). ` +
      `Add mockInvoke.mockResolvedValueOnce(...) before this call.`
    );
  }),
  convertFileSrc: vi.fn((path: string) => `asset://localhost${path}`),
}));

// Mock @tauri-apps/plugin-dialog
vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
}));

// Mock @tauri-apps/api/event
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
  emit: vi.fn(),
  once: vi.fn(),
}));
