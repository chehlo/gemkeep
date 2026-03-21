// File path display and clipboard utilities.
// Shared logic for F key overlay across screens.

import type { PhotoDetail } from '$lib/api/index.js'

/** Get the file path of the currently displayed format for a photo.
 * Uses the same cascade as resolveDisplaySrc('full', photo):
 * jpeg_path → preview_path → thumbnail_path → null
 * Returns only the single path that would actually be displayed. */
export function getDisplayedPath(photo: PhotoDetail | null): string | null {
  if (!photo) return null
  if (photo.jpeg_path) return photo.jpeg_path
  if (photo.preview_path) return photo.preview_path
  if (photo.thumbnail_path) return photo.thumbnail_path
  return null
}

/** Copy text to clipboard. Returns true on success, false on failure.
 * Graceful degradation — never throws. */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

/** Toggle F key overlay state. Returns { overlay, shouldCopy }.
 * First press: overlay = path, shouldCopy = true.
 * Second press: overlay = null, shouldCopy = false. */
export function toggleFileOverlay(
  currentOverlay: string | null,
  photo: PhotoDetail | null
): { overlay: string | null; shouldCopy: boolean } {
  if (currentOverlay !== null) {
    return { overlay: null, shouldCopy: false }
  }
  const path = getDisplayedPath(photo)
  return { overlay: path, shouldCopy: path !== null }
}
