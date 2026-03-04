export type DecisionStatus = 'keep' | 'eliminate' | 'undecided'

export const DECISION_CLASSES = {
  keep: 'decision-keep',
  eliminate: 'decision-eliminate',
} as const

export const DECISION_BORDERS = {
  keep: 'border-4 border-green-500',
  eliminate: 'border-4 border-red-500',
} as const

export const DECISION_TEXT: Record<string, string> = {
  keep: 'KEPT',
  eliminate: 'ELIMINATED',
  undecided: 'UNDECIDED',
}

export const DECISION_TEXT_COLORS: Record<string, string> = {
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
