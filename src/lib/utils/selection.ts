// Selection state utilities.
// Pure functions for managing multi-select state across views.

/** Selection state: a set of selected item IDs. */
export interface SelectionState {
  selected: Set<number>
}

/** Create a fresh empty selection. */
export function createSelection(): SelectionState {
  return { selected: new Set() }
}

/**
 * Toggle an item in/out of the selection.
 * If maxSelection is a number, refuse to add beyond that limit.
 * If maxSelection is null or undefined, no limit.
 */
export function toggleSelect(
  state: SelectionState,
  itemId: number,
  maxSelection?: number | null,
): SelectionState {
  const next = new Set(state.selected)
  if (next.has(itemId)) {
    next.delete(itemId)
  } else {
    if (maxSelection != null && next.size >= maxSelection) {
      return { selected: next }
    }
    next.add(itemId)
  }
  return { selected: next }
}

/**
 * Extend selection to include both fromId and toId.
 * If maxSelection is a number, stop adding once the limit is reached.
 * If maxSelection is null or undefined, no limit.
 */
export function extendSelection(
  state: SelectionState,
  fromId: number,
  toId: number,
  maxSelection?: number | null,
): SelectionState {
  const next = new Set(state.selected)
  for (const id of [fromId, toId]) {
    if (maxSelection != null && next.size >= maxSelection) break
    next.add(id)
  }
  return { selected: next }
}

/** Return a fresh empty selection (clears everything). */
export function clearSelection(): SelectionState {
  return { selected: new Set() }
}

/** Return selected IDs as a sorted array. */
export function getSelectedIds(state: SelectionState): number[] {
  return [...state.selected].sort((a, b) => a - b)
}
