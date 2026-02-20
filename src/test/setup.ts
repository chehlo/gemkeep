/// <reference types="vitest/globals" />
// src/test/setup.ts
// Global test setup: extend matchers and mock Tauri IPC
import "@testing-library/jest-dom";

// Mock @tauri-apps/api/core so invoke() calls return controlled values in tests
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));
