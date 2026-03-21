// src/test/mock-factories.ts
// Shared mock factory functions for vi.mock() calls in setup.ts and browser-setup.ts.
// Used via vi.hoisted() to work with vitest's mock hoisting.

import { vi } from 'vitest'

/** Factory for @tauri-apps/api/core mock — Rule 9: throw on unmocked commands. */
export function createCoreMock() {
  return {
    invoke: vi.fn((cmd: string) => {
      throw new Error(
        `Unmocked invoke("${cmd}"). ` +
        `Add mockInvoke.mockResolvedValueOnce(...) before this call.`
      )
    }),
    convertFileSrc: vi.fn((path: string) => `asset://localhost${path}`),
  }
}

/** Factory for @tauri-apps/plugin-dialog mock. */
export function createDialogMock() {
  return {
    open: vi.fn(),
  }
}

/** Factory for @tauri-apps/api/event mock. */
export function createEventMock() {
  return {
    listen: vi.fn().mockResolvedValue(() => {}),
    emit: vi.fn(),
    once: vi.fn(),
  }
}
