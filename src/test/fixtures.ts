// src/test/fixtures.ts
// Shared test fixtures and factory functions for frontend tests.
// Extracted from StackOverview, StackFocus, and SingleView test files.

import type {
  IndexingStatus,
  StackSummary,
  LogicalPhotoSummary,
  RoundStatus,
  PhotoDecisionStatus,
  DecisionResult,
  PhotoDetail,
  DecisionStatus,
  RoundSummary,
} from '$lib/api/index.js'

// ─── IndexingStatus fixtures ────────────────────────────────────────────────

export const IDLE_STATUS: IndexingStatus = {
  running: false, thumbnails_running: false, total: 0, processed: 0, errors: 0,
  cancelled: false, paused: false, last_stats: null, thumbnails_total: 0, thumbnails_done: 0,
}

// ─── LogicalPhotoSummary fixtures + factory ─────────────────────────────────

export const PHOTO_1: LogicalPhotoSummary = {
  logical_photo_id: 1,
  thumbnail_path: '/home/user/.gem-keep/cache.jpg',
  capture_time: '2024-01-15T10:30:00Z',
  camera_model: 'Canon EOS 5D',
  lens: 'EF 85mm f/1.4',
  has_raw: true,
  has_jpeg: true,
  aperture: null,
  shutter_speed: null,
  iso: null,
  focal_length: null,
}

export const PHOTO_2: LogicalPhotoSummary = {
  logical_photo_id: 2,
  thumbnail_path: null,
  capture_time: '2024-01-15T10:31:00Z',
  camera_model: 'Canon EOS 5D',
  lens: null,
  has_raw: false,
  has_jpeg: true,
  aperture: null,
  shutter_speed: null,
  iso: null,
  focal_length: null,
}

export const PHOTO_3: LogicalPhotoSummary = {
  logical_photo_id: 3,
  thumbnail_path: null,
  capture_time: null,
  camera_model: null,
  lens: null,
  has_raw: false,
  has_jpeg: true,
  aperture: null,
  shutter_speed: null,
  iso: null,
  focal_length: null,
}

export function makePhoto(overrides?: Partial<LogicalPhotoSummary>): LogicalPhotoSummary {
  return {
    logical_photo_id: 1,
    thumbnail_path: null,
    capture_time: '2024-01-15T10:30:00Z',
    camera_model: 'Canon EOS 5D',
    lens: 'EF 85mm f/1.4',
    has_raw: true,
    has_jpeg: true,
    aperture: null,
    shutter_speed: null,
    iso: null,
    focal_length: null,
    ...overrides,
  }
}

// ─── PhotoDecisionStatus list factory ────────────────────────────────────────

/**
 * Generate a list of PhotoDecisionStatus objects from an array of status strings.
 * Auto-generates sequential logical_photo_ids starting at 1.
 *
 * Usage: makeDecisionList(['keep', 'undecided', 'eliminate'])
 * Returns: [
 *   { logical_photo_id: 1, current_status: 'keep' },
 *   { logical_photo_id: 2, current_status: 'undecided' },
 *   { logical_photo_id: 3, current_status: 'eliminate' },
 * ]
 */
export function makeDecisionList(statuses: DecisionStatus[]): PhotoDecisionStatus[] {
  return statuses.map((current_status, i) => ({
    logical_photo_id: i + 1,
    current_status,
  }))
}

/**
 * Generate a list of LogicalPhotoSummary objects with specified statuses.
 * Uses makePhoto() for each entry with auto-generated IDs.
 *
 * Usage: makePhotoList(['keep', 'undecided', 'eliminate'])
 * Returns an array of LogicalPhotoSummary with logical_photo_id 1, 2, 3
 * and a parallel decisions array for use with mockStackFocusMount.
 */
export function makePhotoList(count: number): LogicalPhotoSummary[] {
  return Array.from({ length: count }, (_, i) =>
    makePhoto({
      logical_photo_id: i + 1,
      thumbnail_path: null,
      capture_time: i === 0 ? '2024-01-15T10:30:00Z' : `2024-01-15T10:${30 + i}:00Z`,
    })
  )
}

/** Photos with IDs 10, 11 — distinct from default PHOTO_1/2/3 for round-scoping tests. */
export const ROUND_2_PHOTOS: LogicalPhotoSummary[] = [
  makePhoto({ logical_photo_id: 10, thumbnail_path: '/cache/round2_10.jpg', capture_time: '2024-01-15T14:00:00Z' }),
  makePhoto({ logical_photo_id: 11, thumbnail_path: '/cache/round2_11.jpg', capture_time: '2024-01-15T14:01:00Z' }),
]

// ─── RoundStatus fixtures + factory ─────────────────────────────────────────

export const OPEN_ROUND: RoundStatus = {
  round_id: 1,
  round_number: 1,
  state: 'open',
  total_photos: 3,
  decided: 0,
  kept: 0,
  eliminated: 0,
  undecided: 3,
  committed_at: null,
}

export function makeRoundStatus(overrides?: Partial<RoundStatus>): RoundStatus {
  return { ...OPEN_ROUND, ...overrides }
}

// ─── PhotoDecisionStatus fixtures + factory ─────────────────────────────────

export const UNDECIDED_DECISIONS: PhotoDecisionStatus[] = [
  { logical_photo_id: 1, current_status: 'undecided' },
  { logical_photo_id: 2, current_status: 'undecided' },
  { logical_photo_id: 3, current_status: 'undecided' },
]

export function makeDecisionStatus(overrides?: Partial<PhotoDecisionStatus>): PhotoDecisionStatus {
  return {
    logical_photo_id: 1,
    current_status: 'undecided',
    ...overrides,
  }
}

// ─── StackSummary factory ───────────────────────────────────────────────────

export function makeStack(overrides?: Partial<StackSummary>): StackSummary {
  return {
    stack_id: 1,
    logical_photo_count: 3,
    earliest_capture: '2024-03-15T10:00:00Z',
    has_raw: true,
    has_jpeg: true,
    thumbnail_path: null,
    ...overrides,
  }
}

// ─── PhotoDetail fixtures + factory ─────────────────────────────────────────

export const PHOTO_DETAIL: PhotoDetail = {
  logical_photo_id: 1,
  thumbnail_path: '/cache/thumbnails/1.jpg',
  capture_time: '2024-01-15T10:30:00Z',
  camera_model: 'Canon EOS 5D',
  lens: 'EF 85mm f/1.4',
  has_raw: true,
  has_jpeg: true,
  current_status: 'undecided',
  aperture: 2.8,
  shutter_speed: '1/250',
  iso: 400,
  focal_length: 85.0,
  exposure_comp: 0.7,
  jpeg_path: '/home/user/Photos/IMG_001.jpg',
  raw_path: '/home/user/Photos/IMG_001.CR3',
  preview_path: null,
}

export function makePhotoDetail(overrides?: Partial<PhotoDetail>): PhotoDetail {
  return { ...PHOTO_DETAIL, ...overrides }
}

/** Default photo list for SingleView tests (3 photos with thumbnails). */
export const SINGLE_VIEW_PHOTO_LIST: LogicalPhotoSummary[] = [
  makePhoto({ logical_photo_id: 1, thumbnail_path: '/cache/1.jpg', camera_model: 'Canon', lens: '85mm' }),
  makePhoto({ logical_photo_id: 2, thumbnail_path: '/cache/2.jpg', capture_time: '2024-01-15T10:31:00Z', camera_model: 'Canon', lens: '85mm' }),
  makePhoto({ logical_photo_id: 3, thumbnail_path: '/cache/3.jpg', capture_time: '2024-01-15T10:32:00Z', camera_model: 'Canon', lens: '85mm' }),
]

// ─── DecisionResult factory ─────────────────────────────────────────────────

export function makeDecisionResult(overrides?: Partial<DecisionResult>): DecisionResult {
  return {
    decision_id: 1,
    round_id: 1,
    action: 'keep',
    current_status: 'keep',
    round_auto_created: false,
    ...overrides,
  }
}

// ─── RoundSummary fixtures + factory ─────────────────────────────────────────

export const ROUND_1_COMMITTED: RoundSummary = {
  round_id: 1,
  round_number: 1,
  state: 'committed',
  total_photos: 5,
  decided: 5,
  kept: 3,
  eliminated: 2,
  undecided: 0,
  committed_at: '2024-01-15T12:00:00Z',
}

export const ROUND_2_COMMITTED: RoundSummary = {
  round_id: 2,
  round_number: 2,
  state: 'committed',
  total_photos: 3,
  decided: 3,
  kept: 2,
  eliminated: 1,
  undecided: 0,
  committed_at: '2024-01-15T13:00:00Z',
}

export const ROUND_3_OPEN: RoundSummary = {
  round_id: 3,
  round_number: 3,
  state: 'open',
  total_photos: 2,
  decided: 0,
  kept: 0,
  eliminated: 0,
  undecided: 2,
  committed_at: null,
}

export function makeRoundSummary(overrides?: Partial<RoundSummary>): RoundSummary {
  return {
    round_id: 1,
    round_number: 1,
    state: 'open',
    total_photos: 3,
    decided: 0,
    kept: 0,
    eliminated: 0,
    undecided: 3,
    committed_at: null,
    ...overrides,
  }
}

export const THREE_ROUND_LIST: RoundSummary[] = [
  ROUND_1_COMMITTED,
  ROUND_2_COMMITTED,
  ROUND_3_OPEN,
]
