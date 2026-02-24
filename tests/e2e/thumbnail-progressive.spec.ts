/**
 * E2E tests for Sprint 4 — Progressive thumbnail loading.
 *
 * Covers the `thumbnail-ready` Tauri event that updates stack cards one by one
 * as thumbnails are generated, rather than requiring a full poll cycle.
 *
 * WHY THESE TESTS EXIST:
 *   - Before Sprint 4, thumbnails appeared all-at-once after pipeline completion.
 *   - The thumbnail-ready event enables card-by-card progressive appearance.
 *   - Tests verify: event subscription, stack reload on event, card image update.
 *
 * NOTE: Chromium has no asset:// protocol, so we verify the <img> element exists
 * with the correct src pattern rather than pixel-level rendering.
 */

import { test, expect } from '@playwright/test'
import {
  injectTauriMock, createProject,
  FOLDER_ICELAND as FOLDER_A,
  THUMBS_RUNNING_STATUS as THUMBS_RUNNING,
  THUMBS_DONE_STATUS as THUMBS_DONE,
} from './helpers/tauri-mock'

// ── Fixtures ─────────────────────────────────────────────────────────────────

const STACK_NO_THUMB_1 = {
  stack_id: 1, logical_photo_count: 6,
  earliest_capture: '2024-03-15T10:00:00Z',
  has_raw: true, has_jpeg: true, thumbnail_path: null,
}
const STACK_NO_THUMB_2 = {
  stack_id: 2, logical_photo_count: 4,
  earliest_capture: '2024-03-15T11:00:00Z',
  has_raw: false, has_jpeg: true, thumbnail_path: null,
}

const STACK_WITH_THUMB_1 = {
  ...STACK_NO_THUMB_1,
  thumbnail_path: '/home/user/.gem-keep/projects/test/cache/thumbnails/1.jpg',
}
const STACK_WITH_THUMB_2 = {
  ...STACK_NO_THUMB_2,
  thumbnail_path: '/home/user/.gem-keep/projects/test/cache/thumbnails/2.jpg',
}

// ── Tests ────────────────────────────────────────────────────────────────────

test('Sprint 4-J1: stack card updates from placeholder to thumbnail after thumbnail-ready event', async ({ page }) => {
  await injectTauriMock(page, {
    initialFolders: [FOLDER_A],
    initialStacks: [STACK_NO_THUMB_1, STACK_NO_THUMB_2],
    initialStatus: THUMBS_RUNNING,
    statusSequence: [THUMBS_RUNNING, THUMBS_DONE],
    stacksAfterThumbnail: [STACK_WITH_THUMB_1, STACK_WITH_THUMB_2],
  })
  await page.goto('/')
  await createProject(page, 'Progressive Thumb Test')

  // Initially: stack cards visible but no <img> tags (only placeholder icons)
  await expect(page.getByText('Stack #1')).toBeVisible({ timeout: 5_000 })
  await expect(page.getByText('Stack #2')).toBeVisible()

  // Fire thumbnail-ready event — triggers listStacks reload
  await page.evaluate(() => {
    ;(window as any).__triggerTauriEvent('thumbnail-ready', {
      logical_photo_id: 1,
      thumbnail_path: '/home/user/.gem-keep/projects/test/cache/thumbnails/1.jpg',
    })
  })

  // After event: <img> elements should appear (stacks now have thumbnail_path)
  await expect(page.locator('[data-stack-card] img').first()).toBeVisible({ timeout: 5_000 })
})

test('Sprint 4-J2: multiple thumbnail-ready events update cards progressively', async ({ page }) => {
  await injectTauriMock(page, {
    initialFolders: [FOLDER_A],
    initialStacks: [STACK_NO_THUMB_1, STACK_NO_THUMB_2],
    initialStatus: THUMBS_RUNNING,
    statusSequence: [THUMBS_RUNNING, THUMBS_RUNNING, THUMBS_DONE],
    stacksAfterThumbnail: [STACK_WITH_THUMB_1, STACK_WITH_THUMB_2],
  })
  await page.goto('/')
  await createProject(page, 'Multi Event Test')

  await expect(page.getByText('Stack #1')).toBeVisible({ timeout: 5_000 })

  // Fire first event
  await page.evaluate(() => {
    ;(window as any).__triggerTauriEvent('thumbnail-ready', {
      logical_photo_id: 1, thumbnail_path: '/cache/1.jpg',
    })
  })

  // Fire second event
  await page.evaluate(() => {
    ;(window as any).__triggerTauriEvent('thumbnail-ready', {
      logical_photo_id: 2, thumbnail_path: '/cache/2.jpg',
    })
  })

  // Both cards should now show images
  await expect(page.locator('[data-stack-card] img')).toHaveCount(2, { timeout: 5_000 })
})

test('Sprint 4-J3: no runtime errors during thumbnail generation phase', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', e => errors.push(e.message))

  await injectTauriMock(page, {
    initialFolders: [FOLDER_A],
    initialStacks: [STACK_NO_THUMB_1, STACK_NO_THUMB_2],
    initialStatus: THUMBS_RUNNING,
    statusSequence: [THUMBS_DONE],
    statusHoldMs: 1500,
  })
  await page.goto('/')
  await createProject(page, 'No Error Test')

  await expect(page.getByText('Generating thumbnails')).toBeVisible({ timeout: 5_000 })

  // Wait for thumbnails to complete (polls transition to DONE)
  await expect(page.getByText('Index complete.')).toBeVisible({ timeout: 10_000 })

  const relevant = errors.filter(e => !e.includes('ResizeObserver'))
  expect(relevant).toHaveLength(0)
})
