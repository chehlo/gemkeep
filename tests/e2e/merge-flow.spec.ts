/**
 * E2E tests for Sprint 7 — Stack merge flow.
 *
 * Covers:
 *   - Multi-select stacks with Shift+Arrow, press M to merge
 *   - Undo merge with Ctrl+Z restores original stacks
 *
 * WHY THESE TESTS EXIST:
 *   - Sprint 7 added manual stack merging: users select 2+ stacks in StackOverview
 *     via Shift+Arrow and press M. The merge must call mergeStacks IPC with the
 *     correct stack IDs and refresh the grid.
 *   - Ctrl+Z calls undoLastMerge and restores the original stacks. Without E2E
 *     coverage, the full keyboard flow (selection + merge + undo) was only tested
 *     in component tests.
 */

import { test, expect } from '@playwright/test'
import {
  injectTauriMock, createProject,
  FOLDER_ICELAND as FOLDER_A, DONE_STATUS, makeStacks,
} from './helpers/tauri-mock'

// ── Fixtures ─────────────────────────────────────────────────────────────────

const STACKS_4 = makeStacks(4, true)

// After merge of stacks 1+2: 3 stacks remain (merged + original 3 + original 4)
const MERGED_STACK = {
  stack_id: 1,
  logical_photo_count: 8, // 4+4 photos merged
  earliest_capture: '2024-03-15T10:00:00Z',
  has_raw: true,
  has_jpeg: true,
  thumbnail_path: '/cache/1.jpg',
}
const STACKS_AFTER_MERGE = [
  MERGED_STACK,
  STACKS_4[2], // stack_id: 3
  STACKS_4[3], // stack_id: 4
]

// ── Journey 1: Full merge ────────────────────────────────────────────────────

test('Sprint 7-J1: Select 2 stacks with Shift+Arrow and press M to merge', async ({ page }) => {
  await injectTauriMock(page, {
    initialFolders: [FOLDER_A],
    initialStacks: STACKS_4,
    initialStatus: DONE_STATUS,
    stacksAfterMerge: STACKS_AFTER_MERGE,
  })
  await page.goto('/')
  await createProject(page, 'Merge Test')

  // Wait for stacks to be visible
  await expect(page.getByText('Index complete.')).toBeVisible({ timeout: 5_000 })
  await expect(page.locator('[data-stack-card]')).toHaveCount(4, { timeout: 5_000 })

  // Select stacks 1 and 2 with Shift+ArrowRight (focus starts at index 0 = stack 1)
  await page.keyboard.press('Shift+ArrowRight')

  // Press M to merge
  await page.keyboard.press('m')

  // Verify: merge_stacks was called with correct IDs
  await page.waitForFunction(
    () => (window as unknown as Record<string, string[]>).__ipcLog.includes('merge_stacks'),
    { timeout: 5_000 },
  )

  // Verify: stacks refreshed — now 3 stacks instead of 4
  await expect(page.locator('[data-stack-card]')).toHaveCount(3, { timeout: 5_000 })

  // Verify the merged stack shows 8 photos
  await expect(page.getByText('8 photos')).toBeVisible()
})

// ── Journey 2: Merge undo ────────────────────────────────────────────────────

test('Sprint 7-J2: Ctrl+Z undoes the last merge and restores original stacks', async ({ page }) => {
  await injectTauriMock(page, {
    initialFolders: [FOLDER_A],
    initialStacks: STACKS_4,
    initialStatus: DONE_STATUS,
    stacksAfterMerge: STACKS_AFTER_MERGE,
    stacksAfterUndo: STACKS_4,
  })
  await page.goto('/')
  await createProject(page, 'Undo Merge Test')

  await expect(page.getByText('Index complete.')).toBeVisible({ timeout: 5_000 })
  await expect(page.locator('[data-stack-card]')).toHaveCount(4, { timeout: 5_000 })

  // Merge first: Shift+Right to select stacks 1+2, then M
  await page.keyboard.press('Shift+ArrowRight')
  await page.keyboard.press('m')

  // Wait for merge to happen
  await expect(page.locator('[data-stack-card]')).toHaveCount(3, { timeout: 5_000 })

  // Now undo with Ctrl+Z
  await page.keyboard.press('Control+z')

  // Verify: undo_last_merge was called
  await page.waitForFunction(
    () => (window as unknown as Record<string, string[]>).__ipcLog.includes('undo_last_merge'),
    { timeout: 5_000 },
  )

  // Verify: original 4 stacks restored
  await expect(page.locator('[data-stack-card]')).toHaveCount(4, { timeout: 5_000 })
})
