import { describe, it, expect, vi } from 'vitest'
import { createTimedError } from './errors.js'

describe('createTimedError', () => {
  it('show() calls setter with the message', () => {
    const setter = vi.fn()
    const { show } = createTimedError(1000, setter)

    show('Something failed')

    expect(setter).toHaveBeenCalledWith('Something failed')
  })

  it('auto-clears error after timeout', () => {
    vi.useFakeTimers()
    const setter = vi.fn()
    const { show } = createTimedError(3000, setter)

    show('Error!')
    expect(setter).toHaveBeenCalledWith('Error!')

    vi.advanceTimersByTime(3000)
    expect(setter).toHaveBeenCalledWith(null)

    vi.useRealTimers()
  })

  it('second show() resets the timer', () => {
    vi.useFakeTimers()
    const setter = vi.fn()
    const { show } = createTimedError(3000, setter)

    show('First')
    vi.advanceTimersByTime(2000)
    show('Second')
    vi.advanceTimersByTime(2000)

    // First timer would have fired at 3000ms but was reset — error should still be set
    expect(setter).not.toHaveBeenCalledWith(null)

    vi.advanceTimersByTime(1000) // 3000ms after 'Second'
    expect(setter).toHaveBeenCalledWith(null)

    vi.useRealTimers()
  })

  it('cleanup() prevents auto-clear from firing', () => {
    vi.useFakeTimers()
    const setter = vi.fn()
    const { show, cleanup } = createTimedError(3000, setter)

    show('Error!')
    cleanup()
    vi.advanceTimersByTime(5000)

    // setter was called with 'Error!' but never with null (timer was cleaned)
    expect(setter).toHaveBeenCalledTimes(1)
    expect(setter).toHaveBeenCalledWith('Error!')

    vi.useRealTimers()
  })
})
