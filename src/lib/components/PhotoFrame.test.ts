// src/lib/components/PhotoFrame.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/svelte'
import { makePhoto } from '$test/fixtures'
import { DECISION_SELECTORS } from '$lib/constants/decisions'
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

  // ─── 3b. Shows camera emoji when no imageUrl (layout=panel) ───────────────

  it('shows camera emoji placeholder when imageUrl is null and layout=panel', () => {
    render(PhotoFrame, {
      props: {
        photo: makePhoto(),
        imageUrl: null,
        layout: 'panel',
      },
    })

    expect(document.querySelector('img')).toBeNull()
    expect(screen.getByText('\u{1F4F7}')).toBeInTheDocument()
  })
})

// ─── 4 & 5. Decision indicator ───────────────────────────────────────────────

describe('PhotoFrame — decision indicator', () => {
  it('keep status applies decision-keep class', () => {
    render(PhotoFrame, {
      props: {
        photo: makePhoto(),
        status: 'keep',
        imageUrl: 'asset://localhost/test.jpg',
      },
    })

    const frame = screen.getByTestId('photo-frame')
    // decision-keep class is now on the frame itself (absorbed DecisionIndicator)
    expect(frame.classList.contains('decision-keep')).toBe(true)
  })

  it('eliminate status applies decision-eliminate class and adds dim overlay element', () => {
    render(PhotoFrame, {
      props: {
        photo: makePhoto(),
        status: 'eliminate',
        imageUrl: 'asset://localhost/test.jpg',
      },
    })

    const frame = screen.getByTestId('photo-frame')
    // decision-eliminate class is now on the frame itself (absorbed DecisionIndicator)
    expect(frame.classList.contains('decision-eliminate')).toBe(true)
    // dim overlay is still a descendant inside photo-area
    expect(frame.querySelector(DECISION_SELECTORS.dimOverlay)).not.toBeNull()
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

  it('does not apply rounded-lg class when layout=fill', () => {
    render(PhotoFrame, {
      props: {
        photo: makePhoto(),
        layout: 'fill',
        imageUrl: null,
      },
    })

    const frame = screen.getByTestId('photo-frame')
    expect(frame.className).not.toContain('rounded-lg')
  })

  it('does not apply rounded-lg class when layout=panel', () => {
    render(PhotoFrame, {
      props: {
        photo: makePhoto(),
        layout: 'panel',
        imageUrl: null,
      },
    })

    const frame = screen.getByTestId('photo-frame')
    expect(frame.className).not.toContain('rounded-lg')
  })
})

// ─── 12. Layout: object-fit based on layout ─────────────────────────────────

describe('PhotoFrame — layout prop controls object-fit', () => {
  it('uses object-cover class when layout=card', () => {
    render(PhotoFrame, {
      props: {
        photo: makePhoto(),
        layout: 'card',
        imageUrl: 'asset://localhost/test.jpg',
      },
    })

    const img = document.querySelector('img')!
    expect(img.className).toContain('object-cover')
    expect(img.className).not.toContain('object-contain')
  })

  it('uses object-contain class when layout=fill (default)', () => {
    render(PhotoFrame, {
      props: {
        photo: makePhoto(),
        imageUrl: 'asset://localhost/test.jpg',
      },
    })

    const img = document.querySelector('img')!
    expect(img.className).toContain('object-contain')
    expect(img.className).not.toContain('object-cover')
  })

  it('uses object-contain class when layout=panel', () => {
    render(PhotoFrame, {
      props: {
        photo: makePhoto(),
        layout: 'panel',
        imageUrl: 'asset://localhost/test.jpg',
      },
    })

    const img = document.querySelector('img')!
    expect(img.className).toContain('object-contain')
    expect(img.className).not.toContain('object-cover')
  })
})

// ─── 13. No structural border on undecided ──────────────────────────────────

describe('PhotoFrame — undecided border', () => {
  it('undecided photos have border and border-gray-700 classes', () => {
    render(PhotoFrame, {
      props: {
        photo: makePhoto(),
        status: 'undecided',
        imageUrl: null,
      },
    })

    const frame = screen.getByTestId('photo-frame')
    expect(frame.className).toContain('border')
    expect(frame.className).toContain('border-gray-700')
  })

  it('keep photos do not have border-gray-700 class', () => {
    render(PhotoFrame, {
      props: {
        photo: makePhoto(),
        status: 'keep',
        imageUrl: null,
      },
    })

    const frame = screen.getByTestId('photo-frame')
    expect(frame.className).not.toContain('border-gray-700')
  })

  it('eliminate photos do not have border-gray-700 class', () => {
    render(PhotoFrame, {
      props: {
        photo: makePhoto(),
        status: 'eliminate',
        imageUrl: null,
      },
    })

    const frame = screen.getByTestId('photo-frame')
    expect(frame.className).not.toContain('border-gray-700')
  })
})

// ─── 14. Layout sizing classes ──────────────────────────────────────────────

describe('PhotoFrame — layout sizing', () => {
  it('layout=fill applies flex-1 and min-h-0 classes', () => {
    render(PhotoFrame, {
      props: {
        photo: makePhoto(),
        layout: 'fill',
        imageUrl: null,
      },
    })

    const frame = screen.getByTestId('photo-frame')
    expect(frame.className).toContain('flex-1')
    expect(frame.className).toContain('min-h-0')
  })

  it('layout=panel applies flex-1 and min-h-0 classes', () => {
    render(PhotoFrame, {
      props: {
        photo: makePhoto(),
        layout: 'panel',
        imageUrl: null,
      },
    })

    const frame = screen.getByTestId('photo-frame')
    expect(frame.className).toContain('flex-1')
    expect(frame.className).toContain('min-h-0')
  })

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
  it('renders ring-2 ring-blue-500 when focused=true', () => {
    render(PhotoFrame, {
      props: {
        photo: makePhoto(),
        focused: true,
        imageUrl: null,
      },
    })

    const frame = screen.getByTestId('photo-frame')
    expect(frame.className).toContain('ring-2')
    expect(frame.className).toContain('ring-blue-500')
  })

  it('renders ring-2 ring-yellow-500 when selected=true', () => {
    render(PhotoFrame, {
      props: {
        photo: makePhoto(),
        selected: true,
        imageUrl: null,
      },
    })

    const frame = screen.getByTestId('photo-frame')
    expect(frame.className).toContain('ring-2')
    expect(frame.className).toContain('ring-yellow-500')
  })

  it('selected takes priority over focused', () => {
    render(PhotoFrame, {
      props: {
        photo: makePhoto(),
        focused: true,
        selected: true,
        imageUrl: null,
      },
    })

    const frame = screen.getByTestId('photo-frame')
    expect(frame.className).toContain('ring-yellow-500')
    expect(frame.className).not.toContain('ring-blue-500')
  })

  it('no ring when neither focused nor selected', () => {
    render(PhotoFrame, {
      props: {
        photo: makePhoto(),
        imageUrl: null,
      },
    })

    const frame = screen.getByTestId('photo-frame')
    expect(frame.className).not.toContain('ring-2')
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
