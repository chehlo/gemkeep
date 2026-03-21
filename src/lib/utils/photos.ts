import type { PhotoDecisionStatus, DecisionStatus, LogicalPhotoSummary } from '$lib/api/index.js'

/**
 * Update a decision in a decisions array (mutates the array in-place for Svelte reactivity).
 * If the photo already has a decision, updates it; otherwise appends a new entry.
 */
export function updateDecisionState(
  decisions: PhotoDecisionStatus[],
  photoId: number,
  status: DecisionStatus,
): PhotoDecisionStatus[] {
  const existing = decisions.findIndex(d => d.logical_photo_id === photoId)
  if (existing >= 0) {
    decisions[existing] = { ...decisions[existing], current_status: status }
    return decisions
  } else {
    return [...decisions, { logical_photo_id: photoId, current_status: status }]
  }
}

/**
 * Format an ISO capture time string for display.
 * Returns month, day, and local time (e.g. "Mar 15 10:30:00").
 *
 * @param iso - ISO date string, or null
 * @param fallback - string returned when iso is null/undefined (default: '')
 */
export function formatCaptureTime(iso: string | null, fallback = ''): string {
  if (!iso) return fallback
  try {
    const d = new Date(iso)
    const month = d.toLocaleString('en-US', { month: 'short' })
    const day = d.getDate()
    const hours = String(d.getHours()).padStart(2, '0')
    const minutes = String(d.getMinutes()).padStart(2, '0')
    const seconds = String(d.getSeconds()).padStart(2, '0')
    return `${month} ${day} ${hours}:${minutes}:${seconds}`
  } catch {
    return iso
  }
}

/**
 * Format camera parameters (aperture, shutter speed, ISO, focal length) into a display string.
 * Returns empty string if no parameters are set.
 */
export function formatCameraParams(photo: LogicalPhotoSummary): string {
  const parts: string[] = []
  if (photo.aperture != null) parts.push(`f/${photo.aperture}`)
  if (photo.shutter_speed != null) parts.push(photo.shutter_speed)
  if (photo.iso != null) parts.push(`ISO${photo.iso}`)
  if (photo.focal_length != null) parts.push(`${photo.focal_length}mm`)
  return parts.join(' \u00b7 ')
}

/**
 * Look up the decision status for a photo ID in a decisions array.
 * Returns 'undecided' if not found.
 */
export function getDecisionStatus(decisions: PhotoDecisionStatus[], photoId: number): DecisionStatus {
  const d = decisions.find(d => d.logical_photo_id === photoId)
  return (d?.current_status as DecisionStatus) ?? 'undecided'
}

/**
 * Truncate a string to a maximum length. Returns '' for null/undefined.
 */
export function truncate(s: string | null, max: number): string {
  if (!s) return ''
  return s.length > max ? s.slice(0, max) : s
}
