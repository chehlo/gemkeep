/**
 * Test helpers for querying decision indicator elements.
 * Centralizes selectors so tests don't hardcode class names.
 *
 * If we rename `.decision-keep` to `.badge-keep`, only decisions.ts
 * and this file need updating — not every test file.
 */
import { DECISION_SELECTORS, STATUS_TEXT_MARKERS } from '$lib/constants/decisions'
import type { DecisionStatus } from '$lib/constants/decisions'

// ── jsdom helpers (querySelector-based) ──────────────────────────────────────

/** Query the keep indicator within a container element */
export function queryKeepIndicator(container: Element | Document): Element | null {
  return container.querySelector(DECISION_SELECTORS.keep)
}

/** Query the eliminate indicator within a container element */
export function queryEliminateIndicator(container: Element | Document): Element | null {
  return container.querySelector(DECISION_SELECTORS.eliminate)
}

/** Query the dim overlay within a container element */
export function queryDimOverlay(container: Element | Document): Element | null {
  return container.querySelector(DECISION_SELECTORS.dimOverlay)
}

/** Check if a card has a specific decision indicator */
export function hasDecisionIndicator(card: Element, decision: 'keep' | 'eliminate'): boolean {
  return card.querySelector(DECISION_SELECTORS[decision]) !== null
}

// ── Raw string selectors (for Playwright locator() / querySelector()) ────────

/** CSS selector string for keep indicator — use in Playwright `page.locator()` */
export const KEEP_SELECTOR = DECISION_SELECTORS.keep

/** CSS selector string for eliminate indicator */
export const ELIMINATE_SELECTOR = DECISION_SELECTORS.eliminate

/** CSS selector string for dim overlay */
export const DIM_OVERLAY_SELECTOR = DECISION_SELECTORS.dimOverlay

// Re-export selectors for direct use in tests that need the raw strings
export { DECISION_SELECTORS }

// ── Assertion helpers (vitest expect-based) ─────────────────────────────────

import { expect } from 'vitest'

/** Assert element has the kept decision indicator */
export function assertDecisionKept(element: HTMLElement) {
  expect(
    element.querySelector(DECISION_SELECTORS.keep) || element.matches(DECISION_SELECTORS.keep),
    `element must have kept indicator (${DECISION_SELECTORS.keep})`
  ).toBeTruthy()
}

/** Assert element has the eliminated decision indicator */
export function assertDecisionEliminated(element: HTMLElement) {
  expect(
    element.querySelector(DECISION_SELECTORS.eliminate) || element.matches(DECISION_SELECTORS.eliminate),
    `element must have eliminated indicator (${DECISION_SELECTORS.eliminate})`
  ).toBeTruthy()
}

/** Assert element has the dim overlay */
export function assertDecisionDimmed(element: HTMLElement) {
  expect(
    element.querySelector(DECISION_SELECTORS.dimOverlay),
    `element must have dim overlay (${DECISION_SELECTORS.dimOverlay})`
  ).not.toBeNull()
}

/** Assert element does NOT have any decision indicator */
export function assertDecisionUndecided(element: HTMLElement) {
  expect(
    element.querySelector(DECISION_SELECTORS.keep) || element.matches(DECISION_SELECTORS.keep),
    `undecided element must not have kept indicator`
  ).toBeFalsy()
  expect(
    element.querySelector(DECISION_SELECTORS.eliminate) || element.matches(DECISION_SELECTORS.eliminate),
    `undecided element must not have eliminated indicator`
  ).toBeFalsy()
}

/** Assert element does NOT have dim overlay */
export function assertDecisionNotDimmed(element: HTMLElement) {
  expect(
    element.querySelector(DECISION_SELECTORS.dimOverlay),
    `element must NOT have dim overlay`
  ).toBeNull()
}

/** Assert element is NOT in the undecided state (has some decision indicator) */
export function assertDecisionNotUndecided(element: HTMLElement) {
  const hasKeep = element.querySelector(DECISION_SELECTORS.keep) || element.matches(DECISION_SELECTORS.keep)
  const hasElim = element.querySelector(DECISION_SELECTORS.eliminate) || element.matches(DECISION_SELECTORS.eliminate)
  expect(hasKeep || hasElim, 'element must show some decision indicator').toBeTruthy()
}

/**
 * Assert that a status-text element carries the marker for a given status.
 * Use for jsdom tests that check status-text styling semantically — tests
 * don't reference Tailwind color classes directly.
 */
export function assertStatusTextStyle(element: Element, status: DecisionStatus) {
  const marker = STATUS_TEXT_MARKERS[status]
  expect(
    element.classList.contains(marker),
    `status-text element must carry marker ${marker} for status=${status} (got classes: ${element.className})`,
  ).toBe(true)
}
