/**
 * Decision selector constants for E2E (Playwright) tests.
 *
 * These mirror DECISION_SELECTORS in src/lib/constants/decisions.ts.
 * If the class names change, update decisions.ts AND this file.
 *
 * Why a separate file? E2E tests run outside Vite, so $lib path aliases
 * are unavailable. This thin re-declaration keeps E2E locators centralized.
 */

export const KEEP_SELECTOR = '.decision-keep'
export const ELIMINATE_SELECTOR = '.decision-eliminate'
export const DIM_OVERLAY_SELECTOR = '.decision-dim-overlay'

// Border selectors (from DECISION_BORDERS in decisions.ts)
export const KEEP_BORDER_SELECTOR = '.border-green-500'
export const ELIMINATE_BORDER_SELECTOR = '.border-red-500'
