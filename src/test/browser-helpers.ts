// src/test/browser-helpers.ts
// Shared helpers for vitest-browser-svelte (real Chromium) test files.

import { vi } from 'vitest'

// ─── FE-11: waitForCards() ───────────────────────────────────────────────────

/**
 * Wait for a specific number of card elements to appear in the DOM.
 * Works with both StackOverview (data-stack-card) and StackFocus (data-testid="photo-card").
 *
 * @param count - expected number of cards
 * @param selector - CSS selector for the cards (default: '[data-testid="photo-card"]')
 * @param timeout - max wait time in ms (default: 5000)
 */
export async function waitForCards(
  count: number,
  selector = '[data-testid="photo-card"]',
  timeout = 5000,
): Promise<HTMLElement[]> {
  let cards: HTMLElement[] = []
  await vi.waitFor(() => {
    cards = Array.from(document.querySelectorAll(selector)) as HTMLElement[]
    if (cards.length !== count) {
      throw new Error(`Expected ${count} cards, got ${cards.length}`)
    }
  }, { timeout })
  return cards
}
