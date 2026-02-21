// src/lib/components/screens/StackFocus.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/svelte'
import { invoke, convertFileSrc } from '@tauri-apps/api/core'
import { navigate } from '$lib/stores/navigation.svelte.js'
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

describe('StackFocus — photo grid', () => {
  it('renders photo grid after data loads', async () => {
    mockInvoke.mockResolvedValueOnce(mockPhotos) // list_logical_photos

    render(StackFocus)

    await waitFor(() => {
      const cards = screen.getAllByTestId('photo-card')
      expect(cards).toHaveLength(3)
    })
  })

  it('renders img with asset:// URL when thumbnail_path is set', async () => {
    const thumbPath = '/home/user/.gem-keep/test.jpg'
    vi.mocked(convertFileSrc).mockImplementation((p: string) => `asset://localhost${p}`)

    mockInvoke.mockResolvedValueOnce([
      { ...PHOTO_1, thumbnail_path: thumbPath }
    ]) // list_logical_photos

    render(StackFocus)

    await waitFor(() => {
      const img = screen.getByRole('img')
      expect(img).toBeInTheDocument()
      expect(img).toHaveAttribute('src', `asset://localhost${thumbPath}`)
    })
  })

  it('renders placeholder when thumbnail_path is null', async () => {
    mockInvoke.mockResolvedValueOnce([PHOTO_3]) // thumbnail_path is null

    render(StackFocus)

    await waitFor(() => {
      expect(screen.getByTestId('photo-card')).toBeInTheDocument()
    })

    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(screen.getByTestId('photo-placeholder')).toBeInTheDocument()
  })

  it('shows camera model when present', async () => {
    mockInvoke.mockResolvedValueOnce([
      { ...PHOTO_1, camera_model: 'Canon EOS 5D Mark IV', lens: 'EF 85mm f/1.4' }
    ]) // list_logical_photos

    render(StackFocus)

    await waitFor(() => {
      // truncated to 18 chars: "Canon EOS 5D Mark " but let's check the actual truncation
      // "Canon EOS 5D Mark IV" is 20 chars, truncated to 18 = "Canon EOS 5D Mark "
      // We'll just check the beginning is present
      expect(screen.getByText(/Canon EOS 5D/)).toBeInTheDocument()
    })
  })

  it('shows RAW badge when has_raw is true', async () => {
    mockInvoke.mockResolvedValueOnce([
      { ...PHOTO_1, has_raw: true, has_jpeg: true }
    ]) // list_logical_photos

    render(StackFocus)

    await waitFor(() => {
      expect(screen.getByText('RAW')).toBeInTheDocument()
    })
    expect(screen.getByText('JPEG')).toBeInTheDocument()
  })
})
