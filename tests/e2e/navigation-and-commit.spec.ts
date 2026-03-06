/**
 * E2E tests for 4-screen navigation round-trip and post-commit decision blocking.
 *
 * Covers:
 *   - E2E-4SCREEN: Full navigation round-trip through all 4 screens
 *     (ProjectList -> StackOverview -> StackFocus -> SingleView)
 *     then Escape back through each, asserting correct screen at every step.
 *
 *   - E2E-POST-COMMIT: After Ctrl+Enter commit, Y/X keys must be blocked.
 *     Decisions become read-only after commit. Verifies no additional
 *     make_decision IPC calls are made after commit_round.
 *
 * WHY THESE TESTS EXIST:
 *   - The 4-screen round-trip is the fundamental navigation contract.
 *     Each Enter drills deeper, each Escape returns exactly one level.
 *     A regression in the navigation state machine (navigation.svelte.ts)
 *     could strand users on the wrong screen.
 *
 *   - Post-commit blocking is a data integrity invariant. Once a round is
 *     committed, decisions are sealed. If Y/X still mutate decisions after
 *     commit, the round history becomes inconsistent.
 */

import { test, expect } from '@playwright/test'
import {
  injectTauriMock, createProject,
  FOLDER_ICELAND as FOLDER_A, DONE_STATUS,
  makePhotos, makePhotoDetail, makeRoundStatus,
} from './helpers/tauri-mock'

// ── Shared fixtures ─────────────────────────────────────────────────────────

const STACK = {
  stack_id: 1,
  logical_photo_count: 3,
  earliest_capture: '2024-03-15T10:00:00Z',
  has_raw: true,
  has_jpeg: true,
  thumbnail_path: '/cache/1.jpg',
}

const PHOTOS = makePhotos(3, 1) // IDs: 101, 102, 103

const PHOTO_DETAILS: Record<number, unknown> = {
  101: makePhotoDetail(101),
  102: makePhotoDetail(102),
  103: makePhotoDetail(103),
}

// ── E2E-4SCREEN: Full 4-screen navigation round-trip ────────────────────────

test('E2E-4SCREEN: Navigate forward through all 4 screens, then Escape back through each', async ({ page }) => {
  await injectTauriMock(page, {
    initialFolders: [FOLDER_A],
    initialStacks: [STACK],
    initialStatus: DONE_STATUS,
    initialPhotos: PHOTOS,
    initialPhotoDetails: PHOTO_DETAILS,
    initialRoundStatus: makeRoundStatus(3),
  })
  await page.goto('/')

  // ── Screen 1: ProjectList ──
  await expect(page.getByRole('heading', { name: 'GemKeep' })).toBeVisible({ timeout: 5_000 })

  // Navigate forward: ProjectList -> StackOverview (create project)
  await createProject(page, 'Nav Round Trip')

  // ── Screen 2: StackOverview ──
  await expect(page.locator('header').getByText('Nav Round Trip')).toBeVisible({ timeout: 5_000 })
  await expect(page.getByText('Index complete.')).toBeVisible({ timeout: 5_000 })
  await expect(page.locator('[data-stack-card]')).toHaveCount(1, { timeout: 5_000 })

  // Navigate forward: StackOverview -> StackFocus (Enter on stack card)
  await page.keyboard.press('Enter')

  // ── Screen 3: StackFocus ──
  await expect(page.getByText('Stack #1')).toBeVisible({ timeout: 5_000 })
  await expect(page.locator('[data-testid="photo-card"]')).toHaveCount(3, { timeout: 5_000 })

  // Navigate forward: StackFocus -> SingleView (Enter on photo)
  await page.keyboard.press('Enter')

  // ── Screen 4: SingleView ──
  await expect(page.getByText(/Photo \d+\/\d+/)).toBeVisible({ timeout: 5_000 })

  // ── Now Escape back through all screens ──

  // Escape: SingleView -> StackFocus
  await page.keyboard.press('Escape')
  await expect(page.getByText('Stack #1')).toBeVisible({ timeout: 5_000 })
  await expect(page.locator('[data-testid="photo-card"]')).toHaveCount(3, { timeout: 5_000 })
  // SingleView indicator should be gone
  await expect(page.getByText(/Photo \d+\/\d+/)).not.toBeVisible({ timeout: 3_000 })

  // Escape: StackFocus -> StackOverview
  await page.keyboard.press('Escape')
  await expect(page.locator('[data-stack-card]')).toHaveCount(1, { timeout: 5_000 })
  await expect(page.locator('header').getByText('Nav Round Trip')).toBeVisible({ timeout: 5_000 })
  // StackFocus photo cards should be gone (we are back on StackOverview which shows stack cards)
  await expect(page.locator('[data-testid="photo-card"]')).toHaveCount(0, { timeout: 3_000 })

  // Escape: StackOverview -> ProjectList
  await page.keyboard.press('Escape')
  await expect(page.getByRole('heading', { name: 'GemKeep' })).toBeVisible({ timeout: 5_000 })
  // StackOverview header should be gone
  await expect(page.locator('[data-stack-card]')).toHaveCount(0, { timeout: 3_000 })
})

// ── E2E-POST-COMMIT: Y/X blocked after Ctrl+Enter commit ───────────────────

test('E2E-POST-COMMIT: After Ctrl+Enter commit, Y and X keys no longer change decisions', async ({ page }) => {
  await injectTauriMock(page, {
    initialFolders: [FOLDER_A],
    initialStacks: [STACK],
    initialStatus: DONE_STATUS,
    initialPhotos: PHOTOS,
    initialPhotoDetails: PHOTO_DETAILS,
    initialRoundStatus: makeRoundStatus(3),
  })
  await page.goto('/')
  await createProject(page, 'Commit Block Test')

  // Wait for StackOverview
  await expect(page.getByText('Index complete.')).toBeVisible({ timeout: 5_000 })
  await expect(page.locator('[data-stack-card]')).toHaveCount(1, { timeout: 5_000 })

  // Navigate to SingleView: StackOverview -> StackFocus -> SingleView
  await page.keyboard.press('Enter') // -> StackFocus
  await expect(page.getByText('Stack #1')).toBeVisible({ timeout: 5_000 })
  await expect(page.locator('[data-testid="photo-card"]')).toHaveCount(3, { timeout: 5_000 })

  await page.keyboard.press('Enter') // -> SingleView
  await expect(page.getByText(/Photo \d+\/\d+/)).toBeVisible({ timeout: 5_000 })

  // Make a decision on photo 1: press Y (keep)
  await page.keyboard.press('y')
  await page.waitForFunction(
    () => (window as unknown as Record<string, string[]>).__ipcLog.includes('make_decision'),
    { timeout: 5_000 },
  )

  // Move to photo 2 and press X (eliminate)
  await page.keyboard.press('ArrowRight')
  await expect(page.getByText('Photo 2/3')).toBeVisible({ timeout: 5_000 })
  await page.keyboard.press('x')

  // Wait for second make_decision
  await page.waitForFunction(
    () => (window as unknown as Record<string, string[]>).__ipcLog.filter((c: string) => c === 'make_decision').length >= 2,
    { timeout: 5_000 },
  )

  // Count make_decision calls before commit
  const preCommitCount = await page.evaluate(
    () => (window as unknown as Record<string, string[]>).__ipcLog.filter((c: string) => c === 'make_decision').length
  )
  expect(preCommitCount).toBe(2)

  // Commit the round with Ctrl+Enter
  await page.keyboard.press('Control+Enter')
  await page.waitForFunction(
    () => (window as unknown as Record<string, string[]>).__ipcLog.includes('commit_round'),
    { timeout: 5_000 },
  )

  // Wait for the round status re-fetch after commit (returns state='committed')
  // The mock sets roundCommitted=true on commit_round, and get_round_status returns committed state
  await page.waitForFunction(
    () => {
      const log = (window as unknown as Record<string, string[]>).__ipcLog
      const commitIdx = log.indexOf('commit_round')
      // After commit_round, there should be a get_round_status call
      return log.slice(commitIdx + 1).includes('get_round_status')
    },
    { timeout: 5_000 },
  )

  // Small wait for the component state to update with the committed round status
  await page.waitForTimeout(200)

  // Now try pressing Y — should be BLOCKED (no new make_decision calls)
  await page.keyboard.press('y')
  // Give it a moment to ensure no async IPC is fired
  await page.waitForTimeout(300)

  const postYCount = await page.evaluate(
    () => (window as unknown as Record<string, string[]>).__ipcLog.filter((c: string) => c === 'make_decision').length
  )
  expect(postYCount).toBe(preCommitCount) // No new make_decision calls

  // Move to photo 3 and try X — should also be BLOCKED
  await page.keyboard.press('ArrowRight')
  await page.waitForTimeout(200)
  await page.keyboard.press('x')
  await page.waitForTimeout(300)

  const postXCount = await page.evaluate(
    () => (window as unknown as Record<string, string[]>).__ipcLog.filter((c: string) => c === 'make_decision').length
  )
  expect(postXCount).toBe(preCommitCount) // Still no new make_decision calls

  // Verify the "(read-only)" indicator is visible in the status bar
  await expect(page.getByText('(read-only)')).toBeVisible({ timeout: 3_000 })
})
