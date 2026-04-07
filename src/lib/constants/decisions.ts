import type { DecisionStatus } from '$lib/api/index.js'
export type { DecisionStatus }

export const DECISION_CLASSES = {
  keep: 'decision-keep',
  eliminate: 'decision-eliminate',
} as const

export const DECISION_TEXT: Record<DecisionStatus, string> = {
  keep: 'KEPT',
  eliminate: 'ELIMINATED',
  undecided: 'UNDECIDED',
}

export const DECISION_TEXT_COLORS: Record<DecisionStatus, string> = {
  keep: 'text-green-400',
  eliminate: 'text-red-400',
  undecided: 'text-gray-400',
}

// Stable marker classes applied to status-text elements. Tests query by
// these markers instead of the underlying Tailwind color classes, so the
// color can change without touching tests.
export const STATUS_TEXT_MARKERS: Record<DecisionStatus, string> = {
  keep: 'status-text-keep',
  eliminate: 'status-text-eliminate',
  undecided: 'status-text-undecided',
}

// Selectors for tests — import these instead of hardcoding strings
export const DECISION_SELECTORS = {
  keep: '.decision-keep',
  eliminate: '.decision-eliminate',
  dimOverlay: '.decision-dim-overlay',
} as const

// Computed CSS color values used by browser tests (vitest-browser-svelte).
// Maps to the actual rendered RGB values of the Tailwind classes currently
// used to render decision indicators.
// When changing the indicator color, only update this file.
export const DECISION_COLORS = {
  keep: 'rgb(34, 197, 94)',        // Tailwind green-500
  eliminate: 'rgb(239, 68, 68)',   // Tailwind red-500
} as const
