import {
  makeDecision, undoDecision, getRoundStatus,
  type LogicalPhotoSummary, type PhotoDecisionStatus, type RoundStatus, type DecisionStatus
} from '$lib/api/index.js'
import { updateDecisionState } from '$lib/utils/photos.js'

export type NavigationDirection = 'next' | 'prev'

/**
 * Find the index of the next undecided photo in the given direction.
 * Wraps circularly. Returns currentIndex if all photos are decided.
 */
export function findNextUndecided(
  currentIndex: number,
  photos: LogicalPhotoSummary[],
  decisions: PhotoDecisionStatus[],
  direction: NavigationDirection,
): number {
  const len = photos.length
  if (len === 0) return currentIndex

  const step = direction === 'next' ? 1 : -1

  for (let i = 1; i <= len; i++) {
    const idx = ((currentIndex + step * i) % len + len) % len
    const photo = photos[idx]
    const decision = decisions.find(d => d.logical_photo_id === photo.logical_photo_id)
    if (!decision || decision.current_status === 'undecided') {
      return idx
    }
  }

  return currentIndex
}

export type DecisionKeyAction = 'keep' | 'eliminate' | 'undo'

export interface HandleDecisionKeyCallbacks {
  /** Called after decision state is updated locally. Screen can do auto-advance, update currentPhoto, etc. */
  onDecisionApplied?: (photoId: number, status: DecisionStatus) => void
  /** Called when the decision API call fails. Screen can show an error message. */
  onError?: (err: unknown) => void
}

export interface HandleDecisionKeyResult {
  roundStatus: RoundStatus
  decisions: PhotoDecisionStatus[]
}

/**
 * Execute a decision action (keep/eliminate/undo) via the API layer,
 * update local decision state, refresh round status, and invoke screen-specific callbacks.
 *
 * Routes through src/lib/api/index.ts — never raw invoke().
 */
export async function handleDecisionKey(
  slug: string,
  photoId: number,
  stackId: number,
  action: DecisionKeyAction,
  currentDecisions: PhotoDecisionStatus[],
  callbacks?: HandleDecisionKeyCallbacks,
): Promise<HandleDecisionKeyResult | null> {
  const status: DecisionStatus = action === 'undo' ? 'undecided' : action === 'keep' ? 'keep' : 'eliminate'

  try {
    if (action === 'undo') {
      await undoDecision(slug, photoId)
    } else {
      await makeDecision(slug, photoId, action)
    }

    const newDecisions = updateDecisionState(currentDecisions, photoId, status)
    const roundStatus = await getRoundStatus(slug, stackId)

    callbacks?.onDecisionApplied?.(photoId, status)

    return { roundStatus, decisions: newDecisions }
  } catch (err) {
    console.error('makeDecision failed:', err)
    callbacks?.onError?.(err)
    return null
  }
}
