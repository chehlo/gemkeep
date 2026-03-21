// src/lib/components/PhotoFrame.ring-indicators.test.ts
// F2: Ring indicators — combination behaviors with decision borders, layouts, and null photo.
// These tests verify that ring indicators (focus/selection) coexist correctly
// with decision borders, layout variants, and edge cases.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/svelte'
import { makePhoto } from '$test/fixtures'
import PhotoFrame from './PhotoFrame.svelte'

beforeEach(() => {
  vi.clearAllMocks()
})

// ─── F2-1: focused=true, selected=false → ring-blue-500, no ring-yellow-500 ──

describe('PhotoFrame ring — basic focused', () => {
  it('focused=true applies ring-blue-500 class without ring-yellow-500', () => {
    render(PhotoFrame, {
      props: {
        photo: makePhoto(),
        focused: true,
        selected: false,
        imageUrl: null,
      },
    })

    const frame = screen.getByTestId('photo-frame')
    expect(frame.className).toContain('ring-2')
    expect(frame.className).toContain('ring-blue-500')
    expect(frame.className).not.toContain('ring-yellow-500')
  })
})

// ─── F2-2: selected=true, focused=false → ring-yellow-500, no ring-blue-500 ──

describe('PhotoFrame ring — basic selected', () => {
  it('selected=true applies ring-yellow-500 class without ring-blue-500', () => {
    render(PhotoFrame, {
      props: {
        photo: makePhoto(),
        focused: false,
        selected: true,
        imageUrl: null,
      },
    })

    const frame = screen.getByTestId('photo-frame')
    expect(frame.className).toContain('ring-2')
    expect(frame.className).toContain('ring-yellow-500')
    expect(frame.className).not.toContain('ring-blue-500')
  })
})

// ─── F2-3: Both focused+selected → selected wins (ring-yellow-500 only) ──────

describe('PhotoFrame ring — selected overrides focused', () => {
  it('both focused+selected applies ring-yellow-500 class only', () => {
    render(PhotoFrame, {
      props: {
        photo: makePhoto(),
        focused: true,
        selected: true,
        imageUrl: null,
      },
    })

    const frame = screen.getByTestId('photo-frame')
    expect(frame.className).toContain('ring-2')
    expect(frame.className).toContain('ring-yellow-500')
    expect(frame.className).not.toContain('ring-blue-500')
  })
})

// ─── F2-4: Neither focused nor selected → no ring classes ─────────────────────

describe('PhotoFrame ring — no ring when inactive', () => {
  it('no ring-2 when neither focused nor selected', () => {
    render(PhotoFrame, {
      props: {
        photo: makePhoto(),
        focused: false,
        selected: false,
        imageUrl: null,
      },
    })

    const frame = screen.getByTestId('photo-frame')
    expect(frame.className).not.toContain('ring-2')
    expect(frame.className).not.toContain('ring-blue-500')
    expect(frame.className).not.toContain('ring-yellow-500')
  })
})

// ─── F2-5: focused + keep → ring-blue-500 AND border-green-500 ───────────────

describe('PhotoFrame ring — coexists with decision borders', () => {
  it('focused + keep applies both ring-blue-500 and border-green-500 classes', () => {
    render(PhotoFrame, {
      props: {
        photo: makePhoto(),
        focused: true,
        status: 'keep',
        imageUrl: null,
      },
    })

    const frame = screen.getByTestId('photo-frame')
    // Ring indicator
    expect(frame.className).toContain('ring-2')
    expect(frame.className).toContain('ring-blue-500')
    // Decision border
    expect(frame.className).toContain('border-2')
    expect(frame.className).toContain('border-green-500')
    expect(frame.classList.contains('decision-keep')).toBe(true)
  })

  // ─── F2-6: selected + eliminate → ring-yellow-500 AND border-red-500 + dim ──

  it('selected + eliminate applies ring-yellow-500 and border-red-500 classes with dim overlay element', () => {
    render(PhotoFrame, {
      props: {
        photo: makePhoto(),
        selected: true,
        status: 'eliminate',
        imageUrl: null,
      },
    })

    const frame = screen.getByTestId('photo-frame')
    // Ring indicator
    expect(frame.className).toContain('ring-2')
    expect(frame.className).toContain('ring-yellow-500')
    // Decision border
    expect(frame.className).toContain('border-2')
    expect(frame.className).toContain('border-red-500')
    expect(frame.classList.contains('decision-eliminate')).toBe(true)
    // Dim overlay inside photo-area
    const photoArea = screen.getByTestId('photo-area')
    const dimOverlay = photoArea.querySelector('.decision-dim-overlay')
    expect(dimOverlay).not.toBeNull()
  })

  // ─── F2-7: focused + undecided → ring-blue-500 AND border-gray-700 ──────────

  it('focused + undecided applies ring-blue-500 and border-blue-500 classes', () => {
    render(PhotoFrame, {
      props: {
        photo: makePhoto(),
        focused: true,
        status: 'undecided',
        imageUrl: null,
      },
    })

    const frame = screen.getByTestId('photo-frame')
    // Ring indicator
    expect(frame.className).toContain('ring-2')
    expect(frame.className).toContain('ring-blue-500')
    // Focused border (blue, not gray — focused overrides undecided)
    expect(frame.className).toContain('border-2')
    expect(frame.className).toContain('border-blue-500')
    // No decision marker classes
    expect(frame.classList.contains('decision-keep')).toBe(false)
    expect(frame.classList.contains('decision-eliminate')).toBe(false)
  })
})

// ─── F2-8: focused + card layout → ring + rounded-lg ─────────────────────────

describe('PhotoFrame ring — layout interactions', () => {
  it('focused + card layout applies ring-blue-500 and rounded-lg classes', () => {
    render(PhotoFrame, {
      props: {
        photo: makePhoto(),
        focused: true,
        layout: 'card',
        imageUrl: null,
      },
    })

    const frame = screen.getByTestId('photo-frame')
    expect(frame.className).toContain('ring-2')
    expect(frame.className).toContain('ring-blue-500')
    expect(frame.className).toContain('rounded-lg')
  })

  // ─── F2-9: focused + fill layout → ring without rounded-lg ──────────────────

  it('focused + fill layout applies ring-blue-500 class without rounded-lg', () => {
    render(PhotoFrame, {
      props: {
        photo: makePhoto(),
        focused: true,
        layout: 'fill',
        imageUrl: null,
      },
    })

    const frame = screen.getByTestId('photo-frame')
    expect(frame.className).toContain('ring-2')
    expect(frame.className).toContain('ring-blue-500')
    expect(frame.className).not.toContain('rounded-lg')
  })
})

// ─── F2-10: focused + null photo → ring still renders ─────────────────────────

describe('PhotoFrame ring — null photo edge case', () => {
  it('focused + null photo still applies ring-blue-500 class', () => {
    render(PhotoFrame, {
      props: {
        photo: null,
        focused: true,
        imageUrl: null,
        showMetadata: false,
      },
    })

    const frame = screen.getByTestId('photo-frame')
    expect(frame.className).toContain('ring-2')
    expect(frame.className).toContain('ring-blue-500')
  })

  it('selected + null photo + eliminate applies ring-yellow-500 and border-red-500 classes', () => {
    render(PhotoFrame, {
      props: {
        photo: null,
        selected: true,
        status: 'eliminate',
        imageUrl: null,
        showMetadata: false,
      },
    })

    const frame = screen.getByTestId('photo-frame')
    // Ring
    expect(frame.className).toContain('ring-2')
    expect(frame.className).toContain('ring-yellow-500')
    // Decision border
    expect(frame.className).toContain('border-red-500')
    expect(frame.classList.contains('decision-eliminate')).toBe(true)
  })
})
