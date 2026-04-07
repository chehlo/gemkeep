// ComparisonView visual tests — vitest-browser-svelte (real Chromium)
// Covers: focus rings on panels, decision indicators, HelpOverlay integration, commit round feedback

import { render } from 'vitest-browser-svelte'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { navigate, navigation } from '$lib/stores/navigation.svelte.js'
import type { LogicalPhotoSummary } from '$lib/api/index.js'
import { invoke } from '@tauri-apps/api/core'
import { PHOTO_1, PHOTO_2, PHOTO_3, OPEN_ROUND, UNDECIDED_DECISIONS, makeDecisionResult } from '$test/fixtures'
import { resetInvokeMock, createMockRouter } from '$test/helpers'
import {
  assertVisuallyFocused, assertNotVisuallyFocused, waitForVisualFocus,
} from '$test/selection-visual-helpers'
import {
  assertVisuallyKept, assertVisuallyEliminated,
  assertVisuallyDimmed, assertVisuallyUndecided,
} from '$test/decision-visual-helpers'
import ComparisonView from './ComparisonView.svelte'

const mockInvoke = vi.mocked(invoke)

const mockPhotos: LogicalPhotoSummary[] = [
  { ...PHOTO_1, thumbnail_path: null },
  { ...PHOTO_2, thumbnail_path: null },
  { ...PHOTO_3, thumbnail_path: null },
]

function setupNav() {
  navigate({ kind: 'comparison-view', projectSlug: 'test-project', stackId: 1, projectName: 'Test Project' })
}

function mockComparisonRouter(overrides: Record<string, any> = {}) {
  return createMockRouter({
    list_logical_photos: [mockPhotos],
    get_round_decisions: [UNDECIDED_DECISIONS],
    get_round_status: OPEN_ROUND,
    ...overrides,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  resetInvokeMock()
  setupNav()
})

async function waitForPanels(): Promise<{ left: HTMLElement; right: HTMLElement }> {
  let left: HTMLElement | null = null
  let right: HTMLElement | null = null
  await vi.waitFor(() => {
    left = document.querySelector('[data-testid="comparison-left"]') as HTMLElement
    right = document.querySelector('[data-testid="comparison-right"]') as HTMLElement
    if (!left || !right) throw new Error('Panels not yet rendered')
  }, { timeout: 3000 })
  return { left: left!, right: right! }
}

// ─── Focus indicator (visual) ────────────────────────────────────────────────

describe('ComparisonView — focus indicator (visual)', () => {
  it('left panel is focused by default', async () => {
    mockInvoke.mockImplementation(mockComparisonRouter())
    render(ComparisonView)

    const { left, right } = await waitForPanels()

    await assertVisuallyFocused(left)
    await assertNotVisuallyFocused(right)
  })

  it('ArrowRight moves focus indicator to right panel', async () => {
    mockInvoke.mockImplementation(mockComparisonRouter())
    render(ComparisonView)

    const { left, right } = await waitForPanels()

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))

    await waitForVisualFocus(right)
    await assertNotVisuallyFocused(left)
  })
})

// ─── Decision indicators (visual) ───────────────────────────────────────────

describe('ComparisonView — decision indicators (visual)', () => {
  it('Y key marks focused panel as kept', async () => {
    mockInvoke.mockImplementation(mockComparisonRouter({
      make_decision: makeDecisionResult({ action: 'keep', current_status: 'keep' }),
      get_round_status: { ...OPEN_ROUND, decided: 1, kept: 1, undecided: 2 },
    }))
    render(ComparisonView)

    const { left } = await waitForPanels()

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'y', bubbles: true }))

    await vi.waitFor(() => assertVisuallyKept(left), { timeout: 3000 })
  })
})

// ─── Rule 22: focus + decision combinations ────────────────────────────────

describe('ComparisonView — Rule 22: focus + decision combinations', () => {
  it('CV-Rule22: undecided + focused-right panel shows focus indicator without decision', async () => {
    mockInvoke.mockImplementation(mockComparisonRouter())
    render(ComparisonView)

    const { left, right } = await waitForPanels()

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))

    await waitForVisualFocus(right)
    await assertVisuallyFocused(right)
    await assertNotVisuallyFocused(left)
    await assertVisuallyUndecided(right)
  })

  it('CV-Rule22: keep + focused-right panel shows focus + kept indicator', async () => {
    mockInvoke.mockImplementation(mockComparisonRouter({
      make_decision: makeDecisionResult({ action: 'keep', current_status: 'keep' }),
      get_round_status: { ...OPEN_ROUND, decided: 1, kept: 1, undecided: 2 },
    }))
    render(ComparisonView)

    const { right } = await waitForPanels()

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    await waitForVisualFocus(right)

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'y', bubbles: true }))

    await vi.waitFor(() => assertVisuallyKept(right), { timeout: 3000 })
    await assertVisuallyFocused(right)
  })

  it('CV-Rule22: eliminate + focused-left panel shows focus + eliminated indicator + dim', async () => {
    mockInvoke.mockImplementation(mockComparisonRouter({
      make_decision: makeDecisionResult({ action: 'eliminate', current_status: 'eliminate' }),
      get_round_status: { ...OPEN_ROUND, decided: 1, eliminated: 1, undecided: 2 },
    }))
    render(ComparisonView)

    const { left } = await waitForPanels()

    // Press L to lock the pair first — otherwise auto-fill replaces the
    // eliminated photo with the next undecided and the panel no longer
    // shows the eliminated decision.
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'l', bubbles: true }))
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'x', bubbles: true }))

    await vi.waitFor(() => assertVisuallyEliminated(left), { timeout: 3000 })
    await assertVisuallyFocused(left)
    assertVisuallyDimmed(left)
  })

  it('CV-Rule22: eliminate + focused-right panel shows focus + eliminated indicator + dim', async () => {
    mockInvoke.mockImplementation(mockComparisonRouter({
      make_decision: makeDecisionResult({ action: 'eliminate', current_status: 'eliminate' }),
      get_round_status: { ...OPEN_ROUND, decided: 1, eliminated: 1, undecided: 2 },
    }))
    render(ComparisonView)

    const { right } = await waitForPanels()

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    await waitForVisualFocus(right)

    // Lock before eliminating (see note above).
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'l', bubbles: true }))
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'x', bubbles: true }))

    await vi.waitFor(() => assertVisuallyEliminated(right), { timeout: 3000 })
    await assertVisuallyFocused(right)
    assertVisuallyDimmed(right)
  })
})

// ─── HelpOverlay integration ────────────────────────────────────────────────

describe('ComparisonView — HelpOverlay', () => {
  it('? key shows help overlay with comparison-specific shortcuts', async () => {
    mockInvoke.mockImplementation(mockComparisonRouter())
    render(ComparisonView)

    await waitForPanels()

    document.dispatchEvent(new KeyboardEvent('keydown', { key: '?', bubbles: true }))

    await vi.waitFor(() => {
      // Should show HelpOverlay component with role="dialog"
      const helpOverlay = document.querySelector('[role="dialog"]')
      if (!helpOverlay) throw new Error('HelpOverlay not shown')
    }, { timeout: 3000 })

    // Should show "Comparison View" in the title
    const overlay = document.querySelector('[role="dialog"]')!
    const overlayText = overlay.textContent ?? ''
    expect(overlayText).toContain('Comparison View')
    // Should contain comparison-specific shortcuts
    expect(overlayText).toContain('Keep')
    expect(overlayText).toContain('Eliminate')
    expect(overlayText).toContain('Lock')
  })
})

// ─── Commit round feedback ──────────────────────────────────────────────────

describe('ComparisonView — commit round (Ctrl+Enter removed)', () => {
  it('Ctrl+Enter does not commit round in ComparisonView', async () => {
    mockInvoke.mockImplementation(mockComparisonRouter())
    render(ComparisonView)

    await waitForPanels()

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }))

    await new Promise(r => setTimeout(r, 100))

    // commit_round should NOT be called — Ctrl+Enter removed from ComparisonView
    expect(mockInvoke).not.toHaveBeenCalledWith('commit_round', expect.anything())
  })
})
