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
import { resetInvokeMock, mockSingleViewMount, mockStackFocusMount } from '$test/helpers'
import { DECISION_SELECTORS } from '$test/decision-helpers'
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

  it('keep status propagates decision-keep and border-green-500 classes to PhotoFrame', async () => {
    mockSingleViewMount({
      detail: makePhotoDetail({ current_status: 'keep' }),
      decisions: makeDecisionList(['keep', 'undecided', 'undecided']),
    })
    render(SingleView)

    await waitFor(() => {
      const frame = document.querySelector('[data-testid="photo-frame"]')
      expect(frame).not.toBeNull()
      expect(frame!.className).toContain('decision-keep')
      expect(frame!.className).toContain('border-green-500')
    })
  })

  it('undecided status propagates border-gray-700 class to PhotoFrame without decision markers', async () => {
    mockSingleViewMount({
      detail: makePhotoDetail({ current_status: 'undecided' }),
    })
    render(SingleView)

    await waitFor(() => {
      const frame = document.querySelector('[data-testid="photo-frame"]')
      expect(frame).not.toBeNull()
      expect(frame!.className).toContain('border-gray-700')
      expect(frame!.className).not.toContain('decision-keep')
      expect(frame!.className).not.toContain('decision-eliminate')
    })
  })

  it('SingleView does not pass focused/selected → no ring classes on PhotoFrame', async () => {
    mockSingleViewMount()
    render(SingleView)

    await waitFor(() => {
      const frame = document.querySelector('[data-testid="photo-frame"]')
      expect(frame).not.toBeNull()
      // SingleView never passes focused or selected props
      expect(frame!.className).not.toContain('ring-blue-500')
      expect(frame!.className).not.toContain('ring-yellow-500')
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
  mockInvoke.mockResolvedValueOnce(decisions)     // get_stack_decisions
  mockInvoke.mockResolvedValueOnce(roundStatus)   // get_round_status
}

describe('F4-CV: ComparisonView visual delegation to PhotoFrame', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetInvokeMock()
    navigate({ kind: 'comparison-view', projectSlug: 'test-project', stackId: 1, projectName: 'Test' })
  })

  it('left focused + keep propagates ring-blue-500 and decision-keep classes to PhotoFrame', async () => {
    // All photos already decided → ComparisonView falls back to default indices (0, 1)
    mockComparisonMount(
      [PHOTO_1, PHOTO_2, PHOTO_3],
      makeDecisionList(['keep', 'eliminate', 'keep']),
      { ...OPEN_ROUND, decided: 3, kept: 2, eliminated: 1, undecided: 0 },
    )
    render(ComparisonView)

    await waitFor(() => {
      const left = screen.getByTestId('comparison-left')
      const cls = frameClass(left)
      expect(cls).toContain('ring-blue-500')
      expect(cls).toContain('decision-keep')
      expect(cls).toContain('border-green-500')
    })
  })

  it('right focused + eliminate propagates ring-blue-500 and decision-eliminate classes with dim overlay element', async () => {
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
      const cls = frameClass(right)
      expect(cls).toContain('ring-blue-500')
      expect(cls).toContain('decision-eliminate')
      expect(cls).toContain('border-red-500')
      // Dim overlay should be inside the frame
      const dimOverlay = right.querySelector(DECISION_SELECTORS.dimOverlay)
      expect(dimOverlay).not.toBeNull()
    })
  })

  it('ComparisonView does not pass selected → no ring-yellow-500 on any panel', async () => {
    mockComparisonMount()
    render(ComparisonView)

    await waitFor(() => {
      const left = screen.getByTestId('comparison-left')
      const right = screen.getByTestId('comparison-right')
      // Neither panel should have selection ring
      expect(frameClass(left)).not.toContain('ring-yellow-500')
      expect(frameClass(right)).not.toContain('ring-yellow-500')
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
    mockStackFocusMount(
      mockPhotos,
      makeDecisionList(['keep', 'eliminate', 'undecided']),
      { ...OPEN_ROUND, decided: 2, kept: 1, eliminated: 1, undecided: 1 },
    )
    render(StackFocus)

    await waitFor(() => {
      const cards = screen.getAllByTestId('photo-card')
      expect(cards).toHaveLength(3)

      // Card 0: keep
      expect(frameClass(cards[0])).toContain('decision-keep')
      expect(frameClass(cards[0])).toContain('border-green-500')

      // Card 1: eliminate
      expect(frameClass(cards[1])).toContain('decision-eliminate')
      expect(frameClass(cards[1])).toContain('border-red-500')

      // Card 2: undecided
      expect(frameClass(cards[2])).toContain('border-gray-700')
      expect(frameClass(cards[2])).not.toContain('decision-keep')
      expect(frameClass(cards[2])).not.toContain('decision-eliminate')
    })
  })

  it('focused + selected + keep propagates ring-yellow-500 and border-green-500 classes together', async () => {
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
      expect(frameClass(cards[0])).toContain('ring-blue-500')
    })

    // Select the focused card with 's' key
    await fireEvent.keyDown(document, { key: 's' })

    await waitFor(() => {
      const cards = screen.getAllByTestId('photo-card')
      const cls = frameClass(cards[0])
      // Selected takes priority for ring: ring-yellow-500 (not ring-blue-500)
      expect(cls).toContain('ring-yellow-500')
      // Decision border: border-green-500 coexists with selection ring
      expect(cls).toContain('border-green-500')
      expect(cls).toContain('decision-keep')
    })
  })
})

// ─── Cross-screen: visual classes live inside PhotoFrame only ─────────────────

describe('F4-X: No screen applies decision/ring visual classes outside PhotoFrame', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetInvokeMock()
  })

  it('SingleView: border-green-500 only appears inside photo-frame', async () => {
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

    // All border-green-500 elements must be inside a photo-frame
    const greenBorders = document.querySelectorAll('.border-green-500')
    for (const el of greenBorders) {
      expect(el.closest('[data-testid="photo-frame"]')).not.toBeNull()
    }
  })

  it('StackFocus: ring-blue-500 and decision classes only appear inside photo-frame', async () => {
    navigate({ kind: 'stack-focus', projectSlug: 'test-project', projectName: 'Test', stackId: 1 })
    mockStackFocusMount(
      mockPhotos,
      makeDecisionList(['keep', 'eliminate', 'undecided']),
      { ...OPEN_ROUND, decided: 2, kept: 1, eliminated: 1, undecided: 1 },
    )
    render(StackFocus)

    await waitFor(() => {
      expect(screen.getAllByTestId('photo-card')).toHaveLength(3)
    })

    // All visual indicator classes must be inside photo-frame
    const ringElements = document.querySelectorAll('.ring-blue-500')
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
