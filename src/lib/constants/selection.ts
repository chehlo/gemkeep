// Centralized selection/focus indicator constants.
// Tests import from here instead of hardcoding CSS class names.
// When changing the CSS approach (ring → outline, etc.), only update this file.

export const SELECTION_CLASSES = {
  focused: 'selection-focused',
  selected: 'selection-selected',
} as const

// Selectors for tests — import these instead of hardcoding strings
export const SELECTION_SELECTORS = {
  focused: '.selection-focused',
  selected: '.selection-selected',
} as const

// Computed CSS color values used by browser tests (vitest-browser-svelte).
// Maps to the actual rendered RGB values of the Tailwind classes.
export const SELECTION_COLORS = {
  focused: 'rgb(59, 130, 246)',   // Tailwind blue-500
  selected: 'rgb(234, 179, 8)',   // Tailwind yellow-500
} as const
