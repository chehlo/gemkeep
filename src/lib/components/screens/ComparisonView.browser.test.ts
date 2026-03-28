// ComparisonView visual tests — vitest-browser-svelte (real Chromium)
// Covers: focus rings on panels, decision indicators, HelpOverlay integration, commit round feedback

import { render } from 'vitest-browser-svelte'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { navigate, navigation } from '$lib/stores/navigation.svelte.js'
import type { LogicalPhotoSummary } from '$lib/api/index.js'
import { invoke } from '@tauri-apps/api/core'
import { PHOTO_1, PHOTO_2, PHOTO_3, OPEN_ROUND, UNDECIDED_DECISIONS, makeDecisionResult } from '$test/fixtures'
import { resetInvokeMock, createMockRouter } from '$test/helpers'
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

// ─── Focus rings (visual) ────────────────────────────────────────────────────

describe('ComparisonView — focus ring (visual)', () => {
  it('left panel has visible blue border by default', async () => {
    mockInvoke.mockImplementation(mockComparisonRouter())
    render(ComparisonView)

    const { left, right } = await waitForPanels()

    // Left panel should have blue border (focused)
    const leftFrame = left.querySelector('[data-testid="photo-frame"]') as HTMLElement
    const rightFrame = right.querySelector('[data-testid="photo-frame"]') as HTMLElement

    const leftBorder = getComputedStyle(leftFrame).borderColor
    const rightBorder = getComputedStyle(rightFrame).borderColor

    // Blue = rgb(59, 130, 246) (blue-500)
    expect(leftBorder).toBe('rgb(59, 130, 246)')
    expect(rightBorder).not.toBe('rgb(59, 130, 246)')
  })

  it('ArrowRight moves blue border to right panel', async () => {
    mockInvoke.mockImplementation(mockComparisonRouter())
    render(ComparisonView)

    const { left, right } = await waitForPanels()

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))

    await vi.waitFor(() => {
      const rightFrame = right.querySelector('[data-testid="photo-frame"]') as HTMLElement
      const border = getComputedStyle(rightFrame).borderColor
      if (border !== 'rgb(59, 130, 246)') throw new Error('Right panel not yet focused')
    }, { timeout: 3000 })

    const leftFrame = left.querySelector('[data-testid="photo-frame"]') as HTMLElement
    expect(getComputedStyle(leftFrame).borderColor).not.toBe('rgb(59, 130, 246)')
  })
})

// ─── Decision indicators (visual) ───────────────────────────────────────────

describe('ComparisonView — decision indicators (visual)', () => {
  it('Y key shows green keep indicator on focused panel', async () => {
    mockInvoke.mockImplementation(mockComparisonRouter({
      make_decision: makeDecisionResult({ action: 'keep', current_status: 'keep' }),
      get_round_status: { ...OPEN_ROUND, decided: 1, kept: 1, undecided: 2 },
    }))
    render(ComparisonView)

    await waitForPanels()

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'y', bubbles: true }))

    await vi.waitFor(() => {
      const left = document.querySelector('[data-testid="comparison-left"]') as HTMLElement
      const frame = left.querySelector('[data-testid="photo-frame"]') as HTMLElement
      const border = getComputedStyle(frame).borderColor
      // Green = rgb(34, 197, 94) (green-500)
      if (border !== 'rgb(34, 197, 94)') throw new Error(`Keep border not green: ${border}`)
    }, { timeout: 3000 })
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
