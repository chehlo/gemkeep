// StackOverview visual tests — vitest-browser-svelte (real Chromium)
// Covers: SO-09 (progress bar width), SO-12 (determinate bar width%),
//         SO-14 (bar NOT full-width), SO-16 (4-column grid layout),
//         SO-20 (focused card indicator), SO-44 (multi-select indicator)
// These tests verify actual computed CSS values, not class names.

import { render } from 'vitest-browser-svelte'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import { navigate, navigation } from '$lib/stores/navigation.svelte.js'
import type { SourceFolder, IndexingStatus } from '$lib/api/index.js'
import { IDLE_STATUS, makeStack } from '$test/fixtures'
import { mockStackOverviewRouter } from '$test/helpers'
import { waitForCards as _waitForCards } from '$test/browser-helpers'
import {
  assertVisuallyFocused, assertNotVisuallyFocused,
  assertVisuallySelected, assertNotVisuallySelected,
  waitForVisualFocus, waitForSelectionCount, countVisuallySelected,
} from '$test/selection-visual-helpers'
import StackOverview from './StackOverview.svelte'

const mockInvoke = vi.mocked(invoke)

const FOLDER_A: SourceFolder = { id: 1, path: '/home/user/Photos/Iceland' }


const RUNNING_STATUS: IndexingStatus = {
  running: true, thumbnails_running: false, total: 1290, processed: 340, errors: 0,
  cancelled: false, paused: false, last_stats: null, thumbnails_total: 0, thumbnails_done: 0,
}

const PROGRESS_STATUS: IndexingStatus = {
  running: false, thumbnails_running: true, total: 100, processed: 100, errors: 0,
  cancelled: false, paused: false, last_stats: null, thumbnails_total: 100, thumbnails_done: 42,
}

const DONE_STATUS: IndexingStatus = {
  running: false, thumbnails_running: false, total: 1290, processed: 1290, errors: 0,
  cancelled: false, paused: false,
  last_stats: {
    total_files_scanned: 1290, imported: 1280, skipped_existing: 0,
    skipped_unsupported: 10, errors: 0, pairs_detected: 640,
    stacks_generated: 5, logical_photos: 640, error_log: [],
  },
  thumbnails_total: 0, thumbnails_done: 0,
}

// Stacks WITH thumbnails (so resume_thumbnails is NOT triggered)
const STACK_WITH_THUMB_1 = makeStack({ stack_id: 1, thumbnail_path: '/cache/thumb1.jpg' })
const STACK_WITH_THUMB_2 = makeStack({ stack_id: 2, thumbnail_path: '/cache/thumb2.jpg' })
const STACK_WITH_THUMB_3 = makeStack({ stack_id: 3, thumbnail_path: '/cache/thumb3.jpg' })
const STACK_WITH_THUMB_4 = makeStack({ stack_id: 4, thumbnail_path: '/cache/thumb4.jpg' })
const STACK_WITH_THUMB_5 = makeStack({ stack_id: 5, thumbnail_path: '/cache/thumb5.jpg' })

function setupNav() {
  navigate({ kind: 'stack-overview', projectSlug: 'iceland-2024', projectName: 'Iceland 2024' })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockInvoke.mockImplementation(mockStackOverviewRouter())
  setupNav()
  navigation.stackOverviewFocusIndex = null
})

async function waitForCards(count: number): Promise<HTMLElement[]> {
  return _waitForCards(count, '[data-stack-card]')
}

// ── SO-09: Indexing progress bar with file count — verify bar width changes ──

describe('StackOverview — SO-09: indexing progress bar width (visual)', () => {
  it('progress bar inner div has width proportional to processed/total', async () => {
    mockInvoke.mockImplementation(mockStackOverviewRouter({
      list_source_folders: [[FOLDER_A]],
      list_stacks: [[]],
      get_indexing_status: [RUNNING_STATUS, RUNNING_STATUS, DONE_STATUS],
    }))

    render(StackOverview)

    // Wait for progress bar to appear
    let barInner: HTMLElement | null = null
    await vi.waitFor(() => {
      // Locate progress-bar fill elements (the inner div with style="width: X%")
      const bars = document.querySelectorAll('[data-testid="progress-bar-fill"]') as NodeListOf<HTMLElement>
      for (const bar of bars) {
        const w = bar.style.width
        if (w && w !== '0%') {
          barInner = bar
          break
        }
      }
      if (!barInner) throw new Error('Progress bar inner not found')
    }, { timeout: 5000 })

    // RUNNING_STATUS: processed=340, total=1290 => ~26%
    const width = barInner!.style.width
    expect(width).toBe('26%')

    // Verify the bar has non-zero rendered width
    const box = barInner!.getBoundingClientRect()
    expect(box.width).toBeGreaterThan(0)
  })
})

// ── SO-12: Thumbnail progress: determinate bar with correct width% ──

describe('StackOverview — SO-12: thumbnail determinate bar width% (visual)', () => {
  it('thumbnail progress bar has width matching thumbnailPct()', async () => {
    const stacks = [STACK_WITH_THUMB_1, STACK_WITH_THUMB_2]
    mockInvoke.mockImplementation(mockStackOverviewRouter({
      list_source_folders: [[FOLDER_A]],
      list_stacks: [stacks],
      get_indexing_status: [PROGRESS_STATUS, PROGRESS_STATUS, DONE_STATUS],
    }))

    render(StackOverview)

    let barInner: HTMLElement | null = null
    await vi.waitFor(() => {
      const bars = document.querySelectorAll('[data-testid="progress-bar-fill"]') as NodeListOf<HTMLElement>
      for (const bar of bars) {
        if (bar.style.width === '42%') {
          barInner = bar
          break
        }
      }
      if (!barInner) throw new Error('Thumbnail progress bar with 42% not found')
    }, { timeout: 5000 })

    // Verify the computed width is not 0 and not 100%
    const box = barInner!.getBoundingClientRect()
    expect(box.width).toBeGreaterThan(0)

    // Verify text shows 42%
    const textContent = document.body.textContent ?? ''
    expect(textContent).toContain('42%')
  })
})

// ── SO-14: Thumbnail progress NOT a static full-width bar ──

describe('StackOverview — SO-14: thumbnail progress bar is NOT full-width (visual)', () => {
  it('progress bar inner width is less than outer container width', async () => {
    const stacks = [STACK_WITH_THUMB_1, STACK_WITH_THUMB_2]
    mockInvoke.mockImplementation(mockStackOverviewRouter({
      list_source_folders: [[FOLDER_A]],
      list_stacks: [stacks],
      get_indexing_status: [PROGRESS_STATUS, PROGRESS_STATUS, DONE_STATUS],
    }))

    render(StackOverview)

    let barInner: HTMLElement | null = null
    let barOuter: HTMLElement | null = null
    await vi.waitFor(() => {
      const bars = document.querySelectorAll('[data-testid="progress-bar-fill"]') as NodeListOf<HTMLElement>
      for (const bar of bars) {
        if (bar.style.width && bar.style.width !== '100%') {
          barInner = bar
          barOuter = bar.parentElement as HTMLElement
          break
        }
      }
      if (!barInner || !barOuter) throw new Error('Progress bar pair not found')
    }, { timeout: 5000 })

    // Inner bar must be narrower than outer container
    const innerBox = barInner!.getBoundingClientRect()
    const outerBox = barOuter!.getBoundingClientRect()
    expect(innerBox.width).toBeLessThan(outerBox.width)

    // The style width must NOT be "100%"
    expect(barInner!.style.width).not.toBe('100%')
  })
})

// ── SO-16: Stack card grid: 4-column layout ──

describe('StackOverview — SO-16: 4-column grid layout (visual)', () => {
  it('first 4 stack cards are on the same row, 5th card drops to next row', async () => {
    const fiveStacks = [
      STACK_WITH_THUMB_1, STACK_WITH_THUMB_2, STACK_WITH_THUMB_3,
      STACK_WITH_THUMB_4, STACK_WITH_THUMB_5,
    ]

    mockInvoke.mockImplementation(mockStackOverviewRouter({
      list_source_folders: [[FOLDER_A]],
      list_stacks: [fiveStacks],
      get_indexing_status: DONE_STATUS,
    }))

    render(StackOverview)

    const cards = await waitForCards(5)

    // All first 4 cards should have the same top position (same row)
    const top0 = cards[0].getBoundingClientRect().top
    const top1 = cards[1].getBoundingClientRect().top
    const top2 = cards[2].getBoundingClientRect().top
    const top3 = cards[3].getBoundingClientRect().top
    const top4 = cards[4].getBoundingClientRect().top

    // First 4 cards in the same row (same top within 2px tolerance)
    expect(Math.abs(top0 - top1)).toBeLessThan(2)
    expect(Math.abs(top0 - top2)).toBeLessThan(2)
    expect(Math.abs(top0 - top3)).toBeLessThan(2)

    // 5th card should be on a different row (lower top)
    expect(top4).toBeGreaterThan(top0 + 10)

    // Verify the grid container has 4-column template
    const gridContainer = cards[0].parentElement as HTMLElement
    const gridCols = getComputedStyle(gridContainer).gridTemplateColumns
    // Should have 4 column values (e.g., "200px 200px 200px 200px" or fractions)
    const columnCount = gridCols.split(' ').filter(s => s.length > 0).length
    expect(columnCount).toBe(4)
  })

  it('first 4 cards have progressively increasing left positions', async () => {
    const fourStacks = [
      STACK_WITH_THUMB_1, STACK_WITH_THUMB_2, STACK_WITH_THUMB_3, STACK_WITH_THUMB_4,
    ]

    mockInvoke.mockImplementation(mockStackOverviewRouter({
      list_source_folders: [[FOLDER_A]],
      list_stacks: [fourStacks],
      get_indexing_status: DONE_STATUS,
    }))

    render(StackOverview)

    const cards = await waitForCards(4)

    const left0 = cards[0].getBoundingClientRect().left
    const left1 = cards[1].getBoundingClientRect().left
    const left2 = cards[2].getBoundingClientRect().left
    const left3 = cards[3].getBoundingClientRect().left

    // Each card should be to the right of the previous one
    expect(left1).toBeGreaterThan(left0)
    expect(left2).toBeGreaterThan(left1)
    expect(left3).toBeGreaterThan(left2)
  })
})

// ── SO-20: Focused stack card shows focus indicator ──

describe('StackOverview — SO-20: focused card shows focus indicator (visual)', () => {
  it('first card is visually focused by default', async () => {
    mockInvoke.mockImplementation(mockStackOverviewRouter({
      list_source_folders: [[FOLDER_A]],
      list_stacks: [[STACK_WITH_THUMB_1, STACK_WITH_THUMB_2, STACK_WITH_THUMB_3]],
      get_indexing_status: DONE_STATUS,
    }))

    render(StackOverview)

    const cards = await waitForCards(3)

    // Card 0 should have focus indicator
    await assertVisuallyFocused(cards[0])

    // Card 1 should NOT have focus indicator
    await assertNotVisuallyFocused(cards[1])
  })

  it('ArrowRight moves focus indicator to next card', async () => {
    mockInvoke.mockImplementation(mockStackOverviewRouter({
      list_source_folders: [[FOLDER_A]],
      list_stacks: [[STACK_WITH_THUMB_1, STACK_WITH_THUMB_2, STACK_WITH_THUMB_3]],
      get_indexing_status: DONE_STATUS,
    }))

    render(StackOverview)

    const cards = await waitForCards(3)

    // Initially card 0 has focus indicator
    await assertVisuallyFocused(cards[0])

    // Press ArrowRight
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))

    // Wait for focus to move to card 1
    await waitForVisualFocus(cards[1])

    // Card 0 should no longer be focused
    await assertNotVisuallyFocused(cards[0])
    // Card 1 should now be focused
    await assertVisuallyFocused(cards[1])
  })
})

// ── SO-44: Shift+Arrow selects multiple stacks (selection indicator) ──

describe('StackOverview — SO-44: Shift+Arrow multi-select (visual)', () => {
  it('Shift+ArrowRight marks covered cards as selected', async () => {
    mockInvoke.mockImplementation(mockStackOverviewRouter({
      list_source_folders: [[FOLDER_A]],
      list_stacks: [[STACK_WITH_THUMB_1, STACK_WITH_THUMB_2, STACK_WITH_THUMB_3]],
      get_indexing_status: DONE_STATUS,
    }))

    render(StackOverview)

    const cards = await waitForCards(3)

    // Initially no selection indicator on any card
    for (const card of cards) await assertNotVisuallySelected(card)

    // Shift+ArrowRight to select card 0 and move to card 1
    document.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'ArrowRight', shiftKey: true, bubbles: true,
    }))

    // Wait for both cards to show selection indicator
    await waitForSelectionCount(() => [cards[0], cards[1]], 2)

    // Card 2 should NOT be selected
    await assertNotVisuallySelected(cards[2])
  })

  it('Shift+ArrowRight twice selects 3 consecutive cards', async () => {
    mockInvoke.mockImplementation(mockStackOverviewRouter({
      list_source_folders: [[FOLDER_A]],
      list_stacks: [[STACK_WITH_THUMB_1, STACK_WITH_THUMB_2, STACK_WITH_THUMB_3]],
      get_indexing_status: DONE_STATUS,
    }))

    render(StackOverview)

    const cards = await waitForCards(3)

    document.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'ArrowRight', shiftKey: true, bubbles: true,
    }))
    document.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'ArrowRight', shiftKey: true, bubbles: true,
    }))

    await waitForSelectionCount(() => cards, 3)

    for (const card of cards) await assertVisuallySelected(card)
  })

  it('ArrowRight WITHOUT shift preserves selection (moves focus only)', async () => {
    const fourStacks = [
      STACK_WITH_THUMB_1, STACK_WITH_THUMB_2, STACK_WITH_THUMB_3, STACK_WITH_THUMB_4,
    ]
    mockInvoke.mockImplementation(mockStackOverviewRouter({
      list_source_folders: [[FOLDER_A]],
      list_stacks: [fourStacks],
      get_indexing_status: DONE_STATUS,
    }))

    render(StackOverview)

    const cards = await waitForCards(4)

    document.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'ArrowRight', shiftKey: true, bubbles: true,
    }))

    await waitForSelectionCount(() => cards, 2)

    // Now press ArrowRight WITHOUT shift
    document.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'ArrowRight', bubbles: true,
    }))

    // Selection should persist — arrow only moves focus
    await waitForSelectionCount(() => cards, 2)
    expect(await countVisuallySelected(cards)).toBeGreaterThanOrEqual(2)
  })
})
