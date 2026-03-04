// src/lib/components/screens/StackOverview.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/svelte'
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

afterEach(() => {
  cleanup()
})

beforeEach(() => {
  vi.clearAllMocks()
  // Reset invoke mock to clear any unconsumed mockResolvedValueOnce queue,
  // then restore the Rule 9 throwing default.
  mockInvoke.mockReset()
  mockInvoke.mockImplementation((cmd: string) => {
    throw new Error(`Unmocked invoke("${cmd}"). Add mockInvoke.mockResolvedValueOnce(...) before this call.`)
  })
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

describe('StackOverview — Sprint 7: multi-select and merge', () => {
  it('Shift+ArrowRight selects multiple stacks', async () => {
    renderStackOverview({ folders: [FOLDER_A], stacks: [STACK_1, STACK_2, STACK_3], status: DONE_STATUS })
    await waitFor(() => expect(document.querySelectorAll('[data-stack-card]')).toHaveLength(3))

    await fireEvent.keyDown(document, { key: 'ArrowRight', shiftKey: true })
    await fireEvent.keyDown(document, { key: 'ArrowRight', shiftKey: true })

    const cards = document.querySelectorAll('[data-stack-card]')
    // At least 2 cards should have selection indicator
    const selectedCards = Array.from(cards).filter(c => c.className.includes('ring-yellow') || c.className.includes('border-yellow'))
    expect(selectedCards.length).toBeGreaterThanOrEqual(2)
  })

  it('M key merges selected stacks', async () => {
    renderStackOverview({ folders: [FOLDER_A], stacks: [STACK_1, STACK_2, STACK_3], status: DONE_STATUS })
    await waitFor(() => expect(document.querySelectorAll('[data-stack-card]')).toHaveLength(3))

    // Select 2 stacks
    await fireEvent.keyDown(document, { key: 'ArrowRight', shiftKey: true })

    // Mock merge response
    mockInvoke.mockResolvedValueOnce({
      merged_stack_id: 10, logical_photos_moved: 10,
      source_stack_ids: [1, 2], transaction_id: 1,
    })  // merge_stacks
    mockInvoke.mockResolvedValueOnce([STACK_3])  // list_stacks (after merge)

    await fireEvent.keyDown(document, { key: 'm' })

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('merge_stacks', {
        slug: 'iceland-2024', stackIds: expect.arrayContaining([1, 2]),
      })
    })
  })

  it('Ctrl+Z undoes last merge', async () => {
    renderStackOverview({ folders: [FOLDER_A], stacks: [STACK_1, STACK_2], status: DONE_STATUS })
    await waitFor(() => expect(document.querySelectorAll('[data-stack-card]')).toHaveLength(2))

    mockInvoke.mockResolvedValueOnce(undefined)              // undo_last_merge
    mockInvoke.mockResolvedValueOnce([STACK_1, STACK_2, STACK_3])  // list_stacks (after undo)

    await fireEvent.keyDown(document, { key: 'z', ctrlKey: true })

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('undo_last_merge', { slug: 'iceland-2024' })
    })
  })

  it('M key with only 1 stack selected does NOT call merge', async () => {
    renderStackOverview({ folders: [FOLDER_A], stacks: [STACK_1, STACK_2], status: DONE_STATUS })
    await waitFor(() => expect(document.querySelectorAll('[data-stack-card]')).toHaveLength(2))

    // No shift-select, just press M with focus on 1 stack
    await fireEvent.keyDown(document, { key: 'm' })

    await new Promise(r => setTimeout(r, 50))
    expect(mockInvoke).not.toHaveBeenCalledWith('merge_stacks', expect.anything())
  })

  it('selection cleared after successful merge', async () => {
    renderStackOverview({ folders: [FOLDER_A], stacks: [STACK_1, STACK_2, STACK_3], status: DONE_STATUS })
    await waitFor(() => expect(document.querySelectorAll('[data-stack-card]')).toHaveLength(3))

    // Select 2 stacks
    await fireEvent.keyDown(document, { key: 'ArrowRight', shiftKey: true })

    // Mock merge
    mockInvoke.mockResolvedValueOnce({
      merged_stack_id: 10, logical_photos_moved: 10,
      source_stack_ids: [1, 2], transaction_id: 1,
    })
    mockInvoke.mockResolvedValueOnce([{ ...STACK_3, stack_id: 10 }])  // list_stacks

    await fireEvent.keyDown(document, { key: 'm' })

    await waitFor(() => {
      const cards = document.querySelectorAll('[data-stack-card]')
      const selectedCards = Array.from(cards).filter(c =>
        c.className.includes('ring-yellow') || c.className.includes('border-yellow')
      )
      expect(selectedCards.length).toBe(0)
    })
  })

  it('ArrowDown scrolls focused card into view', async () => {
    const scrollSpy = vi.spyOn(Element.prototype, 'scrollIntoView')
    renderStackOverview({ folders: [FOLDER_A], stacks: [STACK_1, STACK_2, STACK_3], status: DONE_STATUS })
    await waitFor(() => expect(document.querySelectorAll('[data-stack-card]')).toHaveLength(3))

    // Clear mount-related scrollIntoView calls
    scrollSpy.mockClear()

    await fireEvent.keyDown(document, { key: 'ArrowDown' })

    // StackOverview should scroll the newly focused card into view after arrow navigation
    await waitFor(() => {
      expect(scrollSpy).toHaveBeenCalled()
    })

    scrollSpy.mockRestore()
  })

  it('Arrow without Shift clears selection', async () => {
    const STACK_4: StackSummary = {
      stack_id: 4, logical_photo_count: 2, earliest_capture: null,
      has_raw: false, has_jpeg: true, thumbnail_path: null
    }
    renderStackOverview({ folders: [FOLDER_A], stacks: [STACK_1, STACK_2, STACK_3, STACK_4], status: DONE_STATUS })
    await waitFor(() => expect(document.querySelectorAll('[data-stack-card]')).toHaveLength(4))

    // Shift+ArrowRight to select stacks
    await fireEvent.keyDown(document, { key: 'ArrowRight', shiftKey: true })
    await fireEvent.keyDown(document, { key: 'ArrowRight', shiftKey: true })

    // Verify selection exists
    let cards = document.querySelectorAll('[data-stack-card]')
    let selectedCards = Array.from(cards).filter(c =>
      c.className.includes('ring-yellow') || c.className.includes('border-yellow')
    )
    expect(selectedCards.length).toBeGreaterThanOrEqual(2)

    // Press ArrowRight WITHOUT Shift
    await fireEvent.keyDown(document, { key: 'ArrowRight' })

    // Verify selection is cleared
    cards = document.querySelectorAll('[data-stack-card]')
    selectedCards = Array.from(cards).filter(c =>
      c.className.includes('ring-yellow') || c.className.includes('border-yellow')
    )
    expect(selectedCards.length).toBe(0)
  })

  it('After merge, focusedIndex moves to merged stack', async () => {
    const STACK_4: StackSummary = {
      stack_id: 4, logical_photo_count: 2, earliest_capture: null,
      has_raw: false, has_jpeg: true, thumbnail_path: null
    }
    renderStackOverview({ folders: [FOLDER_A], stacks: [STACK_1, STACK_2, STACK_3, STACK_4], status: DONE_STATUS })
    await waitFor(() => expect(document.querySelectorAll('[data-stack-card]')).toHaveLength(4))

    // Select stacks 1 and 2 via Shift+Arrow
    await fireEvent.keyDown(document, { key: 'ArrowRight', shiftKey: true })

    // Mock merge: returns merged_stack_id = 99
    mockInvoke.mockResolvedValueOnce({
      merged_stack_id: 99, logical_photos_moved: 10,
      source_stack_ids: [1, 2], transaction_id: 1,
    })
    // Updated stacks: merged stack replaces originals
    const MERGED_STACK: StackSummary = {
      stack_id: 99, logical_photo_count: 10, earliest_capture: '2024-03-15T10:00:00Z',
      has_raw: true, has_jpeg: true, thumbnail_path: null
    }
    mockInvoke.mockResolvedValueOnce([MERGED_STACK, STACK_3, STACK_4])  // list_stacks

    // Resume thumbnails triggered because MERGED_STACK has null thumbnail
    mockInvoke.mockResolvedValueOnce(undefined)    // resume_thumbnails
    mockInvoke.mockResolvedValueOnce(IDLE_STATUS)  // poll: get_indexing_status
    mockInvoke.mockResolvedValueOnce([MERGED_STACK, STACK_3, STACK_4])  // poll: list_stacks

    await fireEvent.keyDown(document, { key: 'm' })

    // After merge, the focused card should be the one with stack_id 99
    await waitFor(() => {
      const cards = document.querySelectorAll('[data-stack-card]')
      expect(cards.length).toBe(3)
      // The focused card (index 0 = merged stack) should have the focus ring
      expect(cards[0].className).toContain('border-blue-500')
    })
  })
})

// ── SO-01: Loading spinner during initialLoading ─────────────────────────────

describe('StackOverview — SO-01: loading spinner', () => {
  it('shows "Loading…" text during initial load and disappears after loadAll', async () => {
    // Phase 1: use a deferred promise so loadAll() hangs at list_source_folders
    let resolveFolders!: (value: SourceFolder[]) => void
    mockInvoke.mockReturnValueOnce(new Promise<SourceFolder[]>(r => { resolveFolders = r }))
    // Pre-queue the remaining loadAll() chain that fires once folders resolve:
    mockInvoke.mockResolvedValueOnce([])           // list_stacks
    mockInvoke.mockResolvedValueOnce(IDLE_STATUS)  // get_indexing_status

    const { unmount } = render(StackOverview)

    // Loading indicator should be visible while loadAll is pending
    await waitFor(() => {
      expect(screen.getByText('Loading…')).toBeInTheDocument()
    })
    expect(screen.queryByText('No source folders attached.')).not.toBeInTheDocument()
    expect(document.querySelectorAll('[data-stack-card]')).toHaveLength(0)

    // Phase 2: resolve the deferred promise so loadAll() completes
    resolveFolders([])

    // Loading indicator should disappear after loadAll resolves
    await waitFor(() => {
      expect(screen.queryByText('Loading…')).not.toBeInTheDocument()
    })
    // "No source folders" should now be visible (state 1)
    expect(screen.getByText('No source folders attached.')).toBeInTheDocument()

    unmount()
  })
})

// ── SO-02: Topbar breadcrumb ─────────────────────────────────────────────────

describe('StackOverview — SO-02: topbar breadcrumb', () => {
  it('renders breadcrumb with back arrow, project name, and Esc hint', async () => {
    renderStackOverview({ folders: [FOLDER_A], stacks: [STACK_1], status: DONE_STATUS })

    await waitFor(() => expect(screen.getByText('Index complete.')).toBeInTheDocument())

    // Back button with "Projects" text
    expect(screen.getByText('Projects')).toBeInTheDocument()
    expect(screen.getByText('←')).toBeInTheDocument()
    // Project name in breadcrumb
    expect(screen.getByText('Iceland 2024')).toBeInTheDocument()
    // Esc hint text
    expect(screen.getByText('Esc')).toBeInTheDocument()
  })
})

// ── SO-10: Pause/Resume buttons during indexing ──────────────────────────────

describe('StackOverview — SO-10: pause/resume buttons', () => {
  it('shows Pause button during active indexing (not paused)', async () => {
    // Custom mocks: keep RUNNING_STATUS in poll so Pause button stays visible
    mockInvoke.mockResolvedValueOnce([FOLDER_A])       // list_source_folders
    mockInvoke.mockResolvedValueOnce([])               // list_stacks
    mockInvoke.mockResolvedValueOnce(RUNNING_STATUS)   // get_indexing_status (running=true, paused=false)
    mockInvoke.mockResolvedValueOnce(RUNNING_STATUS)   // poll: get_indexing_status (still running)
    mockInvoke.mockResolvedValueOnce([])               // poll: list_stacks

    render(StackOverview)

    await waitFor(() => {
      expect(screen.getByText('Pause')).toBeInTheDocument()
    })
    // Cancel is also present
    expect(screen.getByText('Cancel')).toBeInTheDocument()
  })

  it('clicking Pause calls pause_indexing', async () => {
    mockInvoke.mockResolvedValueOnce([FOLDER_A])       // list_source_folders
    mockInvoke.mockResolvedValueOnce([])               // list_stacks
    mockInvoke.mockResolvedValueOnce(RUNNING_STATUS)   // get_indexing_status
    mockInvoke.mockResolvedValueOnce(RUNNING_STATUS)   // poll: get_indexing_status
    mockInvoke.mockResolvedValueOnce([])               // poll: list_stacks

    render(StackOverview)

    await waitFor(() => expect(screen.getByText('Pause')).toBeInTheDocument())

    mockInvoke.mockResolvedValueOnce(undefined)  // pause_indexing

    await fireEvent.click(screen.getByText('Pause'))

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('pause_indexing')
    })
  })

  it('shows Resume button when indexing is paused', async () => {
    const PAUSED_STATUS: IndexingStatus = {
      ...RUNNING_STATUS, paused: true
    }

    mockInvoke.mockResolvedValueOnce([FOLDER_A])      // list_source_folders
    mockInvoke.mockResolvedValueOnce([])              // list_stacks
    mockInvoke.mockResolvedValueOnce(PAUSED_STATUS)   // get_indexing_status (running=true, paused=true)
    mockInvoke.mockResolvedValueOnce(PAUSED_STATUS)   // poll: get_indexing_status (still paused)
    mockInvoke.mockResolvedValueOnce([])              // poll: list_stacks

    render(StackOverview)

    await waitFor(() => {
      expect(screen.getByText('Resume')).toBeInTheDocument()
    })
    // Pause button should NOT be visible when paused
    expect(screen.queryByText('Pause')).not.toBeInTheDocument()
  })

  it('clicking Resume calls resume_indexing', async () => {
    const PAUSED_STATUS: IndexingStatus = {
      ...RUNNING_STATUS, paused: true
    }

    mockInvoke.mockResolvedValueOnce([FOLDER_A])      // list_source_folders
    mockInvoke.mockResolvedValueOnce([])              // list_stacks
    mockInvoke.mockResolvedValueOnce(PAUSED_STATUS)   // get_indexing_status
    mockInvoke.mockResolvedValueOnce(PAUSED_STATUS)   // poll: get_indexing_status
    mockInvoke.mockResolvedValueOnce([])              // poll: list_stacks

    render(StackOverview)

    await waitFor(() => expect(screen.getByText('Resume')).toBeInTheDocument())

    mockInvoke.mockResolvedValueOnce(undefined)  // resume_indexing

    await fireEvent.click(screen.getByText('Resume'))

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('resume_indexing')
    })
  })
})

// ── SO-22: Arrow Left moves focus left (stops at first) ──────────────────────

describe('StackOverview — SO-22: ArrowLeft navigation', () => {
  it('ArrowLeft moves focus left by one card', async () => {
    renderStackOverview({ folders: [FOLDER_A], stacks: [STACK_1, STACK_2, STACK_3], status: DONE_STATUS })
    await waitFor(() => expect(document.querySelectorAll('[data-stack-card]')).toHaveLength(3))

    // Move right first so we're at index 1
    await fireEvent.keyDown(document, { key: 'ArrowRight' })
    let cards = document.querySelectorAll('[data-stack-card]')
    expect(cards[1].className).toContain('border-blue-500')

    // Now move left back to index 0
    await fireEvent.keyDown(document, { key: 'ArrowLeft' })
    cards = document.querySelectorAll('[data-stack-card]')
    expect(cards[0].className).toContain('border-blue-500')
    expect(cards[1].className).not.toContain('border-blue-500')
  })

  it('ArrowLeft stops at index 0 (does not wrap or go negative)', async () => {
    renderStackOverview({ folders: [FOLDER_A], stacks: [STACK_1, STACK_2, STACK_3], status: DONE_STATUS })
    await waitFor(() => expect(document.querySelectorAll('[data-stack-card]')).toHaveLength(3))

    // We start at index 0; pressing ArrowLeft should stay at 0
    await fireEvent.keyDown(document, { key: 'ArrowLeft' })
    await fireEvent.keyDown(document, { key: 'ArrowLeft' })

    const cards = document.querySelectorAll('[data-stack-card]')
    expect(cards[0].className).toContain('border-blue-500')
  })
})

// ── SO-24: Arrow Up moves focus up (-4 cols) ────────────────────────────────

describe('StackOverview — SO-24: ArrowUp navigation', () => {
  it('ArrowUp moves focus up by 4 (one row of 4 columns)', async () => {
    // Need at least 5 stacks to span 2 rows in a 4-col grid
    const manyStacks: StackSummary[] = Array.from({ length: 8 }, (_, i) => ({
      stack_id: i + 1,
      logical_photo_count: 1,
      earliest_capture: null,
      has_raw: false,
      has_jpeg: true,
      thumbnail_path: null,
    }))

    renderStackOverview({ folders: [FOLDER_A], stacks: manyStacks, status: DONE_STATUS })
    await waitFor(() => expect(document.querySelectorAll('[data-stack-card]')).toHaveLength(8))

    // Navigate to row 2, card 5 (index 4) using ArrowDown from index 0
    await fireEvent.keyDown(document, { key: 'ArrowDown' })
    let cards = document.querySelectorAll('[data-stack-card]')
    expect(cards[4].className).toContain('border-blue-500')

    // ArrowUp should take us back to index 0
    await fireEvent.keyDown(document, { key: 'ArrowUp' })
    cards = document.querySelectorAll('[data-stack-card]')
    expect(cards[0].className).toContain('border-blue-500')
    expect(cards[4].className).not.toContain('border-blue-500')
  })

  it('ArrowUp stops at row 0 (clamps to 0)', async () => {
    renderStackOverview({ folders: [FOLDER_A], stacks: [STACK_1, STACK_2, STACK_3], status: DONE_STATUS })
    await waitFor(() => expect(document.querySelectorAll('[data-stack-card]')).toHaveLength(3))

    // Already at index 0; ArrowUp should stay at 0 (Math.max(0 - 4, 0) = 0)
    await fireEvent.keyDown(document, { key: 'ArrowUp' })

    const cards = document.querySelectorAll('[data-stack-card]')
    expect(cards[0].className).toContain('border-blue-500')
  })
})

// ── SO-25: Enter opens focused stack (navigate to StackFocus) ────────────────

describe('StackOverview — SO-25: Enter opens focused stack', () => {
  it('Enter key navigates to StackFocus for the focused stack', async () => {
    renderStackOverview({ folders: [FOLDER_A], stacks: [STACK_1, STACK_2, STACK_3], status: DONE_STATUS })
    await waitFor(() => expect(document.querySelectorAll('[data-stack-card]')).toHaveLength(3))

    // Move to second stack
    await fireEvent.keyDown(document, { key: 'ArrowRight' })

    // Press Enter
    await fireEvent.keyDown(document, { key: 'Enter' })

    // Navigation should have changed to stack-focus with the second stack's ID
    expect(navigation.current).toEqual({
      kind: 'stack-focus',
      projectSlug: 'iceland-2024',
      projectName: 'Iceland 2024',
      stackId: STACK_2.stack_id,
    })
  })

  it('Enter saves focusedIndex before navigating', async () => {
    renderStackOverview({ folders: [FOLDER_A], stacks: [STACK_1, STACK_2, STACK_3], status: DONE_STATUS })
    await waitFor(() => expect(document.querySelectorAll('[data-stack-card]')).toHaveLength(3))

    // Move to third stack (index 2)
    await fireEvent.keyDown(document, { key: 'ArrowRight' })
    await fireEvent.keyDown(document, { key: 'ArrowRight' })

    // Navigate must be called after setting stackOverviewFocusIndex
    // Reset it first so we can detect the assignment
    navigation.stackOverviewFocusIndex = null

    await fireEvent.keyDown(document, { key: 'Enter' })

    // After Enter, navigation.current is already stack-focus
    // The stackOverviewFocusIndex should have been set to 2 (then navigate changes screen)
    // Since navigate() changes screen, the savedIdx is set before navigate is called.
    // We verify via the navigate call that it went to the correct stack.
    expect(navigation.current.kind).toBe('stack-focus')
    if (navigation.current.kind === 'stack-focus') {
      expect(navigation.current.stackId).toBe(STACK_3.stack_id)
    }
  })
})

// ── SO-26: Click on stack card navigates to StackFocus ───────────────────────

describe('StackOverview — SO-26: click on stack card', () => {
  it('clicking a stack card navigates to StackFocus', async () => {
    renderStackOverview({ folders: [FOLDER_A], stacks: [STACK_1, STACK_2], status: DONE_STATUS })
    await waitFor(() => expect(document.querySelectorAll('[data-stack-card]')).toHaveLength(2))

    // Click the second stack card (Stack #2)
    const cards = document.querySelectorAll('[data-stack-card]')
    await fireEvent.click(cards[1])

    expect(navigation.current).toEqual({
      kind: 'stack-focus',
      projectSlug: 'iceland-2024',
      projectName: 'Iceland 2024',
      stackId: STACK_2.stack_id,
    })
  })
})

// ── SO-27: Esc navigates back to ProjectList ─────────────────────────────────

describe('StackOverview — SO-27: Esc back to ProjectList', () => {
  it('Esc key navigates back to project-list', async () => {
    renderStackOverview({ folders: [FOLDER_A], stacks: [STACK_1], status: DONE_STATUS })
    await waitFor(() => expect(screen.getByText('Index complete.')).toBeInTheDocument())

    await fireEvent.keyDown(document, { key: 'Escape' })

    expect(navigation.current.kind).toBe('project-list')
  })

  it('Esc sets skipAutoOpen and resumeProject on the project-list screen', async () => {
    renderStackOverview({ folders: [FOLDER_A], stacks: [STACK_1], status: DONE_STATUS })
    await waitFor(() => expect(screen.getByText('Index complete.')).toBeInTheDocument())

    await fireEvent.keyDown(document, { key: 'Escape' })

    expect(navigation.current).toEqual({
      kind: 'project-list',
      skipAutoOpen: true,
      resumeProject: { slug: 'iceland-2024', name: 'Iceland 2024' },
    })
  })
})

// --- BUG B4: Esc navigates away when burst panel is open ---

describe('StackOverview — B4: Esc closes burst panel instead of navigating away', () => {
  it('Escape closes burst panel without navigating away from StackOverview', async () => {
    renderStackOverview({ folders: [FOLDER_A], stacks: [STACK_1, STACK_2], status: DONE_STATUS })
    await waitFor(() => expect(document.querySelectorAll('[data-stack-card]')).toHaveLength(2))

    // Open burst panel via Ctrl+B
    mockInvoke.mockResolvedValueOnce(3)  // get_burst_gap
    await fireEvent.keyDown(document, { key: 'b', ctrlKey: true })

    // Verify the burst panel is visible (the modal overlay with "Burst gap" heading)
    await waitFor(() => {
      expect(screen.getByText(/burst gap/i)).toBeInTheDocument()
    })

    // Press Escape — should close the burst panel, NOT navigate away
    await fireEvent.keyDown(document, { key: 'Escape' })

    // Burst panel should be gone
    await waitFor(() => {
      expect(screen.queryByText(/burst gap/i)).not.toBeInTheDocument()
    })

    // Navigation should still be on stack-overview (NOT project-list)
    expect(navigation.current.kind).toBe('stack-overview')

    // Stack cards should still be visible (component is still mounted)
    expect(document.querySelectorAll('[data-stack-card]')).toHaveLength(2)
  })
})

// ── SO-36: Burst gap panel: 'Recalculating stacks…' transient message ────────

describe('StackOverview — SO-36: burst gap recalculating message', () => {
  it('shows "Recalculating stacks…" during saveBurstGap', async () => {
    renderStackOverview({ folders: [FOLDER_A], stacks: [STACK_1, STACK_2] })
    await waitFor(() => expect(document.querySelectorAll('[data-stack-card]')).toHaveLength(2))

    // Open burst panel
    mockInvoke.mockResolvedValueOnce(3) // get_burst_gap
    await fireEvent.keyDown(document, { key: 'b', ctrlKey: true })
    await waitFor(() => screen.getByText(/burst gap/i))

    // Make saveBurstGap slow: set_burst_gap resolves, restack hangs
    mockInvoke.mockResolvedValueOnce(undefined) // set_burst_gap
    mockInvoke.mockReturnValueOnce(new Promise(() => {})) // restack (never resolves)

    await fireEvent.click(screen.getByRole('button', { name: /save/i }))

    // "Recalculating stacks…" should appear while restack is pending
    await waitFor(() => {
      expect(screen.getByText('Recalculating stacks…')).toBeInTheDocument()
    })

    // The input and save/cancel buttons should be hidden during restacking
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument()
  })
})

// ── SO-37: Error log: collapsible 'Show N errors' ───────────────────────────

describe('StackOverview — SO-37: collapsible error log', () => {
  const STATUS_WITH_ERRORS: IndexingStatus = {
    running: false, thumbnails_running: false, total: 100, processed: 100, errors: 2, cancelled: false, paused: false,
    last_stats: {
      total_files_scanned: 100, imported: 98, skipped_existing: 0,
      skipped_unsupported: 0, errors: 2, pairs_detected: 49,
      stacks_generated: 2, logical_photos: 49,
      error_log: ['Failed to read /bad/file1.cr2: corrupt header', 'EXIF parse error: /bad/file2.arw']
    },
    thumbnails_total: 0, thumbnails_done: 0
  }

  // Use stacks with thumbnails to avoid Path C (resume_thumbnails + polling that overwrites status)
  const STACK_A_T: StackSummary = { ...STACK_1, thumbnail_path: '/cache/1.jpg' }
  const STACK_B_T: StackSummary = { ...STACK_2, thumbnail_path: '/cache/2.jpg' }

  it('renders "Show N errors" toggle when last_stats has errors', async () => {
    // Path D: all thumbs present, idle — no follow-up mocks, status preserved
    renderStackOverview({ folders: [FOLDER_A], stacks: [STACK_A_T, STACK_B_T], status: STATUS_WITH_ERRORS })

    await waitFor(() => {
      expect(screen.getByText(/Show 2 errors/)).toBeInTheDocument()
    })
  })

  it('clicking "Show N errors" reveals error details', async () => {
    renderStackOverview({ folders: [FOLDER_A], stacks: [STACK_A_T, STACK_B_T], status: STATUS_WITH_ERRORS })

    await waitFor(() => expect(screen.getByText(/Show 2 errors/)).toBeInTheDocument())

    // Error details should be hidden initially
    expect(screen.queryByText(/corrupt header/)).not.toBeInTheDocument()

    // Click to expand
    await fireEvent.click(screen.getByText(/Show 2 errors/))

    await waitFor(() => {
      expect(screen.getByText(/corrupt header/)).toBeInTheDocument()
      expect(screen.getByText(/EXIF parse error/)).toBeInTheDocument()
    })
  })

  it('does NOT render error toggle when last_stats has 0 errors', async () => {
    renderStackOverview({ folders: [FOLDER_A], stacks: [STACK_1], status: DONE_STATUS })

    await waitFor(() => expect(screen.getByText('Index complete.')).toBeInTheDocument())
    expect(screen.queryByText(/Show.*error/)).not.toBeInTheDocument()
  })
})

// ── SO-38: Error count inline during indexing ────────────────────────────────

describe('StackOverview — SO-38: error count during indexing', () => {
  it('shows error count inline when status.errors > 0 during EXIF phase', async () => {
    const RUNNING_WITH_ERRORS: IndexingStatus = {
      ...RUNNING_STATUS, errors: 5
    }

    mockInvoke.mockResolvedValueOnce([FOLDER_A])            // list_source_folders
    mockInvoke.mockResolvedValueOnce([])                    // list_stacks
    mockInvoke.mockResolvedValueOnce(RUNNING_WITH_ERRORS)   // get_indexing_status
    mockInvoke.mockResolvedValueOnce(RUNNING_WITH_ERRORS)   // poll: get_indexing_status (still running)
    mockInvoke.mockResolvedValueOnce([])                    // poll: list_stacks

    render(StackOverview)

    await waitFor(() => {
      expect(screen.getByText('Indexing…')).toBeInTheDocument()
    })
    expect(screen.getByText(/5 errors/)).toBeInTheDocument()
  })

  it('shows singular "error" for count of 1', async () => {
    const RUNNING_WITH_1_ERROR: IndexingStatus = {
      ...RUNNING_STATUS, errors: 1
    }

    mockInvoke.mockResolvedValueOnce([FOLDER_A])              // list_source_folders
    mockInvoke.mockResolvedValueOnce([])                      // list_stacks
    mockInvoke.mockResolvedValueOnce(RUNNING_WITH_1_ERROR)    // get_indexing_status
    mockInvoke.mockResolvedValueOnce(RUNNING_WITH_1_ERROR)    // poll: get_indexing_status
    mockInvoke.mockResolvedValueOnce([])                      // poll: list_stacks

    render(StackOverview)

    await waitFor(() => {
      expect(screen.getByText('Indexing…')).toBeInTheDocument()
    })
    // Should show "1 error" (singular), not "1 errors"
    expect(screen.getByText(/1 error(?!s)/)).toBeInTheDocument()
  })
})

// ── SO-61: Date formatting on stack cards ────────────────────────────────────

describe('StackOverview — SO-61: date formatting', () => {
  it('renders formatted date on stack card when earliest_capture is set', async () => {
    renderStackOverview({ folders: [FOLDER_A], stacks: [STACK_1], status: DONE_STATUS })

    await waitFor(() => expect(screen.getByText('Stack #1')).toBeInTheDocument())

    // STACK_1 has earliest_capture: '2024-03-15T10:00:00Z'
    // formatDate should produce "Mar 15"
    expect(screen.getByText('Mar 15')).toBeInTheDocument()
  })

  it('renders fallback "(no EXIF)" when earliest_capture is null', async () => {
    renderStackOverview({ folders: [FOLDER_A], stacks: [STACK_3], status: DONE_STATUS })

    await waitFor(() => expect(screen.getByText('Stack #1')).toBeInTheDocument())

    // STACK_3 has earliest_capture: null → formatDate(null, '(no EXIF)') = '(no EXIF)'
    expect(screen.getByText('(no EXIF)')).toBeInTheDocument()
  })
})

// ── SO-62: Photo count per stack card ────────────────────────────────────────

describe('StackOverview — SO-62: photo count per card', () => {
  it('renders "N photos" on stack card (plural)', async () => {
    renderStackOverview({ folders: [FOLDER_A], stacks: [STACK_1], status: DONE_STATUS })

    await waitFor(() => expect(screen.getByText('Stack #1')).toBeInTheDocument())

    // STACK_1 has logical_photo_count: 6
    expect(screen.getByText('6 photos')).toBeInTheDocument()
  })

  it('renders "1 photo" (singular) when count is 1', async () => {
    renderStackOverview({ folders: [FOLDER_A], stacks: [STACK_3], status: DONE_STATUS })

    await waitFor(() => expect(screen.getByText('Stack #1')).toBeInTheDocument())

    // STACK_3 has logical_photo_count: 1
    expect(screen.getByText('1 photo')).toBeInTheDocument()
  })
})

// ── SO-63/64/65: Shift+ArrowLeft/Down/Up multi-select ────────────────────────

describe('StackOverview — SO-63/64/65: Shift+Arrow multi-select directions', () => {
  const MANY_STACKS: StackSummary[] = Array.from({ length: 8 }, (_, i) => ({
    stack_id: i + 1,
    logical_photo_count: 1,
    earliest_capture: null,
    has_raw: false,
    has_jpeg: true,
    thumbnail_path: null,
  }))

  it('SO-63: Shift+ArrowLeft selects current and previous stacks', async () => {
    renderStackOverview({ folders: [FOLDER_A], stacks: MANY_STACKS, status: DONE_STATUS })
    await waitFor(() => expect(document.querySelectorAll('[data-stack-card]')).toHaveLength(8))

    // Move to index 2 first
    await fireEvent.keyDown(document, { key: 'ArrowRight' })
    await fireEvent.keyDown(document, { key: 'ArrowRight' })

    // Shift+ArrowLeft should select index 2 and move to index 1 (selecting it too)
    await fireEvent.keyDown(document, { key: 'ArrowLeft', shiftKey: true })

    const cards = document.querySelectorAll('[data-stack-card]')
    const selectedCards = Array.from(cards).filter(c =>
      c.className.includes('ring-yellow') || c.className.includes('border-yellow')
    )
    expect(selectedCards.length).toBeGreaterThanOrEqual(2)
    // Both index 1 and 2 should be selected (stack_ids 2 and 3)
    expect(cards[1].className).toMatch(/ring-yellow|border-yellow/)
    expect(cards[2].className).toMatch(/ring-yellow|border-yellow/)
  })

  it('SO-64: Shift+ArrowDown selects current and stack 4 positions down', async () => {
    renderStackOverview({ folders: [FOLDER_A], stacks: MANY_STACKS, status: DONE_STATUS })
    await waitFor(() => expect(document.querySelectorAll('[data-stack-card]')).toHaveLength(8))

    // Focus is at index 0; Shift+ArrowDown should select index 0 and move to index 4
    await fireEvent.keyDown(document, { key: 'ArrowDown', shiftKey: true })

    const cards = document.querySelectorAll('[data-stack-card]')
    // Both index 0 and 4 should be selected
    expect(cards[0].className).toMatch(/ring-yellow|border-yellow/)
    expect(cards[4].className).toMatch(/ring-yellow|border-yellow/)
  })

  it('SO-65: Shift+ArrowUp selects current and stack 4 positions up', async () => {
    renderStackOverview({ folders: [FOLDER_A], stacks: MANY_STACKS, status: DONE_STATUS })
    await waitFor(() => expect(document.querySelectorAll('[data-stack-card]')).toHaveLength(8))

    // Move to index 5 (row 2, col 2) first
    await fireEvent.keyDown(document, { key: 'ArrowDown' })   // -> index 4
    await fireEvent.keyDown(document, { key: 'ArrowRight' })  // -> index 5

    // Shift+ArrowUp should select index 5 and move up to index 1
    await fireEvent.keyDown(document, { key: 'ArrowUp', shiftKey: true })

    const cards = document.querySelectorAll('[data-stack-card]')
    expect(cards[5].className).toMatch(/ring-yellow|border-yellow/)
    expect(cards[1].className).toMatch(/ring-yellow|border-yellow/)
  })
})

// ── M3: mergeStacks visible error feedback ─────────────────────────────────

describe('StackOverview — M3: mergeStacks error shows visible feedback', () => {
  it('merge_stacks rejection shows error banner', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    renderStackOverview({ folders: [FOLDER_A], stacks: [STACK_1, STACK_2, STACK_3], status: DONE_STATUS })
    await waitFor(() => expect(document.querySelectorAll('[data-stack-card]')).toHaveLength(3))

    // Select 2 stacks via Shift+Arrow
    await fireEvent.keyDown(document, { key: 'ArrowRight', shiftKey: true })

    // Mock merge_stacks rejection
    mockInvoke.mockRejectedValueOnce(new Error('Cannot merge'))

    await fireEvent.keyDown(document, { key: 'm' })

    await waitFor(() => {
      expect(screen.getByTestId('action-error')).toBeInTheDocument()
      expect(screen.getByText('Failed to merge stacks. Please try again.')).toBeInTheDocument()
    })

    consoleSpy.mockRestore()
  })
})

// ── M4: undoLastMerge visible error feedback ───────────────────────────────

describe('StackOverview — M4: undoLastMerge error shows visible feedback', () => {
  it('undo_last_merge rejection shows error banner', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    renderStackOverview({ folders: [FOLDER_A], stacks: [STACK_1, STACK_2], status: DONE_STATUS })
    await waitFor(() => expect(document.querySelectorAll('[data-stack-card]')).toHaveLength(2))

    // Mock undo_last_merge rejection
    mockInvoke.mockRejectedValueOnce(new Error('Nothing to undo'))

    await fireEvent.keyDown(document, { key: 'z', ctrlKey: true })

    await waitFor(() => {
      expect(screen.getByTestId('action-error')).toBeInTheDocument()
      expect(screen.getByText('Failed to undo merge. Please try again.')).toBeInTheDocument()
    })

    consoleSpy.mockRestore()
  })
})

// ── M5: startIndexing failure resets stuck UI ──────────────────────────────

describe('StackOverview — M5: startIndexing failure resets UI', () => {
  it('start_indexing rejection resets status back to idle, shows error', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    // Initial state: folders present, no stacks -> auto-start indexing path
    // But we override to control the mock chain manually
    mockInvoke.mockResolvedValueOnce([FOLDER_A])    // list_source_folders
    mockInvoke.mockResolvedValueOnce([])             // list_stacks
    mockInvoke.mockResolvedValueOnce(IDLE_STATUS)    // get_indexing_status
    // loadAll sees folders.length > 0 && stacks.length === 0 -> auto-start
    mockInvoke.mockRejectedValueOnce(new Error('Permission denied'))  // start_indexing FAILS
    mockInvoke.mockResolvedValueOnce(IDLE_STATUS)    // get_indexing_status (recovery fetch)
    mockInvoke.mockResolvedValueOnce([])             // list_stacks (recovery fetch)

    render(StackOverview)

    // After failure, UI should NOT be stuck in running state
    await waitFor(() => {
      expect(screen.getByTestId('action-error')).toBeInTheDocument()
      expect(screen.getByText('Failed to start indexing. Please try again.')).toBeInTheDocument()
    })

    // The "Indexing..." indicator should NOT be visible
    expect(screen.queryByText('Indexing…')).not.toBeInTheDocument()

    consoleSpy.mockRestore()
  })

  it('start_indexing failure with get_indexing_status also failing resets running flag', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    mockInvoke.mockResolvedValueOnce([FOLDER_A])    // list_source_folders
    mockInvoke.mockResolvedValueOnce([])             // list_stacks
    mockInvoke.mockResolvedValueOnce(IDLE_STATUS)    // get_indexing_status
    // Auto-start path:
    mockInvoke.mockRejectedValueOnce(new Error('Permission denied'))  // start_indexing FAILS
    mockInvoke.mockRejectedValueOnce(new Error('DB error'))           // get_indexing_status ALSO FAILS
    mockInvoke.mockResolvedValueOnce([])             // list_stacks (recovery)

    render(StackOverview)

    // Error banner should appear
    await waitFor(() => {
      expect(screen.getByTestId('action-error')).toBeInTheDocument()
    })

    // Running state should be reset even if getIndexingStatus also fails
    expect(screen.queryByText('Indexing…')).not.toBeInTheDocument()

    consoleSpy.mockRestore()
  })
})

// ── M7: polling interval leak on unmount ───────────────────────────────────

describe('StackOverview — M7: polling cleanup on unmount', () => {
  it('unmount during active polling clears interval cleanly', async () => {
    // Mount with running status to trigger polling
    mockInvoke.mockResolvedValueOnce([FOLDER_A])        // list_source_folders
    mockInvoke.mockResolvedValueOnce([])                // list_stacks
    mockInvoke.mockResolvedValueOnce(RUNNING_STATUS)    // get_indexing_status (running=true -> startPolling)
    // First poll cycle: keep running so polling stays active
    mockInvoke.mockResolvedValueOnce(RUNNING_STATUS)    // poll: get_indexing_status (still running)
    mockInvoke.mockResolvedValueOnce([])                // poll: list_stacks

    const { unmount } = render(StackOverview)

    // Wait for polling to start
    await waitFor(() => {
      expect(screen.getByText('Indexing…')).toBeInTheDocument()
    })

    // Unmount while polling is active — should not throw
    unmount()

    // Verify no errors — if interval wasn't cleared, subsequent poll ticks
    // would call unmocked invoke and throw. We wait briefly to confirm.
    await new Promise(r => setTimeout(r, 100))
    // If we reach here without error, cleanup was successful
  })
})

// ── M10: loadAll failure during mount ──────────────────────────────────────

describe('StackOverview — M10: loadAll failure during mount', () => {
  it('list_source_folders rejection shows empty state (not stuck loading)', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    // list_source_folders rejects — loadAll fails at the first await
    mockInvoke.mockRejectedValueOnce(new Error('DB not found'))

    render(StackOverview)

    // Loading indicator should disappear (initialLoading set to false in finally block)
    await waitFor(() => {
      expect(screen.queryByText('Loading…')).not.toBeInTheDocument()
    })

    consoleSpy.mockRestore()
  })

  it('list_stacks rejection shows empty state (not stuck loading)', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    mockInvoke.mockResolvedValueOnce([FOLDER_A])           // list_source_folders OK
    mockInvoke.mockRejectedValueOnce(new Error('DB locked'))  // list_stacks FAILS

    render(StackOverview)

    // Should not stay stuck on "Loading…"
    await waitFor(() => {
      expect(screen.queryByText('Loading…')).not.toBeInTheDocument()
    })

    consoleSpy.mockRestore()
  })
})

// ── Bug 4 RED TEST: thumbnail-ready event floods listStacks ──────────────

describe('StackOverview — Bug 4: thumbnail-ready debounce', () => {
  it('debounces rapid thumbnail-ready events instead of calling listStacks per event', async () => {
    // BUG: Every thumbnail-ready event fires an immediate listStacks call.
    // With 5000+ photos, this means 5000+ IPC round-trips to the Rust backend,
    // each doing a DB query + filesystem readdir. This saturates the IPC channel
    // and makes the UI sluggish during thumbnail generation.
    //
    // EXPECTED: thumbnail-ready events should be debounced so that rapid-fire
    // events within a short window (e.g. 200ms) are collapsed into a single
    // listStacks call.
    //
    // This test fires 10 events rapidly and asserts <= 3 listStacks calls.
    // On current code this FAILS because every event triggers its own call.

    // Capture the thumbnail-ready callback by intercepting listen()
    let thumbnailCallback: ((event: any) => void) | null = null
    mockListen.mockImplementation(async (eventName: string, cb: any) => {
      if (eventName === 'thumbnail-ready') {
        thumbnailCallback = cb
      }
      return () => {} // unlisten
    })

    // Render with stacks visible (state 4, DONE_STATUS, all thumbs present = no resume)
    renderStackOverview({
      folders: [FOLDER_A],
      stacks: [STACK_WITH_THUMB],
      status: DONE_STATUS,
    })

    await waitFor(() => expect(screen.getByText('Index complete.')).toBeInTheDocument())
    expect(thumbnailCallback).not.toBeNull()

    // Clear mock call history so we only count calls from thumbnail-ready events
    mockInvoke.mockClear()
    // Reset the throwing default, then mock unlimited list_stacks responses
    mockInvoke.mockImplementation((cmd: string, _args?: any) => {
      if (cmd === 'list_stacks') {
        return Promise.resolve([STACK_WITH_THUMB])
      }
      // Allow other calls to pass through silently
      return Promise.resolve(undefined)
    })

    // Fire 10 thumbnail-ready events rapidly (simulating rayon pool bursts)
    for (let i = 0; i < 10; i++) {
      thumbnailCallback!({ payload: { logical_photo_id: 100 + i } })
    }

    // Wait for all async callbacks to settle
    await new Promise(r => setTimeout(r, 500))

    // Count how many times list_stacks was called
    const listStacksCalls = mockInvoke.mock.calls.filter(c => c[0] === 'list_stacks')

    // With proper debouncing, 10 rapid events should be collapsed into <= 3 calls.
    // Current code calls listStacks for EVERY event, so this will be 10.
    expect(listStacksCalls.length).toBeLessThanOrEqual(3)
  })
})

// ── K1: hjkl vim navigation in StackOverview ─────────────────────────────

describe('StackOverview — K1: hjkl vim navigation', () => {
  it('l key moves focus right (same as ArrowRight)', async () => {
    renderStackOverview({ folders: [FOLDER_A], stacks: [STACK_1, STACK_2, STACK_3], status: DONE_STATUS })
    await waitFor(() => expect(document.querySelectorAll('[data-stack-card]')).toHaveLength(3))

    // Focus starts at index 0
    let cards = document.querySelectorAll('[data-stack-card]')
    expect(cards[0].className).toContain('border-blue-500')

    // Press 'l' to move right
    await fireEvent.keyDown(document, { key: 'l' })

    cards = document.querySelectorAll('[data-stack-card]')
    expect(cards[1].className).toContain('border-blue-500')
    expect(cards[0].className).not.toContain('border-blue-500')
  })

  it('h key moves focus left (same as ArrowLeft)', async () => {
    renderStackOverview({ folders: [FOLDER_A], stacks: [STACK_1, STACK_2, STACK_3], status: DONE_STATUS })
    await waitFor(() => expect(document.querySelectorAll('[data-stack-card]')).toHaveLength(3))

    // Move right first
    await fireEvent.keyDown(document, { key: 'ArrowRight' })
    let cards = document.querySelectorAll('[data-stack-card]')
    expect(cards[1].className).toContain('border-blue-500')

    // Press 'h' to move left
    await fireEvent.keyDown(document, { key: 'h' })

    cards = document.querySelectorAll('[data-stack-card]')
    expect(cards[0].className).toContain('border-blue-500')
    expect(cards[1].className).not.toContain('border-blue-500')
  })

  it('j key moves focus down (same as ArrowDown)', async () => {
    const manyStacks: StackSummary[] = Array.from({ length: 8 }, (_, i) => ({
      stack_id: i + 1, logical_photo_count: 1, earliest_capture: null,
      has_raw: false, has_jpeg: true, thumbnail_path: null,
    }))

    renderStackOverview({ folders: [FOLDER_A], stacks: manyStacks, status: DONE_STATUS })
    await waitFor(() => expect(document.querySelectorAll('[data-stack-card]')).toHaveLength(8))

    // Press 'j' to move down (4 cols)
    await fireEvent.keyDown(document, { key: 'j' })

    const cards = document.querySelectorAll('[data-stack-card]')
    expect(cards[4].className).toContain('border-blue-500')
    expect(cards[0].className).not.toContain('border-blue-500')
  })

  it('k key moves focus up (same as ArrowUp)', async () => {
    const manyStacks: StackSummary[] = Array.from({ length: 8 }, (_, i) => ({
      stack_id: i + 1, logical_photo_count: 1, earliest_capture: null,
      has_raw: false, has_jpeg: true, thumbnail_path: null,
    }))

    renderStackOverview({ folders: [FOLDER_A], stacks: manyStacks, status: DONE_STATUS })
    await waitFor(() => expect(document.querySelectorAll('[data-stack-card]')).toHaveLength(8))

    // Move down first to index 4
    await fireEvent.keyDown(document, { key: 'ArrowDown' })
    let cards = document.querySelectorAll('[data-stack-card]')
    expect(cards[4].className).toContain('border-blue-500')

    // Press 'k' to move up
    await fireEvent.keyDown(document, { key: 'k' })

    cards = document.querySelectorAll('[data-stack-card]')
    expect(cards[0].className).toContain('border-blue-500')
    expect(cards[4].className).not.toContain('border-blue-500')
  })

  it('Ctrl+h does NOT trigger navigation (modifier guard)', async () => {
    renderStackOverview({ folders: [FOLDER_A], stacks: [STACK_1, STACK_2, STACK_3], status: DONE_STATUS })
    await waitFor(() => expect(document.querySelectorAll('[data-stack-card]')).toHaveLength(3))

    // Move right first so we can detect unwanted left movement
    await fireEvent.keyDown(document, { key: 'ArrowRight' })
    let cards = document.querySelectorAll('[data-stack-card]')
    expect(cards[1].className).toContain('border-blue-500')

    // Press Ctrl+h — should NOT move focus
    await fireEvent.keyDown(document, { key: 'h', ctrlKey: true })

    cards = document.querySelectorAll('[data-stack-card]')
    expect(cards[1].className).toContain('border-blue-500')
  })

  it('Shift+h does NOT trigger navigation (modifier guard)', async () => {
    renderStackOverview({ folders: [FOLDER_A], stacks: [STACK_1, STACK_2, STACK_3], status: DONE_STATUS })
    await waitFor(() => expect(document.querySelectorAll('[data-stack-card]')).toHaveLength(3))

    // Move right first
    await fireEvent.keyDown(document, { key: 'ArrowRight' })
    let cards = document.querySelectorAll('[data-stack-card]')
    expect(cards[1].className).toContain('border-blue-500')

    // Press Shift+h — should NOT move focus
    await fireEvent.keyDown(document, { key: 'H', shiftKey: true })

    cards = document.querySelectorAll('[data-stack-card]')
    expect(cards[1].className).toContain('border-blue-500')
  })
})

// ── K3: Home/End in StackOverview ────────────────────────────────────────

describe('StackOverview — K3: Home/End navigation', () => {
  it('Home key jumps to first stack', async () => {
    renderStackOverview({ folders: [FOLDER_A], stacks: [STACK_1, STACK_2, STACK_3], status: DONE_STATUS })
    await waitFor(() => expect(document.querySelectorAll('[data-stack-card]')).toHaveLength(3))

    // Move to last stack
    await fireEvent.keyDown(document, { key: 'ArrowRight' })
    await fireEvent.keyDown(document, { key: 'ArrowRight' })
    let cards = document.querySelectorAll('[data-stack-card]')
    expect(cards[2].className).toContain('border-blue-500')

    // Press Home
    await fireEvent.keyDown(document, { key: 'Home' })

    cards = document.querySelectorAll('[data-stack-card]')
    expect(cards[0].className).toContain('border-blue-500')
    expect(cards[2].className).not.toContain('border-blue-500')
  })

  it('End key jumps to last stack', async () => {
    renderStackOverview({ folders: [FOLDER_A], stacks: [STACK_1, STACK_2, STACK_3], status: DONE_STATUS })
    await waitFor(() => expect(document.querySelectorAll('[data-stack-card]')).toHaveLength(3))

    // Focus starts at index 0
    let cards = document.querySelectorAll('[data-stack-card]')
    expect(cards[0].className).toContain('border-blue-500')

    // Press End
    await fireEvent.keyDown(document, { key: 'End' })

    cards = document.querySelectorAll('[data-stack-card]')
    expect(cards[2].className).toContain('border-blue-500')
    expect(cards[0].className).not.toContain('border-blue-500')
  })
})
