<script lang="ts">
  import { onMount } from 'svelte'
  import { navigate, navigation } from '$lib/stores/navigation.svelte.js'
  import {
    listProjects,
    getLastProject,
    createProject,
    openProject,
    deleteProject,
    suggestSlug,
    type Project
  } from '$lib/api/index.js'

  let projects = $state<Project[]>([])
  let lastProject = $state<Project | null>(null)
  let showNewForm = $state(false)
  let newName = $state('')
  let suggestedSlug = $state('')
  let isCreating = $state(false)
  let deleteConfirm = $state<string | null>(null)
  let error = $state<string | null>(null)

  // Debounce slug preview — update 200ms after user stops typing
  $effect(() => {
    if (!newName) {
      suggestedSlug = ''
      return
    }
    const t = setTimeout(async () => {
      try {
        suggestedSlug = await suggestSlug(newName)
      } catch {
        suggestedSlug = ''
      }
    }, 200)
    return () => clearTimeout(t)
  })

  onMount(async () => {
    try {
      const currentScreen = navigation.current
      const skipAutoOpen = currentScreen.kind === 'project-list' && currentScreen.skipAutoOpen === true
      if (!skipAutoOpen) {
        // First launch: auto-open last project
        const last = await getLastProject()
        if (last) {
          navigate({ kind: 'stack-overview', projectSlug: last.slug, projectName: last.name })
          return
        }
      } else {
        // Came back via back()/Escape — show Resume card but do NOT navigate away
        try {
          lastProject = await getLastProject()
        } catch { /* ignore */ }
      }
      projects = await listProjects()
    } catch (e) {
      error = String(e)
    }
  })

  async function handleCreate() {
    if (!newName.trim() || isCreating) return
    isCreating = true
    error = null
    try {
      const p = await createProject(newName.trim())
      navigate({ kind: 'stack-overview', projectSlug: p.slug, projectName: p.name })
    } catch (e) {
      error = String(e)
    } finally {
      isCreating = false
    }
  }

  async function handleOpen(p: Project) {
    error = null
    try {
      await openProject(p.slug)
      navigate({ kind: 'stack-overview', projectSlug: p.slug, projectName: p.name })
    } catch (e) {
      error = String(e)
    }
  }

  async function handleDelete(slug: string) {
    error = null
    try {
      await deleteProject(slug)
      deleteConfirm = null
      projects = await listProjects()
    } catch (e) {
      error = String(e)
    }
  }

  function formatDate(dt: string | null): string {
    if (!dt) return 'Never'
    return dt.slice(0, 10)
  }
</script>

<div class="min-h-screen bg-gray-950 text-gray-100 p-8">
  <h1 class="text-3xl font-bold mb-8 text-white">GemKeep</h1>

  {#if lastProject}
    <div class="mb-6 bg-blue-950/40 border border-blue-800/60 rounded-lg px-4 py-3 flex items-center justify-between max-w-lg">
      <div>
        <div class="text-xs text-blue-400 uppercase tracking-wide mb-0.5">Resume</div>
        <div class="text-white font-medium">{lastProject.name}</div>
      </div>
      <button
        class="bg-blue-600 hover:bg-blue-500 text-white px-4 py-1.5 rounded text-sm font-medium"
        onclick={() => lastProject && handleOpen(lastProject)}
      >
        Open →
      </button>
    </div>
  {/if}

  <!-- New Project Section -->
  <div class="mb-8">
    <button
      class="text-blue-400 hover:text-blue-300 font-medium mb-4 flex items-center gap-2"
      onclick={() => (showNewForm = !showNewForm)}
    >
      <span class="text-xl">{showNewForm ? '−' : '+'}</span>
      New Project
    </button>

    {#if showNewForm}
      <div class="bg-gray-900 border border-gray-700 rounded-lg p-6 max-w-md">
        <div class="mb-4">
          <label class="block text-sm text-gray-400 mb-1" for="project-name">Name</label>
          <input
            id="project-name"
            type="text"
            class="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2 text-white focus:outline-none focus:border-blue-500"
            bind:value={newName}
            placeholder="Iceland 2024"
            autofocus
            onkeydown={(e) => { if (e.key === 'Enter') handleCreate() }}
          />
        </div>
        {#if suggestedSlug}
          <div class="mb-4 text-sm text-gray-400">
            Slug: <span class="text-gray-300 font-mono">{suggestedSlug}</span>
          </div>
        {/if}
        <button
          class="bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white px-4 py-2 rounded font-medium"
          onclick={handleCreate}
          disabled={!newName.trim() || isCreating}
        >
          {isCreating ? 'Creating…' : 'Create'}
        </button>
      </div>
    {/if}
  </div>

  <!-- Error display -->
  {#if error}
    <div class="mb-4 bg-red-900/50 border border-red-700 rounded px-4 py-3 text-red-300 text-sm">
      {error}
    </div>
  {/if}

  <!-- Project List -->
  {#if projects.length > 0}
    <div>
      <h2 class="text-lg font-semibold text-gray-300 mb-3">Recent Projects</h2>
      <div class="border border-gray-700 rounded-lg overflow-hidden">
        {#each projects as project (project.id)}
          <div class="flex items-center justify-between px-4 py-3 border-b border-gray-800 last:border-0 hover:bg-gray-900">
            <div class="flex-1">
              <div class="font-medium text-white">{project.name}</div>
              <div class="text-xs text-gray-500 font-mono">{project.slug} · {formatDate(project.last_opened_at)}</div>
            </div>
            <div class="flex gap-2 ml-4">
              <button
                class="text-sm text-blue-400 hover:text-blue-300 px-3 py-1"
                onclick={() => handleOpen(project)}
              >
                Open
              </button>
              <button
                class="text-sm text-red-400 hover:text-red-300 px-3 py-1"
                onclick={() => (deleteConfirm = project.slug)}
              >
                Delete
              </button>
            </div>
          </div>
        {/each}
      </div>
    </div>
  {/if}
</div>

<!-- Delete Confirmation Modal -->
{#if deleteConfirm}
  <div class="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
    <div class="bg-gray-900 border border-gray-700 rounded-lg p-6 max-w-sm mx-4">
      <h3 class="text-white font-semibold mb-2">Delete project?</h3>
      <p class="text-gray-400 text-sm mb-6">
        <span class="font-mono text-gray-300">{deleteConfirm}</span> will be permanently deleted.
        This cannot be undone.
      </p>
      <div class="flex gap-3 justify-end">
        <button
          class="text-gray-400 hover:text-gray-200 px-4 py-2 text-sm"
          onclick={() => (deleteConfirm = null)}
        >
          Cancel
        </button>
        <button
          class="bg-red-700 hover:bg-red-600 text-white px-4 py-2 rounded text-sm font-medium"
          onclick={() => deleteConfirm && handleDelete(deleteConfirm)}
        >
          Delete
        </button>
      </div>
    </div>
  </div>
{/if}
