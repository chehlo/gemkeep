// All Tauri invoke() calls go through this file — never call invoke() directly elsewhere
import { invoke } from '@tauri-apps/api/core'

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
  total: number
  processed: number
  errors: number
  cancelled: boolean
  last_stats: ImportStats | null
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

export async function cancelIndexing(): Promise<void> {
  return invoke('cancel_indexing')
}

export async function getIndexingStatus(slug: string): Promise<IndexingStatus> {
  return invoke('get_indexing_status', { slug })
}

export async function listStacks(slug: string): Promise<StackSummary[]> {
  return invoke('list_stacks', { slug })
}
