/**
 * Shared keyboard utilities for grid-based navigation.
 * Used by StackOverview, StackFocus, and any future grid screen.
 */

/** Map vim keys (hjkl) to Arrow equivalents. Returns the key unchanged if not a vim key or if modifiers are held. */
export function mapVimKey(e: KeyboardEvent): string {
  if (e.ctrlKey || e.shiftKey || e.altKey) return e.key
  switch (e.key) {
    case 'h': return 'ArrowLeft'
    case 'j': return 'ArrowDown'
    case 'k': return 'ArrowUp'
    case 'l': return 'ArrowRight'
    default: return e.key
  }
}

/**
 * Calculate new index for grid arrow/Home/End navigation.
 * Returns the new index, or null if the key is not a navigation key.
 */
export function gridNavigate(
  key: string,
  index: number,
  count: number,
  cols: number,
): number | null {
  switch (key) {
    case 'ArrowRight': return Math.min(index + 1, count - 1)
    case 'ArrowLeft': return Math.max(index - 1, 0)
    case 'ArrowDown': return Math.min(index + cols, count - 1)
    case 'ArrowUp': return Math.max(index - cols, 0)
    case 'Home': return 0
    case 'End': return count - 1
    default: return null
  }
}
