// SingleView visual tests — vitest-browser-svelte (real Chromium)
// Covers: SV-02 (photo fills viewport), SV-10 (X key marks ELIMINATED — red border + dim)
// These tests verify actual computed CSS values, not class names.

import { render } from 'vitest-browser-svelte'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import { navigate } from '$lib/stores/navigation.svelte.js'
import type { PhotoDetail, LogicalPhotoSummary, PhotoDecisionStatus, RoundStatus } from '$lib/api/index.js'
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

const PHOTO_LIST: LogicalPhotoSummary[] = [
  { logical_photo_id: 1, thumbnail_path: '/cache/1.jpg', capture_time: '2024-01-15T10:30:00Z', camera_model: 'Canon', lens: '85mm', has_raw: true, has_jpeg: true },
  { logical_photo_id: 2, thumbnail_path: '/cache/2.jpg', capture_time: '2024-01-15T10:31:00Z', camera_model: 'Canon', lens: '85mm', has_raw: true, has_jpeg: true },
  { logical_photo_id: 3, thumbnail_path: '/cache/3.jpg', capture_time: '2024-01-15T10:32:00Z', camera_model: 'Canon', lens: '85mm', has_raw: true, has_jpeg: true },
]

const DECISIONS: PhotoDecisionStatus[] = [
  { logical_photo_id: 1, current_status: 'undecided' },
  { logical_photo_id: 2, current_status: 'undecided' },
  { logical_photo_id: 3, current_status: 'undecided' },
]

const OPEN_ROUND: RoundStatus = {
  round_id: 1, round_number: 1, state: 'open',
  total_photos: 3, decided: 0, kept: 0, eliminated: 0, undecided: 3, committed_at: null,
}

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
  mockInvoke.mockResolvedValueOnce(overrides?.detail ?? PHOTO_DETAIL)
  mockInvoke.mockResolvedValueOnce(overrides?.photos ?? PHOTO_LIST)
  mockInvoke.mockResolvedValueOnce(overrides?.decisions ?? DECISIONS)
  mockInvoke.mockResolvedValueOnce(overrides?.roundStatus ?? OPEN_ROUND)
}

beforeEach(() => {
  vi.clearAllMocks()
  setupNav()
})

/** Wait for the photo image to appear. */
async function waitForImage(): Promise<HTMLImageElement> {
  let img: HTMLImageElement | null = null
  await vi.waitFor(() => {
    img = document.querySelector('img') as HTMLImageElement
    if (!img) throw new Error('Image not yet rendered')
  }, { timeout: 5000 })
  return img!
}

describe('SingleView — SV-02: photo fills viewport (visual)', () => {
  it('image uses max-w-full and max-h-full to fill available space', async () => {
    mockMountSequence()
    render(SingleView)
    const img = await waitForImage()

    // Verify the img element has max-width and max-height constraints
    const style = getComputedStyle(img)

    // max-width: 100% (Tailwind max-w-full)
    expect(style.maxWidth).toBe('100%')

    // max-height: 100% (Tailwind max-h-full)
    expect(style.maxHeight).toBe('100%')

    // object-fit: contain (ensures aspect ratio is maintained)
    expect(style.objectFit).toBe('contain')
  })

  it('photo container uses flex centering to center the image', async () => {
    mockMountSequence()
    render(SingleView)
    await waitForImage()

    // The container div has class "flex-1 relative flex items-center justify-center"
    const container = document.querySelector('.flex-1.relative') as HTMLElement
    expect(container).not.toBeNull()

    const style = getComputedStyle(container)
    expect(style.display).toBe('flex')
    expect(style.alignItems).toBe('center')
    expect(style.justifyContent).toBe('center')
  })
})

describe('SingleView — SV-10: X key marks photo ELIMINATED — red border + dim (visual)', () => {
  it('X key produces red border overlay with correct border color', async () => {
    mockMountSequence()
    render(SingleView)
    await waitForImage()

    // Before pressing X: no red border overlay
    let redBorder = document.querySelector('.border-red-500') as HTMLElement | null
    expect(redBorder).toBeNull()

    // Mock the make_decision response
    mockInvoke.mockResolvedValueOnce({
      decision_id: 1, round_id: 1, action: 'eliminate',
      current_status: 'eliminate', round_auto_created: false,
    })

    // Press X to eliminate
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'x', bubbles: true }))

    // Wait for the red border to appear
    await vi.waitFor(() => {
      redBorder = document.querySelector('.border-red-500') as HTMLElement | null
      if (!redBorder) throw new Error('Red border not yet visible')
    }, { timeout: 5000 })

    // Verify the border color is red via getComputedStyle
    const borderColor = getComputedStyle(redBorder!).borderColor
    // Tailwind border-red-500 = rgb(239, 68, 68)
    expect(borderColor).toBe('rgb(239, 68, 68)')

    // Verify border width is 4px (border-4)
    const borderWidth = getComputedStyle(redBorder!).borderWidth
    expect(borderWidth).toBe('4px')

    // Verify the overlay covers the full area (inset-0 = position: absolute)
    const position = getComputedStyle(redBorder!).position
    expect(position).toBe('absolute')
  })

  it('X key produces dim overlay with reduced opacity', async () => {
    mockMountSequence()
    render(SingleView)
    await waitForImage()

    // Mock the make_decision response
    mockInvoke.mockResolvedValueOnce({
      decision_id: 1, round_id: 1, action: 'eliminate',
      current_status: 'eliminate', round_auto_created: false,
    })

    // Press X to eliminate
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'x', bubbles: true }))

    // Wait for the dim overlay to appear (bg-black/50)
    let dimOverlay: HTMLElement | null = null
    await vi.waitFor(() => {
      // The dim overlay has bg-black/50 which translates to background-color with alpha
      const overlays = document.querySelectorAll('.pointer-events-none') as NodeListOf<HTMLElement>
      for (const el of overlays) {
        const bg = getComputedStyle(el).backgroundColor
        // bg-black/50 = rgba(0, 0, 0, 0.5)
        if (bg.includes('0, 0, 0') && bg.includes('0.5')) {
          dimOverlay = el
          break
        }
      }
      if (!dimOverlay) throw new Error('Dim overlay not yet visible')
    }, { timeout: 5000 })

    // Verify the dim overlay has correct background
    const bg = getComputedStyle(dimOverlay!).backgroundColor
    expect(bg).toBe('rgba(0, 0, 0, 0.5)')

    // Verify overlay is absolutely positioned (inset-0)
    expect(getComputedStyle(dimOverlay!).position).toBe('absolute')
  })
})
