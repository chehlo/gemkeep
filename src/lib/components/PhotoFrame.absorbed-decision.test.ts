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

import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/svelte'
import { makePhoto } from '$test/fixtures'
import PhotoFrame from './PhotoFrame.svelte'

describe('PhotoFrame — absorbed decision indicator', () => {
  // 1. status=undecided: border-2 border-gray-700 on container
  it('undecided: container has border-2 border-gray-700', () => {
    render(PhotoFrame, { props: { photo: makePhoto(), status: 'undecided', imageUrl: null } })
    const frame = screen.getByTestId('photo-frame')
    expect(frame.classList.contains('border-2')).toBe(true)
    expect(frame.classList.contains('border-gray-700')).toBe(true)
  })

  // 2. status=keep: border-2 border-green-500 + decision-keep on container
  it('keep: container has border-2 border-green-500 and decision-keep class', () => {
    render(PhotoFrame, { props: { photo: makePhoto(), status: 'keep', imageUrl: null } })
    const frame = screen.getByTestId('photo-frame')
    expect(frame.classList.contains('border-2')).toBe(true)
    expect(frame.classList.contains('border-green-500')).toBe(true)
    expect(frame.classList.contains('decision-keep')).toBe(true)
    expect(frame.classList.contains('border-gray-700')).toBe(false)
  })

  // 3. status=eliminate: border-2 border-red-500 + decision-eliminate on container
  it('eliminate: container has border-2 border-red-500 and decision-eliminate class', () => {
    render(PhotoFrame, { props: { photo: makePhoto(), status: 'eliminate', imageUrl: null } })
    const frame = screen.getByTestId('photo-frame')
    expect(frame.classList.contains('border-2')).toBe(true)
    expect(frame.classList.contains('border-red-500')).toBe(true)
    expect(frame.classList.contains('decision-eliminate')).toBe(true)
  })

  // 4. eliminate dim overlay is INSIDE photo-area
  it('eliminate: dim overlay is child of photo-area, not photo-frame root', () => {
    render(PhotoFrame, { props: { photo: makePhoto(), status: 'eliminate', imageUrl: null } })
    const photoArea = screen.getByTestId('photo-area')
    const dimOverlay = photoArea.querySelector('.decision-dim-overlay')
    expect(dimOverlay).not.toBeNull()
    // Verify it has the expected classes
    expect(dimOverlay!.classList.contains('bg-black/50')).toBe(true)
    expect(dimOverlay!.classList.contains('pointer-events-none')).toBe(true)
  })

  // 5. No overlay child component with border classes — border is on container itself
  it('keep: no child overlay element has border classes (border is on container itself)', () => {
    render(PhotoFrame, { props: { photo: makePhoto(), status: 'keep', imageUrl: null } })
    const frame = screen.getByTestId('photo-frame')
    // querySelector searches descendants only — if decision-keep is on frame itself, this returns null
    const childWithKeep = frame.querySelector('.decision-keep')
    // This should be null because the class is on the frame itself, not a child
    expect(childWithKeep).toBeNull()
  })

  // 6. null photo + keep: green border still shows
  it('null photo with keep status still has border-green-500 class', () => {
    render(PhotoFrame, { props: { photo: null, status: 'keep', imageUrl: null } })
    const frame = screen.getByTestId('photo-frame')
    expect(frame.classList.contains('border-2')).toBe(true)
    expect(frame.classList.contains('border-green-500')).toBe(true)
    expect(frame.classList.contains('decision-keep')).toBe(true)
  })

  // 7. null photo + eliminate: red border + dim
  it('null photo with eliminate status has border-red-500 class and dim overlay element', () => {
    render(PhotoFrame, { props: { photo: null, status: 'eliminate', imageUrl: null } })
    const frame = screen.getByTestId('photo-frame')
    expect(frame.classList.contains('border-red-500')).toBe(true)
    const photoArea = screen.getByTestId('photo-area')
    expect(photoArea.querySelector('.decision-dim-overlay')).not.toBeNull()
  })

  // 8. focused + keep: both ring and border coexist
  it('focused + keep applies both ring-blue-500 and border-green-500 classes on container', () => {
    render(PhotoFrame, { props: { photo: makePhoto(), status: 'keep', focused: true, imageUrl: null } })
    const frame = screen.getByTestId('photo-frame')
    expect(frame.classList.contains('ring-2')).toBe(true)
    expect(frame.classList.contains('ring-blue-500')).toBe(true)
    expect(frame.classList.contains('border-2')).toBe(true)
    expect(frame.classList.contains('border-green-500')).toBe(true)
  })
})
