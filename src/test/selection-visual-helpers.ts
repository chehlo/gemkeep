// Selection/focus visual assertion helpers for browser tests (real Chromium).
//
// Pixel-truth semantics: these helpers read actual rendered pixels via
// page.screenshot(), so they verify what the user ACTUALLY sees after the
// browser's paint + composite + clip pipeline. A CSS property being set is
// not sufficient — the pixels must survive to the display.
//
// All helpers are async. Tests must `await` each assertion.
//
// For jsdom tests, use `selection-helpers.ts` instead (marker class checks).

import { vi } from 'vitest'
import { SELECTION_COLORS, SELECTION_SELECTORS } from '$lib/constants/selection'
import { resolveMarker } from './visual-channel'
import {
  assertColorVisibleInElementArea,
  assertColorNotVisibleInElementArea,
} from './pixel-verifier'

function resolveFocusTarget(el: HTMLElement): HTMLElement {
  return resolveMarker(el, SELECTION_SELECTORS.focused) ?? el
}
function resolveSelectedTarget(el: HTMLElement): HTMLElement {
  return resolveMarker(el, SELECTION_SELECTORS.selected) ?? el
}

/** Assert that the focus indicator color is visible in the element's pixels. */
export async function assertVisuallyFocused(element: HTMLElement) {
  await assertColorVisibleInElementArea(
    resolveFocusTarget(element),
    SELECTION_COLORS.focused,
  )
}

/** Assert that the selection indicator color is visible in the element's pixels. */
export async function assertVisuallySelected(element: HTMLElement) {
  await assertColorVisibleInElementArea(
    resolveSelectedTarget(element),
    SELECTION_COLORS.selected,
  )
}

/** Assert that the focus indicator color is NOT visible in the element's pixels. */
export async function assertNotVisuallyFocused(element: HTMLElement) {
  await assertColorNotVisibleInElementArea(
    resolveFocusTarget(element),
    SELECTION_COLORS.focused,
  )
}

/** Assert that the selection indicator color is NOT visible in the element's pixels. */
export async function assertNotVisuallySelected(element: HTMLElement) {
  await assertColorNotVisibleInElementArea(
    resolveSelectedTarget(element),
    SELECTION_COLORS.selected,
  )
}

/** Wait for the focus indicator color to appear in the element's pixels. */
export async function waitForVisualFocus(element: HTMLElement, timeout = 3000) {
  await vi.waitFor(
    () => assertVisuallyFocused(element),
    { timeout },
  )
}

/** Wait for the selection indicator color to appear in the element's pixels. */
export async function waitForVisualSelection(element: HTMLElement, timeout = 3000) {
  await vi.waitFor(
    () => assertVisuallySelected(element),
    { timeout },
  )
}

/** Count how many elements in a collection show the selection color. */
export async function countVisuallySelected(elements: Iterable<HTMLElement>): Promise<number> {
  let n = 0
  for (const el of elements) {
    try {
      await assertVisuallySelected(el)
      n++
    } catch {
      // not visually selected
    }
  }
  return n
}

/** Wait until at least `n` elements in the collection show the selection color. */
export async function waitForSelectionCount(
  elements: () => Iterable<HTMLElement>,
  atLeast: number,
  timeout = 3000,
) {
  await vi.waitFor(async () => {
    const count = await countVisuallySelected(elements())
    if (count < atLeast) {
      throw new Error(`Waiting for selection count >= ${atLeast}, got ${count}`)
    }
  }, { timeout })
}
