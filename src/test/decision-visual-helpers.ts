// src/test/decision-visual-helpers.ts
// Style-agnostic visual assertion helpers for browser tests (real Chromium).
//
// These helpers detect which visual style is active (border-frame vs badge-dot)
// and assert the correct CSS property. When introducing A/B style variants,
// update only this file — not every browser test.

import { expect } from 'vitest'
import { DECISION_SELECTORS } from '$lib/constants/decisions'

// ── Color constants ──────────────────────────────────────────────────────────

const KEEP_GREEN = 'rgb(34, 197, 94)'      // Tailwind green-500
const ELIMINATE_RED = 'rgb(239, 68, 68)'    // Tailwind red-500

function hasColor(element: HTMLElement, color: string): boolean {
  const style = getComputedStyle(element)
  return style.backgroundColor === color || style.borderColor === color
}

// ── Public assertion helpers ─────────────────────────────────────────────────

/**
 * Assert that a card is visually marked as "kept" (green indicator).
 * Works for both border-frame style (border-green-500) and badge style (bg-green-500).
 */
export function assertVisuallyKept(card: HTMLElement) {
  const indicator = card.querySelector(DECISION_SELECTORS.keep) as HTMLElement
  expect(indicator, 'keep indicator element must exist on card').not.toBeNull()

  // Indicator must be visible (non-zero dimensions)
  const box = indicator.getBoundingClientRect()
  expect(box.width, 'keep indicator must have non-zero width').toBeGreaterThan(0)
  expect(box.height, 'keep indicator must have non-zero height').toBeGreaterThan(0)

  // Green color via either backgroundColor or borderColor
  expect(
    hasColor(indicator, KEEP_GREEN),
    `keep indicator must be green via backgroundColor or borderColor (got bg=${getComputedStyle(indicator).backgroundColor}, border=${getComputedStyle(indicator).borderColor})`,
  ).toBe(true)

  // Indicator must be contained within the card
  const cardBox = card.getBoundingClientRect()
  expect(box.top).toBeGreaterThanOrEqual(cardBox.top)
  expect(box.left).toBeGreaterThanOrEqual(cardBox.left)
  expect(box.right).toBeLessThanOrEqual(cardBox.right + 1) // +1 for sub-pixel rounding
  expect(box.bottom).toBeLessThanOrEqual(cardBox.bottom + 1)
}

/**
 * Assert that a card is visually marked as "eliminated" (red indicator).
 * Works for both border-frame style (border-red-500) and badge style (bg-red-500).
 */
export function assertVisuallyEliminated(card: HTMLElement) {
  const indicator = card.querySelector(DECISION_SELECTORS.eliminate) as HTMLElement
  expect(indicator, 'eliminate indicator element must exist on card').not.toBeNull()

  // Indicator must be visible (non-zero dimensions)
  const box = indicator.getBoundingClientRect()
  expect(box.width, 'eliminate indicator must have non-zero width').toBeGreaterThan(0)
  expect(box.height, 'eliminate indicator must have non-zero height').toBeGreaterThan(0)

  // Red color via either backgroundColor or borderColor
  expect(
    hasColor(indicator, ELIMINATE_RED),
    `eliminate indicator must be red via backgroundColor or borderColor (got bg=${getComputedStyle(indicator).backgroundColor}, border=${getComputedStyle(indicator).borderColor})`,
  ).toBe(true)

  // Indicator must be contained within the card
  const cardBox = card.getBoundingClientRect()
  expect(box.top).toBeGreaterThanOrEqual(cardBox.top)
  expect(box.right).toBeLessThanOrEqual(cardBox.right + 1)
}

/**
 * Assert that a card is visually dimmed (eliminated appearance).
 * Supports two styles:
 *   - Overlay child: a `.decision-dim-overlay` element with bg-black/50
 *   - Card opacity: the card itself has opacity ~0.5
 */
export function assertVisuallyDimmed(card: HTMLElement) {
  const overlay = card.querySelector(DECISION_SELECTORS.dimOverlay) as HTMLElement | null
  const cardOpacity = parseFloat(getComputedStyle(card).opacity)

  const hasDimOverlay = overlay !== null && overlay.getBoundingClientRect().width > 0
  const hasReducedOpacity = Math.abs(cardOpacity - 0.5) < 0.1

  expect(
    hasDimOverlay || hasReducedOpacity,
    `eliminated card must be dimmed (overlay present: ${hasDimOverlay}, card opacity: ${cardOpacity})`,
  ).toBe(true)
}

/**
 * Assert that a card has NO decision indicators (undecided state).
 */
export function assertVisuallyUndecided(card: HTMLElement) {
  expect(card.querySelector(DECISION_SELECTORS.keep), 'undecided card must not have keep indicator').toBeNull()
  expect(card.querySelector(DECISION_SELECTORS.eliminate), 'undecided card must not have eliminate indicator').toBeNull()
}

/**
 * Assert that a card has full opacity (not dimmed).
 */
export function assertNotDimmed(card: HTMLElement) {
  const cardOpacity = parseFloat(getComputedStyle(card).opacity)
  expect(cardOpacity, 'non-eliminated card must have full opacity').toBeCloseTo(1.0, 1)

  const overlay = card.querySelector(DECISION_SELECTORS.dimOverlay)
  expect(overlay, 'non-eliminated card must not have dim overlay').toBeNull()
}
