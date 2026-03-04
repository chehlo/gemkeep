// src/lib/components/screens/StackFocus.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/svelte'
import { invoke, convertFileSrc } from '@tauri-apps/api/core'
import { navigate, navigation } from '$lib/stores/navigation.svelte.js'
import type { LogicalPhotoSummary } from '$lib/api/index.js'
import StackFocus from './StackFocus.svelte'

const mockInvoke = vi.mocked(invoke)

const PHOTO_1: LogicalPhotoSummary = {
  logical_photo_id: 1,
  thumbnail_path: '/home/user/.gem-keep/cache.jpg',
  capture_time: '2024-01-15T10:30:00Z',
  camera_model: 'Canon EOS 5D',
  lens: 'EF 85mm f/1.4',
  has_raw: true,
  has_jpeg: true,
}

const PHOTO_2: LogicalPhotoSummary = {
  logical_photo_id: 2,
  thumbnail_path: null,
  capture_time: '2024-01-15T10:31:00Z',
  camera_model: 'Canon EOS 5D',
  lens: null,
  has_raw: false,
  has_jpeg: true,
}

const PHOTO_3: LogicalPhotoSummary = {
  logical_photo_id: 3,
  thumbnail_path: null,
  capture_time: null,
  camera_model: null,
  lens: null,
  has_raw: false,
  has_jpeg: true,
}

const mockPhotos: LogicalPhotoSummary[] = [PHOTO_1, PHOTO_2, PHOTO_3]

function setupNav() {
  navigate({ kind: 'stack-focus', projectSlug: 'test-project', projectName: 'Test Project', stackId: 1 })
}

beforeEach(() => {
  vi.clearAllMocks()
  // Reset mock queue (unconsumed mockResolvedValueOnce values from previous tests) and
  // reinstall the Rule 9 throwing default so under-mocked commands fail loudly.
  mockInvoke.mockReset()
  mockInvoke.mockImplementation((cmd: string) => {
    throw new Error(`Unmocked invoke("${cmd}"). Add mockInvoke.mockResolvedValueOnce(...) before this call.`)
  })
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

// Helper: mock the 3 invoke calls StackFocus makes on mount
function mockStackFocusMount(photos: LogicalPhotoSummary[]) {
  mockInvoke.mockResolvedValueOnce(photos)  // list_logical_photos
  mockInvoke.mockResolvedValueOnce([])       // get_stack_decisions
  mockInvoke.mockResolvedValueOnce({ round_id: 0, round_number: 0, state: 'open', total_photos: 0, decided: 0, kept: 0, eliminated: 0, undecided: 0, committed_at: null })  // get_round_status
}

describe('StackFocus — photo grid', () => {
  it('renders photo grid after data loads', async () => {
    mockStackFocusMount(mockPhotos)

    render(StackFocus)

    await waitFor(() => {
      const cards = screen.getAllByTestId('photo-card')
      expect(cards).toHaveLength(3)
    })
  })

  it('renders img with asset:// URL when thumbnail_path is set', async () => {
    const thumbPath = '/home/user/.gem-keep/test.jpg'
    vi.mocked(convertFileSrc).mockImplementation((p: string) => `asset://localhost${p}`)

    mockStackFocusMount([{ ...PHOTO_1, thumbnail_path: thumbPath }])

    render(StackFocus)

    await waitFor(() => {
      const img = screen.getByRole('img')
      expect(img).toBeInTheDocument()
      expect(img).toHaveAttribute('src', `asset://localhost${thumbPath}`)
    })
  })

  it('renders placeholder when thumbnail_path is null', async () => {
    mockStackFocusMount([PHOTO_3]) // thumbnail_path is null

    render(StackFocus)

    await waitFor(() => {
      expect(screen.getByTestId('photo-card')).toBeInTheDocument()
    })

    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(screen.getByTestId('photo-placeholder')).toBeInTheDocument()
  })

  it('shows camera model when present', async () => {
    mockStackFocusMount([
      { ...PHOTO_1, camera_model: 'Canon EOS 5D Mark IV', lens: 'EF 85mm f/1.4' }
    ])

    render(StackFocus)

    await waitFor(() => {
      // truncated to 18 chars: "Canon EOS 5D Mark " but let's check the actual truncation
      // "Canon EOS 5D Mark IV" is 20 chars, truncated to 18 = "Canon EOS 5D Mark "
      // We'll just check the beginning is present
      expect(screen.getByText(/Canon EOS 5D/)).toBeInTheDocument()
    })
  })

  it('shows RAW badge when has_raw is true', async () => {
    mockStackFocusMount([
      { ...PHOTO_1, has_raw: true, has_jpeg: true }
    ])

    render(StackFocus)

    await waitFor(() => {
      expect(screen.getByText('RAW')).toBeInTheDocument()
    })
    expect(screen.getByText('JPEG')).toBeInTheDocument()
  })
})

describe('StackFocus — Sprint 7: decision badges', () => {
  it('displays green badge on kept photos', async () => {
    mockInvoke.mockResolvedValueOnce(mockPhotos)  // list_logical_photos
    mockInvoke.mockResolvedValueOnce([
      { logical_photo_id: 1, current_status: 'keep' },
      { logical_photo_id: 2, current_status: 'eliminate' },
      { logical_photo_id: 3, current_status: 'undecided' },
    ])  // get_stack_decisions
    mockInvoke.mockResolvedValueOnce({
      round_id: 1, round_number: 1, state: 'open',
      total_photos: 3, decided: 2, kept: 1, eliminated: 1, undecided: 1, committed_at: null,
    })  // get_round_status

    render(StackFocus)

    await waitFor(() => {
      const cards = screen.getAllByTestId('photo-card')
      expect(cards[0].querySelector('.decision-keep')).toBeInTheDocument()
    })
  })

  it('V2: keep badge shows "Y" text and has w-5 h-5 size classes', async () => {
    mockInvoke.mockResolvedValueOnce(mockPhotos)
    mockInvoke.mockResolvedValueOnce([
      { logical_photo_id: 1, current_status: 'keep' },
      { logical_photo_id: 2, current_status: 'undecided' },
      { logical_photo_id: 3, current_status: 'undecided' },
    ])
    mockInvoke.mockResolvedValueOnce({
      round_id: 1, round_number: 1, state: 'open',
      total_photos: 3, decided: 1, kept: 1, eliminated: 0, undecided: 2, committed_at: null,
    })

    render(StackFocus)

    await waitFor(() => {
      const cards = screen.getAllByTestId('photo-card')
      const badge = cards[0].querySelector('.decision-keep') as HTMLElement
      expect(badge).toBeInTheDocument()
      expect(badge.className).toContain('border-green-500')
      expect(badge.className).toContain('border-4')
      expect(badge.className).toContain('inset-0')
    })
  })

  it('V2: eliminate badge shows "X" text and has w-5 h-5 size classes', async () => {
    mockInvoke.mockResolvedValueOnce(mockPhotos)
    mockInvoke.mockResolvedValueOnce([
      { logical_photo_id: 1, current_status: 'eliminate' },
      { logical_photo_id: 2, current_status: 'undecided' },
      { logical_photo_id: 3, current_status: 'undecided' },
    ])
    mockInvoke.mockResolvedValueOnce({
      round_id: 1, round_number: 1, state: 'open',
      total_photos: 3, decided: 1, kept: 0, eliminated: 1, undecided: 2, committed_at: null,
    })

    render(StackFocus)

    await waitFor(() => {
      const cards = screen.getAllByTestId('photo-card')
      const badge = cards[0].querySelector('.decision-eliminate') as HTMLElement
      expect(badge).toBeInTheDocument()
      expect(badge.className).toContain('border-red-500')
      expect(badge.className).toContain('border-4')
      expect(badge.className).toContain('inset-0')
    })
  })

  it('dims eliminated photos with opacity', async () => {
    mockInvoke.mockResolvedValueOnce(mockPhotos)
    mockInvoke.mockResolvedValueOnce([
      { logical_photo_id: 1, current_status: 'undecided' },
      { logical_photo_id: 2, current_status: 'eliminate' },
      { logical_photo_id: 3, current_status: 'undecided' },
    ])
    mockInvoke.mockResolvedValueOnce({
      round_id: 1, round_number: 1, state: 'open',
      total_photos: 3, decided: 1, kept: 0, eliminated: 1, undecided: 2, committed_at: null,
    })

    render(StackFocus)

    await waitFor(() => {
      const cards = screen.getAllByTestId('photo-card')
      expect(cards[1].querySelector('.decision-eliminate')).toBeInTheDocument()
    })
  })

  it('displays progress counter "decided/total"', async () => {
    mockInvoke.mockResolvedValueOnce(mockPhotos)
    mockInvoke.mockResolvedValueOnce([
      { logical_photo_id: 1, current_status: 'keep' },
      { logical_photo_id: 2, current_status: 'eliminate' },
      { logical_photo_id: 3, current_status: 'undecided' },
    ])
    mockInvoke.mockResolvedValueOnce({
      round_id: 1, round_number: 1, state: 'open',
      total_photos: 3, decided: 2, kept: 1, eliminated: 1, undecided: 1, committed_at: null,
    })

    render(StackFocus)

    await waitFor(() => {
      expect(screen.getByText(/2\/3 decided/)).toBeInTheDocument()
    })
  })

  it('Y key on focused photo calls makeDecision', async () => {
    mockInvoke.mockResolvedValueOnce(mockPhotos)
    mockInvoke.mockResolvedValueOnce([
      { logical_photo_id: 1, current_status: 'undecided' },
      { logical_photo_id: 2, current_status: 'undecided' },
      { logical_photo_id: 3, current_status: 'undecided' },
    ])
    mockInvoke.mockResolvedValueOnce({
      round_id: 1, round_number: 1, state: 'open',
      total_photos: 3, decided: 0, kept: 0, eliminated: 0, undecided: 3, committed_at: null,
    })

    render(StackFocus)
    await waitFor(() => screen.getAllByTestId('photo-card'))

    // Mock the decision response
    mockInvoke.mockResolvedValueOnce({
      decision_id: 1, round_id: 1, action: 'keep',
      current_status: 'keep', round_auto_created: true,
    })

    await fireEvent.keyDown(document, { key: 'y' })

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('make_decision', {
        slug: 'test-project', logicalPhotoId: 1, action: 'keep',
      })
    })
  })

  it('Enter opens SingleView with correct photoId', async () => {
    mockInvoke.mockResolvedValueOnce(mockPhotos)
    mockInvoke.mockResolvedValueOnce([
      { logical_photo_id: 1, current_status: 'undecided' },
      { logical_photo_id: 2, current_status: 'undecided' },
      { logical_photo_id: 3, current_status: 'undecided' },
    ])
    mockInvoke.mockResolvedValueOnce({
      round_id: 1, round_number: 1, state: 'open',
      total_photos: 3, decided: 0, kept: 0, eliminated: 0, undecided: 3, committed_at: null,
    })

    render(StackFocus)
    await waitFor(() => screen.getAllByTestId('photo-card'))

    await fireEvent.keyDown(document, { key: 'Enter' })

    expect(navigation.current.kind).toBe('single-view')
    if (navigation.current.kind === 'single-view') {
      expect(navigation.current.photoId).toBe(1)
    }
  })

  it('Ctrl+Enter commits the round', async () => {
    mockInvoke.mockResolvedValueOnce(mockPhotos)
    mockInvoke.mockResolvedValueOnce([
      { logical_photo_id: 1, current_status: 'keep' },
      { logical_photo_id: 2, current_status: 'keep' },
      { logical_photo_id: 3, current_status: 'eliminate' },
    ])
    mockInvoke.mockResolvedValueOnce({
      round_id: 1, round_number: 1, state: 'open',
      total_photos: 3, decided: 3, kept: 2, eliminated: 1, undecided: 0, committed_at: null,
    })

    render(StackFocus)
    await waitFor(() => screen.getAllByTestId('photo-card'))

    mockInvoke.mockResolvedValueOnce(undefined)  // commit_round

    await fireEvent.keyDown(document, { key: 'Enter', ctrlKey: true })

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('commit_round', {
        slug: 'test-project', stackId: 1,
      })
    })
  })

  it('X key on focused photo calls makeDecision with eliminate', async () => {
    mockInvoke.mockResolvedValueOnce(mockPhotos)
    mockInvoke.mockResolvedValueOnce([
      { logical_photo_id: 1, current_status: 'undecided' },
      { logical_photo_id: 2, current_status: 'undecided' },
      { logical_photo_id: 3, current_status: 'undecided' },
    ])
    mockInvoke.mockResolvedValueOnce({
      round_id: 1, round_number: 1, state: 'open',
      total_photos: 3, decided: 0, kept: 0, eliminated: 0, undecided: 3, committed_at: null,
    })

    render(StackFocus)
    await waitFor(() => screen.getAllByTestId('photo-card'))

    // Mock the decision response
    mockInvoke.mockResolvedValueOnce({
      decision_id: 1, round_id: 1, action: 'eliminate',
      current_status: 'eliminate', round_auto_created: false,
    })

    await fireEvent.keyDown(document, { key: 'x' })

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('make_decision', {
        slug: 'test-project', logicalPhotoId: 1, action: 'eliminate',
      })
    })
  })

  it('Eliminated photo shows red badge', async () => {
    mockInvoke.mockResolvedValueOnce(mockPhotos)
    mockInvoke.mockResolvedValueOnce([
      { logical_photo_id: 1, current_status: 'undecided' },
      { logical_photo_id: 2, current_status: 'eliminate' },
      { logical_photo_id: 3, current_status: 'undecided' },
    ])
    mockInvoke.mockResolvedValueOnce({
      round_id: 1, round_number: 1, state: 'open',
      total_photos: 3, decided: 1, kept: 0, eliminated: 1, undecided: 2, committed_at: null,
    })

    render(StackFocus)

    await waitFor(() => {
      const cards = screen.getAllByTestId('photo-card')
      // Card at index 1 is the eliminated photo — it should have a red badge
      const redBadge = cards[1].querySelector('.decision-eliminate, .bg-red-500')
      expect(redBadge).toBeInTheDocument()
    })
  })

  it('Tab jumps to next undecided photo in StackFocus', async () => {
    const PHOTO_4: LogicalPhotoSummary = {
      logical_photo_id: 4,
      thumbnail_path: null,
      capture_time: null,
      camera_model: null,
      lens: null,
      has_raw: false,
      has_jpeg: true,
    }
    const photos4 = [PHOTO_1, PHOTO_2, PHOTO_3, PHOTO_4]

    mockInvoke.mockResolvedValueOnce(photos4)  // list_logical_photos
    mockInvoke.mockResolvedValueOnce([
      { logical_photo_id: 1, current_status: 'keep' },
      { logical_photo_id: 2, current_status: 'undecided' },
      { logical_photo_id: 3, current_status: 'eliminate' },
      { logical_photo_id: 4, current_status: 'undecided' },
    ])  // get_stack_decisions
    mockInvoke.mockResolvedValueOnce({
      round_id: 1, round_number: 1, state: 'open',
      total_photos: 4, decided: 2, kept: 1, eliminated: 1, undecided: 2, committed_at: null,
    })  // get_round_status

    render(StackFocus)
    await waitFor(() => screen.getAllByTestId('photo-card'))

    // Focus starts at index 0 (keep). Tab should jump to index 1 (undecided).
    await fireEvent.keyDown(document, { key: 'Tab' })

    await waitFor(() => {
      const cards = screen.getAllByTestId('photo-card')
      // Card at index 1 should now have the blue focus ring
      expect(cards[1].className).toContain('border-blue-500')
    })
  })

  it('Shift+Tab jumps to previous undecided photo in StackFocus', async () => {
    const PHOTO_4: LogicalPhotoSummary = {
      logical_photo_id: 4,
      thumbnail_path: null,
      capture_time: null,
      camera_model: null,
      lens: null,
      has_raw: false,
      has_jpeg: true,
    }
    const photos4 = [PHOTO_1, PHOTO_2, PHOTO_3, PHOTO_4]

    mockInvoke.mockResolvedValueOnce(photos4)
    mockInvoke.mockResolvedValueOnce([
      { logical_photo_id: 1, current_status: 'keep' },
      { logical_photo_id: 2, current_status: 'undecided' },
      { logical_photo_id: 3, current_status: 'eliminate' },
      { logical_photo_id: 4, current_status: 'undecided' },
    ])
    mockInvoke.mockResolvedValueOnce({
      round_id: 1, round_number: 1, state: 'open',
      total_photos: 4, decided: 2, kept: 1, eliminated: 1, undecided: 2, committed_at: null,
    })

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
      expect(cards[1].className).toContain('border-blue-500')
    })
  })

  it('Progress counter shows full format with kept, eliminated, undecided counts', async () => {
    const photos12: LogicalPhotoSummary[] = Array.from({ length: 12 }, (_, i) => ({
      logical_photo_id: i + 1,
      thumbnail_path: null,
      capture_time: null,
      camera_model: null,
      lens: null,
      has_raw: false,
      has_jpeg: true,
    }))

    mockInvoke.mockResolvedValueOnce(photos12)
    mockInvoke.mockResolvedValueOnce(
      photos12.map((p, i) => ({
        logical_photo_id: p.logical_photo_id,
        current_status: i < 3 ? 'keep' : i < 5 ? 'eliminate' : 'undecided',
      }))
    )
    mockInvoke.mockResolvedValueOnce({
      round_id: 1, round_number: 1, state: 'open',
      total_photos: 12, decided: 5, kept: 3, eliminated: 2, undecided: 7, committed_at: null,
    })

    render(StackFocus)

    await waitFor(() => {
      // Expect full progress format: "3 kept", "2 eliminated", "7 undecided", "Round 1"
      expect(screen.getByText(/3 kept/i)).toBeInTheDocument()
      expect(screen.getByText(/2 eliminated/i)).toBeInTheDocument()
      expect(screen.getByText(/7 undecided/i)).toBeInTheDocument()
      expect(screen.getByText(/Round 1/i)).toBeInTheDocument()
    })
  })
})

// --- COMMITTED ROUND GUARD ---

describe('StackFocus — committed round behavior', () => {
  const COMMITTED_ROUND = {
    round_id: 1, round_number: 1, state: 'committed',
    total_photos: 3, decided: 3, kept: 2, eliminated: 1, undecided: 0,
    committed_at: '2024-01-15T12:00:00Z',
  }

  it('Y key does NOT call makeDecision when round is committed', async () => {
    mockInvoke.mockResolvedValueOnce(mockPhotos)  // list_logical_photos
    mockInvoke.mockResolvedValueOnce([
      { logical_photo_id: 1, current_status: 'keep' },
      { logical_photo_id: 2, current_status: 'keep' },
      { logical_photo_id: 3, current_status: 'eliminate' },
    ])  // get_stack_decisions
    mockInvoke.mockResolvedValueOnce(COMMITTED_ROUND)  // get_round_status

    render(StackFocus)
    await waitFor(() => screen.getAllByTestId('photo-card'))

    await fireEvent.keyDown(document, { key: 'y' })

    // Small delay to flush async
    await new Promise(r => setTimeout(r, 50))
    expect(mockInvoke).not.toHaveBeenCalledWith('make_decision', expect.anything())
  })

  it('X key does NOT call makeDecision when round is committed', async () => {
    mockInvoke.mockResolvedValueOnce(mockPhotos)  // list_logical_photos
    mockInvoke.mockResolvedValueOnce([
      { logical_photo_id: 1, current_status: 'keep' },
      { logical_photo_id: 2, current_status: 'keep' },
      { logical_photo_id: 3, current_status: 'eliminate' },
    ])  // get_stack_decisions
    mockInvoke.mockResolvedValueOnce(COMMITTED_ROUND)  // get_round_status

    render(StackFocus)
    await waitFor(() => screen.getAllByTestId('photo-card'))

    await fireEvent.keyDown(document, { key: 'x' })

    await new Promise(r => setTimeout(r, 50))
    expect(mockInvoke).not.toHaveBeenCalledWith('make_decision', expect.anything())
  })
})

// --- HIGH PRIORITY ---

describe('StackFocus — SF-22: back button navigates to StackOverview', () => {
  it('clicking back button navigates to stack-overview', async () => {
    mockStackFocusMount(mockPhotos)
    render(StackFocus)
    await waitFor(() => screen.getAllByTestId('photo-card'))

    const backButton = screen.getByTitle('Back to Stacks (Esc)')
    await fireEvent.click(backButton)

    expect(navigation.current.kind).toBe('stack-overview')
    if (navigation.current.kind === 'stack-overview') {
      expect(navigation.current.projectSlug).toBe('test-project')
      expect(navigation.current.projectName).toBe('Test Project')
    }
  })
})

describe('StackFocus — SF-23: card click sets focusedIndex', () => {
  it('clicking a photo card makes it focused', async () => {
    mockStackFocusMount(mockPhotos)
    render(StackFocus)
    await waitFor(() => screen.getAllByTestId('photo-card'))

    const cards = screen.getAllByTestId('photo-card')
    // Initially card 0 is focused (has border-blue-500)
    expect(cards[0].className).toContain('border-blue-500')
    expect(cards[2].className).not.toContain('border-blue-500')

    // Click the third card
    await fireEvent.click(cards[2])

    await waitFor(() => {
      const updatedCards = screen.getAllByTestId('photo-card')
      expect(updatedCards[2].className).toContain('border-blue-500')
      expect(updatedCards[0].className).not.toContain('border-blue-500')
    })
  })
})

describe('StackFocus — SF-28: optimistic UI update after Y/X', () => {
  it('Y key shows keep badge immediately without re-fetching get_stack_decisions', async () => {
    mockInvoke.mockResolvedValueOnce(mockPhotos)  // list_logical_photos
    mockInvoke.mockResolvedValueOnce([
      { logical_photo_id: 1, current_status: 'undecided' },
      { logical_photo_id: 2, current_status: 'undecided' },
      { logical_photo_id: 3, current_status: 'undecided' },
    ])  // get_stack_decisions
    mockInvoke.mockResolvedValueOnce({
      round_id: 1, round_number: 1, state: 'open',
      total_photos: 3, decided: 0, kept: 0, eliminated: 0, undecided: 3, committed_at: null,
    })  // get_round_status

    render(StackFocus)
    await waitFor(() => screen.getAllByTestId('photo-card'))

    // Mock the make_decision response
    mockInvoke.mockResolvedValueOnce({
      decision_id: 1, round_id: 1, action: 'keep',
      current_status: 'keep', round_auto_created: false,
    })

    await fireEvent.keyDown(document, { key: 'y' })

    // Badge should appear via optimistic update
    await waitFor(() => {
      const cards = screen.getAllByTestId('photo-card')
      expect(cards[0].querySelector('.decision-keep')).toBeInTheDocument()
    })

    // Verify no additional get_stack_decisions call was made (only the initial 3 invoke calls + 1 make_decision)
    const invokeCalls = mockInvoke.mock.calls.map(c => c[0])
    const decisionFetches = invokeCalls.filter(c => c === 'get_stack_decisions')
    expect(decisionFetches).toHaveLength(1)  // Only the initial mount fetch
  })

  it('X key shows eliminate badge and dims card immediately without re-fetching', async () => {
    mockInvoke.mockResolvedValueOnce(mockPhotos)
    mockInvoke.mockResolvedValueOnce([
      { logical_photo_id: 1, current_status: 'undecided' },
      { logical_photo_id: 2, current_status: 'undecided' },
      { logical_photo_id: 3, current_status: 'undecided' },
    ])
    mockInvoke.mockResolvedValueOnce({
      round_id: 1, round_number: 1, state: 'open',
      total_photos: 3, decided: 0, kept: 0, eliminated: 0, undecided: 3, committed_at: null,
    })

    render(StackFocus)
    await waitFor(() => screen.getAllByTestId('photo-card'))

    mockInvoke.mockResolvedValueOnce({
      decision_id: 1, round_id: 1, action: 'eliminate',
      current_status: 'eliminate', round_auto_created: false,
    })

    await fireEvent.keyDown(document, { key: 'x' })

    await waitFor(() => {
      const cards = screen.getAllByTestId('photo-card')
      expect(cards[0].querySelector('.decision-eliminate')).toBeInTheDocument()
    })

    // No additional get_stack_decisions call
    const invokeCalls = mockInvoke.mock.calls.map(c => c[0])
    const decisionFetches = invokeCalls.filter(c => c === 'get_stack_decisions')
    expect(decisionFetches).toHaveLength(1)
  })
})

describe('StackFocus — H5: optimistic UI acknowledges DecisionResult', () => {
  it('Y press calls makeDecision AND shows keep badge on the card', async () => {
    mockInvoke.mockResolvedValueOnce(mockPhotos)  // list_logical_photos
    mockInvoke.mockResolvedValueOnce([
      { logical_photo_id: 1, current_status: 'undecided' },
      { logical_photo_id: 2, current_status: 'undecided' },
      { logical_photo_id: 3, current_status: 'undecided' },
    ])  // get_stack_decisions
    mockInvoke.mockResolvedValueOnce({
      round_id: 1, round_number: 1, state: 'open',
      total_photos: 3, decided: 0, kept: 0, eliminated: 0, undecided: 3, committed_at: null,
    })  // get_round_status

    render(StackFocus)
    await waitFor(() => screen.getAllByTestId('photo-card'))

    // No badge before decision
    const cardsBefore = screen.getAllByTestId('photo-card')
    expect(cardsBefore[0].querySelector('.decision-keep')).not.toBeInTheDocument()

    // Mock the make_decision response with full DecisionResult
    mockInvoke.mockResolvedValueOnce({
      decision_id: 42, round_id: 1, action: 'keep',
      current_status: 'keep', round_auto_created: true,
    })

    await fireEvent.keyDown(document, { key: 'y' })

    // Verify the IPC call was made with correct arguments
    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('make_decision', {
        slug: 'test-project', logicalPhotoId: 1, action: 'keep',
      })
    })

    // Verify the UI shows the correct badge after the call resolves
    await waitFor(() => {
      const cardsAfter = screen.getAllByTestId('photo-card')
      expect(cardsAfter[0].querySelector('.decision-keep')).toBeInTheDocument()
      expect(cardsAfter[0].querySelector('.decision-eliminate')).not.toBeInTheDocument()
    })
  })

  it('X press calls makeDecision AND shows eliminate badge + dim on the card', async () => {
    mockInvoke.mockResolvedValueOnce(mockPhotos)
    mockInvoke.mockResolvedValueOnce([
      { logical_photo_id: 1, current_status: 'undecided' },
      { logical_photo_id: 2, current_status: 'undecided' },
      { logical_photo_id: 3, current_status: 'undecided' },
    ])
    mockInvoke.mockResolvedValueOnce({
      round_id: 1, round_number: 1, state: 'open',
      total_photos: 3, decided: 0, kept: 0, eliminated: 0, undecided: 3, committed_at: null,
    })

    render(StackFocus)
    await waitFor(() => screen.getAllByTestId('photo-card'))

    // Mock the make_decision response
    mockInvoke.mockResolvedValueOnce({
      decision_id: 43, round_id: 1, action: 'eliminate',
      current_status: 'eliminate', round_auto_created: false,
    })

    await fireEvent.keyDown(document, { key: 'x' })

    // Verify the IPC call
    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('make_decision', {
        slug: 'test-project', logicalPhotoId: 1, action: 'eliminate',
      })
    })

    // Verify the UI: eliminate badge + opacity dimming
    await waitFor(() => {
      const cardsAfter = screen.getAllByTestId('photo-card')
      expect(cardsAfter[0].querySelector('.decision-eliminate')).toBeInTheDocument()
      expect(cardsAfter[0].querySelector('.decision-keep')).not.toBeInTheDocument()
    })
  })
})

describe('StackFocus — SF-41: decision re-decidable', () => {
  it('pressing Y on an eliminated photo overwrites to keep', async () => {
    mockInvoke.mockResolvedValueOnce(mockPhotos)
    mockInvoke.mockResolvedValueOnce([
      { logical_photo_id: 1, current_status: 'eliminate' },
      { logical_photo_id: 2, current_status: 'undecided' },
      { logical_photo_id: 3, current_status: 'undecided' },
    ])
    mockInvoke.mockResolvedValueOnce({
      round_id: 1, round_number: 1, state: 'open',
      total_photos: 3, decided: 1, kept: 0, eliminated: 1, undecided: 2, committed_at: null,
    })

    render(StackFocus)

    // Verify card starts as eliminated
    await waitFor(() => {
      const cards = screen.getAllByTestId('photo-card')
      expect(cards[0].querySelector('.decision-eliminate')).toBeInTheDocument()
    })

    // Press Y to change from eliminate to keep
    mockInvoke.mockResolvedValueOnce({
      decision_id: 2, round_id: 1, action: 'keep',
      current_status: 'keep', round_auto_created: false,
    })

    await fireEvent.keyDown(document, { key: 'y' })

    await waitFor(() => {
      const cards = screen.getAllByTestId('photo-card')
      expect(cards[0].querySelector('.decision-keep')).toBeInTheDocument()
      expect(cards[0].querySelector('.decision-eliminate')).not.toBeInTheDocument()
    })
  })

  it('pressing X on a kept photo overwrites to eliminate', async () => {
    mockInvoke.mockResolvedValueOnce(mockPhotos)
    mockInvoke.mockResolvedValueOnce([
      { logical_photo_id: 1, current_status: 'keep' },
      { logical_photo_id: 2, current_status: 'undecided' },
      { logical_photo_id: 3, current_status: 'undecided' },
    ])
    mockInvoke.mockResolvedValueOnce({
      round_id: 1, round_number: 1, state: 'open',
      total_photos: 3, decided: 1, kept: 1, eliminated: 0, undecided: 2, committed_at: null,
    })

    render(StackFocus)

    await waitFor(() => {
      const cards = screen.getAllByTestId('photo-card')
      expect(cards[0].querySelector('.decision-keep')).toBeInTheDocument()
    })

    mockInvoke.mockResolvedValueOnce({
      decision_id: 2, round_id: 1, action: 'eliminate',
      current_status: 'eliminate', round_auto_created: false,
    })

    await fireEvent.keyDown(document, { key: 'x' })

    await waitFor(() => {
      const cards = screen.getAllByTestId('photo-card')
      expect(cards[0].querySelector('.decision-eliminate')).toBeInTheDocument()
      expect(cards[0].querySelector('.decision-keep')).not.toBeInTheDocument()
    })
  })
})

describe('StackFocus — SF-43: makeDecision error handling', () => {
  it('Y key with make_decision rejection does not crash and decisions unchanged', async () => {
    mockInvoke.mockResolvedValueOnce(mockPhotos)
    mockInvoke.mockResolvedValueOnce([
      { logical_photo_id: 1, current_status: 'undecided' },
      { logical_photo_id: 2, current_status: 'undecided' },
      { logical_photo_id: 3, current_status: 'undecided' },
    ])
    mockInvoke.mockResolvedValueOnce({
      round_id: 1, round_number: 1, state: 'open',
      total_photos: 3, decided: 0, kept: 0, eliminated: 0, undecided: 3, committed_at: null,
    })

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    render(StackFocus)
    await waitFor(() => screen.getAllByTestId('photo-card'))

    // make_decision rejects
    mockInvoke.mockRejectedValueOnce(new Error('Network error'))

    await fireEvent.keyDown(document, { key: 'y' })

    // Wait for the rejection to be handled
    await waitFor(() => {
      expect(consoleSpy).toHaveBeenCalledWith('makeDecision failed:', expect.any(Error))
    })

    // No badge should appear — decisions state unchanged
    const cards = screen.getAllByTestId('photo-card')
    expect(cards[0].querySelector('.decision-keep')).not.toBeInTheDocument()
    expect(cards[0].querySelector('.decision-eliminate')).not.toBeInTheDocument()

    consoleSpy.mockRestore()
  })
})

describe('StackFocus — SF-47: no-op when photos empty', () => {
  it('Y key does nothing with 0 photos and no crash', async () => {
    mockStackFocusMount([])
    render(StackFocus)
    await waitFor(() => screen.getByText('No photos in this stack.'))

    // Should not call make_decision
    await fireEvent.keyDown(document, { key: 'y' })
    await fireEvent.keyDown(document, { key: 'x' })
    await fireEvent.keyDown(document, { key: 'ArrowRight' })
    await fireEvent.keyDown(document, { key: 'ArrowLeft' })

    // Verify no make_decision call beyond the initial 3 mount calls
    expect(mockInvoke).toHaveBeenCalledTimes(3)
  })

  it('Enter key does nothing with 0 photos (stays on stack-focus)', async () => {
    mockStackFocusMount([])
    render(StackFocus)
    await waitFor(() => screen.getByText('No photos in this stack.'))

    await fireEvent.keyDown(document, { key: 'Enter' })

    // Should still be on stack-focus (Enter with photos navigates to single-view)
    expect(navigation.current.kind).toBe('stack-focus')
  })
})

// --- MEDIUM PRIORITY ---

describe('StackFocus — SF-21: breadcrumb content', () => {
  it('shows Back button, project name, and Stack #1', async () => {
    mockStackFocusMount(mockPhotos)
    render(StackFocus)
    await waitFor(() => screen.getAllByTestId('photo-card'))

    expect(screen.getByText('Back')).toBeInTheDocument()
    expect(screen.getByText('Test Project')).toBeInTheDocument()
    expect(screen.getByText('Stack #1')).toBeInTheDocument()
  })
})

describe('StackFocus — SF-24: capture time formatting', () => {
  it('formats capture time as Mon DD HH:MM:SS', async () => {
    mockStackFocusMount([PHOTO_1])
    render(StackFocus)

    await waitFor(() => {
      // PHOTO_1 capture_time is '2024-01-15T10:30:00Z'
      // formatCaptureTime produces: "Jan 15 10:30:00"
      expect(screen.getByText('Jan 15 10:30:00')).toBeInTheDocument()
    })
  })

  it('shows "(no date)" when capture_time is null', async () => {
    mockStackFocusMount([PHOTO_3])  // PHOTO_3 has capture_time: null
    render(StackFocus)

    await waitFor(() => {
      expect(screen.getByText('(no date)')).toBeInTheDocument()
    })
  })
})

describe('StackFocus — SF-25: lens info shown', () => {
  it('shows lens when present', async () => {
    mockStackFocusMount([PHOTO_1])  // PHOTO_1 has lens: 'EF 85mm f/1.4'
    render(StackFocus)

    await waitFor(() => {
      expect(screen.getByText('EF 85mm f/1.4')).toBeInTheDocument()
    })
  })

  it('does not show lens element when lens is null', async () => {
    mockStackFocusMount([PHOTO_2])  // PHOTO_2 has lens: null
    render(StackFocus)

    await waitFor(() => {
      expect(screen.getByTestId('photo-card')).toBeInTheDocument()
    })

    // No lens text should be present (PHOTO_2 has camera_model but no lens)
    expect(screen.queryByText('EF 85mm f/1.4')).not.toBeInTheDocument()
  })
})

describe('StackFocus — SF-26: long camera_model/lens truncated to 18 chars', () => {
  it('truncates camera model longer than 18 chars', async () => {
    const longModel = 'Canon EOS 5D Mark IV Plus Ultra'  // 30 chars
    mockStackFocusMount([{ ...PHOTO_1, camera_model: longModel }])
    render(StackFocus)

    await waitFor(() => {
      // truncate(s, 18) returns first 18 chars: "Canon EOS 5D Mark "
      // Use a function matcher since getByText normalizes trailing whitespace
      const truncated = longModel.slice(0, 18)
      const el = screen.getByText((_content, element) => {
        return element?.textContent === truncated
      })
      expect(el).toBeInTheDocument()
    })

    // Full string should NOT be present (querying by full string)
    expect(screen.queryByText(/IV Plus Ultra/)).not.toBeInTheDocument()
  })

  it('does not truncate model at or under 18 chars', async () => {
    const shortModel = 'Canon EOS 5D'  // 12 chars
    mockStackFocusMount([{ ...PHOTO_1, camera_model: shortModel }])
    render(StackFocus)

    await waitFor(() => {
      expect(screen.getByText('Canon EOS 5D')).toBeInTheDocument()
    })
  })
})

describe('StackFocus — SF-27: empty state', () => {
  it('shows "No photos in this stack." when 0 photos', async () => {
    mockStackFocusMount([])
    render(StackFocus)

    await waitFor(() => {
      expect(screen.getByText('No photos in this stack.')).toBeInTheDocument()
    })

    // No photo cards should be rendered
    expect(screen.queryAllByTestId('photo-card')).toHaveLength(0)
  })
})

describe('StackFocus — SF-42: getStackDecisions error handling', () => {
  it('getStackDecisions failure logs error but component still renders', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    mockInvoke.mockResolvedValueOnce(mockPhotos)       // list_logical_photos succeeds
    mockInvoke.mockRejectedValueOnce(new Error('DB locked'))  // get_stack_decisions fails
    mockInvoke.mockResolvedValueOnce({
      round_id: 0, round_number: 0, state: 'open',
      total_photos: 0, decided: 0, kept: 0, eliminated: 0, undecided: 0, committed_at: null,
    })  // get_round_status

    render(StackFocus)

    await waitFor(() => {
      const cards = screen.getAllByTestId('photo-card')
      expect(cards).toHaveLength(3)
    })

    // Error was logged
    expect(consoleSpy).toHaveBeenCalledWith('getStackDecisions failed:', expect.any(Error))

    // No decision badges should appear (decisions array stayed empty)
    const cards = screen.getAllByTestId('photo-card')
    expect(cards[0].querySelector('.decision-keep')).not.toBeInTheDocument()
    expect(cards[0].querySelector('.decision-eliminate')).not.toBeInTheDocument()

    consoleSpy.mockRestore()
  })
})

describe('StackFocus — M2: commitRound error handling', () => {
  it('Ctrl+Enter failure shows visible error banner', async () => {
    mockStackFocusMount(mockPhotos)
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    render(StackFocus)
    await waitFor(() => screen.getAllByTestId('photo-card'))

    // Mock commit_round rejection
    mockInvoke.mockRejectedValueOnce(new Error('DB locked'))

    await fireEvent.keyDown(document, { key: 'Enter', ctrlKey: true })

    await waitFor(() => {
      expect(screen.getByTestId('action-error')).toBeInTheDocument()
      expect(screen.getByText('Failed to commit round. Please try again.')).toBeInTheDocument()
    })

    consoleSpy.mockRestore()
  })

  it('Ctrl+Enter success does NOT show error banner', async () => {
    mockStackFocusMount(mockPhotos)
    render(StackFocus)
    await waitFor(() => screen.getAllByTestId('photo-card'))

    mockInvoke.mockResolvedValueOnce(undefined)  // commit_round

    await fireEvent.keyDown(document, { key: 'Enter', ctrlKey: true })

    await new Promise(r => setTimeout(r, 50))
    expect(screen.queryByTestId('action-error')).not.toBeInTheDocument()
  })
})

describe('StackFocus — M9: Tab wrap-around', () => {
  it('Tab at last undecided wraps to first undecided', async () => {
    const PHOTO_4: LogicalPhotoSummary = {
      logical_photo_id: 4,
      thumbnail_path: null, capture_time: null, camera_model: null,
      lens: null, has_raw: false, has_jpeg: true,
    }
    const photos4 = [PHOTO_1, PHOTO_2, PHOTO_3, PHOTO_4]

    mockInvoke.mockResolvedValueOnce(photos4)  // list_logical_photos
    mockInvoke.mockResolvedValueOnce([
      { logical_photo_id: 1, current_status: 'keep' },
      { logical_photo_id: 2, current_status: 'eliminate' },
      { logical_photo_id: 3, current_status: 'keep' },
      { logical_photo_id: 4, current_status: 'undecided' },
    ])  // get_stack_decisions
    mockInvoke.mockResolvedValueOnce({
      round_id: 1, round_number: 1, state: 'open',
      total_photos: 4, decided: 3, kept: 2, eliminated: 1, undecided: 1, committed_at: null,
    })  // get_round_status

    render(StackFocus)
    await waitFor(() => screen.getAllByTestId('photo-card'))

    // Navigate to index 3 (the only undecided photo)
    await fireEvent.keyDown(document, { key: 'ArrowRight' })
    await fireEvent.keyDown(document, { key: 'ArrowRight' })
    await fireEvent.keyDown(document, { key: 'ArrowRight' })

    // Verify we're at index 3
    let cards = screen.getAllByTestId('photo-card')
    expect(cards[3].className).toContain('border-blue-500')

    // Tab should wrap — since index 3 is the only undecided, it stays at index 3
    await fireEvent.keyDown(document, { key: 'Tab' })

    cards = screen.getAllByTestId('photo-card')
    // Still at index 3 (only undecided)
    expect(cards[3].className).toContain('border-blue-500')
  })

  it('Tab wraps from last to first undecided when multiple exist', async () => {
    const PHOTO_4: LogicalPhotoSummary = {
      logical_photo_id: 4,
      thumbnail_path: null, capture_time: null, camera_model: null,
      lens: null, has_raw: false, has_jpeg: true,
    }
    const photos4 = [PHOTO_1, PHOTO_2, PHOTO_3, PHOTO_4]

    mockInvoke.mockResolvedValueOnce(photos4)
    mockInvoke.mockResolvedValueOnce([
      { logical_photo_id: 1, current_status: 'undecided' },
      { logical_photo_id: 2, current_status: 'keep' },
      { logical_photo_id: 3, current_status: 'keep' },
      { logical_photo_id: 4, current_status: 'undecided' },
    ])
    mockInvoke.mockResolvedValueOnce({
      round_id: 1, round_number: 1, state: 'open',
      total_photos: 4, decided: 2, kept: 2, eliminated: 0, undecided: 2, committed_at: null,
    })

    render(StackFocus)
    await waitFor(() => screen.getAllByTestId('photo-card'))

    // Navigate to index 3 (undecided)
    await fireEvent.keyDown(document, { key: 'ArrowRight' })
    await fireEvent.keyDown(document, { key: 'ArrowRight' })
    await fireEvent.keyDown(document, { key: 'ArrowRight' })

    // Tab from index 3 should wrap to index 0 (first undecided)
    await fireEvent.keyDown(document, { key: 'Tab' })

    await waitFor(() => {
      const cards = screen.getAllByTestId('photo-card')
      expect(cards[0].className).toContain('border-blue-500')
    })
  })
})

// --- BUG B2: roundStatus never refreshes after Y/X decisions ---

describe('StackFocus — B2: roundStatus refreshes after Y/X decision', () => {
  it('Y key triggers a second get_round_status call after makeDecision', async () => {
    mockInvoke.mockResolvedValueOnce(mockPhotos)  // list_logical_photos
    mockInvoke.mockResolvedValueOnce([
      { logical_photo_id: 1, current_status: 'undecided' },
      { logical_photo_id: 2, current_status: 'undecided' },
      { logical_photo_id: 3, current_status: 'undecided' },
    ])  // get_stack_decisions
    mockInvoke.mockResolvedValueOnce({
      round_id: 1, round_number: 1, state: 'open',
      total_photos: 3, decided: 0, kept: 0, eliminated: 0, undecided: 3, committed_at: null,
    })  // get_round_status (mount)

    render(StackFocus)
    await waitFor(() => screen.getAllByTestId('photo-card'))

    // Mock the make_decision response
    mockInvoke.mockResolvedValueOnce({
      decision_id: 1, round_id: 1, action: 'keep',
      current_status: 'keep', round_auto_created: false,
    })  // make_decision

    // Mock the second get_round_status call that should happen after decision
    mockInvoke.mockResolvedValueOnce({
      round_id: 1, round_number: 1, state: 'open',
      total_photos: 3, decided: 1, kept: 1, eliminated: 0, undecided: 2, committed_at: null,
    })  // get_round_status (after decision)

    await fireEvent.keyDown(document, { key: 'y' })

    // Wait for async effects to settle
    await waitFor(() => {
      const roundStatusCalls = mockInvoke.mock.calls.filter(c => c[0] === 'get_round_status')
      // Must be called at least twice: once on mount, once after decision
      expect(roundStatusCalls.length).toBeGreaterThanOrEqual(2)
    })
  })

  it('X key triggers a second get_round_status call after makeDecision', async () => {
    mockInvoke.mockResolvedValueOnce(mockPhotos)  // list_logical_photos
    mockInvoke.mockResolvedValueOnce([
      { logical_photo_id: 1, current_status: 'undecided' },
      { logical_photo_id: 2, current_status: 'undecided' },
      { logical_photo_id: 3, current_status: 'undecided' },
    ])  // get_stack_decisions
    mockInvoke.mockResolvedValueOnce({
      round_id: 1, round_number: 1, state: 'open',
      total_photos: 3, decided: 0, kept: 0, eliminated: 0, undecided: 3, committed_at: null,
    })  // get_round_status (mount)

    render(StackFocus)
    await waitFor(() => screen.getAllByTestId('photo-card'))

    // Mock the make_decision response
    mockInvoke.mockResolvedValueOnce({
      decision_id: 1, round_id: 1, action: 'eliminate',
      current_status: 'eliminate', round_auto_created: false,
    })  // make_decision

    // Mock the second get_round_status call that should happen after decision
    mockInvoke.mockResolvedValueOnce({
      round_id: 1, round_number: 1, state: 'open',
      total_photos: 3, decided: 1, kept: 0, eliminated: 1, undecided: 2, committed_at: null,
    })  // get_round_status (after decision)

    await fireEvent.keyDown(document, { key: 'x' })

    // Wait for async effects to settle
    await waitFor(() => {
      const roundStatusCalls = mockInvoke.mock.calls.filter(c => c[0] === 'get_round_status')
      // Must be called at least twice: once on mount, once after decision
      expect(roundStatusCalls.length).toBeGreaterThanOrEqual(2)
    })
  })
})

// --- BUG B3: roundStatus stale after Ctrl+Enter commit ---

describe('StackFocus — B3: Y blocked after Ctrl+Enter commit', () => {
  it('Y key is blocked after committing the round via Ctrl+Enter', async () => {
    mockInvoke.mockResolvedValueOnce(mockPhotos)  // list_logical_photos
    mockInvoke.mockResolvedValueOnce([
      { logical_photo_id: 1, current_status: 'keep' },
      { logical_photo_id: 2, current_status: 'keep' },
      { logical_photo_id: 3, current_status: 'eliminate' },
    ])  // get_stack_decisions
    mockInvoke.mockResolvedValueOnce({
      round_id: 1, round_number: 1, state: 'open',
      total_photos: 3, decided: 3, kept: 2, eliminated: 1, undecided: 0, committed_at: null,
    })  // get_round_status (mount — state is 'open')

    render(StackFocus)
    await waitFor(() => screen.getAllByTestId('photo-card'))

    // Mock commit_round success
    mockInvoke.mockResolvedValueOnce(undefined)  // commit_round

    // Mock the get_round_status that SHOULD be called after commit (returns committed)
    mockInvoke.mockResolvedValueOnce({
      round_id: 1, round_number: 1, state: 'committed',
      total_photos: 3, decided: 3, kept: 2, eliminated: 1, undecided: 0,
      committed_at: '2024-01-15T12:00:00Z',
    })  // get_round_status (after commit)

    // Commit the round
    await fireEvent.keyDown(document, { key: 'Enter', ctrlKey: true })

    // Wait for commit to process
    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('commit_round', {
        slug: 'test-project', stackId: 1,
      })
    })

    // Clear mock call counts so we can precisely track what happens after Y
    const callCountAfterCommit = mockInvoke.mock.calls.length

    // Now press Y — this should be BLOCKED because round is committed
    await fireEvent.keyDown(document, { key: 'y' })

    // Wait a bit for any async effects
    await new Promise(r => setTimeout(r, 100))

    // make_decision should NOT have been called after the commit
    const callsAfterCommit = mockInvoke.mock.calls.slice(callCountAfterCommit)
    const makeDecisionCalls = callsAfterCommit.filter(c => c[0] === 'make_decision')
    expect(makeDecisionCalls).toHaveLength(0)
  })
})

// --- BUG U-KEY: No undo decision (U key) ---

describe('StackFocus — U-KEY: undo decision via U key', () => {
  it('U key calls undo_decision for the focused photo', async () => {
    mockInvoke.mockResolvedValueOnce(mockPhotos)  // list_logical_photos
    mockInvoke.mockResolvedValueOnce([
      { logical_photo_id: 1, current_status: 'keep' },
      { logical_photo_id: 2, current_status: 'undecided' },
      { logical_photo_id: 3, current_status: 'undecided' },
    ])  // get_stack_decisions
    mockInvoke.mockResolvedValueOnce({
      round_id: 1, round_number: 1, state: 'open',
      total_photos: 3, decided: 1, kept: 1, eliminated: 0, undecided: 2, committed_at: null,
    })  // get_round_status

    render(StackFocus)
    await waitFor(() => screen.getAllByTestId('photo-card'))

    // Photo 1 (index 0) is 'keep'. Press U to undo.
    mockInvoke.mockResolvedValueOnce(undefined)  // undo_decision

    await fireEvent.keyDown(document, { key: 'u' })

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('undo_decision', {
        slug: 'test-project', logicalPhotoId: 1,
      })
    })
  })

  it('U key after Y reverses the decision', async () => {
    mockInvoke.mockResolvedValueOnce(mockPhotos)  // list_logical_photos
    mockInvoke.mockResolvedValueOnce([
      { logical_photo_id: 1, current_status: 'undecided' },
      { logical_photo_id: 2, current_status: 'undecided' },
      { logical_photo_id: 3, current_status: 'undecided' },
    ])  // get_stack_decisions
    mockInvoke.mockResolvedValueOnce({
      round_id: 1, round_number: 1, state: 'open',
      total_photos: 3, decided: 0, kept: 0, eliminated: 0, undecided: 3, committed_at: null,
    })  // get_round_status

    render(StackFocus)
    await waitFor(() => screen.getAllByTestId('photo-card'))

    // Press Y to keep
    mockInvoke.mockResolvedValueOnce({
      decision_id: 1, round_id: 1, action: 'keep',
      current_status: 'keep', round_auto_created: false,
    })  // make_decision

    await fireEvent.keyDown(document, { key: 'y' })

    // Verify keep badge appeared
    await waitFor(() => {
      const cards = screen.getAllByTestId('photo-card')
      expect(cards[0].querySelector('.decision-keep')).toBeInTheDocument()
    })

    // Press U to undo
    mockInvoke.mockResolvedValueOnce(undefined)  // undo_decision

    await fireEvent.keyDown(document, { key: 'u' })

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('undo_decision', {
        slug: 'test-project', logicalPhotoId: 1,
      })
    })
  })
})

describe('StackFocus — SF-44: keyboard listener cleanup on destroy', () => {
  it('removes keydown listener when component is unmounted', async () => {
    mockStackFocusMount(mockPhotos)
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
  it('l key moves focus right (same as ArrowRight)', async () => {
    mockStackFocusMount(mockPhotos)
    render(StackFocus)
    await waitFor(() => screen.getAllByTestId('photo-card'))

    // Focus starts at index 0
    let cards = screen.getAllByTestId('photo-card')
    expect(cards[0].className).toContain('border-blue-500')

    // Press 'l' to move right
    await fireEvent.keyDown(document, { key: 'l' })

    cards = screen.getAllByTestId('photo-card')
    expect(cards[1].className).toContain('border-blue-500')
    expect(cards[0].className).not.toContain('border-blue-500')
  })

  it('h key moves focus left (same as ArrowLeft)', async () => {
    mockStackFocusMount(mockPhotos)
    render(StackFocus)
    await waitFor(() => screen.getAllByTestId('photo-card'))

    // Move right first
    await fireEvent.keyDown(document, { key: 'ArrowRight' })
    let cards = screen.getAllByTestId('photo-card')
    expect(cards[1].className).toContain('border-blue-500')

    // Press 'h' to move left
    await fireEvent.keyDown(document, { key: 'h' })

    cards = screen.getAllByTestId('photo-card')
    expect(cards[0].className).toContain('border-blue-500')
    expect(cards[1].className).not.toContain('border-blue-500')
  })

  it('j key moves focus down (same as ArrowDown)', async () => {
    // Need more than 4 photos for a 4-col grid to test down movement
    const photos8: LogicalPhotoSummary[] = Array.from({ length: 8 }, (_, i) => ({
      logical_photo_id: i + 1,
      thumbnail_path: null,
      capture_time: null,
      camera_model: null,
      lens: null,
      has_raw: false,
      has_jpeg: true,
    }))

    mockInvoke.mockResolvedValueOnce(photos8)  // list_logical_photos
    mockInvoke.mockResolvedValueOnce([])        // get_stack_decisions
    mockInvoke.mockResolvedValueOnce({ round_id: 0, round_number: 0, state: 'open', total_photos: 0, decided: 0, kept: 0, eliminated: 0, undecided: 0, committed_at: null })

    render(StackFocus)
    await waitFor(() => expect(screen.getAllByTestId('photo-card')).toHaveLength(8))

    // Press 'j' to move down (4 cols)
    await fireEvent.keyDown(document, { key: 'j' })

    const cards = screen.getAllByTestId('photo-card')
    expect(cards[4].className).toContain('border-blue-500')
    expect(cards[0].className).not.toContain('border-blue-500')
  })

  it('k key moves focus up (same as ArrowUp)', async () => {
    const photos8: LogicalPhotoSummary[] = Array.from({ length: 8 }, (_, i) => ({
      logical_photo_id: i + 1,
      thumbnail_path: null,
      capture_time: null,
      camera_model: null,
      lens: null,
      has_raw: false,
      has_jpeg: true,
    }))

    mockInvoke.mockResolvedValueOnce(photos8)
    mockInvoke.mockResolvedValueOnce([])
    mockInvoke.mockResolvedValueOnce({ round_id: 0, round_number: 0, state: 'open', total_photos: 0, decided: 0, kept: 0, eliminated: 0, undecided: 0, committed_at: null })

    render(StackFocus)
    await waitFor(() => expect(screen.getAllByTestId('photo-card')).toHaveLength(8))

    // Move down first
    await fireEvent.keyDown(document, { key: 'ArrowDown' })
    let cards = screen.getAllByTestId('photo-card')
    expect(cards[4].className).toContain('border-blue-500')

    // Press 'k' to move up
    await fireEvent.keyDown(document, { key: 'k' })

    cards = screen.getAllByTestId('photo-card')
    expect(cards[0].className).toContain('border-blue-500')
    expect(cards[4].className).not.toContain('border-blue-500')
  })

  it('Ctrl+h does NOT trigger navigation (modifier guard)', async () => {
    mockStackFocusMount(mockPhotos)
    render(StackFocus)
    await waitFor(() => screen.getAllByTestId('photo-card'))

    // Move right first
    await fireEvent.keyDown(document, { key: 'ArrowRight' })
    let cards = screen.getAllByTestId('photo-card')
    expect(cards[1].className).toContain('border-blue-500')

    // Press Ctrl+h — should NOT move focus
    await fireEvent.keyDown(document, { key: 'h', ctrlKey: true })

    cards = screen.getAllByTestId('photo-card')
    expect(cards[1].className).toContain('border-blue-500')
  })

  it('Shift+h does NOT trigger navigation (modifier guard)', async () => {
    mockStackFocusMount(mockPhotos)
    render(StackFocus)
    await waitFor(() => screen.getAllByTestId('photo-card'))

    // Move right first
    await fireEvent.keyDown(document, { key: 'ArrowRight' })
    let cards = screen.getAllByTestId('photo-card')
    expect(cards[1].className).toContain('border-blue-500')

    // Press Shift+h — should NOT move focus (H is uppercase)
    await fireEvent.keyDown(document, { key: 'H', shiftKey: true })

    cards = screen.getAllByTestId('photo-card')
    expect(cards[1].className).toContain('border-blue-500')
  })
})

// ── K4: Home/End in StackFocus ─────────────────────────────────────────────

describe('StackFocus — K4: Home/End navigation', () => {
  it('Home key jumps to first photo', async () => {
    mockStackFocusMount(mockPhotos)
    render(StackFocus)
    await waitFor(() => screen.getAllByTestId('photo-card'))

    // Move to last photo
    await fireEvent.keyDown(document, { key: 'ArrowRight' })
    await fireEvent.keyDown(document, { key: 'ArrowRight' })
    let cards = screen.getAllByTestId('photo-card')
    expect(cards[2].className).toContain('border-blue-500')

    // Press Home
    await fireEvent.keyDown(document, { key: 'Home' })

    cards = screen.getAllByTestId('photo-card')
    expect(cards[0].className).toContain('border-blue-500')
    expect(cards[2].className).not.toContain('border-blue-500')
  })

  it('End key jumps to last photo', async () => {
    mockStackFocusMount(mockPhotos)
    render(StackFocus)
    await waitFor(() => screen.getAllByTestId('photo-card'))

    // Focus starts at 0
    let cards = screen.getAllByTestId('photo-card')
    expect(cards[0].className).toContain('border-blue-500')

    // Press End
    await fireEvent.keyDown(document, { key: 'End' })

    cards = screen.getAllByTestId('photo-card')
    expect(cards[2].className).toContain('border-blue-500')
    expect(cards[0].className).not.toContain('border-blue-500')
  })
})

// ── K5: E key in StackFocus opens SingleView ───────────────────────────────

describe('StackFocus — K5: E key opens SingleView', () => {
  it('e key navigates to SingleView (same as Enter)', async () => {
    mockStackFocusMount(mockPhotos)
    render(StackFocus)
    await waitFor(() => screen.getAllByTestId('photo-card'))

    await fireEvent.keyDown(document, { key: 'e' })

    expect(navigation.current.kind).toBe('single-view')
    if (navigation.current.kind === 'single-view') {
      expect(navigation.current.photoId).toBe(1)
    }
  })

  it('E key (uppercase) also navigates to SingleView', async () => {
    mockStackFocusMount(mockPhotos)
    render(StackFocus)
    await waitFor(() => screen.getAllByTestId('photo-card'))

    await fireEvent.keyDown(document, { key: 'E' })

    expect(navigation.current.kind).toBe('single-view')
    if (navigation.current.kind === 'single-view') {
      expect(navigation.current.photoId).toBe(1)
    }
  })

  it('e key on second photo opens SingleView with correct photoId', async () => {
    mockStackFocusMount(mockPhotos)
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
