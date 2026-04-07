// Decision visual assertion helpers for browser tests (real Chromium).
//
// Pixel-truth semantics: these helpers read actual rendered pixels via
// page.screenshot(), so they verify what the user ACTUALLY sees after the
// browser's paint + composite + clip pipeline.
//
// All helpers are async. Tests must `await` each assertion.

import { expect } from 'vitest'
import { DECISION_SELECTORS, DECISION_COLORS } from '$lib/constants/decisions'
import { resolveMarker } from './visual-channel'
import {
  assertColorVisibleInElementArea,
  assertColorNotVisibleInElementArea,
} from './pixel-verifier'

function resolveKeepTarget(el: HTMLElement): HTMLElement | null {
  return resolveMarker(el, DECISION_SELECTORS.keep)
}
function resolveEliminateTarget(el: HTMLElement): HTMLElement | null {
  return resolveMarker(el, DECISION_SELECTORS.eliminate)
}

/** Assert that the kept indicator color is visible in the element's pixels. */
export async function assertVisuallyKept(element: HTMLElement) {
  const target = resolveKeepTarget(element)
  expect(target, `element must carry keep marker (${DECISION_SELECTORS.keep})`).not.toBeNull()
  await assertColorVisibleInElementArea(target!, DECISION_COLORS.keep)
}

/** Assert that the eliminated indicator color is visible in the element's pixels. */
export async function assertVisuallyEliminated(element: HTMLElement) {
  const target = resolveEliminateTarget(element)
  expect(target, `element must carry eliminate marker (${DECISION_SELECTORS.eliminate})`).not.toBeNull()
  await assertColorVisibleInElementArea(target!, DECISION_COLORS.eliminate)
}

/**
 * Assert that an element is visually dimmed (eliminated appearance).
 * Supports: dim-overlay child, OR reduced card opacity (~0.5).
 * (No pixel check — dimming is a full-element effect, not a color channel.)
 */
export function assertVisuallyDimmed(element: HTMLElement) {
  const overlay = element.querySelector(DECISION_SELECTORS.dimOverlay) as HTMLElement | null
  const cardOpacity = parseFloat(getComputedStyle(element).opacity)

  const hasDimOverlay = overlay !== null && overlay.getBoundingClientRect().width > 0
  const hasReducedOpacity = Math.abs(cardOpacity - 0.5) < 0.1

  expect(
    hasDimOverlay || hasReducedOpacity,
    `element must be dimmed (overlay present: ${hasDimOverlay}, opacity: ${cardOpacity})`,
  ).toBe(true)
}

/** Assert that neither the kept nor the eliminated color appears in the element's pixels. */
export async function assertVisuallyUndecided(element: HTMLElement) {
  await assertColorNotVisibleInElementArea(element, DECISION_COLORS.keep)
  await assertColorNotVisibleInElementArea(element, DECISION_COLORS.eliminate)
}

/**
 * Assert that an element has full opacity (not dimmed).
 */
export function assertNotDimmed(element: HTMLElement) {
  const cardOpacity = parseFloat(getComputedStyle(element).opacity)
  expect(cardOpacity, 'non-eliminated element must have full opacity').toBeCloseTo(1.0, 1)

  const overlay = element.querySelector(DECISION_SELECTORS.dimOverlay)
  expect(overlay, 'non-eliminated element must not have dim overlay').toBeNull()
}
