// Selection/focus assertion helpers for jsdom tests.
// Use these instead of hardcoding CSS class names in test assertions.
// When changing the CSS approach, only update this file + constants/selection.ts.

import { expect } from 'vitest'
import { SELECTION_SELECTORS } from '$lib/constants/selection'

/**
 * Assert that an element has the focused indicator.
 * Works by checking for the stable .selection-focused marker class.
 */
export function assertFocused(element: HTMLElement) {
  expect(
    element.querySelector(SELECTION_SELECTORS.focused) || element.matches(SELECTION_SELECTORS.focused),
    `element must have focused indicator (${SELECTION_SELECTORS.focused})`
  ).toBeTruthy()
}

/**
 * Assert that an element has the selected indicator.
 */
export function assertSelected(element: HTMLElement) {
  expect(
    element.querySelector(SELECTION_SELECTORS.selected) || element.matches(SELECTION_SELECTORS.selected),
    `element must have selected indicator (${SELECTION_SELECTORS.selected})`
  ).toBeTruthy()
}

/**
 * Assert that an element does NOT have the focused indicator.
 */
export function assertNotFocused(element: HTMLElement) {
  const hasFocused = element.querySelector(SELECTION_SELECTORS.focused) || element.matches(SELECTION_SELECTORS.focused)
  expect(
    hasFocused,
    `element must NOT have focused indicator (${SELECTION_SELECTORS.focused})`
  ).toBeFalsy()
}

/**
 * Assert that an element does NOT have the selected indicator.
 */
export function assertNotSelected(element: HTMLElement) {
  const hasSelected = element.querySelector(SELECTION_SELECTORS.selected) || element.matches(SELECTION_SELECTORS.selected)
  expect(
    hasSelected,
    `element must NOT have selected indicator (${SELECTION_SELECTORS.selected})`
  ).toBeFalsy()
}

/**
 * Assert that an element has a selection indicator (either focused or selected).
 */
export function assertHasSelectionIndicator(element: HTMLElement) {
  const hasFocused = element.querySelector(SELECTION_SELECTORS.focused) || element.matches(SELECTION_SELECTORS.focused)
  const hasSelected = element.querySelector(SELECTION_SELECTORS.selected) || element.matches(SELECTION_SELECTORS.selected)
  expect(
    hasFocused || hasSelected,
    `element must have a selection indicator (focused or selected)`
  ).toBeTruthy()
}

/**
 * Assert that an element has NO selection indicator.
 */
export function assertNoSelectionIndicator(element: HTMLElement) {
  const hasFocused = element.querySelector(SELECTION_SELECTORS.focused) || element.matches(SELECTION_SELECTORS.focused)
  const hasSelected = element.querySelector(SELECTION_SELECTORS.selected) || element.matches(SELECTION_SELECTORS.selected)
  expect(
    hasFocused || hasSelected,
    `element must NOT have any selection indicator`
  ).toBeFalsy()
}
