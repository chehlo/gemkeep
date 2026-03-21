/**
 * E2E tests for orientation data flow in StackFocus.
 *
 * Covers:
 *   - Photos with orientation metadata render in StackFocus
 *   - Orientation values are accessible on rendered photo cards
 *
 * Architecture: thumbnails are pre-rotated by the backend. The frontend
 * receives orientation metadata but does NOT apply CSS transforms.
 * These tests verify the data flow, not visual rotation.
 */

import { test, expect } from '@playwright/test'
import {
  injectTauriMock, createProject,
  FOLDER_ICELAND as FOLDER_A, DONE_STATUS,
} from './helpers/tauri-mock'

// ── Fixtures ─────────────────────────────────────────────────────────────────

const STACK = {
  stack_id: 1,
  logical_photo_count: 8,
  earliest_capture: '2024-03-15T10:00:00Z',
  has_raw: true,
  has_jpeg: true,
  thumbnail_path: '/cache/1.jpg',
}

// Photos with orientation 1-8 (mixed cameras matching real-world usage)
const ORIENTATION_PHOTOS = [
  { logical_photo_id: 101, thumbnail_path: '/cache/photo_101.jpg', capture_time: '2024-03-15T10:00:00Z', camera_model: 'Canon EOS R5',     lens: 'RF 85mm F1.2L',    has_raw: true, has_jpeg: true, orientation: 1 },
  { logical_photo_id: 102, thumbnail_path: '/cache/photo_102.jpg', capture_time: '2024-03-15T10:01:00Z', camera_model: 'Sony ILCE-7RM4',   lens: 'FE 24-70mm F2.8',  has_raw: true, has_jpeg: true, orientation: 2 },
  { logical_photo_id: 103, thumbnail_path: '/cache/photo_103.jpg', capture_time: '2024-03-15T10:02:00Z', camera_model: 'Canon EOS 80D',    lens: 'EF 50mm F1.4',     has_raw: true, has_jpeg: true, orientation: 3 },
  { logical_photo_id: 104, thumbnail_path: '/cache/photo_104.jpg', capture_time: '2024-03-15T10:03:00Z', camera_model: 'Sony DSC-RX10M4',  lens: '24-600mm F2.4-4',  has_raw: true, has_jpeg: true, orientation: 4 },
  { logical_photo_id: 105, thumbnail_path: '/cache/photo_105.jpg', capture_time: '2024-03-15T10:04:00Z', camera_model: 'Nikon D850',        lens: 'AF-S 70-200mm F2.8', has_raw: true, has_jpeg: true, orientation: 5 },
  { logical_photo_id: 106, thumbnail_path: '/cache/photo_106.jpg', capture_time: '2024-03-15T10:05:00Z', camera_model: 'Canon EOS R5',     lens: 'RF 85mm F1.2L',    has_raw: true, has_jpeg: true, orientation: 6 },
  { logical_photo_id: 107, thumbnail_path: '/cache/photo_107.jpg', capture_time: '2024-03-15T10:06:00Z', camera_model: 'Fujifilm X-T5',    lens: 'XF 56mm F1.2',     has_raw: true, has_jpeg: true, orientation: 7 },
  { logical_photo_id: 108, thumbnail_path: '/cache/photo_108.jpg', capture_time: '2024-03-15T10:07:00Z', camera_model: 'Panasonic DC-GH6',  lens: '12-60mm F2.8-4',   has_raw: true, has_jpeg: true, orientation: 8 },
]

// ── Tests ────────────────────────────────────────────────────────────────────

test.describe('Orientation — StackFocus data flow', () => {
  test('photos with mixed orientations render in StackFocus', async ({ page }) => {
    await injectTauriMock(page, {
      initialFolders: [FOLDER_A],
      initialStacks: [STACK],
      initialStatus: DONE_STATUS,
      photos: ORIENTATION_PHOTOS,
    })
    await page.goto('/')
    await createProject(page, 'Orientation Test')

    // Navigate to stack focus
    await page.getByText(`Stack #${STACK.stack_id}`).click()

    // All 8 photo cards should be visible
    const cards = page.locator('[data-testid="photo-card"]')
    await expect(cards).toHaveCount(8)
  })

  test('orientation values are accessible on photo cards', async ({ page }) => {
    await injectTauriMock(page, {
      initialFolders: [FOLDER_A],
      initialStacks: [STACK],
      initialStatus: DONE_STATUS,
      photos: ORIENTATION_PHOTOS,
    })
    await page.goto('/')
    await createProject(page, 'Orientation Test')

    // Navigate to stack focus
    await page.getByText(`Stack #${STACK.stack_id}`).click()

    const cards = page.locator('[data-testid="photo-card"]')
    await expect(cards).toHaveCount(8)

    // Each photo card should expose its orientation as a data attribute
    for (let i = 0; i < 8; i++) {
      const card = cards.nth(i)
      const orientation = await card.getAttribute('data-orientation')
      expect(orientation, `card ${i} should have data-orientation="${i + 1}"`).toBe(String(i + 1))
    }
  })
})
