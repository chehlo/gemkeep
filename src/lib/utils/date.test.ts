import { describe, it, expect } from 'vitest'
import { formatDate } from './date.js'

describe('formatDate', () => {
  it('formats valid ISO date as short month + day', () => {
    expect(formatDate('2024-03-15T10:30:00Z')).toBe('Mar 15')
  })

  it('returns fallback for null input', () => {
    expect(formatDate(null, '(no EXIF)')).toBe('(no EXIF)')
  })

  it('returns empty string fallback by default', () => {
    expect(formatDate(null)).toBe('')
  })

  it('returns raw input for invalid date string', () => {
    expect(formatDate('not-a-date')).toBe('Invalid Date')
  })
})
