// src/lib/components/PhotoFrame.layout-variants.test.ts
// Regression tests for F3 layout variant behaviors not explicitly covered
// in PhotoFrame.test.ts. Focus: full metadata in fill layout, and cross-cutting
// combinations of layout + image + metadata + decision.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/svelte'
import { makePhoto, makePhotoDetail } from '$test/fixtures'
import { assertDecisionEliminated, assertDecisionDimmed } from '$test/decision-helpers'
import PhotoFrame from './PhotoFrame.svelte'

beforeEach(() => {
  vi.clearAllMocks()
})

// ─── Behavior 12: layout='fill' uses full (non-compact) metadata ────────────

describe('PhotoFrame — layout=fill full metadata format', () => {
  it('renders individual camera params as separate elements (not dot-separated)', () => {
    render(PhotoFrame, {
      props: {
        photo: makePhotoDetail({
          aperture: 2.8,
          shutter_speed: '1/250',
          iso: 400,
          focal_length: 85,
          lens: 'EF 85mm f/1.4',
          exposure_comp: 0.7,
        }),
        layout: 'fill',
        imageUrl: 'asset://localhost/test.jpg',
      },
    })

    const metadata = screen.getByTestId('metadata-section')
    // Full mode renders params as separate divs, not via formatCameraParams
    expect(metadata.textContent).toContain('f/2.8')
    expect(metadata.textContent).toContain('1/250')
    expect(metadata.textContent).toContain('ISO 400')
    expect(metadata.textContent).toContain('85mm')
    expect(metadata.textContent).toContain('EF 85mm f/1.4')
    expect(metadata.textContent).toContain('+0.7 EV')
    // Should NOT use the compact dot-separated format
    expect(screen.queryByTestId('camera-params')).not.toBeInTheDocument()
  })

  it('renders lens and exposure_comp only in full mode (not in compact)', () => {
    const photo = makePhotoDetail({
      aperture: 5.6,
      shutter_speed: '1/125',
      iso: 200,
      focal_length: 50,
      lens: 'RF 50mm f/1.2',
      exposure_comp: -1.0,
    })

    // Full mode (fill) should show lens and exposure_comp
    const { unmount } = render(PhotoFrame, {
      props: { photo, layout: 'fill', imageUrl: null },
    })
    const fullMeta = screen.getByTestId('metadata-section')
    expect(fullMeta.textContent).toContain('RF 50mm f/1.2')
    expect(fullMeta.textContent).toContain('-1.0 EV')
    unmount()

    // Compact mode (card) should NOT show exposure_comp (formatCameraParams doesn't include it)
    render(PhotoFrame, {
      props: { photo, layout: 'card', imageUrl: null },
    })
    const compactMeta = screen.getByTestId('metadata-section')
    expect(compactMeta.textContent).not.toContain('EV')
  })
})

// ─── Cross-cutting combination: panel + no image + eliminate ────────────────

describe('PhotoFrame — layout combinations', () => {
  it('panel with no image, eliminate decision, shows emoji placeholder + dim overlay', () => {
    render(PhotoFrame, {
      props: {
        photo: makePhoto(),
        layout: 'panel',
        imageUrl: null,
        status: 'eliminate',
      },
    })

    const frame = screen.getByTestId('photo-frame')
    // Panel sizing
    expect(frame.className).toContain('flex-1')
    expect(frame.className).toContain('min-h-0')
    // No rounded
    expect(frame.className).not.toContain('rounded-lg')
    // Eliminate decision
    assertDecisionEliminated(frame)
    // Dim overlay present
    assertDecisionDimmed(frame)
    // Camera emoji placeholder (not "No preview available")
    expect(screen.getByText('\u{1F4F7}')).toBeInTheDocument()
    expect(screen.queryByText('No preview available')).not.toBeInTheDocument()
  })
})
