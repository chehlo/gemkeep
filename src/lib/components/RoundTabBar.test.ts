// src/lib/components/RoundTabBar.test.ts
// Sprint 10 Phase D: RED tests for RoundTabBar redesign (B01–B12)
// These tests target the NEW props API: rounds, currentRoundId, openRoundId, onClick, maxVisible
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/svelte'
import RoundTabBar from './RoundTabBar.svelte'
import { makeRoundSummary, THREE_ROUND_LIST, ROUND_1_COMMITTED, ROUND_3_OPEN } from '$test/fixtures'
import type { RoundSummary } from '$lib/api/index.js'

beforeEach(() => {
  vi.clearAllMocks()
})

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Build N round summaries with sequential IDs/numbers. Last round is open. */
function makeRounds(count: number): RoundSummary[] {
  return Array.from({ length: count }, (_, i) =>
    makeRoundSummary({
      round_id: i + 1,
      round_number: i + 1,
      state: i === count - 1 ? 'open' : 'committed',
      committed_at: i === count - 1 ? null : `2024-01-${15 + i}T12:00:00Z`,
    })
  )
}

/** The open round's ID in a list built by makeRounds(n) */
function openId(count: number): number {
  return count // last round
}

// ─── B01: Container testid ──────────────────────────────────────────────────

describe('RoundTabBar — container', () => {
  it('B01: has data-testid="round-tab-bar"', () => {
    render(RoundTabBar, {
      props: {
        rounds: THREE_ROUND_LIST,
        currentRoundId: 3,
        openRoundId: 3,
        onClick: () => {},
      },
    })

    expect(screen.getByTestId('round-tab-bar')).toBeInTheDocument()
  })
})

// ─── B02: Pill count + open indicator ●  ────────────────────────────────────

describe('RoundTabBar — pill rendering', () => {
  it('B02: 3 rounds → 3 pills with correct testids, R3 text contains ●', () => {
    render(RoundTabBar, {
      props: {
        rounds: THREE_ROUND_LIST,
        currentRoundId: 3,
        openRoundId: 3,
        onClick: () => {},
      },
    })

    const tab1 = screen.getByTestId('round-tab-1')
    const tab2 = screen.getByTestId('round-tab-2')
    const tab3 = screen.getByTestId('round-tab-3')

    expect(tab1).toBeInTheDocument()
    expect(tab2).toBeInTheDocument()
    expect(tab3).toBeInTheDocument()

    // Only R3 (open round) gets the ● indicator
    expect(tab3.textContent).toContain('●')
    expect(tab1.textContent).not.toContain('●')
    expect(tab2.textContent).not.toContain('●')
  })
})

// ─── B03: Active + open on same round ───────────────────────────────────────

describe('RoundTabBar — active & open styling', () => {
  it('B03: viewed+open same round → both round-tab-active AND round-tab-open testids', () => {
    render(RoundTabBar, {
      props: {
        rounds: THREE_ROUND_LIST,
        currentRoundId: 3,
        openRoundId: 3,
        onClick: () => {},
      },
    })

    // R3 is both viewed and open
    expect(screen.getByTestId('round-tab-active')).toBeInTheDocument()
    expect(screen.getByTestId('round-tab-open')).toBeInTheDocument()
  })

  // ─── B04: Inactive tabs have no active/open testids ─────────────────────

  it('B04: inactive tabs → no active/open testids on them', () => {
    render(RoundTabBar, {
      props: {
        rounds: THREE_ROUND_LIST,
        currentRoundId: 3,
        openRoundId: 3,
        onClick: () => {},
      },
    })

    const tab1 = screen.getByTestId('round-tab-1')
    const tab2 = screen.getByTestId('round-tab-2')

    // Inactive tabs should not have the active or open testid markers
    expect(tab1.querySelector('[data-testid="round-tab-active"]')).toBeNull()
    expect(tab1.querySelector('[data-testid="round-tab-open"]')).toBeNull()
    expect(tab2.querySelector('[data-testid="round-tab-active"]')).toBeNull()
    expect(tab2.querySelector('[data-testid="round-tab-open"]')).toBeNull()
  })

  // ─── B05: Historical view — active on R1, open on R3 ───────────────────

  it('B05: historical (viewing R1, R3 open) → R1 has active, R3 has open', () => {
    render(RoundTabBar, {
      props: {
        rounds: THREE_ROUND_LIST,
        currentRoundId: 1,  // viewing R1
        openRoundId: 3,     // R3 is still the open round
        onClick: () => {},
      },
    })

    const tab1 = screen.getByTestId('round-tab-1')
    const tab3 = screen.getByTestId('round-tab-3')

    // R1 = viewed (active), R3 = open
    expect(tab1.getAttribute('data-testid')).toBe('round-tab-1')
    // The active marker should be on R1
    expect(tab1.querySelector('[data-testid="round-tab-active"]') ?? tab1.matches('[data-testid~="round-tab-active"]') ? tab1 : null).not.toBeNull()
    // Actually let's check via getAllByTestId
    const activeEls = screen.getAllByTestId('round-tab-active')
    expect(activeEls).toHaveLength(1)
    // Active should be inside or be R1
    expect(tab1.contains(activeEls[0]) || tab1 === activeEls[0]).toBe(true)

    const openEls = screen.getAllByTestId('round-tab-open')
    expect(openEls).toHaveLength(1)
    expect(tab3.contains(openEls[0]) || tab3 === openEls[0]).toBe(true)
  })
})

// ─── B06: Click handler ─────────────────────────────────────────────────────

describe('RoundTabBar — click interaction', () => {
  it('B06: click R2 → onClick called with R2 round_id', async () => {
    const onClickSpy = vi.fn()
    render(RoundTabBar, {
      props: {
        rounds: THREE_ROUND_LIST,
        currentRoundId: 3,
        openRoundId: 3,
        onClick: onClickSpy,
      },
    })

    const tab2 = screen.getByTestId('round-tab-2')
    await fireEvent.click(tab2)

    expect(onClickSpy).toHaveBeenCalledOnce()
    expect(onClickSpy).toHaveBeenCalledWith(2) // round_id of R2
  })
})

// ─── B07–B10: Ellipsis / collapse logic ─────────────────────────────────────

describe('RoundTabBar — ellipsis collapse', () => {
  it('B07: 7 rounds → R1, ellipsis, R5, R6, R7●; R2-R4 not rendered', () => {
    const rounds = makeRounds(7)
    render(RoundTabBar, {
      props: {
        rounds,
        currentRoundId: 7, // viewing the open round
        openRoundId: 7,
        onClick: () => {},
      },
    })

    // Visible tabs
    expect(screen.getByTestId('round-tab-1')).toBeInTheDocument()
    expect(screen.getByTestId('round-tab-ellipsis')).toBeInTheDocument()
    expect(screen.getByTestId('round-tab-5')).toBeInTheDocument()
    expect(screen.getByTestId('round-tab-6')).toBeInTheDocument()
    expect(screen.getByTestId('round-tab-7')).toBeInTheDocument()

    // R7 is open
    expect(screen.getByTestId('round-tab-7').textContent).toContain('●')

    // Hidden tabs should not be rendered
    expect(screen.queryByTestId('round-tab-2')).not.toBeInTheDocument()
    expect(screen.queryByTestId('round-tab-3')).not.toBeInTheDocument()
    expect(screen.queryByTestId('round-tab-4')).not.toBeInTheDocument()
  })

  it('B08: 10 rounds viewing R3 → R1, R3 (viewed), ellipsis, R9, R10●', () => {
    const rounds = makeRounds(10)
    render(RoundTabBar, {
      props: {
        rounds,
        currentRoundId: 3, // viewing R3 (historical)
        openRoundId: 10,
        onClick: () => {},
      },
    })

    // R1 = always shown (first)
    expect(screen.getByTestId('round-tab-1')).toBeInTheDocument()
    // R3 = viewed, should be shown before ellipsis
    expect(screen.getByTestId('round-tab-3')).toBeInTheDocument()
    // Ellipsis between viewed and tail
    expect(screen.getByTestId('round-tab-ellipsis')).toBeInTheDocument()
    // Tail: R9, R10
    expect(screen.getByTestId('round-tab-9')).toBeInTheDocument()
    expect(screen.getByTestId('round-tab-10')).toBeInTheDocument()

    // R10 is the open round
    expect(screen.getByTestId('round-tab-10').textContent).toContain('●')
  })

  it('B09: 5 rounds → all shown, no ellipsis', () => {
    const rounds = makeRounds(5)
    render(RoundTabBar, {
      props: {
        rounds,
        currentRoundId: 5,
        openRoundId: 5,
        onClick: () => {},
      },
    })

    expect(screen.getByTestId('round-tab-1')).toBeInTheDocument()
    expect(screen.getByTestId('round-tab-2')).toBeInTheDocument()
    expect(screen.getByTestId('round-tab-3')).toBeInTheDocument()
    expect(screen.getByTestId('round-tab-4')).toBeInTheDocument()
    expect(screen.getByTestId('round-tab-5')).toBeInTheDocument()

    expect(screen.queryByTestId('round-tab-ellipsis')).not.toBeInTheDocument()
  })

  it('B10: 7 rounds viewing R6 (in tail) → R6 not duplicated', () => {
    const rounds = makeRounds(7)
    render(RoundTabBar, {
      props: {
        rounds,
        currentRoundId: 6, // viewing R6, which is in the tail
        openRoundId: 7,
        onClick: () => {},
      },
    })

    // R6 is in the tail window already — should appear exactly once
    const tab6elements = screen.getAllByTestId('round-tab-6')
    expect(tab6elements).toHaveLength(1)
  })
})

// ─── B11: Only open round gets ● ────────────────────────────────────────────

describe('RoundTabBar — open indicator', () => {
  it('B11: only open round gets ● in text', () => {
    render(RoundTabBar, {
      props: {
        rounds: THREE_ROUND_LIST,
        currentRoundId: 1,  // viewing R1
        openRoundId: 3,     // R3 is open
        onClick: () => {},
      },
    })

    const tab1 = screen.getByTestId('round-tab-1')
    const tab2 = screen.getByTestId('round-tab-2')
    const tab3 = screen.getByTestId('round-tab-3')

    expect(tab1.textContent).not.toContain('●')
    expect(tab2.textContent).not.toContain('●')
    expect(tab3.textContent).toContain('●')
  })

  it('B12: finalized (no open, openRoundId=0) → no ● anywhere, no round-tab-open', () => {
    render(RoundTabBar, {
      props: {
        rounds: THREE_ROUND_LIST,
        currentRoundId: 3,
        openRoundId: 0, // finalized — no open round
        onClick: () => {},
      },
    })

    // No ● on any tab
    const tab1 = screen.getByTestId('round-tab-1')
    const tab2 = screen.getByTestId('round-tab-2')
    const tab3 = screen.getByTestId('round-tab-3')
    expect(tab1.textContent).not.toContain('●')
    expect(tab2.textContent).not.toContain('●')
    expect(tab3.textContent).not.toContain('●')

    // No round-tab-open testid
    expect(screen.queryByTestId('round-tab-open')).not.toBeInTheDocument()
  })
})
