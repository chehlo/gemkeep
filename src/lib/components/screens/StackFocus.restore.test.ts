// src/lib/components/screens/StackFocus.restore.test.ts
// F4: Restore eliminated photo — StackFocus keyboard + badge tests.
// Tests the R key behavior and restore badge display.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/svelte'
import { invoke } from '@tauri-apps/api/core'
import { navigate } from '$lib/stores/navigation.svelte.js'
import { PHOTO_1, PHOTO_2, PHOTO_3, makeRoundStatus, OPEN_ROUND, ROUND_1_COMMITTED, makeDecisionList } from '$test/fixtures'
import { mockStackFocusRouter } from '$test/helpers'
import StackFocus from './StackFocus.svelte'

const mockInvoke = vi.mocked(invoke)

const mockPhotos = [PHOTO_1, PHOTO_2, PHOTO_3]

function setupNav() {
  navigate({ kind: 'stack-focus', projectSlug: 'test-project', projectName: 'Test Project', stackId: 1 })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockInvoke.mockImplementation(mockStackFocusRouter())
  setupNav()
})

describe('StackFocus — F4: R key restore behavior (current round)', () => {
  it('R key on eliminated photo calls restore', async () => {
    // In the open round grid, eliminated photos remain visible.
    // R key on focused eliminated photo triggers restore.
    const decisions = makeDecisionList(['eliminate', 'undecided', 'undecided'])
    const roundStatus = makeRoundStatus({
      round_id: 2, round_number: 2, state: 'open',
      total_photos: 3, decided: 1, kept: 0, eliminated: 1, undecided: 2,
    })

    mockInvoke.mockImplementation(mockStackFocusRouter({
      list_logical_photos: [mockPhotos],
      get_round_decisions: [decisions, makeDecisionList(['undecided', 'undecided', 'undecided'])],
      get_round_status: [roundStatus, makeRoundStatus({
        round_id: 2, round_number: 2, state: 'open',
        total_photos: 3, decided: 0, kept: 0, eliminated: 0, undecided: 3,
      })],
      restore_eliminated_photo: { restored: true, logical_photo_id: 1, round_id: 2 },
    }))

    render(StackFocus)

    // All 3 photos visible (eliminated photo stays in grid)
    await waitFor(() => {
      expect(screen.getAllByTestId('photo-card')).toHaveLength(3)
    })

    // Press R — focused photo is eliminated, so restore is called
    await fireEvent.keyDown(document, { key: 'r' })

    await waitFor(() => {
      const calls = mockInvoke.mock.calls.filter(([cmd]) => cmd === 'restore_eliminated_photo')
      expect(calls).toHaveLength(1)
    })
  })

  it('R key on undecided photo is a no-op (no restore call)', async () => {
    const decisions = makeDecisionList(['undecided', 'undecided', 'undecided'])

    mockInvoke.mockImplementation(mockStackFocusRouter({
      list_logical_photos: [mockPhotos],
      get_round_decisions: [decisions],
      get_round_status: OPEN_ROUND,
    }))

    render(StackFocus)

    await waitFor(() => {
      expect(screen.getAllByTestId('photo-card')).toHaveLength(3)
    })

    await fireEvent.keyDown(document, { key: 'r' })

    // Allow microtask queue to flush
    await new Promise(r => setTimeout(r, 50))

    const restoreCalls = mockInvoke.mock.calls.filter(([cmd]) => cmd === 'restore_eliminated_photo')
    expect(restoreCalls).toHaveLength(0)
  })

  it('R key on kept photo is a no-op (no restore call)', async () => {
    const decisions = makeDecisionList(['keep', 'undecided', 'undecided'])
    const roundStatus = makeRoundStatus({
      total_photos: 3, decided: 1, kept: 1, eliminated: 0, undecided: 2,
    })

    mockInvoke.mockImplementation(mockStackFocusRouter({
      list_logical_photos: [mockPhotos],
      get_round_decisions: [decisions],
      get_round_status: roundStatus,
    }))

    render(StackFocus)

    await waitFor(() => {
      expect(screen.getAllByTestId('photo-card')).toHaveLength(3)
    })

    await fireEvent.keyDown(document, { key: 'r' })

    await new Promise(r => setTimeout(r, 50))

    const restoreCalls = mockInvoke.mock.calls.filter(([cmd]) => cmd === 'restore_eliminated_photo')
    expect(restoreCalls).toHaveLength(0)
  })
})

describe('StackFocus — F4: R key in historical (committed) round', () => {
  it('R key is disabled in historical round view (no restore call)', async () => {
    const decisions = makeDecisionList(['eliminate', 'keep', 'keep'])
    const committedRound = makeRoundStatus({
      round_id: 1, round_number: 1, state: 'committed',
      total_photos: 3, decided: 3, kept: 2, eliminated: 1, undecided: 0,
      committed_at: '2024-01-15T12:00:00Z',
    })

    mockInvoke.mockImplementation(mockStackFocusRouter({
      list_logical_photos: [mockPhotos],
      get_round_decisions: [decisions],
      get_round_status: committedRound,
    }))

    render(StackFocus)

    await waitFor(() => {
      expect(screen.getAllByTestId('photo-card')).toHaveLength(3)
    })

    await fireEvent.keyDown(document, { key: 'r' })

    await new Promise(r => setTimeout(r, 50))

    const restoreCalls = mockInvoke.mock.calls.filter(([cmd]) => cmd === 'restore_eliminated_photo')
    expect(restoreCalls).toHaveLength(0)
  })
})

describe('StackFocus — F4: restore badge display', () => {
  it('eliminated photo in open round grid shows eliminate status', async () => {
    // In open round, eliminated photos stay in grid with their status visible.
    const decisions = makeDecisionList(['eliminate', 'undecided', 'undecided'])
    const roundStatus = makeRoundStatus({
      round_id: 2, round_number: 2, state: 'open',
      total_photos: 3, decided: 1, kept: 0, eliminated: 1, undecided: 2,
    })

    mockInvoke.mockImplementation(mockStackFocusRouter({
      list_logical_photos: [mockPhotos],
      get_round_decisions: [decisions],
      get_round_status: roundStatus,
    }))

    render(StackFocus)

    await waitFor(() => {
      // All 3 photos visible (eliminated stays in grid)
      expect(screen.getAllByTestId('photo-card')).toHaveLength(3)
    })
  })
})
