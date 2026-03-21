// src/lib/components/PhotoFrame.ring-inset.test.ts
// RED tests: ring-inset must be present on focus/selection rings
// to prevent clipping by overflow-hidden parent containers.
// Currently PhotoFrame uses ring-2 ring-blue-500 / ring-yellow-500 WITHOUT ring-inset.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/svelte'
import { makePhoto } from '$test/fixtures'
import PhotoFrame from './PhotoFrame.svelte'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('PhotoFrame ring-inset — prevents overflow clipping', () => {
  it('focused=true → container has ring-inset class', () => {
    render(PhotoFrame, {
      props: {
        photo: makePhoto(),
        focused: true,
        selected: false,
        imageUrl: null,
      },
    })

    const frame = screen.getByTestId('photo-frame')
    expect(frame.className).toContain('ring-inset')
  })

  it('selected=true → container has ring-inset class', () => {
    render(PhotoFrame, {
      props: {
        photo: makePhoto(),
        focused: false,
        selected: true,
        imageUrl: null,
      },
    })

    const frame = screen.getByTestId('photo-frame')
    expect(frame.className).toContain('ring-inset')
  })

  it('focused=true + selected=true → container has ring-inset class', () => {
    render(PhotoFrame, {
      props: {
        photo: makePhoto(),
        focused: true,
        selected: true,
        imageUrl: null,
      },
    })

    const frame = screen.getByTestId('photo-frame')
    expect(frame.className).toContain('ring-inset')
  })

  it('neither focused nor selected → no ring-inset class', () => {
    render(PhotoFrame, {
      props: {
        photo: makePhoto(),
        focused: false,
        selected: false,
        imageUrl: null,
      },
    })

    const frame = screen.getByTestId('photo-frame')
    expect(frame.className).not.toContain('ring-inset')
  })
})
