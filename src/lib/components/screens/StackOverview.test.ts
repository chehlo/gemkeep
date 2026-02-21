// src/lib/components/screens/StackOverview.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/svelte'
import { invoke, convertFileSrc } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
import { navigate, navigation } from '$lib/stores/navigation.svelte.js'
import type { SourceFolder, IndexingStatus, StackSummary } from '$lib/api/index.js'
import StackOverview from './StackOverview.svelte'

const mockOpen = vi.mocked(open)

const mockInvoke = vi.mocked(invoke)

const FOLDER_A: SourceFolder = { id: 1, path: '/home/user/Photos/Iceland' }
const FOLDER_B: SourceFolder = { id: 2, path: '/home/user/Photos/Drone' }

const IDLE_STATUS: IndexingStatus = {
  running: false, thumbnails_running: false, total: 0, processed: 0, errors: 0, cancelled: false, paused: false, last_stats: null
}

const RUNNING_STATUS: IndexingStatus = {
  running: true, thumbnails_running: false, total: 1290, processed: 340, errors: 0, cancelled: false, paused: false, last_stats: null
}

const DONE_STATUS: IndexingStatus = {
  running: false, thumbnails_running: false, total: 1290, processed: 1290, errors: 0, cancelled: false, paused: false,
  last_stats: {
    total_files_scanned: 1290, imported: 1280, skipped_existing: 0,
    skipped_unsupported: 10, errors: 0, pairs_detected: 640,
    stacks_generated: 3, logical_photos: 640, error_log: []
  }
}

const THUMBNAIL_RUNNING_STATUS: IndexingStatus = {
  running: false, thumbnails_running: true, total: 1290, processed: 1290, errors: 0, cancelled: false, paused: false, last_stats: null
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

beforeEach(() => {
  vi.clearAllMocks()
  setupNav()
  navigation.stackOverviewFocusIndex = null
})

describe('StackOverview — state 1: no source folders', () => {
  it('renders no-folders state when source_folders is empty', async () => {
    // loadAll calls: listSourceFolders, listStacks, getIndexingStatus
    mockInvoke.mockResolvedValueOnce([])          // list_source_folders
    mockInvoke.mockResolvedValueOnce([])          // list_stacks
    mockInvoke.mockResolvedValueOnce(IDLE_STATUS) // get_indexing_status

    render(StackOverview)

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
    mockInvoke.mockResolvedValueOnce([FOLDER_A, FOLDER_B]) // list_source_folders
    mockInvoke.mockResolvedValueOnce([])                   // list_stacks
    mockInvoke.mockResolvedValueOnce(IDLE_STATUS)          // get_indexing_status
    mockInvoke.mockResolvedValueOnce(undefined)            // start_indexing (auto-start)
    mockInvoke.mockResolvedValueOnce(IDLE_STATUS)          // get_indexing_status (immediate poll from startPolling)
    mockInvoke.mockResolvedValueOnce([])                   // list_stacks (poll reload when both flags false)

    render(StackOverview)

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
    mockInvoke.mockResolvedValueOnce([FOLDER_A]) // list_source_folders
    mockInvoke.mockResolvedValueOnce([])         // list_stacks
    mockInvoke.mockResolvedValueOnce(IDLE_STATUS) // get_indexing_status
    mockInvoke.mockResolvedValueOnce(undefined)  // start_indexing (auto-start)
    mockInvoke.mockResolvedValueOnce(IDLE_STATUS) // get_indexing_status (immediate poll from startPolling)
    mockInvoke.mockResolvedValueOnce([])          // list_stacks (poll reload when both flags false)

    render(StackOverview)

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('start_indexing', { slug: 'iceland-2024' })
    })
  })

  it('does NOT auto-start when stacks already exist (re-open scenario)', async () => {
    mockInvoke.mockResolvedValueOnce([FOLDER_A])   // list_source_folders
    mockInvoke.mockResolvedValueOnce([STACK_1])    // list_stacks (stacks exist!)
    mockInvoke.mockResolvedValueOnce(IDLE_STATUS)  // get_indexing_status

    render(StackOverview)

    await waitFor(() => expect(screen.getByText('Index complete.')).toBeInTheDocument())
    expect(mockInvoke).not.toHaveBeenCalledWith('start_indexing', expect.anything())
  })

  it('does NOT auto-start when thumbnails_running=true even if stacks are empty', async () => {
    mockInvoke.mockResolvedValueOnce([FOLDER_A])              // list_source_folders
    mockInvoke.mockResolvedValueOnce([])                      // list_stacks (empty)
    mockInvoke.mockResolvedValueOnce(THUMBNAIL_RUNNING_STATUS) // thumbnails_running=true
    // Polling will fire — provide terminal status so it stops
    mockInvoke.mockResolvedValueOnce(IDLE_STATUS)             // poll: get_indexing_status
    mockInvoke.mockResolvedValueOnce([])                      // poll: list_stacks

    render(StackOverview)

    await new Promise(resolve => setTimeout(resolve, 50))
    expect(mockInvoke).not.toHaveBeenCalledWith('start_indexing', expect.anything())
  })
})

describe('StackOverview — state 3: indexing in progress', () => {
  it('renders progress bar and cancel button during EXIF scan phase', async () => {
    mockInvoke.mockResolvedValueOnce([FOLDER_A])    // list_source_folders
    mockInvoke.mockResolvedValueOnce([])            // list_stacks
    mockInvoke.mockResolvedValueOnce(RUNNING_STATUS) // get_indexing_status (status.running=true)

    render(StackOverview)

    await waitFor(() => {
      expect(screen.getByText('Indexing…')).toBeInTheDocument()
    })
    expect(screen.getByText(/340.*1,290/)).toBeInTheDocument()
    expect(screen.getByText('Cancel')).toBeInTheDocument()
    // No × remove buttons while indexing
    expect(screen.queryByTitle('Remove folder')).not.toBeInTheDocument()
    // No Index Photos button
    expect(screen.queryByText('Index Photos')).not.toBeInTheDocument()
  })
})

describe('StackOverview — state 4 with thumbnails_running', () => {
  it('renders stacks grid and "Generating thumbnails…" when running=false and thumbnails_running=true', async () => {
    mockInvoke.mockResolvedValueOnce([FOLDER_A])                    // list_source_folders
    mockInvoke.mockResolvedValueOnce([STACK_1, STACK_2, STACK_3])   // list_stacks
    mockInvoke.mockResolvedValueOnce(THUMBNAIL_RUNNING_STATUS)      // get_indexing_status

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

  it('thumbnail progress indicator is NOT a static full-width bar', async () => {
    // WHY THIS TEST EXISTS:
    // A `w-full animate-pulse` div is visually identical to a "100% complete" bar.
    // The user reported "progress bar immediately at 100%" — the root cause was that
    // STATE 4's thumbnail banner used `w-full animate-pulse`, which looks done.
    // Fix: use a spinner (animate-spin) or a clearly indeterminate animation,
    // never a full-width static bar.
    mockInvoke.mockResolvedValueOnce([FOLDER_A])
    mockInvoke.mockResolvedValueOnce([STACK_1, STACK_2])
    mockInvoke.mockResolvedValueOnce(THUMBNAIL_RUNNING_STATUS)

    const { container } = render(StackOverview)

    await waitFor(() => expect(screen.getByText('Generating thumbnails…')).toBeInTheDocument())

    // Any animated element in the thumbnail banner must NOT be full-width.
    // Full-width pulsing bar == visually looks like "complete" to the user.
    const pulsingEl = container.querySelector('.animate-pulse')
    const spinningEl = container.querySelector('.animate-spin')
    const animatedEl = pulsingEl ?? spinningEl
    expect(animatedEl).toBeInTheDocument()
    // If there's a pulsing bar, it must not be full-width
    if (pulsingEl) {
      expect(pulsingEl).not.toHaveClass('w-full')
    }
  })
})

describe('StackOverview — state 4: indexed, stacks visible', () => {
  it('renders stack grid after indexing completes', async () => {
    mockInvoke.mockResolvedValueOnce([FOLDER_A])           // list_source_folders
    mockInvoke.mockResolvedValueOnce([STACK_1, STACK_2, STACK_3]) // list_stacks
    mockInvoke.mockResolvedValueOnce(DONE_STATUS)          // get_indexing_status

    render(StackOverview)

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
    mockInvoke.mockResolvedValueOnce([FOLDER_A])  // list_source_folders
    mockInvoke.mockResolvedValueOnce([STACK_3])   // list_stacks (thumbnail_path: null)
    mockInvoke.mockResolvedValueOnce(DONE_STATUS) // get_indexing_status

    render(StackOverview)

    await waitFor(() => {
      expect(screen.getByText('Stack #1')).toBeInTheDocument()
    })
    // Placeholder emoji present
    expect(screen.getByText('📷')).toBeInTheDocument()
    // No img element for this stack (no thumbnail)
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })

  it('renders Re-index button in state 4', async () => {
    mockInvoke.mockResolvedValueOnce([FOLDER_A])           // list_source_folders
    mockInvoke.mockResolvedValueOnce([STACK_1, STACK_2])   // list_stacks
    mockInvoke.mockResolvedValueOnce(DONE_STATUS)          // get_indexing_status

    render(StackOverview)

    await waitFor(() => {
      expect(screen.getByText('Re-index')).toBeInTheDocument()
    })
  })

  it('renders img with src from getThumbnailUrl when thumbnail_path is set', async () => {
    const thumbPath = STACK_WITH_THUMB.thumbnail_path!
    vi.mocked(convertFileSrc).mockImplementation((p) => `asset://localhost${p}`)

    mockInvoke.mockResolvedValueOnce([FOLDER_A])
    mockInvoke.mockResolvedValueOnce([STACK_WITH_THUMB])
    mockInvoke.mockResolvedValueOnce(DONE_STATUS)

    render(StackOverview)

    await waitFor(() => expect(screen.getByText('Stack #1')).toBeInTheDocument())

    const img = screen.getByRole('img')
    expect(img).toBeInTheDocument()
    expect(vi.mocked(convertFileSrc)).toHaveBeenCalledWith(thumbPath)
    expect(img).toHaveAttribute('src', `asset://localhost${thumbPath}`)
  })

  it('does not render img element when thumbnail_path is null', async () => {
    vi.mocked(convertFileSrc).mockImplementation((p) => `asset://localhost${p}`)

    mockInvoke.mockResolvedValueOnce([FOLDER_A])
    mockInvoke.mockResolvedValueOnce([STACK_3])
    mockInvoke.mockResolvedValueOnce(DONE_STATUS)

    render(StackOverview)

    await waitFor(() => expect(screen.getByText('Stack #1')).toBeInTheDocument())
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(screen.getByText('📷')).toBeInTheDocument()
  })
})

describe('StackOverview — reindex shortcuts (state 4)', () => {
  it('r key triggers re-index when stacks present', async () => {
    mockInvoke.mockResolvedValueOnce([FOLDER_A]) // list_source_folders
    mockInvoke.mockResolvedValueOnce([STACK_1])  // list_stacks
    mockInvoke.mockResolvedValueOnce(DONE_STATUS) // get_indexing_status

    render(StackOverview)

    await waitFor(() => expect(screen.getByText('Index complete.')).toBeInTheDocument())

    mockInvoke.mockClear()
    mockInvoke.mockResolvedValueOnce(undefined)   // start_indexing
    mockInvoke.mockResolvedValueOnce(IDLE_STATUS) // get_indexing_status (immediate poll from startPolling)
    mockInvoke.mockResolvedValueOnce([STACK_1])   // list_stacks (poll reload when both flags false)

    fireEvent.keyDown(document, { key: 'r' })

    await waitFor(() => expect(mockInvoke).toHaveBeenCalledWith('start_indexing', { slug: 'iceland-2024' }))
  })

  it('i key triggers re-index when stacks already exist', async () => {
    mockInvoke.mockResolvedValueOnce([FOLDER_A]) // list_source_folders
    mockInvoke.mockResolvedValueOnce([STACK_1])  // list_stacks
    mockInvoke.mockResolvedValueOnce(DONE_STATUS) // get_indexing_status

    render(StackOverview)

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
    // WHY THIS TEST EXISTS AND WHAT IT REVEALS:
    // When a user adds their first folder to a new project, they expect
    // indexing to start automatically (the same auto-start that fires on mount).
    // CURRENT BUG: handleAddFolder() only refreshes sourceFolders but does NOT
    // call handleIndex(). The user is left looking at the folder list with no
    // prompt to start indexing and no auto-start.
    //
    // This test will FAIL with the current code because start_indexing is
    // NOT called after adding the first folder.
    // The fix: add auto-start logic to handleAddFolder when stacks.length === 0.

    // Initial state: no folders, no stacks
    mockInvoke.mockResolvedValueOnce([])           // list_source_folders (initial)
    mockInvoke.mockResolvedValueOnce([])           // list_stacks
    mockInvoke.mockResolvedValueOnce(IDLE_STATUS)  // get_indexing_status

    render(StackOverview)
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
    // (same logic as on-mount auto-start: folders > 0, stacks === 0)
    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("start_indexing", { slug: "iceland-2024" })
    }, { timeout: 500 })
  })
})

describe('StackOverview — scroll position restore', () => {
  it('restores focused card index when returning from StackFocus', async () => {
    // WHY: When the user navigates StackOverview → StackFocus → back, the previously
    // focused stack card must regain focus (blue border) instead of defaulting to card 0.
    // The navigation store holds stackOverviewFocusIndex = 5 (set when entering StackFocus).
    const STACK_COUNT = 8
    const mockStacks: StackSummary[] = Array.from({ length: STACK_COUNT }, (_, i) => ({
      stack_id: i + 1,
      logical_photo_count: 1,
      earliest_capture: null,
      has_raw: false,
      has_jpeg: true,
      thumbnail_path: null,
    }))

    mockInvoke
      .mockResolvedValueOnce([FOLDER_A])  // list_source_folders (must be non-empty to show stack grid)
      .mockResolvedValueOnce(mockStacks)  // list_stacks
      .mockResolvedValueOnce(DONE_STATUS) // get_indexing_status (not running, stacks visible = State 4)

    // Pre-set the saved focus index (simulating return from StackFocus)
    navigation.stackOverviewFocusIndex = 5

    render(StackOverview)

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
