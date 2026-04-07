// src/lib/components/PhotoFrame.absorbed-decision.test.ts
// RED tests for Feature 1: Absorb DecisionIndicator into PhotoFrame
//
// These test the NEW behavior where:
// - Decision borders (border-2) are applied directly on the photo-frame container
// - decision-keep / decision-eliminate classes are on the container itself (not a child overlay)
// - Dim overlay for eliminate lives inside photo-area, not as a sibling overlay
//
// Expected to FAIL against current code because:
// - Current undecided uses `border border-gray-700` (not `border-2 border-gray-700`)
// - Current keep/eliminate use DecisionIndicator child overlay (border-4 on absolute div)
// - Current dim overlay is a sibling of photo-area, not inside it

import { describe, it } from 'vitest'
import { render, screen } from '@testing-library/svelte'
import { makePhoto } from '$test/fixtures'
import { assertDecisionKept, assertDecisionEliminated, assertDecisionDimmed, assertDecisionUndecided } from '$test/decision-helpers'
import PhotoFrame from './PhotoFrame.svelte'

describe('PhotoFrame — decision indicator', () => {
  // 1. status=undecided: no decision indicator
  it('undecided: shows no decision indicator', () => {
    render(PhotoFrame, { props: { photo: makePhoto(), status: 'undecided', imageUrl: null } })
    const frame = screen.getByTestId('photo-frame')
    assertDecisionUndecided(frame)
  })

  // 4. eliminated photo shows dim overlay
  it('eliminated photo renders dim-overlay element', () => {
    render(PhotoFrame, { props: { photo: makePhoto(), status: 'eliminate', imageUrl: null } })
    const frame = screen.getByTestId('photo-frame')
    assertDecisionDimmed(frame)
  })

  // 6. null photo + keep: kept indicator still shows
  it('null photo with keep status still has kept decision indicator', () => {
    render(PhotoFrame, { props: { photo: null, status: 'keep', imageUrl: null } })
    const frame = screen.getByTestId('photo-frame')
    assertDecisionKept(frame)
  })

  // 7. null photo + eliminate: eliminated indicator + dim
  it('null photo with eliminate status has eliminated decision indicator and dim overlay', () => {
    render(PhotoFrame, { props: { photo: null, status: 'eliminate', imageUrl: null } })
    const frame = screen.getByTestId('photo-frame')
    assertDecisionEliminated(frame)
    const photoArea = screen.getByTestId('photo-area')
    assertDecisionDimmed(photoArea)
  })

})
