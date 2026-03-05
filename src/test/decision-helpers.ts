/**
 * Test helpers for querying decision indicator elements.
 * Centralizes selectors so tests don't hardcode class names.
 *
 * If we rename `.decision-keep` to `.badge-keep`, only decisions.ts
 * and this file need updating — not every test file.
 */
import { DECISION_SELECTORS, DECISION_BORDERS } from '$lib/constants/decisions'

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

// Border class selectors derived from DECISION_BORDERS
// e.g. '.border-green-500' from 'border-4 border-green-500'
function borderSelector(borderClasses: string): string {
  const colorClass = borderClasses.split(' ').find(c => c.startsWith('border-') && c !== 'border-4')
  return `.${colorClass}`
}

/** CSS selector for keep border (e.g. '.border-green-500') */
export const KEEP_BORDER_SELECTOR = borderSelector(DECISION_BORDERS.keep)

/** CSS selector for eliminate border (e.g. '.border-red-500') */
export const ELIMINATE_BORDER_SELECTOR = borderSelector(DECISION_BORDERS.eliminate)

// Re-export selectors for direct use in tests that need the raw strings
export { DECISION_SELECTORS }
