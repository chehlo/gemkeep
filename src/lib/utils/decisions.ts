import { invoke } from '@tauri-apps/api/core'
import type { LogicalPhotoSummary, PhotoDecisionStatus, RoundStatus } from '$lib/api/index.js'

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

export interface HandleDecisionKeyResult {
  roundStatus: RoundStatus
}

/**
 * Execute a decision action (keep/eliminate/undo) via IPC and return updated round status.
 */
export async function handleDecisionKey(
  slug: string,
  photoId: number,
  stackId: number,
  action: DecisionKeyAction,
): Promise<HandleDecisionKeyResult> {
  if (action === 'undo') {
    await invoke('undo_decision', { slug, logicalPhotoId: photoId })
  } else {
    await invoke('make_decision', { slug, logicalPhotoId: photoId, action })
  }

  const roundStatus = await invoke<RoundStatus>('get_round_status', { slug, stackId })
  return { roundStatus }
}
