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
      expect(cards[0].querySelector('.badge-keep')).toBeInTheDocument()
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
      expect(cards[1].className).toContain('opacity-50')
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
      const redBadge = cards[1].querySelector('.badge-eliminate, .bg-red-500')
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
