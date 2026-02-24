/**
 * Format an ISO date string for user display.
 *
 * - null/undefined → fallback string (default: empty string)
 * - Valid ISO date → short month + day (e.g. "Mar 15")
 * - Invalid date → returns the raw input unchanged
 */
export function formatDate(iso: string | null, fallback = ''): string {
  if (!iso) return fallback
  try {
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  } catch {
    return iso
  }
}
