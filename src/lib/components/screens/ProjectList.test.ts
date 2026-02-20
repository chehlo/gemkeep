// src/lib/components/screens/ProjectList.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/svelte'
import { userEvent } from '@testing-library/user-event'
import { invoke } from '@tauri-apps/api/core'
import { navigate, navigation } from '$lib/stores/navigation.svelte.js'
import type { Project } from '$lib/api/index.js'
import ProjectList from './ProjectList.svelte'

const mockInvoke = vi.mocked(invoke)

const ICELAND: Project = {
  id: 1, name: 'Iceland 2024', slug: 'iceland-2024',
  created_at: '2026-01-01T00:00:00Z', last_opened_at: '2026-01-15T10:00:00Z',
}

const WEDDING: Project = {
  id: 1,              // ← same id as ICELAND — exactly what Rust returns (each DB starts at id=1)
  name: 'Wedding',
  slug: 'wedding',
  created_at: '2026-02-01T00:00:00Z',
  last_opened_at: null,
}

beforeEach(() => {
  vi.clearAllMocks()
  navigate({ kind: 'project-list' })
})

describe('ProjectList — first launch (no skipAutoOpen)', () => {
  it('auto-opens last project if one exists', async () => {
    mockInvoke.mockResolvedValueOnce(ICELAND) // get_last_project
    render(ProjectList)
    await waitFor(() => {
      expect(navigation.current.kind).toBe('stack-overview')
    })
    if (navigation.current.kind === 'stack-overview') {
      expect(navigation.current.projectSlug).toBe('iceland-2024')
    }
  })

  it('shows project list when no last project exists', async () => {
    mockInvoke.mockResolvedValueOnce(null)      // get_last_project → null
    mockInvoke.mockResolvedValueOnce([ICELAND]) // list_projects
    render(ProjectList)
    await waitFor(() => {
      expect(screen.getByText('Iceland 2024')).toBeInTheDocument()
    })
    expect(navigation.current.kind).toBe('project-list')
  })
})

describe('ProjectList — after back() from StackOverview (skipAutoOpen)', () => {
  beforeEach(() => {
    navigate({
      kind: 'project-list',
      skipAutoOpen: true,
      resumeProject: { slug: 'iceland-2024', name: 'Iceland 2024' },
    })
    mockInvoke.mockResolvedValueOnce([ICELAND]) // list_projects
  })

  it('does NOT auto-navigate away', async () => {
    render(ProjectList)
    await waitFor(() => {
      expect(screen.getByText('GemKeep')).toBeInTheDocument()
    })
    expect(navigation.current.kind).toBe('project-list')
  })

  it('shows Resume card with correct project name', async () => {
    render(ProjectList)
    await waitFor(() => {
      expect(screen.getByText('Iceland 2024')).toBeInTheDocument()
      expect(screen.getByText('Resume')).toBeInTheDocument()
    })
  })

  it('does NOT call get_last_project (no side effects)', async () => {
    render(ProjectList)
    await waitFor(() => {
      expect(screen.getByText('GemKeep')).toBeInTheDocument()
    })
    // Only list_projects should have been called, NOT get_last_project
    expect(mockInvoke).not.toHaveBeenCalledWith('get_last_project')
    expect(mockInvoke).toHaveBeenCalledWith('list_projects')
  })

  it("opens project when Resume 'Open →' is clicked", async () => {
    mockInvoke.mockResolvedValueOnce(ICELAND) // open_project
    render(ProjectList)
    await waitFor(() => screen.getByText('Open →'))
    const user = userEvent.setup()
    await user.click(screen.getByText('Open →'))
    await waitFor(() => {
      expect(navigation.current.kind).toBe('stack-overview')
    })
  })
})

describe('ProjectList — multi-project list (realistic data)', () => {
  it('renders two projects both with id=1 without duplicate-key error', async () => {
    navigate({ kind: 'project-list' })
    mockInvoke.mockResolvedValueOnce(null)                    // get_last_project → null
    mockInvoke.mockResolvedValueOnce([ICELAND, WEDDING])      // list_projects
    render(ProjectList)
    await waitFor(() => {
      expect(screen.getByText('Iceland 2024')).toBeInTheDocument()
      expect(screen.getByText('Wedding')).toBeInTheDocument()
    })
  })

  it('each project row shows its own unique slug', async () => {
    navigate({ kind: 'project-list' })
    mockInvoke.mockResolvedValueOnce(null)                    // get_last_project → null
    mockInvoke.mockResolvedValueOnce([ICELAND, WEDDING])      // list_projects
    render(ProjectList)
    await waitFor(() => {
      expect(screen.getByText(/iceland-2024/)).toBeInTheDocument()
      expect(screen.getByText(/wedding ·/)).toBeInTheDocument()
    })
  })
})
