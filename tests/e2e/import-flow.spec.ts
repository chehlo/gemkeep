/**
 * E2E tests for the Stack Overview import flow.
 * Covers STATE 1 (no folders) → STATE 2 (folders, auto-start) →
 *         STATE 3 (indexing progress) → STATE 4 (stacks grid)
 *
 * WHY THESE TESTS EXIST — bugs they would have caught:
 *
 *   Test: "STATE 1 — shows no-folders empty state without errors"
 *     → WOULD HAVE CAUGHT: component crash when E2E mock returned null for
 *       list_source_folders (default: return null in the switch statement).
 *       The crash was silent — component just rendered nothing.
 *
 *   Test: "STATE 2 — auto-start triggers when folders present but no stacks"
 *     → WOULD HAVE CAUGHT: auto-start not triggering because mock returned null,
 *       making sourceFolders.length throw TypeError in loadAll's .catch() handler.
 *
 *   Test: "thumbnail generation banner is NOT a static full-width bar"
 *     → WOULD HAVE CAUGHT: w-full animate-pulse bar visually indistinguishable
 *       from "100% complete" — user reported "progress immediately at 100%".
 *
 * NOTE: These tests run in Chromium (not WebKitWebView). Chromium has no asset://
 * protocol handler, so thumbnail image loading (Layer 8) is tested manually.
 * See docs/manual-tests.md MT-01 for the manual asset protocol test procedure.
 */

import { test, expect, type Page } from '@playwright/test'

// ── Types (must match src/lib/api/index.ts) ──────────────────────────────────

interface SourceFolder {
  id: number
  path: string
}

interface StackSummary {
  stack_id: number
  logical_photo_count: number
  earliest_capture: string | null
  has_raw: boolean
  has_jpeg: boolean
  thumbnail_path: string | null
}

interface IndexingStatus {
  running: boolean
  thumbnails_running: boolean
  total: number
  processed: number
  errors: number
  cancelled: boolean
  paused: boolean
  last_stats: null | {
    total_files_scanned: number
    imported: number
    skipped_existing: number
    skipped_unsupported: number
    errors: number
    pairs_detected: number
    stacks_generated: number
    logical_photos: number
    error_log: string[]
  }
}

// ── Test fixtures ─────────────────────────────────────────────────────────────

const IDLE_STATUS: IndexingStatus = {
  running: false, thumbnails_running: false, total: 0, processed: 0,
  errors: 0, cancelled: false, paused: false, last_stats: null,
}

const RUNNING_STATUS: IndexingStatus = {
  running: true, thumbnails_running: false, total: 50, processed: 20,
  errors: 0, cancelled: false, paused: false, last_stats: null,
}

const DONE_STATUS: IndexingStatus = {
  running: false, thumbnails_running: false, total: 50, processed: 50,
  errors: 0, cancelled: false, paused: false,
  last_stats: {
    total_files_scanned: 50, imported: 50, skipped_existing: 0,
    skipped_unsupported: 0, errors: 0, pairs_detected: 25,
    stacks_generated: 3, logical_photos: 25, error_log: [],
  },
}

const THUMBNAIL_RUNNING_STATUS: IndexingStatus = {
  ...DONE_STATUS,
  thumbnails_running: true,
  last_stats: null,
}

const FOLDER_A: SourceFolder = { id: 1, path: '/home/user/Photos/Iceland' }

const STACK_1: StackSummary = {
  stack_id: 1, logical_photo_count: 6,
  earliest_capture: '2024-03-15T10:00:00Z',
  has_raw: true, has_jpeg: true, thumbnail_path: null,
}
const STACK_2: StackSummary = {
  stack_id: 2, logical_photo_count: 4,
  earliest_capture: '2024-03-15T11:00:00Z',
  has_raw: false, has_jpeg: true, thumbnail_path: null,
}
const STACK_3: StackSummary = {
  stack_id: 3, logical_photo_count: 1,
  earliest_capture: null,
  has_raw: true, has_jpeg: false, thumbnail_path: null,
}

// ── Mock IPC helper ───────────────────────────────────────────────────────────

/**
 * Inject a full IPC mock that handles project management AND Stack Overview commands.
 *
 * The mock is serialised as JSON by page.addInitScript() — NO functions allowed
 * in the scenario object. Use arrays of status objects for sequences.
 */
async function mockIPC(page: Page, scenario: {
  initialFolders: SourceFolder[]
  initialStacks: StackSummary[]
  initialStatus: IndexingStatus
  /** Successive statuses returned on repeated get_indexing_status polls */
  statusSequence?: IndexingStatus[]
}): Promise<void> {
  await page.addInitScript((s) => {
    const store = {
      projects: [] as Array<{
        id: number; name: string; slug: string
        created_at: string; last_opened_at: string | null
      }>,
      lastSlug: null as string | null,
      folders: [...s.initialFolders] as Array<{ id: number; path: string }>,
      stacks: [...s.initialStacks] as unknown[],
      status: s.initialStatus as unknown,
      statusSeq: s.statusSequence ?? [] as unknown[],
      statusIdx: 0,
      startIndexingCallCount: 0,
    }

    function makeSlug(name: string): string {
      return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/, '')
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(window as any).__TAURI_INTERNALS__ = { invoke: async (cmd: string, args: Record<string, unknown>) => {
      switch (cmd) {
        case 'get_last_project':
          return store.lastSlug
            ? store.projects.find(p => p.slug === store.lastSlug) ?? null
            : null

        case 'list_projects':
          return [...store.projects]

        case 'create_project': {
          const name = args.name as string
          const slug = makeSlug(name)
          const p = { id: 1, name, slug, created_at: new Date().toISOString(), last_opened_at: null }
          store.projects.push(p)
          store.lastSlug = slug
          return p
        }

        case 'open_project': {
          const p = store.projects.find(p => p.slug === (args.slug as string))
          if (!p) throw new Error('Project not found: ' + (args.slug as string))
          store.lastSlug = p.slug
          return p
        }

        case 'suggest_slug':
          return makeSlug(args.name as string)

        case 'delete_project': {
          const idx = store.projects.findIndex(p => p.slug === (args.slug as string))
          if (idx >= 0) store.projects.splice(idx, 1)
          return null
        }

        case 'list_source_folders':
          return [...store.folders]

        case 'list_stacks':
          return [...store.stacks]

        case 'get_indexing_status': {
          if (store.statusIdx < store.statusSeq.length) {
            const s = store.statusSeq[store.statusIdx++]
            store.status = s
            return s
          }
          return store.status
        }

        case 'start_indexing':
          store.startIndexingCallCount++
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ;(window as any).__startIndexingCallCount = store.startIndexingCallCount
          return undefined

        case 'cancel_indexing':
        case 'pause_indexing':
        case 'resume_indexing':
          return undefined

        case 'add_source_folder':
          store.folders.push({ id: store.folders.length + 1, path: args.path as string })
          return undefined

        case 'remove_source_folder':
          store.folders = store.folders.filter(f => f.id !== (args.folderId as number))
          return undefined

        default:
          return null
      }
    }}
  }, scenario)
}

/** Create a project and wait for StackOverview to show its name. */
async function createProject(page: Page, name: string): Promise<void> {
  await page.click('text=New Project')
  await page.fill('#project-name', name)
  await page.keyboard.press('Enter')
  await expect(page.locator('header').getByText(name)).toBeVisible({ timeout: 10_000 })
}

// ── Journey 1: STATE 1 ────────────────────────────────────────────────────────

test('Journey 1: STATE 1 — shows no-folders empty state without errors', async ({ page }) => {
  // WHY: mock previously returned null for list_source_folders (default case),
  // causing sourceFolders.length to throw, crashing the component silently.
  const errors: string[] = []
  page.on('pageerror', e => errors.push(e.message))

  await mockIPC(page, {
    initialFolders: [],
    initialStacks: [],
    initialStatus: IDLE_STATUS,
  })
  await page.goto('/')
  await createProject(page, 'Empty Project')

  await expect(page.getByText('No source folders attached.')).toBeVisible({ timeout: 5_000 })
  await expect(page.getByText('+ Add Folder')).toBeVisible()

  // No progress bar in STATE 1
  await expect(page.locator('.animate-pulse').or(page.locator('.animate-spin'))).not.toBeVisible()

  // No runtime errors
  const relevant = errors.filter(e => !e.includes('ResizeObserver'))
  expect(relevant).toHaveLength(0)
})

// ── Journey 2: STATE 2 / auto-start ──────────────────────────────────────────

test('Journey 2: STATE 2 — auto-start triggers when folders present but no stacks', async ({ page }) => {
  // WHY: auto-start was not working because component crashed before checking folders.
  // This test verifies start_indexing is called automatically.
  await mockIPC(page, {
    initialFolders: [FOLDER_A],
    initialStacks: [],
    initialStatus: IDLE_STATUS,
    statusSequence: [IDLE_STATUS],  // poll immediately returns done
  })
  await page.goto('/')
  await createProject(page, 'Auto Start Test')

  // Verify start_indexing was called automatically within a reasonable timeout
  await page.waitForFunction(
    () => (window as unknown as Record<string, number>).__startIndexingCallCount > 0,
    { timeout: 5_000 },
  )
})

// ── Journey 3: STATE 3 / progress during indexing ────────────────────────────

test('Journey 3: STATE 3 — progress visible during indexing (or STATE 4 if fast)', async ({ page }) => {
  await mockIPC(page, {
    initialFolders: [FOLDER_A],
    initialStacks: [],
    initialStatus: IDLE_STATUS,
    statusSequence: [RUNNING_STATUS, DONE_STATUS],
  })
  await page.goto('/')
  await createProject(page, 'Progress Test')

  // Either we catch STATE 3 (Indexing…) or it jumped straight to STATE 4 (Index complete.)
  // Both are valid — we just verify no crash and sensible rendering
  await expect(
    page.getByText('Indexing…').or(page.getByText('Index complete.')),
  ).toBeVisible({ timeout: 5_000 })
})

// ── Journey 4: STATE 4 / stack grid ──────────────────────────────────────────

test('Journey 4: STATE 4 — stack grid visible after indexing completes', async ({ page }) => {
  await mockIPC(page, {
    initialFolders: [FOLDER_A],
    initialStacks: [STACK_1, STACK_2, STACK_3],
    initialStatus: DONE_STATUS,
  })
  await page.goto('/')
  await createProject(page, 'Stack Grid Test')

  await expect(page.getByText('Index complete.')).toBeVisible({ timeout: 5_000 })
  await expect(page.getByText('Stack #1')).toBeVisible()
  await expect(page.getByText('Stack #2')).toBeVisible()
  await expect(page.getByText('Stack #3')).toBeVisible()
  await expect(page.getByText('Re-index')).toBeVisible()
})

// ── Journey 5: thumbnail banner visual correctness ───────────────────────────

test('Journey 5: thumbnail generation banner is NOT a static full-width bar', async ({ page }) => {
  // WHY: `w-full animate-pulse` looks identical to a "100% complete" progress bar.
  // User saw "progress immediately at 100%" — root cause was this CSS.
  // The fix: use a spinner or a clearly indeterminate animation, never w-full.
  await mockIPC(page, {
    initialFolders: [FOLDER_A],
    initialStacks: [STACK_1, STACK_2],
    initialStatus: THUMBNAIL_RUNNING_STATUS,
  })
  await page.goto('/')
  await createProject(page, 'Thumbnail Progress Test')

  await expect(page.getByText('Generating thumbnails…')).toBeVisible({ timeout: 5_000 })

  // The progress indicator inside the thumbnail banner must NOT be w-full.
  // w-full makes it look like a static 100% complete bar.
  const pulsingBar = page.locator('.animate-pulse').first()
  const spinningEl = page.locator('.animate-spin').first()

  // At least one animated element should be present
  const hasPulse = await pulsingBar.isVisible().catch(() => false)
  const hasSpin = await spinningEl.isVisible().catch(() => false)
  expect(hasPulse || hasSpin).toBe(true)

  // If there's a pulsing bar, it must not span the full width
  if (hasPulse) {
    const classes = await pulsingBar.getAttribute('class')
    expect(classes).not.toContain('w-full')
  }
})
