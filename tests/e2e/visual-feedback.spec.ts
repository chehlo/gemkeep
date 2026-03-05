/**
 * POC: Prove that Playwright can catch CSS positioning bugs that jsdom cannot.
 *
 * This single test presses Y on a StackFocus card and checks that the green
 * "keep" badge is visually contained within the card's bounding box.
 * Without `position: relative` on the card, the absolutely-positioned badge
 * escapes to a higher ancestor — Playwright catches this, jsdom never would.
 *
 * Expected: FAIL (card lacks `relative`, badge escapes card bounds).
 */

import { test, expect } from '@playwright/test'
import {
  injectTauriMock, createProject,
  FOLDER_ICELAND as FOLDER_A, DONE_STATUS,
  makePhotos, makePhotoDetail, makeRoundStatus, makeStacks,
} from './helpers/tauri-mock'
import { KEEP_SELECTOR } from './helpers/decision-selectors'

const STACKS = makeStacks(1, true)
const PHOTOS = makePhotos(3, 1)
const PHOTO_DETAILS: Record<number, unknown> = {
  101: makePhotoDetail(101),
  102: makePhotoDetail(102),
  103: makePhotoDetail(103),
}

test('Y key — green badge must be positioned inside its StackFocus card', async ({ page }) => {
  // Setup mock + navigate to StackFocus
  await injectTauriMock(page, {
    initialFolders: [FOLDER_A],
    initialStacks: STACKS,
    initialStatus: DONE_STATUS,
    initialPhotos: PHOTOS,
    initialPhotoDetails: PHOTO_DETAILS,
    initialRoundStatus: makeRoundStatus(3),
  })
  await page.goto('/')
  await createProject(page, 'Visual POC')

  await expect(page.getByText('Index complete.')).toBeVisible({ timeout: 5_000 })
  await expect(page.locator('[data-stack-card]')).toHaveCount(1, { timeout: 5_000 })

  // Enter StackFocus
  await page.keyboard.press('Enter')
  await expect(page.getByText('Stack #1')).toBeVisible({ timeout: 5_000 })
  await expect(page.locator('[data-testid="photo-card"]')).toHaveCount(3, { timeout: 5_000 })

  // Press Y to keep the first photo
  await page.keyboard.press('y')

  // Wait for make_decision IPC
  await page.waitForFunction(
    () => (window as unknown as Record<string, string[]>).__ipcLog.includes('make_decision'),
    { timeout: 5_000 },
  )

  // The badge should exist and be visible
  const firstCard = page.locator('[data-testid="photo-card"]').first()
  const badge = firstCard.locator(KEEP_SELECTOR)
  await expect(badge).toBeVisible({ timeout: 3_000 })

  // KEY ASSERTION: badge bounding box must be inside the card bounding box.
  // Without `position: relative` on the card, the badge's `absolute` positioning
  // escapes to a higher ancestor — this assertion will fail.
  const cardBox = await firstCard.boundingBox()
  const badgeBox = await badge.boundingBox()

  expect(cardBox).toBeTruthy()
  expect(badgeBox).toBeTruthy()

  const cardRight = cardBox!.x + cardBox!.width
  const cardBottom = cardBox!.y + cardBox!.height
  const badgeRight = badgeBox!.x + badgeBox!.width
  const badgeBottom = badgeBox!.y + badgeBox!.height

  // Badge must be fully contained within card
  expect(badgeBox!.x).toBeGreaterThanOrEqual(cardBox!.x)
  expect(badgeBox!.y).toBeGreaterThanOrEqual(cardBox!.y)
  expect(badgeRight).toBeLessThanOrEqual(cardRight)
  expect(badgeBottom).toBeLessThanOrEqual(cardBottom)
})
