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

// Selectors for tests — import these instead of hardcoding strings
export const DECISION_SELECTORS = {
  keep: '.decision-keep',
  eliminate: '.decision-eliminate',
  dimOverlay: '.decision-dim-overlay',
} as const
