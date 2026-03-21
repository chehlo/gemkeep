// SingleView visual tests — vitest-browser-svelte (real Chromium)
// Covers: SV-02 (photo fills viewport), SV-10 (X key marks ELIMINATED — red border + dim)
// These tests verify actual computed CSS values, not class names.

import { render } from 'vitest-browser-svelte'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import { navigate } from '$lib/stores/navigation.svelte.js'
import { makeDecisionResult, makePhotoDetail } from '$test/fixtures'
import { mockSingleViewRouter } from '$test/helpers'
import SingleView from './SingleView.svelte'

const mockInvoke = vi.mocked(invoke)

function setupNav(photoId = 1) {
  navigate({ kind: 'single-view', projectSlug: 'test-project', projectName: 'Test', stackId: 1, photoId })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockInvoke.mockImplementation(mockSingleViewRouter())
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
  it('image has non-zero dimensions and object-fit:contain', async () => {
    render(SingleView)
    const img = await waitForImage()

    // Verify the img element fills the container with object-contain
    const style = getComputedStyle(img)

    // width: 100% (Tailwind w-full)
    expect(style.width).not.toBe('0px')

    // height: 100% (Tailwind h-full)
    expect(style.height).not.toBe('0px')

    // object-fit: contain (ensures aspect ratio is maintained)
    expect(style.objectFit).toBe('contain')
  })

  it('photo container uses flex centering to center the image', async () => {
    render(SingleView)
    await waitForImage()

    // The container div has class "flex-1 relative flex items-center justify-center"
    const container = document.querySelector('[data-testid="photo-area"]') as HTMLElement
    expect(container).not.toBeNull()

    const style = getComputedStyle(container)
    expect(style.display).toBe('flex')
    expect(style.alignItems).toBe('center')
    expect(style.justifyContent).toBe('center')
  })
})

describe('SingleView — BUG-08: photo fits within viewport', () => {
  it('image fits container — not oversized AND not undersized', async () => {
    render(SingleView)
    const img = await waitForImage()

    const container = document.querySelector('[data-testid="photo-area"]') as HTMLElement
    expect(container).not.toBeNull()

    const containerRect = container.getBoundingClientRect()
    const imgRect = img.getBoundingClientRect()

    // Not oversized: image must not exceed container bounds
    expect(imgRect.height).toBeLessThanOrEqual(containerRect.height)
    expect(imgRect.width).toBeLessThanOrEqual(containerRect.width)

    // Not undersized: image should fill at least one dimension (50%+ of container)
    // With object-contain, the image fills one axis fully and the other proportionally
    const fillRatio = Math.max(
      imgRect.width / containerRect.width,
      imgRect.height / containerRect.height
    )
    expect(fillRatio).toBeGreaterThanOrEqual(0.5)
  })
})

describe('SingleView — BUG-10: thumbnail-only photo fits viewport', () => {
  it('thumbnail image fits container — scaled up, not stuck at 256px', async () => {
    // Mock a photo with no jpeg_path (RAW-only, thumbnail fallback)
    mockInvoke.mockImplementation(mockSingleViewRouter({
      get_photo_detail: makePhotoDetail({ jpeg_path: null, raw_path: '/photos/IMG.CR3' }),
    }))
    render(SingleView)
    const img = await waitForImage()

    const container = document.querySelector('[data-testid="photo-area"]') as HTMLElement
    expect(container).not.toBeNull()

    const containerRect = container.getBoundingClientRect()
    const imgRect = img.getBoundingClientRect()

    // Not oversized: image must not exceed container bounds
    expect(imgRect.height).toBeLessThanOrEqual(containerRect.height)
    expect(imgRect.width).toBeLessThanOrEqual(containerRect.width)

    // Not undersized: thumbnail (256x256) should scale UP to fill container,
    // not display at its tiny natural size
    const fillRatio = Math.max(
      imgRect.width / containerRect.width,
      imgRect.height / containerRect.height
    )
    expect(fillRatio).toBeGreaterThanOrEqual(0.5)
  })
})

describe('SingleView — BUG-10b: RAW-only photo uses preview_path for quality display', () => {
  it('renders preview_path image when jpeg_path is null but preview_path exists', async () => {
    // RAW-only photo: no jpeg_path, but backend provides a full-size preview
    mockInvoke.mockImplementation(mockSingleViewRouter({
      get_photo_detail: makePhotoDetail({
        jpeg_path: null,
        raw_path: '/photos/IMG.CR3',
        preview_path: '/cache/1_preview.jpg',
        thumbnail_path: '/cache/1.jpg',
      }),
    }))
    render(SingleView)
    const img = await waitForImage()

    // The img src should use the preview_path (high quality), not thumbnail_path (256x256)
    expect(img.src).toContain('1_preview.jpg')
    expect(img.src).not.toContain('/cache/1.jpg')
  })

  it('falls back to thumbnail_path when neither jpeg_path nor preview_path exists', async () => {
    // RAW-only photo with no preview extracted (legacy import)
    mockInvoke.mockImplementation(mockSingleViewRouter({
      get_photo_detail: makePhotoDetail({
        jpeg_path: null,
        raw_path: '/photos/IMG.CR3',
        preview_path: null,
        thumbnail_path: '/cache/1.jpg',
      }),
    }))
    render(SingleView)
    const img = await waitForImage()

    // Should fall back to thumbnail
    expect(img.src).toContain('/cache/1.jpg')
  })
})

describe('SingleView — SV-10: X key marks photo ELIMINATED — red border + dim (visual)', () => {
  it('X key produces red border overlay with correct border color', async () => {
    mockInvoke.mockImplementation(mockSingleViewRouter({
      make_decision: makeDecisionResult({ action: 'eliminate', current_status: 'eliminate' }),
    }))
    render(SingleView)
    await waitForImage()

    // Before pressing X: no red border overlay
    let redBorder = document.querySelector('.border-red-500') as HTMLElement | null
    expect(redBorder).toBeNull()

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

    // Verify border width is 2px (border-2, absorbed into PhotoFrame container)
    const borderWidth = getComputedStyle(redBorder!).borderWidth
    expect(borderWidth).toBe('2px')

    // Container uses relative positioning (not an absolute overlay anymore)
    const position = getComputedStyle(redBorder!).position
    expect(position).toBe('relative')
  })

  it('X key produces dim overlay with reduced opacity', async () => {
    mockInvoke.mockImplementation(mockSingleViewRouter({
      make_decision: makeDecisionResult({ action: 'eliminate', current_status: 'eliminate' }),
    }))
    render(SingleView)
    await waitForImage()

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
