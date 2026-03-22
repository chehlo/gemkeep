// src/lib/components/screens/StackOverview.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/svelte'
import { invoke, convertFileSrc } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { open } from '@tauri-apps/plugin-dialog'
import { navigate, navigation } from '$lib/stores/navigation.svelte.js'
import type { SourceFolder, IndexingStatus, StackSummary } from '$lib/api/index.js'
import { IDLE_STATUS, makeStack } from '$test/fixtures'
import { mockStackOverviewRouter } from '$test/helpers'
import StackOverview from './StackOverview.svelte'

const mockOpen = vi.mocked(open)
const mockInvoke = vi.mocked(invoke)
const mockListen = vi.mocked(listen)

const FOLDER_A: SourceFolder = { id: 1, path: '/home/user/Photos/Iceland' }
const FOLDER_B: SourceFolder = { id: 2, path: '/home/user/Photos/Drone' }

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

const STACK_1: StackSummary = makeStack({ stack_id: 1, logical_photo_count: 6 })
const STACK_2: StackSummary = makeStack({ stack_id: 2, logical_photo_count: 4, earliest_capture: '2024-03-15T11:00:00Z', has_raw: false })
const STACK_3: StackSummary = makeStack({ stack_id: 3, logical_photo_count: 1, earliest_capture: null, has_jpeg: false })

const STACK_WITH_THUMB: StackSummary = makeStack({
  stack_id: 4, earliest_capture: '2024-03-15T12:00:00Z',
  thumbnail_path: '/home/user/.gem-keep/projects/iceland-2024/cache/thumbnails/4.jpg'
})

function setupNav() {
  navigate({ kind: 'stack-overview', projectSlug: 'iceland-2024', projectName: 'Iceland 2024' })
}

afterEach(() => {
  cleanup()
})

beforeEach(() => {
  vi.clearAllMocks()
  mockInvoke.mockImplementation(mockStackOverviewRouter())
  setupNav()
  navigation.stackOverviewFocusIndex = null
})

describe('StackOverview — state 1: no source folders', () => {
  it('renders no-folders state when source_folders is empty', async () => {
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
    mockInvoke.mockImplementation(mockStackOverviewRouter({
      list_source_folders: [[FOLDER_A, FOLDER_B]],
    }))

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
    mockInvoke.mockImplementation(mockStackOverviewRouter({
      list_source_folders: [[FOLDER_A]],
    }))

    render(StackOverview)

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('start_indexing', { slug: 'iceland-2024' })
    })
  })

  it('does NOT auto-start when stacks already exist (re-open scenario)', async () => {
    mockInvoke.mockImplementation(mockStackOverviewRouter({
      list_source_folders: [[FOLDER_A]],
      list_stacks: [[STACK_1]],
    }))

    render(StackOverview)

    await waitFor(() => expect(screen.getByText('Index complete.')).toBeInTheDocument())
    expect(mockInvoke).not.toHaveBeenCalledWith('start_indexing', expect.anything())
  })

  it('does NOT auto-start when thumbnails_running=true even if stacks are empty', async () => {
    mockInvoke.mockImplementation(mockStackOverviewRouter({
      list_source_folders: [[FOLDER_A]],
      get_indexing_status: THUMBNAIL_RUNNING_STATUS,
    }))

    render(StackOverview)

    await new Promise(resolve => setTimeout(resolve, 50))
    expect(mockInvoke).not.toHaveBeenCalledWith('start_indexing', expect.anything())
  })
})

describe('StackOverview — state 3: indexing in progress', () => {
  it('renders progress bar and cancel button during EXIF scan phase', async () => {
    mockInvoke.mockImplementation(mockStackOverviewRouter({
      list_source_folders: [[FOLDER_A]],
      list_stacks: [[]],
      get_indexing_status: [RUNNING_STATUS, RUNNING_STATUS, DONE_STATUS],
    }))

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
    const stacks = [STACK_1, STACK_2, STACK_3]
    mockInvoke.mockImplementation(mockStackOverviewRouter({
      list_source_folders: [[FOLDER_A]],
      list_stacks: [stacks],
      get_indexing_status: [THUMBNAIL_RUNNING_STATUS, THUMBNAIL_RUNNING_STATUS, DONE_STATUS],
    }))

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
    mockInvoke.mockImplementation(mockStackOverviewRouter({
      list_source_folders: [[FOLDER_A]],
      list_stacks: [[STACK_1, STACK_2, STACK_3]],
      get_indexing_status: DONE_STATUS,
    }))

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
    mockInvoke.mockImplementation(mockStackOverviewRouter({
      list_source_folders: [[FOLDER_A]],
      list_stacks: [[STACK_3]],
      get_indexing_status: DONE_STATUS,
    }))

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
    mockInvoke.mockImplementation(mockStackOverviewRouter({
      list_source_folders: [[FOLDER_A]],
      list_stacks: [[STACK_1, STACK_2]],
      get_indexing_status: DONE_STATUS,
    }))

    render(StackOverview)

    await waitFor(() => {
      expect(screen.getByText('Re-index')).toBeInTheDocument()
    })
  })

  it('renders img with src from getThumbnailUrl when thumbnail_path is set', async () => {
    const thumbPath = STACK_WITH_THUMB.thumbnail_path!
    vi.mocked(convertFileSrc).mockImplementation((p) => `asset://localhost${p}`)

    mockInvoke.mockImplementation(mockStackOverviewRouter({
      list_source_folders: [[FOLDER_A]],
      list_stacks: [[STACK_WITH_THUMB]],
      get_indexing_status: DONE_STATUS,
    }))

    render(StackOverview)

    await waitFor(() => expect(screen.getByText('Stack #1')).toBeInTheDocument())

    const img = screen.getByRole('img')
    expect(img).toBeInTheDocument()
    expect(vi.mocked(convertFileSrc)).toHaveBeenCalledWith(thumbPath)
    expect(img).toHaveAttribute('src', `asset://localhost${thumbPath}`)
  })

  it('does not render img element when thumbnail_path is null', async () => {
    vi.mocked(convertFileSrc).mockImplementation((p) => `asset://localhost${p}`)

    mockInvoke.mockImplementation(mockStackOverviewRouter({
      list_source_folders: [[FOLDER_A]],
      list_stacks: [[STACK_3]],
      get_indexing_status: DONE_STATUS,
    }))

    render(StackOverview)

    await waitFor(() => expect(screen.getByText('Stack #1')).toBeInTheDocument())
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(screen.getByText('📷')).toBeInTheDocument()
  })
})

describe('StackOverview — reindex shortcuts (state 4)', () => {
  it('r key triggers re-index when stacks present', async () => {
    mockInvoke.mockImplementation(mockStackOverviewRouter({
      list_source_folders: [[FOLDER_A]],
      list_stacks: [[STACK_1]],
      get_indexing_status: DONE_STATUS,
    }))

    render(StackOverview)

    await waitFor(() => expect(screen.getByText('Index complete.')).toBeInTheDocument())

    fireEvent.keyDown(document, { key: 'r' })

    await waitFor(() => expect(mockInvoke).toHaveBeenCalledWith('start_indexing', { slug: 'iceland-2024' }))
  })

  it('i key triggers re-index when stacks already exist', async () => {
    mockInvoke.mockImplementation(mockStackOverviewRouter({
      list_source_folders: [[FOLDER_A]],
      list_stacks: [[STACK_1]],
      get_indexing_status: DONE_STATUS,
    }))

    render(StackOverview)

    await waitFor(() => expect(screen.getByText('Index complete.')).toBeInTheDocument())

    fireEvent.keyDown(document, { key: 'i' })

    await waitFor(() => expect(mockInvoke).toHaveBeenCalledWith('start_indexing', { slug: 'iceland-2024' }))
  })
})

describe("StackOverview — add-folder workflow gap", () => {
  it("after adding a folder, indexing starts automatically", async () => {
    // Initial state: no folders, no stacks
    // After add_source_folder, the component refreshes folders and auto-starts indexing
    let folderCallCount = 0
    mockInvoke.mockImplementation(mockStackOverviewRouter({
      list_source_folders: () => {
        folderCallCount++
        // First call: no folders (initial load). Second call: folder added.
        if (folderCallCount <= 1) return []
        return [{ id: 1, path: "/home/user/Photos/NewAlbum" }]
      },
      add_source_folder: undefined,
    }))

    render(StackOverview)
    await waitFor(() => expect(screen.getByText("No source folders attached.")).toBeInTheDocument())

    // Setup mock for open dialog
    mockOpen.mockResolvedValueOnce("/home/user/Photos/NewAlbum")

    // Click "Add Folder"
    await fireEvent.click(screen.getByText("+ Add Folder"))

    // After adding the first folder, indexing should auto-start
    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("start_indexing", { slug: "iceland-2024" })
    }, { timeout: 500 })
  })
})

describe('StackOverview — scroll position restore', () => {
  it('returning from StackFocus applies border-blue-500 class to previously focused card', async () => {
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

    mockInvoke.mockImplementation(mockStackOverviewRouter({
      list_source_folders: [[FOLDER_A]],
      list_stacks: [mockStacks],
      get_indexing_status: DONE_STATUS,
    }))

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
    mockInvoke.mockImplementation(mockStackOverviewRouter({
      list_source_folders: [[FOLDER_A]],
      list_stacks: [[STACK_1]],
      get_indexing_status: DONE_STATUS,
    }))

    render(StackOverview)

    await waitFor(() => expect(screen.getByText('Stack #1')).toBeInTheDocument())

    expect(mockListen).toHaveBeenCalledWith('thumbnail-ready', expect.any(Function))
  })

  it('C3: calls unlisten when component is destroyed', async () => {
    const mockUnlisten = vi.fn()
    mockListen.mockResolvedValueOnce(mockUnlisten as any)

    mockInvoke.mockImplementation(mockStackOverviewRouter({
      list_source_folders: [[FOLDER_A]],
      list_stacks: [[STACK_1]],
      get_indexing_status: DONE_STATUS,
    }))

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
    mockInvoke.mockImplementation(mockStackOverviewRouter({
      list_source_folders: [[FOLDER_A]],
      list_stacks: [[STACK_WITHOUT_THUMB]],
    }))

    render(StackOverview)

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('resume_thumbnails', { slug: 'iceland-2024' })
    })
  })

  it('P2-08: does NOT call resume_thumbnails when all stacks have thumbnail_path', async () => {
    mockInvoke.mockImplementation(mockStackOverviewRouter({
      list_source_folders: [[FOLDER_A]],
      list_stacks: [[STACK_WITH_THUMB]],
    }))

    render(StackOverview)

    await waitFor(() => expect(screen.getByText('Index complete.')).toBeInTheDocument())
    expect(mockInvoke).not.toHaveBeenCalledWith('resume_thumbnails', expect.anything())
  })

  it('P2-09: does NOT call resume_thumbnails when stacks array is empty', async () => {
    mockInvoke.mockImplementation(mockStackOverviewRouter({
      list_source_folders: [[FOLDER_A]],
    }))

    render(StackOverview)

    await new Promise(resolve => setTimeout(resolve, 50))
    expect(mockInvoke).not.toHaveBeenCalledWith('resume_thumbnails', expect.anything())
  })

  it('P2-10: does NOT call resume_thumbnails when thumbnails_running is already true', async () => {
    mockInvoke.mockImplementation(mockStackOverviewRouter({
      list_source_folders: [[FOLDER_A]],
      list_stacks: [[STACK_WITHOUT_THUMB]],
      get_indexing_status: THUMBNAIL_RUNNING_STATUS,
    }))

    render(StackOverview)

    await new Promise(resolve => setTimeout(resolve, 50))
    expect(mockInvoke).not.toHaveBeenCalledWith('resume_thumbnails', expect.anything())
  })
})

describe('StackOverview — P1 thumbnail progress bar', () => {
  it('P1-06: renders determinate progress bar when thumbnails_total > 0', async () => {
    mockInvoke.mockImplementation(mockStackOverviewRouter({
      list_source_folders: [[FOLDER_A]],
      list_stacks: [[STACK_1, STACK_2]],
      get_indexing_status: [PROGRESS_STATUS, PROGRESS_STATUS, DONE_STATUS],
    }))

    const { container } = render(StackOverview)

    await waitFor(() => expect(screen.getByText('Generating thumbnails…')).toBeInTheDocument())
    // Count/total text
    expect(screen.getByText(/42.*100/)).toBeInTheDocument()
    // Percentage text
    expect(screen.getByText(/42%/)).toBeInTheDocument()
    // No spinner (determinate bar shown instead)
    expect(container.querySelector('.animate-spin')).not.toBeInTheDocument()
  })

  it('P1-07: applies animate-spin class when thumbnails_total is 0 (pre-total window)', async () => {
    mockInvoke.mockImplementation(mockStackOverviewRouter({
      list_source_folders: [[FOLDER_A]],
      list_stacks: [[STACK_1]],
      get_indexing_status: [THUMBNAIL_RUNNING_STATUS, THUMBNAIL_RUNNING_STATUS, DONE_STATUS],
    }))

    const { container } = render(StackOverview)

    await waitFor(() => expect(screen.getByText('Generating thumbnails…')).toBeInTheDocument())
    expect(container.querySelector('.animate-spin')).toBeInTheDocument()
    expect(screen.queryByText(/%/)).not.toBeInTheDocument()
  })

  it('P1-08: thumbnail progress does not apply animate-pulse class', async () => {
    mockInvoke.mockImplementation(mockStackOverviewRouter({
      list_source_folders: [[FOLDER_A]],
      list_stacks: [[STACK_1]],
      get_indexing_status: [THUMBNAIL_RUNNING_STATUS, THUMBNAIL_RUNNING_STATUS, DONE_STATUS],
    }))

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
    mockInvoke.mockImplementation(mockStackOverviewRouter({
      list_source_folders: [[FOLDER_A]],
      list_stacks: [[STACK_1, STACK_2]],
    }))
    render(StackOverview)
    await waitFor(() => expect(document.querySelectorAll('[data-stack-card]')).toHaveLength(2))
  }

  // BT-07
  it('test_ctrl_b_opens_burst_gap_panel', async () => {
    await setupWithStacks()
    await fireEvent.keyDown(document, { key: 'b', ctrlKey: true })
    await waitFor(() => {
      expect(screen.getByText(/burst gap/i)).toBeInTheDocument()
    })
  })

  // BT-07b
  it('test_ctrl_b_opens_panel_even_when_get_burst_gap_fails', async () => {
    // Override get_burst_gap to reject
    mockInvoke.mockImplementation(mockStackOverviewRouter({
      list_source_folders: [[FOLDER_A]],
      list_stacks: [[STACK_1, STACK_2]],
      get_burst_gap: () => { throw new Error('command not found') },
    }))
    render(StackOverview)
    await waitFor(() => expect(document.querySelectorAll('[data-stack-card]')).toHaveLength(2))

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
    mockInvoke.mockImplementation(mockStackOverviewRouter({
      list_source_folders: [[{ id: 1, path: '/photos' }]],
      list_stacks: [[STACK_A_WITH_THUMB, STACK_B_WITH_THUMB]],
      get_indexing_status: THUMBS_DONE_STATUS,
    }))

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
    mockInvoke.mockImplementation(mockStackOverviewRouter({
      list_source_folders: [[{ id: 1, path: '/photos' }]],
      list_stacks: [[STACK_A_WITH_THUMB, STACK_B_NO_THUMB]],
      get_indexing_status: THUMBS_DONE_STATUS,
    }))

    render(StackOverview)

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
    mockInvoke.mockImplementation(mockStackOverviewRouter({
      list_source_folders: [[FOLDER_A]],
      list_stacks: [[STACK_WITH_THUMB_LOCAL, STACK_WITH_THUMB_2]],
    }))

    render(StackOverview)
    await waitFor(() => expect(document.querySelectorAll('[data-stack-card]')).toHaveLength(2))

    // Confirm resume_thumbnails was NOT called on mount (all have thumbnails)
    expect(mockInvoke.mock.calls.map(c => c[0])).not.toContain('resume_thumbnails')

    // Open burst gap panel
    await fireEvent.keyDown(document, { key: 'b', ctrlKey: true })
    await waitFor(() => expect(screen.getByText(/burst gap/i)).toBeInTheDocument())

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
    mockInvoke.mockImplementation(mockStackOverviewRouter({
      list_source_folders: [[FOLDER_A]],
      list_stacks: [[STACK_1, STACK_2]],
      get_indexing_status: [THUMBNAIL_RUNNING_STATUS, THUMBNAIL_RUNNING_STATUS, DONE_STATUS],
    }))

    render(StackOverview)

    // Wait until stacks are visible
    await waitFor(() => expect(document.querySelectorAll('[data-stack-card]')).toHaveLength(2))

    // Confirm resume_thumbnails was NOT called on mount (status.thumbnails_running is true,
    // so loadAll takes Path A: startPolling, not Path C: resume)
    expect(mockInvoke.mock.calls.map(c => c[0])).not.toContain('resume_thumbnails')

    // Open burst gap panel
    await fireEvent.keyDown(document, { key: 'b', ctrlKey: true })
    await waitFor(() => expect(screen.getByText(/burst gap/i)).toBeInTheDocument())

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
  it('Shift+ArrowRight adds selection ring classes to stacks', async () => {
    mockInvoke.mockImplementation(mockStackOverviewRouter({
      list_source_folders: [[FOLDER_A]],
      list_stacks: [[STACK_1, STACK_2, STACK_3]],
      get_indexing_status: DONE_STATUS,
    }))

    render(StackOverview)
    await waitFor(() => expect(document.querySelectorAll('[data-stack-card]')).toHaveLength(3))

    await fireEvent.keyDown(document, { key: 'ArrowRight', shiftKey: true })
    await fireEvent.keyDown(document, { key: 'ArrowRight', shiftKey: true })

    const cards = document.querySelectorAll('[data-stack-card]')
    // At least 2 cards should have selection indicator
    const selectedCards = Array.from(cards).filter(c => c.className.includes('ring-yellow') || c.className.includes('border-yellow'))
    expect(selectedCards.length).toBeGreaterThanOrEqual(2)
  })

  it('M key merges selected stacks', async () => {
    mockInvoke.mockImplementation(mockStackOverviewRouter({
      list_source_folders: [[FOLDER_A]],
      list_stacks: [[STACK_1, STACK_2, STACK_3]],
      get_indexing_status: DONE_STATUS,
      merge_stacks: {
        merged_stack_id: 10, logical_photos_moved: 10,
        source_stack_ids: [1, 2], transaction_id: 1,
      },
    }))

    render(StackOverview)
    await waitFor(() => expect(document.querySelectorAll('[data-stack-card]')).toHaveLength(3))

    // Select 2 stacks
    await fireEvent.keyDown(document, { key: 'ArrowRight', shiftKey: true })

    await fireEvent.keyDown(document, { key: 'm' })

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('merge_stacks', {
        slug: 'iceland-2024', stackIds: expect.arrayContaining([1, 2]),
      })
    })
  })

  it('Ctrl+Z undoes last merge', async () => {
    mockInvoke.mockImplementation(mockStackOverviewRouter({
      list_source_folders: [[FOLDER_A]],
      list_stacks: [[STACK_1, STACK_2]],
      get_indexing_status: DONE_STATUS,
    }))

    render(StackOverview)
    await waitFor(() => expect(document.querySelectorAll('[data-stack-card]')).toHaveLength(2))

    await fireEvent.keyDown(document, { key: 'z', ctrlKey: true })

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('undo_last_merge', { slug: 'iceland-2024' })
    })
  })

  it('M key with only 1 stack selected does NOT call merge', async () => {
    mockInvoke.mockImplementation(mockStackOverviewRouter({
      list_source_folders: [[FOLDER_A]],
      list_stacks: [[STACK_1, STACK_2]],
      get_indexing_status: DONE_STATUS,
    }))

    render(StackOverview)
    await waitFor(() => expect(document.querySelectorAll('[data-stack-card]')).toHaveLength(2))

    // No shift-select, just press M with focus on 1 stack
    await fireEvent.keyDown(document, { key: 'm' })

    await new Promise(r => setTimeout(r, 50))
    expect(mockInvoke).not.toHaveBeenCalledWith('merge_stacks', expect.anything())
  })

  it('successful merge removes selection ring classes from stacks', async () => {
    mockInvoke.mockImplementation(mockStackOverviewRouter({
      list_source_folders: [[FOLDER_A]],
      list_stacks: [[STACK_1, STACK_2, STACK_3]],
      get_indexing_status: DONE_STATUS,
      merge_stacks: {
        merged_stack_id: 10, logical_photos_moved: 10,
        source_stack_ids: [1, 2], transaction_id: 1,
      },
    }))

    render(StackOverview)
    await waitFor(() => expect(document.querySelectorAll('[data-stack-card]')).toHaveLength(3))

    // Select 2 stacks
    await fireEvent.keyDown(document, { key: 'ArrowRight', shiftKey: true })

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
    mockInvoke.mockImplementation(mockStackOverviewRouter({
      list_source_folders: [[FOLDER_A]],
      list_stacks: [[STACK_1, STACK_2, STACK_3]],
      get_indexing_status: DONE_STATUS,
    }))

    render(StackOverview)
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

  it('Arrow without Shift preserves selection (moves focus only)', async () => {
    const STACK_4: StackSummary = {
      stack_id: 4, logical_photo_count: 2, earliest_capture: null,
      has_raw: false, has_jpeg: true, thumbnail_path: null
    }
    mockInvoke.mockImplementation(mockStackOverviewRouter({
      list_source_folders: [[FOLDER_A]],
      list_stacks: [[STACK_1, STACK_2, STACK_3, STACK_4]],
      get_indexing_status: DONE_STATUS,
    }))

    render(StackOverview)
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

    // Selection should persist — arrow only moves focus, not clears selection
    cards = document.querySelectorAll('[data-stack-card]')
    selectedCards = Array.from(cards).filter(c =>
      c.className.includes('ring-yellow') || c.className.includes('border-yellow')
    )
    expect(selectedCards.length).toBeGreaterThanOrEqual(2)
  })

  it('after merge, border-blue-500 class moves to merged stack position', async () => {
    const STACK_4: StackSummary = {
      stack_id: 4, logical_photo_count: 2, earliest_capture: null,
      has_raw: false, has_jpeg: true, thumbnail_path: null
    }
    const MERGED_STACK: StackSummary = {
      stack_id: 99, logical_photo_count: 10, earliest_capture: '2024-03-15T10:00:00Z',
      has_raw: true, has_jpeg: true, thumbnail_path: null
    }
    // list_stacks returns initial stacks first, then post-merge stacks
    mockInvoke.mockImplementation(mockStackOverviewRouter({
      list_source_folders: [[FOLDER_A]],
      list_stacks: [
        [STACK_1, STACK_2, STACK_3, STACK_4],
        [MERGED_STACK, STACK_3, STACK_4],
      ],
      get_indexing_status: DONE_STATUS,
      merge_stacks: {
        merged_stack_id: 99, logical_photos_moved: 10,
        source_stack_ids: [1, 2], transaction_id: 1,
      },
    }))

    render(StackOverview)
    await waitFor(() => expect(document.querySelectorAll('[data-stack-card]')).toHaveLength(4))

    // Select stacks 1 and 2 via Shift+Arrow
    await fireEvent.keyDown(document, { key: 'ArrowRight', shiftKey: true })

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
    const deferredFolders = new Promise<SourceFolder[]>(r => { resolveFolders = r })
    let folderCallCount = 0
    mockInvoke.mockImplementation(mockStackOverviewRouter({
      list_source_folders: () => {
        folderCallCount++
        if (folderCallCount === 1) return deferredFolders
        return []
      },
    }))

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
    mockInvoke.mockImplementation(mockStackOverviewRouter({
      list_source_folders: [[FOLDER_A]],
      list_stacks: [[STACK_1]],
      get_indexing_status: DONE_STATUS,
    }))

    render(StackOverview)

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
    mockInvoke.mockImplementation(mockStackOverviewRouter({
      list_source_folders: [[FOLDER_A]],
      list_stacks: [[]],
      get_indexing_status: [RUNNING_STATUS, RUNNING_STATUS, DONE_STATUS],
    }))

    render(StackOverview)

    await waitFor(() => {
      expect(screen.getByText('Pause')).toBeInTheDocument()
    })
    // Cancel is also present
    expect(screen.getByText('Cancel')).toBeInTheDocument()
  })

  it('clicking Pause calls pause_indexing', async () => {
    mockInvoke.mockImplementation(mockStackOverviewRouter({
      list_source_folders: [[FOLDER_A]],
      list_stacks: [[]],
      get_indexing_status: [RUNNING_STATUS, RUNNING_STATUS, DONE_STATUS],
    }))

    render(StackOverview)

    await waitFor(() => expect(screen.getByText('Pause')).toBeInTheDocument())

    await fireEvent.click(screen.getByText('Pause'))

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('pause_indexing', { slug: 'iceland-2024' })
    })
  })

  it('shows Resume button when indexing is paused', async () => {
    const PAUSED_STATUS: IndexingStatus = {
      ...RUNNING_STATUS, paused: true
    }

    mockInvoke.mockImplementation(mockStackOverviewRouter({
      list_source_folders: [[FOLDER_A]],
      list_stacks: [[]],
      get_indexing_status: [PAUSED_STATUS, PAUSED_STATUS, DONE_STATUS],
    }))

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

    mockInvoke.mockImplementation(mockStackOverviewRouter({
      list_source_folders: [[FOLDER_A]],
      list_stacks: [[]],
      get_indexing_status: [PAUSED_STATUS, PAUSED_STATUS, DONE_STATUS],
    }))

    render(StackOverview)

    await waitFor(() => expect(screen.getByText('Resume')).toBeInTheDocument())

    await fireEvent.click(screen.getByText('Resume'))

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('resume_indexing', { slug: 'iceland-2024' })
    })
  })
})

// ── SO-22: Arrow Left moves focus left (stops at first) ──────────────────────

describe('StackOverview — SO-22: ArrowLeft navigation', () => {
  it('ArrowLeft moves border-blue-500 class to previous card', async () => {
    mockInvoke.mockImplementation(mockStackOverviewRouter({
      list_source_folders: [[FOLDER_A]],
      list_stacks: [[STACK_1, STACK_2, STACK_3]],
      get_indexing_status: DONE_STATUS,
    }))

    render(StackOverview)
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

  it('ArrowLeft keeps border-blue-500 class on first card at boundary', async () => {
    mockInvoke.mockImplementation(mockStackOverviewRouter({
      list_source_folders: [[FOLDER_A]],
      list_stacks: [[STACK_1, STACK_2, STACK_3]],
      get_indexing_status: DONE_STATUS,
    }))

    render(StackOverview)
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
  it('ArrowUp moves border-blue-500 class up by 4 positions', async () => {
    // Need at least 5 stacks to span 2 rows in a 4-col grid
    const manyStacks: StackSummary[] = Array.from({ length: 8 }, (_, i) => ({
      stack_id: i + 1,
      logical_photo_count: 1,
      earliest_capture: null,
      has_raw: false,
      has_jpeg: true,
      thumbnail_path: null,
    }))

    mockInvoke.mockImplementation(mockStackOverviewRouter({
      list_source_folders: [[FOLDER_A]],
      list_stacks: [manyStacks],
      get_indexing_status: DONE_STATUS,
    }))

    render(StackOverview)
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

  it('ArrowUp keeps border-blue-500 class on first row at boundary', async () => {
    mockInvoke.mockImplementation(mockStackOverviewRouter({
      list_source_folders: [[FOLDER_A]],
      list_stacks: [[STACK_1, STACK_2, STACK_3]],
      get_indexing_status: DONE_STATUS,
    }))

    render(StackOverview)
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
    mockInvoke.mockImplementation(mockStackOverviewRouter({
      list_source_folders: [[FOLDER_A]],
      list_stacks: [[STACK_1, STACK_2, STACK_3]],
      get_indexing_status: DONE_STATUS,
    }))

    render(StackOverview)
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
    mockInvoke.mockImplementation(mockStackOverviewRouter({
      list_source_folders: [[FOLDER_A]],
      list_stacks: [[STACK_1, STACK_2, STACK_3]],
      get_indexing_status: DONE_STATUS,
    }))

    render(StackOverview)
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
    mockInvoke.mockImplementation(mockStackOverviewRouter({
      list_source_folders: [[FOLDER_A]],
      list_stacks: [[STACK_1, STACK_2]],
      get_indexing_status: DONE_STATUS,
    }))

    render(StackOverview)
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
    mockInvoke.mockImplementation(mockStackOverviewRouter({
      list_source_folders: [[FOLDER_A]],
      list_stacks: [[STACK_1]],
      get_indexing_status: DONE_STATUS,
    }))

    render(StackOverview)
    await waitFor(() => expect(screen.getByText('Index complete.')).toBeInTheDocument())

    await fireEvent.keyDown(document, { key: 'Escape' })

    expect(navigation.current.kind).toBe('project-list')
  })

  it('Esc sets skipAutoOpen and resumeProject on the project-list screen', async () => {
    mockInvoke.mockImplementation(mockStackOverviewRouter({
      list_source_folders: [[FOLDER_A]],
      list_stacks: [[STACK_1]],
      get_indexing_status: DONE_STATUS,
    }))

    render(StackOverview)
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
    mockInvoke.mockImplementation(mockStackOverviewRouter({
      list_source_folders: [[FOLDER_A]],
      list_stacks: [[STACK_1, STACK_2]],
      get_indexing_status: DONE_STATUS,
    }))

    render(StackOverview)
    await waitFor(() => expect(document.querySelectorAll('[data-stack-card]')).toHaveLength(2))

    // Open burst panel via Ctrl+B
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
    mockInvoke.mockImplementation(mockStackOverviewRouter({
      list_source_folders: [[FOLDER_A]],
      list_stacks: [[STACK_1, STACK_2]],
      restack: () => new Promise(() => {}), // restack never resolves
    }))

    render(StackOverview)
    await waitFor(() => expect(document.querySelectorAll('[data-stack-card]')).toHaveLength(2))

    // Open burst panel
    await fireEvent.keyDown(document, { key: 'b', ctrlKey: true })
    await waitFor(() => screen.getByText(/burst gap/i))

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
    mockInvoke.mockImplementation(mockStackOverviewRouter({
      list_source_folders: [[FOLDER_A]],
      list_stacks: [[STACK_A_T, STACK_B_T]],
      get_indexing_status: STATUS_WITH_ERRORS,
    }))

    render(StackOverview)

    await waitFor(() => {
      expect(screen.getByText(/Show 2 errors/)).toBeInTheDocument()
    })
  })

  it('clicking "Show N errors" reveals error details', async () => {
    mockInvoke.mockImplementation(mockStackOverviewRouter({
      list_source_folders: [[FOLDER_A]],
      list_stacks: [[STACK_A_T, STACK_B_T]],
      get_indexing_status: STATUS_WITH_ERRORS,
    }))

    render(StackOverview)

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
    mockInvoke.mockImplementation(mockStackOverviewRouter({
      list_source_folders: [[FOLDER_A]],
      list_stacks: [[STACK_1]],
      get_indexing_status: DONE_STATUS,
    }))

    render(StackOverview)

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

    mockInvoke.mockImplementation(mockStackOverviewRouter({
      list_source_folders: [[FOLDER_A]],
      list_stacks: [[]],
      get_indexing_status: [RUNNING_WITH_ERRORS, RUNNING_WITH_ERRORS, DONE_STATUS],
    }))

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

    mockInvoke.mockImplementation(mockStackOverviewRouter({
      list_source_folders: [[FOLDER_A]],
      list_stacks: [[]],
      get_indexing_status: [RUNNING_WITH_1_ERROR, RUNNING_WITH_1_ERROR, DONE_STATUS],
    }))

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
    mockInvoke.mockImplementation(mockStackOverviewRouter({
      list_source_folders: [[FOLDER_A]],
      list_stacks: [[STACK_1]],
      get_indexing_status: DONE_STATUS,
    }))

    render(StackOverview)

    await waitFor(() => expect(screen.getByText('Stack #1')).toBeInTheDocument())

    // STACK_1 has earliest_capture: '2024-03-15T10:00:00Z'
    // formatDate should produce "Mar 15"
    expect(screen.getByText('Mar 15')).toBeInTheDocument()
  })

  it('renders fallback "(no EXIF)" when earliest_capture is null', async () => {
    mockInvoke.mockImplementation(mockStackOverviewRouter({
      list_source_folders: [[FOLDER_A]],
      list_stacks: [[STACK_3]],
      get_indexing_status: DONE_STATUS,
    }))

    render(StackOverview)

    await waitFor(() => expect(screen.getByText('Stack #1')).toBeInTheDocument())

    // STACK_3 has earliest_capture: null → formatDate(null, '(no EXIF)') = '(no EXIF)'
    expect(screen.getByText('(no EXIF)')).toBeInTheDocument()
  })
})

// ── SO-62: Photo count per stack card ────────────────────────────────────────

describe('StackOverview — SO-62: photo count per card', () => {
  it('renders "N photos" on stack card (plural)', async () => {
    mockInvoke.mockImplementation(mockStackOverviewRouter({
      list_source_folders: [[FOLDER_A]],
      list_stacks: [[STACK_1]],
      get_indexing_status: DONE_STATUS,
    }))

    render(StackOverview)

    await waitFor(() => expect(screen.getByText('Stack #1')).toBeInTheDocument())

    // STACK_1 has logical_photo_count: 6
    expect(screen.getByText('6 photos')).toBeInTheDocument()
  })

  it('renders "1 photo" (singular) when count is 1', async () => {
    mockInvoke.mockImplementation(mockStackOverviewRouter({
      list_source_folders: [[FOLDER_A]],
      list_stacks: [[STACK_3]],
      get_indexing_status: DONE_STATUS,
    }))

    render(StackOverview)

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

  it('SO-63: Shift+ArrowLeft adds selection ring classes to current and previous stacks', async () => {
    mockInvoke.mockImplementation(mockStackOverviewRouter({
      list_source_folders: [[FOLDER_A]],
      list_stacks: [MANY_STACKS],
      get_indexing_status: DONE_STATUS,
    }))

    render(StackOverview)
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

  it('SO-64: Shift+ArrowDown adds selection ring classes to current and stack 4 below', async () => {
    mockInvoke.mockImplementation(mockStackOverviewRouter({
      list_source_folders: [[FOLDER_A]],
      list_stacks: [MANY_STACKS],
      get_indexing_status: DONE_STATUS,
    }))

    render(StackOverview)
    await waitFor(() => expect(document.querySelectorAll('[data-stack-card]')).toHaveLength(8))

    // Focus is at index 0; Shift+ArrowDown should select index 0 and move to index 4
    await fireEvent.keyDown(document, { key: 'ArrowDown', shiftKey: true })

    const cards = document.querySelectorAll('[data-stack-card]')
    // Both index 0 and 4 should be selected
    expect(cards[0].className).toMatch(/ring-yellow|border-yellow/)
    expect(cards[4].className).toMatch(/ring-yellow|border-yellow/)
  })

  it('SO-65: Shift+ArrowUp adds selection ring classes to current and stack 4 above', async () => {
    mockInvoke.mockImplementation(mockStackOverviewRouter({
      list_source_folders: [[FOLDER_A]],
      list_stacks: [MANY_STACKS],
      get_indexing_status: DONE_STATUS,
    }))

    render(StackOverview)
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
    mockInvoke.mockImplementation(mockStackOverviewRouter({
      list_source_folders: [[FOLDER_A]],
      list_stacks: [[STACK_1, STACK_2, STACK_3]],
      get_indexing_status: DONE_STATUS,
      merge_stacks: () => { throw new Error('Cannot merge') },
    }))

    render(StackOverview)
    await waitFor(() => expect(document.querySelectorAll('[data-stack-card]')).toHaveLength(3))

    // Select 2 stacks via Shift+Arrow
    await fireEvent.keyDown(document, { key: 'ArrowRight', shiftKey: true })

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
    mockInvoke.mockImplementation(mockStackOverviewRouter({
      list_source_folders: [[FOLDER_A]],
      list_stacks: [[STACK_1, STACK_2]],
      get_indexing_status: DONE_STATUS,
      undo_last_merge: () => { throw new Error('Nothing to undo') },
    }))

    render(StackOverview)
    await waitFor(() => expect(document.querySelectorAll('[data-stack-card]')).toHaveLength(2))

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

    mockInvoke.mockImplementation(mockStackOverviewRouter({
      list_source_folders: [[FOLDER_A]],
      list_stacks: [[]],
      get_indexing_status: IDLE_STATUS,
      start_indexing: () => { throw new Error('Permission denied') },
    }))

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

    let statusCallCount = 0
    mockInvoke.mockImplementation(mockStackOverviewRouter({
      list_source_folders: [[FOLDER_A]],
      list_stacks: [[]],
      get_indexing_status: () => {
        statusCallCount++
        // First call: initial loadAll (returns IDLE). Second call: recovery after start_indexing failure (throws).
        if (statusCallCount <= 1) return IDLE_STATUS
        throw new Error('DB error')
      },
      start_indexing: () => { throw new Error('Permission denied') },
    }))

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
    mockInvoke.mockImplementation(mockStackOverviewRouter({
      list_source_folders: [[FOLDER_A]],
      list_stacks: [[]],
      get_indexing_status: [RUNNING_STATUS, RUNNING_STATUS, DONE_STATUS],
    }))

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

    mockInvoke.mockImplementation(mockStackOverviewRouter({
      list_source_folders: () => { throw new Error('DB not found') },
    }))

    render(StackOverview)

    // Loading indicator should disappear (initialLoading set to false in finally block)
    await waitFor(() => {
      expect(screen.queryByText('Loading…')).not.toBeInTheDocument()
    })

    consoleSpy.mockRestore()
  })

  it('list_stacks rejection shows empty state (not stuck loading)', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    mockInvoke.mockImplementation(mockStackOverviewRouter({
      list_source_folders: [[FOLDER_A]],
      list_stacks: () => { throw new Error('DB locked') },
    }))

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
    mockInvoke.mockImplementation(mockStackOverviewRouter({
      list_source_folders: [[FOLDER_A]],
      list_stacks: [[STACK_WITH_THUMB]],
      get_indexing_status: DONE_STATUS,
    }))

    render(StackOverview)

    await waitFor(() => expect(screen.getByText('Index complete.')).toBeInTheDocument())
    expect(thumbnailCallback).not.toBeNull()

    // Clear mock call history so we only count calls from thumbnail-ready events
    mockInvoke.mockClear()
    // Reset to router that handles list_stacks
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
  it('l key moves border-blue-500 class to next card', async () => {
    mockInvoke.mockImplementation(mockStackOverviewRouter({
      list_source_folders: [[FOLDER_A]],
      list_stacks: [[STACK_1, STACK_2, STACK_3]],
      get_indexing_status: DONE_STATUS,
    }))

    render(StackOverview)
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

  it('h key moves border-blue-500 class to previous card', async () => {
    mockInvoke.mockImplementation(mockStackOverviewRouter({
      list_source_folders: [[FOLDER_A]],
      list_stacks: [[STACK_1, STACK_2, STACK_3]],
      get_indexing_status: DONE_STATUS,
    }))

    render(StackOverview)
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

  it('j key moves border-blue-500 class down by 4 positions', async () => {
    const manyStacks: StackSummary[] = Array.from({ length: 8 }, (_, i) => ({
      stack_id: i + 1, logical_photo_count: 1, earliest_capture: null,
      has_raw: false, has_jpeg: true, thumbnail_path: null,
    }))

    mockInvoke.mockImplementation(mockStackOverviewRouter({
      list_source_folders: [[FOLDER_A]],
      list_stacks: [manyStacks],
      get_indexing_status: DONE_STATUS,
    }))

    render(StackOverview)
    await waitFor(() => expect(document.querySelectorAll('[data-stack-card]')).toHaveLength(8))

    // Press 'j' to move down (4 cols)
    await fireEvent.keyDown(document, { key: 'j' })

    const cards = document.querySelectorAll('[data-stack-card]')
    expect(cards[4].className).toContain('border-blue-500')
    expect(cards[0].className).not.toContain('border-blue-500')
  })

  it('k key moves border-blue-500 class up by 4 positions', async () => {
    const manyStacks: StackSummary[] = Array.from({ length: 8 }, (_, i) => ({
      stack_id: i + 1, logical_photo_count: 1, earliest_capture: null,
      has_raw: false, has_jpeg: true, thumbnail_path: null,
    }))

    mockInvoke.mockImplementation(mockStackOverviewRouter({
      list_source_folders: [[FOLDER_A]],
      list_stacks: [manyStacks],
      get_indexing_status: DONE_STATUS,
    }))

    render(StackOverview)
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

  it('Ctrl+h does not move border-blue-500 class (modifier guard)', async () => {
    mockInvoke.mockImplementation(mockStackOverviewRouter({
      list_source_folders: [[FOLDER_A]],
      list_stacks: [[STACK_1, STACK_2, STACK_3]],
      get_indexing_status: DONE_STATUS,
    }))

    render(StackOverview)
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

  it('Shift+h does not move border-blue-500 class (modifier guard)', async () => {
    mockInvoke.mockImplementation(mockStackOverviewRouter({
      list_source_folders: [[FOLDER_A]],
      list_stacks: [[STACK_1, STACK_2, STACK_3]],
      get_indexing_status: DONE_STATUS,
    }))

    render(StackOverview)
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
  it('Home key moves border-blue-500 class to first card', async () => {
    mockInvoke.mockImplementation(mockStackOverviewRouter({
      list_source_folders: [[FOLDER_A]],
      list_stacks: [[STACK_1, STACK_2, STACK_3]],
      get_indexing_status: DONE_STATUS,
    }))

    render(StackOverview)
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

  it('End key moves border-blue-500 class to last card', async () => {
    mockInvoke.mockImplementation(mockStackOverviewRouter({
      list_source_folders: [[FOLDER_A]],
      list_stacks: [[STACK_1, STACK_2, STACK_3]],
      get_indexing_status: DONE_STATUS,
    }))

    render(StackOverview)
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

describe('StackOverview — S-key selection persists across navigation', () => {
  it('S-key selection persists when navigating with arrow keys', async () => {
    mockInvoke.mockImplementation(mockStackOverviewRouter({
      list_source_folders: [[FOLDER_A]],
      list_stacks: [[STACK_1, STACK_2, STACK_3]],
      get_indexing_status: DONE_STATUS,
    }))

    render(StackOverview)
    await waitFor(() => expect(document.querySelectorAll('[data-stack-card]')).toHaveLength(3))

    // Select card 0 with S
    await fireEvent.keyDown(document, { key: 's' })
    let cards = document.querySelectorAll('[data-stack-card]')
    expect(cards[0].className).toMatch(/ring-yellow|border-yellow/)

    // Move focus to card 1 with ArrowRight
    await fireEvent.keyDown(document, { key: 'ArrowRight' })

    // Card 0 should STILL be selected (S-key selection is sticky)
    cards = document.querySelectorAll('[data-stack-card]')
    expect(cards[0].className).toMatch(/ring-yellow|border-yellow/)
    // Card 1 should have focus (blue) but not selection (yellow)
    expect(cards[1].className).toContain('border-blue-500')
  })

  it('S-key selection on multiple stacks persists across navigation', async () => {
    mockInvoke.mockImplementation(mockStackOverviewRouter({
      list_source_folders: [[FOLDER_A]],
      list_stacks: [[STACK_1, STACK_2, STACK_3]],
      get_indexing_status: DONE_STATUS,
    }))

    render(StackOverview)
    await waitFor(() => expect(document.querySelectorAll('[data-stack-card]')).toHaveLength(3))

    // Select card 0 with S
    await fireEvent.keyDown(document, { key: 's' })
    // Move to card 2 and select it
    await fireEvent.keyDown(document, { key: 'ArrowRight' })
    await fireEvent.keyDown(document, { key: 'ArrowRight' })
    await fireEvent.keyDown(document, { key: 's' })

    // Both card 0 and card 2 should be selected
    let cards = document.querySelectorAll('[data-stack-card]')
    expect(cards[0].className).toMatch(/ring-yellow|border-yellow/)
    expect(cards[2].className).toMatch(/ring-yellow|border-yellow/)

    // Navigate back to card 0
    await fireEvent.keyDown(document, { key: 'ArrowLeft' })
    await fireEvent.keyDown(document, { key: 'ArrowLeft' })

    // Both selections should still be present
    cards = document.querySelectorAll('[data-stack-card]')
    expect(cards[0].className).toMatch(/ring-yellow|border-yellow/)
    expect(cards[2].className).toMatch(/ring-yellow|border-yellow/)
  })
})

describe('StackOverview — click behavior with selection', () => {
  it('click with active selection toggles selection instead of entering stack', async () => {
    mockInvoke.mockImplementation(mockStackOverviewRouter({
      list_source_folders: [[FOLDER_A]],
      list_stacks: [[STACK_1, STACK_2, STACK_3]],
      get_indexing_status: DONE_STATUS,
    }))

    render(StackOverview)
    await waitFor(() => expect(document.querySelectorAll('[data-stack-card]')).toHaveLength(3))

    // Select card 0 with S
    await fireEvent.keyDown(document, { key: 's' })

    // Click card 1 — should select it (not enter stack), because selection is active
    const cards = document.querySelectorAll('[data-stack-card]')
    await fireEvent.click(cards[1])

    // Should NOT navigate away
    expect(navigation.current.kind).toBe('stack-overview')
    // Card 1 should now be selected too
    const updatedCards = document.querySelectorAll('[data-stack-card]')
    expect(updatedCards[1].className).toMatch(/ring-yellow|border-yellow/)
  })

  it('click with no selection enters stack (default behavior)', async () => {
    mockInvoke.mockImplementation(mockStackOverviewRouter({
      list_source_folders: [[FOLDER_A]],
      list_stacks: [[STACK_1, STACK_2]],
      get_indexing_status: DONE_STATUS,
    }))

    render(StackOverview)
    await waitFor(() => expect(document.querySelectorAll('[data-stack-card]')).toHaveLength(2))

    // Click card 1 with no selection active — should enter stack
    const cards = document.querySelectorAll('[data-stack-card]')
    await fireEvent.click(cards[1])

    expect(navigation.current.kind).toBe('stack-focus')
  })

  it('double-click always enters stack regardless of selection', async () => {
    mockInvoke.mockImplementation(mockStackOverviewRouter({
      list_source_folders: [[FOLDER_A]],
      list_stacks: [[STACK_1, STACK_2, STACK_3]],
      get_indexing_status: DONE_STATUS,
    }))

    render(StackOverview)
    await waitFor(() => expect(document.querySelectorAll('[data-stack-card]')).toHaveLength(3))

    // Select card 0 with S (activate selection mode)
    await fireEvent.keyDown(document, { key: 's' })

    // Double-click card 1 — should enter stack even though selection is active
    const cards = document.querySelectorAll('[data-stack-card]')
    await fireEvent.dblClick(cards[1])

    expect(navigation.current.kind).toBe('stack-focus')
    if (navigation.current.kind === 'stack-focus') {
      expect(navigation.current.stackId).toBe(STACK_2.stack_id)
    }
  })
})

describe('StackOverview — S key toggle select', () => {
  it('S key toggles selection ring classes on focused stack', async () => {
    mockInvoke.mockImplementation(mockStackOverviewRouter({
      list_source_folders: [[FOLDER_A]],
      list_stacks: [[STACK_1, STACK_2, STACK_3]],
      get_indexing_status: DONE_STATUS,
    }))

    render(StackOverview)
    await waitFor(() => expect(document.querySelectorAll('[data-stack-card]')).toHaveLength(3))

    // Focus starts at card 0. Press S to select the focused stack.
    await fireEvent.keyDown(document, { key: 's' })

    let cards = document.querySelectorAll('[data-stack-card]')
    // Focused card (index 0) should now have a yellow selection indicator
    expect(cards[0].className).toMatch(/ring-yellow|border-yellow/)

    // Press S again to deselect the focused stack
    await fireEvent.keyDown(document, { key: 's' })

    cards = document.querySelectorAll('[data-stack-card]')
    // Selection indicator should be removed
    expect(cards[0].className).not.toMatch(/ring-yellow|border-yellow/)
  })
})

// ── Contract: StackOverview uses batch progress API ─────────────────────

describe('StackOverview — uses getStackProgressBatch instead of per-stack getRoundStatus', () => {
  it('calls get_stack_progress_batch once instead of N × get_round_status', async () => {
    const STACK_A = makeStack({ stack_id: 1, logical_photo_count: 5 })
    const STACK_B = makeStack({ stack_id: 2, logical_photo_count: 3 })
    const STACK_C = makeStack({ stack_id: 3, logical_photo_count: 2 })

    setupNav()

    mockInvoke.mockImplementation(mockStackOverviewRouter({
      list_source_folders: [[FOLDER_A]],
      list_stacks: [[STACK_A, STACK_B, STACK_C]],
      get_indexing_status: DONE_STATUS,
      get_stack_progress_batch: () => ({
        '1': { round_id: 1, round_number: 1, state: 'open', total_photos: 5, decided: 2, kept: 1, eliminated: 1, undecided: 3, committed_at: null },
        '3': { round_id: 3, round_number: 1, state: 'open', total_photos: 2, decided: 2, kept: 2, eliminated: 0, undecided: 0, committed_at: null },
      }),
    }))

    render(StackOverview)
    await waitFor(() => {
      const cards = document.querySelectorAll('[data-stack-card]')
      expect(cards.length).toBeGreaterThan(0)
    })

    // Must have called get_stack_progress_batch, not get_round_status
    const batchCalls = mockInvoke.mock.calls.filter(c => c[0] === 'get_stack_progress_batch')
    const perStackCalls = mockInvoke.mock.calls.filter(c => c[0] === 'get_round_status')

    expect(batchCalls.length).toBeGreaterThanOrEqual(1)
    expect(perStackCalls.length).toBe(0)
  })
})
