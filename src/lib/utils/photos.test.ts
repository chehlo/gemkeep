// src/lib/utils/photos.test.ts
import { describe, it, expect } from 'vitest'
import { formatCameraParams, getDecisionStatus } from './photos'
import { makePhoto, makeDecisionList } from '$test/fixtures'

// ─── formatCameraParams ──────────────────────────────────────────────────────

describe('formatCameraParams', () => {
  it('all-fields-present: returns formatted string with all params', () => {
    const photo = makePhoto({
      aperture: 2.8,
      shutter_speed: '1/250',
      iso: 400,
      focal_length: 85,
    })
    expect(formatCameraParams(photo)).toBe('f/2.8 \u00b7 1/250 \u00b7 ISO400 \u00b7 85mm')
  })

  it('all-null: returns empty string', () => {
    const photo = makePhoto({
      aperture: null,
      shutter_speed: null,
      iso: null,
      focal_length: null,
    })
    expect(formatCameraParams(photo)).toBe('')
  })

  it('partial (aperture only): returns just aperture', () => {
    const photo = makePhoto({
      aperture: 2.8,
      shutter_speed: null,
      iso: null,
      focal_length: null,
    })
    expect(formatCameraParams(photo)).toBe('f/2.8')
  })

  it('partial (iso + focal_length): returns two params joined', () => {
    const photo = makePhoto({
      aperture: null,
      shutter_speed: null,
      iso: 400,
      focal_length: 85,
    })
    expect(formatCameraParams(photo)).toBe('ISO400 \u00b7 85mm')
  })
})

// ─── getDecisionStatus ───────────────────────────────────────────────────────

describe('getDecisionStatus', () => {
  it('found-keep: returns keep', () => {
    const decisions = makeDecisionList(['keep', 'undecided', 'eliminate'])
    expect(getDecisionStatus(decisions, 1)).toBe('keep')
  })

  it('found-eliminate: returns eliminate', () => {
    const decisions = makeDecisionList(['keep', 'undecided', 'eliminate'])
    expect(getDecisionStatus(decisions, 3)).toBe('eliminate')
  })

  it('not-found: returns undecided', () => {
    const decisions = makeDecisionList(['keep', 'undecided'])
    expect(getDecisionStatus(decisions, 99)).toBe('undecided')
  })

  it('empty array: returns undecided', () => {
    expect(getDecisionStatus([], 1)).toBe('undecided')
  })
})
