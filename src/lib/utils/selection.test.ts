import { describe, it, expect } from 'vitest'
import {
  createSelection,
  toggleSelect,
  extendSelection,
  clearSelection,
  getSelectedIds,
} from './selection'

describe('extendSelection', () => {
  it('Shift+Arrow extends selection to include both endpoints', () => {
    const state = { selected: new Set([1]) }
    const result = extendSelection(state, 1, 2)
    expect(result.selected.has(1)).toBe(true)
    expect(result.selected.has(2)).toBe(true)
    expect(result.selected.size).toBe(2)
  })
})

describe('clearSelection', () => {
  it('plain Arrow clears — returns empty selection', () => {
    const result = clearSelection()
    expect(result.selected.size).toBe(0)
  })
})

describe('toggleSelect', () => {
  it('S key adds item to empty selection', () => {
    const state = { selected: new Set<number>() }
    const result = toggleSelect(state, 5)
    expect(result.selected.has(5)).toBe(true)
    expect(result.selected.size).toBe(1)
  })

  it('S key removes item already in selection (toggle off)', () => {
    const state = { selected: new Set([5]) }
    const result = toggleSelect(state, 5)
    expect(result.selected.has(5)).toBe(false)
    expect(result.selected.size).toBe(0)
  })

  it('maxSelection=2 prevents adding beyond limit', () => {
    const state = { selected: new Set([1, 2]) }
    const result = toggleSelect(state, 3, 2)
    expect(result.selected.has(3)).toBe(false)
    expect(result.selected.size).toBe(2)
  })

  it('maxSelection=null allows unlimited additions', () => {
    let state = { selected: new Set<number>() }
    for (let i = 1; i <= 20; i++) {
      state = toggleSelect(state, i, null)
    }
    expect(state.selected.size).toBe(20)
    for (let i = 1; i <= 20; i++) {
      expect(state.selected.has(i)).toBe(true)
    }
  })
})

describe('clearSelection after use', () => {
  it('clearSelection returns empty set', () => {
    // Describe says "after use" — must populate a selection first, then clear
    let state = createSelection()
    state = toggleSelect(state, 5, null)
    state = toggleSelect(state, 10, null)
    expect(state.selected.size).toBe(2)

    const result = clearSelection()
    expect(result.selected.size).toBe(0)
    expect(result.selected).toBeInstanceOf(Set)
  })
})

describe('getSelectedIds', () => {
  it('returns selected IDs in sorted order', () => {
    const state = { selected: new Set([3, 1, 5]) }
    const ids = getSelectedIds(state)
    expect(ids).toEqual([1, 3, 5])
  })
})
