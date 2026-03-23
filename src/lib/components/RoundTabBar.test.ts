// src/lib/components/RoundTabBar.test.ts
// Sprint 10 Phase C: RED tests for RoundTabBar component
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/svelte'
import RoundTabBar from './RoundTabBar.svelte'
import { THREE_ROUND_LIST, ROUND_3_OPEN } from '$test/fixtures'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('RoundTabBar — tab rendering', () => {
  it('renders correct number of round tabs', () => {
    render(RoundTabBar, {
      props: { rounds: THREE_ROUND_LIST, currentRoundId: 3, onClick: () => {} },
    })

    const buttons = screen.getAllByRole('button')
    expect(buttons).toHaveLength(3)
    expect(buttons[0]).toHaveTextContent('R1')
    expect(buttons[1]).toHaveTextContent('R2')
    expect(buttons[2]).toHaveTextContent('R3')
  })

  it('marks active round with asterisk suffix', () => {
    render(RoundTabBar, {
      props: { rounds: THREE_ROUND_LIST, currentRoundId: 3, onClick: () => {} },
    })

    const buttons = screen.getAllByRole('button')
    // Active round (R3, round_id=3) should have * suffix
    expect(buttons[2]).toHaveTextContent('R3*')
    // Non-active rounds should NOT have * suffix
    expect(buttons[0].textContent).not.toContain('*')
    expect(buttons[1].textContent).not.toContain('*')
  })

  it('click fires onClick with round_id', async () => {
    const onClickSpy = vi.fn()
    render(RoundTabBar, {
      props: { rounds: THREE_ROUND_LIST, currentRoundId: 3, onClick: onClickSpy },
    })

    const buttons = screen.getAllByRole('button')
    // Click the R2 tab (round_id=2)
    await fireEvent.click(buttons[1])

    expect(onClickSpy).toHaveBeenCalledOnce()
    expect(onClickSpy).toHaveBeenCalledWith(2)
  })
})
