/// <reference types="vitest/globals" />
// src/test/setup.ts
// Global test setup: extend matchers and mock Tauri IPC
import "@testing-library/jest-dom";

// Mock @tauri-apps/api/core so invoke() calls return controlled values in tests
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn((cmd: string) => {
    if (cmd === 'pause_indexing') return Promise.resolve(undefined)
    if (cmd === 'resume_indexing') return Promise.resolve(undefined)
    if (cmd === 'list_logical_photos') return Promise.resolve([])
    return Promise.resolve(undefined)
  }),
  convertFileSrc: vi.fn((path: string) => `asset://localhost${path}`),
}));

// Mock @tauri-apps/plugin-dialog so open() can be controlled in tests
vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
}));

// jsdom doesn't implement scrollIntoView — silence the unhandled rejection
Element.prototype.scrollIntoView = vi.fn();
