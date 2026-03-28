// StackFocus visual tests — vitest-browser-svelte (real Chromium)
// Covers: SF-07 (green badge), SF-08 (red badge), SF-09 (opacity dimming), SF-10 (blue focus ring)
// These tests verify actual computed CSS values via style-agnostic helpers,
// so they work regardless of whether the indicator is border-frame or badge-dot style.

import { render } from 'vitest-browser-svelte'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { navigate } from '$lib/stores/navigation.svelte.js'
import type { LogicalPhotoSummary } from '$lib/api/index.js'
import { invoke } from '@tauri-apps/api/core'
import { PHOTO_1 as _PHOTO_1, PHOTO_2, PHOTO_3, OPEN_ROUND, makePhotoList, makeRoundStatus } from '$test/fixtures'
import { mockStackFocusRouter } from '$test/helpers'
import { waitForCards as _waitForCards } from '$test/browser-helpers'
import {
  assertVisuallyKept, assertVisuallyEliminated,
  assertVisuallyDimmed, assertVisuallyUndecided, assertNotDimmed,
} from '$test/decision-visual-helpers'
import StackFocus from './StackFocus.svelte'

const mockInvoke = vi.mocked(invoke)

// Browser tests use thumbnail_path: null (no asset protocol in test env)
const PHOTO_1: LogicalPhotoSummary = { ..._PHOTO_1, thumbnail_path: null }

const mockPhotos: LogicalPhotoSummary[] = [PHOTO_1, PHOTO_2, PHOTO_3]

function setupNav() {
  navigate({ kind: 'stack-focus', projectSlug: 'test-project', projectName: 'Test Project', stackId: 1 })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockInvoke.mockImplementation(mockStackFocusRouter())
  setupNav()
})

async function waitForCards(count: number): Promise<HTMLElement[]> {
  return _waitForCards(count)
}

describe('StackFocus — SF-07: green badge on kept photos (visual)', () => {
  it('kept photo has a visible green indicator', async () => {
    mockInvoke.mockImplementation(mockStackFocusRouter({
      list_logical_photos: [mockPhotos],
      get_round_decisions: [[
        { logical_photo_id: 1, current_status: 'keep' },
        { logical_photo_id: 2, current_status: 'undecided' },
        { logical_photo_id: 3, current_status: 'undecided' },
      ]],
      get_round_status: { ...OPEN_ROUND, decided: 1, kept: 1, undecided: 2 },
    }))

    render(StackFocus)
    const cards = await waitForCards(3)

    assertVisuallyKept(cards[0])
  })

  it('undecided photo has no decision indicator', async () => {
    mockInvoke.mockImplementation(mockStackFocusRouter({
      list_logical_photos: [mockPhotos],
      get_round_decisions: [[
        { logical_photo_id: 1, current_status: 'undecided' },
        { logical_photo_id: 2, current_status: 'undecided' },
        { logical_photo_id: 3, current_status: 'undecided' },
      ]],
    }))

    render(StackFocus)
    const cards = await waitForCards(3)

    for (const card of cards) {
      assertVisuallyUndecided(card)
    }
  })
})

describe('StackFocus — SF-08: red badge on eliminated photos (visual)', () => {
  it('eliminated photo has a visible red indicator', async () => {
    mockInvoke.mockImplementation(mockStackFocusRouter({
      list_logical_photos: [mockPhotos],
      get_round_decisions: [[
        { logical_photo_id: 1, current_status: 'undecided' },
        { logical_photo_id: 2, current_status: 'eliminate' },
        { logical_photo_id: 3, current_status: 'undecided' },
      ]],
      get_round_status: { ...OPEN_ROUND, decided: 1, eliminated: 1, undecided: 2 },
    }))

    render(StackFocus)
    const cards = await waitForCards(3)

    assertVisuallyEliminated(cards[1])
  })
})

describe('StackFocus — SF-09: eliminated photos dimmed to ~50% opacity (visual)', () => {
  it('eliminated card is visually dimmed', async () => {
    mockInvoke.mockImplementation(mockStackFocusRouter({
      list_logical_photos: [mockPhotos],
      get_round_decisions: [[
        { logical_photo_id: 1, current_status: 'undecided' },
        { logical_photo_id: 2, current_status: 'eliminate' },
        { logical_photo_id: 3, current_status: 'undecided' },
      ]],
      get_round_status: { ...OPEN_ROUND, decided: 1, eliminated: 1, undecided: 2 },
    }))

    render(StackFocus)
    const cards = await waitForCards(3)

    // Card 1 (eliminated) should be dimmed
    assertVisuallyDimmed(cards[1])

    // Other cards should have full opacity
    assertNotDimmed(cards[0])
    assertNotDimmed(cards[2])
  })
})

describe('StackFocus — SF-10: focused card has blue selection ring (visual)', () => {
  it('first card (focused by default) has visible blue border', async () => {
    mockInvoke.mockImplementation(mockStackFocusRouter({
      list_logical_photos: [mockPhotos],
      get_round_decisions: [[
        { logical_photo_id: 1, current_status: 'undecided' },
        { logical_photo_id: 2, current_status: 'undecided' },
        { logical_photo_id: 3, current_status: 'undecided' },
      ]],
    }))

    render(StackFocus)
    const cards = await waitForCards(3)

    const frame0 = cards[0].querySelector('[data-testid="photo-frame"]') as HTMLElement
    const frame1 = cards[1].querySelector('[data-testid="photo-frame"]') as HTMLElement

    // Focused frame must have a VISIBLE blue indicator — either via borderColor or boxShadow.
    // An inset ring behind a gray border is invisible, so borderColor MUST be blue.
    const borderColor0 = getComputedStyle(frame0).borderColor
    expect(borderColor0, 'focused frame border must be blue-500, not gray').toBe('rgb(59, 130, 246)')

    // Non-focused frame must NOT have blue border
    const borderColor1 = getComputedStyle(frame1).borderColor
    expect(borderColor1, 'non-focused frame must not have blue border').not.toBe('rgb(59, 130, 246)')
  })

  it('navigating right moves the blue border to the next card', async () => {
    mockInvoke.mockImplementation(mockStackFocusRouter({
      list_logical_photos: [mockPhotos],
      get_round_decisions: [[
        { logical_photo_id: 1, current_status: 'undecided' },
        { logical_photo_id: 2, current_status: 'undecided' },
        { logical_photo_id: 3, current_status: 'undecided' },
      ]],
    }))

    render(StackFocus)
    const cards = await waitForCards(3)

    const frame0 = cards[0].querySelector('[data-testid="photo-frame"]') as HTMLElement
    const frame1 = cards[1].querySelector('[data-testid="photo-frame"]') as HTMLElement

    // Initially card 0 has blue border
    expect(getComputedStyle(frame0).borderColor).toBe('rgb(59, 130, 246)')

    // Press ArrowRight to move focus
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))

    // Wait for focus to move — check computed border color, not class name
    await vi.waitFor(() => {
      if (getComputedStyle(frame1).borderColor !== 'rgb(59, 130, 246)') {
        throw new Error('Card 1 not yet focused')
      }
    }, { timeout: 3000 })

    // Card 0 should no longer have blue border
    expect(getComputedStyle(frame0).borderColor).not.toBe('rgb(59, 130, 246)')
    // Card 1 should now have blue border
    expect(getComputedStyle(frame1).borderColor).toBe('rgb(59, 130, 246)')
  })
})

// ─── Bug 3: Error toast is fixed-position bottom bar ───────────────────────

describe('StackFocus — Bug 3: error toast is fixed-position bottom bar', () => {
  it('action-error element has position:fixed and bottom:0px', async () => {
    mockInvoke.mockImplementation(mockStackFocusRouter({
      list_logical_photos: [mockPhotos],
    }))

    render(StackFocus)
    const cards = await waitForCards(3)

    // Trigger error: press C with 0 selected
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', bubbles: true }))

    // Wait for error element to appear
    let errorEl: HTMLElement | null = null
    await vi.waitFor(() => {
      errorEl = document.querySelector('[data-testid="action-error"]') as HTMLElement
      if (!errorEl) throw new Error('action-error not found')
    }, { timeout: 3000 })

    // Error toast must be fixed-position at the bottom
    const style = getComputedStyle(errorEl!)
    expect(style.position).toBe('fixed')
    expect(style.bottom).toBe('0px')
  })
})

// ─── Round-commit: B5 — survivors shown as undecided after Ctrl+Enter ──────

describe('StackFocus — B5: after Ctrl+Enter, grid shows only undecided survivors (visual)', () => {
  it('commit reduces card count and all survivors have undecided visual state', async () => {
    // B5: After Ctrl+Enter, grid visually shows only survivors as undecided.
    // Mock commit_round to return success, mock re-fetch to return 2 survivors (undecided).
    // Assert: photo cards have undecided visual state (no green/red indicators), card count = 2.

    // Survivor photos returned after commit (only 2 survivors, both undecided)
    const survivorPhotos: LogicalPhotoSummary[] = [
      { ...PHOTO_1, logical_photo_id: 1 },
      { ...PHOTO_3, logical_photo_id: 3 },
    ]

    mockInvoke.mockImplementation(mockStackFocusRouter({
      // First call returns 3 photos, second call (after commit) returns 2 survivors
      list_logical_photos: [mockPhotos, survivorPhotos],
      get_round_decisions: [
        // Initial: all decided
        [
          { logical_photo_id: 1, current_status: 'keep' },
          { logical_photo_id: 2, current_status: 'eliminate' },
          { logical_photo_id: 3, current_status: 'keep' },
        ],
        // After commit: survivors are undecided
        [
          { logical_photo_id: 1, current_status: 'undecided' },
          { logical_photo_id: 3, current_status: 'undecided' },
        ],
      ],
      get_round_status: [
        // Initial: open, all decided
        { round_id: 1, round_number: 1, state: 'open', total_photos: 3, decided: 3, kept: 2, eliminated: 1, undecided: 0, committed_at: null },
        // After commit: new round 2, open, all undecided
        { round_id: 2, round_number: 2, state: 'open', total_photos: 2, decided: 0, kept: 0, eliminated: 0, undecided: 2, committed_at: null },
      ],
      commit_round: undefined,
    }))

    render(StackFocus)

    // Wait for initial 3 cards with decision indicators
    const initialCards = await waitForCards(3)
    // First card should be visually kept (green)
    assertVisuallyKept(initialCards[0])
    // Second card should be visually eliminated (red + dimmed)
    assertVisuallyEliminated(initialCards[1])

    // Press Ctrl+Enter to commit
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }))

    // After commit, grid should re-render with only 2 survivor cards
    const survivorCards = await waitForCards(2)

    // ALL survivor cards must be visually undecided (no green/red indicators)
    for (const card of survivorCards) {
      assertVisuallyUndecided(card)
    }

    // Survivors must NOT be dimmed (full opacity)
    for (const card of survivorCards) {
      assertNotDimmed(card)
    }
  })
})

describe('StackFocus — BUG-09: header stays visible when grid scrolls', () => {
  it('header remains in viewport after scrolling content down', async () => {
    // Create 20 photos — enough to overflow a 4-column grid in a small viewport
    const manyPhotos = makePhotoList(20)
    const decisions = manyPhotos.map(p => ({ logical_photo_id: p.logical_photo_id, current_status: 'undecided' as const }))
    const round = makeRoundStatus({ total_photos: 20, undecided: 20 })

    mockInvoke.mockImplementation(mockStackFocusRouter({
      list_logical_photos: [manyPhotos],
      get_round_decisions: [decisions],
      get_round_status: round,
    }))
    render(StackFocus)
    const cards = await waitForCards(20)

    // Scroll the last card into view (simulates navigating to bottom)
    cards[cards.length - 1].scrollIntoView({ block: 'end' })

    // Wait a tick for scroll to settle
    await new Promise(r => setTimeout(r, 100))

    // Header must still be visible in the viewport
    const header = document.querySelector('header') as HTMLElement
    expect(header).not.toBeNull()

    const headerRect = header.getBoundingClientRect()
    // Header top must be >= 0 (not scrolled above viewport)
    expect(headerRect.top).toBeGreaterThanOrEqual(0)
    // Header must have non-zero height (visible, not collapsed)
    expect(headerRect.height).toBeGreaterThan(0)
  })
})
