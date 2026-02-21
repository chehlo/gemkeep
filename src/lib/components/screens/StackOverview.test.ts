// src/lib/components/screens/StackOverview.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/svelte'
import { invoke } from '@tauri-apps/api/core'
import { navigate } from '$lib/stores/navigation.svelte.js'
import type { SourceFolder, IndexingStatus, StackSummary } from '$lib/api/index.js'
import StackOverview from './StackOverview.svelte'

const mockInvoke = vi.mocked(invoke)

const FOLDER_A: SourceFolder = { id: 1, path: '/home/user/Photos/Iceland' }
const FOLDER_B: SourceFolder = { id: 2, path: '/home/user/Photos/Drone' }

const IDLE_STATUS: IndexingStatus = {
  running: false, total: 0, processed: 0, errors: 0, cancelled: false, last_stats: null
}

const RUNNING_STATUS: IndexingStatus = {
  running: true, total: 1290, processed: 340, errors: 0, cancelled: false, last_stats: null
}

const DONE_STATUS: IndexingStatus = {
  running: false, total: 1290, processed: 1290, errors: 0, cancelled: false,
  last_stats: {
    total_files_scanned: 1290, imported: 1280, skipped_existing: 0,
    skipped_unsupported: 10, errors: 0, pairs_detected: 640,
    stacks_generated: 3, logical_photos: 640, error_log: []
  }
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

function setupNav() {
  navigate({ kind: 'stack-overview', projectSlug: 'iceland-2024', projectName: 'Iceland 2024' })
}

beforeEach(() => {
  vi.clearAllMocks()
  setupNav()
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

describe('StackOverview — state 2: folders attached, not indexed', () => {
  it('renders folder list with × buttons when folders attached', async () => {
    mockInvoke.mockResolvedValueOnce([FOLDER_A, FOLDER_B]) // list_source_folders
    mockInvoke.mockResolvedValueOnce([])                   // list_stacks
    mockInvoke.mockResolvedValueOnce(IDLE_STATUS)          // get_indexing_status

    render(StackOverview)

    await waitFor(() => {
      expect(screen.getByText('/home/user/Photos/Iceland')).toBeInTheDocument()
    })
    expect(screen.getByText('/home/user/Photos/Drone')).toBeInTheDocument()
    // × buttons present (one per folder)
    const removeButtons = screen.getAllByTitle('Remove folder')
    expect(removeButtons).toHaveLength(2)
  })

  it('renders Index button when folders present but not indexed', async () => {
    mockInvoke.mockResolvedValueOnce([FOLDER_A]) // list_source_folders
    mockInvoke.mockResolvedValueOnce([])         // list_stacks
    mockInvoke.mockResolvedValueOnce(IDLE_STATUS) // get_indexing_status

    render(StackOverview)

    await waitFor(() => {
      expect(screen.getByText('Index Photos')).toBeInTheDocument()
    })
  })
})

const THUMBNAIL_STATUS: IndexingStatus = {
  running: true, total: 1290, processed: 1290, errors: 0, cancelled: false, last_stats: null
}

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

  it('renders "Generating thumbnails…" when processed >= total but still running', async () => {
    mockInvoke.mockResolvedValueOnce([FOLDER_A])      // list_source_folders
    mockInvoke.mockResolvedValueOnce([])              // list_stacks
    mockInvoke.mockResolvedValueOnce(THUMBNAIL_STATUS) // processed=total, running=true

    render(StackOverview)

    await waitFor(() => {
      expect(screen.getByText('Generating thumbnails…')).toBeInTheDocument()
    })
    expect(screen.getByText('Cancel')).toBeInTheDocument()
    // EXIF progress text not shown in thumbnail phase
    expect(screen.queryByText(/1,290.*1,290/)).not.toBeInTheDocument()
    // File count is shown differently
    expect(screen.getByText(/1,290 files indexed/)).toBeInTheDocument()
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
})
