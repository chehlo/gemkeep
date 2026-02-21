import { describe, it, expect, vi } from 'vitest'
import { convertFileSrc } from '@tauri-apps/api/core'
import { getThumbnailUrl } from './index.js'

describe('getThumbnailUrl', () => {
  it('calls convertFileSrc with the path', () => {
    const path = '/home/user/.gem-keep/projects/test/cache/thumbnails/1.jpg'
    getThumbnailUrl(path)
    expect(vi.mocked(convertFileSrc)).toHaveBeenCalledWith(path)
  })

  it('returns the result of convertFileSrc — an asset:// URL in production', () => {
    const path = '/home/user/.gem-keep/thumbnails/42.jpg'
    // In production, convertFileSrc returns "asset://localhost/home/user/.."
    // In tests, the mock returns the path unchanged by default
    // This test verifies the function passes through convertFileSrc result correctly
    vi.mocked(convertFileSrc).mockReturnValueOnce('asset://localhost' + path)
    const url = getThumbnailUrl(path)
    expect(url).toBe('asset://localhost' + path)
  })

  it('does not modify the path before passing to convertFileSrc', () => {
    const path = '/absolute/path/with spaces/and-special_chars.jpg'
    getThumbnailUrl(path)
    expect(vi.mocked(convertFileSrc)).toHaveBeenCalledWith(path)
  })
})
