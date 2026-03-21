// All Tauri invoke() calls go through this file — never call invoke() directly elsewhere
import { invoke, convertFileSrc } from '@tauri-apps/api/core'

export interface Project {
  id: number
  name: string
  slug: string
  created_at: string
  last_opened_at: string | null
}

export async function suggestSlug(name: string): Promise<string> {
  return invoke('suggest_slug', { name })
}

export async function createProject(name: string): Promise<Project> {
  return invoke('create_project', { name })
}

export async function listProjects(): Promise<Project[]> {
  return invoke('list_projects')
}

export async function openProject(slug: string): Promise<Project> {
  return invoke('open_project', { slug })
}

export async function getLastProject(): Promise<Project | null> {
  return invoke('get_last_project')
}

export async function deleteProject(slug: string): Promise<void> {
  return invoke('delete_project', { slug })
}

export interface ImportStats {
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

export interface IndexingStatus {
  running: boolean
  thumbnails_running: boolean
  total: number
  processed: number
  errors: number
  cancelled: boolean
  paused: boolean
  last_stats: ImportStats | null
  thumbnails_total: number
  thumbnails_done: number
}

export interface SourceFolder {
  id: number
  path: string
}

export interface StackSummary {
  stack_id: number
  logical_photo_count: number
  earliest_capture: string | null
  has_raw: boolean
  has_jpeg: boolean
  thumbnail_path: string | null
}

export async function addSourceFolder(slug: string, path: string): Promise<void> {
  return invoke('add_source_folder', { slug, path })
}

export async function removeSourceFolder(slug: string, folderId: number): Promise<void> {
  return invoke('remove_source_folder', { slug, folderId })
}

export async function listSourceFolders(slug: string): Promise<SourceFolder[]> {
  return invoke('list_source_folders', { slug })
}

export async function startIndexing(slug: string): Promise<void> {
  return invoke('start_indexing', { slug })
}

export async function cancelIndexing(slug: string): Promise<void> {
  return invoke('cancel_indexing', { slug })
}

export async function pauseIndexing(slug: string): Promise<void> {
  return invoke('pause_indexing', { slug })
}

export async function resumeIndexing(slug: string): Promise<void> {
  return invoke('resume_indexing', { slug })
}

export async function getIndexingStatus(slug: string): Promise<IndexingStatus> {
  return invoke('get_indexing_status', { slug })
}

export async function listStacks(slug: string): Promise<StackSummary[]> {
  return invoke('list_stacks', { slug })
}

export interface LogicalPhotoSummary {
  logical_photo_id: number
  thumbnail_path:   string | null
  capture_time:     string | null
  camera_model:     string | null
  lens:             string | null
  has_raw:          boolean
  has_jpeg:         boolean
  aperture:         number | null
  shutter_speed:    string | null
  iso:              number | null
  focal_length:     number | null
}

export function listLogicalPhotos(slug: string, stackId: number, roundId: number): Promise<LogicalPhotoSummary[]> {
  return invoke('list_logical_photos', { slug, stackId, roundId })
}

export function getThumbnailUrl(path: string): string {
  return convertFileSrc(path)
}

export async function resumeThumbnails(slug: string): Promise<void> {
  return invoke('resume_thumbnails', { slug })
}

export async function getBurstGap(): Promise<number> {
  return await invoke<number>('get_burst_gap')
}

export async function setBurstGap(secs: number): Promise<void> {
  await invoke('set_burst_gap', { secs })
}

export async function restack(slug: string): Promise<void> {
  await invoke('restack', { slug })
}

export async function expandSourceScopes(slug: string): Promise<void> {
  return invoke('expand_source_scopes', { slug })
}

// Sprint 7: Decision engine types

/** The three possible states of a photo's culling decision. */
export type DecisionStatus = 'undecided' | 'keep' | 'eliminate'

/** The action a user can take on a photo (subset of DecisionStatus — no 'undecided'). */
export type DecisionAction = 'keep' | 'eliminate'

/** The lifecycle state of a culling round. */
export type RoundState = 'open' | 'committed'

export interface DecisionResult {
  decision_id: number
  round_id: number
  action: DecisionAction
  current_status: DecisionStatus
  round_auto_created: boolean
}

export interface RoundStatus {
  round_id: number
  round_number: number
  state: RoundState
  total_photos: number
  decided: number
  kept: number
  eliminated: number
  undecided: number
  committed_at: string | null
}

export interface PhotoDetail {
  logical_photo_id: number
  thumbnail_path: string | null
  capture_time: string | null
  camera_model: string | null
  lens: string | null
  has_raw: boolean
  has_jpeg: boolean
  current_status: DecisionStatus
  aperture: number | null
  shutter_speed: string | null
  iso: number | null
  focal_length: number | null
  exposure_comp: number | null
  jpeg_path: string | null
  raw_path: string | null
  preview_path: string | null  // full-size RAW embedded preview (SingleView fallback)
}

export interface PhotoDecisionStatus {
  logical_photo_id: number
  current_status: DecisionStatus
}

export interface MergeResult {
  merged_stack_id: number
  logical_photos_moved: number
  source_stack_ids: number[]
  transaction_id: number
}

export interface StackTransaction {
  id: number
  project_id: number
  action: string
  details: string
  created_at: string
}

// Sprint 7: Decision commands
export async function makeDecision(slug: string, logicalPhotoId: number, action: DecisionAction): Promise<DecisionResult> {
  return invoke('make_decision', { slug, logicalPhotoId, action })
}

export async function undoDecision(slug: string, logicalPhotoId: number): Promise<void> {
  return invoke('undo_decision', { slug, logicalPhotoId })
}

export async function getRoundStatus(slug: string, stackId: number): Promise<RoundStatus> {
  return invoke('get_round_status', { slug, stackId })
}

export async function commitRound(slug: string, stackId: number): Promise<void> {
  return invoke('commit_round', { slug, stackId })
}

export async function getPhotoDetail(slug: string, logicalPhotoId: number): Promise<PhotoDetail> {
  return invoke('get_photo_detail', { slug, logicalPhotoId })
}

export async function getStackDecisions(slug: string, stackId: number): Promise<PhotoDecisionStatus[]> {
  return invoke('get_stack_decisions', { slug, stackId })
}

// Sprint 7: Stack merge commands
export async function mergeStacks(slug: string, stackIds: number[]): Promise<MergeResult> {
  return invoke('merge_stacks', { slug, stackIds })
}

export async function undoLastMerge(slug: string): Promise<void> {
  return invoke('undo_last_merge', { slug })
}

export async function listStackTransactions(slug: string): Promise<StackTransaction[]> {
  return invoke('list_stack_transactions', { slug })
}
