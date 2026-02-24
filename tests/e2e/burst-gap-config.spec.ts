/**
 * E2E tests for Sprint 6 — Burst gap configuration UI.
 *
 * Covers:
 *   - Ctrl+B opens the burst gap panel
 *   - Save triggers set_burst_gap → restack → stacks reload → resume_thumbnails
 *   - Cancel closes panel without side effects
 *   - Panel shows current burst gap value from get_burst_gap
 *
 * WHY THESE TESTS EXIST:
 *   - Sprint 6 added Ctrl+B to reconfigure burst threshold and re-stack photos.
 *   - After restack, thumbnails are cleared (stacks rebuilt). The UI must trigger
 *     resume_thumbnails to regenerate them in the same session.
 *   - Without E2E coverage, the full flow (keyboard shortcut → panel → save →
 *     IPC sequence → stacks reload) was only tested in jsdom component tests.
 */

import { test, expect } from '@playwright/test'
import { injectTauriMock, createProject } from './helpers/tauri-mock'

// ── Fixtures ─────────────────────────────────────────────────────────────────

const FOLDER_A = { id: 1, path: '/home/user/Photos/Iceland' }

const STACK_1 = {
  stack_id: 1, logical_photo_count: 6,
  earliest_capture: '2024-03-15T10:00:00Z',
  has_raw: true, has_jpeg: true,
  thumbnail_path: '/cache/1.jpg',
}
const STACK_2 = {
  stack_id: 2, logical_photo_count: 4,
  earliest_capture: '2024-03-15T11:00:00Z',
  has_raw: false, has_jpeg: true,
  thumbnail_path: '/cache/2.jpg',
}

// After restack with a larger gap, 2 stacks merge into 1
const RESTACKED_SINGLE = {
  stack_id: 10, logical_photo_count: 10,
  earliest_capture: '2024-03-15T10:00:00Z',
  has_raw: true, has_jpeg: true,
  thumbnail_path: null, // thumbnails cleared by restack
}

const DONE_STATUS = {
  running: false, thumbnails_running: false, total: 50, processed: 50,
  errors: 0, cancelled: false, paused: false,
  last_stats: {
    total_files_scanned: 50, imported: 50, skipped_existing: 0,
    skipped_unsupported: 0, errors: 0, pairs_detected: 25,
    stacks_generated: 2, logical_photos: 10, error_log: [],
  },
  thumbnails_total: 10, thumbnails_done: 10,
}

const IDLE_STATUS = {
  running: false, thumbnails_running: false, total: 0, processed: 0,
  errors: 0, cancelled: false, paused: false, last_stats: null,
  thumbnails_total: 0, thumbnails_done: 0,
}

// ── Tests ────────────────────────────────────────────────────────────────────

test('Sprint 6-J1: Ctrl+B opens burst gap panel with current value', async ({ page }) => {
  await injectTauriMock(page, {
    initialFolders: [FOLDER_A],
    initialStacks: [STACK_1, STACK_2],
    initialStatus: DONE_STATUS,
    burstGap: 5,
  })
  await page.goto('/')
  await createProject(page, 'Burst Panel Test')

  await expect(page.getByText('Index complete.')).toBeVisible({ timeout: 5_000 })

  // Press Ctrl+B to open burst gap panel
  await page.keyboard.press('Control+b')

  // Panel should appear with "Burst gap" heading
  await expect(page.getByText('Burst gap')).toBeVisible({ timeout: 3_000 })

  // Input should show current value (5)
  const input = page.locator('input[type="number"]')
  await expect(input).toBeVisible()
  await expect(input).toHaveValue('5')
})

test('Sprint 6-J2: Save triggers restack and updates stack grid', async ({ page }) => {
  await injectTauriMock(page, {
    initialFolders: [FOLDER_A],
    initialStacks: [STACK_1, STACK_2],
    initialStatus: DONE_STATUS,
    burstGap: 3,
    stacksAfterRestack: [RESTACKED_SINGLE],
    statusSequence: [IDLE_STATUS],
  })
  await page.goto('/')
  await createProject(page, 'Restack Test')

  await expect(page.getByText('Stack #1')).toBeVisible({ timeout: 5_000 })
  await expect(page.getByText('Stack #2')).toBeVisible()

  // Open panel, change value, save
  await page.keyboard.press('Control+b')
  await expect(page.getByText('Burst gap')).toBeVisible({ timeout: 3_000 })

  const input = page.locator('input[type="number"]')
  await input.fill('30')
  await page.click('button:has-text("Save")')

  // Panel should close
  await expect(page.getByText('Burst gap')).not.toBeVisible({ timeout: 5_000 })

  // Stack grid should update: 2 stacks → 1 (merged by larger gap)
  await expect(page.locator('[data-stack-card]')).toHaveCount(1, { timeout: 5_000 })
  await expect(page.getByText('10 photos')).toBeVisible()

  // Verify the full IPC sequence: set_burst_gap → restack → list_stacks → resume_thumbnails
  const log = await page.evaluate(() => (window as unknown as Record<string, string[]>).__ipcLog)
  const restackIdx = log.indexOf('restack')
  expect(restackIdx).toBeGreaterThan(-1)
  expect(log.indexOf('set_burst_gap')).toBeLessThan(restackIdx)

  // resume_thumbnails must be called (restacked stacks have null thumbnails)
  await page.waitForFunction(
    () => (window as unknown as Record<string, boolean>).__resumeThumbnailsCalled === true,
    { timeout: 3_000 },
  )
})

test('Sprint 6-J3: Cancel closes panel without calling restack', async ({ page }) => {
  await injectTauriMock(page, {
    initialFolders: [FOLDER_A],
    initialStacks: [STACK_1, STACK_2],
    initialStatus: DONE_STATUS,
    burstGap: 3,
  })
  await page.goto('/')
  await createProject(page, 'Cancel Test')

  await expect(page.getByText('Index complete.')).toBeVisible({ timeout: 5_000 })

  // Open panel and cancel
  await page.keyboard.press('Control+b')
  await expect(page.getByText('Burst gap')).toBeVisible({ timeout: 3_000 })
  await page.click('button:has-text("Cancel")')

  // Panel should close
  await expect(page.getByText('Burst gap')).not.toBeVisible({ timeout: 3_000 })

  // Stacks unchanged — still 2
  await expect(page.locator('[data-stack-card]')).toHaveCount(2)

  // restack must NOT have been called
  const log = await page.evaluate(() => (window as unknown as Record<string, string[]>).__ipcLog)
  expect(log).not.toContain('restack')
  expect(log).not.toContain('set_burst_gap')
})

test('Sprint 6-J4: Ctrl+B works even when get_burst_gap fails (uses default)', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', e => errors.push(e.message))

  await injectTauriMock(page, {
    initialFolders: [FOLDER_A],
    initialStacks: [STACK_1, STACK_2],
    initialStatus: DONE_STATUS,
    burstGap: 3,
  })

  // Override get_burst_gap to throw after the initial mock setup
  await page.addInitScript(() => {
    const orig = (window as any).__TAURI_INTERNALS__.invoke
    ;(window as any).__TAURI_INTERNALS__.invoke = async (cmd: string, args: Record<string, unknown>) => {
      if (cmd === 'get_burst_gap') throw new Error('command not found')
      return orig(cmd, args)
    }
  })

  await page.goto('/')
  await createProject(page, 'Fallback Test')

  await expect(page.getByText('Index complete.')).toBeVisible({ timeout: 5_000 })

  await page.keyboard.press('Control+b')
  await expect(page.getByText('Burst gap')).toBeVisible({ timeout: 3_000 })

  // Should show default value 3 (fallback)
  const input = page.locator('input[type="number"]')
  await expect(input).toHaveValue('3')

  // No unhandled page errors (the error is caught in openBurstPanel)
  const relevant = errors.filter(e => !e.includes('ResizeObserver'))
  expect(relevant).toHaveLength(0)
})
