// src/lib/components/screens/SingleView.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/svelte'
import { invoke, convertFileSrc } from '@tauri-apps/api/core'
import { navigate, navigation } from '$lib/stores/navigation.svelte.js'
import type { PhotoDetail, RoundStatus, LogicalPhotoSummary, PhotoDecisionStatus } from '$lib/api/index.js'
import SingleView from './SingleView.svelte'

const mockInvoke = vi.mocked(invoke)

const PHOTO_DETAIL: PhotoDetail = {
  logical_photo_id: 1,
  thumbnail_path: '/cache/thumbnails/1.jpg',
  capture_time: '2024-01-15T10:30:00Z',
  camera_model: 'Canon EOS 5D',
  lens: 'EF 85mm f/1.4',
  has_raw: true,
  has_jpeg: true,
  current_status: 'undecided',
  aperture: 2.8,
  shutter_speed: '1/250',
  iso: 400,
  focal_length: 85.0,
  exposure_comp: 0.7,
  jpeg_path: '/home/user/Photos/IMG_001.jpg',
  raw_path: '/home/user/Photos/IMG_001.CR3',
}

const PHOTO_DETAIL_NO_PARAMS: PhotoDetail = {
  ...PHOTO_DETAIL,
  logical_photo_id: 2,
  aperture: null,
  shutter_speed: null,
  iso: null,
  focal_length: null,
  exposure_comp: null,
}

const PHOTO_LIST: LogicalPhotoSummary[] = [
  { logical_photo_id: 1, thumbnail_path: '/cache/1.jpg', capture_time: '2024-01-15T10:30:00Z', camera_model: 'Canon', lens: '85mm', has_raw: true, has_jpeg: true },
  { logical_photo_id: 2, thumbnail_path: '/cache/2.jpg', capture_time: '2024-01-15T10:31:00Z', camera_model: 'Canon', lens: '85mm', has_raw: true, has_jpeg: true },
  { logical_photo_id: 3, thumbnail_path: '/cache/3.jpg', capture_time: '2024-01-15T10:32:00Z', camera_model: 'Canon', lens: '85mm', has_raw: true, has_jpeg: true },
]

const OPEN_ROUND: RoundStatus = {
  round_id: 1,
  round_number: 1,
  state: 'open',
  total_photos: 3,
  decided: 0,
  kept: 0,
  eliminated: 0,
  undecided: 3,
  committed_at: null,
}

const COMMITTED_ROUND: RoundStatus = {
  ...OPEN_ROUND,
  state: 'committed',
  decided: 3,
  kept: 2,
  eliminated: 1,
  undecided: 0,
  committed_at: '2024-01-15T12:00:00Z',
}

const DECISIONS: PhotoDecisionStatus[] = [
  { logical_photo_id: 1, current_status: 'undecided' },
  { logical_photo_id: 2, current_status: 'undecided' },
  { logical_photo_id: 3, current_status: 'undecided' },
]

const DECISIONS_MIXED: PhotoDecisionStatus[] = [
  { logical_photo_id: 1, current_status: 'keep' },
  { logical_photo_id: 2, current_status: 'undecided' },
  { logical_photo_id: 3, current_status: 'eliminate' },
  { logical_photo_id: 4, current_status: 'undecided' },
  { logical_photo_id: 5, current_status: 'keep' },
]

function setupNav(photoId = 1) {
  navigate({ kind: 'single-view', projectSlug: 'test-project', projectName: 'Test', stackId: 1, photoId })
}

/**
 * Mock the standard SingleView mount sequence:
 * 1. get_photo_detail -> photo detail
 * 2. list_logical_photos -> photo list
 * 3. get_stack_decisions -> decisions
 * 4. get_round_status -> round status
 */
function mockMountSequence(overrides?: {
  detail?: PhotoDetail,
  photos?: LogicalPhotoSummary[],
  decisions?: PhotoDecisionStatus[],
  roundStatus?: RoundStatus,
}) {
  mockInvoke.mockResolvedValueOnce(overrides?.detail ?? PHOTO_DETAIL)       // get_photo_detail
  mockInvoke.mockResolvedValueOnce(overrides?.photos ?? PHOTO_LIST)         // list_logical_photos
  mockInvoke.mockResolvedValueOnce(overrides?.decisions ?? DECISIONS)       // get_stack_decisions
  mockInvoke.mockResolvedValueOnce(overrides?.roundStatus ?? OPEN_ROUND)   // get_round_status
}

beforeEach(() => {
  vi.clearAllMocks()
  setupNav()
})

describe('SingleView — loading and rendering', () => {
  it('renders loading state before data arrives', async () => {
    mockInvoke.mockImplementation(() => new Promise(() => {}))  // never resolves
    render(SingleView)
    expect(screen.getByTestId('loading-indicator')).toBeInTheDocument()
  })

  it('renders photo image with asset:// URL from jpeg_path', async () => {
    vi.mocked(convertFileSrc).mockImplementation((p: string) => `asset://localhost${p}`)
    mockMountSequence()
    render(SingleView)
    await waitFor(() => {
      const img = screen.getByRole('img')
      expect(img).toHaveAttribute('src', `asset://localhost/home/user/Photos/IMG_001.jpg`)
    })
  })

  it('renders camera params: f/2.8, 1/250, ISO 400, 85mm', async () => {
    mockMountSequence()
    render(SingleView)
    await waitFor(() => {
      expect(screen.getByText(/f\/2\.8/)).toBeInTheDocument()
      expect(screen.getByText(/1\/250/)).toBeInTheDocument()
      expect(screen.getByText(/ISO 400/)).toBeInTheDocument()
      expect(screen.getByText(/85mm/)).toBeInTheDocument()
    })
  })

  it('renders "--" placeholders when camera params are null', async () => {
    mockMountSequence({ detail: PHOTO_DETAIL_NO_PARAMS })
    render(SingleView)
    await waitFor(() => {
      const dashes = screen.getAllByText('--')
      expect(dashes.length).toBeGreaterThanOrEqual(4)
    })
  })
})

describe('SingleView — keyboard decisions', () => {
  it('Y key marks photo as keep', async () => {
    mockMountSequence()
    render(SingleView)
    await waitFor(() => screen.getByRole('img'))

    // Mock the make_decision response
    mockInvoke.mockResolvedValueOnce({
      decision_id: 1, round_id: 1, action: 'keep',
      current_status: 'keep', round_auto_created: false,
    })

    await fireEvent.keyDown(document, { key: 'y' })

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('make_decision', {
        slug: 'test-project', logicalPhotoId: 1, action: 'keep',
      })
    })
  })

  it('X key marks photo as eliminate', async () => {
    mockMountSequence()
    render(SingleView)
    await waitFor(() => screen.getByRole('img'))

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

  it('Left/Right arrows navigate between photos', async () => {
    mockMountSequence()
    render(SingleView)
    await waitFor(() => screen.getByRole('img'))

    // Navigate right -- should call get_photo_detail for photo 2
    mockInvoke.mockResolvedValueOnce({ ...PHOTO_DETAIL, logical_photo_id: 2 })

    await fireEvent.keyDown(document, { key: 'ArrowRight' })

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('get_photo_detail', {
        slug: 'test-project', logicalPhotoId: 2,
      })
    })
  })

  it('Escape goes back to stack-focus', async () => {
    mockMountSequence()
    render(SingleView)
    await waitFor(() => screen.getByRole('img'))

    await fireEvent.keyDown(document, { key: 'Escape' })

    expect(navigation.current.kind).toBe('stack-focus')
  })

  it('I key toggles camera params visibility', async () => {
    mockMountSequence()
    render(SingleView)
    await waitFor(() => screen.getByText(/f\/2\.8/))

    // Press I to hide
    await fireEvent.keyDown(document, { key: 'i' })
    expect(screen.queryByText(/f\/2\.8/)).not.toBeInTheDocument()

    // Press I again to show
    await fireEvent.keyDown(document, { key: 'i' })
    await waitFor(() => {
      expect(screen.getByText(/f\/2\.8/)).toBeInTheDocument()
    })
  })

  it('Ctrl+Enter commits the round', async () => {
    mockMountSequence()
    render(SingleView)
    await waitFor(() => screen.getByRole('img'))

    mockInvoke.mockResolvedValueOnce(undefined)  // commit_round

    await fireEvent.keyDown(document, { key: 'Enter', ctrlKey: true })

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('commit_round', {
        slug: 'test-project', stackId: 1,
      })
    })
  })
})

describe('SingleView — committed round behavior', () => {
  it('Y key does NOT call makeDecision when round is committed', async () => {
    mockMountSequence({ roundStatus: COMMITTED_ROUND })
    render(SingleView)
    await waitFor(() => screen.getByRole('img'))

    await fireEvent.keyDown(document, { key: 'y' })

    // Small delay to flush
    await new Promise(r => setTimeout(r, 50))
    expect(mockInvoke).not.toHaveBeenCalledWith('make_decision', expect.anything())
  })
})

describe('SingleView — status bar', () => {
  it('shows photo position and status', async () => {
    mockMountSequence({
      detail: { ...PHOTO_DETAIL, current_status: 'keep' },
      photos: PHOTO_LIST,
    })
    render(SingleView)
    await waitFor(() => {
      expect(screen.getByText(/Photo 1\/3/)).toBeInTheDocument()
      expect(screen.getByText(/KEPT/i)).toBeInTheDocument()
    })
  })
})

describe('SingleView — Tab navigation', () => {
  it('Tab jumps to next undecided photo', async () => {
    setupNav(1)
    mockMountSequence({ decisions: DECISIONS_MIXED, photos: [
      { logical_photo_id: 1, thumbnail_path: null, capture_time: null, camera_model: null, lens: null, has_raw: false, has_jpeg: true },
      { logical_photo_id: 2, thumbnail_path: null, capture_time: null, camera_model: null, lens: null, has_raw: false, has_jpeg: true },
      { logical_photo_id: 3, thumbnail_path: null, capture_time: null, camera_model: null, lens: null, has_raw: false, has_jpeg: true },
      { logical_photo_id: 4, thumbnail_path: null, capture_time: null, camera_model: null, lens: null, has_raw: false, has_jpeg: true },
      { logical_photo_id: 5, thumbnail_path: null, capture_time: null, camera_model: null, lens: null, has_raw: false, has_jpeg: true },
    ] })
    render(SingleView)
    await waitFor(() => screen.getByRole('img'))

    // Photo 1 is 'keep' (decided), Tab should jump to photo 2 (undecided)
    mockInvoke.mockResolvedValueOnce({ ...PHOTO_DETAIL, logical_photo_id: 2 })

    await fireEvent.keyDown(document, { key: 'Tab' })

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('get_photo_detail', {
        slug: 'test-project', logicalPhotoId: 2,
      })
    })
  })
})

describe('SingleView — Home/End navigation', () => {
  const FIVE_PHOTOS: LogicalPhotoSummary[] = [
    { logical_photo_id: 1, thumbnail_path: null, capture_time: null, camera_model: null, lens: null, has_raw: false, has_jpeg: true },
    { logical_photo_id: 2, thumbnail_path: null, capture_time: null, camera_model: null, lens: null, has_raw: false, has_jpeg: true },
    { logical_photo_id: 3, thumbnail_path: null, capture_time: null, camera_model: null, lens: null, has_raw: false, has_jpeg: true },
    { logical_photo_id: 4, thumbnail_path: null, capture_time: null, camera_model: null, lens: null, has_raw: false, has_jpeg: true },
    { logical_photo_id: 5, thumbnail_path: null, capture_time: null, camera_model: null, lens: null, has_raw: false, has_jpeg: true },
  ]

  it('Home key jumps to first photo', async () => {
    // Start at photo 4 (index 3)
    setupNav(4)
    mockMountSequence({
      detail: { ...PHOTO_DETAIL, logical_photo_id: 4 },
      photos: FIVE_PHOTOS,
    })
    render(SingleView)
    await waitFor(() => screen.getByRole('img'))

    // Home should jump to first photo
    mockInvoke.mockResolvedValueOnce({ ...PHOTO_DETAIL, logical_photo_id: 1 })

    await fireEvent.keyDown(document, { key: 'Home' })

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('get_photo_detail', {
        slug: 'test-project', logicalPhotoId: 1,
      })
    })
  })

  it('End key jumps to last photo', async () => {
    setupNav(1)
    mockMountSequence({ photos: FIVE_PHOTOS })
    render(SingleView)
    await waitFor(() => screen.getByRole('img'))

    // End should jump to last photo (id=5)
    mockInvoke.mockResolvedValueOnce({ ...PHOTO_DETAIL, logical_photo_id: 5 })

    await fireEvent.keyDown(document, { key: 'End' })

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('get_photo_detail', {
        slug: 'test-project', logicalPhotoId: 5,
      })
    })
  })
})

describe('SingleView — Shift+Tab navigation', () => {
  it('Shift+Tab jumps to previous undecided photo', async () => {
    const FIVE_PHOTOS: LogicalPhotoSummary[] = [
      { logical_photo_id: 1, thumbnail_path: null, capture_time: null, camera_model: null, lens: null, has_raw: false, has_jpeg: true },
      { logical_photo_id: 2, thumbnail_path: null, capture_time: null, camera_model: null, lens: null, has_raw: false, has_jpeg: true },
      { logical_photo_id: 3, thumbnail_path: null, capture_time: null, camera_model: null, lens: null, has_raw: false, has_jpeg: true },
      { logical_photo_id: 4, thumbnail_path: null, capture_time: null, camera_model: null, lens: null, has_raw: false, has_jpeg: true },
      { logical_photo_id: 5, thumbnail_path: null, capture_time: null, camera_model: null, lens: null, has_raw: false, has_jpeg: true },
    ]

    // Start at photo 5 (index 4)
    setupNav(5)
    mockMountSequence({
      detail: { ...PHOTO_DETAIL, logical_photo_id: 5, current_status: 'keep' },
      photos: FIVE_PHOTOS,
      decisions: [
        { logical_photo_id: 1, current_status: 'keep' },
        { logical_photo_id: 2, current_status: 'undecided' },
        { logical_photo_id: 3, current_status: 'eliminate' },
        { logical_photo_id: 4, current_status: 'undecided' },
        { logical_photo_id: 5, current_status: 'keep' },
      ],
    })
    render(SingleView)
    await waitFor(() => screen.getByRole('img'))

    // Shift+Tab should jump backward to previous undecided — photo 4 (index 3)
    mockInvoke.mockResolvedValueOnce({ ...PHOTO_DETAIL, logical_photo_id: 4 })

    await fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('get_photo_detail', {
        slug: 'test-project', logicalPhotoId: 4,
      })
    })
  })
})

describe('SingleView — eliminate visual feedback', () => {
  it('X key shows red border AND dim overlay', async () => {
    mockMountSequence()
    render(SingleView)
    await waitFor(() => screen.getByRole('img'))

    mockInvoke.mockResolvedValueOnce({
      decision_id: 1, round_id: 1, action: 'eliminate',
      current_status: 'eliminate', round_auto_created: false,
    })

    await fireEvent.keyDown(document, { key: 'x' })

    await waitFor(() => {
      // Red border should be present
      const borderEl = document.querySelector('.border-red-500')
      expect(borderEl).toBeInTheDocument()
      // Dim overlay (bg-black/50 or similar) should also be present for eliminated photos
      const dimOverlay = document.querySelector('[class*="bg-black"]')
      expect(dimOverlay).toBeInTheDocument()
    })
  })
})

describe('SingleView — camera params panel extended info', () => {
  it('Camera params panel shows camera model and lens', async () => {
    mockMountSequence({
      detail: { ...PHOTO_DETAIL, camera_model: 'Canon EOS R5', lens: 'RF 85mm f/1.2L' },
    })
    render(SingleView)

    await waitFor(() => {
      expect(screen.getByText(/Canon EOS R5/)).toBeInTheDocument()
      expect(screen.getByText(/RF 85mm/)).toBeInTheDocument()
    })
  })

  it('Camera params panel shows RAW and JPEG badges', async () => {
    mockMountSequence({
      detail: { ...PHOTO_DETAIL, has_raw: true, has_jpeg: true },
    })
    render(SingleView)

    await waitFor(() => {
      expect(screen.getByText('RAW')).toBeInTheDocument()
      expect(screen.getByText('JPEG')).toBeInTheDocument()
    })
  })

  it('Camera params panel shows capture date and time', async () => {
    mockMountSequence({
      detail: { ...PHOTO_DETAIL, capture_time: '2024-02-14T14:23:01Z' },
    })
    render(SingleView)

    await waitFor(() => {
      // Should display date/time info from capture_time
      const text = document.body.textContent ?? ''
      const hasDate = text.includes('Feb 14') || text.includes('14:23') || text.includes('2024-02-14')
      expect(hasDate).toBe(true)
    })
  })
})

describe('SingleView — status bar extended format', () => {
  it('Status bar shows stack name and round number', async () => {
    mockMountSequence()
    render(SingleView)

    await waitFor(() => {
      const text = document.body.textContent ?? ''
      // Status bar should show the project/stack context and round number
      expect(text).toContain('Round 1')
    })
  })
})

describe('SingleView — arrow boundary behavior', () => {
  it('ArrowRight at last photo does NOT call get_photo_detail (SV-31)', async () => {
    // Start at the last photo (id=3, index 2 in a 3-photo list)
    setupNav(3)
    mockMountSequence({
      detail: { ...PHOTO_DETAIL, logical_photo_id: 3 },
      photos: PHOTO_LIST,
    })
    render(SingleView)
    await waitFor(() => screen.getByRole('img'))

    const callCountBefore = mockInvoke.mock.calls.length

    await fireEvent.keyDown(document, { key: 'ArrowRight' })

    // Small delay to flush any async effects
    await new Promise(r => setTimeout(r, 50))

    // No additional get_photo_detail call should have been made
    const callCountAfter = mockInvoke.mock.calls.length
    expect(callCountAfter).toBe(callCountBefore)
  })

  it('ArrowLeft at first photo does NOT call get_photo_detail (SV-32)', async () => {
    // Start at first photo (id=1, index 0)
    setupNav(1)
    mockMountSequence()
    render(SingleView)
    await waitFor(() => screen.getByRole('img'))

    const callCountBefore = mockInvoke.mock.calls.length

    await fireEvent.keyDown(document, { key: 'ArrowLeft' })

    await new Promise(r => setTimeout(r, 50))

    const callCountAfter = mockInvoke.mock.calls.length
    expect(callCountAfter).toBe(callCountBefore)
  })
})

describe('SingleView — vim-style navigation', () => {
  it('l key navigates to next photo like ArrowRight (SV-33)', async () => {
    setupNav(1)
    mockMountSequence()
    render(SingleView)
    await waitFor(() => screen.getByRole('img'))

    // Mock get_photo_detail for next photo
    mockInvoke.mockResolvedValueOnce({ ...PHOTO_DETAIL, logical_photo_id: 2 })

    await fireEvent.keyDown(document, { key: 'l' })

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('get_photo_detail', {
        slug: 'test-project', logicalPhotoId: 2,
      })
    })
  })

  it('h key navigates to previous photo like ArrowLeft (SV-33)', async () => {
    // Start at photo 2 so we can go back
    setupNav(2)
    mockMountSequence({
      detail: { ...PHOTO_DETAIL, logical_photo_id: 2 },
      photos: PHOTO_LIST,
    })
    render(SingleView)
    await waitFor(() => screen.getByRole('img'))

    // Mock get_photo_detail for previous photo
    mockInvoke.mockResolvedValueOnce({ ...PHOTO_DETAIL, logical_photo_id: 1 })

    await fireEvent.keyDown(document, { key: 'h' })

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('get_photo_detail', {
        slug: 'test-project', logicalPhotoId: 1,
      })
    })
  })
})

describe('SingleView — X key blocked when committed (SV-35)', () => {
  it('X key does NOT call makeDecision when round is committed', async () => {
    mockMountSequence({ roundStatus: COMMITTED_ROUND })
    render(SingleView)
    await waitFor(() => screen.getByRole('img'))

    await fireEvent.keyDown(document, { key: 'x' })

    await new Promise(r => setTimeout(r, 50))
    expect(mockInvoke).not.toHaveBeenCalledWith('make_decision', expect.anything())
  })
})

describe('SingleView — thumbnail_path fallback (SV-40)', () => {
  it('renders thumbnail_path when jpeg_path is null', async () => {
    vi.mocked(convertFileSrc).mockImplementation((p: string) => `asset://localhost${p}`)
    mockMountSequence({
      detail: { ...PHOTO_DETAIL, jpeg_path: null, thumbnail_path: '/cache/thumbnails/1.jpg' },
    })
    render(SingleView)

    await waitFor(() => {
      const img = screen.getByRole('img')
      expect(img).toHaveAttribute('src', 'asset://localhost/cache/thumbnails/1.jpg')
    })
  })
})
