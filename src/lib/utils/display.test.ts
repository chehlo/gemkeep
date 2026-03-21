import { describe, it, expect } from 'vitest'
import { resolveDisplaySrc, screenDisplayMode } from './display'
import { makePhotoDetail } from '../../test/fixtures'
import type { LogicalPhotoSummary } from '$lib/api/index.js'

// convertFileSrc is globally mocked in setup.ts → asset://localhost{path}

describe('resolveDisplaySrc', () => {
  describe('full mode', () => {
    it('prefers jpeg_path when all paths available', () => {
      const photo = makePhotoDetail({
        jpeg_path: '/photos/img.jpg',
        preview_path: '/cache/preview.jpg',
        thumbnail_path: '/cache/thumb.jpg',
      })
      const result = resolveDisplaySrc('full', photo)
      expect(result).toEqual({
        url: 'asset://localhost/photos/img.jpg',
        quality: 'jpeg',
      })
    })

    it('falls back to preview_path when no jpeg', () => {
      const photo = makePhotoDetail({
        jpeg_path: null,
        preview_path: '/cache/preview.jpg',
        thumbnail_path: '/cache/thumb.jpg',
      })
      const result = resolveDisplaySrc('full', photo)
      expect(result).toEqual({
        url: 'asset://localhost/cache/preview.jpg',
        quality: 'preview',
      })
    })

    it('falls back to thumbnail_path when no jpeg or preview', () => {
      const photo = makePhotoDetail({
        jpeg_path: null,
        preview_path: null,
        thumbnail_path: '/cache/thumb.jpg',
      })
      const result = resolveDisplaySrc('full', photo)
      expect(result).toEqual({
        url: 'asset://localhost/cache/thumb.jpg',
        quality: 'thumbnail',
      })
    })

    it('returns none when no paths available', () => {
      const photo = makePhotoDetail({
        jpeg_path: null,
        preview_path: null,
        thumbnail_path: null,
      })
      const result = resolveDisplaySrc('full', photo)
      expect(result).toEqual({ url: '', quality: 'none' })
    })
  })

  describe('thumbnail mode', () => {
    it('uses thumbnail_path when available', () => {
      const photo = makePhotoDetail({
        thumbnail_path: '/cache/thumb.jpg',
      })
      const result = resolveDisplaySrc('thumbnail', photo)
      expect(result).toEqual({
        url: 'asset://localhost/cache/thumb.jpg',
        quality: 'thumbnail',
      })
    })

    it('returns none when no thumbnail', () => {
      const photo = makePhotoDetail({
        thumbnail_path: null,
      })
      const result = resolveDisplaySrc('thumbnail', photo)
      expect(result).toEqual({ url: '', quality: 'none' })
    })

    it('ignores jpeg_path and preview_path in thumbnail mode', () => {
      const photo = makePhotoDetail({
        jpeg_path: '/photos/img.jpg',
        preview_path: '/cache/preview.jpg',
        thumbnail_path: null,
      })
      const result = resolveDisplaySrc('thumbnail', photo)
      expect(result).toEqual({ url: '', quality: 'none' })
    })
  })

  describe('null photo', () => {
    it('returns none for null photo in full mode', () => {
      const result = resolveDisplaySrc('full', null)
      expect(result).toEqual({ url: '', quality: 'none' })
    })

    it('returns none for null photo in thumbnail mode', () => {
      const result = resolveDisplaySrc('thumbnail', null)
      expect(result).toEqual({ url: '', quality: 'none' })
    })
  })

  describe('LogicalPhotoSummary (no jpeg_path/preview_path)', () => {
    it('full mode falls back to thumbnail for summary type', () => {
      const summary: LogicalPhotoSummary = {
        logical_photo_id: 1,
        thumbnail_path: '/cache/thumb.jpg',
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
      const result = resolveDisplaySrc('full', summary)
      expect(result).toEqual({
        url: 'asset://localhost/cache/thumb.jpg',
        quality: 'thumbnail',
      })
    })

    it('full mode returns none for summary with no thumbnail', () => {
      const summary: LogicalPhotoSummary = {
        logical_photo_id: 1,
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
      const result = resolveDisplaySrc('full', summary)
      expect(result).toEqual({ url: '', quality: 'none' })
    })
  })
})

describe('screenDisplayMode', () => {
  it('returns full for single screen', () => {
    expect(screenDisplayMode('single')).toBe('full')
  })

  it('returns full for comparison screen', () => {
    expect(screenDisplayMode('comparison')).toBe('full')
  })

  it('returns thumbnail for stack-focus screen', () => {
    expect(screenDisplayMode('stack-focus')).toBe('thumbnail')
  })

  it('returns thumbnail for stack-overview screen', () => {
    expect(screenDisplayMode('stack-overview')).toBe('thumbnail')
  })

  it('defaults to thumbnail for unknown screens', () => {
    expect(screenDisplayMode('unknown')).toBe('thumbnail')
    expect(screenDisplayMode('')).toBe('thumbnail')
  })
})
