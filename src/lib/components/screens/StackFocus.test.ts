// src/lib/components/screens/StackFocus.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/svelte'
import { invoke, convertFileSrc } from '@tauri-apps/api/core'
import { navigate, navigation } from '$lib/stores/navigation.svelte.js'
import type { LogicalPhotoSummary } from '$lib/api/index.js'
import { PHOTO_1, PHOTO_2, PHOTO_3, makeDecisionResult, makePhotoList, OPEN_ROUND, THREE_ROUND_LIST, ROUND_1_COMMITTED, ROUND_3_OPEN, makeRoundStatus, makeRoundSummary } from '$test/fixtures'
import { mockStackFocusRouter } from '$test/helpers'
import { DECISION_SELECTORS } from '$test/decision-helpers'
import StackFocus from './StackFocus.svelte'
import { formatCaptureTime } from '$lib/utils/photos.js'

const mockInvoke = vi.mocked(invoke)

/** Get the className of the PhotoFrame inside a photo-card (visual classes live there, not on the wrapper) */
function frameClass(card: Element): string {
  return card.querySelector('[data-testid="photo-frame"]')?.className ?? ''
}

const mockPhotos: LogicalPhotoSummary[] = [PHOTO_1, PHOTO_2, PHOTO_3]

function setupNav() {
  navigate({ kind: 'stack-focus', projectSlug: 'test-project', projectName: 'Test Project', stackId: 1 })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockInvoke.mockImplementation(mockStackFocusRouter())
  setupNav()
})

describe('StackFocus — loading state', () => {
  it('renders loading state before data arrives', async () => {
    // Return a promise that never resolves so loading stays true
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === 'list_logical_photos') return new Promise(() => {}) // never resolves
      return Promise.resolve(undefined)
    })

    render(StackFocus)

    // Without awaiting any ticks, the loading indicator should be visible
    const loadingEl = screen.getByTestId('loading-indicator')
    expect(loadingEl).toBeInTheDocument()
    expect(loadingEl).toHaveTextContent('Loading...')
  })
})

describe('StackFocus — photo grid', () => {
  it('renders photo grid after data loads', async () => {
    mockInvoke.mockImplementation(mockStackFocusRouter({
      list_logical_photos: [mockPhotos],
    }))

    render(StackFocus)

    await waitFor(() => {
      const cards = screen.getAllByTestId('photo-card')
      expect(cards).toHaveLength(3)
    })
  })

  it('renders img with asset:// URL when thumbnail_path is set', async () => {
    const thumbPath = '/home/user/.gem-keep/test.jpg'
    vi.mocked(convertFileSrc).mockImplementation((p: string) => `asset://localhost${p}`)

    mockInvoke.mockImplementation(mockStackFocusRouter({
      list_logical_photos: [[{ ...PHOTO_1, thumbnail_path: thumbPath }]],
    }))

    render(StackFocus)

    await waitFor(() => {
      const img = screen.getByRole('img')
      expect(img).toBeInTheDocument()
      expect(img).toHaveAttribute('src', `asset://localhost${thumbPath}`)
    })
  })

  it('renders placeholder when thumbnail_path is null', async () => {
    mockInvoke.mockImplementation(mockStackFocusRouter({
      list_logical_photos: [[PHOTO_3]],
    }))

    render(StackFocus)

    await waitFor(() => {
      expect(screen.getByTestId('photo-card')).toBeInTheDocument()
    })

    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(screen.getByTestId('photo-placeholder')).toBeInTheDocument()
  })

  it('shows camera model when present', async () => {
    mockInvoke.mockImplementation(mockStackFocusRouter({
      list_logical_photos: [[{ ...PHOTO_1, camera_model: 'Canon EOS 5D Mark IV', lens: 'EF 85mm f/1.4' }]],
    }))

    render(StackFocus)

    await waitFor(() => {
      expect(screen.getByText(/Canon EOS 5D/)).toBeInTheDocument()
    })
  })

  it('shows RAW badge when has_raw is true', async () => {
    mockInvoke.mockImplementation(mockStackFocusRouter({
      list_logical_photos: [[{ ...PHOTO_1, has_raw: true, has_jpeg: true }]],
    }))

    render(StackFocus)

    await waitFor(() => {
      expect(screen.getByText('RAW')).toBeInTheDocument()
    })
    expect(screen.getByText('JPEG')).toBeInTheDocument()
  })
})

describe('StackFocus — Sprint 7: decision badges', () => {
  it('kept photo has decision-keep indicator element', async () => {
    mockInvoke.mockImplementation(mockStackFocusRouter({
      list_logical_photos: [mockPhotos],
      get_round_decisions: [[
        { logical_photo_id: 1, current_status: 'keep' },
        { logical_photo_id: 2, current_status: 'eliminate' },
        { logical_photo_id: 3, current_status: 'undecided' },
      ]],
      get_round_status: {
        round_id: 1, round_number: 1, state: 'open',
        total_photos: 3, decided: 2, kept: 1, eliminated: 1, undecided: 1, committed_at: null,
      },
    }))

    render(StackFocus)

    await waitFor(() => {
      const cards = screen.getAllByTestId('photo-card')
      expect(cards[0].querySelector(DECISION_SELECTORS.keep)).toBeInTheDocument()
    })
  })

  it('V2: keep indicator has border-green-500 class on container', async () => {
    mockInvoke.mockImplementation(mockStackFocusRouter({
      list_logical_photos: [mockPhotos],
      get_round_decisions: [[
        { logical_photo_id: 1, current_status: 'keep' },
        { logical_photo_id: 2, current_status: 'undecided' },
        { logical_photo_id: 3, current_status: 'undecided' },
      ]],
      get_round_status: {
        round_id: 1, round_number: 1, state: 'open',
        total_photos: 3, decided: 1, kept: 1, eliminated: 0, undecided: 2, committed_at: null,
      },
    }))

    render(StackFocus)

    await waitFor(() => {
      const cards = screen.getAllByTestId('photo-card')
      const badge = cards[0].querySelector(DECISION_SELECTORS.keep) as HTMLElement
      expect(badge).toBeInTheDocument()
      expect(badge.className).toContain('border-green-500')
      expect(badge.className).toContain('border-2')
    })
  })

  it('V2: eliminate indicator has border-red-500 class on container', async () => {
    // Use committed round so eliminated photos are visible in the grid
    mockInvoke.mockImplementation(mockStackFocusRouter({
      list_logical_photos: [mockPhotos],
      get_round_decisions: [[
        { logical_photo_id: 1, current_status: 'eliminate' },
        { logical_photo_id: 2, current_status: 'undecided' },
        { logical_photo_id: 3, current_status: 'undecided' },
      ]],
      get_round_status: {
        round_id: 1, round_number: 1, state: 'committed',
        total_photos: 3, decided: 1, kept: 0, eliminated: 1, undecided: 2, committed_at: '2024-01-15T12:00:00Z',
      },
      list_rounds: [[
        { round_id: 1, round_number: 1, state: 'committed', total_photos: 3, decided: 1, kept: 0, eliminated: 1, undecided: 2, committed_at: '2024-01-15T12:00:00Z' },
        { round_id: 2, round_number: 2, state: 'open', total_photos: 2, decided: 0, kept: 0, eliminated: 0, undecided: 2, committed_at: null },
      ]],
    }))

    render(StackFocus)

    await waitFor(() => {
      const cards = screen.getAllByTestId('photo-card')
      const badge = cards[0].querySelector(DECISION_SELECTORS.eliminate) as HTMLElement
      expect(badge).toBeInTheDocument()
      expect(badge.className).toContain('border-red-500')
      // Absorbed into PhotoFrame container: border-2 on frame, no inset-0 overlay
      expect(badge.className).toContain('border-2')
    })
  })

  it('eliminated photo has decision-eliminate indicator element', async () => {
    // Use committed round so eliminated photos are visible in the grid
    mockInvoke.mockImplementation(mockStackFocusRouter({
      list_logical_photos: [mockPhotos],
      get_round_decisions: [[
        { logical_photo_id: 1, current_status: 'undecided' },
        { logical_photo_id: 2, current_status: 'eliminate' },
        { logical_photo_id: 3, current_status: 'undecided' },
      ]],
      get_round_status: {
        round_id: 1, round_number: 1, state: 'committed',
        total_photos: 3, decided: 1, kept: 0, eliminated: 1, undecided: 2, committed_at: '2024-01-15T12:00:00Z',
      },
      list_rounds: [[
        { round_id: 1, round_number: 1, state: 'committed', total_photos: 3, decided: 1, kept: 0, eliminated: 1, undecided: 2, committed_at: '2024-01-15T12:00:00Z' },
        { round_id: 2, round_number: 2, state: 'open', total_photos: 2, decided: 0, kept: 0, eliminated: 0, undecided: 2, committed_at: null },
      ]],
    }))

    render(StackFocus)

    await waitFor(() => {
      const cards = screen.getAllByTestId('photo-card')
      expect(cards[1].querySelector(DECISION_SELECTORS.eliminate)).toBeInTheDocument()
    })
  })

  it('displays compact status with checkmark/x/? format', async () => {
    mockInvoke.mockImplementation(mockStackFocusRouter({
      list_logical_photos: [mockPhotos],
      get_round_decisions: [[
        { logical_photo_id: 1, current_status: 'keep' },
        { logical_photo_id: 2, current_status: 'eliminate' },
        { logical_photo_id: 3, current_status: 'undecided' },
      ]],
      get_round_status: {
        round_id: 1, round_number: 1, state: 'open',
        total_photos: 3, decided: 2, kept: 1, eliminated: 1, undecided: 1, committed_at: null,
      },
    }))

    render(StackFocus)

    await waitFor(() => {
      const compact = screen.getByTestId('compact-status')
      expect(compact.textContent).toContain('1\u2713')
      expect(compact.textContent).toContain('1\u2717')
      expect(compact.textContent).toContain('1?')
    })
  })

  it('Y key on focused photo calls makeDecision', async () => {
    mockInvoke.mockImplementation(mockStackFocusRouter({
      list_logical_photos: [mockPhotos],
      make_decision: makeDecisionResult({ round_auto_created: true }),
    }))

    render(StackFocus)
    await waitFor(() => screen.getAllByTestId('photo-card'))

    await fireEvent.keyDown(document, { key: 'y' })

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('make_decision', {
        slug: 'test-project', logicalPhotoId: 1, action: 'keep',
      })
    })
  })

  it('Enter opens SingleView with correct photoId', async () => {
    mockInvoke.mockImplementation(mockStackFocusRouter({
      list_logical_photos: [mockPhotos],
    }))

    render(StackFocus)
    await waitFor(() => screen.getAllByTestId('photo-card'))

    await fireEvent.keyDown(document, { key: 'Enter' })

    expect(navigation.current.kind).toBe('single-view')
    if (navigation.current.kind === 'single-view') {
      expect(navigation.current.photoId).toBe(1)
    }
  })

  it('Ctrl+Enter commits the round', async () => {
    mockInvoke.mockImplementation(mockStackFocusRouter({
      list_logical_photos: [mockPhotos],
      get_round_decisions: [[
        { logical_photo_id: 1, current_status: 'keep' },
        { logical_photo_id: 2, current_status: 'keep' },
        { logical_photo_id: 3, current_status: 'eliminate' },
      ]],
      get_round_status: {
        round_id: 1, round_number: 1, state: 'open',
        total_photos: 3, decided: 3, kept: 2, eliminated: 1, undecided: 0, committed_at: null,
      },
    }))

    render(StackFocus)
    await waitFor(() => screen.getAllByTestId('photo-card'))

    await fireEvent.keyDown(document, { key: 'Enter', ctrlKey: true })

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('commit_round', {
        slug: 'test-project', stackId: 1,
      })
    })
  })


  it('X key on focused photo calls makeDecision with eliminate', async () => {
    mockInvoke.mockImplementation(mockStackFocusRouter({
      list_logical_photos: [mockPhotos],
      make_decision: makeDecisionResult({ action: 'eliminate', current_status: 'eliminate' }),
    }))

    render(StackFocus)
    await waitFor(() => screen.getAllByTestId('photo-card'))

    await fireEvent.keyDown(document, { key: 'x' })

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('make_decision', {
        slug: 'test-project', logicalPhotoId: 1, action: 'eliminate',
      })
    })
  })

  it('eliminated photo has decision-eliminate badge element', async () => {
    // Use committed round so eliminated photos are visible in the grid
    mockInvoke.mockImplementation(mockStackFocusRouter({
      list_logical_photos: [mockPhotos],
      get_round_decisions: [[
        { logical_photo_id: 1, current_status: 'undecided' },
        { logical_photo_id: 2, current_status: 'eliminate' },
        { logical_photo_id: 3, current_status: 'undecided' },
      ]],
      get_round_status: {
        round_id: 1, round_number: 1, state: 'committed',
        total_photos: 3, decided: 1, kept: 0, eliminated: 1, undecided: 2, committed_at: '2024-01-15T12:00:00Z',
      },
      list_rounds: [[
        { round_id: 1, round_number: 1, state: 'committed', total_photos: 3, decided: 1, kept: 0, eliminated: 1, undecided: 2, committed_at: '2024-01-15T12:00:00Z' },
        { round_id: 2, round_number: 2, state: 'open', total_photos: 2, decided: 0, kept: 0, eliminated: 0, undecided: 2, committed_at: null },
      ]],
    }))

    render(StackFocus)

    await waitFor(() => {
      const cards = screen.getAllByTestId('photo-card')
      // Card at index 1 is the eliminated photo — it should have a red badge
      const redBadge = cards[1].querySelector(`${DECISION_SELECTORS.eliminate}, .bg-red-500`)
      expect(redBadge).toBeInTheDocument()
    })
  })

  it('Tab moves ring-blue-500 class to next undecided photo', async () => {
    const PHOTO_4: LogicalPhotoSummary = {
      logical_photo_id: 4,
      thumbnail_path: null,
      capture_time: null,
      camera_model: null,
      lens: null,
      has_raw: false,
      has_jpeg: true,
      aperture: null,
      shutter_speed: null,
      iso: null,
      focal_length: null,
    }
    const photos4 = [PHOTO_1, PHOTO_2, PHOTO_3, PHOTO_4]

    mockInvoke.mockImplementation(mockStackFocusRouter({
      list_logical_photos: [photos4],
      get_round_decisions: [[
        { logical_photo_id: 1, current_status: 'keep' },
        { logical_photo_id: 2, current_status: 'undecided' },
        { logical_photo_id: 3, current_status: 'eliminate' },
        { logical_photo_id: 4, current_status: 'undecided' },
      ]],
      get_round_status: {
        round_id: 1, round_number: 1, state: 'open',
        total_photos: 4, decided: 2, kept: 1, eliminated: 1, undecided: 2, committed_at: null,
      },
    }))

    render(StackFocus)
    await waitFor(() => screen.getAllByTestId('photo-card'))

    // Focus starts at index 0 (keep). Tab should jump to index 1 (undecided).
    await fireEvent.keyDown(document, { key: 'Tab' })

    await waitFor(() => {
      const cards = screen.getAllByTestId('photo-card')
      // Card at index 1 should now have the blue focus ring
      expect(frameClass(cards[1])).toContain('ring-blue-500')
    })
  })

  it('Shift+Tab moves ring-blue-500 class to previous undecided photo', async () => {
    const PHOTO_4: LogicalPhotoSummary = {
      logical_photo_id: 4,
      thumbnail_path: null,
      capture_time: null,
      camera_model: null,
      lens: null,
      has_raw: false,
      has_jpeg: true,
      aperture: null,
      shutter_speed: null,
      iso: null,
      focal_length: null,
    }
    const photos4 = [PHOTO_1, PHOTO_2, PHOTO_3, PHOTO_4]

    mockInvoke.mockImplementation(mockStackFocusRouter({
      list_logical_photos: [photos4],
      get_round_decisions: [[
        { logical_photo_id: 1, current_status: 'keep' },
        { logical_photo_id: 2, current_status: 'undecided' },
        { logical_photo_id: 3, current_status: 'eliminate' },
        { logical_photo_id: 4, current_status: 'undecided' },
      ]],
      get_round_status: {
        round_id: 1, round_number: 1, state: 'open',
        total_photos: 4, decided: 2, kept: 1, eliminated: 1, undecided: 2, committed_at: null,
      },
    }))

    render(StackFocus)
    await waitFor(() => screen.getAllByTestId('photo-card'))

    // Navigate to index 3 first
    await fireEvent.keyDown(document, { key: 'ArrowRight' })
    await fireEvent.keyDown(document, { key: 'ArrowRight' })
    await fireEvent.keyDown(document, { key: 'ArrowRight' })

    // Shift+Tab should jump backward to previous undecided — index 1
    await fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })

    await waitFor(() => {
      const cards = screen.getAllByTestId('photo-card')
      expect(frameClass(cards[1])).toContain('ring-blue-500')
    })
  })

  it('Compact status shows counts from roundStatus', async () => {
    const photos12: LogicalPhotoSummary[] = Array.from({ length: 12 }, (_, i) => ({
      logical_photo_id: i + 1,
      thumbnail_path: null,
      capture_time: null,
      camera_model: null,
      lens: null,
      has_raw: false,
      has_jpeg: true,
      aperture: null,
      shutter_speed: null,
      iso: null,
      focal_length: null,
    }))

    mockInvoke.mockImplementation(mockStackFocusRouter({
      list_logical_photos: [photos12],
      get_round_decisions: [
        photos12.map((p, i) => ({
          logical_photo_id: p.logical_photo_id,
          current_status: i < 3 ? 'keep' : i < 5 ? 'eliminate' : 'undecided',
        }))
      ],
      get_round_status: {
        round_id: 1, round_number: 1, state: 'open',
        total_photos: 12, decided: 5, kept: 3, eliminated: 2, undecided: 7, committed_at: null,
      },
    }))

    render(StackFocus)

    await waitFor(() => {
      const compact = screen.getByTestId('compact-status')
      expect(compact.textContent).toContain('3')
      expect(compact.textContent).toContain('2')
      expect(compact.textContent).toContain('7')
    })
  })
})

// --- COMMITTED ROUND GUARD ---


// --- BUG U-KEY: No undo decision (U key) ---

describe('StackFocus — U-KEY: undo decision via U key', () => {
  it('U key calls undo_decision for the focused photo', async () => {
    mockInvoke.mockImplementation(mockStackFocusRouter({
      list_logical_photos: [mockPhotos],
      get_round_decisions: [[
        { logical_photo_id: 1, current_status: 'keep' },
        { logical_photo_id: 2, current_status: 'undecided' },
        { logical_photo_id: 3, current_status: 'undecided' },
      ]],
      get_round_status: {
        round_id: 1, round_number: 1, state: 'open',
        total_photos: 3, decided: 1, kept: 1, eliminated: 0, undecided: 2, committed_at: null,
      },
    }))

    render(StackFocus)
    await waitFor(() => screen.getAllByTestId('photo-card'))

    // Photo 1 (index 0) is 'keep'. Press U to undo.
    await fireEvent.keyDown(document, { key: 'u' })

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('undo_decision', {
        slug: 'test-project', logicalPhotoId: 1,
      })
    })
  })

  it('U key after Y reverses the decision', async () => {
    mockInvoke.mockImplementation(mockStackFocusRouter({
      list_logical_photos: [mockPhotos],
      make_decision: makeDecisionResult(),
    }))

    render(StackFocus)
    await waitFor(() => screen.getAllByTestId('photo-card'))

    // Press Y to keep
    await fireEvent.keyDown(document, { key: 'y' })

    // Verify keep badge appeared
    await waitFor(() => {
      const cards = screen.getAllByTestId('photo-card')
      expect(cards[0].querySelector(DECISION_SELECTORS.keep)).toBeInTheDocument()
    })

    // Press U to undo — name says "reverses the decision"
    await fireEvent.keyDown(document, { key: 'u' })

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('undo_decision', {
        slug: 'test-project', logicalPhotoId: 1,
      })
    })

    // Name promises "reverses" — verify the keep badge is removed from UI
    await waitFor(() => {
      const cards = screen.getAllByTestId('photo-card')
      expect(cards[0].querySelector(DECISION_SELECTORS.keep)).not.toBeInTheDocument()
    })
  })
})

describe('StackFocus — SF-44: keyboard listener cleanup on destroy', () => {
  it('removes keydown listener when component is unmounted', async () => {
    mockInvoke.mockImplementation(mockStackFocusRouter({
      list_logical_photos: [mockPhotos],
    }))
    const removeSpy = vi.spyOn(window, 'removeEventListener')

    const { unmount } = render(StackFocus)
    await waitFor(() => screen.getAllByTestId('photo-card'))

    unmount()

    expect(removeSpy).toHaveBeenCalledWith('keydown', expect.any(Function))
    removeSpy.mockRestore()
  })
})

// ── K2: hjkl vim navigation in StackFocus ──────────────────────────────────

describe('StackFocus — K2: hjkl vim navigation', () => {
  it('l key moves ring-blue-500 class to next card', async () => {
    mockInvoke.mockImplementation(mockStackFocusRouter({
      list_logical_photos: [mockPhotos],
    }))
    render(StackFocus)
    await waitFor(() => screen.getAllByTestId('photo-card'))

    // Focus starts at index 0
    let cards = screen.getAllByTestId('photo-card')
    expect(frameClass(cards[0])).toContain('ring-blue-500')

    // Press 'l' to move right
    await fireEvent.keyDown(document, { key: 'l' })

    cards = screen.getAllByTestId('photo-card')
    expect(frameClass(cards[1])).toContain('ring-blue-500')
    expect(frameClass(cards[0])).not.toContain('ring-blue-500')
  })

  it('h key moves ring-blue-500 class to previous card', async () => {
    mockInvoke.mockImplementation(mockStackFocusRouter({
      list_logical_photos: [mockPhotos],
    }))
    render(StackFocus)
    await waitFor(() => screen.getAllByTestId('photo-card'))

    // Move right first
    await fireEvent.keyDown(document, { key: 'ArrowRight' })
    let cards = screen.getAllByTestId('photo-card')
    expect(frameClass(cards[1])).toContain('ring-blue-500')

    // Press 'h' to move left
    await fireEvent.keyDown(document, { key: 'h' })

    cards = screen.getAllByTestId('photo-card')
    expect(frameClass(cards[0])).toContain('ring-blue-500')
    expect(frameClass(cards[1])).not.toContain('ring-blue-500')
  })

  it('j key moves ring-blue-500 class down by 4 positions', async () => {
    // Need more than 4 photos for a 4-col grid to test down movement
    const photos8: LogicalPhotoSummary[] = Array.from({ length: 8 }, (_, i) => ({
      logical_photo_id: i + 1,
      thumbnail_path: null,
      capture_time: null,
      camera_model: null,
      lens: null,
      has_raw: false,
      has_jpeg: true,
      aperture: null,
      shutter_speed: null,
      iso: null,
      focal_length: null,
    }))

    mockInvoke.mockImplementation(mockStackFocusRouter({
      list_logical_photos: [photos8],
      get_round_decisions: [[]],
      get_round_status: { round_id: 1, round_number: 1, state: 'open', total_photos: 0, decided: 0, kept: 0, eliminated: 0, undecided: 0, committed_at: null },
    }))

    render(StackFocus)
    await waitFor(() => expect(screen.getAllByTestId('photo-card')).toHaveLength(8))

    // Press 'j' to move down (4 cols)
    await fireEvent.keyDown(document, { key: 'j' })

    const cards = screen.getAllByTestId('photo-card')
    expect(frameClass(cards[4])).toContain('ring-blue-500')
    expect(frameClass(cards[0])).not.toContain('ring-blue-500')
  })

  it('k key moves ring-blue-500 class up by 4 positions', async () => {
    const photos8: LogicalPhotoSummary[] = Array.from({ length: 8 }, (_, i) => ({
      logical_photo_id: i + 1,
      thumbnail_path: null,
      capture_time: null,
      camera_model: null,
      lens: null,
      has_raw: false,
      has_jpeg: true,
      aperture: null,
      shutter_speed: null,
      iso: null,
      focal_length: null,
    }))

    mockInvoke.mockImplementation(mockStackFocusRouter({
      list_logical_photos: [photos8],
      get_round_decisions: [[]],
      get_round_status: { round_id: 1, round_number: 1, state: 'open', total_photos: 0, decided: 0, kept: 0, eliminated: 0, undecided: 0, committed_at: null },
    }))

    render(StackFocus)
    await waitFor(() => expect(screen.getAllByTestId('photo-card')).toHaveLength(8))

    // Move down first
    await fireEvent.keyDown(document, { key: 'ArrowDown' })
    let cards = screen.getAllByTestId('photo-card')
    expect(frameClass(cards[4])).toContain('ring-blue-500')

    // Press 'k' to move up
    await fireEvent.keyDown(document, { key: 'k' })

    cards = screen.getAllByTestId('photo-card')
    expect(frameClass(cards[0])).toContain('ring-blue-500')
    expect(frameClass(cards[4])).not.toContain('ring-blue-500')
  })

  it('Ctrl+h does not move ring-blue-500 class (modifier guard)', async () => {
    mockInvoke.mockImplementation(mockStackFocusRouter({
      list_logical_photos: [mockPhotos],
    }))
    render(StackFocus)
    await waitFor(() => screen.getAllByTestId('photo-card'))

    // Move right first
    await fireEvent.keyDown(document, { key: 'ArrowRight' })
    let cards = screen.getAllByTestId('photo-card')
    expect(frameClass(cards[1])).toContain('ring-blue-500')

    // Press Ctrl+h — should NOT move focus
    await fireEvent.keyDown(document, { key: 'h', ctrlKey: true })

    cards = screen.getAllByTestId('photo-card')
    expect(frameClass(cards[1])).toContain('ring-blue-500')
  })

  it('Shift+h does not move ring-blue-500 class (modifier guard)', async () => {
    mockInvoke.mockImplementation(mockStackFocusRouter({
      list_logical_photos: [mockPhotos],
    }))
    render(StackFocus)
    await waitFor(() => screen.getAllByTestId('photo-card'))

    // Move right first
    await fireEvent.keyDown(document, { key: 'ArrowRight' })
    let cards = screen.getAllByTestId('photo-card')
    expect(frameClass(cards[1])).toContain('ring-blue-500')

    // Press Shift+h — should NOT move focus (H is uppercase)
    await fireEvent.keyDown(document, { key: 'H', shiftKey: true })

    cards = screen.getAllByTestId('photo-card')
    expect(frameClass(cards[1])).toContain('ring-blue-500')
  })
})

// ── K4: Home/End in StackFocus ─────────────────────────────────────────────

describe('StackFocus — K4: Home/End navigation', () => {
  it('Home key moves ring-blue-500 class to first card', async () => {
    mockInvoke.mockImplementation(mockStackFocusRouter({
      list_logical_photos: [mockPhotos],
    }))
    render(StackFocus)
    await waitFor(() => screen.getAllByTestId('photo-card'))

    // Move to last photo
    await fireEvent.keyDown(document, { key: 'ArrowRight' })
    await fireEvent.keyDown(document, { key: 'ArrowRight' })
    let cards = screen.getAllByTestId('photo-card')
    expect(frameClass(cards[2])).toContain('ring-blue-500')

    // Press Home
    await fireEvent.keyDown(document, { key: 'Home' })

    cards = screen.getAllByTestId('photo-card')
    expect(frameClass(cards[0])).toContain('ring-blue-500')
    expect(frameClass(cards[2])).not.toContain('ring-blue-500')
  })

  it('End key moves ring-blue-500 class to last card', async () => {
    mockInvoke.mockImplementation(mockStackFocusRouter({
      list_logical_photos: [mockPhotos],
    }))
    render(StackFocus)
    await waitFor(() => screen.getAllByTestId('photo-card'))

    // Focus starts at 0
    let cards = screen.getAllByTestId('photo-card')
    expect(frameClass(cards[0])).toContain('ring-blue-500')

    // Press End
    await fireEvent.keyDown(document, { key: 'End' })

    cards = screen.getAllByTestId('photo-card')
    expect(frameClass(cards[2])).toContain('ring-blue-500')
    expect(frameClass(cards[0])).not.toContain('ring-blue-500')
  })
})

// ── K5: E key in StackFocus opens SingleView ───────────────────────────────

describe('StackFocus — K5: E key opens SingleView', () => {
  it('e key navigates to SingleView (same as Enter)', async () => {
    mockInvoke.mockImplementation(mockStackFocusRouter({
      list_logical_photos: [mockPhotos],
    }))
    render(StackFocus)
    await waitFor(() => screen.getAllByTestId('photo-card'))

    await fireEvent.keyDown(document, { key: 'e' })

    expect(navigation.current.kind).toBe('single-view')
    if (navigation.current.kind === 'single-view') {
      expect(navigation.current.photoId).toBe(1)
    }
  })

  it('E key (uppercase) also navigates to SingleView', async () => {
    mockInvoke.mockImplementation(mockStackFocusRouter({
      list_logical_photos: [mockPhotos],
    }))
    render(StackFocus)
    await waitFor(() => screen.getAllByTestId('photo-card'))

    await fireEvent.keyDown(document, { key: 'E' })

    expect(navigation.current.kind).toBe('single-view')
    if (navigation.current.kind === 'single-view') {
      expect(navigation.current.photoId).toBe(1)
    }
  })

  it('e key on second photo opens SingleView with correct photoId', async () => {
    mockInvoke.mockImplementation(mockStackFocusRouter({
      list_logical_photos: [mockPhotos],
    }))
    render(StackFocus)
    await waitFor(() => screen.getAllByTestId('photo-card'))

    // Move to second photo
    await fireEvent.keyDown(document, { key: 'ArrowRight' })

    await fireEvent.keyDown(document, { key: 'e' })

    expect(navigation.current.kind).toBe('single-view')
    if (navigation.current.kind === 'single-view') {
      expect(navigation.current.photoId).toBe(2)
    }
  })
})

// ─── Camera params on grid cards ─────────────────────────────────────────────

describe('StackFocus — camera params display', () => {
  it('renders full camera params line when all four params are present', async () => {
    const photosWithParams: LogicalPhotoSummary[] = [
      { ...PHOTO_1, aperture: 2.8, shutter_speed: '1/250', iso: 400, focal_length: 85 },
      PHOTO_2,
      PHOTO_3,
    ]
    mockInvoke.mockImplementation(mockStackFocusRouter({
      list_logical_photos: [photosWithParams],
    }))
    render(StackFocus)

    // Wait for cards to render
    await waitFor(() => {
      expect(screen.getAllByTestId('photo-card').length).toBe(3)
    })

    // Card 0 should show formatted camera params
    const card = screen.getAllByTestId('photo-card')[0]
    expect(card.textContent).toContain('f/2.8')
    expect(card.textContent).toContain('1/250')
    expect(card.textContent).toContain('ISO400')
    expect(card.textContent).toContain('85mm')
  })

  it('renders partial camera params omitting null fields', async () => {
    // Only aperture and ISO set
    const photosWithParams: LogicalPhotoSummary[] = [
      { ...PHOTO_1, aperture: 5.6, shutter_speed: null, iso: 800, focal_length: null },
      PHOTO_2,
      PHOTO_3,
    ]
    mockInvoke.mockImplementation(mockStackFocusRouter({
      list_logical_photos: [photosWithParams],
    }))
    render(StackFocus)

    await waitFor(() => {
      expect(screen.getAllByTestId('photo-card').length).toBe(3)
    })

    const card = screen.getAllByTestId('photo-card')[0]
    expect(card.textContent).toContain('f/5.6')
    expect(card.textContent).toContain('ISO800')
    // Should NOT contain shutter_speed or focal_length placeholders
    expect(card.textContent).not.toContain('null')
    expect(card.textContent).not.toContain('undefined')
  })

  it('does not render camera params line when all params are null', async () => {
    // All params null — use photos with no lens containing "f/" to avoid false match
    const photosNoParams: LogicalPhotoSummary[] = [
      { ...PHOTO_1, lens: '85mm Prime', aperture: null, shutter_speed: null, iso: null, focal_length: null },
      PHOTO_2,
      PHOTO_3,
    ]
    mockInvoke.mockImplementation(mockStackFocusRouter({
      list_logical_photos: [photosNoParams],
    }))
    render(StackFocus)

    await waitFor(() => {
      expect(screen.getAllByTestId('photo-card').length).toBe(3)
    })

    // Card 0 should have no camera params data-testid element
    const card = screen.getAllByTestId('photo-card')[0]
    expect(card.querySelector('[data-testid="camera-params"]')).toBeNull()
  })
})

// ─── C key enters comparison mode ─────────────────────────────────────────────

describe('StackFocus — C key comparison mode', () => {
  it('C key without 2 selected shows error instead of navigating', async () => {
    mockInvoke.mockImplementation(mockStackFocusRouter({
      list_logical_photos: [mockPhotos],
    }))
    render(StackFocus)

    await waitFor(() => {
      expect(screen.getAllByTestId('photo-card').length).toBe(3)
    })

    await fireEvent.keyDown(document, { key: 'c' })

    expect(navigation.current.kind).toBe('stack-focus')
    await waitFor(() => {
      expect(screen.getByTestId('action-error')).toBeInTheDocument()
    })
  })

  it('C key shows error when < 2 undecided photos', async () => {
    mockInvoke.mockImplementation(mockStackFocusRouter({
      list_logical_photos: [mockPhotos],
      get_round_decisions: [[
        { logical_photo_id: 1, current_status: 'keep' },
        { logical_photo_id: 2, current_status: 'keep' },
        { logical_photo_id: 3, current_status: 'undecided' },
      ]],
      get_round_status: { ...OPEN_ROUND, decided: 2, kept: 2, undecided: 1 },
    }))
    render(StackFocus)

    await waitFor(() => {
      expect(screen.getAllByTestId('photo-card').length).toBe(3)
    })

    await fireEvent.keyDown(document, { key: 'c' })

    // Should stay in stack-focus
    expect(navigation.current.kind).toBe('stack-focus')

    // Should show error
    await waitFor(() => {
      expect(screen.getByTestId('action-error')).toBeInTheDocument()
      expect(screen.getByTestId('action-error').textContent).toContain('Select 2 photos to compare')
    })
  })

  it('C key with 1-photo stack shows error', async () => {
    mockInvoke.mockImplementation(mockStackFocusRouter({
      list_logical_photos: [[PHOTO_1]],
      get_round_decisions: [[
        { logical_photo_id: 1, current_status: 'undecided' },
      ]],
      get_round_status: { ...OPEN_ROUND, total_photos: 1, undecided: 1 },
    }))
    render(StackFocus)

    await waitFor(() => {
      expect(screen.getAllByTestId('photo-card').length).toBe(1)
    })

    await fireEvent.keyDown(document, { key: 'c' })

    // Should stay in stack-focus (photos.length < 2 guard)
    expect(navigation.current.kind).toBe('stack-focus')

    // Name says "shows error" — verify error message is displayed
    await waitFor(() => {
      expect(screen.getByTestId('action-error')).toBeInTheDocument()
    })
  })
})

// ─── Click-to-SingleView ─────────────────────────────────────────────────────

describe('StackFocus — click-to-SingleView', () => {
  it('clicking a photo card navigates to SingleView for that photo', async () => {
    mockInvoke.mockImplementation(mockStackFocusRouter({
      list_logical_photos: [mockPhotos],
    }))
    render(StackFocus)

    await waitFor(() => {
      expect(screen.getAllByTestId('photo-card').length).toBe(3)
    })

    // Click the second card (PHOTO_2, logical_photo_id=2)
    const cards = screen.getAllByTestId('photo-card')
    await fireEvent.click(cards[1])

    // Should navigate to SingleView with photo 2
    expect(navigation.current.kind).toBe('single-view')
    if (navigation.current.kind === 'single-view') {
      expect(navigation.current.photoId).toBe(2)
    }
  })
})

// ─── Auto-advance toggle ─────────────────────────────────────────────────────

describe('StackFocus — auto-advance', () => {
  it('A key toggles auto-advance indicator in header', async () => {
    mockInvoke.mockImplementation(mockStackFocusRouter({
      list_logical_photos: [mockPhotos],
    }))
    render(StackFocus)

    await waitFor(() => {
      expect(screen.getAllByTestId('photo-card').length).toBe(3)
    })

    // Initially no auto-advance indicator
    expect(document.body.textContent).not.toContain('Auto-advance: ON')

    // Press A to enable
    await fireEvent.keyDown(document, { key: 'a' })

    await waitFor(() => {
      expect(document.body.textContent).toContain('Auto-advance: ON')
    })

    // Press A again to disable
    await fireEvent.keyDown(document, { key: 'a' })

    await waitFor(() => {
      expect(document.body.textContent).not.toContain('Auto-advance: ON')
    })
  })

  it('auto-advance OFF: Y key decides but ring-blue-500 class stays on same card', async () => {
    mockInvoke.mockImplementation(mockStackFocusRouter({
      list_logical_photos: [mockPhotos],
      get_round_decisions: [[
        { logical_photo_id: 1, current_status: 'undecided' },
        { logical_photo_id: 2, current_status: 'undecided' },
        { logical_photo_id: 3, current_status: 'undecided' },
      ]],
      make_decision: makeDecisionResult({ action: 'keep', current_status: 'keep' }),
      get_round_status: { round_id: 1, round_number: 1, state: 'open', total_photos: 3, decided: 1, kept: 1, eliminated: 0, undecided: 2, committed_at: null },
    }))
    render(StackFocus)

    await waitFor(() => {
      expect(screen.getAllByTestId('photo-card').length).toBe(3)
    })

    // Focus is on card 0
    await fireEvent.keyDown(document, { key: 'y' })

    // Wait for decision to be processed
    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('make_decision', expect.objectContaining({ action: 'keep' }))
    })

    // Focus should still be on card 0 (no auto-advance)
    const cards = screen.getAllByTestId('photo-card')
    expect(frameClass(cards[0])).toContain('ring-blue-500')
  })

  it('auto-advance ON: Y key decides and moves ring-blue-500 class to next undecided', async () => {
    mockInvoke.mockImplementation(mockStackFocusRouter({
      list_logical_photos: [mockPhotos],
      get_round_decisions: [[
        { logical_photo_id: 1, current_status: 'undecided' },
        { logical_photo_id: 2, current_status: 'undecided' },
        { logical_photo_id: 3, current_status: 'undecided' },
      ]],
      make_decision: makeDecisionResult({ action: 'keep', current_status: 'keep' }),
      get_round_status: { round_id: 1, round_number: 1, state: 'open', total_photos: 3, decided: 1, kept: 1, eliminated: 0, undecided: 2, committed_at: null },
    }))
    render(StackFocus)

    await waitFor(() => {
      expect(screen.getAllByTestId('photo-card').length).toBe(3)
    })

    // Enable auto-advance
    await fireEvent.keyDown(document, { key: 'a' })

    await fireEvent.keyDown(document, { key: 'y' })

    // Wait for decision
    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('make_decision', expect.objectContaining({ action: 'keep' }))
    })

    // Focus should advance to card 1 (next undecided)
    await waitFor(() => {
      const cards = screen.getAllByTestId('photo-card')
      expect(frameClass(cards[1])).toContain('ring-blue-500')
    })
  })
})

// ─── F key path overlay ──────────────────────────────────────────────────────

describe('StackFocus — F key path overlay', () => {
  it('F key shows file path overlay on focused photo', async () => {
    mockInvoke.mockImplementation(mockStackFocusRouter({
      list_logical_photos: [mockPhotos],
      get_photo_detail: {
        logical_photo_id: 1,
        thumbnail_path: null,
        capture_time: '2024-01-15T10:30:00Z',
        camera_model: 'Canon EOS 5D',
        lens: 'EF 85mm f/1.4',
        has_raw: true,
        has_jpeg: true,
        current_status: 'undecided',
        aperture: null, shutter_speed: null, iso: null, focal_length: null, exposure_comp: null,
        jpeg_path: '/home/user/Photos/IMG_001.jpg',
        raw_path: '/home/user/Photos/IMG_001.CR3',
        preview_path: null,
      },
    }))
    render(StackFocus)

    await waitFor(() => {
      expect(screen.getAllByTestId('photo-card').length).toBe(3)
    })

    await fireEvent.keyDown(document, { key: 'f' })

    // Overlay should show only the displayed format path (JPEG), not RAW
    await waitFor(() => {
      const overlay = screen.getByTestId('file-path-overlay')
      expect(overlay.textContent).toContain('/home/user/Photos/IMG_001.jpg')
      expect(overlay.textContent).not.toContain('/home/user/Photos/IMG_001.CR3')
    })
  })

  it('F key again hides the overlay (toggle)', async () => {
    mockInvoke.mockImplementation(mockStackFocusRouter({
      list_logical_photos: [mockPhotos],
      get_photo_detail: {
        logical_photo_id: 1,
        thumbnail_path: null,
        capture_time: '2024-01-15T10:30:00Z',
        camera_model: 'Canon EOS 5D',
        lens: 'EF 85mm f/1.4',
        has_raw: true,
        has_jpeg: true,
        current_status: 'undecided',
        aperture: null, shutter_speed: null, iso: null, focal_length: null, exposure_comp: null,
        jpeg_path: '/home/user/Photos/IMG_001.jpg',
        raw_path: null,
        preview_path: null,
      },
    }))
    render(StackFocus)

    await waitFor(() => {
      expect(screen.getAllByTestId('photo-card').length).toBe(3)
    })

    // First F — show overlay
    await fireEvent.keyDown(document, { key: 'f' })
    await waitFor(() => {
      expect(document.body.textContent).toContain('/home/user/Photos/IMG_001.jpg')
    })

    // Second F — hide overlay
    await fireEvent.keyDown(document, { key: 'f' })
    await waitFor(() => {
      expect(document.body.textContent).not.toContain('/home/user/Photos/IMG_001.jpg')
    })
  })
})

// ─── Fix 1: Ctrl+Enter commit hides eliminated photos from grid ─────────────

describe('StackFocus — commit hides eliminated photos', () => {
  it('Ctrl+Enter with 2 eliminated + 1 kept leaves only 1 photo card in grid', async () => {
    const survivorPhotos: LogicalPhotoSummary[] = [PHOTO_1]

    mockInvoke.mockImplementation(mockStackFocusRouter({
      list_logical_photos: [mockPhotos, survivorPhotos],
      get_round_decisions: [
        [
          { logical_photo_id: 1, current_status: 'keep' },
          { logical_photo_id: 2, current_status: 'eliminate' },
          { logical_photo_id: 3, current_status: 'eliminate' },
        ],
        [
          { logical_photo_id: 1, current_status: 'undecided' },
        ],
      ],
      get_round_status: [
        // Initial: open, all decided
        { round_id: 1, round_number: 1, state: 'open', total_photos: 3, decided: 3, kept: 1, eliminated: 2, undecided: 0, committed_at: null },
        // After commit: new round 2 with 1 survivor
        { round_id: 2, round_number: 2, state: 'open', total_photos: 1, decided: 0, kept: 0, eliminated: 0, undecided: 1, committed_at: null },
      ],
    }))

    render(StackFocus)
    // All photos visible in grid (eliminated stay with status indicators)
    await waitFor(() => {
      expect(screen.getAllByTestId('photo-card')).toHaveLength(3)
    })

    // Commit the round
    await fireEvent.keyDown(document, { key: 'Enter', ctrlKey: true })

    // After commit, re-fetch returns only survivors
    await waitFor(() => {
      expect(screen.getAllByTestId('photo-card')).toHaveLength(1)
    })
  })

  it('Y key still works on remaining photos after commit (not blocked)', async () => {
    const survivorPhotos: LogicalPhotoSummary[] = [PHOTO_1]

    mockInvoke.mockImplementation(mockStackFocusRouter({
      list_logical_photos: [mockPhotos, survivorPhotos],
      get_round_decisions: [
        [
          { logical_photo_id: 1, current_status: 'keep' },
          { logical_photo_id: 2, current_status: 'eliminate' },
          { logical_photo_id: 3, current_status: 'eliminate' },
        ],
        [
          { logical_photo_id: 1, current_status: 'undecided' },
        ],
      ],
      get_round_status: [
        // Initial: open
        { round_id: 1, round_number: 1, state: 'open', total_photos: 3, decided: 3, kept: 1, eliminated: 2, undecided: 0, committed_at: null },
        // After commit: open new round with 1 survivor
        { round_id: 2, round_number: 2, state: 'open', total_photos: 1, decided: 0, kept: 0, eliminated: 0, undecided: 1, committed_at: null },
        // After Y key decision
        { round_id: 2, round_number: 2, state: 'open', total_photos: 1, decided: 1, kept: 1, eliminated: 0, undecided: 0, committed_at: null },
      ],
      make_decision: makeDecisionResult({ decision_id: 10, round_id: 2, action: 'keep', current_status: 'keep' }),
    }))

    render(StackFocus)
    await waitFor(() => screen.getAllByTestId('photo-card'))

    // Commit
    await fireEvent.keyDown(document, { key: 'Enter', ctrlKey: true })

    // After commit, grid should show only the 1 remaining survivor
    await waitFor(() => {
      expect(screen.getAllByTestId('photo-card')).toHaveLength(1)
    })

    // Now press Y on the remaining photo — should NOT be blocked
    await fireEvent.keyDown(document, { key: 'y' })

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('make_decision', expect.objectContaining({ action: 'keep' }))
    })
  })

  it('Ctrl+Enter with all eliminated shows empty message', async () => {
    mockInvoke.mockImplementation(mockStackFocusRouter({
      list_logical_photos: [mockPhotos, []],
      get_round_decisions: [
        [
          { logical_photo_id: 1, current_status: 'eliminate' },
          { logical_photo_id: 2, current_status: 'eliminate' },
          { logical_photo_id: 3, current_status: 'eliminate' },
        ],
        [],
      ],
      get_round_status: [
        { round_id: 1, round_number: 1, state: 'open', total_photos: 3, decided: 3, kept: 0, eliminated: 3, undecided: 0, committed_at: null },
        { round_id: 2, round_number: 2, state: 'open', total_photos: 0, decided: 0, kept: 0, eliminated: 0, undecided: 0, committed_at: null },
      ],
    }))

    render(StackFocus)
    // All photos visible in grid (eliminated stay with status indicators)
    await waitFor(() => {
      expect(screen.getAllByTestId('photo-card')).toHaveLength(3)
    })

    // Commit the round
    await fireEvent.keyDown(document, { key: 'Enter', ctrlKey: true })

    // After commit, no survivors → empty grid
    await waitFor(() => {
      expect(screen.queryAllByTestId('photo-card')).toHaveLength(0)
      expect(screen.getByText('No photos in this stack.')).toBeInTheDocument()
    })
  })
})

// ─── Fix 2: C key requires exactly 2 selected ──────────────────────────────

describe('StackFocus — C key requires 2 selected', () => {
  it('C with 0 selected shows error and stays on stack-focus', async () => {
    mockInvoke.mockImplementation(mockStackFocusRouter({
      list_logical_photos: [mockPhotos],
      get_round_decisions: [[
        { logical_photo_id: 1, current_status: 'undecided' },
        { logical_photo_id: 2, current_status: 'undecided' },
        { logical_photo_id: 3, current_status: 'undecided' },
      ]],
    }))
    render(StackFocus)

    await waitFor(() => {
      expect(screen.getAllByTestId('photo-card').length).toBe(3)
    })

    // Press C without any selection
    await fireEvent.keyDown(document, { key: 'c' })

    // Should stay on stack-focus (NOT auto-fill to comparison-view)
    expect(navigation.current.kind).toBe('stack-focus')

    // Should show error telling user to select 2 photos
    await waitFor(() => {
      expect(screen.getByTestId('action-error')).toBeInTheDocument()
      expect(screen.getByTestId('action-error').textContent).toContain('Select 2 photos to compare')
    })
  })

  it('C with 1 selected shows error and stays on stack-focus', async () => {
    mockInvoke.mockImplementation(mockStackFocusRouter({
      list_logical_photos: [mockPhotos],
      get_round_decisions: [[
        { logical_photo_id: 1, current_status: 'undecided' },
        { logical_photo_id: 2, current_status: 'undecided' },
        { logical_photo_id: 3, current_status: 'undecided' },
      ]],
    }))
    render(StackFocus)

    await waitFor(() => {
      expect(screen.getAllByTestId('photo-card').length).toBe(3)
    })

    // Select just 1 photo with S key
    await fireEvent.keyDown(document, { key: 's' })

    // Press C with only 1 selected
    await fireEvent.keyDown(document, { key: 'c' })

    // Should stay on stack-focus
    expect(navigation.current.kind).toBe('stack-focus')

    // Should show error
    await waitFor(() => {
      expect(screen.getByTestId('action-error')).toBeInTheDocument()
      expect(screen.getByTestId('action-error').textContent).toContain('Select 2 photos to compare')
    })
  })
})

// ─── Fix 3: Toast for silent Tab failures ───────────────────────────────────

describe('StackFocus — Tab shows toast when all photos decided', () => {
  it('Tab when all photos decided shows "No undecided photos" error', async () => {
    mockInvoke.mockImplementation(mockStackFocusRouter({
      list_logical_photos: [mockPhotos],
      get_round_decisions: [[
        { logical_photo_id: 1, current_status: 'keep' },
        { logical_photo_id: 2, current_status: 'eliminate' },
        { logical_photo_id: 3, current_status: 'keep' },
      ]],
      get_round_status: {
        round_id: 1, round_number: 1, state: 'open',
        total_photos: 3, decided: 3, kept: 2, eliminated: 1, undecided: 0, committed_at: null,
      },
    }))

    render(StackFocus)
    await waitFor(() => screen.getAllByTestId('photo-card'))

    await fireEvent.keyDown(document, { key: 'Tab' })

    await waitFor(() => {
      expect(screen.getByTestId('action-error')).toBeInTheDocument()
      expect(screen.getByTestId('action-error').textContent).toContain('No undecided photos')
    })
  })
})

// ─── Multi-select (Shift+Arrow, S key) ───────────────────────────────────────

describe('StackFocus — multi-select', () => {
  it('Shift+ArrowRight adds ring-yellow class to current and next card', async () => {
    mockInvoke.mockImplementation(mockStackFocusRouter({
      list_logical_photos: [mockPhotos],
    }))
    render(StackFocus)

    await waitFor(() => {
      expect(screen.getAllByTestId('photo-card').length).toBe(3)
    })

    // Card 0 is focused. Shift+ArrowRight should select card 0 and card 1
    await fireEvent.keyDown(document, { key: 'ArrowRight', shiftKey: true })

    const cards = screen.getAllByTestId('photo-card')
    expect(frameClass(cards[0])).toContain('ring-yellow')
    expect(frameClass(cards[1])).toContain('ring-yellow')
    expect(frameClass(cards[2])).not.toContain('ring-yellow')
  })

  it('plain ArrowRight removes ring-yellow classes after Shift+Arrow', async () => {
    mockInvoke.mockImplementation(mockStackFocusRouter({
      list_logical_photos: [mockPhotos],
    }))
    render(StackFocus)

    await waitFor(() => {
      expect(screen.getAllByTestId('photo-card').length).toBe(3)
    })

    // Create a selection with Shift+ArrowRight
    await fireEvent.keyDown(document, { key: 'ArrowRight', shiftKey: true })

    // Verify selection exists
    let cards = screen.getAllByTestId('photo-card')
    expect(frameClass(cards[0])).toContain('ring-yellow')

    // Plain ArrowRight should clear all yellow rings
    await fireEvent.keyDown(document, { key: 'ArrowRight' })

    cards = screen.getAllByTestId('photo-card')
    for (const card of cards) {
      expect(frameClass(card)).not.toContain('ring-yellow')
    }
  })

  it('S key toggles ring-yellow class on focused card', async () => {
    mockInvoke.mockImplementation(mockStackFocusRouter({
      list_logical_photos: [mockPhotos],
    }))
    render(StackFocus)

    await waitFor(() => {
      expect(screen.getAllByTestId('photo-card').length).toBe(3)
    })

    // Press S to select the focused card (card 0)
    await fireEvent.keyDown(document, { key: 's' })

    let cards = screen.getAllByTestId('photo-card')
    expect(frameClass(cards[0])).toContain('ring-yellow')

    // Press S again to deselect
    await fireEvent.keyDown(document, { key: 's' })

    cards = screen.getAllByTestId('photo-card')
    expect(frameClass(cards[0])).not.toContain('ring-yellow')
  })

  it('third Shift+Arrow does not add ring-yellow class beyond 2 cards', async () => {
    const fourPhotos = makePhotoList(4)
    mockInvoke.mockImplementation(mockStackFocusRouter({
      list_logical_photos: [fourPhotos],
      get_round_decisions: [[
        { logical_photo_id: 1, current_status: 'undecided' },
        { logical_photo_id: 2, current_status: 'undecided' },
        { logical_photo_id: 3, current_status: 'undecided' },
        { logical_photo_id: 4, current_status: 'undecided' },
      ]],
      get_round_status: { ...OPEN_ROUND, total_photos: 4, undecided: 4 },
    }))

    render(StackFocus)

    await waitFor(() => {
      expect(screen.getAllByTestId('photo-card').length).toBe(4)
    })

    // Select card 0 with S
    await fireEvent.keyDown(document, { key: 's' })

    // Move to card 1 and select with S
    await fireEvent.keyDown(document, { key: 'ArrowRight' })
    await fireEvent.keyDown(document, { key: 's' })

    // Move to card 2 and try to select with S — should be rejected
    await fireEvent.keyDown(document, { key: 'ArrowRight' })
    await fireEvent.keyDown(document, { key: 's' })

    const cards = screen.getAllByTestId('photo-card')
    const selectedCount = Array.from(cards).filter(c => frameClass(c).includes('ring-yellow')).length
    expect(selectedCount).toBe(2)
  })

  it('C key with 2 selected navigates to ComparisonView with selected photos', async () => {
    mockInvoke.mockImplementation(mockStackFocusRouter({
      list_logical_photos: [mockPhotos],
    }))
    render(StackFocus)

    await waitFor(() => {
      expect(screen.getAllByTestId('photo-card').length).toBe(3)
    })

    // Select card 0 with S
    await fireEvent.keyDown(document, { key: 's' })

    // Move to card 2 (skip card 1) and select with S
    await fireEvent.keyDown(document, { key: 'ArrowRight' })
    await fireEvent.keyDown(document, { key: 'ArrowRight' })
    await fireEvent.keyDown(document, { key: 's' })

    // Verify 2 cards are selected (yellow ring)
    const cards = screen.getAllByTestId('photo-card')
    const selectedCount = Array.from(cards).filter(c => frameClass(c).includes('ring-yellow')).length
    expect(selectedCount).toBe(2)

    // Press C to enter comparison mode with the 2 selected photos
    await fireEvent.keyDown(document, { key: 'c' })

    expect(navigation.current.kind).toBe('comparison-view')
    // The name promises "with selected photos" — verify the selected photo IDs are passed
    if (navigation.current.kind === 'comparison-view') {
      expect((navigation.current as any).photoIds).toEqual([1, 3])
    }
  })
})

// ─── Bug 1: Selection cleared after commit ────────────────────────────────

describe('StackFocus — Bug 1: selection cleared after commit', () => {
  it('S key to select, then Ctrl+Enter clears ring-yellow from all cards', async () => {
    const survivorPhotos: LogicalPhotoSummary[] = [PHOTO_1, PHOTO_2]

    mockInvoke.mockImplementation(mockStackFocusRouter({
      list_logical_photos: [mockPhotos, survivorPhotos],
      get_round_decisions: [
        [
          { logical_photo_id: 1, current_status: 'keep' },
          { logical_photo_id: 2, current_status: 'keep' },
          { logical_photo_id: 3, current_status: 'eliminate' },
        ],
        [
          { logical_photo_id: 1, current_status: 'undecided' },
          { logical_photo_id: 2, current_status: 'undecided' },
        ],
      ],
      get_round_status: [
        { round_id: 1, round_number: 1, state: 'open', total_photos: 3, decided: 3, kept: 2, eliminated: 1, undecided: 0, committed_at: null },
        { round_id: 2, round_number: 2, state: 'open', total_photos: 2, decided: 0, kept: 0, eliminated: 0, undecided: 2, committed_at: null },
      ],
    }))

    render(StackFocus)
    await waitFor(() => screen.getAllByTestId('photo-card'))

    // Select photo 1 with S key
    await fireEvent.keyDown(document, { key: 's' })

    // Verify selection exists
    let cards = screen.getAllByTestId('photo-card')
    expect(frameClass(cards[0])).toContain('ring-yellow')

    // Commit the round
    await fireEvent.keyDown(document, { key: 'Enter', ctrlKey: true })

    // After commit, no card should have ring-yellow (selection cleared)
    await waitFor(() => {
      const updatedCards = screen.getAllByTestId('photo-card')
      for (const card of updatedCards) {
        expect(frameClass(card)).not.toContain('ring-yellow')
      }
    })
  })
})

// ─── Round-commit: grid re-fetches survivors after Ctrl+Enter ───────────────

describe('StackFocus — round commit re-fetches survivors', () => {
  it('Ctrl+Enter re-fetches photos and grid shows only undecided survivors', async () => {
    // Spec §3-4: After commit_round, frontend must re-fetch list_logical_photos
    // for the new round. Grid should show survivors as undecided (no badges).

    // Survivor photos returned after commit (only 2 survivors, both undecided)
    const survivorPhotos: LogicalPhotoSummary[] = [
      { ...PHOTO_1, logical_photo_id: 1 },
      { ...PHOTO_3, logical_photo_id: 3 },
    ]

    mockInvoke.mockImplementation(mockStackFocusRouter({
      // First call returns 3 photos, second call (after commit) returns 2 survivors
      list_logical_photos: [mockPhotos, survivorPhotos],
      get_round_decisions: [
        // Initial: all decided
        [
          { logical_photo_id: 1, current_status: 'keep' },
          { logical_photo_id: 2, current_status: 'eliminate' },
          { logical_photo_id: 3, current_status: 'keep' },
        ],
        // After commit: survivors are undecided
        [
          { logical_photo_id: 1, current_status: 'undecided' },
          { logical_photo_id: 3, current_status: 'undecided' },
        ],
      ],
      get_round_status: [
        // Initial: open, all decided
        { round_id: 1, round_number: 1, state: 'open', total_photos: 3, decided: 3, kept: 2, eliminated: 1, undecided: 0, committed_at: null },
        // After commit: new round 2, open, all undecided
        { round_id: 2, round_number: 2, state: 'open', total_photos: 2, decided: 0, kept: 0, eliminated: 0, undecided: 2, committed_at: null },
      ],
      commit_round: { new_round_id: 2, survivors: 2 },
    }))

    render(StackFocus)
    // All photos visible in grid (eliminated stays with red border)
    await waitFor(() => {
      expect(screen.getAllByTestId('photo-card')).toHaveLength(3)
    })

    // Commit the round
    await fireEvent.keyDown(document, { key: 'Enter', ctrlKey: true })

    // After commit, survivors should have NO decision badges (all undecided)
    await waitFor(() => {
      const cards = screen.getAllByTestId('photo-card')
      expect(cards).toHaveLength(2)
      for (const card of cards) {
        expect(card.querySelector(DECISION_SELECTORS.keep)).not.toBeInTheDocument()
        expect(card.querySelector(DECISION_SELECTORS.eliminate)).not.toBeInTheDocument()
      }
    })

    // Compact status should reflect updated round data
    expect(screen.getByTestId('compact-status')).toBeInTheDocument()
  })
})


// ─── Bug 4: Tab navigates correctly in filtered grid ───────────────────────

describe('StackFocus — Bug 4: Tab navigates in filtered grid after commit', () => {
  it('Tab after commit with eliminated photos lands on visible undecided photo', async () => {
    const PHOTO_4: LogicalPhotoSummary = {
      logical_photo_id: 4, thumbnail_path: null, capture_time: null,
      camera_model: null, lens: null, has_raw: false, has_jpeg: true,
      aperture: null, shutter_speed: null, iso: null, focal_length: null,
    }
    const photos4 = [PHOTO_1, PHOTO_2, PHOTO_3, PHOTO_4]
    // After commit, survivors are photos 1 (was keep) and 4 (was undecided)
    const survivorPhotos: LogicalPhotoSummary[] = [PHOTO_1, PHOTO_4]

    mockInvoke.mockImplementation(mockStackFocusRouter({
      list_logical_photos: [photos4, survivorPhotos],
      get_round_decisions: [
        [
          { logical_photo_id: 1, current_status: 'keep' },
          { logical_photo_id: 2, current_status: 'eliminate' },
          { logical_photo_id: 3, current_status: 'eliminate' },
          { logical_photo_id: 4, current_status: 'undecided' },
        ],
        [
          { logical_photo_id: 1, current_status: 'undecided' },
          { logical_photo_id: 4, current_status: 'undecided' },
        ],
      ],
      get_round_status: [
        { round_id: 1, round_number: 1, state: 'open', total_photos: 4, decided: 3, kept: 1, eliminated: 2, undecided: 1, committed_at: null },
        { round_id: 2, round_number: 2, state: 'open', total_photos: 2, decided: 0, kept: 0, eliminated: 0, undecided: 2, committed_at: null },
      ],
    }))

    render(StackFocus)
    // All 4 photos visible in grid (eliminated photos stay with status indicators)
    await waitFor(() => {
      expect(screen.getAllByTestId('photo-card')).toHaveLength(4)
    })

    // Commit — re-fetch returns only survivors
    await fireEvent.keyDown(document, { key: 'Enter', ctrlKey: true })

    // After commit, only 2 photos remain (survivors)
    await waitFor(() => {
      expect(screen.getAllByTestId('photo-card')).toHaveLength(2)
    })

    // Press Tab — should land on an undecided photo
    await fireEvent.keyDown(document, { key: 'Tab' })

    await waitFor(() => {
      const cards = screen.getAllByTestId('photo-card')
      // The undecided photo should be focused (ring-blue-500)
      const focusedCard = cards.find(c => frameClass(c).includes('ring-blue-500'))
      expect(focusedCard).toBeDefined()
    })
  })
})

// ─── Bug 6: Tab scrolls focused card into view ─────────────────────────────

describe('StackFocus — Bug 6: Tab scrolls focused card into view', () => {
  it('Tab jump calls scrollIntoView on the focused card', async () => {
    const PHOTO_4: LogicalPhotoSummary = {
      logical_photo_id: 4, thumbnail_path: null, capture_time: null,
      camera_model: null, lens: null, has_raw: false, has_jpeg: true,
      aperture: null, shutter_speed: null, iso: null, focal_length: null,
    }
    const photos4 = [PHOTO_1, PHOTO_2, PHOTO_3, PHOTO_4]

    mockInvoke.mockImplementation(mockStackFocusRouter({
      list_logical_photos: [photos4],
      get_round_decisions: [[
        { logical_photo_id: 1, current_status: 'keep' },
        { logical_photo_id: 2, current_status: 'undecided' },
        { logical_photo_id: 3, current_status: 'eliminate' },
        { logical_photo_id: 4, current_status: 'undecided' },
      ]],
      get_round_status: {
        round_id: 1, round_number: 1, state: 'open',
        total_photos: 4, decided: 2, kept: 1, eliminated: 1, undecided: 2, committed_at: null,
      },
    }))

    render(StackFocus)
    await waitFor(() => screen.getAllByTestId('photo-card'))

    // Spy on scrollIntoView for all photo-card elements
    const cards = screen.getAllByTestId('photo-card')
    const scrollSpies = cards.map(card => vi.spyOn(card, 'scrollIntoView'))

    // Press Tab — should jump to next undecided (index 1) and scroll it into view
    await fireEvent.keyDown(document, { key: 'Tab' })

    // Wait for tick() to resolve and scrollIntoView to be called
    await waitFor(() => {
      const anyScrolled = scrollSpies.some(spy => spy.mock.calls.length > 0)
      expect(anyScrolled).toBe(true)
    })
  })
})

// ─── Contract: listLogicalPhotos must pass roundId after commit ─────────────

describe('StackFocus — list_logical_photos includes roundId after commit', () => {
  it('after commit, re-fetch calls list_logical_photos with roundId from new round', async () => {
    const COMMITTED_ROUND = {
      round_id: 1, round_number: 1, state: 'committed',
      total_photos: 3, decided: 3, kept: 2, eliminated: 1, undecided: 0, committed_at: '2026-03-21T12:00:00Z',
    }
    const NEW_ROUND = {
      round_id: 2, round_number: 2, state: 'open',
      total_photos: 2, decided: 0, kept: 0, eliminated: 0, undecided: 2, committed_at: null,
    }
    const survivorPhotos = [PHOTO_1, PHOTO_3]

    let listCallCount = 0
    mockInvoke.mockImplementation((cmd: string, args?: any) => {
      if (cmd === 'list_logical_photos') {
        listCallCount++
        if (listCallCount === 1) return Promise.resolve([PHOTO_1, PHOTO_2, PHOTO_3])
        return Promise.resolve(survivorPhotos)
      }
      if (cmd === 'get_round_decisions') return Promise.resolve([
        { logical_photo_id: 1, current_status: 'keep' },
        { logical_photo_id: 2, current_status: 'eliminate' },
        { logical_photo_id: 3, current_status: 'keep' },
      ])
      if (cmd === 'get_round_status') {
        // First call: open. After commit: new round
        return Promise.resolve(listCallCount <= 1 ? OPEN_ROUND : NEW_ROUND)
      }
      if (cmd === 'commit_round') return Promise.resolve()
      if (cmd === 'get_photo_detail') return Promise.resolve(PHOTO_1)
      return Promise.reject(new Error(`Unmocked: ${cmd}`))
    })

    render(StackFocus)
    await waitFor(() => screen.getAllByTestId('photo-card'))

    // Commit
    await fireEvent.keyDown(document, { key: 'Enter', ctrlKey: true })

    // Wait for re-fetch
    await waitFor(() => {
      expect(listCallCount).toBeGreaterThanOrEqual(2)
    })

    // THE KEY ASSERTION: the second list_logical_photos call must include roundId
    const listCalls = mockInvoke.mock.calls.filter(c => c[0] === 'list_logical_photos')
    const secondCall = listCalls[listCalls.length - 1]
    expect(secondCall[1]).toHaveProperty('roundId')
    expect((secondCall[1] as Record<string, unknown>).roundId).toBe(2) // new round's ID
  })
})

// ─── Contract: initial mount calls list_logical_photos with roundId ─────────

describe('StackFocus — list_logical_photos includes roundId on mount', () => {
  it('onMount fetches roundStatus first, then passes roundId to list_logical_photos', async () => {
    const EXISTING_ROUND = {
      round_id: 5, round_number: 3, state: 'open',
      total_photos: 2, decided: 0, kept: 0, eliminated: 0, undecided: 2, committed_at: null,
    }

    mockInvoke.mockImplementation((cmd: string, args?: any) => {
      if (cmd === 'get_round_status') return Promise.resolve(EXISTING_ROUND)
      if (cmd === 'list_logical_photos') return Promise.resolve([PHOTO_1, PHOTO_3])
      if (cmd === 'get_round_decisions') return Promise.resolve([
        { logical_photo_id: 1, current_status: 'undecided' },
        { logical_photo_id: 3, current_status: 'undecided' },
      ])
      return Promise.reject(new Error(`Unmocked: ${cmd}`))
    })

    render(StackFocus)
    await waitFor(() => screen.getAllByTestId('photo-card'))

    // list_logical_photos must have been called with roundId from getRoundStatus
    const listCalls = mockInvoke.mock.calls.filter(c => c[0] === 'list_logical_photos')
    expect(listCalls.length).toBeGreaterThanOrEqual(1)
    const firstListCall = listCalls[0]
    expect(firstListCall[1]).toHaveProperty('roundId')
    expect((firstListCall[1] as Record<string, unknown>).roundId).toBe(5) // from EXISTING_ROUND
  })
})

// ─── Contract: round_id=0 must be treated as error (no "no round" state) ───

describe('StackFocus — rejects round_id 0 (no "no round" state)', () => {
  it('when getRoundStatus returns round_id=0, component must show error instead of empty grid', async () => {
    // USER MANDATE: There is NO "no round" state. Import MUST create round 1.
    // If the backend erroneously returns round_id=0, the frontend must treat
    // this as an error condition and show an error message, NOT silently
    // display an empty grid or call listLogicalPhotos with roundId=0.
    const INVALID_ROUND = {
      round_id: 0, round_number: 0, state: 'open' as const,
      total_photos: 0, decided: 0, kept: 0, eliminated: 0, undecided: 0, committed_at: null,
    }

    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === 'get_round_status') return Promise.resolve(INVALID_ROUND)
      if (cmd === 'list_logical_photos') return Promise.resolve([])
      if (cmd === 'get_round_decisions') return Promise.resolve([])
      return Promise.reject(new Error(`Unmocked: ${cmd}`))
    })

    render(StackFocus)

    // The component must show an error when round_id=0 (invalid state)
    await waitFor(() => {
      const errorEl = screen.getByTestId('round-error')
      expect(errorEl).toBeInTheDocument()
    })

    // listLogicalPhotos must NOT have been called with roundId=0
    const listCalls = mockInvoke.mock.calls.filter(c => c[0] === 'list_logical_photos')
    const callsWithZeroRound = listCalls.filter(c => {
      const args = c[1] as Record<string, unknown>
      return args.roundId === 0
    })
    expect(callsWithZeroRound).toHaveLength(0)
  })
})

// ── Sprint 10 Phase C: Multi-round navigation ───────────────────────────────

describe('StackFocus — Sprint 10 Phase C: multi-round navigation', () => {
  it('calls list_rounds on mount', async () => {
    mockInvoke.mockImplementation(mockStackFocusRouter({
      list_logical_photos: [mockPhotos],
      list_rounds: THREE_ROUND_LIST,
    }))

    render(StackFocus)

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('list_rounds', {
        slug: 'test-project', stackId: 1,
      })
    })
  })

  it('bracket left navigates to previous round', async () => {
    // Start on round 3 (the open round), rounds list has [1,2,3]
    mockInvoke.mockImplementation(mockStackFocusRouter({
      list_logical_photos: [mockPhotos],
      list_rounds: [THREE_ROUND_LIST],
      get_round_status: {
        round_id: 3, round_number: 3, state: 'open',
        total_photos: 3, decided: 0, kept: 0, eliminated: 0, undecided: 3, committed_at: null,
      },
    }))

    render(StackFocus)
    await waitFor(() => screen.getAllByTestId('photo-card'))

    // Press [ to go to previous round (round 2)
    await fireEvent.keyDown(document, { key: '[' })

    // After navigating to round 2, listLogicalPhotos should be re-called with roundId=2
    await waitFor(() => {
      const listCalls = mockInvoke.mock.calls.filter(c => c[0] === 'list_logical_photos')
      const callsWithRound2 = listCalls.filter(c => {
        const args = c[1] as Record<string, unknown>
        return args.roundId === 2
      })
      expect(callsWithRound2.length).toBeGreaterThanOrEqual(1)
    })
  })

  it('bracket right navigates to next round', async () => {
    // Start on round 1 (committed), rounds list has [1,2,3]
    mockInvoke.mockImplementation(mockStackFocusRouter({
      list_logical_photos: [mockPhotos],
      list_rounds: [THREE_ROUND_LIST],
      get_round_status: {
        round_id: 1, round_number: 1, state: 'committed',
        total_photos: 5, decided: 5, kept: 3, eliminated: 2, undecided: 0, committed_at: '2024-01-15T12:00:00Z',
      },
    }))

    render(StackFocus)
    await waitFor(() => screen.getAllByTestId('photo-card'))

    // Press ] to go to next round (round 2)
    await fireEvent.keyDown(document, { key: ']' })

    // After navigating to round 2, listLogicalPhotos should be re-called with roundId=2
    await waitFor(() => {
      const listCalls = mockInvoke.mock.calls.filter(c => c[0] === 'list_logical_photos')
      const callsWithRound2 = listCalls.filter(c => {
        const args = c[1] as Record<string, unknown>
        return args.roundId === 2
      })
      expect(callsWithRound2.length).toBeGreaterThanOrEqual(1)
    })
  })

  it('decision keys disabled for committed round — Y does not call make_decision', async () => {
    const COMMITTED_ROUND = makeRoundStatus({
      round_id: 1, round_number: 1, state: 'committed',
      total_photos: 3, decided: 3, kept: 2, eliminated: 1, undecided: 0,
      committed_at: '2024-01-15T12:00:00Z',
    })

    mockInvoke.mockImplementation(mockStackFocusRouter({
      list_logical_photos: [mockPhotos],
      list_rounds: [ROUND_1_COMMITTED],
      get_round_status: COMMITTED_ROUND,
      get_round_decisions: [[
        { logical_photo_id: 1, current_status: 'keep' },
        { logical_photo_id: 2, current_status: 'keep' },
        { logical_photo_id: 3, current_status: 'eliminate' },
      ]],
    }))

    render(StackFocus)
    await waitFor(() => screen.getAllByTestId('photo-card'))

    // Press Y — should NOT call make_decision because round is committed
    await fireEvent.keyDown(document, { key: 'y' })

    // Wait a tick then check make_decision was never called
    await new Promise(r => setTimeout(r, 50))
    const decisionCalls = mockInvoke.mock.calls.filter(c => c[0] === 'make_decision')
    expect(decisionCalls).toHaveLength(0)

    // Should show a warning that round is read-only
    expect(screen.getByText(/read-only/i)).toBeInTheDocument()
  })
})

describe('StackFocus — Sprint 10B: getRoundDecisions replaces getStackDecisions', () => {
  it('uses getRoundDecisions instead of getStackDecisions on mount', async () => {
    const roundDecisions = [
      { logical_photo_id: 1, current_status: 'keep' },
      { logical_photo_id: 2, current_status: 'undecided' },
      { logical_photo_id: 3, current_status: 'eliminate' },
    ]
    const roundStatus = {
      round_id: 3, round_number: 2, state: 'open' as const,
      total_photos: 3, decided: 2, kept: 1, eliminated: 1, undecided: 1, committed_at: null,
    }

    const calls: string[] = []
    mockInvoke.mockImplementation(mockStackFocusRouter({
      list_logical_photos: [mockPhotos],
      get_round_decisions: [roundDecisions],
      get_round_status: roundStatus,
      get_stack_decisions: () => { throw new Error('get_stack_decisions should not be called — use get_round_decisions') },
    }))
    // Wrap to track command names
    const originalImpl = mockInvoke.getMockImplementation()!
    mockInvoke.mockImplementation((cmd: string, ...args: unknown[]) => {
      calls.push(cmd)
      return originalImpl(cmd, ...args)
    })

    render(StackFocus)

    await waitFor(() => {
      const cards = screen.getAllByTestId('photo-card')
      // All photos visible in grid (eliminated stays with status indicator)
      expect(cards).toHaveLength(3)
    })

    // Assert: getRoundDecisions was called (with slug, stackId, roundId)
    expect(calls).toContain('get_round_decisions')
    // Assert: getStackDecisions was NOT called
    expect(calls).not.toContain('get_stack_decisions')

    // Verify the round-scoped decisions were applied (photo 1 = keep)
    const cards = screen.getAllByTestId('photo-card')
    expect(cards[0].querySelector(DECISION_SELECTORS.keep)).toBeInTheDocument()
  })
})

// ── Sprint 10 review: navigation bug fixes ───────────────────────────────────

describe('StackFocus — Sprint 10 review: navigation bug fixes', () => {
  const TWO_ROUND_LIST = [
    makeRoundSummary({ round_id: 1, round_number: 1, state: 'committed', committed_at: '2024-01-15T12:00:00Z' }),
    makeRoundSummary({ round_id: 2, round_number: 2, state: 'open' }),
  ]

  it('[ key calls getRoundDecisions with round_id from rounds list, not getStackDecisions', async () => {
    // Start on round 2 (open), rounds list has [1 (committed), 2 (open)]
    const calls: Array<{ cmd: string; args: unknown }> = []

    mockInvoke.mockImplementation(mockStackFocusRouter({
      list_logical_photos: [mockPhotos],
      list_rounds: [TWO_ROUND_LIST],
      get_round_status: makeRoundStatus({
        round_id: 2, round_number: 2, state: 'open',
        total_photos: 3, decided: 0, kept: 0, eliminated: 0, undecided: 3,
      }),
      get_round_decisions: [[
        { logical_photo_id: 1, current_status: 'undecided' },
        { logical_photo_id: 2, current_status: 'undecided' },
        { logical_photo_id: 3, current_status: 'undecided' },
      ]],
    }))

    // Wrap to track all commands + args
    const originalImpl = mockInvoke.getMockImplementation()!
    mockInvoke.mockImplementation((cmd: string, ...args: unknown[]) => {
      calls.push({ cmd, args: args[0] })
      return originalImpl(cmd, ...args)
    })

    render(StackFocus)
    await waitFor(() => screen.getAllByTestId('photo-card'))

    // Clear mount calls, then press [
    calls.length = 0
    await fireEvent.keyDown(document, { key: '[' })

    // Wait for navigation effects
    await waitFor(() => {
      const roundDecisionCalls = calls.filter(c => c.cmd === 'get_round_decisions')
      expect(roundDecisionCalls.length).toBeGreaterThanOrEqual(1)
    })

    // Assert: get_round_decisions was called (not get_stack_decisions)
    const roundDecisionCalls = calls.filter(c => c.cmd === 'get_round_decisions')
    expect(roundDecisionCalls.length).toBeGreaterThanOrEqual(1)

    // Assert: the call used round_id=1 from the rounds list, not arithmetic
    const rdArgs = roundDecisionCalls[0].args as Record<string, unknown>
    expect(rdArgs.roundId).toBe(1)

    // Assert: get_stack_decisions was NOT called
    const stackDecisionCalls = calls.filter(c => c.cmd === 'get_stack_decisions')
    expect(stackDecisionCalls).toHaveLength(0)
  })

  it('] key on last round does not increment past it', async () => {
    // Start on round 2 (the last/open round)
    const calls: Array<{ cmd: string; args: unknown }> = []

    mockInvoke.mockImplementation(mockStackFocusRouter({
      list_logical_photos: [mockPhotos],
      list_rounds: [TWO_ROUND_LIST],
      get_round_status: makeRoundStatus({
        round_id: 2, round_number: 2, state: 'open',
        total_photos: 3, decided: 0, kept: 0, eliminated: 0, undecided: 3,
      }),
    }))

    // Wrap to track all commands + args
    const originalImpl = mockInvoke.getMockImplementation()!
    mockInvoke.mockImplementation((cmd: string, ...args: unknown[]) => {
      calls.push({ cmd, args: args[0] })
      return originalImpl(cmd, ...args)
    })

    render(StackFocus)
    await waitFor(() => screen.getAllByTestId('photo-card'))

    // Clear mount calls, then press ]
    calls.length = 0
    await fireEvent.keyDown(document, { key: ']' })

    // Wait a tick for any async effects
    await new Promise(r => setTimeout(r, 50))

    // No get_round_decisions or get_stack_decisions should be called —
    // pressing ] on the last round should be a no-op
    const roundDecisionCalls = calls.filter(c => c.cmd === 'get_round_decisions')
    const stackDecisionCalls = calls.filter(c => c.cmd === 'get_stack_decisions')
    const listPhotoCalls = calls.filter(c => c.cmd === 'list_logical_photos')
    expect(roundDecisionCalls).toHaveLength(0)
    expect(stackDecisionCalls).toHaveLength(0)
    expect(listPhotoCalls).toHaveLength(0)
  })

  it('RoundTabBar click calls getRoundDecisions with clicked round id', async () => {
    // Mount with 2 rounds, currently on round 2
    const calls: Array<{ cmd: string; args: unknown }> = []

    mockInvoke.mockImplementation(mockStackFocusRouter({
      list_logical_photos: [mockPhotos],
      list_rounds: [TWO_ROUND_LIST],
      get_round_status: makeRoundStatus({
        round_id: 2, round_number: 2, state: 'open',
        total_photos: 3, decided: 0, kept: 0, eliminated: 0, undecided: 3,
      }),
      get_round_decisions: [[
        { logical_photo_id: 1, current_status: 'undecided' },
        { logical_photo_id: 2, current_status: 'undecided' },
        { logical_photo_id: 3, current_status: 'undecided' },
      ]],
    }))

    // Wrap to track all commands + args
    const originalImpl = mockInvoke.getMockImplementation()!
    mockInvoke.mockImplementation((cmd: string, ...args: unknown[]) => {
      calls.push({ cmd, args: args[0] })
      return originalImpl(cmd, ...args)
    })

    render(StackFocus)
    await waitFor(() => screen.getAllByTestId('photo-card'))

    // Clear mount calls
    calls.length = 0

    // Click the tab for round 1 (R1 button in RoundTabBar)
    const round1Tab = screen.getByText('R1')
    await fireEvent.click(round1Tab)

    // Wait for navigation effects
    await waitFor(() => {
      const roundDecisionCalls = calls.filter(c => c.cmd === 'get_round_decisions')
      expect(roundDecisionCalls.length).toBeGreaterThanOrEqual(1)
    })

    // Assert: get_round_decisions was called with roundId=1
    const roundDecisionCalls = calls.filter(c => c.cmd === 'get_round_decisions')
    expect(roundDecisionCalls.length).toBeGreaterThanOrEqual(1)
    const rdArgs = roundDecisionCalls[0].args as Record<string, unknown>
    expect(rdArgs.roundId).toBe(1)

    // Assert: get_stack_decisions was NOT called
    const stackDecisionCalls = calls.filter(c => c.cmd === 'get_stack_decisions')
    expect(stackDecisionCalls).toHaveLength(0)
  })
})
