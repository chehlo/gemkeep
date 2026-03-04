// StackFocus visual tests — vitest-browser-svelte (real Chromium)
// Covers: SF-07 (green badge), SF-08 (red badge), SF-09 (opacity dimming), SF-10 (blue focus ring)
// These tests verify actual computed CSS values, not class names.

import { render } from 'vitest-browser-svelte'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import { navigate } from '$lib/stores/navigation.svelte.js'
import type { LogicalPhotoSummary } from '$lib/api/index.js'
import StackFocus from './StackFocus.svelte'

const mockInvoke = vi.mocked(invoke)

const PHOTO_1: LogicalPhotoSummary = {
  logical_photo_id: 1,
  thumbnail_path: null,
  capture_time: '2024-01-15T10:30:00Z',
  camera_model: 'Canon EOS 5D',
  lens: 'EF 85mm f/1.4',
  has_raw: true,
  has_jpeg: true,
}

const PHOTO_2: LogicalPhotoSummary = {
  logical_photo_id: 2,
  thumbnail_path: null,
  capture_time: '2024-01-15T10:31:00Z',
  camera_model: 'Canon EOS 5D',
  lens: null,
  has_raw: false,
  has_jpeg: true,
}

const PHOTO_3: LogicalPhotoSummary = {
  logical_photo_id: 3,
  thumbnail_path: null,
  capture_time: null,
  camera_model: null,
  lens: null,
  has_raw: false,
  has_jpeg: true,
}

const mockPhotos: LogicalPhotoSummary[] = [PHOTO_1, PHOTO_2, PHOTO_3]

const OPEN_ROUND = {
  round_id: 1, round_number: 1, state: 'open',
  total_photos: 3, decided: 0, kept: 0, eliminated: 0, undecided: 3, committed_at: null,
}

function setupNav() {
  navigate({ kind: 'stack-focus', projectSlug: 'test-project', projectName: 'Test Project', stackId: 1 })
}

beforeEach(() => {
  vi.clearAllMocks()
  setupNav()
})

/**
 * Mock the 3 invoke calls StackFocus makes on mount:
 * 1. list_logical_photos -> photos
 * 2. get_stack_decisions -> decisions
 * 3. get_round_status -> round status
 */
function mockStackFocusMount(
  photos: LogicalPhotoSummary[],
  decisions: Array<{ logical_photo_id: number; current_status: string }> = [],
  roundStatus = OPEN_ROUND,
) {
  mockInvoke.mockResolvedValueOnce(photos)       // list_logical_photos
  mockInvoke.mockResolvedValueOnce(decisions)     // get_stack_decisions
  mockInvoke.mockResolvedValueOnce(roundStatus)   // get_round_status
}

/** Wait for photo cards to appear in the DOM. */
async function waitForCards(count: number): Promise<HTMLElement[]> {
  let cards: HTMLElement[] = []
  // Poll until cards appear (component loads async data)
  await vi.waitFor(() => {
    cards = Array.from(document.querySelectorAll('[data-testid="photo-card"]')) as HTMLElement[]
    if (cards.length !== count) {
      throw new Error(`Expected ${count} cards, got ${cards.length}`)
    }
  }, { timeout: 5000 })
  return cards
}

describe('StackFocus — SF-07: green badge on kept photos (visual)', () => {
  it('kept photo has a visible green badge with correct background color', async () => {
    mockStackFocusMount(mockPhotos, [
      { logical_photo_id: 1, current_status: 'keep' },
      { logical_photo_id: 2, current_status: 'undecided' },
      { logical_photo_id: 3, current_status: 'undecided' },
    ], { ...OPEN_ROUND, decided: 1, kept: 1, undecided: 2 })

    render(StackFocus)
    const cards = await waitForCards(3)

    // Card 0 (kept) should have a green badge
    const badge = cards[0].querySelector('.decision-keep') as HTMLElement
    expect(badge).not.toBeNull()

    // Verify the badge is visible (has non-zero dimensions)
    const box = badge.getBoundingClientRect()
    expect(box.width).toBeGreaterThan(0)
    expect(box.height).toBeGreaterThan(0)

    // Verify green background color via getComputedStyle
    const bgColor = getComputedStyle(badge).backgroundColor
    // Tailwind bg-green-500 = rgb(34, 197, 94)
    expect(bgColor).toBe('rgb(34, 197, 94)')

    // Badge should be contained within the card
    const cardBox = cards[0].getBoundingClientRect()
    expect(box.top).toBeGreaterThanOrEqual(cardBox.top)
    expect(box.left).toBeGreaterThanOrEqual(cardBox.left)
    expect(box.right).toBeLessThanOrEqual(cardBox.right + 1) // +1 for rounding
    expect(box.bottom).toBeLessThanOrEqual(cardBox.bottom + 1)
  })

  it('undecided photo has no keep badge', async () => {
    mockStackFocusMount(mockPhotos, [
      { logical_photo_id: 1, current_status: 'undecided' },
      { logical_photo_id: 2, current_status: 'undecided' },
      { logical_photo_id: 3, current_status: 'undecided' },
    ])

    render(StackFocus)
    const cards = await waitForCards(3)

    // No badge on any card
    for (const card of cards) {
      expect(card.querySelector('.decision-keep')).toBeNull()
      expect(card.querySelector('.decision-eliminate')).toBeNull()
    }
  })
})

describe('StackFocus — SF-08: red badge on eliminated photos (visual)', () => {
  it('eliminated photo has a visible red badge with correct background color', async () => {
    mockStackFocusMount(mockPhotos, [
      { logical_photo_id: 1, current_status: 'undecided' },
      { logical_photo_id: 2, current_status: 'eliminate' },
      { logical_photo_id: 3, current_status: 'undecided' },
    ], { ...OPEN_ROUND, decided: 1, eliminated: 1, undecided: 2 })

    render(StackFocus)
    const cards = await waitForCards(3)

    // Card 1 (eliminated) should have a red badge
    const badge = cards[1].querySelector('.decision-eliminate') as HTMLElement
    expect(badge).not.toBeNull()

    // Verify the badge is visible
    const box = badge.getBoundingClientRect()
    expect(box.width).toBeGreaterThan(0)
    expect(box.height).toBeGreaterThan(0)

    // Verify red background color via getComputedStyle
    const bgColor = getComputedStyle(badge).backgroundColor
    // Tailwind bg-red-500 = rgb(239, 68, 68)
    expect(bgColor).toBe('rgb(239, 68, 68)')

    // Badge contained within card
    const cardBox = cards[1].getBoundingClientRect()
    expect(box.top).toBeGreaterThanOrEqual(cardBox.top)
    expect(box.right).toBeLessThanOrEqual(cardBox.right + 1)
  })
})

describe('StackFocus — SF-09: eliminated photos dimmed to ~50% opacity (visual)', () => {
  it('eliminated card has computed opacity approximately 0.5', async () => {
    mockStackFocusMount(mockPhotos, [
      { logical_photo_id: 1, current_status: 'undecided' },
      { logical_photo_id: 2, current_status: 'eliminate' },
      { logical_photo_id: 3, current_status: 'undecided' },
    ], { ...OPEN_ROUND, decided: 1, eliminated: 1, undecided: 2 })

    render(StackFocus)
    const cards = await waitForCards(3)

    // Card 1 (eliminated) should have opacity ~0.5
    const opacity = parseFloat(getComputedStyle(cards[1]).opacity)
    expect(opacity).toBeCloseTo(0.5, 1)

    // Other cards should have full opacity
    const opacity0 = parseFloat(getComputedStyle(cards[0]).opacity)
    expect(opacity0).toBeCloseTo(1.0, 1)

    const opacity2 = parseFloat(getComputedStyle(cards[2]).opacity)
    expect(opacity2).toBeCloseTo(1.0, 1)
  })
})

describe('StackFocus — SF-10: focused card has blue selection ring (visual)', () => {
  it('first card (focused by default) has blue border color', async () => {
    mockStackFocusMount(mockPhotos, [
      { logical_photo_id: 1, current_status: 'undecided' },
      { logical_photo_id: 2, current_status: 'undecided' },
      { logical_photo_id: 3, current_status: 'undecided' },
    ])

    render(StackFocus)
    const cards = await waitForCards(3)

    // Card 0 should have blue border (border-blue-500)
    const borderColor0 = getComputedStyle(cards[0]).borderColor
    // Tailwind border-blue-500 = rgb(59, 130, 246)
    expect(borderColor0).toBe('rgb(59, 130, 246)')

    // Card 1 should NOT have blue border
    const borderColor1 = getComputedStyle(cards[1]).borderColor
    expect(borderColor1).not.toBe('rgb(59, 130, 246)')
  })

  it('navigating right moves the blue ring to the next card', async () => {
    mockStackFocusMount(mockPhotos, [
      { logical_photo_id: 1, current_status: 'undecided' },
      { logical_photo_id: 2, current_status: 'undecided' },
      { logical_photo_id: 3, current_status: 'undecided' },
    ])

    render(StackFocus)
    const cards = await waitForCards(3)

    // Initially card 0 is focused
    expect(getComputedStyle(cards[0]).borderColor).toBe('rgb(59, 130, 246)')

    // Press ArrowRight to move focus
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))

    // Wait for the focus to move
    await vi.waitFor(() => {
      const bc1 = getComputedStyle(cards[1]).borderColor
      if (bc1 !== 'rgb(59, 130, 246)') {
        throw new Error('Card 1 not yet focused')
      }
    }, { timeout: 3000 })

    // Card 0 should no longer have blue border
    expect(getComputedStyle(cards[0]).borderColor).not.toBe('rgb(59, 130, 246)')
    // Card 1 should now have blue border
    expect(getComputedStyle(cards[1]).borderColor).toBe('rgb(59, 130, 246)')
  })
})
