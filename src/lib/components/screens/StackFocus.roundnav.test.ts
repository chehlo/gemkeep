// src/lib/components/screens/StackFocus.roundnav.test.ts
// Sprint 10 Phase D: RED tests for StackFocus header + keyboard round navigation (B13–B23)
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/svelte'
import { invoke } from '@tauri-apps/api/core'
import { navigate } from '$lib/stores/navigation.svelte.js'
import { mockStackFocusRouter } from '$test/helpers'
import {
  PHOTO_1, PHOTO_2, PHOTO_3,
  makeRoundSummary, makeRoundStatus, makeDecisionList,
  THREE_ROUND_LIST, ROUND_1_COMMITTED, ROUND_3_OPEN,
  UNDECIDED_DECISIONS,
} from '$test/fixtures'
import StackFocus from './StackFocus.svelte'
import type { RoundSummary, RoundStatus } from '$lib/api/index.js'

const mockInvoke = vi.mocked(invoke)

const mockPhotos = [PHOTO_1, PHOTO_2, PHOTO_3]

function setupNav() {
  navigate({
    kind: 'stack-focus',
    projectSlug: 'test-project',
    projectName: 'Test Project',
    stackId: 1,
  })
}

/** Helper: render StackFocus with given rounds and round status, wait for load */
async function renderWithRounds(opts: {
  rounds: RoundSummary[]
  roundStatus: RoundStatus
  currentRoundId?: number
}) {
  const { rounds, roundStatus } = opts
  mockInvoke.mockImplementation(mockStackFocusRouter({
    list_logical_photos: [mockPhotos],
    get_round_status: roundStatus,
    get_round_decisions: [UNDECIDED_DECISIONS],
    list_rounds: [rounds],
  }))

  render(StackFocus)

  await waitFor(() => {
    expect(screen.getAllByTestId('photo-card').length).toBeGreaterThan(0)
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  setupNav()
})

// ─── B13: Compact status format ─────────────────────────────────────────────

describe('StackFocus — compact status', () => {
  it('B13: compact status shows data-testid="compact-status" with checkmark/x/? format', async () => {
    const roundStatus = makeRoundStatus({
      round_id: 3, round_number: 3, state: 'open',
      total_photos: 3, kept: 1, eliminated: 1, undecided: 1, decided: 2,
    })

    await renderWithRounds({
      rounds: THREE_ROUND_LIST,
      roundStatus,
    })

    const compactStatus = screen.getByTestId('compact-status')
    expect(compactStatus).toBeInTheDocument()
    // Should show counts in ✓ ✗ ? format
    const text = compactStatus.textContent ?? ''
    expect(text).toContain('✓')
    expect(text).toContain('✗')
    expect(text).toContain('?')
  })
})

// ─── B14: Read-only indicator for historical rounds ─────────────────────────

describe('StackFocus — historical round header', () => {
  it('B14: historical round → data-testid="read-only-indicator" and "read-only-hint"', async () => {
    const roundStatus = makeRoundStatus({
      round_id: 1, round_number: 1, state: 'committed',
      total_photos: 5, decided: 5, kept: 3, eliminated: 2, undecided: 0,
      committed_at: '2024-01-15T12:00:00Z',
    })

    await renderWithRounds({
      rounds: THREE_ROUND_LIST,
      roundStatus,
    })

    expect(screen.getByTestId('read-only-indicator')).toBeInTheDocument()
    expect(screen.getByTestId('read-only-hint')).toBeInTheDocument()
  })
})


// ─── B16: RoundTabBar placement ─────────────────────────────────────────────

describe('StackFocus — layout', () => {
  it('B16: round-tab-bar is inside <header>, NOT inside <main>', async () => {
    await renderWithRounds({
      rounds: THREE_ROUND_LIST,
      roundStatus: makeRoundStatus({ round_id: 3, round_number: 3, state: 'open' }),
    })

    const tabBar = screen.getByTestId('round-tab-bar')
    // Walk up to find if it's inside a <header> element
    let el: HTMLElement | null = tabBar as HTMLElement
    let insideHeader = false
    let insideMain = false
    while (el) {
      if (el.tagName === 'HEADER') insideHeader = true
      if (el.tagName === 'MAIN') insideMain = true
      el = el.parentElement
    }

    expect(insideHeader).toBe(true)
    expect(insideMain).toBe(false)
  })
})

// ─── B17–B23: Keyboard round navigation ─────────────────────────────────────

describe('StackFocus — keyboard round navigation', () => {
  /** Make non-sequential round list */
  function makeNonSequentialRounds(): RoundSummary[] {
    return [
      makeRoundSummary({ round_id: 1, round_number: 1, state: 'committed', committed_at: '2024-01-15T12:00:00Z' }),
      makeRoundSummary({ round_id: 3, round_number: 2, state: 'committed', committed_at: '2024-01-15T13:00:00Z' }),
      makeRoundSummary({ round_id: 5, round_number: 3, state: 'open' }),
    ]
  }

  it('B17: [ with non-sequential IDs [1,3,5] viewing id=5 → navigates to id=3', async () => {
    const rounds = makeNonSequentialRounds()
    const roundStatus = makeRoundStatus({ round_id: 5, round_number: 3, state: 'open' })

    // Track which round_id is requested in list_logical_photos
    const invokedRoundIds: number[] = []
    mockInvoke.mockImplementation(mockStackFocusRouter({
      list_logical_photos: (cmd: string, ...args: unknown[]) => {
        const params = args[0] as Record<string, unknown> | undefined
        if (params?.roundId) invokedRoundIds.push(params.roundId as number)
        return mockPhotos
      },
      get_round_status: roundStatus,
      get_round_decisions: [UNDECIDED_DECISIONS],
      list_rounds: [rounds],
    }))

    render(StackFocus)
    await waitFor(() => {
      expect(screen.getAllByTestId('photo-card').length).toBeGreaterThan(0)
    })

    // Press [ to go to previous round
    await fireEvent.keyDown(window, { key: '[' })

    // Should have navigated to round_id=3 (the one before id=5 by index, not id-1=4)
    await waitFor(() => {
      expect(invokedRoundIds).toContain(3)
    })
  })

  it('B18: ] with non-sequential IDs viewing id=1 → navigates to id=3', async () => {
    const rounds = makeNonSequentialRounds()
    const roundStatus = makeRoundStatus({
      round_id: 1, round_number: 1, state: 'committed',
      committed_at: '2024-01-15T12:00:00Z',
    })

    const invokedRoundIds: number[] = []
    mockInvoke.mockImplementation(mockStackFocusRouter({
      list_logical_photos: (cmd: string, ...args: unknown[]) => {
        const params = args[0] as Record<string, unknown> | undefined
        if (params?.roundId) invokedRoundIds.push(params.roundId as number)
        return mockPhotos
      },
      get_round_status: roundStatus,
      get_round_decisions: [UNDECIDED_DECISIONS],
      list_rounds: [rounds],
    }))

    render(StackFocus)
    await waitFor(() => {
      expect(screen.getAllByTestId('photo-card').length).toBeGreaterThan(0)
    })

    // Press ] to go to next round
    await fireEvent.keyDown(window, { key: ']' })

    await waitFor(() => {
      expect(invokedRoundIds).toContain(3)
    })
  })

  it('B19: ] on last committed → jumps to open round', async () => {
    const rounds = makeNonSequentialRounds()
    // Viewing round_id=3 which is the last committed
    const roundStatus = makeRoundStatus({
      round_id: 3, round_number: 2, state: 'committed',
      committed_at: '2024-01-15T13:00:00Z',
    })

    const invokedRoundIds: number[] = []
    mockInvoke.mockImplementation(mockStackFocusRouter({
      list_logical_photos: (cmd: string, ...args: unknown[]) => {
        const params = args[0] as Record<string, unknown> | undefined
        if (params?.roundId) invokedRoundIds.push(params.roundId as number)
        return mockPhotos
      },
      get_round_status: roundStatus,
      get_round_decisions: [UNDECIDED_DECISIONS],
      list_rounds: [rounds],
    }))

    render(StackFocus)
    await waitFor(() => {
      expect(screen.getAllByTestId('photo-card').length).toBeGreaterThan(0)
    })

    // Press ] → should jump to open round (id=5)
    await fireEvent.keyDown(window, { key: ']' })

    await waitFor(() => {
      expect(invokedRoundIds).toContain(5)
    })
  })

  it('B20: ] on open round → no-op (no additional API calls)', async () => {
    const rounds = makeNonSequentialRounds()
    const roundStatus = makeRoundStatus({ round_id: 5, round_number: 3, state: 'open' })

    let invokeCountAfterMount = 0
    let mounted = false

    mockInvoke.mockImplementation(mockStackFocusRouter({
      list_logical_photos: () => {
        if (mounted) invokeCountAfterMount++
        return mockPhotos
      },
      get_round_status: roundStatus,
      get_round_decisions: () => {
        if (mounted) invokeCountAfterMount++
        return UNDECIDED_DECISIONS
      },
      list_rounds: [rounds],
    }))

    render(StackFocus)
    await waitFor(() => {
      expect(screen.getAllByTestId('photo-card').length).toBeGreaterThan(0)
    })

    mounted = true
    invokeCountAfterMount = 0

    // Press ] on open round — should be a no-op
    await fireEvent.keyDown(window, { key: ']' })

    // Wait a tick to ensure nothing fired
    await new Promise(r => setTimeout(r, 50))
    expect(invokeCountAfterMount).toBe(0)
  })

  it('B21: [ on first round → no-op', async () => {
    const rounds = makeNonSequentialRounds()
    // Viewing the first round (id=1)
    const roundStatus = makeRoundStatus({
      round_id: 1, round_number: 1, state: 'committed',
      committed_at: '2024-01-15T12:00:00Z',
    })

    let invokeCountAfterMount = 0
    let mounted = false

    mockInvoke.mockImplementation(mockStackFocusRouter({
      list_logical_photos: () => {
        if (mounted) invokeCountAfterMount++
        return mockPhotos
      },
      get_round_status: roundStatus,
      get_round_decisions: () => {
        if (mounted) invokeCountAfterMount++
        return UNDECIDED_DECISIONS
      },
      list_rounds: [rounds],
    }))

    render(StackFocus)
    await waitFor(() => {
      expect(screen.getAllByTestId('photo-card').length).toBeGreaterThan(0)
    })

    mounted = true
    invokeCountAfterMount = 0

    // Press [ on first round — should be a no-op
    await fireEvent.keyDown(window, { key: '[' })

    await new Promise(r => setTimeout(r, 50))
    expect(invokeCountAfterMount).toBe(0)
  })

  it('B22: Ctrl+] from R1 → jumps to open R3 (id=5)', async () => {
    const rounds = makeNonSequentialRounds()
    const roundStatus = makeRoundStatus({
      round_id: 1, round_number: 1, state: 'committed',
      committed_at: '2024-01-15T12:00:00Z',
    })

    const invokedRoundIds: number[] = []
    mockInvoke.mockImplementation(mockStackFocusRouter({
      list_logical_photos: (cmd: string, ...args: unknown[]) => {
        const params = args[0] as Record<string, unknown> | undefined
        if (params?.roundId) invokedRoundIds.push(params.roundId as number)
        return mockPhotos
      },
      get_round_status: roundStatus,
      get_round_decisions: [UNDECIDED_DECISIONS],
      list_rounds: [rounds],
    }))

    render(StackFocus)
    await waitFor(() => {
      expect(screen.getAllByTestId('photo-card').length).toBeGreaterThan(0)
    })

    // Ctrl+] should jump directly to the open round
    await fireEvent.keyDown(window, { key: ']', ctrlKey: true })

    await waitFor(() => {
      expect(invokedRoundIds).toContain(5) // open round id
    })
  })

  it('B23: [ guard uses index not ID (id=5 at idx=0 is no-op)', async () => {
    // A round list where the first round has id=5
    const rounds: RoundSummary[] = [
      makeRoundSummary({ round_id: 5, round_number: 1, state: 'committed', committed_at: '2024-01-15T12:00:00Z' }),
      makeRoundSummary({ round_id: 8, round_number: 2, state: 'committed', committed_at: '2024-01-15T13:00:00Z' }),
      makeRoundSummary({ round_id: 12, round_number: 3, state: 'open' }),
    ]
    // Viewing the first round (id=5, but at index 0)
    const roundStatus = makeRoundStatus({
      round_id: 5, round_number: 1, state: 'committed',
      committed_at: '2024-01-15T12:00:00Z',
    })

    let invokeCountAfterMount = 0
    let mounted = false

    mockInvoke.mockImplementation(mockStackFocusRouter({
      list_logical_photos: () => {
        if (mounted) invokeCountAfterMount++
        return mockPhotos
      },
      get_round_status: roundStatus,
      get_round_decisions: () => {
        if (mounted) invokeCountAfterMount++
        return UNDECIDED_DECISIONS
      },
      list_rounds: [rounds],
    }))

    render(StackFocus)
    await waitFor(() => {
      expect(screen.getAllByTestId('photo-card').length).toBeGreaterThan(0)
    })

    mounted = true
    invokeCountAfterMount = 0

    // Press [ — id=5 > 1, but it's at index 0, so it should be a no-op
    // The OLD code checks `currentRoundId > 1` which would pass since 5 > 1
    // The NEW code should check index === 0 instead
    await fireEvent.keyDown(window, { key: '[' })

    await new Promise(r => setTimeout(r, 50))
    expect(invokeCountAfterMount).toBe(0)
  })
})

// ─── Phase 2: Status bar fixes ─────────────────────────────────────────────

describe('StackFocus — status bar fixes', () => {
  it('compact status shows per-round counts for historical round', async () => {
    const rounds: RoundSummary[] = [
      makeRoundSummary({ round_id: 1, round_number: 1, state: 'committed', committed_at: '2024-01-15T12:00:00Z', kept: 5, eliminated: 3, undecided: 0, total: 8 }),
      makeRoundSummary({ round_id: 2, round_number: 2, state: 'open', kept: 2, eliminated: 1, undecided: 5, total: 8 }),
    ]
    // getRoundStatus always returns the latest (open) round
    const roundStatus = makeRoundStatus({
      round_id: 1, round_number: 1, state: 'committed',
      total_photos: 8, kept: 5, eliminated: 3, undecided: 0,
      committed_at: '2024-01-15T12:00:00Z',
    })

    mockInvoke.mockImplementation(mockStackFocusRouter({
      list_logical_photos: [mockPhotos],
      get_round_status: roundStatus,
      get_round_decisions: [makeDecisionList(['keep', 'keep', 'keep'])],
      list_rounds: [rounds],
    }))

    render(StackFocus)
    await waitFor(() => {
      expect(screen.getAllByTestId('photo-card').length).toBeGreaterThan(0)
    })

    // currentRoundId = roundStatus.round_id = 1 (R1, historical)
    const compact = screen.getByTestId('compact-status')
    expect(compact.textContent).toContain('5')
    expect(compact.textContent).toContain('3')
    expect(compact.textContent).toContain('0')
  })

  it('compact status shows current round counts for open round', async () => {
    const rounds: RoundSummary[] = [
      makeRoundSummary({ round_id: 1, round_number: 1, state: 'committed', committed_at: '2024-01-15T12:00:00Z', kept: 5, eliminated: 3, undecided: 0, total: 8 }),
      makeRoundSummary({ round_id: 2, round_number: 2, state: 'open', kept: 2, eliminated: 1, undecided: 5, total: 8 }),
    ]
    const roundStatus = makeRoundStatus({
      round_id: 2, round_number: 2, state: 'open',
      total_photos: 8, kept: 2, eliminated: 1, undecided: 5,
    })

    mockInvoke.mockImplementation(mockStackFocusRouter({
      list_logical_photos: [mockPhotos],
      get_round_status: roundStatus,
      get_round_decisions: [UNDECIDED_DECISIONS],
      list_rounds: [rounds],
    }))

    render(StackFocus)
    await waitFor(() => {
      expect(screen.getAllByTestId('photo-card').length).toBeGreaterThan(0)
    })

    const compact = screen.getByTestId('compact-status')
    expect(compact.textContent).toContain('2')
    expect(compact.textContent).toContain('1')
    expect(compact.textContent).toContain('5')
  })

  it('read-only hint shows open round number', async () => {
    const rounds: RoundSummary[] = [
      makeRoundSummary({ round_id: 1, round_number: 1, state: 'committed', committed_at: '2024-01-15T12:00:00Z' }),
      makeRoundSummary({ round_id: 2, round_number: 2, state: 'committed', committed_at: '2024-01-15T13:00:00Z' }),
      makeRoundSummary({ round_id: 3, round_number: 3, state: 'open' }),
    ]
    // Viewing R1, which is historical
    const roundStatus = makeRoundStatus({
      round_id: 1, round_number: 1, state: 'committed',
      committed_at: '2024-01-15T12:00:00Z',
    })

    mockInvoke.mockImplementation(mockStackFocusRouter({
      list_logical_photos: [mockPhotos],
      get_round_status: roundStatus,
      get_round_decisions: [makeDecisionList(['keep', 'keep', 'keep'])],
      list_rounds: [rounds],
    }))

    render(StackFocus)
    await waitFor(() => {
      expect(screen.getAllByTestId('photo-card').length).toBeGreaterThan(0)
    })

    const hint = screen.getByTestId('read-only-hint')
    expect(hint.textContent).toContain('R3')
  })

  it('tab bar hidden when only 1 round', async () => {
    const singleRound: RoundSummary[] = [
      makeRoundSummary({ round_id: 1, round_number: 1, state: 'open' }),
    ]
    const roundStatus = makeRoundStatus({
      round_id: 1, round_number: 1, state: 'open',
      total_photos: 3, kept: 0, eliminated: 0, undecided: 3,
    })

    mockInvoke.mockImplementation(mockStackFocusRouter({
      list_logical_photos: [mockPhotos],
      get_round_status: roundStatus,
      get_round_decisions: [UNDECIDED_DECISIONS],
      list_rounds: [singleRound],
    }))

    render(StackFocus)
    await waitFor(() => {
      expect(screen.getAllByTestId('photo-card').length).toBeGreaterThan(0)
    })

    expect(screen.queryByTestId('round-tab-bar')).toBeNull()
  })

  it('eliminated photo stays in grid with eliminate status', async () => {
    const rounds: RoundSummary[] = [
      makeRoundSummary({ round_id: 1, round_number: 1, state: 'open', total: 3, kept: 1, eliminated: 1, undecided: 1 }),
    ]
    const roundStatus = makeRoundStatus({
      round_id: 1, round_number: 1, state: 'open',
      total_photos: 3, kept: 1, eliminated: 1, undecided: 1, decided: 2,
    })
    const decisionsWithEliminated = makeDecisionList(['keep', 'eliminate', 'undecided'])

    mockInvoke.mockImplementation(mockStackFocusRouter({
      list_logical_photos: [mockPhotos],
      get_round_status: roundStatus,
      get_round_decisions: [decisionsWithEliminated],
      list_rounds: [rounds],
    }))

    render(StackFocus)
    await waitFor(() => {
      expect(screen.getAllByTestId('photo-card').length).toBe(3)
    })

    // All 3 photos remain in grid — eliminated photo is NOT removed
    const cards = screen.getAllByTestId('photo-card')
    expect(cards).toHaveLength(3)
  })

  it('rounds array refreshed after commit', async () => {
    const rounds: RoundSummary[] = [
      makeRoundSummary({ round_id: 1, round_number: 1, state: 'open', total: 3 }),
    ]
    const roundStatusAfterCommit = makeRoundStatus({
      round_id: 2, round_number: 2, state: 'open',
      total_photos: 2, kept: 0, eliminated: 0, undecided: 2,
    })

    let listRoundsCallCount = 0
    mockInvoke.mockImplementation(mockStackFocusRouter({
      list_logical_photos: [mockPhotos, mockPhotos, mockPhotos.slice(0, 2)],
      get_round_status: [
        makeRoundStatus({ round_id: 1, round_number: 1, state: 'open', total_photos: 3, decided: 3, kept: 2, eliminated: 1, undecided: 0 }),
        roundStatusAfterCommit,
      ],
      get_round_decisions: [
        makeDecisionList(['keep', 'keep', 'eliminate']),
        UNDECIDED_DECISIONS,
        UNDECIDED_DECISIONS,
      ],
      list_rounds: (_cmd: string) => {
        listRoundsCallCount++
        if (listRoundsCallCount === 1) return rounds
        // After commit, return updated rounds
        return [
          makeRoundSummary({ round_id: 1, round_number: 1, state: 'committed', committed_at: '2024-01-15T12:00:00Z' }),
          makeRoundSummary({ round_id: 2, round_number: 2, state: 'open' }),
        ]
      },
      commit_round: undefined,
    }))

    render(StackFocus)
    await waitFor(() => {
      expect(screen.getAllByTestId('photo-card').length).toBeGreaterThan(0)
    })

    const callsBefore = listRoundsCallCount

    // Commit round via Ctrl+Enter
    await fireEvent.keyDown(window, { key: 'Enter', ctrlKey: true })

    await waitFor(() => {
      // listRounds should have been called again after commit
      expect(listRoundsCallCount).toBeGreaterThan(callsBefore)
    })
  })

  it('] key works after committing a round', async () => {
    const initialRounds: RoundSummary[] = [
      makeRoundSummary({ round_id: 1, round_number: 1, state: 'open', total: 3 }),
    ]
    const roundStatusAfterCommit = makeRoundStatus({
      round_id: 2, round_number: 2, state: 'open',
      total_photos: 2, kept: 0, eliminated: 0, undecided: 2,
    })
    const postCommitRounds: RoundSummary[] = [
      makeRoundSummary({ round_id: 1, round_number: 1, state: 'committed', committed_at: '2024-01-15T12:00:00Z' }),
      makeRoundSummary({ round_id: 2, round_number: 2, state: 'open' }),
    ]

    let commitCalled = false
    let listRoundsCallCount = 0
    const invokedRoundIds: number[] = []

    mockInvoke.mockImplementation(mockStackFocusRouter({
      list_logical_photos: (cmd: string, ...args: unknown[]) => {
        const params = args[0] as Record<string, unknown> | undefined
        if (params?.roundId) invokedRoundIds.push(params.roundId as number)
        return mockPhotos
      },
      get_round_status: [
        makeRoundStatus({ round_id: 1, round_number: 1, state: 'open', total_photos: 3, decided: 3, kept: 2, eliminated: 1, undecided: 0 }),
        roundStatusAfterCommit,
        roundStatusAfterCommit,
      ],
      get_round_decisions: [UNDECIDED_DECISIONS],
      list_rounds: () => {
        listRoundsCallCount++
        if (!commitCalled) return initialRounds
        return postCommitRounds
      },
      commit_round: () => { commitCalled = true; return undefined },
    }))

    render(StackFocus)
    await waitFor(() => {
      expect(screen.getAllByTestId('photo-card').length).toBeGreaterThan(0)
    })

    // Commit the round — should navigate to round 2 and refresh rounds
    await fireEvent.keyDown(window, { key: 'Enter', ctrlKey: true })
    await waitFor(() => {
      expect(commitCalled).toBe(true)
    })

    // Now navigate backwards with [ to round 1
    await fireEvent.keyDown(window, { key: '[' })

    // The [ key should work because rounds array was refreshed after commit
    await waitFor(() => {
      expect(invokedRoundIds).toContain(1)
    })
  })

  it('no verbose status text in header', async () => {
    const roundStatus = makeRoundStatus({
      round_id: 1, round_number: 1, state: 'open',
      total_photos: 3, kept: 1, eliminated: 1, undecided: 1, decided: 2,
    })

    mockInvoke.mockImplementation(mockStackFocusRouter({
      list_logical_photos: [mockPhotos],
      get_round_status: roundStatus,
      get_round_decisions: [makeDecisionList(['keep', 'eliminate', 'undecided'])],
      list_rounds: [THREE_ROUND_LIST],
    }))

    render(StackFocus)
    await waitFor(() => {
      expect(screen.getAllByTestId('photo-card').length).toBeGreaterThan(0)
    })

    // Get the header element
    const header = document.querySelector('header')
    const headerText = header?.textContent ?? ''
    // Should NOT contain verbose status words
    expect(headerText).not.toContain(' kept')
    expect(headerText).not.toContain('eliminated')
    expect(headerText).not.toContain('undecided')
    expect(headerText).not.toContain('decided')
  })
})
