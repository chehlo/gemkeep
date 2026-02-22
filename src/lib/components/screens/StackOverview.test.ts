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
    mockInvoke.mockResolvedValueOnce(undefined)    // resume_thumbnails (STACK_1 has null thumbnail)
    mockInvoke.mockResolvedValueOnce(IDLE_STATUS)  // poll: get_indexing_status
    mockInvoke.mockResolvedValueOnce([STACK_1])    // poll: list_stacks (stops polling)

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
    mockInvoke.mockResolvedValueOnce(RUNNING_STATUS) // poll: get_indexing_status (still running)
    mockInvoke.mockResolvedValueOnce([])            // poll: list_stacks (running → reload stacks)

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
    mockInvoke.mockResolvedValueOnce([FOLDER_A])           // list_source_folders
    mockInvoke.mockResolvedValueOnce([STACK_1, STACK_2, STACK_3]) // list_stacks
    mockInvoke.mockResolvedValueOnce(DONE_STATUS)          // get_indexing_status
    mockInvoke.mockResolvedValueOnce(undefined)            // resume_thumbnails (stacks have null thumbnails)
    mockInvoke.mockResolvedValueOnce(IDLE_STATUS)          // poll: get_indexing_status
    mockInvoke.mockResolvedValueOnce([STACK_1, STACK_2, STACK_3]) // poll: list_stacks (stops polling)

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
    mockInvoke.mockResolvedValueOnce(undefined)   // resume_thumbnails (STACK_3 has null thumbnail)
    mockInvoke.mockResolvedValueOnce(IDLE_STATUS) // poll: get_indexing_status
    mockInvoke.mockResolvedValueOnce([STACK_3])   // poll: list_stacks (stops polling)

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
    mockInvoke.mockResolvedValueOnce(undefined)            // resume_thumbnails (stacks have null thumbnails)
    mockInvoke.mockResolvedValueOnce(IDLE_STATUS)          // poll: get_indexing_status
    mockInvoke.mockResolvedValueOnce([STACK_1, STACK_2])   // poll: list_stacks (stops polling)

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
    mockInvoke.mockResolvedValueOnce(undefined)   // resume_thumbnails (STACK_3 has null thumbnail)
    mockInvoke.mockResolvedValueOnce(IDLE_STATUS) // poll: get_indexing_status
    mockInvoke.mockResolvedValueOnce([STACK_3])   // poll: list_stacks (stops polling)

    render(StackOverview)

    await waitFor(() => expect(screen.getByText('Stack #1')).toBeInTheDocument())
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(screen.getByText('📷')).toBeInTheDocument()
  })
})

describe('StackOverview — reindex shortcuts (state 4)', () => {
  it('r key triggers re-index when stacks present', async () => {
    mockInvoke.mockResolvedValueOnce([FOLDER_A])  // list_source_folders
    mockInvoke.mockResolvedValueOnce([STACK_1])   // list_stacks
    mockInvoke.mockResolvedValueOnce(DONE_STATUS) // get_indexing_status
    mockInvoke.mockResolvedValueOnce(undefined)   // resume_thumbnails (STACK_1 has null thumbnail)
    mockInvoke.mockResolvedValueOnce(IDLE_STATUS) // poll: get_indexing_status (startPolling from resume)
    mockInvoke.mockResolvedValueOnce([STACK_1])   // poll: list_stacks

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
    mockInvoke.mockResolvedValueOnce([FOLDER_A])  // list_source_folders
    mockInvoke.mockResolvedValueOnce([STACK_1])   // list_stacks
    mockInvoke.mockResolvedValueOnce(DONE_STATUS) // get_indexing_status
    mockInvoke.mockResolvedValueOnce(undefined)   // resume_thumbnails (STACK_1 has null thumbnail)
    mockInvoke.mockResolvedValueOnce(IDLE_STATUS) // poll: get_indexing_status (startPolling from resume)
    mockInvoke.mockResolvedValueOnce([STACK_1])   // poll: list_stacks

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
      .mockResolvedValueOnce(undefined)   // resume_thumbnails (stacks have null thumbnails)
      .mockResolvedValueOnce(IDLE_STATUS) // poll: get_indexing_status
      .mockResolvedValueOnce(mockStacks)  // poll: list_stacks

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

describe('StackOverview — thumbnail-ready event (Part C)', () => {
  it('C2: registers listen("thumbnail-ready") on mount', async () => {
    // WHY: The component must subscribe to thumbnail-ready on mount so that
    // progressive thumbnail updates refresh the stack grid card-by-card.
    // If listen() is never called, all thumbnails appear at once only after
    // the polling cycle — the progressive UX is broken.
    mockInvoke.mockResolvedValueOnce([FOLDER_A])   // list_source_folders
    mockInvoke.mockResolvedValueOnce([STACK_1])    // list_stacks
    mockInvoke.mockResolvedValueOnce(DONE_STATUS)  // get_indexing_status
    mockInvoke.mockResolvedValueOnce(undefined)    // resume_thumbnails (STACK_1 has null thumbnail)
    mockInvoke.mockResolvedValueOnce(IDLE_STATUS)  // poll: get_indexing_status
    mockInvoke.mockResolvedValueOnce([STACK_1])    // poll: list_stacks (stops polling)

    render(StackOverview)

    await waitFor(() => expect(screen.getByText('Stack #1')).toBeInTheDocument())

    expect(mockListen).toHaveBeenCalledWith('thumbnail-ready', expect.any(Function))
  })

  it('C3: calls unlisten when component is destroyed', async () => {
    // WHY (Rule 4): The unlisten function returned by listen() must be called
    // on component destroy to prevent memory leaks and stale event handlers.
    // Without this, navigating away and back registers duplicate listeners.
    const mockUnlisten = vi.fn()
    mockListen.mockResolvedValueOnce(mockUnlisten as any)

    mockInvoke.mockResolvedValueOnce([FOLDER_A])   // list_source_folders
    mockInvoke.mockResolvedValueOnce([STACK_1])    // list_stacks
    mockInvoke.mockResolvedValueOnce(DONE_STATUS)  // get_indexing_status
    mockInvoke.mockResolvedValueOnce(undefined)    // resume_thumbnails (STACK_1 has null thumbnail)
    mockInvoke.mockResolvedValueOnce(IDLE_STATUS)  // poll: get_indexing_status
    mockInvoke.mockResolvedValueOnce([STACK_1])    // poll: list_stacks (stops polling)

    const { unmount } = render(StackOverview)

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
    mockInvoke.mockResolvedValueOnce([FOLDER_A])           // list_source_folders
    mockInvoke.mockResolvedValueOnce([STACK_WITHOUT_THUMB]) // list_stacks
    mockInvoke.mockResolvedValueOnce(IDLE_STATUS)           // get_indexing_status
    mockInvoke.mockResolvedValueOnce(undefined)             // resume_thumbnails
    mockInvoke.mockResolvedValueOnce(IDLE_STATUS)           // poll: get_indexing_status
    mockInvoke.mockResolvedValueOnce([STACK_WITHOUT_THUMB]) // poll: list_stacks (stops polling)

    render(StackOverview, { props: {} })

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('resume_thumbnails', { slug: 'iceland-2024' })
    })
  })

  it('P2-08: does NOT call resume_thumbnails when all stacks have thumbnail_path', async () => {
    mockInvoke.mockResolvedValueOnce([FOLDER_A])     // list_source_folders
    mockInvoke.mockResolvedValueOnce([STACK_WITH_THUMB]) // list_stacks (all have thumbnails)
    mockInvoke.mockResolvedValueOnce(IDLE_STATUS)    // get_indexing_status

    render(StackOverview, { props: {} })

    await waitFor(() => expect(screen.getByText('Index complete.')).toBeInTheDocument())
    expect(mockInvoke).not.toHaveBeenCalledWith('resume_thumbnails', expect.anything())
  })

  it('P2-09: does NOT call resume_thumbnails when stacks array is empty', async () => {
    mockInvoke.mockResolvedValueOnce([FOLDER_A])  // list_source_folders
    mockInvoke.mockResolvedValueOnce([])          // list_stacks (empty)
    mockInvoke.mockResolvedValueOnce(IDLE_STATUS) // get_indexing_status
    mockInvoke.mockResolvedValueOnce(undefined)   // start_indexing (auto-start fires)
    mockInvoke.mockResolvedValueOnce(IDLE_STATUS) // poll: get_indexing_status
    mockInvoke.mockResolvedValueOnce([])          // poll: list_stacks (stops polling)

    render(StackOverview, { props: {} })

    await new Promise(resolve => setTimeout(resolve, 50))
    expect(mockInvoke).not.toHaveBeenCalledWith('resume_thumbnails', expect.anything())
  })

  it('P2-10: does NOT call resume_thumbnails when thumbnails_running is already true', async () => {
    mockInvoke.mockResolvedValueOnce([FOLDER_A])              // list_source_folders
    mockInvoke.mockResolvedValueOnce([STACK_WITHOUT_THUMB])    // list_stacks
    mockInvoke.mockResolvedValueOnce(THUMBNAIL_RUNNING_STATUS) // get_indexing_status (thumbnails_running: true)
    // Polling will fire
    mockInvoke.mockResolvedValueOnce(IDLE_STATUS)             // poll: get_indexing_status
    mockInvoke.mockResolvedValueOnce([STACK_WITHOUT_THUMB])   // poll: list_stacks

    render(StackOverview, { props: {} })

    await new Promise(resolve => setTimeout(resolve, 50))
    expect(mockInvoke).not.toHaveBeenCalledWith('resume_thumbnails', expect.anything())
  })
})

describe('StackOverview — P1 thumbnail progress bar', () => {
  it('P1-06: renders determinate progress bar when thumbnails_total > 0', async () => {
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
    // WHY: a w-full animate-pulse element looks identical to "100% complete"
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
  // Each test sets up StackOverview in the "has stacks" state:
  // list_source_folders → [FOLDER_A]
  // list_stacks → [STACK_1, STACK_2]  (both have null thumbnail_path)
  // get_indexing_status → IDLE_STATUS (no resume triggered)
  // STACK_1 has thumbnail_path: null so resume_thumbnails will be called — mock it as 4th call.

  async function setupWithStacks() {
    mockInvoke.mockResolvedValueOnce([FOLDER_A])          // list_source_folders
    mockInvoke.mockResolvedValueOnce([STACK_1, STACK_2])  // list_stacks
    mockInvoke.mockResolvedValueOnce(IDLE_STATUS)         // get_indexing_status
    mockInvoke.mockResolvedValueOnce(undefined)           // resume_thumbnails (STACK_1 has null thumb)
    mockInvoke.mockResolvedValueOnce(IDLE_STATUS)         // poll: get_indexing_status
    mockInvoke.mockResolvedValueOnce([STACK_1, STACK_2])  // poll: list_stacks (stops polling)
    render(StackOverview)
    // Wait for stacks to be rendered (stack cards are <button data-stack-card>)
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
    const input = screen.getByRole('spinbutton')
    expect(Number(input.value)).toBe(3)
  })

  // BT-08
  it('test_save_burst_gap_calls_set_burst_gap', async () => {
    await setupWithStacks()
    mockInvoke.mockResolvedValueOnce(3)                   // get_burst_gap (on panel open)
    mockInvoke.mockResolvedValueOnce(undefined)           // set_burst_gap
    mockInvoke.mockResolvedValueOnce(undefined)           // restack
    mockInvoke.mockResolvedValueOnce([STACK_1, STACK_2])  // list_stacks (after restack)
    mockInvoke.mockResolvedValueOnce(undefined)           // resume_thumbnails (stacks have null thumbs)
    mockInvoke.mockResolvedValueOnce(IDLE_STATUS)         // poll: get_indexing_status
    mockInvoke.mockResolvedValueOnce([STACK_1, STACK_2])  // poll: list_stacks (stops polling)

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
    mockInvoke.mockResolvedValueOnce(undefined)           // resume_thumbnails (stacks have null thumbs)
    mockInvoke.mockResolvedValueOnce(IDLE_STATUS)         // poll: get_indexing_status
    mockInvoke.mockResolvedValueOnce([STACK_1, STACK_2])  // poll: list_stacks (stops polling)

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
    mockInvoke.mockResolvedValueOnce(undefined)           // resume_thumbnails (stacks have null thumbs)
    mockInvoke.mockResolvedValueOnce(IDLE_STATUS)         // poll: get_indexing_status
    mockInvoke.mockResolvedValueOnce([STACK_1, STACK_2])  // poll: list_stacks (stops polling)

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
    // WHY: When all stacks have thumbnail_path set (non-null), loadAll() must NOT
    // call resume_thumbnails. The condition is: stacks.some(s => s.thumbnail_path === null).
    // If all are non-null, that condition is false and resume is skipped.
    // Expected: PASS

    // invoke call order on mount:
    // 1. list_source_folders
    // 2. list_stacks → both stacks have thumbnails
    // 3. get_indexing_status → idle, no thumbnails_running
    mockInvoke.mockResolvedValueOnce([{ id: 1, path: '/photos' }]) // list_source_folders
    mockInvoke.mockResolvedValueOnce([STACK_A_WITH_THUMB, STACK_B_WITH_THUMB]) // list_stacks
    mockInvoke.mockResolvedValueOnce(THUMBS_DONE_STATUS)            // get_indexing_status

    render(StackOverview)

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
    // WHY: When at least one stack has thumbnail_path === null and status is idle,
    // loadAll() must call handleResumeThumbnails() which calls resume_thumbnails.
    // This is the re-open scenario where a previous session didn't finish thumbnail gen.
    // Expected: PASS

    // invoke call order on mount (before polling starts):
    // 1. list_source_folders
    // 2. list_stacks → one stack null, one with thumb
    // 3. get_indexing_status → idle
    // 4. resume_thumbnails → called by handleResumeThumbnails
    // After #4, startPolling() fires poll() immediately but we let the default
    // mock (undefined) handle it — that poll returns early (newStatus == null guard).
    mockInvoke.mockResolvedValueOnce([{ id: 1, path: '/photos' }]) // 1: list_source_folders
    mockInvoke.mockResolvedValueOnce([STACK_A_WITH_THUMB, STACK_B_NO_THUMB]) // 2: list_stacks
    mockInvoke.mockResolvedValueOnce(THUMBS_DONE_STATUS)            // 3: get_indexing_status (idle)
    mockInvoke.mockResolvedValueOnce(undefined)                     // 4: resume_thumbnails
    mockInvoke.mockResolvedValueOnce(IDLE_STATUS)                   // 5: poll: get_indexing_status
    mockInvoke.mockResolvedValueOnce([STACK_A_WITH_THUMB, STACK_B_NO_THUMB]) // 6: poll: list_stacks (stops polling)

    render(StackOverview)

    // Wait until resume_thumbnails is called (mock #4 consumed)
    await waitFor(() => {
      const calledCommands = mockInvoke.mock.calls.map(c => c[0])
      expect(calledCommands).toContain('resume_thumbnails')
    }, { timeout: 500 })
  })

  // TH-D3
  it('TH-D3: saveBurstGap auto-resumes thumbnails in the same session after restack', async () => {
    // WHY: After the user saves a burst gap and restack runs, stacks.thumbnail_path
    // is null (restack cleared them). saveBurstGap must call handleResumeThumbnails()
    // immediately so thumbnails regenerate in the same session — not on the next app open.
    //
    // Without this, opening the app after a restack triggers unexpected thumbnail generation
    // (the "re-trigger" bug the user reported). Fix: saveBurstGap calls handleResumeThumbnails()
    // when listStacks returns null thumbnails.
    //
    // Expected: PASS (verifies the fix — resume IS called in the same session)

    // Mount with stacks that already have thumbnails (all non-null) — no resume on mount
    const STACK_WITH_THUMB = { ...STACK_1, thumbnail_path: '/cache/1.jpg' }
    const STACK_WITH_THUMB_2 = { ...STACK_2, thumbnail_path: '/cache/2.jpg' }
    mockInvoke.mockResolvedValueOnce([FOLDER_A])
    mockInvoke.mockResolvedValueOnce([STACK_WITH_THUMB, STACK_WITH_THUMB_2])
    mockInvoke.mockResolvedValueOnce(IDLE_STATUS)
    render(StackOverview)
    await waitFor(() => expect(document.querySelectorAll('[data-stack-card]')).toHaveLength(2))

    // Confirm resume_thumbnails was NOT called on mount (all have thumbnails)
    expect(mockInvoke.mock.calls.map(c => c[0])).not.toContain('resume_thumbnails')

    // Open burst gap panel
    mockInvoke.mockResolvedValueOnce(3) // get_burst_gap
    await fireEvent.keyDown(document, { key: 'b', ctrlKey: true })
    await waitFor(() => expect(screen.getByText(/burst gap/i)).toBeInTheDocument())

    // saveBurstGap flow: setBurstGap → restack → listStacks (null) → resume_thumbnails
    mockInvoke.mockResolvedValueOnce(undefined)           // set_burst_gap
    mockInvoke.mockResolvedValueOnce(undefined)           // restack
    mockInvoke.mockResolvedValueOnce([STACK_1, STACK_2])  // list_stacks → null thumbnails after restack
    mockInvoke.mockResolvedValueOnce(undefined)           // resume_thumbnails (called by saveBurstGap)
    mockInvoke.mockResolvedValueOnce(IDLE_STATUS)         // poll: get_indexing_status
    mockInvoke.mockResolvedValueOnce([STACK_1, STACK_2])  // poll: list_stacks (stops polling)

    // Click Save
    await fireEvent.click(screen.getByRole('button', { name: /save/i }))

    // Wait for panel to close
    await waitFor(() => {
      expect(screen.queryByText(/burst gap/i)).not.toBeInTheDocument()
    })

    // resume_thumbnails MUST be called after saveBurstGap because stacks have null thumbnails
    await waitFor(() => {
      expect(mockInvoke.mock.calls.map(c => c[0])).toContain('resume_thumbnails')
    })
  })
})
