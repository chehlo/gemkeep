// src/lib/components/screens/StackOverview.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/svelte'
import { invoke, convertFileSrc } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { open } from '@tauri-apps/plugin-dialog'
import { navigate, navigation } from '$lib/stores/navigation.svelte.js'
import type { SourceFolder, IndexingStatus, StackSummary } from '$lib/api/index.js'
import StackOverview from './StackOverview.svelte'

const mockOpen = vi.mocked(open)
const mockInvoke = vi.mocked(invoke)
const mockListen = vi.mocked(listen)

const FOLDER_A: SourceFolder = { id: 1, path: '/home/user/Photos/Iceland' }
const FOLDER_B: SourceFolder = { id: 2, path: '/home/user/Photos/Drone' }

const IDLE_STATUS: IndexingStatus = {
  running: false, thumbnails_running: false, total: 0, processed: 0, errors: 0, cancelled: false, paused: false, last_stats: null,
  thumbnails_total: 0, thumbnails_done: 0
}

const RUNNING_STATUS: IndexingStatus = {
  running: true, thumbnails_running: false, total: 1290, processed: 340, errors: 0, cancelled: false, paused: false, last_stats: null,
  thumbnails_total: 0, thumbnails_done: 0
}

const DONE_STATUS: IndexingStatus = {
  running: false, thumbnails_running: false, total: 1290, processed: 1290, errors: 0, cancelled: false, paused: false,
  last_stats: {
    total_files_scanned: 1290, imported: 1280, skipped_existing: 0,
    skipped_unsupported: 10, errors: 0, pairs_detected: 640,
    stacks_generated: 3, logical_photos: 640, error_log: []
  },
  thumbnails_total: 0, thumbnails_done: 0
}

const THUMBNAIL_RUNNING_STATUS: IndexingStatus = {
  running: false, thumbnails_running: true, total: 1290, processed: 1290, errors: 0, cancelled: false, paused: false, last_stats: null,
  thumbnails_total: 0, thumbnails_done: 0
}

const STACK_1: StackSummary = {
  stack_id: 1, logical_photo_count: 6, earliest_capture: '2024-03-15T10:00:00Z',
  has_raw: true, has_jpeg: true, thumbnail_path: null
}
const STACK_2: StackSummary = {
  stack_id: 2, logical_photo_count: 4, earliest_capture: '2024-03-15T11:00:00Z',
  has_raw: false, has_jpeg: true, thumbnail_path: null
}
const STACK_3: StackSummary = {
  stack_id: 3, logical_photo_count: 1, earliest_capture: null,
  has_raw: true, has_jpeg: false, thumbnail_path: null
}

const STACK_WITH_THUMB: StackSummary = {
  stack_id: 4, logical_photo_count: 3, earliest_capture: '2024-03-15T12:00:00Z',
  has_raw: true, has_jpeg: true,
  thumbnail_path: '/home/user/.gem-keep/projects/iceland-2024/cache/thumbnails/4.jpg'
}

function setupNav() {
  navigate({ kind: 'stack-overview', projectSlug: 'iceland-2024', projectName: 'Iceland 2024' })
}

/**
 * Render StackOverview with sensible mock defaults.
 *
 * Sets up the initial loadAll() invoke chain (list_source_folders, list_stacks,
 * get_indexing_status) and automatically adds the follow-up mocks that loadAll()
 * triggers based on state (auto-start indexing, resume thumbnails, or polling).
 *
 * Tests only override what they need. Tests requiring specific mockResolvedValueOnce
 * chains (e.g. polling sequences, burst gap panel) should add those AFTER calling
 * this helper.
 */
function renderStackOverview(overrides?: Partial<{
  folders: SourceFolder[],
  stacks: StackSummary[],
  status: IndexingStatus,
  burstGap: number,
}>) {
  const folders = overrides?.folders ?? []
  const stacks = overrides?.stacks ?? []
  const status = overrides?.status ?? IDLE_STATUS

  // loadAll() core: list_source_folders, list_stacks, get_indexing_status
  mockInvoke.mockResolvedValueOnce(folders)
  mockInvoke.mockResolvedValueOnce(stacks)
  mockInvoke.mockResolvedValueOnce(status)

  // loadAll() follow-up mocks based on derived state:
  if (status.running || status.thumbnails_running) {
    // Path A: startPolling() fires immediately
    mockInvoke.mockResolvedValueOnce(IDLE_STATUS)  // poll: get_indexing_status (terminal)
    mockInvoke.mockResolvedValueOnce(stacks)       // poll: list_stacks (stops polling)
  } else if (folders.length > 0 && stacks.length === 0) {
    // Path B: auto-start indexing -> start_indexing + startPolling()
    mockInvoke.mockResolvedValueOnce(undefined)    // start_indexing
    mockInvoke.mockResolvedValueOnce(IDLE_STATUS)  // poll: get_indexing_status (terminal)
    mockInvoke.mockResolvedValueOnce(stacks)       // poll: list_stacks (stops polling)
  } else if (stacks.length > 0 && stacks.some(s => s.thumbnail_path === null)) {
    // Path C: resume thumbnails -> resume_thumbnails + startPolling()
    mockInvoke.mockResolvedValueOnce(undefined)    // resume_thumbnails
    mockInvoke.mockResolvedValueOnce(IDLE_STATUS)  // poll: get_indexing_status (terminal)
    mockInvoke.mockResolvedValueOnce(stacks)       // poll: list_stacks (stops polling)
  }
  // Path D: all thumbs present, idle -> no follow-up mocks needed

  return render(StackOverview)
}

beforeEach(() => {
  vi.clearAllMocks()
  setupNav()
  navigation.stackOverviewFocusIndex = null
})

describe('StackOverview — state 1: no source folders', () => {
  it('renders no-folders state when source_folders is empty', async () => {
    renderStackOverview()

    await waitFor(() => {
      expect(screen.getByText('No source folders attached.')).toBeInTheDocument()
    })
    expect(screen.getByText('+ Add Folder')).toBeInTheDocument()
    // No index button in state 1
    expect(screen.queryByText('Index Photos')).not.toBeInTheDocument()
  })
})

describe('StackOverview — state 2: folders attached, auto-starts indexing', () => {
  it('auto-starts indexing and shows folder paths during indexing', async () => {
    renderStackOverview({ folders: [FOLDER_A, FOLDER_B] })

    await waitFor(() => {
      expect(screen.getByText('/home/user/Photos/Iceland')).toBeInTheDocument()
    })
    expect(screen.getByText('/home/user/Photos/Drone')).toBeInTheDocument()
    // Verify start_indexing was called automatically (may be async, so waitFor)
    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('start_indexing', { slug: 'iceland-2024' })
    })
  })

  it('calls start_indexing automatically when folders present but no stacks', async () => {
    renderStackOverview({ folders: [FOLDER_A] })

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('start_indexing', { slug: 'iceland-2024' })
    })
  })

  it('does NOT auto-start when stacks already exist (re-open scenario)', async () => {
    renderStackOverview({ folders: [FOLDER_A], stacks: [STACK_1] })

    await waitFor(() => expect(screen.getByText('Index complete.')).toBeInTheDocument())
    expect(mockInvoke).not.toHaveBeenCalledWith('start_indexing', expect.anything())
  })

  it('does NOT auto-start when thumbnails_running=true even if stacks are empty', async () => {
    renderStackOverview({ folders: [FOLDER_A], status: THUMBNAIL_RUNNING_STATUS })

    await new Promise(resolve => setTimeout(resolve, 50))
    expect(mockInvoke).not.toHaveBeenCalledWith('start_indexing', expect.anything())
  })
})

describe('StackOverview — state 3: indexing in progress', () => {
  it('renders progress bar and cancel button during EXIF scan phase', async () => {
    // Custom mocks: keep RUNNING_STATUS in poll so "Indexing..." stays visible during assertion
    mockInvoke.mockResolvedValueOnce([FOLDER_A])    // list_source_folders
    mockInvoke.mockResolvedValueOnce([])            // list_stacks
    mockInvoke.mockResolvedValueOnce(RUNNING_STATUS) // get_indexing_status (status.running=true)
    mockInvoke.mockResolvedValueOnce(RUNNING_STATUS) // poll: get_indexing_status (still running)
    mockInvoke.mockResolvedValueOnce([])            // poll: list_stacks (running -> reload stacks)

    render(StackOverview)

    await waitFor(() => {
      expect(screen.getByText('Indexing…')).toBeInTheDocument()
    })
    expect(screen.getByText(/340.*1,290/)).toBeInTheDocument()
    expect(screen.getByText('Cancel')).toBeInTheDocument()
    // No x remove buttons while indexing
    expect(screen.queryByTitle('Remove folder')).not.toBeInTheDocument()
    // No Index Photos button
    expect(screen.queryByText('Index Photos')).not.toBeInTheDocument()
  })
})

describe('StackOverview — state 4 with thumbnails_running', () => {
  it('renders stacks grid and "Generating thumbnails…" when running=false and thumbnails_running=true', async () => {
    // Custom mocks: keep THUMBNAIL_RUNNING_STATUS in poll so banner stays visible during assertion
    mockInvoke.mockResolvedValueOnce([FOLDER_A])                    // list_source_folders
    mockInvoke.mockResolvedValueOnce([STACK_1, STACK_2, STACK_3])   // list_stacks
    mockInvoke.mockResolvedValueOnce(THUMBNAIL_RUNNING_STATUS)      // get_indexing_status
    mockInvoke.mockResolvedValueOnce(THUMBNAIL_RUNNING_STATUS)      // poll: get_indexing_status (still running)
    mockInvoke.mockResolvedValueOnce([STACK_1, STACK_2, STACK_3])   // poll: list_stacks

    render(StackOverview)

    await waitFor(() => {
      expect(screen.getByText('Stack #1')).toBeInTheDocument()
    })
    // Stacks grid is visible
    expect(screen.getByText('Stack #2')).toBeInTheDocument()
    expect(screen.getByText('Stack #3')).toBeInTheDocument()
    // Thumbnail generation banner is visible
    expect(screen.getByText('Generating thumbnails…')).toBeInTheDocument()
    expect(screen.getByText(/1,290 files indexed/)).toBeInTheDocument()
    // Index complete summary is also visible
    expect(screen.getByText('Index complete.')).toBeInTheDocument()
  })

})

describe('StackOverview — state 4: indexed, stacks visible', () => {
  it('renders stack grid after indexing completes', async () => {
    renderStackOverview({ folders: [FOLDER_A], stacks: [STACK_1, STACK_2, STACK_3], status: DONE_STATUS })

    await waitFor(() => {
      expect(screen.getByText('Index complete.')).toBeInTheDocument()
    })
    // Stack count is rendered in a separate child span
    const stackCountEl = screen.getByText((content, element) =>
      (element?.className?.includes('text-gray-100') ?? false) && content === '3'
    )
    expect(stackCountEl).toBeInTheDocument()
    // 3 stack cards
    expect(screen.getByText('Stack #1')).toBeInTheDocument()
    expect(screen.getByText('Stack #2')).toBeInTheDocument()
    expect(screen.getByText('Stack #3')).toBeInTheDocument()
  })

  it('renders placeholder icon for stacks without thumbnail', async () => {
    renderStackOverview({ folders: [FOLDER_A], stacks: [STACK_3], status: DONE_STATUS })

    await waitFor(() => {
      expect(screen.getByText('Stack #1')).toBeInTheDocument()
    })
    // Placeholder emoji present
    expect(screen.getByText('📷')).toBeInTheDocument()
    // No img element for this stack (no thumbnail)
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })

  it('renders Re-index button in state 4', async () => {
    renderStackOverview({ folders: [FOLDER_A], stacks: [STACK_1, STACK_2], status: DONE_STATUS })

    await waitFor(() => {
      expect(screen.getByText('Re-index')).toBeInTheDocument()
    })
  })

  it('renders img with src from getThumbnailUrl when thumbnail_path is set', async () => {
    const thumbPath = STACK_WITH_THUMB.thumbnail_path!
    vi.mocked(convertFileSrc).mockImplementation((p) => `asset://localhost${p}`)

    renderStackOverview({ folders: [FOLDER_A], stacks: [STACK_WITH_THUMB], status: DONE_STATUS })

    await waitFor(() => expect(screen.getByText('Stack #1')).toBeInTheDocument())

    const img = screen.getByRole('img')
    expect(img).toBeInTheDocument()
    expect(vi.mocked(convertFileSrc)).toHaveBeenCalledWith(thumbPath)
    expect(img).toHaveAttribute('src', `asset://localhost${thumbPath}`)
  })

  it('does not render img element when thumbnail_path is null', async () => {
    vi.mocked(convertFileSrc).mockImplementation((p) => `asset://localhost${p}`)

    renderStackOverview({ folders: [FOLDER_A], stacks: [STACK_3], status: DONE_STATUS })

    await waitFor(() => expect(screen.getByText('Stack #1')).toBeInTheDocument())
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(screen.getByText('📷')).toBeInTheDocument()
  })
})

describe('StackOverview — reindex shortcuts (state 4)', () => {
  it('r key triggers re-index when stacks present', async () => {
    renderStackOverview({ folders: [FOLDER_A], stacks: [STACK_1], status: DONE_STATUS })

    await waitFor(() => expect(screen.getByText('Index complete.')).toBeInTheDocument())

    mockInvoke.mockClear()
    mockInvoke.mockResolvedValueOnce(undefined)   // start_indexing
    mockInvoke.mockResolvedValueOnce(IDLE_STATUS) // get_indexing_status (immediate poll from startPolling)
    mockInvoke.mockResolvedValueOnce([STACK_1])   // list_stacks (poll reload when both flags false)

    fireEvent.keyDown(document, { key: 'r' })

    await waitFor(() => expect(mockInvoke).toHaveBeenCalledWith('start_indexing', { slug: 'iceland-2024' }))
  })

  it('i key triggers re-index when stacks already exist', async () => {
    renderStackOverview({ folders: [FOLDER_A], stacks: [STACK_1], status: DONE_STATUS })

    await waitFor(() => expect(screen.getByText('Index complete.')).toBeInTheDocument())

    mockInvoke.mockClear()
    mockInvoke.mockResolvedValueOnce(undefined)   // start_indexing
    mockInvoke.mockResolvedValueOnce(IDLE_STATUS) // get_indexing_status (immediate poll from startPolling)
    mockInvoke.mockResolvedValueOnce([STACK_1])   // list_stacks (poll reload when both flags false)

    fireEvent.keyDown(document, { key: 'i' })

    await waitFor(() => expect(mockInvoke).toHaveBeenCalledWith('start_indexing', { slug: 'iceland-2024' }))
  })
})

describe("StackOverview — add-folder workflow gap", () => {
  it("after adding a folder, indexing starts automatically", async () => {
    // Initial state: no folders, no stacks
    renderStackOverview()
    await waitFor(() => expect(screen.getByText("No source folders attached.")).toBeInTheDocument())

    // Setup mocks for after-add calls
    mockOpen.mockResolvedValueOnce("/home/user/Photos/NewAlbum")
    mockInvoke.mockResolvedValueOnce(undefined)    // add_source_folder
    mockInvoke.mockResolvedValueOnce([{ id: 1, path: "/home/user/Photos/NewAlbum" }]) // list_source_folders refresh
    mockInvoke.mockResolvedValueOnce(undefined)    // start_indexing (expected auto-start)
    mockInvoke.mockResolvedValueOnce(IDLE_STATUS)  // get_indexing_status (poll)
    mockInvoke.mockResolvedValueOnce([])           // list_stacks (poll)

    // Click "Add Folder"
    await fireEvent.click(screen.getByText("+ Add Folder"))

    // After adding the first folder, indexing should auto-start
    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("start_indexing", { slug: "iceland-2024" })
    }, { timeout: 500 })
  })
})

describe('StackOverview — scroll position restore', () => {
  it('restores focused card index when returning from StackFocus', async () => {
    const STACK_COUNT = 8
    const mockStacks: StackSummary[] = Array.from({ length: STACK_COUNT }, (_, i) => ({
      stack_id: i + 1,
      logical_photo_count: 1,
      earliest_capture: null,
      has_raw: false,
      has_jpeg: true,
      thumbnail_path: null,
    }))

    // Pre-set the saved focus index (simulating return from StackFocus)
    navigation.stackOverviewFocusIndex = 5

    renderStackOverview({ folders: [FOLDER_A], stacks: mockStacks, status: DONE_STATUS })

    await waitFor(() => {
      const cards = document.querySelectorAll('[data-stack-card]')
      expect(cards.length).toBe(STACK_COUNT)
    })

    // Card at index 5 must have the blue focus ring; card 0 must not
    const cards = document.querySelectorAll('[data-stack-card]')
    expect(cards[5].className).toContain('border-blue-500')
    expect(cards[0].className).not.toContain('border-blue-500')

    // The saved index must be cleared after use (no stale state)
    expect(navigation.stackOverviewFocusIndex).toBeNull()
  })
})

describe('StackOverview — thumbnail-ready event (Part C)', () => {
  it('C2: registers listen("thumbnail-ready") on mount', async () => {
    renderStackOverview({ folders: [FOLDER_A], stacks: [STACK_1], status: DONE_STATUS })

    await waitFor(() => expect(screen.getByText('Stack #1')).toBeInTheDocument())

    expect(mockListen).toHaveBeenCalledWith('thumbnail-ready', expect.any(Function))
  })

  it('C3: calls unlisten when component is destroyed', async () => {
    const mockUnlisten = vi.fn()
    mockListen.mockResolvedValueOnce(mockUnlisten as any)

    const { unmount } = renderStackOverview({ folders: [FOLDER_A], stacks: [STACK_1], status: DONE_STATUS })

    // Wait until listen has been called (meaning unlistenThumbnail is set)
    await waitFor(() => expect(mockListen).toHaveBeenCalledWith('thumbnail-ready', expect.any(Function)))

    unmount()

    expect(mockUnlisten).toHaveBeenCalled()
  })
})

const PROGRESS_STATUS: IndexingStatus = {
  running: false, thumbnails_running: true,
  total: 100, processed: 100, errors: 0, cancelled: false, paused: false,
  last_stats: null, thumbnails_total: 100, thumbnails_done: 42
}

const STACK_WITHOUT_THUMB: StackSummary = {
  stack_id: 10, logical_photo_count: 2, earliest_capture: '2024-03-15T09:00:00Z',
  has_raw: false, has_jpeg: true, thumbnail_path: null
}

describe('StackOverview — P2 resume thumbnails', () => {
  it('P2-07: calls resume_thumbnails when stacks exist with null thumbnail_path and idle status', async () => {
    renderStackOverview({ folders: [FOLDER_A], stacks: [STACK_WITHOUT_THUMB] })

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('resume_thumbnails', { slug: 'iceland-2024' })
    })
  })

  it('P2-08: does NOT call resume_thumbnails when all stacks have thumbnail_path', async () => {
    renderStackOverview({ folders: [FOLDER_A], stacks: [STACK_WITH_THUMB] })

    await waitFor(() => expect(screen.getByText('Index complete.')).toBeInTheDocument())
    expect(mockInvoke).not.toHaveBeenCalledWith('resume_thumbnails', expect.anything())
  })

  it('P2-09: does NOT call resume_thumbnails when stacks array is empty', async () => {
    renderStackOverview({ folders: [FOLDER_A] })

    await new Promise(resolve => setTimeout(resolve, 50))
    expect(mockInvoke).not.toHaveBeenCalledWith('resume_thumbnails', expect.anything())
  })

  it('P2-10: does NOT call resume_thumbnails when thumbnails_running is already true', async () => {
    renderStackOverview({ folders: [FOLDER_A], stacks: [STACK_WITHOUT_THUMB], status: THUMBNAIL_RUNNING_STATUS })

    await new Promise(resolve => setTimeout(resolve, 50))
    expect(mockInvoke).not.toHaveBeenCalledWith('resume_thumbnails', expect.anything())
  })
})

describe('StackOverview — P1 thumbnail progress bar', () => {
  it('P1-06: renders determinate progress bar when thumbnails_total > 0', async () => {
    // Custom mocks: keep PROGRESS_STATUS in poll so progress bar stays visible
    mockInvoke.mockResolvedValueOnce([FOLDER_A])    // list_source_folders
    mockInvoke.mockResolvedValueOnce([STACK_1, STACK_2]) // list_stacks
    mockInvoke.mockResolvedValueOnce(PROGRESS_STATUS)    // get_indexing_status
    mockInvoke.mockResolvedValueOnce(PROGRESS_STATUS)    // poll: get_indexing_status (still running)
    mockInvoke.mockResolvedValueOnce([STACK_1, STACK_2]) // poll: list_stacks

    const { container } = render(StackOverview)

    await waitFor(() => expect(screen.getByText('Generating thumbnails…')).toBeInTheDocument())
    // Count/total text
    expect(screen.getByText(/42.*100/)).toBeInTheDocument()
    // Percentage text
    expect(screen.getByText(/42%/)).toBeInTheDocument()
    // No spinner (determinate bar shown instead)
    expect(container.querySelector('.animate-spin')).not.toBeInTheDocument()
  })

  it('P1-07: renders spinner when thumbnails_total is 0 (pre-total window)', async () => {
    // Custom mocks: keep THUMBNAIL_RUNNING_STATUS in poll so spinner stays visible
    mockInvoke.mockResolvedValueOnce([FOLDER_A])
    mockInvoke.mockResolvedValueOnce([STACK_1])
    mockInvoke.mockResolvedValueOnce(THUMBNAIL_RUNNING_STATUS)  // thumbnails_total: 0
    mockInvoke.mockResolvedValueOnce(THUMBNAIL_RUNNING_STATUS)  // poll: get_indexing_status (still running)
    mockInvoke.mockResolvedValueOnce([STACK_1])                 // poll: list_stacks

    const { container } = render(StackOverview)

    await waitFor(() => expect(screen.getByText('Generating thumbnails…')).toBeInTheDocument())
    expect(container.querySelector('.animate-spin')).toBeInTheDocument()
    expect(screen.queryByText(/%/)).not.toBeInTheDocument()
  })

  it('P1-08: thumbnail progress indicator is never a static full-width pulsing bar', async () => {
    // Custom mocks: keep THUMBNAIL_RUNNING_STATUS in poll
    mockInvoke.mockResolvedValueOnce([FOLDER_A])
    mockInvoke.mockResolvedValueOnce([STACK_1])
    mockInvoke.mockResolvedValueOnce(THUMBNAIL_RUNNING_STATUS)
    mockInvoke.mockResolvedValueOnce(THUMBNAIL_RUNNING_STATUS)  // poll: get_indexing_status
    mockInvoke.mockResolvedValueOnce([STACK_1])                 // poll: list_stacks

    const { container } = render(StackOverview)

    await waitFor(() => expect(screen.getByText('Generating thumbnails…')).toBeInTheDocument())
    const pulsingEl = container.querySelector('.animate-pulse')
    if (pulsingEl) {
      expect(pulsingEl).not.toHaveClass('w-full')
    }
  })
})

describe('StackOverview — burst gap panel (BT-07..BT-11)', () => {
  async function setupWithStacks() {
    renderStackOverview({ folders: [FOLDER_A], stacks: [STACK_1, STACK_2] })
    await waitFor(() => expect(document.querySelectorAll('[data-stack-card]')).toHaveLength(2))
  }

  // BT-07
  it('test_ctrl_b_opens_burst_gap_panel', async () => {
    await setupWithStacks()
    mockInvoke.mockResolvedValueOnce(3)  // get_burst_gap
    await fireEvent.keyDown(document, { key: 'b', ctrlKey: true })
    await waitFor(() => {
      expect(screen.getByText(/burst gap/i)).toBeInTheDocument()
    })
  })

  // BT-07b
  it('test_ctrl_b_opens_panel_even_when_get_burst_gap_fails', async () => {
    await setupWithStacks()
    // getBurstGap rejects — panel must still open with default value
    mockInvoke.mockRejectedValueOnce(new Error('command not found'))
    await fireEvent.keyDown(document, { key: 'b', ctrlKey: true })
    await waitFor(() => {
      expect(screen.getByText(/burst gap/i)).toBeInTheDocument()
    })
    // Input should show fallback default value 3
    const input = screen.getByRole('spinbutton') as HTMLInputElement
    expect(Number(input.value)).toBe(3)
  })

  // BT-08
  it('test_save_burst_gap_calls_set_burst_gap', async () => {
    await setupWithStacks()
    mockInvoke.mockResolvedValueOnce(3)                   // get_burst_gap (on panel open)
    mockInvoke.mockResolvedValueOnce(undefined)           // set_burst_gap
    mockInvoke.mockResolvedValueOnce(undefined)           // restack
    mockInvoke.mockResolvedValueOnce([STACK_1, STACK_2])  // list_stacks (after restack)

    await fireEvent.keyDown(document, { key: 'b', ctrlKey: true })
    await waitFor(() => screen.getByText(/burst gap/i))

    const input = screen.getByRole('spinbutton')
    await fireEvent.change(input, { target: { value: '10' } })

    await fireEvent.click(screen.getByRole('button', { name: /save/i }))

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('set_burst_gap', { secs: 10 })
    })
  })

  // BT-09
  it('test_save_burst_gap_calls_restack', async () => {
    await setupWithStacks()
    mockInvoke.mockResolvedValueOnce(3)                   // get_burst_gap
    mockInvoke.mockResolvedValueOnce(undefined)           // set_burst_gap
    mockInvoke.mockResolvedValueOnce(undefined)           // restack
    mockInvoke.mockResolvedValueOnce([STACK_1, STACK_2])  // list_stacks

    await fireEvent.keyDown(document, { key: 'b', ctrlKey: true })
    await waitFor(() => screen.getByText(/burst gap/i))
    await fireEvent.click(screen.getByRole('button', { name: /save/i }))

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('restack', { slug: 'iceland-2024' })
    })
  })

  // BT-10
  it('test_panel_closes_after_restack', async () => {
    await setupWithStacks()
    mockInvoke.mockResolvedValueOnce(3)
    mockInvoke.mockResolvedValueOnce(undefined)           // set_burst_gap
    mockInvoke.mockResolvedValueOnce(undefined)           // restack
    mockInvoke.mockResolvedValueOnce([STACK_1, STACK_2])  // list_stacks

    await fireEvent.keyDown(document, { key: 'b', ctrlKey: true })
    await waitFor(() => screen.getByText(/burst gap/i))
    await fireEvent.click(screen.getByRole('button', { name: /save/i }))

    await waitFor(() => {
      expect(screen.queryByText(/burst gap/i)).not.toBeInTheDocument()
    })
  })

  // BT-11
  it('test_cancel_closes_panel_without_restack', async () => {
    await setupWithStacks()
    mockInvoke.mockResolvedValueOnce(3)  // get_burst_gap

    await fireEvent.keyDown(document, { key: 'b', ctrlKey: true })
    await waitFor(() => screen.getByText(/burst gap/i))
    await fireEvent.click(screen.getByRole('button', { name: /cancel/i }))

    await waitFor(() => {
      expect(screen.queryByText(/burst gap/i)).not.toBeInTheDocument()
    })
    expect(mockInvoke).not.toHaveBeenCalledWith('set_burst_gap', expect.anything())
    expect(mockInvoke).not.toHaveBeenCalledWith('restack', expect.anything())
  })
})

// ── TH-D1..TH-D3: thumbnail auto-resume tests ────────────────────────────────

const STACK_A_WITH_THUMB: StackSummary = {
  stack_id: 101, logical_photo_count: 3, earliest_capture: '2024-05-01T12:00:00Z',
  has_raw: false, has_jpeg: true, thumbnail_path: '/cache/thumbnails/1.jpg'
}
const STACK_B_WITH_THUMB: StackSummary = {
  stack_id: 102, logical_photo_count: 2, earliest_capture: '2024-05-01T13:00:00Z',
  has_raw: false, has_jpeg: true, thumbnail_path: '/cache/thumbnails/2.jpg'
}
const STACK_B_NO_THUMB: StackSummary = {
  ...STACK_B_WITH_THUMB, thumbnail_path: null
}

const THUMBS_DONE_STATUS: IndexingStatus = {
  running: false, thumbnails_running: false, total: 0, processed: 0, errors: 0, cancelled: false, paused: false, last_stats: null,
  thumbnails_total: 2, thumbnails_done: 2
}

describe('StackOverview — thumbnail auto-resume (TH-D1..TH-D3)', () => {
  // TH-D1
  it('TH-D1: no auto-resume when all stacks have thumbnails', async () => {
    renderStackOverview({
      folders: [{ id: 1, path: '/photos' }],
      stacks: [STACK_A_WITH_THUMB, STACK_B_WITH_THUMB],
      status: THUMBS_DONE_STATUS,
    })

    // Wait until stacks are visible
    await waitFor(() => {
      const cards = document.querySelectorAll('[data-stack-card]')
      expect(cards).toHaveLength(2)
    })

    // Give async effects time to flush
    await new Promise(resolve => setTimeout(resolve, 50))

    // resume_thumbnails must NOT have been called
    const calledCommands = mockInvoke.mock.calls.map(c => c[0])
    expect(calledCommands).not.toContain('resume_thumbnails')
  })

  // TH-D2
  it('TH-D2: auto-resume called when any stack is missing thumbnail', async () => {
    renderStackOverview({
      folders: [{ id: 1, path: '/photos' }],
      stacks: [STACK_A_WITH_THUMB, STACK_B_NO_THUMB],
      status: THUMBS_DONE_STATUS,
    })

    // Wait until resume_thumbnails is called
    await waitFor(() => {
      const calledCommands = mockInvoke.mock.calls.map(c => c[0])
      expect(calledCommands).toContain('resume_thumbnails')
    }, { timeout: 500 })
  })

  // TH-D3: After restack, saveBurstGap must NOT call resume_thumbnails.
  // Restack preserves thumbnails; the frontend should not re-trigger generation.
  it('TH-D3: saveBurstGap does NOT call resume_thumbnails when thumbnails exist', async () => {
    // Mount with stacks that already have thumbnails (all non-null) — no resume on mount
    const STACK_WITH_THUMB_LOCAL = { ...STACK_1, thumbnail_path: '/cache/1.jpg' } as StackSummary
    const STACK_WITH_THUMB_2 = { ...STACK_2, thumbnail_path: '/cache/2.jpg' } as StackSummary
    renderStackOverview({ folders: [FOLDER_A], stacks: [STACK_WITH_THUMB_LOCAL, STACK_WITH_THUMB_2] })
    await waitFor(() => expect(document.querySelectorAll('[data-stack-card]')).toHaveLength(2))

    // Confirm resume_thumbnails was NOT called on mount (all have thumbnails)
    expect(mockInvoke.mock.calls.map(c => c[0])).not.toContain('resume_thumbnails')

    // Open burst gap panel
    mockInvoke.mockResolvedValueOnce(3) // get_burst_gap
    await fireEvent.keyDown(document, { key: 'b', ctrlKey: true })
    await waitFor(() => expect(screen.getByText(/burst gap/i)).toBeInTheDocument())

    // saveBurstGap flow: setBurstGap -> restack -> listStacks (no resume_thumbnails)
    // Backend preserves thumbnails, so list_stacks returns stacks WITH thumbnails.
    mockInvoke.mockResolvedValueOnce(undefined)                                       // set_burst_gap
    mockInvoke.mockResolvedValueOnce(undefined)                                       // restack
    mockInvoke.mockResolvedValueOnce([STACK_WITH_THUMB_LOCAL, STACK_WITH_THUMB_2])    // list_stacks (thumbnails preserved)

    // Click Save
    await fireEvent.click(screen.getByRole('button', { name: /save/i }))

    // Wait for panel to close (saveBurstGap completed)
    await waitFor(() => {
      expect(screen.queryByText(/burst gap/i)).not.toBeInTheDocument()
    })

    // Allow any remaining async effects to flush
    await new Promise(resolve => setTimeout(resolve, 50))

    // saveBurstGap must NOT call resume_thumbnails.
    const calledCommands = mockInvoke.mock.calls.map(c => c[0])
    expect(calledCommands).not.toContain('resume_thumbnails')
  })

  // TH-D3b: When thumbnails are already being extracted (thumbnails_running=true),
  // saveBurstGap must NOT call resume_thumbnails (would restart/duplicate extraction).
  it('TH-D3b: saveBurstGap during thumbnail extraction does not restart extraction', async () => {
    // Mount with thumbnail-running status — stacks have null thumbnails (still generating)
    mockInvoke.mockReset()

    // Manual mount with THUMBNAIL_RUNNING_STATUS to keep thumbnails_running=true visible
    mockInvoke.mockResolvedValueOnce([FOLDER_A])                    // list_source_folders
    mockInvoke.mockResolvedValueOnce([STACK_1, STACK_2])            // list_stacks
    mockInvoke.mockResolvedValueOnce(THUMBNAIL_RUNNING_STATUS)      // get_indexing_status
    // Poll cycle: keep thumbnails_running so status stays active through burst panel interaction
    mockInvoke.mockResolvedValueOnce(THUMBNAIL_RUNNING_STATUS)      // poll: get_indexing_status (still running)
    mockInvoke.mockResolvedValueOnce([STACK_1, STACK_2])            // poll: list_stacks

    render(StackOverview)

    // Wait until stacks are visible
    await waitFor(() => expect(document.querySelectorAll('[data-stack-card]')).toHaveLength(2))

    // Confirm resume_thumbnails was NOT called on mount (status.thumbnails_running is true,
    // so loadAll takes Path A: startPolling, not Path C: resume)
    expect(mockInvoke.mock.calls.map(c => c[0])).not.toContain('resume_thumbnails')

    // Open burst gap panel
    mockInvoke.mockResolvedValueOnce(3) // get_burst_gap
    await fireEvent.keyDown(document, { key: 'b', ctrlKey: true })
    await waitFor(() => expect(screen.getByText(/burst gap/i)).toBeInTheDocument())

    // saveBurstGap flow: setBurstGap -> restack -> listStacks (no resume_thumbnails)
    mockInvoke.mockResolvedValueOnce(undefined)           // set_burst_gap
    mockInvoke.mockResolvedValueOnce(undefined)           // restack
    mockInvoke.mockResolvedValueOnce([STACK_1, STACK_2])  // list_stacks

    // Click Save
    await fireEvent.click(screen.getByRole('button', { name: /save/i }))

    // Wait for panel to close
    await waitFor(() => {
      expect(screen.queryByText(/burst gap/i)).not.toBeInTheDocument()
    })

    // Allow async effects to flush
    await new Promise(resolve => setTimeout(resolve, 50))

    // Collect all commands called
    const allCommands = mockInvoke.mock.calls.map(c => c[0])

    // resume_thumbnails must NOT be called (saveBurstGap no longer triggers it)
    // cancel_indexing must NOT be called (no reason to cancel ongoing work)
    expect(allCommands).not.toContain('resume_thumbnails')
    expect(allCommands).not.toContain('cancel_indexing')
  })
})
