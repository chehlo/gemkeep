// src/lib/components/screens/SingleView.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/svelte'
import { invoke, convertFileSrc } from '@tauri-apps/api/core'
import { navigate, navigation } from '$lib/stores/navigation.svelte.js'
import type { PhotoDetail, RoundStatus, LogicalPhotoSummary, PhotoDecisionStatus } from '$lib/api/index.js'
import { OPEN_ROUND, ROUND_2_PHOTOS, makeRoundStatus, makeDecisionResult, makeDecisionStatus, makePhotoDetail, PHOTO_DETAIL, SINGLE_VIEW_PHOTO_LIST } from '$test/fixtures'
import { mockSingleViewRouter } from '$test/helpers'
import { DECISION_SELECTORS, assertDecisionEliminated, assertDecisionDimmed, assertStatusTextStyle } from '$test/decision-helpers'
import SingleView from './SingleView.svelte'

const mockInvoke = vi.mocked(invoke)

const PHOTO_DETAIL_NO_PARAMS: PhotoDetail = {
  ...PHOTO_DETAIL,
  logical_photo_id: 2,
  aperture: null,
  shutter_speed: null,
  iso: null,
  focal_length: null,
  exposure_comp: null,
  camera_model: null,
  lens: null,
}

const PHOTO_LIST = SINGLE_VIEW_PHOTO_LIST

const COMMITTED_ROUND: RoundStatus = makeRoundStatus({
  state: 'committed',
  decided: 3,
  kept: 2,
  eliminated: 1,
  undecided: 0,
  committed_at: '2024-01-15T12:00:00Z',
})

const DECISIONS_MIXED: PhotoDecisionStatus[] = [
  makeDecisionStatus({ logical_photo_id: 1, current_status: 'keep' }),
  makeDecisionStatus({ logical_photo_id: 2 }),
  makeDecisionStatus({ logical_photo_id: 3, current_status: 'eliminate' }),
  makeDecisionStatus({ logical_photo_id: 4 }),
  makeDecisionStatus({ logical_photo_id: 5, current_status: 'keep' }),
]

function setupNav(photoId = 1) {
  navigate({ kind: 'single-view', projectSlug: 'test-project', projectName: 'Test', stackId: 1, photoId })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockInvoke.mockImplementation(mockSingleViewRouter())
  setupNav()
})

describe('SingleView — loading and rendering', () => {
  it('renders loading state before data arrives', async () => {
    mockInvoke.mockImplementation(() => new Promise(() => {}))  // never resolves
    render(SingleView)
    expect(screen.getByTestId('loading-indicator')).toBeInTheDocument()
  })

  it('renders photo image with asset:// URL from jpeg_path (preferred for full-res viewing)', async () => {
    vi.mocked(convertFileSrc).mockImplementation((p: string) => `asset://localhost${p}`)
    render(SingleView)
    await waitFor(() => {
      const img = screen.getByRole('img')
      // jpeg_path is preferred in SingleView for full-resolution viewing
      // (asset scope expanded at runtime for source folders)
      expect(img).toHaveAttribute('src', `asset://localhost/home/user/Photos/IMG_001.jpg`)
    })
  })

  it('renders camera params: f/2.8, 1/250, ISO 400, 85mm', async () => {
    render(SingleView)
    await waitFor(() => {
      expect(screen.getByText(/f\/2\.8/)).toBeInTheDocument()
      expect(screen.getByText(/1\/250/)).toBeInTheDocument()
      expect(screen.getByText(/ISO 400/)).toBeInTheDocument()
      expect(screen.getByText(/85mm/)).toBeInTheDocument()
    })
  })

  it('hides camera param fields entirely when values are null (FIX-4.1.2)', async () => {
    mockInvoke.mockImplementation(mockSingleViewRouter({
      get_photo_detail: PHOTO_DETAIL_NO_PARAMS,
    }))
    render(SingleView)
    // Wait for component to finish loading (photo renders)
    await waitFor(() => {
      expect(screen.getByRole('img')).toBeInTheDocument()
    })
    // Now verify that null-valued camera params do NOT render "--" placeholders
    expect(screen.queryByText('--')).not.toBeInTheDocument()
    // Null params: aperture, shutter_speed, iso, focal_length, exposure_comp
    expect(screen.queryByText(/f\//)).not.toBeInTheDocument()
    expect(screen.queryByText(/ISO/)).not.toBeInTheDocument()
    expect(screen.queryByText(/EV/)).not.toBeInTheDocument()
  })
})

describe('SingleView — keyboard decisions', () => {
  it('Y key marks photo as keep', async () => {
    mockInvoke.mockImplementation(mockSingleViewRouter({
      make_decision: makeDecisionResult(),
    }))
    render(SingleView)
    await waitFor(() => screen.getByRole('img'))

    await fireEvent.keyDown(document, { key: 'y' })

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('make_decision', {
        slug: 'test-project', logicalPhotoId: 1, action: 'keep',
      })
    })
  })

  it('X key marks photo as eliminate', async () => {
    mockInvoke.mockImplementation(mockSingleViewRouter({
      make_decision: makeDecisionResult({ action: 'eliminate', current_status: 'eliminate' }),
    }))
    render(SingleView)
    await waitFor(() => screen.getByRole('img'))

    await fireEvent.keyDown(document, { key: 'x' })

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('make_decision', {
        slug: 'test-project', logicalPhotoId: 1, action: 'eliminate',
      })
    })
  })

  it('Left/Right arrows navigate between photos', async () => {
    mockInvoke.mockImplementation(mockSingleViewRouter({
      get_photo_detail: [PHOTO_DETAIL, { ...PHOTO_DETAIL, logical_photo_id: 2 }],
    }))
    render(SingleView)
    await waitFor(() => screen.getByRole('img'))

    await fireEvent.keyDown(document, { key: 'ArrowRight' })

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('get_photo_detail', {
        slug: 'test-project', logicalPhotoId: 2,
      })
    })
  })

  it('Escape goes back to stack-focus', async () => {
    render(SingleView)
    await waitFor(() => screen.getByRole('img'))

    await fireEvent.keyDown(document, { key: 'Escape' })

    expect(navigation.current.kind).toBe('stack-focus')
  })

  it('I key toggles camera params visibility', async () => {
    render(SingleView)
    await waitFor(() => screen.getByText(/f\/2\.8/))

    // Press I to hide
    await fireEvent.keyDown(document, { key: 'i' })
    expect(screen.queryByText(/f\/2\.8/)).not.toBeInTheDocument()

    // Press I again to show
    await fireEvent.keyDown(document, { key: 'i' })
    await waitFor(() => {
      expect(screen.getByText(/f\/2\.8/)).toBeInTheDocument()
    })
  })

  it('Ctrl+Enter does not commit (removed from SingleView)', async () => {
    render(SingleView)
    await waitFor(() => screen.getByRole('img'))

    await fireEvent.keyDown(document, { key: 'Enter', ctrlKey: true })

    await new Promise(r => setTimeout(r, 50))
    expect(mockInvoke).not.toHaveBeenCalledWith('commit_round', expect.anything())
  })
})


describe('SingleView — status bar', () => {
  it('shows photo position and status', async () => {
    mockInvoke.mockImplementation(mockSingleViewRouter({
      get_photo_detail: { ...PHOTO_DETAIL, current_status: 'keep' },
      list_logical_photos: [PHOTO_LIST],
    }))
    render(SingleView)
    await waitFor(() => {
      expect(screen.getByText(/Photo 1\/3/)).toBeInTheDocument()
      expect(screen.getByText(/KEPT/i)).toBeInTheDocument()
    })
  })

  it('V4: KEPT status text is styled as kept', async () => {
    mockInvoke.mockImplementation(mockSingleViewRouter({
      get_photo_detail: { ...PHOTO_DETAIL, current_status: 'keep' },
    }))
    render(SingleView)
    await waitFor(() => {
      const keptSpan = screen.getByText(/KEPT/)
      assertStatusTextStyle(keptSpan, 'keep')
    })
  })

  it('V4: ELIMINATED status text is styled as eliminated', async () => {
    mockInvoke.mockImplementation(mockSingleViewRouter({
      get_photo_detail: { ...PHOTO_DETAIL, current_status: 'eliminate' },
    }))
    render(SingleView)
    await waitFor(() => {
      const elimSpan = screen.getByText(/ELIMINATED/)
      assertStatusTextStyle(elimSpan, 'eliminate')
    })
  })

  it('V4: UNDECIDED status text is styled as undecided', async () => {
    mockInvoke.mockImplementation(mockSingleViewRouter({
      get_photo_detail: { ...PHOTO_DETAIL, current_status: 'undecided' },
    }))
    render(SingleView)
    await waitFor(() => {
      const undecidedSpan = screen.getByText(/UNDECIDED/)
      assertStatusTextStyle(undecidedSpan, 'undecided')
    })
  })

  it('V5: shows "(read-only)" suffix when round is committed', async () => {
    mockInvoke.mockImplementation(mockSingleViewRouter({
      get_photo_detail: { ...PHOTO_DETAIL, current_status: 'keep' },
      get_round_status: COMMITTED_ROUND,
    }))
    render(SingleView)
    await waitFor(() => {
      // Svelte's {#if} block creates separate text nodes for "KEPT" and "(read-only)"
      // so getByText with regex across them won't match. Check each part separately.
      const keptEl = screen.getByText(/KEPT/)
      expect(keptEl).toBeInTheDocument()
      expect(keptEl.textContent).toContain('(read-only)')
    })
  })

  it('V5: does NOT show "(read-only)" when round is open', async () => {
    mockInvoke.mockImplementation(mockSingleViewRouter({
      get_photo_detail: { ...PHOTO_DETAIL, current_status: 'keep' },
    }))
    render(SingleView)
    await waitFor(() => {
      expect(screen.getByText(/KEPT/)).toBeInTheDocument()
      expect(screen.queryByText(/read-only/)).not.toBeInTheDocument()
    })
  })
})

describe('SingleView — Tab navigation', () => {
  it('Tab jumps to next undecided photo', async () => {
    setupNav(1)
    const FIVE_PHOTOS: LogicalPhotoSummary[] = [
      { logical_photo_id: 1, thumbnail_path: null, capture_time: null, camera_model: null, lens: null, has_raw: false, has_jpeg: true, aperture: null, shutter_speed: null, iso: null, focal_length: null },
      { logical_photo_id: 2, thumbnail_path: null, capture_time: null, camera_model: null, lens: null, has_raw: false, has_jpeg: true, aperture: null, shutter_speed: null, iso: null, focal_length: null },
      { logical_photo_id: 3, thumbnail_path: null, capture_time: null, camera_model: null, lens: null, has_raw: false, has_jpeg: true, aperture: null, shutter_speed: null, iso: null, focal_length: null },
      { logical_photo_id: 4, thumbnail_path: null, capture_time: null, camera_model: null, lens: null, has_raw: false, has_jpeg: true, aperture: null, shutter_speed: null, iso: null, focal_length: null },
      { logical_photo_id: 5, thumbnail_path: null, capture_time: null, camera_model: null, lens: null, has_raw: false, has_jpeg: true, aperture: null, shutter_speed: null, iso: null, focal_length: null },
    ]
    mockInvoke.mockImplementation(mockSingleViewRouter({
      get_round_decisions: [DECISIONS_MIXED],
      list_logical_photos: [FIVE_PHOTOS],
      get_photo_detail: [PHOTO_DETAIL, { ...PHOTO_DETAIL, logical_photo_id: 2 }],
    }))
    render(SingleView)
    await waitFor(() => screen.getByRole('img'))

    // Photo 1 is 'keep' (decided), Tab should jump to photo 2 (undecided)
    await fireEvent.keyDown(document, { key: 'Tab' })

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('get_photo_detail', {
        slug: 'test-project', logicalPhotoId: 2,
      })
    })
  })
})

describe('SingleView — Home/End navigation', () => {
  const FIVE_PHOTOS: LogicalPhotoSummary[] = [
    { logical_photo_id: 1, thumbnail_path: null, capture_time: null, camera_model: null, lens: null, has_raw: false, has_jpeg: true, aperture: null, shutter_speed: null, iso: null, focal_length: null },
    { logical_photo_id: 2, thumbnail_path: null, capture_time: null, camera_model: null, lens: null, has_raw: false, has_jpeg: true, aperture: null, shutter_speed: null, iso: null, focal_length: null },
    { logical_photo_id: 3, thumbnail_path: null, capture_time: null, camera_model: null, lens: null, has_raw: false, has_jpeg: true, aperture: null, shutter_speed: null, iso: null, focal_length: null },
    { logical_photo_id: 4, thumbnail_path: null, capture_time: null, camera_model: null, lens: null, has_raw: false, has_jpeg: true, aperture: null, shutter_speed: null, iso: null, focal_length: null },
    { logical_photo_id: 5, thumbnail_path: null, capture_time: null, camera_model: null, lens: null, has_raw: false, has_jpeg: true, aperture: null, shutter_speed: null, iso: null, focal_length: null },
  ]

  it('Home key jumps to first photo', async () => {
    // Start at photo 4 (index 3)
    setupNav(4)
    mockInvoke.mockImplementation(mockSingleViewRouter({
      get_photo_detail: [{ ...PHOTO_DETAIL, logical_photo_id: 4 }, { ...PHOTO_DETAIL, logical_photo_id: 1 }],
      list_logical_photos: [FIVE_PHOTOS],
    }))
    render(SingleView)
    await waitFor(() => screen.getByRole('img'))

    await fireEvent.keyDown(document, { key: 'Home' })

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('get_photo_detail', {
        slug: 'test-project', logicalPhotoId: 1,
      })
    })
  })

  it('End key jumps to last photo', async () => {
    setupNav(1)
    mockInvoke.mockImplementation(mockSingleViewRouter({
      list_logical_photos: [FIVE_PHOTOS],
      get_photo_detail: [PHOTO_DETAIL, { ...PHOTO_DETAIL, logical_photo_id: 5 }],
    }))
    render(SingleView)
    await waitFor(() => screen.getByRole('img'))

    await fireEvent.keyDown(document, { key: 'End' })

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('get_photo_detail', {
        slug: 'test-project', logicalPhotoId: 5,
      })
    })
  })
})

describe('SingleView — Shift+Tab navigation', () => {
  it('Shift+Tab jumps to previous undecided photo', async () => {
    const FIVE_PHOTOS: LogicalPhotoSummary[] = [
      { logical_photo_id: 1, thumbnail_path: null, capture_time: null, camera_model: null, lens: null, has_raw: false, has_jpeg: true, aperture: null, shutter_speed: null, iso: null, focal_length: null },
      { logical_photo_id: 2, thumbnail_path: null, capture_time: null, camera_model: null, lens: null, has_raw: false, has_jpeg: true, aperture: null, shutter_speed: null, iso: null, focal_length: null },
      { logical_photo_id: 3, thumbnail_path: null, capture_time: null, camera_model: null, lens: null, has_raw: false, has_jpeg: true, aperture: null, shutter_speed: null, iso: null, focal_length: null },
      { logical_photo_id: 4, thumbnail_path: null, capture_time: null, camera_model: null, lens: null, has_raw: false, has_jpeg: true, aperture: null, shutter_speed: null, iso: null, focal_length: null },
      { logical_photo_id: 5, thumbnail_path: null, capture_time: null, camera_model: null, lens: null, has_raw: false, has_jpeg: true, aperture: null, shutter_speed: null, iso: null, focal_length: null },
    ]

    // Start at photo 5 (index 4)
    setupNav(5)
    mockInvoke.mockImplementation(mockSingleViewRouter({
      get_photo_detail: [{ ...PHOTO_DETAIL, logical_photo_id: 5, current_status: 'keep' }, { ...PHOTO_DETAIL, logical_photo_id: 4 }],
      list_logical_photos: [FIVE_PHOTOS],
      get_round_decisions: [[
        { logical_photo_id: 1, current_status: 'keep' },
        { logical_photo_id: 2, current_status: 'undecided' },
        { logical_photo_id: 3, current_status: 'eliminate' },
        { logical_photo_id: 4, current_status: 'undecided' },
        { logical_photo_id: 5, current_status: 'keep' },
      ]],
    }))
    render(SingleView)
    await waitFor(() => screen.getByRole('img'))

    // Shift+Tab should jump backward to previous undecided — photo 4 (index 3)
    await fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('get_photo_detail', {
        slug: 'test-project', logicalPhotoId: 4,
      })
    })
  })
})

describe('SingleView — eliminate visual feedback', () => {
  it('X key adds decision-eliminate class and dim overlay element', async () => {
    mockInvoke.mockImplementation(mockSingleViewRouter({
      make_decision: makeDecisionResult({ action: 'eliminate', current_status: 'eliminate' }),
    }))
    render(SingleView)
    await waitFor(() => screen.getByRole('img'))

    await fireEvent.keyDown(document, { key: 'x' })

    await waitFor(() => {
      const frame = document.querySelector('[data-testid="photo-frame"]') as HTMLElement
      expect(frame).not.toBeNull()
      assertDecisionEliminated(frame)
      assertDecisionDimmed(frame)
    })
  })
})

describe('SingleView — camera params panel extended info', () => {
  it('Camera params panel shows camera model and lens', async () => {
    mockInvoke.mockImplementation(mockSingleViewRouter({
      get_photo_detail: { ...PHOTO_DETAIL, camera_model: 'Canon EOS R5', lens: 'RF 85mm f/1.2L' },
    }))
    render(SingleView)

    await waitFor(() => {
      expect(screen.getByText(/Canon EOS R5/)).toBeInTheDocument()
      expect(screen.getByText(/RF 85mm/)).toBeInTheDocument()
    })
  })

  it('Camera params panel shows RAW and JPEG badges', async () => {
    mockInvoke.mockImplementation(mockSingleViewRouter({
      get_photo_detail: { ...PHOTO_DETAIL, has_raw: true, has_jpeg: true },
    }))
    render(SingleView)

    await waitFor(() => {
      expect(screen.getByText('RAW')).toBeInTheDocument()
      expect(screen.getByText('JPEG')).toBeInTheDocument()
    })
  })

  it('Camera params panel shows capture date and time', async () => {
    mockInvoke.mockImplementation(mockSingleViewRouter({
      get_photo_detail: { ...PHOTO_DETAIL, capture_time: '2024-02-14T14:23:01Z' },
    }))
    render(SingleView)

    await waitFor(() => {
      // Should display date/time info from capture_time
      const text = document.body.textContent ?? ''
      const hasDate = text.includes('Feb 14') || text.includes('14:23') || text.includes('2024-02-14')
      expect(hasDate).toBe(true)
    })
  })
})

describe('SingleView — status bar extended format', () => {
  it('Status bar shows stack name and round number', async () => {
    render(SingleView)

    await waitFor(() => {
      const text = document.body.textContent ?? ''
      // Name promises BOTH stack name AND round number
      expect(text).toContain('Round 1')
      expect(text).toContain('Stack')
    })
  })
})

describe('SingleView — arrow boundary behavior', () => {
  it('ArrowRight at last photo does NOT call get_photo_detail (SV-31)', async () => {
    // Start at the last photo (id=3, index 2 in a 3-photo list)
    setupNav(3)
    mockInvoke.mockImplementation(mockSingleViewRouter({
      get_photo_detail: { ...PHOTO_DETAIL, logical_photo_id: 3 },
      list_logical_photos: [PHOTO_LIST],
    }))
    render(SingleView)
    await waitFor(() => screen.getByRole('img'))

    const callCountBefore = mockInvoke.mock.calls.length

    await fireEvent.keyDown(document, { key: 'ArrowRight' })

    // Small delay to flush any async effects
    await new Promise(r => setTimeout(r, 50))

    // No additional get_photo_detail call should have been made
    const callCountAfter = mockInvoke.mock.calls.length
    expect(callCountAfter).toBe(callCountBefore)
  })

  it('ArrowLeft at first photo does NOT call get_photo_detail (SV-32)', async () => {
    // Start at first photo (id=1, index 0)
    setupNav(1)
    render(SingleView)
    await waitFor(() => screen.getByRole('img'))

    const callCountBefore = mockInvoke.mock.calls.length

    await fireEvent.keyDown(document, { key: 'ArrowLeft' })

    await new Promise(r => setTimeout(r, 50))

    const callCountAfter = mockInvoke.mock.calls.length
    expect(callCountAfter).toBe(callCountBefore)
  })
})

describe('SingleView — vim-style navigation', () => {
  it('l key navigates to next photo like ArrowRight (SV-33)', async () => {
    setupNav(1)
    mockInvoke.mockImplementation(mockSingleViewRouter({
      get_photo_detail: [PHOTO_DETAIL, { ...PHOTO_DETAIL, logical_photo_id: 2 }],
    }))
    render(SingleView)
    await waitFor(() => screen.getByRole('img'))

    await fireEvent.keyDown(document, { key: 'l' })

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('get_photo_detail', {
        slug: 'test-project', logicalPhotoId: 2,
      })
    })
  })

  it('h key navigates to previous photo like ArrowLeft (SV-33)', async () => {
    // Start at photo 2 so we can go back
    setupNav(2)
    mockInvoke.mockImplementation(mockSingleViewRouter({
      get_photo_detail: [{ ...PHOTO_DETAIL, logical_photo_id: 2 }, { ...PHOTO_DETAIL, logical_photo_id: 1 }],
      list_logical_photos: [PHOTO_LIST],
    }))
    render(SingleView)
    await waitFor(() => screen.getByRole('img'))

    await fireEvent.keyDown(document, { key: 'h' })

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('get_photo_detail', {
        slug: 'test-project', logicalPhotoId: 1,
      })
    })
  })
})

describe('SingleView — makeDecision error feedback (H4)', () => {
  it('Y key failure shows visible error banner', async () => {
    mockInvoke.mockImplementation(mockSingleViewRouter({
      make_decision: () => { throw new Error('Network error') },
    }))
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    render(SingleView)
    await waitFor(() => screen.getByRole('img'))

    await fireEvent.keyDown(document, { key: 'y' })

    await waitFor(() => {
      expect(screen.getByTestId('decision-error')).toBeInTheDocument()
      expect(screen.getByText('Failed to save decision. Please try again.')).toBeInTheDocument()
    })

    consoleSpy.mockRestore()
  })

  it('X key failure shows visible error banner', async () => {
    mockInvoke.mockImplementation(mockSingleViewRouter({
      make_decision: () => { throw new Error('DB locked') },
    }))
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    render(SingleView)
    await waitFor(() => screen.getByRole('img'))

    await fireEvent.keyDown(document, { key: 'x' })

    await waitFor(() => {
      expect(screen.getByTestId('decision-error')).toBeInTheDocument()
      expect(screen.getByText('Failed to save decision. Please try again.')).toBeInTheDocument()
    })

    consoleSpy.mockRestore()
  })

  it('error banner does not appear on successful decision', async () => {
    mockInvoke.mockImplementation(mockSingleViewRouter({
      make_decision: makeDecisionResult(),
    }))
    render(SingleView)
    await waitFor(() => screen.getByRole('img'))

    await fireEvent.keyDown(document, { key: 'y' })

    // Small delay to ensure any async effects settle
    await new Promise(r => setTimeout(r, 50))
    expect(screen.queryByTestId('decision-error')).not.toBeInTheDocument()
  })
})

describe('SingleView — M1: commitRound error handling (Ctrl+Enter removed)', () => {
  it('Ctrl+Enter does not trigger commit (removed from SingleView)', async () => {
    render(SingleView)
    await waitFor(() => screen.getByRole('img'))

    await fireEvent.keyDown(document, { key: 'Enter', ctrlKey: true })

    await new Promise(r => setTimeout(r, 50))
    expect(mockInvoke).not.toHaveBeenCalledWith('commit_round', expect.anything())
  })

  it('Ctrl+Enter does not show error banner (removed from SingleView)', async () => {
    render(SingleView)
    await waitFor(() => screen.getByRole('img'))

    await fireEvent.keyDown(document, { key: 'Enter', ctrlKey: true })

    await new Promise(r => setTimeout(r, 50))
    expect(screen.queryByTestId('decision-error')).not.toBeInTheDocument()
  })
})

describe('SingleView — M9: Tab wrap-around', () => {
  it('Tab at last undecided wraps to first undecided', async () => {
    // Photo list: 1=keep, 2=keep, 3=undecided (start here), all others decided
    const THREE_PHOTOS: LogicalPhotoSummary[] = [
      { logical_photo_id: 1, thumbnail_path: null, capture_time: null, camera_model: null, lens: null, has_raw: false, has_jpeg: true, aperture: null, shutter_speed: null, iso: null, focal_length: null },
      { logical_photo_id: 2, thumbnail_path: null, capture_time: null, camera_model: null, lens: null, has_raw: false, has_jpeg: true, aperture: null, shutter_speed: null, iso: null, focal_length: null },
      { logical_photo_id: 3, thumbnail_path: null, capture_time: null, camera_model: null, lens: null, has_raw: false, has_jpeg: true, aperture: null, shutter_speed: null, iso: null, focal_length: null },
    ]

    // Start at photo 3 (last photo, only undecided one)
    setupNav(3)
    mockInvoke.mockImplementation(mockSingleViewRouter({
      get_photo_detail: { ...PHOTO_DETAIL, logical_photo_id: 3 },
      list_logical_photos: [THREE_PHOTOS],
      get_round_decisions: [[
        { logical_photo_id: 1, current_status: 'keep' },
        { logical_photo_id: 2, current_status: 'eliminate' },
        { logical_photo_id: 3, current_status: 'undecided' },
      ]],
    }))
    render(SingleView)
    await waitFor(() => screen.getByRole('img'))

    // Tab should wrap around — since photo 3 is the only undecided, it stays
    // (No other undecided to jump to, so no get_photo_detail call)
    const callCountBefore = mockInvoke.mock.calls.length

    await fireEvent.keyDown(document, { key: 'Tab' })

    await new Promise(r => setTimeout(r, 50))
    // No additional calls — already at the only undecided photo
    expect(mockInvoke.mock.calls.length).toBe(callCountBefore)
  })

  it('Tab wraps from last to first undecided when multiple undecided exist', async () => {
    // Photos: 1=undecided, 2=keep, 3=undecided (start here)
    const THREE_PHOTOS: LogicalPhotoSummary[] = [
      { logical_photo_id: 1, thumbnail_path: null, capture_time: null, camera_model: null, lens: null, has_raw: false, has_jpeg: true, aperture: null, shutter_speed: null, iso: null, focal_length: null },
      { logical_photo_id: 2, thumbnail_path: null, capture_time: null, camera_model: null, lens: null, has_raw: false, has_jpeg: true, aperture: null, shutter_speed: null, iso: null, focal_length: null },
      { logical_photo_id: 3, thumbnail_path: null, capture_time: null, camera_model: null, lens: null, has_raw: false, has_jpeg: true, aperture: null, shutter_speed: null, iso: null, focal_length: null },
    ]

    setupNav(3)
    mockInvoke.mockImplementation(mockSingleViewRouter({
      get_photo_detail: [{ ...PHOTO_DETAIL, logical_photo_id: 3 }, { ...PHOTO_DETAIL, logical_photo_id: 1 }],
      list_logical_photos: [THREE_PHOTOS],
      get_round_decisions: [[
        { logical_photo_id: 1, current_status: 'undecided' },
        { logical_photo_id: 2, current_status: 'keep' },
        { logical_photo_id: 3, current_status: 'undecided' },
      ]],
    }))
    render(SingleView)
    await waitFor(() => screen.getByRole('img'))

    // Tab from photo 3 (index 2) should wrap to photo 1 (index 0) — the first undecided
    await fireEvent.keyDown(document, { key: 'Tab' })

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('get_photo_detail', {
        slug: 'test-project', logicalPhotoId: 1,
      })
    })
  })
})

describe('SingleView — thumbnail_path fallback (SV-40)', () => {
  it('renders thumbnail_path when jpeg_path is null', async () => {
    vi.mocked(convertFileSrc).mockImplementation((p: string) => `asset://localhost${p}`)
    mockInvoke.mockImplementation(mockSingleViewRouter({
      get_photo_detail: { ...PHOTO_DETAIL, jpeg_path: null, thumbnail_path: '/cache/thumbnails/1.jpg' },
    }))
    render(SingleView)

    await waitFor(() => {
      const img = screen.getByRole('img')
      expect(img).toHaveAttribute('src', 'asset://localhost/cache/thumbnails/1.jpg')
    })
  })

  it('renders jpeg_path as fallback when thumbnail_path is null', async () => {
    vi.mocked(convertFileSrc).mockImplementation((p: string) => `asset://localhost${p}`)
    mockInvoke.mockImplementation(mockSingleViewRouter({
      get_photo_detail: { ...PHOTO_DETAIL, thumbnail_path: null, jpeg_path: '/home/user/Photos/IMG_001.jpg' },
    }))
    render(SingleView)

    await waitFor(() => {
      const img = screen.getByRole('img')
      expect(img).toHaveAttribute('src', 'asset://localhost/home/user/Photos/IMG_001.jpg')
    })
  })

  it('shows "No preview available" placeholder when both thumbnail_path and jpeg_path are null', async () => {
    mockInvoke.mockImplementation(mockSingleViewRouter({
      get_photo_detail: { ...PHOTO_DETAIL, thumbnail_path: null, jpeg_path: null },
    }))
    render(SingleView)

    await waitFor(() => {
      expect(screen.getByTestId('no-preview')).toBeInTheDocument()
      expect(screen.getByText('No preview available')).toBeInTheDocument()
      expect(screen.queryByRole('img')).not.toBeInTheDocument()
    })
  })
})

// --- BUG B3: roundStatus stale after Ctrl+Enter commit ---

// ─── Display refactoring safety nets ─────────────────────────────────────────

describe('SingleView — preview_path fallback (RAW-only photo)', () => {
  it('renders preview_path when jpeg_path is null (RAW-only)', async () => {
    vi.mocked(convertFileSrc).mockImplementation((p: string) => `asset://localhost${p}`)
    mockInvoke.mockImplementation(mockSingleViewRouter({
      get_photo_detail: makePhotoDetail({
        jpeg_path: null,
        preview_path: '/cache/preview/1.jpg',
        thumbnail_path: '/cache/thumb/1.jpg',
      }),
    }))
    render(SingleView)

    await waitFor(() => {
      const img = screen.getByRole('img')
      // preview_path should be preferred over thumbnail_path when jpeg_path is null
      expect(img).toHaveAttribute('src', 'asset://localhost/cache/preview/1.jpg')
    })
  })
})

describe('SingleView — cascade priority (jpeg_path wins)', () => {
  it('renders jpeg_path when all paths are set', async () => {
    vi.mocked(convertFileSrc).mockImplementation((p: string) => `asset://localhost${p}`)
    mockInvoke.mockImplementation(mockSingleViewRouter({
      get_photo_detail: makePhotoDetail({
        jpeg_path: '/home/user/Photos/IMG_001.jpg',
        preview_path: '/cache/preview/1.jpg',
        thumbnail_path: '/cache/thumb/1.jpg',
      }),
    }))
    render(SingleView)

    await waitFor(() => {
      const img = screen.getByRole('img')
      // jpeg_path is highest priority in the cascade
      expect(img).toHaveAttribute('src', 'asset://localhost/home/user/Photos/IMG_001.jpg')
    })
  })
})

// ─── F key file path overlay ────────────────────────────────────────────────

describe('SingleView — F key file path overlay', () => {
  it('F key shows file path overlay with displayed format path only', async () => {
    mockInvoke.mockImplementation(mockSingleViewRouter({
      get_photo_detail: {
        ...PHOTO_DETAIL,
        jpeg_path: '/home/user/Photos/IMG_001.jpg',
        raw_path: '/home/user/Photos/IMG_001.CR3',
      },
    }))
    render(SingleView)

    await waitFor(() => screen.queryByTestId('loading-indicator') === null)

    await fireEvent.keyDown(document, { key: 'f' })

    await waitFor(() => {
      const overlay = screen.getByTestId('file-path-overlay')
      expect(overlay).toBeInTheDocument()
      expect(overlay.textContent).toContain('/home/user/Photos/IMG_001.jpg')
      expect(overlay.textContent).not.toContain('/home/user/Photos/IMG_001.CR3')
    })
  })

  it('F key toggles overlay off on second press', async () => {
    mockInvoke.mockImplementation(mockSingleViewRouter({
      get_photo_detail: {
        ...PHOTO_DETAIL,
        jpeg_path: '/home/user/Photos/IMG_001.jpg',
        raw_path: null,
      },
    }))
    render(SingleView)

    await waitFor(() => screen.queryByTestId('loading-indicator') === null)

    // First F — show
    await fireEvent.keyDown(document, { key: 'f' })
    await waitFor(() => {
      expect(screen.getByTestId('file-path-overlay')).toBeInTheDocument()
    })

    // Second F — hide
    await fireEvent.keyDown(document, { key: 'f' })
    await waitFor(() => {
      expect(screen.queryByTestId('file-path-overlay')).not.toBeInTheDocument()
    })
  })

  it('F key copies file path to clipboard on first press', async () => {
    // Mock clipboard
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })

    mockInvoke.mockImplementation(mockSingleViewRouter({
      get_photo_detail: {
        ...PHOTO_DETAIL,
        jpeg_path: '/home/user/Photos/IMG_001.jpg',
        raw_path: null,
      },
    }))
    render(SingleView)

    await waitFor(() => screen.queryByTestId('loading-indicator') === null)

    await fireEvent.keyDown(document, { key: 'f' })

    // Overlay should appear
    await waitFor(() => {
      expect(screen.getByTestId('file-path-overlay')).toBeInTheDocument()
    })

    // Clipboard should have the file path
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith('/home/user/Photos/IMG_001.jpg')
    })
  })

  it('F key shows only JPEG path when no RAW', async () => {
    mockInvoke.mockImplementation(mockSingleViewRouter({
      get_photo_detail: {
        ...PHOTO_DETAIL,
        jpeg_path: '/home/user/Photos/IMG_001.jpg',
        raw_path: null,
      },
    }))
    render(SingleView)

    await waitFor(() => screen.queryByTestId('loading-indicator') === null)

    await fireEvent.keyDown(document, { key: 'f' })

    await waitFor(() => {
      const overlay = screen.getByTestId('file-path-overlay')
      expect(overlay.textContent).toContain('/home/user/Photos/IMG_001.jpg')
      expect(overlay.textContent).not.toContain('CR3')
    })
  })
})

describe('F key format-only path', () => {
  it('F key with RAW+JPEG photo shows only jpeg_path (not raw_path)', async () => {
    mockInvoke.mockImplementation(mockSingleViewRouter({
      get_photo_detail: makePhotoDetail({
        jpeg_path: '/home/user/Photos/IMG_001.jpg',
        raw_path: '/home/user/Photos/IMG_001.CR3',
        has_raw: true,
        has_jpeg: true,
      }),
    }))
    render(SingleView)
    await waitFor(() => screen.getByRole('img'))

    await fireEvent.keyDown(document, { key: 'f' })

    await waitFor(() => {
      const overlay = screen.getByTestId('file-path-overlay')
      expect(overlay).toBeInTheDocument()
      // Should show only the displayed format's path (JPEG when viewing JPEG)
      expect(overlay.textContent).toContain('/home/user/Photos/IMG_001.jpg')
      // Should NOT show the raw_path — F key should show only the displayed format
      expect(overlay.textContent).not.toContain('/home/user/Photos/IMG_001.CR3')
    })
  })
})

// ─── Fix 3: Toast for silent Tab failures ───────────────────────────────────

describe('SingleView — Tab shows toast when all photos decided', () => {
  it('Tab when all photos decided shows "No undecided photos" error', async () => {
    const THREE_PHOTOS: LogicalPhotoSummary[] = [
      { logical_photo_id: 1, thumbnail_path: null, capture_time: null, camera_model: null, lens: null, has_raw: false, has_jpeg: true, aperture: null, shutter_speed: null, iso: null, focal_length: null },
      { logical_photo_id: 2, thumbnail_path: null, capture_time: null, camera_model: null, lens: null, has_raw: false, has_jpeg: true, aperture: null, shutter_speed: null, iso: null, focal_length: null },
      { logical_photo_id: 3, thumbnail_path: null, capture_time: null, camera_model: null, lens: null, has_raw: false, has_jpeg: true, aperture: null, shutter_speed: null, iso: null, focal_length: null },
    ]

    setupNav(1)
    mockInvoke.mockImplementation(mockSingleViewRouter({
      get_photo_detail: { ...PHOTO_DETAIL, current_status: 'keep' },
      list_logical_photos: [THREE_PHOTOS],
      get_round_decisions: [[
        { logical_photo_id: 1, current_status: 'keep' },
        { logical_photo_id: 2, current_status: 'eliminate' },
        { logical_photo_id: 3, current_status: 'keep' },
      ]],
      get_round_status: makeRoundStatus({
        decided: 3, kept: 2, eliminated: 1, undecided: 0,
      }),
    }))
    render(SingleView)
    await waitFor(() => screen.getByRole('img'))

    await fireEvent.keyDown(document, { key: 'Tab' })

    await waitFor(() => {
      expect(screen.getByTestId('decision-error')).toBeInTheDocument()
      expect(screen.getByTestId('decision-error').textContent).toContain('No undecided photos')
    })
  })
})

// ─── Bug 5: Ctrl+Enter should NOT commit in SingleView ──────────────────────

describe('SingleView — Bug 5: Ctrl+Enter disabled', () => {
  it('Ctrl+Enter does NOT call commitRound in SingleView', async () => {
    render(SingleView)
    await waitFor(() => screen.getByRole('img'))

    await fireEvent.keyDown(document, { key: 'Enter', ctrlKey: true })

    // Wait a tick to flush any async effects
    await new Promise(r => setTimeout(r, 50))

    // commit_round should NOT have been called — SingleView is a viewing screen
    expect(mockInvoke).not.toHaveBeenCalledWith('commit_round', expect.anything())
  })
})

describe('SingleView — back navigation', () => {
  it('Esc returns to comparison-view when entered from comparison', async () => {
    navigate({ kind: 'single-view', projectSlug: 'test-project', projectName: 'Test', stackId: 1, photoId: 1, from: 'comparison-view' })
    render(SingleView)
    await waitFor(() => screen.getByRole('img'))

    await fireEvent.keyDown(document, { key: 'Escape' })

    expect(navigation.current.kind).toBe('comparison-view')
  })

  it('Esc returns to stack-focus when entered normally (no from)', async () => {
    navigate({ kind: 'single-view', projectSlug: 'test-project', projectName: 'Test', stackId: 1, photoId: 1 })
    render(SingleView)
    await waitFor(() => screen.getByRole('img'))

    await fireEvent.keyDown(document, { key: 'Escape' })

    expect(navigation.current.kind).toBe('stack-focus')
  })
})

// ── Sprint 10 Phase C: round-scoped photo display ────────────────────────────

describe('SingleView — Sprint 10 Phase C: roundId scoping', () => {
  it('displays round-scoped photo when round 2 is active', async () => {
    const ROUND_2 = makeRoundStatus({
      round_id: 2, round_number: 2, state: 'open',
      total_photos: 2, decided: 0, kept: 0, eliminated: 0, undecided: 2,
    })
    const ROUND_2_DECISIONS = [
      { logical_photo_id: 10, current_status: 'undecided' as const },
      { logical_photo_id: 11, current_status: 'undecided' as const },
    ]

    // Navigate to photo 10 (a round-2 photo)
    navigate({ kind: 'single-view', projectSlug: 'test-project', projectName: 'Test', stackId: 1, photoId: 10 })

    mockInvoke.mockImplementation(mockSingleViewRouter({
      get_round_status: ROUND_2,
      get_photo_detail: makePhotoDetail({
        logical_photo_id: 10,
        thumbnail_path: '/cache/round2_10.jpg',
        jpeg_path: '/photos/round2_10.jpg',
      }),
      list_logical_photos: (_cmd: unknown, args: unknown) => {
        const { roundId } = args as { roundId?: number }
        return roundId === 2 ? ROUND_2_PHOTOS : SINGLE_VIEW_PHOTO_LIST
      },
      get_round_decisions: ROUND_2_DECISIONS,
    }))

    render(SingleView)

    await waitFor(() => {
      screen.getByRole('img')
    })

    // The displayed image should be the round-2 photo, not a round-1 photo
    const img = screen.getByRole('img')
    expect(img.getAttribute('src')).toContain('round2_10')
  })
})
