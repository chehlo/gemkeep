// Display source resolution utilities.
// Single source of truth for photo→display URL mapping across all screens.

import { convertFileSrc } from '@tauri-apps/api/core'
import type { PhotoDetail, LogicalPhotoSummary } from '$lib/api/index.js'

/** Explicit per-screen quality declaration. Future: 'raw' mode for toggle. */
export type DisplayMode = 'thumbnail' | 'full'

/** Deterministic result of resolving photo+mode to a display source. */
export interface ResolvedDisplaySrc {
  url: string
  quality: 'jpeg' | 'preview' | 'thumbnail' | 'none'
}

type PhotoLike = PhotoDetail | LogicalPhotoSummary | null

/**
 * Resolve a photo to its best available display source for the given mode.
 *
 * - 'full': jpeg_path → preview_path → thumbnail_path → none
 * - 'thumbnail': thumbnail_path → none
 */
export function resolveDisplaySrc(mode: DisplayMode, photo: PhotoLike): ResolvedDisplaySrc {
  if (!photo) {
    return { url: '', quality: 'none' }
  }

  if (mode === 'full') {
    // Full mode: try best quality first, fall back through chain
    if ('jpeg_path' in photo && photo.jpeg_path) {
      return { url: convertFileSrc(photo.jpeg_path), quality: 'jpeg' }
    }
    if ('preview_path' in photo && photo.preview_path) {
      return { url: convertFileSrc(photo.preview_path), quality: 'preview' }
    }
    if (photo.thumbnail_path) {
      return { url: convertFileSrc(photo.thumbnail_path), quality: 'thumbnail' }
    }
    return { url: '', quality: 'none' }
  }

  // Thumbnail mode: only thumbnail
  if (photo.thumbnail_path) {
    return { url: convertFileSrc(photo.thumbnail_path), quality: 'thumbnail' }
  }
  return { url: '', quality: 'none' }
}

/**
 * Map a screen kind to its appropriate display mode.
 * Documents the screen→quality contract.
 */
export function screenDisplayMode(screenKind: string): DisplayMode {
  switch (screenKind) {
    case 'single':
    case 'comparison':
      return 'full'
    case 'stack-focus':
    case 'stack-overview':
      return 'thumbnail'
    default:
      return 'thumbnail'
  }
}
