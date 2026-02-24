/**
 * E2E tests for Sprint 5 — Thumbnail progress display & resume on re-open.
 *
 * Covers:
 *   - Determinate progress bar showing thumbnails_done / thumbnails_total
 *   - Spinner (indeterminate) when thumbnails_total is 0
 *   - Auto-resume: opening a project with null thumbnail_path stacks calls resume_thumbnails
 *
 * WHY THESE TESTS EXIST:
 *   - BUG: Progress bar showed "100% complete" pulsing bar instead of actual progress.
 *     Sprint 5 added thumbnails_total/thumbnails_done counters.
 *   - BUG: Re-opening app after interrupted thumbnail gen showed blank cards.
 *     Sprint 5 added auto-resume_thumbnails when stacks have null thumbnail_path.
 */

import { test, expect } from '@playwright/test'
import {
  injectTauriMock, createProject,
  FOLDER_ICELAND as FOLDER_A, IDLE_STATUS,
  THUMBS_RUNNING_STATUS, THUMBS_DONE_STATUS as THUMBS_DONE,
} from './helpers/tauri-mock'

// ── Fixtures ─────────────────────────────────────────────────────────────────

const STACK_NO_THUMB = {
  stack_id: 1, logical_photo_count: 6,
  earliest_capture: '2024-03-15T10:00:00Z',
  has_raw: true, has_jpeg: true, thumbnail_path: null,
}
const STACK_WITH_THUMB = {
  ...STACK_NO_THUMB,
  thumbnail_path: '/cache/1.jpg',
}

const THUMBS_RUNNING_WITH_PROGRESS = {
  ...THUMBS_RUNNING_STATUS,
  thumbnails_done: 4,
}

const THUMBS_RUNNING_NO_TOTAL = {
  ...THUMBS_RUNNING_STATUS,
  thumbnails_total: 0,
}

// ── Tests ────────────────────────────────────────────────────────────────────

test('Sprint 5-J1: determinate progress bar shows thumbnails_done / thumbnails_total', async ({ page }) => {
  await injectTauriMock(page, {
    initialFolders: [FOLDER_A],
    initialStacks: [STACK_NO_THUMB],
    initialStatus: THUMBS_RUNNING_WITH_PROGRESS,
    statusSequence: [THUMBS_RUNNING_WITH_PROGRESS, THUMBS_DONE],
  })
  await page.goto('/')
  await createProject(page, 'Progress Bar Test')

  // Verify determinate progress text is visible
  await expect(page.getByText('Generating thumbnails')).toBeVisible({ timeout: 5_000 })
  await expect(page.getByText(/4.*\/.*10.*thumbnails/)).toBeVisible({ timeout: 5_000 })
  await expect(page.getByText('40%')).toBeVisible()

  // The progress bar container should have a child with a width style
  const progressBar = page.locator('.bg-blue-500.h-2.rounded-full')
  await expect(progressBar.first()).toBeVisible()
})

test('Sprint 5-J2: spinner shown when thumbnails_total is 0 (pre-total window)', async ({ page }) => {
  await injectTauriMock(page, {
    initialFolders: [FOLDER_A],
    initialStacks: [STACK_NO_THUMB],
    initialStatus: THUMBS_RUNNING_NO_TOTAL,
    statusSequence: [THUMBS_RUNNING_WITH_PROGRESS, THUMBS_DONE],
    statusHoldMs: 1500,
  })
  await page.goto('/')
  await createProject(page, 'Spinner Test')

  await expect(page.getByText('Generating thumbnails')).toBeVisible({ timeout: 5_000 })

  // Spinner (animate-spin) should be visible, not a progress bar
  await expect(page.locator('.animate-spin').first()).toBeVisible()
})

test('Sprint 5-J3: auto-resume calls resume_thumbnails when stacks have null thumbnail_path', async ({ page }) => {
  await injectTauriMock(page, {
    initialFolders: [FOLDER_A],
    initialStacks: [STACK_NO_THUMB],
    initialStatus: IDLE_STATUS,
    statusSequence: [IDLE_STATUS],
    stacksAfterResume: [STACK_WITH_THUMB],
  })
  await page.goto('/')
  await createProject(page, 'Auto Resume Test')

  // Wait for the component to call resume_thumbnails
  await page.waitForFunction(
    () => (window as unknown as Record<string, boolean>).__resumeThumbnailsCalled === true,
    { timeout: 5_000 },
  )
})

test('Sprint 5-J4: no auto-resume when all stacks already have thumbnails', async ({ page }) => {
  await injectTauriMock(page, {
    initialFolders: [FOLDER_A],
    initialStacks: [STACK_WITH_THUMB],
    initialStatus: THUMBS_DONE,
  })
  await page.goto('/')
  await createProject(page, 'No Resume Test')

  await expect(page.getByText('Index complete.')).toBeVisible({ timeout: 5_000 })

  // Deterministic check: verify resume_thumbnails is NOT in the IPC log.
  // By the time 'Index complete.' is visible, loadAll() has finished — any
  // resume_thumbnails call would already have been recorded.
  const ipcLog = await page.evaluate(() => (window as any).__store.ipcLog as string[])
  expect(ipcLog).not.toContain('resume_thumbnails')
})
