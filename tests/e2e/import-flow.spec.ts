/**
 * E2E tests for the Stack Overview import flow.
 * Covers STATE 1 (no folders) → STATE 2 (folders, auto-start) →
 *         STATE 3 (indexing progress) → STATE 4 (stacks grid)
 *
 * WHY THESE TESTS EXIST — bugs they would have caught:
 *
 *   Test: "STATE 1 — shows no-folders empty state without errors"
 *     → WOULD HAVE CAUGHT: component crash when E2E mock returned null for
 *       list_source_folders (default: return null in the switch statement).
 *       The crash was silent — component just rendered nothing.
 *
 *   Test: "STATE 2 — auto-start triggers when folders present but no stacks"
 *     → WOULD HAVE CAUGHT: auto-start not triggering because mock returned null,
 *       making sourceFolders.length throw TypeError in loadAll's .catch() handler.
 *
 *   Test: "thumbnail generation banner is NOT a static full-width bar"
 *     → WOULD HAVE CAUGHT: w-full animate-pulse bar visually indistinguishable
 *       from "100% complete" — user reported "progress immediately at 100%".
 *
 * NOTE: These tests run in Chromium (not WebKitWebView). Chromium has no asset://
 * protocol handler, so thumbnail image loading (Layer 8) is tested manually.
 * See docs/manual-tests.md MT-01 for the manual asset protocol test procedure.
 */

import { test, expect } from '@playwright/test'
import {
  injectTauriMock, createProject,
  FOLDER_ICELAND as FOLDER_A, IDLE_STATUS, RUNNING_STATUS, DONE_STATUS,
} from './helpers/tauri-mock'

// ── Test fixtures ─────────────────────────────────────────────────────────────

const THUMBNAIL_RUNNING_STATUS = {
  ...DONE_STATUS,
  thumbnails_running: true,
  last_stats: null,
  thumbnails_total: 0,
  thumbnails_done: 0,
}

const STACK_1 = {
  stack_id: 1, logical_photo_count: 6,
  earliest_capture: '2024-03-15T10:00:00Z',
  has_raw: true, has_jpeg: true, thumbnail_path: null,
}
const STACK_2 = {
  stack_id: 2, logical_photo_count: 4,
  earliest_capture: '2024-03-15T11:00:00Z',
  has_raw: false, has_jpeg: true, thumbnail_path: null,
}
const STACK_3 = {
  stack_id: 3, logical_photo_count: 1,
  earliest_capture: null,
  has_raw: true, has_jpeg: false, thumbnail_path: null,
}

// ── Journey 1: STATE 1 ────────────────────────────────────────────────────────

test('Journey 1: STATE 1 — shows no-folders empty state without errors', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', e => errors.push(e.message))

  await injectTauriMock(page, {
    initialFolders: [],
    initialStacks: [],
    initialStatus: IDLE_STATUS,
  })
  await page.goto('/')
  await createProject(page, 'Empty Project')

  await expect(page.getByText('No source folders attached.')).toBeVisible({ timeout: 5_000 })
  await expect(page.getByText('+ Add Folder')).toBeVisible()

  // No progress bar in STATE 1
  await expect(page.locator('.animate-pulse').or(page.locator('.animate-spin'))).not.toBeVisible()

  // No runtime errors
  const relevant = errors.filter(e => !e.includes('ResizeObserver'))
  expect(relevant).toHaveLength(0)
})

// ── Journey 2: STATE 2 / auto-start ──────────────────────────────────────────

test('Journey 2: STATE 2 — auto-start triggers when folders present but no stacks', async ({ page }) => {
  await injectTauriMock(page, {
    initialFolders: [FOLDER_A],
    initialStacks: [],
    initialStatus: IDLE_STATUS,
    statusSequence: [IDLE_STATUS],
  })
  await page.goto('/')
  await createProject(page, 'Auto Start Test')

  // Verify start_indexing was called automatically within a reasonable timeout
  await page.waitForFunction(
    () => (window as unknown as Record<string, number>).__startIndexingCallCount > 0,
    { timeout: 5_000 },
  )
})

// ── Journey 3: STATE 3 / progress during indexing ────────────────────────────

test('Journey 3: STATE 3 — progress visible during indexing (or STATE 4 if fast)', async ({ page }) => {
  await injectTauriMock(page, {
    initialFolders: [FOLDER_A],
    initialStacks: [],
    initialStatus: IDLE_STATUS,
    statusSequence: [RUNNING_STATUS, DONE_STATUS],
  })
  await page.goto('/')
  await createProject(page, 'Progress Test')

  // Either we catch STATE 3 (Indexing…) or it jumped straight to STATE 4 (Index complete.)
  // Both are valid — we just verify no crash and sensible rendering
  await expect(
    page.getByText('Indexing…').or(page.getByText('Index complete.')),
  ).toBeVisible({ timeout: 5_000 })
})

// ── Journey 4: STATE 4 / stack grid ──────────────────────────────────────────

test('Journey 4: STATE 4 — stack grid visible after indexing completes', async ({ page }) => {
  await injectTauriMock(page, {
    initialFolders: [FOLDER_A],
    initialStacks: [STACK_1, STACK_2, STACK_3],
    initialStatus: DONE_STATUS,
    // Stacks have null thumbnails → resume_thumbnails → poll needs sequence to stop
    statusSequence: [DONE_STATUS],
  })
  await page.goto('/')
  await createProject(page, 'Stack Grid Test')

  await expect(page.getByText('Index complete.')).toBeVisible({ timeout: 5_000 })
  await expect(page.getByText('Stack #1')).toBeVisible()
  await expect(page.getByText('Stack #2')).toBeVisible()
  await expect(page.getByText('Stack #3')).toBeVisible()
  await expect(page.getByText('Re-index')).toBeVisible()
})

// ── Journey 5: thumbnail banner visual correctness ───────────────────────────

test('Journey 5: thumbnail generation banner is NOT a static full-width bar', async ({ page }) => {
  await injectTauriMock(page, {
    initialFolders: [FOLDER_A],
    initialStacks: [STACK_1, STACK_2],
    initialStatus: THUMBNAIL_RUNNING_STATUS,
    // Poll must eventually stop — transition to DONE
    statusSequence: [THUMBNAIL_RUNNING_STATUS, DONE_STATUS],
  })
  await page.goto('/')
  await createProject(page, 'Thumbnail Progress Test')

  await expect(page.getByText('Generating thumbnails')).toBeVisible({ timeout: 5_000 })

  const pulsingBar = page.locator('.animate-pulse').first()
  const spinningEl = page.locator('.animate-spin').first()

  const hasPulse = await pulsingBar.isVisible().catch(() => false)
  const hasSpin = await spinningEl.isVisible().catch(() => false)
  expect(hasPulse || hasSpin).toBe(true)

  if (hasPulse) {
    const classes = await pulsingBar.getAttribute('class')
    expect(classes).not.toContain('w-full')
  }
})
