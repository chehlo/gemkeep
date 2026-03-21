// src/lib/utils/decisions.test.ts
// RED tests for DUP-06 (findNextUndecided) and DUP-07 (handleDecisionKey)

import { describe, it, expect, beforeEach } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import { vi } from 'vitest'
import { findNextUndecided, handleDecisionKey } from '$lib/utils/decisions'
import { makePhoto, makeDecisionList, makeRoundStatus, makeDecisionResult } from '$test/fixtures'
import { resetInvokeMock } from '$test/helpers'

const mockInvoke = vi.mocked(invoke)

// ─── findNextUndecided ──────────────────────────────────────────────────────

describe('findNextUndecided', () => {
  const photos = [
    makePhoto({ logical_photo_id: 1 }),
    makePhoto({ logical_photo_id: 2 }),
    makePhoto({ logical_photo_id: 3 }),
    makePhoto({ logical_photo_id: 4 }),
    makePhoto({ logical_photo_id: 5 }),
  ]

  it('returns index of next undecided photo after currentIndex', () => {
    // Photos 1,2 are decided; 3 is undecided
    const decisions = makeDecisionList(['keep', 'eliminate', 'undecided', 'undecided', 'undecided'])
    const result = findNextUndecided(0, photos, decisions, 'next')
    expect(result).toBe(2)
  })

  it('skips decided photos (keep and eliminate)', () => {
    // Current at 0; photos 1,2,3 decided; 4 undecided
    const decisions = makeDecisionList(['undecided', 'keep', 'eliminate', 'keep', 'undecided'])
    const result = findNextUndecided(0, photos, decisions, 'next')
    expect(result).toBe(4)
  })

  it('wraps from last to first (circular forward)', () => {
    // Current at 3; photo 5 decided; photo 1 undecided
    const decisions = makeDecisionList(['undecided', 'keep', 'keep', 'keep', 'eliminate'])
    const result = findNextUndecided(3, photos, decisions, 'next')
    expect(result).toBe(0)
  })

  it('returns currentIndex if all photos are decided', () => {
    const decisions = makeDecisionList(['keep', 'eliminate', 'keep', 'eliminate', 'keep'])
    const result = findNextUndecided(2, photos, decisions, 'next')
    expect(result).toBe(2)
  })

  it('navigates backward with prev direction', () => {
    // Current at 3; photos 3,2 decided; photo 1 (index 1) undecided
    const decisions = makeDecisionList(['keep', 'undecided', 'eliminate', 'keep', 'undecided'])
    const result = findNextUndecided(3, photos, decisions, 'prev')
    expect(result).toBe(1)
  })

  it('wraps backward from first to last', () => {
    // Current at 1; photo 0 decided; photo 4 undecided
    const decisions = makeDecisionList(['keep', 'undecided', 'keep', 'keep', 'undecided'])
    const result = findNextUndecided(1, photos, decisions, 'prev')
    expect(result).toBe(4)
  })

  it('treats photos with no decision entry as undecided', () => {
    // Only photo 1 has a decision (keep); photo 2 has no entry → undecided
    const decisions = makeDecisionList(['keep'])
    const result = findNextUndecided(0, photos, decisions, 'next')
    expect(result).toBe(1)
  })

  it('returns next undecided skipping current even if current is undecided', () => {
    // All undecided — should move to next, not stay
    const decisions = makeDecisionList(['undecided', 'undecided', 'undecided', 'undecided', 'undecided'])
    const result = findNextUndecided(2, photos, decisions, 'next')
    expect(result).toBe(3)
  })
})

// ─── handleDecisionKey ──────────────────────────────────────────────────────

describe('handleDecisionKey', () => {
  beforeEach(() => {
    resetInvokeMock()
  })

  it('keep action calls makeDecision with correct args and returns roundStatus', async () => {
    const decisionResult = makeDecisionResult({ action: 'keep', current_status: 'keep' })
    const roundStatus = makeRoundStatus({ decided: 1, kept: 1, undecided: 2 })
    mockInvoke.mockResolvedValueOnce(decisionResult) // make_decision
    mockInvoke.mockResolvedValueOnce(roundStatus)    // get_round_status

    const result = await handleDecisionKey('my-project', 42, 7, 'keep')

    expect(mockInvoke).toHaveBeenCalledWith('make_decision', {
      slug: 'my-project',
      logicalPhotoId: 42,
      action: 'keep',
    })
    expect(mockInvoke).toHaveBeenCalledWith('get_round_status', {
      slug: 'my-project',
      stackId: 7,
    })
    expect(result.roundStatus).toEqual(roundStatus)
  })

  it('eliminate action calls makeDecision with eliminate and returns roundStatus', async () => {
    const decisionResult = makeDecisionResult({ action: 'eliminate', current_status: 'eliminate' })
    const roundStatus = makeRoundStatus({ decided: 1, eliminated: 1, undecided: 2 })
    mockInvoke.mockResolvedValueOnce(decisionResult) // make_decision
    mockInvoke.mockResolvedValueOnce(roundStatus)    // get_round_status

    const result = await handleDecisionKey('my-project', 42, 7, 'eliminate')

    expect(mockInvoke).toHaveBeenCalledWith('make_decision', {
      slug: 'my-project',
      logicalPhotoId: 42,
      action: 'eliminate',
    })
    expect(result.roundStatus).toEqual(roundStatus)
  })

  it('undo action calls undoDecision and returns roundStatus', async () => {
    const roundStatus = makeRoundStatus({ decided: 0, undecided: 3 })
    mockInvoke.mockResolvedValueOnce(undefined)    // undo_decision
    mockInvoke.mockResolvedValueOnce(roundStatus)  // get_round_status

    const result = await handleDecisionKey('my-project', 42, 7, 'undo')

    expect(mockInvoke).toHaveBeenCalledWith('undo_decision', {
      slug: 'my-project',
      logicalPhotoId: 42,
    })
    expect(mockInvoke).toHaveBeenCalledWith('get_round_status', {
      slug: 'my-project',
      stackId: 7,
    })
    expect(result.roundStatus).toEqual(roundStatus)
  })
})
