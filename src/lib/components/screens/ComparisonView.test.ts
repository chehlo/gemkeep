// src/lib/components/screens/ComparisonView.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/svelte'
import { invoke, convertFileSrc } from '@tauri-apps/api/core'
import { navigate, navigation } from '$lib/stores/navigation.svelte.js'
import { PHOTO_1, PHOTO_2, PHOTO_3, makePhoto, makeDecisionResult, OPEN_ROUND, UNDECIDED_DECISIONS } from '$test/fixtures'
import { resetInvokeMock } from '$test/helpers'
import { DECISION_SELECTORS } from '$lib/constants/decisions'
import type { LogicalPhotoSummary } from '$lib/api/index.js'
import ComparisonView from './ComparisonView.svelte'

const mockInvoke = vi.mocked(invoke)

const mockPhotos: LogicalPhotoSummary[] = [PHOTO_1, PHOTO_2, PHOTO_3]

function setupNav() {
  navigate({ kind: 'comparison-view', projectSlug: 'test-project', stackId: 1, projectName: 'Test Project' })
}

function mockComparisonMount(
  photos: LogicalPhotoSummary[] = mockPhotos,
  decisions = UNDECIDED_DECISIONS,
  roundStatus = OPEN_ROUND,
) {
  mockInvoke.mockResolvedValueOnce(photos)       // list_logical_photos
  mockInvoke.mockResolvedValueOnce(decisions)     // get_stack_decisions
  mockInvoke.mockResolvedValueOnce(roundStatus)   // get_round_status
}

beforeEach(() => {
  vi.clearAllMocks()
  resetInvokeMock()
  setupNav()
})

// ─── Loading state ────────────────────────────────────────────────────────────

describe('ComparisonView — loading', () => {
  it('shows loading indicator before data arrives', async () => {
    mockInvoke.mockImplementation(() => new Promise(() => {})) // never resolves
    render(ComparisonView)
    expect(screen.getByTestId('loading-indicator')).toBeInTheDocument()
  })
})

// ─── Two-panel layout ─────────────────────────────────────────────────────────

describe('ComparisonView — layout', () => {
  it('renders two comparison panels side by side', async () => {
    mockComparisonMount()
    render(ComparisonView)

    await waitFor(() => {
      expect(screen.getByTestId('comparison-left')).toBeInTheDocument()
      expect(screen.getByTestId('comparison-right')).toBeInTheDocument()
    })
  })

  it('left panel has ring-blue-500 class by default', async () => {
    mockComparisonMount()
    render(ComparisonView)

    await waitFor(() => {
      const left = screen.getByTestId('comparison-left')
      const frame = left.querySelector('[data-testid="photo-frame"]')
      expect(frame).not.toBeNull()
      expect(frame!.className).toContain('ring-blue-500')
    })
  })

  it('right panel does not have ring-blue-500 class by default', async () => {
    mockComparisonMount()
    render(ComparisonView)

    await waitFor(() => {
      const right = screen.getByTestId('comparison-right')
      const frame = right.querySelector('[data-testid="photo-frame"]')
      expect(frame).not.toBeNull()
      expect(frame!.className).not.toContain('ring-blue-500')
    })
  })
})

// ─── Arrow key focus ──────────────────────────────────────────────────────────

describe('ComparisonView — focus navigation', () => {
  it('ArrowRight moves ring-blue-500 class to right panel', async () => {
    mockComparisonMount()
    render(ComparisonView)

    await waitFor(() => screen.getByTestId('comparison-left'))

    await fireEvent.keyDown(document, { key: 'ArrowRight' })

    await waitFor(() => {
      const right = screen.getByTestId('comparison-right')
      const rightFrame = right.querySelector('[data-testid="photo-frame"]')
      expect(rightFrame).not.toBeNull()
      expect(rightFrame!.className).toContain('ring-blue-500')
      const left = screen.getByTestId('comparison-left')
      const leftFrame = left.querySelector('[data-testid="photo-frame"]')
      expect(leftFrame).not.toBeNull()
      expect(leftFrame!.className).not.toContain('ring-blue-500')
    })
  })

  it('ArrowLeft moves ring-blue-500 class back to left panel', async () => {
    mockComparisonMount()
    render(ComparisonView)

    await waitFor(() => screen.getByTestId('comparison-left'))

    // Move right then left
    await fireEvent.keyDown(document, { key: 'ArrowRight' })
    await fireEvent.keyDown(document, { key: 'ArrowLeft' })

    await waitFor(() => {
      const left = screen.getByTestId('comparison-left')
      const frame = left.querySelector('[data-testid="photo-frame"]')
      expect(frame).not.toBeNull()
      expect(frame!.className).toContain('ring-blue-500')
    })
  })
})

// ─── Esc exits to StackFocus ──────────────────────────────────────────────────

describe('ComparisonView — Esc exit', () => {
  it('Esc navigates back to stack-focus', async () => {
    mockComparisonMount()
    render(ComparisonView)

    await waitFor(() => screen.getByTestId('comparison-left'))

    await fireEvent.keyDown(document, { key: 'Escape' })

    expect(navigation.current.kind).toBe('stack-focus')
  })
})

// ─── Lock toggle ──────────────────────────────────────────────────────────────

describe('ComparisonView — lock toggle', () => {
  it('L key toggles locked indicator', async () => {
    mockComparisonMount()
    render(ComparisonView)

    await waitFor(() => screen.getByTestId('comparison-left'))

    // Initially no locked indicator
    expect(screen.queryByTestId('locked-indicator')).not.toBeInTheDocument()

    // Press L to lock
    await fireEvent.keyDown(document, { key: 'l' })

    await waitFor(() => {
      expect(screen.getByTestId('locked-indicator')).toBeInTheDocument()
    })

    // Press L again to unlock
    await fireEvent.keyDown(document, { key: 'l' })

    await waitFor(() => {
      expect(screen.queryByTestId('locked-indicator')).not.toBeInTheDocument()
    })
  })
})

// ─── Decision: Y key keeps focused photo ──────────────────────────────────────

describe('ComparisonView — decisions', () => {
  it('Y key calls make_decision with keep on focused photo', async () => {
    mockComparisonMount()
    render(ComparisonView)

    await waitFor(() => screen.getByTestId('comparison-left'))

    // Mock decision + round status responses
    mockInvoke.mockResolvedValueOnce(makeDecisionResult({ action: 'keep', current_status: 'keep' }))
    mockInvoke.mockResolvedValueOnce({ ...OPEN_ROUND, decided: 1, kept: 1, undecided: 2 })

    await fireEvent.keyDown(document, { key: 'y' })

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('make_decision', expect.objectContaining({ action: 'keep' }))
    })
  })

  it('X key eliminates focused photo and auto-fills with next undecided', async () => {
    mockComparisonMount()
    render(ComparisonView)

    await waitFor(() => screen.getByTestId('comparison-left'))

    // Capture left panel content before eliminate
    const leftBefore = screen.getByTestId('comparison-left').textContent

    // Mock decision + round status responses
    mockInvoke.mockResolvedValueOnce(makeDecisionResult({ action: 'eliminate', current_status: 'eliminate' }))
    mockInvoke.mockResolvedValueOnce({ ...OPEN_ROUND, decided: 1, eliminated: 1, undecided: 2 })

    await fireEvent.keyDown(document, { key: 'x' })

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('make_decision', expect.objectContaining({ action: 'eliminate' }))
    })

    // Name promises "auto-fills with next undecided" — verify left panel content changed
    await waitFor(() => {
      const leftAfter = screen.getByTestId('comparison-left').textContent
      expect(leftAfter).not.toBe(leftBefore)
    })
  })

  it('X key while locked does NOT auto-fill', async () => {
    mockComparisonMount()
    render(ComparisonView)

    await waitFor(() => screen.getByTestId('comparison-left'))

    // Lock first
    await fireEvent.keyDown(document, { key: 'l' })

    await waitFor(() => screen.getByTestId('locked-indicator'))

    // Mock decision + round status responses
    mockInvoke.mockResolvedValueOnce(makeDecisionResult({ action: 'eliminate', current_status: 'eliminate' }))
    mockInvoke.mockResolvedValueOnce({ ...OPEN_ROUND, decided: 1, eliminated: 1, undecided: 2 })

    await fireEvent.keyDown(document, { key: 'x' })

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('make_decision', expect.objectContaining({ action: 'eliminate' }))
    })

    // Locked indicator should still be present (didn't exit)
    expect(screen.getByTestId('locked-indicator')).toBeInTheDocument()
    // Should still be in comparison-view (not exited)
    expect(navigation.current.kind).toBe('comparison-view')

    // Name promises "does NOT auto-fill" — verify left panel content unchanged
    const leftPanel = screen.getByTestId('comparison-left')
    // Left panel should still show PHOTO_1 (not replaced with PHOTO_3)
    expect(leftPanel.textContent).toContain('Canon EOS 5D')
  })
})

// ─── Photo cycling (ArrowDown / ArrowUp) ─────────────────────────────────────

describe('ComparisonView — photo cycling', () => {
  const cyclePhotos: LogicalPhotoSummary[] = [
    makePhoto({ logical_photo_id: 1, capture_time: '2024-01-15T10:00:00Z', camera_model: 'Camera-A' }),
    makePhoto({ logical_photo_id: 2, capture_time: '2024-02-20T10:00:00Z', camera_model: 'Camera-B' }),
    makePhoto({ logical_photo_id: 3, capture_time: '2024-03-25T10:00:00Z', camera_model: 'Camera-C' }),
  ]
  const cycleDecisions = [
    { logical_photo_id: 1, current_status: 'undecided' as const },
    { logical_photo_id: 2, current_status: 'undecided' as const },
    { logical_photo_id: 3, current_status: 'undecided' as const },
  ]

  it('ArrowDown cycles focused panel to next photo (skipping other panel)', async () => {
    mockComparisonMount(cyclePhotos, cycleDecisions)
    render(ComparisonView)

    // Wait for mount to complete — left panel shows photo 1 (Camera-A)
    await waitFor(() => {
      const left = screen.getByTestId('comparison-left')
      expect(left.textContent).toContain('Camera-A')
    })

    // Press ArrowDown — left (focused) should advance from index 0 to index 2 (skipping index 1 = right)
    await fireEvent.keyDown(document, { key: 'ArrowDown' })

    await waitFor(() => {
      const left = screen.getByTestId('comparison-left')
      // Photo 3 has Camera-C, photo 1 had Camera-A
      expect(left.textContent).toContain('Camera-C')
    })
  })

  it('ArrowUp cycles focused panel to previous photo (skipping other panel)', async () => {
    mockComparisonMount(cyclePhotos, cycleDecisions)
    render(ComparisonView)

    await waitFor(() => {
      const left = screen.getByTestId('comparison-left')
      expect(left.textContent).toContain('Camera-A')
    })

    // Press ArrowUp — left (focused) wraps from index 0 to index 2 (skipping index 1 = right)
    await fireEvent.keyDown(document, { key: 'ArrowUp' })

    await waitFor(() => {
      const left = screen.getByTestId('comparison-left')
      expect(left.textContent).toContain('Camera-C')
    })
  })
})

// ─── Error: fewer than 2 photos ───────────────────────────────────────────────

describe('ComparisonView — edge cases', () => {
  it('shows error when fewer than 2 photos in stack', async () => {
    mockComparisonMount([PHOTO_1], [{ logical_photo_id: 1, current_status: 'undecided' }])
    render(ComparisonView)

    await waitFor(() => {
      expect(screen.getByTestId('error-message')).toBeInTheDocument()
      expect(screen.getByTestId('error-message').textContent).toContain('Need at least 2 photos to compare')
    })
  })
})

// ─── Auto-fill edge cases ─────────────────────────────────────────────────────

describe('ComparisonView — auto-fill edge cases', () => {
  it('exits to stack-focus when no undecided photos remain after eliminate', async () => {
    // Only 2 photos, both undecided
    const twoPhotos = [PHOTO_1, PHOTO_2]
    const twoDecisions = [
      { logical_photo_id: 1, current_status: 'undecided' as const },
      { logical_photo_id: 2, current_status: 'undecided' as const },
    ]
    mockComparisonMount(twoPhotos, twoDecisions, { ...OPEN_ROUND, total_photos: 2, undecided: 2 })
    render(ComparisonView)

    await waitFor(() => screen.getByTestId('comparison-left'))

    // Eliminate left photo — no other undecided to fill, should exit
    mockInvoke.mockResolvedValueOnce(makeDecisionResult({ action: 'eliminate', current_status: 'eliminate' }))
    mockInvoke.mockResolvedValueOnce({ ...OPEN_ROUND, total_photos: 2, decided: 1, eliminated: 1, undecided: 1 })

    await fireEvent.keyDown(document, { key: 'x' })

    await waitFor(() => {
      expect(navigation.current.kind).toBe('stack-focus')
    })
  })

  it('Y key on already-kept photo is idempotent (no auto-fill)', async () => {
    // Photo 1 already kept, photo 2 undecided
    mockComparisonMount(mockPhotos, [
      { logical_photo_id: 1, current_status: 'keep' },
      { logical_photo_id: 2, current_status: 'undecided' },
      { logical_photo_id: 3, current_status: 'undecided' },
    ], { ...OPEN_ROUND, decided: 1, kept: 1, undecided: 2 })
    render(ComparisonView)

    await waitFor(() => screen.getByTestId('comparison-left'))

    // Press Y on already-kept left photo
    mockInvoke.mockResolvedValueOnce(makeDecisionResult({ action: 'keep', current_status: 'keep' }))
    mockInvoke.mockResolvedValueOnce({ ...OPEN_ROUND, decided: 1, kept: 1, undecided: 2 })

    await fireEvent.keyDown(document, { key: 'y' })

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('make_decision', expect.objectContaining({ action: 'keep' }))
    })

    // Should still be in comparison view (no exit, no auto-fill)
    expect(navigation.current.kind).toBe('comparison-view')
  })
})

// ─── Progress counter in header ───────────────────────────────────────────────

describe('ComparisonView — progress counter', () => {
  it('displays round progress in header', async () => {
    mockComparisonMount(mockPhotos, UNDECIDED_DECISIONS, {
      ...OPEN_ROUND,
      decided: 1,
      kept: 1,
      eliminated: 0,
      undecided: 2,
      total_photos: 3,
    })
    render(ComparisonView)

    await waitFor(() => {
      expect(document.body.textContent).toContain('1/3 decided')
      expect(document.body.textContent).toContain('1 kept')
      expect(document.body.textContent).toContain('2 undecided')
    })
  })
})

// ─── Display refactoring safety nets ─────────────────────────────────────────

describe('ComparisonView — baseline image-src (renders thumbnail_path)', () => {
  it('renders img elements with thumbnail_path via convertFileSrc', async () => {
    vi.mocked(convertFileSrc).mockImplementation((p: string) => `asset://localhost${p}`)
    const photosWithThumbs: LogicalPhotoSummary[] = [
      makePhoto({ logical_photo_id: 1, thumbnail_path: '/cache/thumb/1.jpg' }),
      makePhoto({ logical_photo_id: 2, thumbnail_path: '/cache/thumb/2.jpg' }),
      makePhoto({ logical_photo_id: 3, thumbnail_path: '/cache/thumb/3.jpg' }),
    ]
    mockComparisonMount(photosWithThumbs)
    render(ComparisonView)

    await waitFor(() => {
      const imgs = screen.getAllByRole('img')
      expect(imgs.length).toBeGreaterThanOrEqual(2)
      // Both panels should render images with asset:// URLs from thumbnail_path
      const srcs = imgs.map(img => img.getAttribute('src'))
      expect(srcs).toContain('asset://localhost/cache/thumb/1.jpg')
      expect(srcs).toContain('asset://localhost/cache/thumb/2.jpg')
    })
  })
})

// ─── Enter key navigation ────────────────────────────────────────────────────

describe('ComparisonView — Enter key navigation', () => {
  it('Enter key navigates to SingleView with focused photo', async () => {
    mockComparisonMount()
    render(ComparisonView)

    await waitFor(() => screen.getByTestId('comparison-left'))

    // Press Enter to open focused photo in SingleView
    await fireEvent.keyDown(document, { key: 'Enter' })

    await waitFor(() => {
      expect(navigation.current.kind).toBe('single-view')
    })

    // Should navigate to single-view with the left (focused) photo's ID
    const current = navigation.current as { kind: string; photoId?: number }
    expect(current.photoId).toBe(PHOTO_1.logical_photo_id)
  })

  it('Enter key passes from context as comparison-view', async () => {
    mockComparisonMount()
    render(ComparisonView)

    await waitFor(() => screen.getByTestId('comparison-left'))

    await fireEvent.keyDown(document, { key: 'Enter' })

    await waitFor(() => {
      expect(navigation.current.kind).toBe('single-view')
    })

    // Should include a 'from' field so SingleView knows how to navigate back
    const current = navigation.current as Record<string, unknown>
    expect(current.from).toBe('comparison-view')
  })
})

// ─── Bug 5: Ctrl+Enter should NOT commit in ComparisonView ──────────────────

describe('ComparisonView — Bug 5: Ctrl+Enter disabled', () => {
  it('Ctrl+Enter does NOT call commitRound in ComparisonView', async () => {
    mockComparisonMount()
    render(ComparisonView)

    await waitFor(() => screen.getByTestId('comparison-left'))

    await fireEvent.keyDown(document, { key: 'Enter', ctrlKey: true })

    // Wait a tick to flush any async effects
    await new Promise(r => setTimeout(r, 50))

    // commit_round should NOT have been called — ComparisonView is a viewing screen
    expect(mockInvoke).not.toHaveBeenCalledWith('commit_round', expect.anything())
  })
})

// ─── Visual affordances ─────────────────────────────────────────────────────

describe('ComparisonView — visual affordances', () => {
  it('no panel label banners (clean layout matching SingleView)', async () => {
    mockComparisonMount()
    render(ComparisonView)

    await waitFor(() => {
      expect(screen.getByTestId('comparison-left')).toBeInTheDocument()
    })

    // Panel label banners should not exist
    expect(screen.queryByTestId('panel-label-left')).not.toBeInTheDocument()
    expect(screen.queryByTestId('panel-label-right')).not.toBeInTheDocument()
  })
})

describe('ComparisonView — no-preview fallback (placeholder when thumbnail null)', () => {
  it('shows placeholder emoji when thumbnail_path is null', async () => {
    const photosNoThumbs: LogicalPhotoSummary[] = [
      makePhoto({ logical_photo_id: 1, thumbnail_path: null }),
      makePhoto({ logical_photo_id: 2, thumbnail_path: null }),
      makePhoto({ logical_photo_id: 3, thumbnail_path: null }),
    ]
    mockComparisonMount(photosNoThumbs)
    render(ComparisonView)

    await waitFor(() => {
      // Both panels should show the camera emoji placeholder instead of <img>
      expect(screen.queryAllByRole('img')).toHaveLength(0)
      // The camera emoji placeholder should be rendered in both panels
      const left = screen.getByTestId('comparison-left')
      const right = screen.getByTestId('comparison-right')
      expect(left.textContent).toContain('\u{1F4F7}')  // camera emoji
      expect(right.textContent).toContain('\u{1F4F7}')  // camera emoji
    })
  })
})

// ─── Camera params display ──────────────────────────────────────────────────

describe('ComparisonView — camera params text in left panel', () => {
  it('displays formatted camera params in left panel', async () => {
    const photosWithParams: LogicalPhotoSummary[] = [
      makePhoto({ logical_photo_id: 1, aperture: 2.8, shutter_speed: '1/250', iso: 400, focal_length: 85 }),
      makePhoto({ logical_photo_id: 2, aperture: 4, shutter_speed: '1/125', iso: 200, focal_length: 50 }),
      makePhoto({ logical_photo_id: 3, aperture: 5.6, shutter_speed: '1/60', iso: 100, focal_length: 35 }),
    ]
    mockComparisonMount(photosWithParams)
    render(ComparisonView)

    await waitFor(() => {
      const left = screen.getByTestId('comparison-left')
      const paramsEl = left.querySelector('[data-testid="camera-params"]')
      expect(paramsEl).not.toBeNull()
      expect(paramsEl!.textContent).toBe('f/2.8 \u00b7 1/250 \u00b7 ISO400 \u00b7 85mm')
    })
  })
})

// ─── DecisionIndicator after Y key ──────────────────────────────────────────

describe('ComparisonView — DecisionIndicator shows keep after Y key', () => {
  it('keep indicator appears in left panel after pressing Y', async () => {
    mockComparisonMount()
    render(ComparisonView)

    await waitFor(() => screen.getByTestId('comparison-left'))

    // Before pressing Y, no keep indicator in left panel
    const leftBefore = screen.getByTestId('comparison-left')
    expect(leftBefore.querySelector(DECISION_SELECTORS.keep)).toBeNull()

    // Mock decision + round status responses
    mockInvoke.mockResolvedValueOnce(makeDecisionResult({ action: 'keep', current_status: 'keep' }))
    mockInvoke.mockResolvedValueOnce({ ...OPEN_ROUND, decided: 1, kept: 1, undecided: 2 })

    await fireEvent.keyDown(document, { key: 'y' })

    await waitFor(() => {
      const left = screen.getByTestId('comparison-left')
      expect(left.querySelector(DECISION_SELECTORS.keep)).not.toBeNull()
    })
  })
})
