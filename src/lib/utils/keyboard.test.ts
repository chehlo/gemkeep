import { describe, it, expect } from 'vitest'
import { mapVimKey, gridNavigate } from './keyboard.js'

function fakeKey(key: string, mods: Partial<KeyboardEvent> = {}): KeyboardEvent {
  return { key, ctrlKey: false, shiftKey: false, altKey: false, ...mods } as KeyboardEvent
}

describe('mapVimKey', () => {
  it('maps h to ArrowLeft', () => {
    expect(mapVimKey(fakeKey('h'))).toBe('ArrowLeft')
  })

  it('maps j to ArrowDown', () => {
    expect(mapVimKey(fakeKey('j'))).toBe('ArrowDown')
  })

  it('maps k to ArrowUp', () => {
    expect(mapVimKey(fakeKey('k'))).toBe('ArrowUp')
  })

  it('maps l to ArrowRight', () => {
    expect(mapVimKey(fakeKey('l'))).toBe('ArrowRight')
  })

  it('does not map when Ctrl is held', () => {
    expect(mapVimKey(fakeKey('h', { ctrlKey: true }))).toBe('h')
  })

  it('does not map when Shift is held', () => {
    expect(mapVimKey(fakeKey('h', { shiftKey: true }))).toBe('h')
  })

  it('passes non-vim keys through unchanged', () => {
    expect(mapVimKey(fakeKey('Enter'))).toBe('Enter')
    expect(mapVimKey(fakeKey('Escape'))).toBe('Escape')
    expect(mapVimKey(fakeKey('ArrowRight'))).toBe('ArrowRight')
  })
})

describe('gridNavigate', () => {
  // 12 items, 4 columns (3 rows)
  const count = 12
  const cols = 4

  it('ArrowRight moves to next item', () => {
    expect(gridNavigate('ArrowRight', 0, count, cols)).toBe(1)
  })

  it('ArrowRight clamps at last item', () => {
    expect(gridNavigate('ArrowRight', 11, count, cols)).toBe(11)
  })

  it('ArrowLeft moves to previous item', () => {
    expect(gridNavigate('ArrowLeft', 5, count, cols)).toBe(4)
  })

  it('ArrowLeft clamps at first item', () => {
    expect(gridNavigate('ArrowLeft', 0, count, cols)).toBe(0)
  })

  it('ArrowDown moves by cols', () => {
    expect(gridNavigate('ArrowDown', 1, count, cols)).toBe(5)
  })

  it('ArrowDown clamps at last item', () => {
    expect(gridNavigate('ArrowDown', 9, count, cols)).toBe(11)
  })

  it('ArrowUp moves by cols', () => {
    expect(gridNavigate('ArrowUp', 5, count, cols)).toBe(1)
  })

  it('ArrowUp clamps at first item', () => {
    expect(gridNavigate('ArrowUp', 2, count, cols)).toBe(0)
  })

  it('Home returns 0', () => {
    expect(gridNavigate('Home', 7, count, cols)).toBe(0)
  })

  it('End returns last index', () => {
    expect(gridNavigate('End', 0, count, cols)).toBe(11)
  })

  it('returns null for non-navigation keys', () => {
    expect(gridNavigate('Enter', 0, count, cols)).toBeNull()
    expect(gridNavigate('Escape', 0, count, cols)).toBeNull()
  })
})
