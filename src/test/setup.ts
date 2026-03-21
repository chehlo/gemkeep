/// <reference types="vitest/globals" />
// src/test/setup.ts
// Global test setup: extend matchers and mock Tauri IPC
import "@testing-library/jest-dom";
import { createCoreMock, createDialogMock, createEventMock } from "./mock-factories";

// Mock @tauri-apps/api/core — Rule 9: default must throw on unmocked commands.
// Every test must explicitly mock every invoke() call the component makes.
// Silent undefined from exhausted mock queues caused real bugs to escape.
vi.mock("@tauri-apps/api/core", () => createCoreMock());

// Mock @tauri-apps/plugin-dialog so open() can be controlled in tests
vi.mock("@tauri-apps/plugin-dialog", () => createDialogMock());

// Mock @tauri-apps/api/event so listen/emit don't require a real Tauri runtime.
// listen() returns a Promise<UnlistenFn> — default resolves with a no-op unlisten.
vi.mock("@tauri-apps/api/event", () => createEventMock());

// jsdom doesn't implement scrollIntoView — silence the unhandled rejection
Element.prototype.scrollIntoView = vi.fn();
