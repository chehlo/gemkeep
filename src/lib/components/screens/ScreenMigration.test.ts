// src/lib/components/screens/ScreenMigration.test.ts
// F4: Verify screen migration — all screens correctly delegate visual rendering to PhotoFrame.
// Tests ONLY behaviors not covered by existing SingleView, ComparisonView, StackFocus tests.
//
// Already covered elsewhere:
//   - SingleView + eliminate → red border + dim overlay (SingleView.test.ts, SingleView.browser.test.ts)
//   - StackFocus keep/eliminate borders, focus ring, selection ring (StackFocus.test.ts)
//   - ComparisonView focus ring on left/right panels (ComparisonView.test.ts)

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/svelte'
import { invoke } from '@tauri-apps/api/core'
import { navigate } from '$lib/stores/navigation.svelte.js'
import {
  PHOTO_1, PHOTO_2, PHOTO_3,
  makePhotoDetail, makeDecisionList,
  OPEN_ROUND, UNDECIDED_DECISIONS,
} from '$test/fixtures'
import { resetInvokeMock, mockSingleViewMount, mockStackFocusMount, mockStackFocusRouter } from '$test/helpers'
import { makeRoundSummary, makeRoundStatus } from '$test/fixtures'
import { DECISION_SELECTORS, assertDecisionKept, assertDecisionEliminated, assertDecisionDimmed, assertDecisionUndecided, queryKeepIndicator, queryEliminateIndicator, queryDimOverlay } from '$test/decision-helpers'
import { assertFocused, assertNotFocused, assertNotSelected, assertSelected, assertNoSelectionIndicator } from '$test/selection-helpers'
import SingleView from './SingleView.svelte'
import ComparisonView from './ComparisonView.svelte'
import StackFocus from './StackFocus.svelte'

const mockInvoke = vi.mocked(invoke)

/** Get the className of the PhotoFrame element */
function frameClass(container: Element): string {
  return container.querySelector('[data-testid="photo-frame"]')?.className ?? ''
}

// ─── SingleView gap coverage ──────────────────────────────────────────────────

describe('F4-SV: SingleView visual delegation to PhotoFrame', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    navigate({ kind: 'single-view', projectSlug: 'test-project', projectName: 'Test', stackId: 1, photoId: 1 })
  })

  it('keep status propagates kept decision indicator to PhotoFrame', async () => {
    mockSingleViewMount({
      detail: makePhotoDetail({ current_status: 'keep' }),
      decisions: makeDecisionList(['keep', 'undecided', 'undecided']),
    })
    render(SingleView)

    await waitFor(() => {
      const frame = document.querySelector('[data-testid="photo-frame"]') as HTMLElement
      expect(frame).not.toBeNull()
      assertDecisionKept(frame)
    })
  })

  it('undecided status propagates undecided state to PhotoFrame without decision markers', async () => {
    mockSingleViewMount({
      detail: makePhotoDetail({ current_status: 'undecided' }),
    })
    render(SingleView)

    await waitFor(() => {
      const frame = document.querySelector('[data-testid="photo-frame"]') as HTMLElement
      expect(frame).not.toBeNull()
      assertDecisionUndecided(frame)
    })
  })

  it('SingleView does not pass focused/selected → no ring classes on PhotoFrame', async () => {
    mockSingleViewMount()
    render(SingleView)

    await waitFor(() => {
      const frame = document.querySelector('[data-testid="photo-frame"]') as HTMLElement
      expect(frame).not.toBeNull()
      // SingleView never passes focused or selected props
      assertNoSelectionIndicator(frame)
    })
  })
})

// ─── ComparisonView gap coverage ──────────────────────────────────────────────

function mockComparisonMount(
  photos = [PHOTO_1, PHOTO_2, PHOTO_3],
  decisions = UNDECIDED_DECISIONS,
  roundStatus = OPEN_ROUND,
) {
  mockInvoke.mockResolvedValueOnce(photos)       // list_logical_photos
  mockInvoke.mockResolvedValueOnce(decisions)     // get_round_decisions
  mockInvoke.mockResolvedValueOnce(roundStatus)   // get_round_status
}

describe('F4-CV: ComparisonView visual delegation to PhotoFrame', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetInvokeMock()
    navigate({ kind: 'comparison-view', projectSlug: 'test-project', stackId: 1, projectName: 'Test' })
  })

  it('left focused + keep propagates focus indicator and kept decision indicator to PhotoFrame', async () => {
    // All photos already decided → ComparisonView falls back to default indices (0, 1)
    mockComparisonMount(
      [PHOTO_1, PHOTO_2, PHOTO_3],
      makeDecisionList(['keep', 'eliminate', 'keep']),
      { ...OPEN_ROUND, decided: 3, kept: 2, eliminated: 1, undecided: 0 },
    )
    render(ComparisonView)

    await waitFor(() => {
      const left = screen.getByTestId('comparison-left')
      const frame = left.querySelector('[data-testid="photo-frame"]') as HTMLElement
      assertFocused(frame)
      assertDecisionKept(frame)
    })
  })

  it('right focused + eliminate propagates focus indicator and eliminated decision indicator with dim overlay', async () => {
    // All decided → default indices: left=0 (keep), right=1 (eliminate)
    mockComparisonMount(
      [PHOTO_1, PHOTO_2, PHOTO_3],
      makeDecisionList(['keep', 'eliminate', 'keep']),
      { ...OPEN_ROUND, decided: 3, kept: 2, eliminated: 1, undecided: 0 },
    )
    render(ComparisonView)

    await waitFor(() => screen.getByTestId('comparison-right'))

    // Move focus to right panel
    await fireEvent.keyDown(document, { key: 'ArrowRight' })

    await waitFor(() => {
      const right = screen.getByTestId('comparison-right')
      const frame = right.querySelector('[data-testid="photo-frame"]') as HTMLElement
      assertFocused(frame)
      assertDecisionEliminated(frame)
      assertDecisionDimmed(frame)
    })
  })

  it('ComparisonView does not pass selected → no selection indicator on any panel', async () => {
    mockComparisonMount()
    render(ComparisonView)

    await waitFor(() => {
      const left = screen.getByTestId('comparison-left')
      const right = screen.getByTestId('comparison-right')
      const leftFrame = left.querySelector('[data-testid="photo-frame"]') as HTMLElement
      const rightFrame = right.querySelector('[data-testid="photo-frame"]') as HTMLElement
      // Neither panel should have selection ring
      assertNotSelected(leftFrame)
      assertNotSelected(rightFrame)
    })
  })
})

// ─── StackFocus gap coverage ──────────────────────────────────────────────────

const mockPhotos = [PHOTO_1, PHOTO_2, PHOTO_3]

describe('F4-SF: StackFocus visual delegation to PhotoFrame', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetInvokeMock()
    navigate({ kind: 'stack-focus', projectSlug: 'test-project', projectName: 'Test', stackId: 1 })
  })

  it('mixed statuses propagate correct decision classes to each card PhotoFrame', async () => {
    // Use committed round so eliminated photos are visible in the grid
    const committedRound = makeRoundStatus({
      round_id: 1, round_number: 1, state: 'committed',
      total_photos: 3, decided: 2, kept: 1, eliminated: 1, undecided: 1,
      committed_at: '2024-01-15T12:00:00Z',
    })
    mockInvoke.mockImplementation(mockStackFocusRouter({
      list_logical_photos: [mockPhotos],
      get_round_decisions: [makeDecisionList(['keep', 'eliminate', 'undecided'])],
      get_round_status: committedRound,
      list_rounds: [[
        makeRoundSummary({ round_id: 1, round_number: 1, state: 'committed', committed_at: '2024-01-15T12:00:00Z' }),
        makeRoundSummary({ round_id: 2, round_number: 2, state: 'open' }),
      ]],
    }))
    render(StackFocus)

    await waitFor(() => {
      const cards = screen.getAllByTestId('photo-card')
      expect(cards).toHaveLength(3)

      // Card 0: keep
      const frame0 = cards[0].querySelector('[data-testid="photo-frame"]') as HTMLElement
      assertDecisionKept(frame0)

      // Card 1: eliminate
      const frame1 = cards[1].querySelector('[data-testid="photo-frame"]') as HTMLElement
      assertDecisionEliminated(frame1)

      // Card 2: undecided
      const frame2 = cards[2].querySelector('[data-testid="photo-frame"]') as HTMLElement
      assertDecisionUndecided(frame2)
    })
  })

  it('focused + selected + keep propagates selection indicator and kept decision indicator together', async () => {
    // Photo 1 is kept; focusedIndex defaults to 0; we'll select it too
    mockStackFocusMount(
      mockPhotos,
      makeDecisionList(['keep', 'undecided', 'undecided']),
      { ...OPEN_ROUND, decided: 1, kept: 1, undecided: 2 },
    )
    render(StackFocus)

    await waitFor(() => {
      const cards = screen.getAllByTestId('photo-card')
      // Focus is on card 0 by default
      const frame0 = cards[0].querySelector('[data-testid="photo-frame"]') as HTMLElement
      assertFocused(frame0)
    })

    // Select the focused card with 's' key
    await fireEvent.keyDown(document, { key: 's' })

    await waitFor(() => {
      const cards = screen.getAllByTestId('photo-card')
      const frame0 = cards[0].querySelector('[data-testid="photo-frame"]') as HTMLElement
      // Selected takes priority for ring: selected indicator (not focused)
      assertSelected(frame0)
      // Decision indicator coexists with selection ring
      assertDecisionKept(frame0)
    })
  })
})

// ─── Cross-screen: visual classes live inside PhotoFrame only ─────────────────

describe('F4-X: No screen applies decision/ring visual classes outside PhotoFrame', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetInvokeMock()
  })

  it('SingleView: keep decision indicator only appears inside photo-frame', async () => {
    navigate({ kind: 'single-view', projectSlug: 'test-project', projectName: 'Test', stackId: 1, photoId: 1 })
    mockSingleViewMount({
      detail: makePhotoDetail({ current_status: 'keep' }),
      decisions: makeDecisionList(['keep', 'undecided', 'undecided']),
    })
    render(SingleView)

    await waitFor(() => {
      const frame = document.querySelector('[data-testid="photo-frame"]')
      expect(frame).not.toBeNull()
    })

    // All keep indicator elements must be inside a photo-frame
    const keepElements = document.querySelectorAll(DECISION_SELECTORS.keep)
    for (const el of keepElements) {
      expect(el.closest('[data-testid="photo-frame"]')).not.toBeNull()
    }
  })

  it('StackFocus: focus indicator and decision classes only appear inside photo-frame', async () => {
    navigate({ kind: 'stack-focus', projectSlug: 'test-project', projectName: 'Test', stackId: 1 })
    // Use committed round so all decision badges (including eliminate) are visible
    const committedRound = makeRoundStatus({
      round_id: 1, round_number: 1, state: 'committed',
      total_photos: 3, decided: 2, kept: 1, eliminated: 1, undecided: 1,
      committed_at: '2024-01-15T12:00:00Z',
    })
    mockInvoke.mockImplementation(mockStackFocusRouter({
      list_logical_photos: [mockPhotos],
      get_round_decisions: [makeDecisionList(['keep', 'eliminate', 'undecided'])],
      get_round_status: committedRound,
      list_rounds: [[
        makeRoundSummary({ round_id: 1, round_number: 1, state: 'committed', committed_at: '2024-01-15T12:00:00Z' }),
        makeRoundSummary({ round_id: 2, round_number: 2, state: 'open' }),
      ]],
    }))
    render(StackFocus)

    await waitFor(() => {
      expect(screen.getAllByTestId('photo-card')).toHaveLength(3)
    })

    // All visual indicator classes must be inside photo-frame
    const ringElements = document.querySelectorAll('.selection-focused')
    for (const el of ringElements) {
      expect(el.closest('[data-testid="photo-frame"]')).not.toBeNull()
    }

    const keepElements = document.querySelectorAll('.decision-keep')
    for (const el of keepElements) {
      expect(el.closest('[data-testid="photo-frame"]')).not.toBeNull()
    }

    const eliminateElements = document.querySelectorAll('.decision-eliminate')
    for (const el of eliminateElements) {
      expect(el.closest('[data-testid="photo-frame"]')).not.toBeNull()
    }
  })
})
