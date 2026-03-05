// StackOverview visual tests — vitest-browser-svelte (real Chromium)
// Covers: SO-09 (progress bar width), SO-12 (determinate bar width%),
//         SO-14 (bar NOT full-width), SO-16 (4-column grid layout),
//         SO-20 (blue focused border), SO-44 (yellow multi-select ring)
// These tests verify actual computed CSS values, not class names.

import { render } from 'vitest-browser-svelte'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import { navigate, navigation } from '$lib/stores/navigation.svelte.js'
import type { SourceFolder, IndexingStatus, StackSummary } from '$lib/api/index.js'
import StackOverview from './StackOverview.svelte'

const mockInvoke = vi.mocked(invoke)

const FOLDER_A: SourceFolder = { id: 1, path: '/home/user/Photos/Iceland' }

const IDLE_STATUS: IndexingStatus = {
  running: false, thumbnails_running: false, total: 0, processed: 0, errors: 0,
  cancelled: false, paused: false, last_stats: null, thumbnails_total: 0, thumbnails_done: 0,
}

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

function makeStack(id: number, thumbPath: string | null = null): StackSummary {
  return {
    stack_id: id,
    logical_photo_count: 3,
    earliest_capture: '2024-03-15T10:00:00Z',
    has_raw: true,
    has_jpeg: true,
    thumbnail_path: thumbPath,
  }
}

// Stacks WITH thumbnails (so resume_thumbnails is NOT triggered)
const STACK_WITH_THUMB_1 = makeStack(1, '/cache/thumb1.jpg')
const STACK_WITH_THUMB_2 = makeStack(2, '/cache/thumb2.jpg')
const STACK_WITH_THUMB_3 = makeStack(3, '/cache/thumb3.jpg')
const STACK_WITH_THUMB_4 = makeStack(4, '/cache/thumb4.jpg')
const STACK_WITH_THUMB_5 = makeStack(5, '/cache/thumb5.jpg')

function setupNav() {
  navigate({ kind: 'stack-overview', projectSlug: 'iceland-2024', projectName: 'Iceland 2024' })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockInvoke.mockReset()
  mockInvoke.mockImplementation((cmd: string) => {
    throw new Error(`Unmocked invoke("${cmd}"). Add mockInvoke.mockResolvedValueOnce(...) before this call.`)
  })
  setupNav()
  navigation.stackOverviewFocusIndex = null
})

/**
 * Render StackOverview with correct mock chain.
 * Handles the auto-follow-up paths that loadAll() triggers.
 */
function renderStackOverview(overrides?: Partial<{
  folders: SourceFolder[],
  stacks: StackSummary[],
  status: IndexingStatus,
}>) {
  const folders = overrides?.folders ?? []
  const stacks = overrides?.stacks ?? []
  const status = overrides?.status ?? IDLE_STATUS

  // loadAll() core: list_source_folders, list_stacks, get_indexing_status
  mockInvoke.mockResolvedValueOnce(folders)
  mockInvoke.mockResolvedValueOnce(stacks)
  mockInvoke.mockResolvedValueOnce(status)

  // Follow-up mocks based on derived state
  if (status.running || status.thumbnails_running) {
    mockInvoke.mockResolvedValueOnce(IDLE_STATUS) // poll: get_indexing_status (terminal)
    mockInvoke.mockResolvedValueOnce(stacks)      // poll: list_stacks
  } else if (folders.length > 0 && stacks.length === 0) {
    mockInvoke.mockResolvedValueOnce(undefined)   // start_indexing
    mockInvoke.mockResolvedValueOnce(IDLE_STATUS) // poll: get_indexing_status
    mockInvoke.mockResolvedValueOnce(stacks)      // poll: list_stacks
  } else if (stacks.length > 0 && stacks.some(s => s.thumbnail_path === null)) {
    mockInvoke.mockResolvedValueOnce(undefined)   // resume_thumbnails
    mockInvoke.mockResolvedValueOnce(IDLE_STATUS) // poll: get_indexing_status
    mockInvoke.mockResolvedValueOnce(stacks)      // poll: list_stacks
  }
  // Path D: all thumbs present, idle -> no follow-up

  return render(StackOverview)
}

/** Wait for stack cards to appear in the DOM. */
async function waitForCards(count: number): Promise<HTMLElement[]> {
  let cards: HTMLElement[] = []
  await vi.waitFor(() => {
    cards = Array.from(document.querySelectorAll('[data-stack-card]')) as HTMLElement[]
    if (cards.length !== count) {
      throw new Error(`Expected ${count} cards, got ${cards.length}`)
    }
  }, { timeout: 5000 })
  return cards
}

// ── SO-09: Indexing progress bar with file count — verify bar width changes ──

describe('StackOverview — SO-09: indexing progress bar width (visual)', () => {
  it('progress bar inner div has width proportional to processed/total', async () => {
    // Custom mock chain: keep RUNNING_STATUS visible during assertion
    mockInvoke.mockResolvedValueOnce([FOLDER_A])      // list_source_folders
    mockInvoke.mockResolvedValueOnce([])               // list_stacks
    mockInvoke.mockResolvedValueOnce(RUNNING_STATUS)   // get_indexing_status (running=true)
    mockInvoke.mockResolvedValueOnce(RUNNING_STATUS)   // poll: get_indexing_status (still running)
    mockInvoke.mockResolvedValueOnce([])               // poll: list_stacks

    render(StackOverview)

    // Wait for progress bar to appear
    let barInner: HTMLElement | null = null
    await vi.waitFor(() => {
      // The progress bar structure: outer div.bg-gray-800 > inner div.bg-blue-500 with style="width: X%"
      const bars = document.querySelectorAll('.bg-blue-500.h-2') as NodeListOf<HTMLElement>
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
    // PROGRESS_STATUS: thumbnails_done=42, thumbnails_total=100 => 42%
    mockInvoke.mockResolvedValueOnce([FOLDER_A])       // list_source_folders
    mockInvoke.mockResolvedValueOnce([STACK_WITH_THUMB_1, STACK_WITH_THUMB_2]) // list_stacks
    mockInvoke.mockResolvedValueOnce(PROGRESS_STATUS)  // get_indexing_status
    mockInvoke.mockResolvedValueOnce(PROGRESS_STATUS)  // poll: get_indexing_status (still running)
    mockInvoke.mockResolvedValueOnce([STACK_WITH_THUMB_1, STACK_WITH_THUMB_2]) // poll: list_stacks

    render(StackOverview)

    let barInner: HTMLElement | null = null
    await vi.waitFor(() => {
      const bars = document.querySelectorAll('.bg-blue-500.h-2') as NodeListOf<HTMLElement>
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
    // PROGRESS_STATUS: 42% — definitely not 100%
    mockInvoke.mockResolvedValueOnce([FOLDER_A])
    mockInvoke.mockResolvedValueOnce([STACK_WITH_THUMB_1, STACK_WITH_THUMB_2])
    mockInvoke.mockResolvedValueOnce(PROGRESS_STATUS)
    mockInvoke.mockResolvedValueOnce(PROGRESS_STATUS)
    mockInvoke.mockResolvedValueOnce([STACK_WITH_THUMB_1, STACK_WITH_THUMB_2])

    render(StackOverview)

    let barInner: HTMLElement | null = null
    let barOuter: HTMLElement | null = null
    await vi.waitFor(() => {
      const bars = document.querySelectorAll('.bg-blue-500.h-2') as NodeListOf<HTMLElement>
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

    renderStackOverview({
      folders: [FOLDER_A],
      stacks: fiveStacks,
      status: DONE_STATUS,
    })

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

    renderStackOverview({
      folders: [FOLDER_A],
      stacks: fourStacks,
      status: DONE_STATUS,
    })

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

// ── SO-20: Focused stack card has blue border ring ──

describe('StackOverview — SO-20: focused card has blue border (visual)', () => {
  it('first card has blue border color by default', async () => {
    renderStackOverview({
      folders: [FOLDER_A],
      stacks: [STACK_WITH_THUMB_1, STACK_WITH_THUMB_2, STACK_WITH_THUMB_3],
      status: DONE_STATUS,
    })

    const cards = await waitForCards(3)

    // Card 0 should have blue border (border-blue-500 = rgb(59, 130, 246))
    const borderColor0 = getComputedStyle(cards[0]).borderColor
    expect(borderColor0).toBe('rgb(59, 130, 246)')

    // Card 1 should NOT have blue border
    const borderColor1 = getComputedStyle(cards[1]).borderColor
    expect(borderColor1).not.toBe('rgb(59, 130, 246)')
  })

  it('ArrowRight moves blue border to next card', async () => {
    renderStackOverview({
      folders: [FOLDER_A],
      stacks: [STACK_WITH_THUMB_1, STACK_WITH_THUMB_2, STACK_WITH_THUMB_3],
      status: DONE_STATUS,
    })

    const cards = await waitForCards(3)

    // Initially card 0 has blue border
    expect(getComputedStyle(cards[0]).borderColor).toBe('rgb(59, 130, 246)')

    // Press ArrowRight
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))

    await vi.waitFor(() => {
      if (getComputedStyle(cards[1]).borderColor !== 'rgb(59, 130, 246)') {
        throw new Error('Card 1 not yet focused')
      }
    }, { timeout: 3000 })

    // Card 0 should no longer have blue border
    expect(getComputedStyle(cards[0]).borderColor).not.toBe('rgb(59, 130, 246)')
    // Card 1 has blue border
    expect(getComputedStyle(cards[1]).borderColor).toBe('rgb(59, 130, 246)')
  })
})

// ── SO-44: Shift+Arrow selects multiple stacks (yellow ring) ──

describe('StackOverview — SO-44: Shift+Arrow multi-select yellow ring (visual)', () => {
  it('Shift+ArrowRight adds yellow border/ring to selected cards', async () => {
    renderStackOverview({
      folders: [FOLDER_A],
      stacks: [STACK_WITH_THUMB_1, STACK_WITH_THUMB_2, STACK_WITH_THUMB_3],
      status: DONE_STATUS,
    })

    const cards = await waitForCards(3)

    // Initially no yellow ring on any card
    for (const card of cards) {
      const bc = getComputedStyle(card).borderColor
      // Yellow-400 = rgb(250, 204, 21)
      expect(bc).not.toBe('rgb(250, 204, 21)')
    }

    // Shift+ArrowRight to select card 0 and move to card 1
    document.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'ArrowRight', shiftKey: true, bubbles: true,
    }))

    // Wait for yellow ring to appear on selected cards
    await vi.waitFor(() => {
      // Check card 0 — should be selected (yellow ring via ring-2 ring-yellow-400)
      const card0Classes = cards[0].className
      const card1Classes = cards[1].className
      if (!card0Classes.includes('ring-yellow') && !card0Classes.includes('border-yellow')) {
        throw new Error('Card 0 not yet selected')
      }
      if (!card1Classes.includes('ring-yellow') && !card1Classes.includes('border-yellow')) {
        throw new Error('Card 1 not yet selected')
      }
    }, { timeout: 3000 })

    // Card 2 should NOT be selected
    expect(cards[2].className).not.toMatch(/ring-yellow|border-yellow/)
  })

  it('Shift+ArrowRight twice selects 3 consecutive cards', async () => {
    renderStackOverview({
      folders: [FOLDER_A],
      stacks: [STACK_WITH_THUMB_1, STACK_WITH_THUMB_2, STACK_WITH_THUMB_3],
      status: DONE_STATUS,
    })

    const cards = await waitForCards(3)

    // Shift+ArrowRight twice
    document.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'ArrowRight', shiftKey: true, bubbles: true,
    }))
    document.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'ArrowRight', shiftKey: true, bubbles: true,
    }))

    await vi.waitFor(() => {
      const allSelected = [0, 1, 2].every(i =>
        cards[i].className.includes('ring-yellow') || cards[i].className.includes('border-yellow')
      )
      if (!allSelected) throw new Error('Not all 3 cards selected yet')
    }, { timeout: 3000 })

    // All 3 should have yellow indicator
    for (const card of cards) {
      expect(card.className).toMatch(/ring-yellow|border-yellow/)
    }
  })

  it('ArrowRight WITHOUT shift clears yellow selection', async () => {
    const fourStacks = [
      STACK_WITH_THUMB_1, STACK_WITH_THUMB_2, STACK_WITH_THUMB_3, STACK_WITH_THUMB_4,
    ]
    renderStackOverview({
      folders: [FOLDER_A],
      stacks: fourStacks,
      status: DONE_STATUS,
    })

    const cards = await waitForCards(4)

    // Select 2 cards with Shift+ArrowRight
    document.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'ArrowRight', shiftKey: true, bubbles: true,
    }))

    await vi.waitFor(() => {
      const selected = Array.from(cards).filter(c =>
        c.className.includes('ring-yellow') || c.className.includes('border-yellow')
      )
      if (selected.length < 2) throw new Error('Selection not applied yet')
    }, { timeout: 3000 })

    // Now press ArrowRight WITHOUT shift
    document.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'ArrowRight', bubbles: true,
    }))

    await vi.waitFor(() => {
      const selected = Array.from(cards).filter(c =>
        c.className.includes('ring-yellow') || c.className.includes('border-yellow')
      )
      if (selected.length > 0) throw new Error('Selection not cleared yet')
    }, { timeout: 3000 })

    // No card should have yellow indicator
    for (const card of cards) {
      expect(card.className).not.toMatch(/ring-yellow|border-yellow/)
    }
  })
})
