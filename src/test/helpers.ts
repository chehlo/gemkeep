// src/test/helpers.ts
// Shared test helpers for jsdom and browser test environments.

import { vi } from 'vitest'
import { invoke } from '@tauri-apps/api/core'

const mockInvoke = vi.mocked(invoke)

// ─── FE-07: resetInvokeMock() ────────────────────────────────────────────────

/**
 * Reset the invoke mock queue and reinstall the Rule 9 throwing default.
 *
 * Call this in beforeEach() to ensure unconsumed mockResolvedValueOnce values
 * from previous tests are cleared and under-mocked commands fail loudly.
 *
 * @param allowCommands - optional map of command names that should silently
 *   resolve (e.g. `{ expand_source_scopes: undefined }` for StackOverview).
 *   All other unmocked commands throw.
 */
export function resetInvokeMock(allowCommands?: Record<string, unknown>) {
  mockInvoke.mockReset()
  mockInvoke.mockImplementation((cmd: string) => {
    if (allowCommands && cmd in allowCommands) {
      return Promise.resolve(allowCommands[cmd])
    }
    throw new Error(
      `Unmocked invoke("${cmd}"). Add mockInvoke.mockResolvedValueOnce(...) before this call.`
    )
  })
}

// ─── FE-04: renderStackOverview() ────────────────────────────────────────────

import type { SourceFolder, IndexingStatus, StackSummary, LogicalPhotoSummary, PhotoDecisionStatus, RoundStatus, PhotoDetail } from '$lib/api/index.js'
import { IDLE_STATUS, OPEN_ROUND, UNDECIDED_DECISIONS, PHOTO_DETAIL, SINGLE_VIEW_PHOTO_LIST } from '$test/fixtures'

export interface RenderStackOverviewOptions {
  folders?: SourceFolder[]
  stacks?: StackSummary[]
  status?: IndexingStatus
}

/**
 * Set up the invoke mock chain for StackOverview's loadAll() sequence,
 * then call the provided render function.
 *
 * Handles the auto-follow-up paths that loadAll() triggers:
 * - Path A: running/thumbnails_running → startPolling()
 * - Path B: folders but no stacks → auto-start indexing + startPolling()
 * - Path C: stacks with missing thumbnails → resume_thumbnails + startPolling()
 * - Path D: idle, all thumbs present → no follow-up mocks
 *
 * @param renderFn - the render function to call (from @testing-library/svelte or vitest-browser-svelte)
 * @param component - the Svelte component to render
 * @param overrides - optional overrides for folders, stacks, status
 */
export function renderStackOverview<T, R>(
  renderFn: (component: T) => R,
  component: T,
  overrides?: RenderStackOverviewOptions,
): R {
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
    // loadStackProgress() races with poll: after poll's get_indexing_status resolves,
    // loadStackProgress calls get_round_status for each stack before poll calls list_stacks.
    mockInvoke.mockResolvedValueOnce(undefined)    // resume_thumbnails
    mockInvoke.mockResolvedValueOnce(IDLE_STATUS)  // poll: get_indexing_status (terminal)
    for (let i = 0; i < stacks.length; i++) {
      mockInvoke.mockResolvedValueOnce(null)       // loadStackProgress: get_round_status
    }
    mockInvoke.mockResolvedValueOnce(stacks)       // poll: list_stacks (stops polling)
  }
  // Path D: all thumbs present, idle -> no follow-up mocks needed

  return renderFn(component)
}

// ─── FE-05: mockStackFocusMount() ────────────────────────────────────────────

/**
 * Mock the 3 invoke calls StackFocus makes on mount:
 * 1. get_round_status -> round status (fetched first for roundId)
 * 2. list_logical_photos -> photos (uses roundId from step 1)
 * 3. get_round_decisions -> decisions
 */
export function mockStackFocusMount(
  photos: LogicalPhotoSummary[],
  decisions: PhotoDecisionStatus[] = [],
  roundStatus: RoundStatus = OPEN_ROUND,
) {
  mockInvoke.mockResolvedValueOnce(roundStatus)   // get_round_status
  mockInvoke.mockResolvedValueOnce(photos)       // list_logical_photos
  mockInvoke.mockResolvedValueOnce(decisions)     // get_round_decisions
}

// ─── FE-06: mockSingleViewMount() ───────────────────────────────────────────

/**
 * Mock the standard SingleView mount sequence:
 * 1. get_photo_detail -> photo detail
 * 2. list_logical_photos -> photo list
 * 3. get_round_decisions -> decisions
 * 4. get_round_status -> round status
 */
export function mockSingleViewMount(overrides?: {
  detail?: PhotoDetail,
  photos?: LogicalPhotoSummary[],
  decisions?: PhotoDecisionStatus[],
  roundStatus?: RoundStatus,
}) {
  mockInvoke.mockResolvedValueOnce(overrides?.detail ?? PHOTO_DETAIL)       // get_photo_detail
  mockInvoke.mockResolvedValueOnce(overrides?.photos ?? SINGLE_VIEW_PHOTO_LIST)  // list_logical_photos
  mockInvoke.mockResolvedValueOnce(overrides?.decisions ?? UNDECIDED_DECISIONS)   // get_round_decisions
  mockInvoke.mockResolvedValueOnce(overrides?.roundStatus ?? OPEN_ROUND)    // get_round_status
}

// ─── Name-based mock command router ─────────────────────────────────────────

type MockRouterValue = unknown | unknown[] | ((...args: unknown[]) => unknown)

/**
 * Create a name-based mock router for invoke() calls.
 *
 * Instead of ordered mockResolvedValueOnce() queues that break when
 * components add new API calls, the router matches on the command name
 * and returns the right response regardless of call order.
 *
 * @param defaults - Record mapping command names to response values.
 *   - If a value is a function, it is called with (cmd, ...args) and its return value is resolved.
 *   - If a value is an array, items are returned sequentially; the last item is repeated forever.
 *   - Otherwise the value is resolved as-is every time.
 *   - If a command is not in the map, throws Error (Rule 9: unmocked commands must throw).
 *
 * @returns A function suitable for mockInvoke.mockImplementation().
 */
export function createMockRouter(defaults: Record<string, MockRouterValue>): (cmd: string, ...args: unknown[]) => Promise<unknown> {
  const cursors = new Map<string, number>()

  return (cmd: string, ...args: unknown[]): Promise<unknown> => {
    if (!(cmd in defaults)) {
      throw new Error(
        `Unmocked invoke("${cmd}"). Add it to the mock router defaults.`
      )
    }

    const value = defaults[cmd]

    // Function handler: call it and resolve the result
    if (typeof value === 'function') {
      return Promise.resolve((value as (...a: unknown[]) => unknown)(cmd, ...args))
    }

    // Array handler: sequential values, cycling on the last element
    if (Array.isArray(value)) {
      const cursor = cursors.get(cmd) ?? 0
      const idx = Math.min(cursor, value.length - 1)
      cursors.set(cmd, cursor + 1)
      return Promise.resolve(value[idx])
    }

    // Static value: return as-is every time
    return Promise.resolve(value)
  }
}

// ─── Per-screen router factories ─────────────────────────────────────────────

/**
 * Create a mock router pre-configured for StackOverview's command set.
 *
 * Commands: list_source_folders, list_stacks, get_indexing_status, start_indexing,
 * resume_thumbnails, expand_source_scopes, get_burst_gap, set_burst_gap, restack,
 * cancel_indexing, pause_indexing, resume_indexing, get_round_status,
 * merge_stacks, undo_last_merge, list_stack_transactions
 */
export function mockStackOverviewRouter(overrides?: Record<string, MockRouterValue>): (cmd: string, ...args: unknown[]) => Promise<unknown> {
  return createMockRouter({
    list_source_folders: () => [],
    list_stacks: () => [],
    get_indexing_status: IDLE_STATUS,
    start_indexing: undefined,
    resume_thumbnails: undefined,
    expand_source_scopes: undefined,
    get_burst_gap: 3,
    set_burst_gap: undefined,
    restack: undefined,
    cancel_indexing: undefined,
    pause_indexing: undefined,
    resume_indexing: undefined,
    get_round_status: null,
    get_stack_progress_batch: () => ({}),
    merge_stacks: undefined,
    undo_last_merge: undefined,
    list_stack_transactions: () => [],
    ...overrides,
  })
}

/**
 * Create a mock router pre-configured for StackFocus's command set.
 *
 * Commands: list_logical_photos, get_round_decisions, get_round_status,
 * make_decision, undo_decision, commit_round, get_photo_detail, list_stacks
 */
export function mockStackFocusRouter(overrides?: Record<string, MockRouterValue>): (cmd: string, ...args: unknown[]) => Promise<unknown> {
  return createMockRouter({
    list_logical_photos: [[]],
    get_round_decisions: overrides?.get_round_decisions ?? [UNDECIDED_DECISIONS],
    get_round_status: OPEN_ROUND,
    make_decision: undefined,
    undo_decision: undefined,
    commit_round: undefined,
    get_photo_detail: PHOTO_DETAIL,
    list_stacks: [[]],
    list_rounds: [OPEN_ROUND],
    ...overrides,
  })
}

/**
 * Create a mock router pre-configured for SingleView's command set.
 *
 * Commands: get_photo_detail, list_logical_photos, get_round_decisions,
 * get_round_status, make_decision, undo_decision, commit_round
 */
export function mockSingleViewRouter(overrides?: Record<string, MockRouterValue>): (cmd: string, ...args: unknown[]) => Promise<unknown> {
  return createMockRouter({
    get_photo_detail: PHOTO_DETAIL,
    list_logical_photos: [SINGLE_VIEW_PHOTO_LIST],
    get_round_decisions: [UNDECIDED_DECISIONS],
    get_round_status: OPEN_ROUND,
    make_decision: undefined,
    undo_decision: undefined,
    commit_round: undefined,
    ...overrides,
  })
}
