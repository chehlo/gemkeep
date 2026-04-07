// src/test/browser-setup.ts
// Browser-mode test setup for vitest-browser-svelte (Playwright/Chromium).
// Unlike jsdom setup.ts, this runs in a real browser context.
// Tauri IPC APIs still need mocking since there is no Tauri runtime.

import { vi } from "vitest";
import { page } from "@vitest/browser/context";
import { createCoreMock, createDialogMock, createEventMock } from "./mock-factories";

// Set viewport to a realistic desktop size. The default vitest-browser
// iframe is ~333px wide — unrealistically narrow for a Tauri desktop app.
// Visual indicator tests (pixel-verifier) depend on borders having enough
// room relative to the sampling margin. 1280×800 matches a common desktop.
await page.viewport(1280, 800);

// Import Tailwind CSS so that utility classes (bg-green-500, border-blue-500, opacity-50,
// grid-cols-4, etc.) are compiled and applied in the real browser environment.
// Without this, all getComputedStyle() assertions would see default/zero values.
import "../app.css";

// Mock @tauri-apps/api/core — Rule 9: default must throw on unmocked commands.
vi.mock("@tauri-apps/api/core", () => createCoreMock());

// Mock @tauri-apps/plugin-dialog
vi.mock("@tauri-apps/plugin-dialog", () => createDialogMock());

// Mock @tauri-apps/api/event
vi.mock("@tauri-apps/api/event", () => createEventMock());
