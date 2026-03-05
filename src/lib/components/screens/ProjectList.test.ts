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
  // Reset mock queue (unconsumed mockResolvedValueOnce values from previous tests) and
  // reinstall the Rule 9 throwing default so under-mocked commands fail loudly.
  mockInvoke.mockReset()
  mockInvoke.mockImplementation((cmd: string) => {
    throw new Error(`Unmocked invoke("${cmd}"). Add mockInvoke.mockResolvedValueOnce(...) before this call.`)
  })
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

// ---------- Helper: render with projects loaded (no auto-open) ----------
async function renderWithProjects(projectList: Project[] = [ICELAND, WEDDING]) {
  mockInvoke.mockResolvedValueOnce(null)              // get_last_project → null
  mockInvoke.mockResolvedValueOnce(projectList)       // list_projects
  render(ProjectList)
  await waitFor(() => {
    expect(screen.getByText('GemKeep')).toBeInTheDocument()
  })
}

describe('ProjectList — + New Project toggle (PL-09, PL-35)', () => {
  it('toggles create form visibility on click', async () => {
    await renderWithProjects()
    const user = userEvent.setup()

    // Form hidden initially
    expect(screen.queryByPlaceholderText('Iceland 2024')).not.toBeInTheDocument()

    // Click toggle — form appears
    await user.click(screen.getByText('New Project'))
    expect(screen.getByPlaceholderText('Iceland 2024')).toBeInTheDocument()

    // Click toggle again — form hides
    await user.click(screen.getByText('New Project'))
    expect(screen.queryByPlaceholderText('Iceland 2024')).not.toBeInTheDocument()
  })

  it('toggle icon changes between + and − (PL-35)', async () => {
    await renderWithProjects()
    const user = userEvent.setup()

    // Initially shows +
    expect(screen.getByText('+')).toBeInTheDocument()

    // After opening shows −
    await user.click(screen.getByText('New Project'))
    expect(screen.getByText('−')).toBeInTheDocument()
  })
})

describe('ProjectList — create form fields (PL-10, PL-11, PL-12, PL-13)', () => {
  async function openCreateForm() {
    await renderWithProjects()
    const user = userEvent.setup()
    await user.click(screen.getByText('New Project'))
    return user
  }

  it('name input has placeholder "Iceland 2024" (PL-10)', async () => {
    await openCreateForm()
    const input = screen.getByPlaceholderText('Iceland 2024')
    expect(input).toBeInTheDocument()
    expect(input.tagName).toBe('INPUT')
  })

  it('slug preview is NOT shown to user (PL-11 — slug is internal only)', async () => {
    vi.useFakeTimers()
    await renderWithProjects()

    // Open form
    const toggleBtn = screen.getByText('New Project')
    toggleBtn.click()

    await waitFor(() => {
      expect(screen.getByPlaceholderText('Iceland 2024')).toBeInTheDocument()
    })

    // Mock suggest_slug response
    mockInvoke.mockResolvedValueOnce('my-cool-project') // suggest_slug

    // Type into the input
    const input = screen.getByPlaceholderText('Iceland 2024') as HTMLInputElement
    input.value = 'My Cool Project'
    input.dispatchEvent(new Event('input', { bubbles: true }))

    // Advance past debounce
    await vi.advanceTimersByTimeAsync(250)

    // Slug must NOT be visible to the user (it's used internally only)
    await waitFor(() => {
      expect(screen.queryByText('my-cool-project')).not.toBeInTheDocument()
    })

    vi.useRealTimers()
  })

  it('Create button disabled when input is empty (PL-12)', async () => {
    await openCreateForm()
    const createBtn = screen.getByRole('button', { name: 'Create' })
    expect(createBtn).toBeDisabled()
  })

  it('Create button shows "Creating…" while submitting (PL-13)', async () => {
    const user = await openCreateForm()

    // Use command-based mock to handle non-deterministic ordering
    // of suggest_slug (debounce) vs create_project (user click)
    let resolveCreate!: (value: Project) => void
    const createPromise = new Promise<Project>(r => { resolveCreate = r })
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === 'suggest_slug') return Promise.resolve('new-project')
      if (cmd === 'create_project') return createPromise
      throw new Error(`Unmocked invoke("${cmd}")`)
    })

    const input = screen.getByPlaceholderText('Iceland 2024')
    await user.type(input, 'New Project')

    // Click Create (slug is not displayed, so just click after typing)
    const createBtn = screen.getByRole('button', { name: 'Create' })
    await user.click(createBtn)

    // Should show "Creating…"
    await waitFor(() => {
      expect(screen.getByText('Creating…')).toBeInTheDocument()
    })

    // Resolve the create call — navigates away
    resolveCreate({ id: 2, name: 'New Project', slug: 'new-project', created_at: '2026-03-01T00:00:00Z', last_opened_at: null })
    await waitFor(() => {
      expect(navigation.current.kind).toBe('stack-overview')
    })
  })
})

describe('ProjectList — create form submission (PL-14, PL-16)', () => {
  it('Enter key submits the create form (PL-14)', async () => {
    await renderWithProjects()
    const user = userEvent.setup()
    await user.click(screen.getByText('New Project'))

    // Use command-based mock to handle non-deterministic ordering
    // of suggest_slug (debounce) vs create_project (Enter key)
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === 'suggest_slug') return Promise.resolve('enter-project')
      if (cmd === 'create_project') return Promise.resolve({
        id: 3, name: 'Enter Project', slug: 'enter-project',
        created_at: '2026-03-01T00:00:00Z', last_opened_at: null,
      })
      throw new Error(`Unmocked invoke("${cmd}")`)
    })

    const input = screen.getByPlaceholderText('Iceland 2024')
    await user.type(input, 'Enter Project')

    // Press Enter to submit
    await user.keyboard('{Enter}')

    // Should navigate to stack-overview
    await waitFor(() => {
      expect(navigation.current.kind).toBe('stack-overview')
    })
    if (navigation.current.kind === 'stack-overview') {
      expect(navigation.current.projectSlug).toBe('enter-project')
    }
  })

  it('shows error on create failure (PL-16)', async () => {
    await renderWithProjects()
    const user = userEvent.setup()
    await user.click(screen.getByText('New Project'))

    // Use command-based mock to handle non-deterministic ordering
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === 'suggest_slug') return Promise.resolve('fail-project')
      if (cmd === 'create_project') return Promise.reject(new Error('Name taken'))
      throw new Error(`Unmocked invoke("${cmd}")`)
    })

    const input = screen.getByPlaceholderText('Iceland 2024')
    await user.type(input, 'Fail Project')

    await user.click(screen.getByRole('button', { name: 'Create' }))

    // Error banner appears
    await waitFor(() => {
      expect(screen.getByText(/Name taken/)).toBeInTheDocument()
    })
    // Should stay on project-list
    expect(navigation.current.kind).toBe('project-list')
  })
})

describe('ProjectList — Cancel button and Esc key (FIX-1.2.1)', () => {
  it('Cancel button closes the create form and clears the name input', async () => {
    await renderWithProjects()
    const user = userEvent.setup()

    // Open the form
    await user.click(screen.getByText('New Project'))
    expect(screen.getByPlaceholderText('Iceland 2024')).toBeInTheDocument()

    // Type a name
    const input = screen.getByPlaceholderText('Iceland 2024')
    await user.type(input, 'Some Name')
    expect((input as HTMLInputElement).value).toBe('Some Name')

    // Click Cancel
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    // Form should be hidden
    expect(screen.queryByPlaceholderText('Iceland 2024')).not.toBeInTheDocument()
  })

  it('Cancel button is visible when the form is open', async () => {
    await renderWithProjects()
    const user = userEvent.setup()

    // Cancel not visible before form opens
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument()

    await user.click(screen.getByText('New Project'))

    // Cancel is visible after form opens
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
  })

  it('Escape key closes the create form', async () => {
    await renderWithProjects()
    const user = userEvent.setup()

    // Open the form
    await user.click(screen.getByText('New Project'))
    expect(screen.getByPlaceholderText('Iceland 2024')).toBeInTheDocument()

    // Press Escape
    await user.keyboard('{Escape}')

    // Form should be hidden
    await waitFor(() => {
      expect(screen.queryByPlaceholderText('Iceland 2024')).not.toBeInTheDocument()
    })
  })
})

describe('ProjectList — Duplicate project name prevention (FIX-1.5.1)', () => {
  it('shows an error instead of creating when name already exists (case-insensitive)', async () => {
    await renderWithProjects([ICELAND, WEDDING])
    const user = userEvent.setup()

    await user.click(screen.getByText('New Project'))

    // Mock suggest_slug (will be called internally)
    mockInvoke.mockResolvedValueOnce('iceland-2024') // suggest_slug

    const input = screen.getByPlaceholderText('Iceland 2024')
    // Type the same name as an existing project (different case)
    await user.type(input, 'iceland 2024')

    await user.click(screen.getByRole('button', { name: 'Create' }))

    // Error message should appear — no create_project call should have been made
    await waitFor(() => {
      expect(screen.getByText(/already exists/i)).toBeInTheDocument()
    })

    // Verify create_project was NOT called
    expect(mockInvoke).not.toHaveBeenCalledWith('create_project', expect.anything())

    // Should stay on project-list
    expect(navigation.current.kind).toBe('project-list')
  })

  it('allows creating a project with a unique name', async () => {
    await renderWithProjects([ICELAND])
    const user = userEvent.setup()

    await user.click(screen.getByText('New Project'))

    // Use command-based mock to handle non-deterministic ordering
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === 'suggest_slug') return Promise.resolve('new-unique-project')
      if (cmd === 'create_project') return Promise.resolve({
        id: 5, name: 'New Unique Project', slug: 'new-unique-project',
        created_at: '2026-03-01T00:00:00Z', last_opened_at: null,
      })
      throw new Error(`Unmocked invoke("${cmd}")`)
    })

    const input = screen.getByPlaceholderText('Iceland 2024')
    await user.type(input, 'New Unique Project')

    await user.click(screen.getByRole('button', { name: 'Create' }))

    // Should navigate successfully — no error
    await waitFor(() => {
      expect(navigation.current.kind).toBe('stack-overview')
    })
    expect(screen.queryByText(/already exists/i)).not.toBeInTheDocument()
  })
})

describe('ProjectList — Open button (PL-18)', () => {
  it('Open button navigates to StackOverview', async () => {
    await renderWithProjects()
    const user = userEvent.setup()

    // Wait for project rows
    await waitFor(() => {
      expect(screen.getByText('Iceland 2024')).toBeInTheDocument()
    })

    // Mock open_project
    mockInvoke.mockResolvedValueOnce(ICELAND) // open_project

    const openButtons = screen.getAllByText('Open')
    await user.click(openButtons[0]) // Click first Open button (Iceland)

    await waitFor(() => {
      expect(navigation.current.kind).toBe('stack-overview')
    })
    if (navigation.current.kind === 'stack-overview') {
      expect(navigation.current.projectSlug).toBe('iceland-2024')
      expect(navigation.current.projectName).toBe('Iceland 2024')
    }
  })
})

describe('ProjectList — Delete flow (PL-19, PL-20, PL-21, PL-22)', () => {
  it('Delete button opens confirmation modal (PL-19)', async () => {
    await renderWithProjects()
    const user = userEvent.setup()

    await waitFor(() => {
      expect(screen.getByText('Iceland 2024')).toBeInTheDocument()
    })

    // No modal initially
    expect(screen.queryByText('Delete project?')).not.toBeInTheDocument()

    const deleteButtons = screen.getAllByText('Delete')
    await user.click(deleteButtons[0])

    // Modal appears
    await waitFor(() => {
      expect(screen.getByText('Delete project?')).toBeInTheDocument()
    })
  })

  it('Delete modal shows slug name and warning text (PL-20)', async () => {
    await renderWithProjects()
    const user = userEvent.setup()

    await waitFor(() => {
      expect(screen.getByText('Iceland 2024')).toBeInTheDocument()
    })

    const deleteButtons = screen.getAllByText('Delete')
    await user.click(deleteButtons[0])

    await waitFor(() => {
      expect(screen.getByText('Delete project?')).toBeInTheDocument()
    })
    // Slug is shown in the modal
    expect(screen.getByText('iceland-2024')).toBeInTheDocument()
    // Warning text
    expect(screen.getByText(/will be permanently deleted/)).toBeInTheDocument()
    expect(screen.getByText(/cannot be undone/)).toBeInTheDocument()
  })

  it('Cancel button closes the delete modal (PL-21)', async () => {
    await renderWithProjects()
    const user = userEvent.setup()

    await waitFor(() => {
      expect(screen.getByText('Iceland 2024')).toBeInTheDocument()
    })

    const deleteButtons = screen.getAllByText('Delete')
    await user.click(deleteButtons[0])

    await waitFor(() => {
      expect(screen.getByText('Delete project?')).toBeInTheDocument()
    })

    // Click Cancel
    await user.click(screen.getByText('Cancel'))

    // Modal gone
    await waitFor(() => {
      expect(screen.queryByText('Delete project?')).not.toBeInTheDocument()
    })
  })

  it('Delete modal: Delete calls deleteProject, refreshes list (PL-22)', async () => {
    await renderWithProjects()
    const user = userEvent.setup()

    await waitFor(() => {
      expect(screen.getByText('Iceland 2024')).toBeInTheDocument()
      expect(screen.getByText('Wedding')).toBeInTheDocument()
    })

    // Click Delete on first project (Iceland)
    const deleteButtons = screen.getAllByText('Delete')
    await user.click(deleteButtons[0])

    await waitFor(() => {
      expect(screen.getByText('Delete project?')).toBeInTheDocument()
    })

    // Mock delete_project + refreshed list_projects (only Wedding remains)
    mockInvoke.mockResolvedValueOnce(undefined)       // delete_project
    mockInvoke.mockResolvedValueOnce([WEDDING])       // list_projects (refresh)

    // Click Delete in modal
    // The modal has both Cancel and Delete buttons — get the one in the modal
    const modalDeleteBtn = screen.getAllByText('Delete').find(
      btn => btn.closest('.fixed') !== null
    )!
    await user.click(modalDeleteBtn)

    // After deletion, Iceland should be gone, Wedding remains
    await waitFor(() => {
      expect(screen.queryByText('Iceland 2024')).not.toBeInTheDocument()
      expect(screen.getByText('Wedding')).toBeInTheDocument()
    })
    // Modal should be closed
    expect(screen.queryByText('Delete project?')).not.toBeInTheDocument()

    // Verify the right IPC calls were made
    expect(mockInvoke).toHaveBeenCalledWith('delete_project', { slug: 'iceland-2024' })
    expect(mockInvoke).toHaveBeenCalledWith('list_projects')
  })
})

describe('ProjectList — error display (PL-27)', () => {
  it('shows red error banner when get_last_project fails', async () => {
    mockInvoke.mockRejectedValueOnce(new Error('Database locked')) // get_last_project fails
    render(ProjectList)
    await waitFor(() => {
      expect(screen.getByText(/Database locked/)).toBeInTheDocument()
    })
  })

  it('shows red error banner when open_project fails', async () => {
    await renderWithProjects()
    const user = userEvent.setup()

    await waitFor(() => {
      expect(screen.getByText('Iceland 2024')).toBeInTheDocument()
    })

    mockInvoke.mockRejectedValueOnce(new Error('Project corrupt')) // open_project fails

    const openButtons = screen.getAllByText('Open')
    await user.click(openButtons[0])

    await waitFor(() => {
      expect(screen.getByText(/Project corrupt/)).toBeInTheDocument()
    })
    // Should stay on project-list
    expect(navigation.current.kind).toBe('project-list')
  })
})

describe('ProjectList — M6: delete last project clears resume card', () => {
  it('deleting the resume project removes the resume card', async () => {
    // Set up with skipAutoOpen + resumeProject so the resume card is visible
    navigate({
      kind: 'project-list',
      skipAutoOpen: true,
      resumeProject: { slug: 'iceland-2024', name: 'Iceland 2024' },
    })
    mockInvoke.mockResolvedValueOnce([ICELAND])  // list_projects
    render(ProjectList)

    // Wait for resume card AND project list to render
    await waitFor(() => {
      expect(screen.getByText('Resume')).toBeInTheDocument()
      expect(screen.getByText('Open →')).toBeInTheDocument()
      expect(screen.getByText('Recent Projects')).toBeInTheDocument()
    })

    // Click Delete on Iceland in the project list
    const user = userEvent.setup()
    const deleteButtons = screen.getAllByText('Delete')
    await user.click(deleteButtons[0])

    // Confirm delete modal appears
    await waitFor(() => {
      expect(screen.getByText('Delete project?')).toBeInTheDocument()
    })

    // Mock delete_project + refreshed list_projects (empty after deletion)
    mockInvoke.mockResolvedValueOnce(undefined)  // delete_project
    mockInvoke.mockResolvedValueOnce([])          // list_projects (refresh — empty)

    const modalDeleteBtn = screen.getAllByText('Delete').find(
      btn => btn.closest('.fixed') !== null
    )!
    await user.click(modalDeleteBtn)

    // Resume card should disappear since we deleted the lastProject
    await waitFor(() => {
      expect(screen.queryByText('Resume')).not.toBeInTheDocument()
      expect(screen.queryByText('Open →')).not.toBeInTheDocument()
    })
  })
})

describe('ProjectList — Recent Projects heading (PL-34)', () => {
  it('shows "Recent Projects" heading when projects exist', async () => {
    await renderWithProjects()
    await waitFor(() => {
      expect(screen.getByText('Recent Projects')).toBeInTheDocument()
    })
  })

  it('does NOT show "Recent Projects" heading when project list is empty', async () => {
    mockInvoke.mockResolvedValueOnce(null)   // get_last_project → null
    mockInvoke.mockResolvedValueOnce([])     // list_projects → empty
    render(ProjectList)
    await waitFor(() => {
      expect(screen.getByText('GemKeep')).toBeInTheDocument()
    })
    expect(screen.queryByText('Recent Projects')).not.toBeInTheDocument()
  })
})
