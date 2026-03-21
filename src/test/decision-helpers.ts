/**
 * Test helpers for querying decision indicator elements.
 * Centralizes selectors so tests don't hardcode class names.
 *
 * If we rename `.decision-keep` to `.badge-keep`, only decisions.ts
 * and this file need updating — not every test file.
 */
import { DECISION_SELECTORS } from '$lib/constants/decisions'

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

/** CSS selector for keep border */
export const KEEP_BORDER_SELECTOR = '.border-green-500'

/** CSS selector for eliminate border */
export const ELIMINATE_BORDER_SELECTOR = '.border-red-500'

// Re-export selectors for direct use in tests that need the raw strings
export { DECISION_SELECTORS }
