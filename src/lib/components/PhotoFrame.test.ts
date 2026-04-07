// src/lib/components/PhotoFrame.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/svelte'
import { makePhoto } from '$test/fixtures'
import { assertFocused, assertSelected, assertNotFocused, assertNoSelectionIndicator } from '$test/selection-helpers'
import { assertDecisionKept, assertDecisionEliminated, assertDecisionDimmed, assertDecisionUndecided } from '$test/decision-helpers'
import PhotoFrame from './PhotoFrame.svelte'

beforeEach(() => {
  vi.clearAllMocks()
})

// ─── 1. Renders image when imageUrl provided ─────────────────────────────────

describe('PhotoFrame — image rendering', () => {
  it('renders img element with correct src when imageUrl provided', () => {
    render(PhotoFrame, {
      props: {
        photo: makePhoto(),
        imageUrl: 'asset://localhost/cache/thumb/1.jpg',
      },
    })

    const img = document.querySelector('img')
    expect(img).not.toBeNull()
    expect(img!.getAttribute('src')).toBe('asset://localhost/cache/thumb/1.jpg')
  })

  // ─── 2. Shows placeholder text when no imageUrl (layout=fill) ──────────────

  it('shows "No preview available" when imageUrl is null and layout=fill', () => {
    render(PhotoFrame, {
      props: {
        photo: makePhoto(),
        imageUrl: null,
        layout: 'fill',
      },
    })

    expect(document.querySelector('img')).toBeNull()
    expect(screen.getByText('No preview available')).toBeInTheDocument()
  })

  // ─── 3. Shows camera emoji when no imageUrl (layout=card) ─────────────────

  it('shows camera emoji placeholder when imageUrl is null and layout=card', () => {
    render(PhotoFrame, {
      props: {
        photo: makePhoto(),
        imageUrl: null,
        layout: 'card',
      },
    })

    expect(document.querySelector('img')).toBeNull()
    expect(screen.getByText('\u{1F4F7}')).toBeInTheDocument()
  })

})

// ─── 4 & 5. Decision indicator ───────────────────────────────────────────────

describe('PhotoFrame — decision indicator', () => {
  it('keep status applies kept decision indicator', () => {
    render(PhotoFrame, {
      props: {
        photo: makePhoto(),
        status: 'keep',
        imageUrl: 'asset://localhost/test.jpg',
      },
    })

    const frame = screen.getByTestId('photo-frame')
    assertDecisionKept(frame)
  })

  it('applies eliminated marker class and renders dim-overlay element', () => {
    render(PhotoFrame, {
      props: {
        photo: makePhoto(),
        status: 'eliminate',
        imageUrl: 'asset://localhost/test.jpg',
      },
    })

    const frame = screen.getByTestId('photo-frame')
    assertDecisionEliminated(frame)
    assertDecisionDimmed(frame)
  })
})

// ─── 6 & 7. Metadata visibility ─────────────────────────────────────────────

describe('PhotoFrame — metadata', () => {
  it('shows metadata when showMetadata=true', () => {
    render(PhotoFrame, {
      props: {
        photo: makePhoto({ capture_time: '2024-01-15T10:30:00Z', camera_model: 'Canon EOS 5D' }),
        showMetadata: true,
        imageUrl: null,
      },
    })

    const metadata = screen.getByTestId('metadata-section')
    expect(metadata).toBeInTheDocument()
    // Capture time formatted
    expect(metadata.textContent).toContain('Jan')
    expect(metadata.textContent).toContain('Canon EOS 5D')
    // Format badges (RAW + JPEG from makePhoto defaults)
    expect(metadata.textContent).toContain('RAW')
    expect(metadata.textContent).toContain('JPEG')
  })

  it('hides metadata when showMetadata=false', () => {
    render(PhotoFrame, {
      props: {
        photo: makePhoto(),
        showMetadata: false,
        imageUrl: null,
      },
    })

    expect(screen.queryByTestId('metadata-section')).not.toBeInTheDocument()
  })
})

// ─── 8 & 9. File path overlay ────────────────────────────────────────────────

describe('PhotoFrame — file path overlay', () => {
  it('shows file path overlay when showFilePath is set', () => {
    render(PhotoFrame, {
      props: {
        photo: makePhoto(),
        showFilePath: '/home/user/Photos/IMG_001.jpg',
        imageUrl: null,
      },
    })

    const overlay = screen.getByTestId('file-path-overlay')
    expect(overlay).toBeInTheDocument()
    expect(overlay.textContent).toContain('/home/user/Photos/IMG_001.jpg')
  })

  it('hides file path overlay when showFilePath is null', () => {
    render(PhotoFrame, {
      props: {
        photo: makePhoto(),
        showFilePath: null,
        imageUrl: null,
      },
    })

    expect(screen.queryByTestId('file-path-overlay')).not.toBeInTheDocument()
  })
})

// ─── 10. Layout: card — compact camera params ───────────────────────────────

describe('PhotoFrame — layout=card (compact mode)', () => {
  it('uses dot-separated camera params via formatCameraParams', () => {
    render(PhotoFrame, {
      props: {
        photo: makePhoto({ aperture: 2.8, shutter_speed: '1/250', iso: 400, focal_length: 85 }),
        layout: 'card',
        imageUrl: null,
      },
    })

    const params = screen.getByTestId('camera-params')
    expect(params.textContent).toBe('f/2.8 \u00b7 1/250 \u00b7 ISO400 \u00b7 85mm')
  })
})

// ─── 11. Layout: card applies rounded-lg ────────────────────────────────────

describe('PhotoFrame — layout prop controls rounded', () => {
  it('applies rounded-lg class when layout=card', () => {
    render(PhotoFrame, {
      props: {
        photo: makePhoto(),
        layout: 'card',
        imageUrl: null,
      },
    })

    const frame = screen.getByTestId('photo-frame')
    expect(frame.className).toContain('rounded-lg')
  })

})

// ─── 12. Layout: object-fit based on layout ─────────────────────────────────

describe('PhotoFrame — layout prop controls object-fit', () => {
  it.each([
    { layout: 'card' as const,  expected: 'object-cover',   notExpected: 'object-contain' },
    { layout: 'fill' as const,  expected: 'object-contain', notExpected: 'object-cover' },
    { layout: 'panel' as const, expected: 'object-contain', notExpected: 'object-cover' },
  ])('uses $expected class when layout=$layout', ({ layout, expected, notExpected }) => {
    render(PhotoFrame, {
      props: {
        photo: makePhoto(),
        layout,
        imageUrl: 'asset://localhost/test.jpg',
      },
    })

    const img = document.querySelector('img')!
    expect(img.className).toContain(expected)
    expect(img.className).not.toContain(notExpected)
  })
})

// ─── 13. No structural border on undecided ──────────────────────────────────

describe('PhotoFrame — undecided state', () => {
  it('undecided photos show no decision indicator', () => {
    render(PhotoFrame, {
      props: {
        photo: makePhoto(),
        status: 'undecided',
        imageUrl: null,
      },
    })

    const frame = screen.getByTestId('photo-frame')
    assertDecisionUndecided(frame)
  })

})

// ─── 14. Layout sizing classes ──────────────────────────────────────────────

describe('PhotoFrame — layout sizing', () => {
  it.each(['fill' as const, 'panel' as const])(
    'layout=%s applies flex-1 and min-h-0 classes',
    (layout) => {
      render(PhotoFrame, {
        props: {
          photo: makePhoto(),
          layout,
          imageUrl: null,
        },
      })

      const frame = screen.getByTestId('photo-frame')
      expect(frame.className).toContain('flex-1')
      expect(frame.className).toContain('min-h-0')
    },
  )

  it('layout=card does not add flex-1', () => {
    render(PhotoFrame, {
      props: {
        photo: makePhoto(),
        layout: 'card',
        imageUrl: null,
      },
    })

    const frame = screen.getByTestId('photo-frame')
    expect(frame.className).not.toContain('flex-1')
  })
})

// ─── 15. Focused and selected rings ─────────────────────────────────────────

describe('PhotoFrame — focused/selected rings', () => {
  it('applies focused marker class when focused=true', () => {
    render(PhotoFrame, {
      props: {
        photo: makePhoto(),
        focused: true,
        imageUrl: null,
      },
    })

    const frame = screen.getByTestId('photo-frame')
    assertFocused(frame)
  })

  it('applies selected marker class when selected=true', () => {
    render(PhotoFrame, {
      props: {
        photo: makePhoto(),
        selected: true,
        imageUrl: null,
      },
    })

    const frame = screen.getByTestId('photo-frame')
    assertSelected(frame)
  })

  it('selected marker wins when both flags true', () => {
    render(PhotoFrame, {
      props: {
        photo: makePhoto(),
        focused: true,
        selected: true,
        imageUrl: null,
      },
    })

    const frame = screen.getByTestId('photo-frame')
    assertSelected(frame)
    assertNotFocused(frame)
  })

  it('no selection/focus marker classes when neither flag set', () => {
    render(PhotoFrame, {
      props: {
        photo: makePhoto(),
        imageUrl: null,
      },
    })

    const frame = screen.getByTestId('photo-frame')
    assertNoSelectionIndicator(frame)
  })
})

// ─── 16. Panel layout uses compact metadata ─────────────────────────────────

describe('PhotoFrame — layout=panel (compact mode)', () => {
  it('uses dot-separated camera params via formatCameraParams', () => {
    render(PhotoFrame, {
      props: {
        photo: makePhoto({ aperture: 2.8, shutter_speed: '1/250', iso: 400, focal_length: 85 }),
        layout: 'panel',
        imageUrl: null,
      },
    })

    const params = screen.getByTestId('camera-params')
    expect(params.textContent).toBe('f/2.8 \u00b7 1/250 \u00b7 ISO400 \u00b7 85mm')
  })
})
