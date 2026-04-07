// SingleView visual tests — vitest-browser-svelte (real Chromium)
// Covers: SV-02 (photo fills viewport), SV-10 (X key marks ELIMINATED — visual indicator + dim)
// These tests verify actual rendered visual state via style-agnostic helpers.

import { render } from 'vitest-browser-svelte'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import { navigate } from '$lib/stores/navigation.svelte.js'
import { makeDecisionResult, makePhotoDetail } from '$test/fixtures'
import { mockSingleViewRouter } from '$test/helpers'
import { DECISION_SELECTORS } from '$test/decision-helpers'
import {
  assertVisuallyEliminated, assertVisuallyDimmed,
  assertVisuallyKept, assertVisuallyUndecided,
} from '$test/decision-visual-helpers'
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

// ─── Rule 22: focus + decision combinations (SingleView is single-panel,
// no multi-select, so the 'selected' dimension is N/A). ────────────────────

describe('SingleView — Rule 22: focus + decision combinations', () => {
  it('SV-Rule22: undecided + focused baseline shows focus indicator without decision', async () => {
    render(SingleView)
    await waitForImage()

    const frame = document.querySelector('[data-testid="photo-frame"]') as HTMLElement
    expect(frame).not.toBeNull()
    // Undecided: no decision color present.
    await assertVisuallyUndecided(frame)
  })

  it('SV-Rule22: keep + focused shows focus + kept indicator (Y key path)', async () => {
    mockInvoke.mockImplementation(mockSingleViewRouter({
      make_decision: makeDecisionResult({ action: 'keep', current_status: 'keep' }),
    }))
    render(SingleView)
    await waitForImage()

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'y', bubbles: true }))

    await vi.waitFor(async () => {
      const frame = document.querySelector('[data-testid="photo-frame"]') as HTMLElement
      await assertVisuallyKept(frame)
    }, { timeout: 5000 })
  })
})

describe('SingleView — SV-10: X key marks photo ELIMINATED (visual)', () => {
  it('X key produces eliminated visual indicator', async () => {
    mockInvoke.mockImplementation(mockSingleViewRouter({
      make_decision: makeDecisionResult({ action: 'eliminate', current_status: 'eliminate' }),
    }))
    render(SingleView)
    await waitForImage()

    // Before pressing X: no eliminate marker
    let marker = document.querySelector(DECISION_SELECTORS.eliminate) as HTMLElement | null
    expect(marker).toBeNull()

    // Press X to eliminate
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'x', bubbles: true }))

    // Wait for the eliminate marker to appear
    await vi.waitFor(() => {
      marker = document.querySelector(DECISION_SELECTORS.eliminate) as HTMLElement | null
      if (!marker) throw new Error('Eliminate marker not yet visible')
    }, { timeout: 5000 })

    // Verify the element visually shows the eliminate indicator
    await assertVisuallyEliminated(marker!)
  })

  it('X key visually dims the photo', async () => {
    mockInvoke.mockImplementation(mockSingleViewRouter({
      make_decision: makeDecisionResult({ action: 'eliminate', current_status: 'eliminate' }),
    }))
    render(SingleView)
    await waitForImage()

    // Press X to eliminate
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'x', bubbles: true }))

    // Wait for dimming to apply
    await vi.waitFor(() => {
      const frame = document.querySelector('[data-testid="photo-frame"]') as HTMLElement
      assertVisuallyDimmed(frame)
    }, { timeout: 5000 })
  })
})
