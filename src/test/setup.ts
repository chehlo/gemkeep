/// <reference types="vitest/globals" />
// src/test/setup.ts
// Global test setup: extend matchers and mock Tauri IPC
import "@testing-library/jest-dom";

// Mock @tauri-apps/api/core so invoke() calls return controlled values in tests
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  convertFileSrc: vi.fn((path: string) => `asset://${path}`),
}));

// Mock @tauri-apps/plugin-dialog so open() can be controlled in tests
vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
}));
