import type { PhotoDecisionStatus } from '$lib/api/index.js'

/**
 * Update a decision in a decisions array (mutates the array in-place for Svelte reactivity).
 * If the photo already has a decision, updates it; otherwise appends a new entry.
 */
export function updateDecisionState(
  decisions: PhotoDecisionStatus[],
  photoId: number,
  status: string,
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
 * Returns month, day, and UTC time (e.g. "Mar 15 10:30:00").
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
    const hours = String(d.getUTCHours()).padStart(2, '0')
    const minutes = String(d.getUTCMinutes()).padStart(2, '0')
    const seconds = String(d.getUTCSeconds()).padStart(2, '0')
    return `${month} ${day} ${hours}:${minutes}:${seconds}`
  } catch {
    return iso
  }
}

/**
 * Truncate a string to a maximum length. Returns '' for null/undefined.
 */
export function truncate(s: string | null, max: number): string {
  if (!s) return ''
  return s.length > max ? s.slice(0, max) : s
}
