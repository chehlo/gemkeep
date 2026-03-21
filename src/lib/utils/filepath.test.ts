import { describe, it, expect, vi } from 'vitest'
import { getDisplayedPath, copyToClipboard, toggleFileOverlay } from './filepath.js'
import { makePhotoDetail } from '../../test/fixtures.js'

// ─── getDisplayedPath ────────────────────────────────────────────────────────

describe('getDisplayedPath', () => {
  it('returns jpeg_path for a photo with jpeg_path', () => {
    const photo = makePhotoDetail({ jpeg_path: '/photos/IMG_001.jpg', preview_path: '/cache/preview.jpg' })
    expect(getDisplayedPath(photo)).toBe('/photos/IMG_001.jpg')
  })

  it('returns preview_path for a RAW-only photo with no jpeg_path', () => {
    const photo = makePhotoDetail({ jpeg_path: null, preview_path: '/cache/preview.jpg' })
    expect(getDisplayedPath(photo)).toBe('/cache/preview.jpg')
  })

  it('returns null for null photo', () => {
    expect(getDisplayedPath(null)).toBeNull()
  })
})

// ─── copyToClipboard ─────────────────────────────────────────────────────────

describe('copyToClipboard', () => {
  it('returns true when clipboard write succeeds', async () => {
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    })
    const result = await copyToClipboard('/photos/IMG_001.jpg')
    expect(result).toBe(true)
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('/photos/IMG_001.jpg')
  })

  it('returns false when clipboard write fails (no throw)', async () => {
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
    })
    const result = await copyToClipboard('/photos/IMG_001.jpg')
    expect(result).toBe(false)
  })
})

// ─── toggleFileOverlay ───────────────────────────────────────────────────────

describe('toggleFileOverlay', () => {
  it('first press: returns overlay=path and shouldCopy=true', () => {
    const photo = makePhotoDetail({ jpeg_path: '/photos/IMG_001.jpg' })
    const result = toggleFileOverlay(null, photo)
    expect(result).toEqual({
      overlay: '/photos/IMG_001.jpg',
      shouldCopy: true,
    })
  })

  it('second press: returns overlay=null and shouldCopy=false', () => {
    // Simulate actual two-press sequence: first press sets overlay, second clears it
    const photo = makePhotoDetail({ jpeg_path: '/photos/IMG_001.jpg' })
    const firstPress = toggleFileOverlay(null, photo)
    expect(firstPress.overlay).toBe('/photos/IMG_001.jpg')
    expect(firstPress.shouldCopy).toBe(true)

    // Second press: pass the overlay from first press back
    const secondPress = toggleFileOverlay(firstPress.overlay, photo)
    expect(secondPress).toEqual({
      overlay: null,
      shouldCopy: false,
    })
  })
})
