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
