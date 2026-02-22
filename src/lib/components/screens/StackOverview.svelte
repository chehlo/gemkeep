<script lang="ts">
  import { onMount, onDestroy, tick } from 'svelte'
  import { listen } from '@tauri-apps/api/event'
  import { open } from '@tauri-apps/plugin-dialog'
  import { navigation, back, navigate } from '$lib/stores/navigation.svelte.js'
  import {
    addSourceFolder, removeSourceFolder, listSourceFolders,
    startIndexing, cancelIndexing, pauseIndexing, resumeIndexing,
    getIndexingStatus, listStacks, getThumbnailUrl, resumeThumbnails,
    type SourceFolder, type IndexingStatus, type StackSummary
  } from '$lib/api/index.js'

  // Derive project info from navigation state
  const projectSlug = $derived(
    navigation.current.kind === 'stack-overview' ? navigation.current.projectSlug : ''
  )
  const projectName = $derived(
    navigation.current.kind === 'stack-overview' ? navigation.current.projectName : ''
  )

  // State
  let initialLoading = $state(true)
  let sourceFolders = $state<SourceFolder[]>([])
  let status = $state<IndexingStatus>({ running: false, thumbnails_running: false, total: 0, processed: 0, errors: 0, cancelled: false, paused: false, last_stats: null, thumbnails_total: 0, thumbnails_done: 0 })
  let stacks = $state<StackSummary[]>([])
  let focusedIndex = $state(0)
  let pollInterval: ReturnType<typeof setInterval> | null = null
  let showErrors = $state(false)
  let unlistenThumbnail: (() => void) | null = null

  // Load initial state
  onMount(async () => {
    window.addEventListener('keydown', handleKey)

    // Progressive thumbnail updates: each thumbnail-ready event triggers a stack reload
    // so cards show their images as soon as they are written, not all at once.
    unlistenThumbnail = await listen('thumbnail-ready', async () => {
      if (projectSlug) stacks = await listStacks(projectSlug)
    })

    let restoreIdx: number | null = null
    try {
      restoreIdx = await loadAll()
    } catch (e) {
      console.error("loadAll failed:", e)
    } finally {
      initialLoading = false
      if (restoreIdx !== null) {
        // tick() waits for Svelte to flush the DOM update (initialLoading=false → cards render)
        await tick()
        const cards = document.querySelectorAll('[data-stack-card]')
        cards[restoreIdx]?.scrollIntoView({ block: 'nearest', behavior: 'instant' })
      }
    }
  })

  onDestroy(() => {
    window.removeEventListener('keydown', handleKey)
    if (pollInterval) clearInterval(pollInterval)
    unlistenThumbnail?.()
  })

  async function loadAll(): Promise<number | null> {
    if (!projectSlug) return null
    sourceFolders = await listSourceFolders(projectSlug)
    stacks = await listStacks(projectSlug)

    // Restore focus position when returning from StackFocus.
    // Return the index so onMount can scroll after DOM renders (via tick()).
    let restoreIdx: number | null = null
    const savedIdx = navigation.stackOverviewFocusIndex
    if (savedIdx !== null && savedIdx >= 0) {
      navigation.stackOverviewFocusIndex = null
      if (savedIdx < stacks.length) {
        focusedIndex = savedIdx
        restoreIdx = savedIdx
      }
    }

    status = await getIndexingStatus(projectSlug)
    if (status.running || status.thumbnails_running) {
      startPolling()
    } else if (sourceFolders.length > 0 && stacks.length === 0) {
      // Auto-start indexing when folders are set but no stacks yet
      await handleIndex()
    } else if (stacks.length > 0 && stacks.some(s => s.thumbnail_path === null)) {
      // Resume thumbnail generation on re-open when some thumbnails are missing
      await handleResumeThumbnails()
    }

    return restoreIdx
  }

  function startPolling() {
    if (pollInterval) return
    const poll = async () => {
      const newStatus = await getIndexingStatus(projectSlug)
      if (newStatus == null) return
      status = newStatus
      if (status.running || status.thumbnails_running) {
        stacks = await listStacks(projectSlug)
      }
      if (!status.running && !status.thumbnails_running) {
        stacks = await listStacks(projectSlug)
        clearInterval(pollInterval!)
        pollInterval = null
      }
    }
    poll()
    pollInterval = setInterval(poll, 500)
  }

  async function handleAddFolder() {
    const path = await open({ directory: true, multiple: false })
    if (!path || typeof path !== 'string') return
    await addSourceFolder(projectSlug, path)
    sourceFolders = await listSourceFolders(projectSlug)
    // Auto-start indexing when user adds the first folder and has no stacks yet
    if (sourceFolders.length > 0 && stacks.length === 0 && !status.running && !status.thumbnails_running) {
      await handleIndex()
    }
  }

  async function handleRemoveFolder(id: number) {
    await removeSourceFolder(projectSlug, id)
    sourceFolders = await listSourceFolders(projectSlug)
  }

  async function handleIndex() {
    stacks = []
    status = { ...status, running: true, thumbnails_running: false, processed: 0, total: 0, errors: 0, cancelled: false, paused: false, thumbnails_total: 0, thumbnails_done: 0 }
    try {
      await startIndexing(projectSlug)
      startPolling()
    } catch (e) {
      console.error("startIndexing failed:", e)
      try { status = await getIndexingStatus(projectSlug) } catch {}
      try { stacks = await listStacks(projectSlug) } catch {}
    }
  }

  async function handleResumeThumbnails() {
    if (!projectSlug) return
    try {
      await resumeThumbnails(projectSlug)
      startPolling()
    } catch (e) {
      console.error('resumeThumbnails failed:', e)
    }
  }

  async function handleCancel() {
    await cancelIndexing()
  }

  async function handlePause() {
    await pauseIndexing()
  }

  async function handleResume() {
    await resumeIndexing()
  }

  function handleKey(e: KeyboardEvent) {
    if (e.key === 'Escape') { back(); return }
    if (e.key === 'i' && sourceFolders.length > 0 && !status.running) { handleIndex(); return }
    if (e.key === 'r' && stacks.length > 0 && !status.running) { handleIndex(); return }
    if (stacks.length > 0 && !status.running) {
      const cols = 4
      if (e.key === 'ArrowRight') { focusedIndex = Math.min(focusedIndex + 1, stacks.length - 1); e.preventDefault() }
      if (e.key === 'ArrowLeft') { focusedIndex = Math.max(focusedIndex - 1, 0); e.preventDefault() }
      if (e.key === 'ArrowDown') { focusedIndex = Math.min(focusedIndex + cols, stacks.length - 1); e.preventDefault() }
      if (e.key === 'ArrowUp') { focusedIndex = Math.max(focusedIndex - cols, 0); e.preventDefault() }
      if (e.key === 'Enter') {
        const stack = stacks[focusedIndex]
        navigation.stackOverviewFocusIndex = focusedIndex
        navigate({ kind: 'stack-focus', projectSlug, projectName, stackId: stack.stack_id })
      }
    }
  }

  function progressPct(): number {
    if (status.total === 0) return 0
    return Math.round((status.processed / status.total) * 100)
  }

  function thumbnailPct(): number {
    if (status.thumbnails_total === 0) return 0
    return Math.round((status.thumbnails_done / status.thumbnails_total) * 100)
  }

  // True while thumbnails are being generated in the background.
  const isGeneratingThumbnails = $derived(status.thumbnails_running)

  function formatDate(iso: string | null): string {
    if (!iso) return '(no EXIF)'
    try {
      return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    } catch {
      return iso
    }
  }

  function totalLogicalPhotos(): number {
    if (status.last_stats) return status.last_stats.logical_photos
    return stacks.reduce((sum, s) => sum + s.logical_photo_count, 0)
  }
</script>

<div class="min-h-screen bg-gray-950 text-gray-100 flex flex-col">
  <!-- Topbar navigation -->
  <header class="flex items-center gap-3 px-4 py-3 border-b border-gray-800 bg-gray-900">
    <button
      class="flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-200 transition-colors"
      onclick={back}
      title="Back to Projects (Esc)"
    >
      <span class="text-base">←</span>
      Projects
    </button>
    <span class="text-gray-600">/</span>
    <span class="text-sm text-gray-200 font-medium">{projectName}</span>
    <span class="ml-auto text-xs text-gray-600">Esc</span>
  </header>

  <main class="flex-1 flex flex-col p-6 gap-6">

    {#if initialLoading}
      <div class="text-sm text-gray-500 animate-pulse">Loading…</div>
    {:else}

    {#if sourceFolders.length === 0 && !status.running}
      <!-- STATE 1: No source folders -->
      <div class="flex flex-col items-start gap-4">
        <p class="text-gray-400 text-sm">No source folders attached.</p>
        <button
          class="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded transition-colors"
          onclick={handleAddFolder}
        >
          + Add Folder
        </button>
      </div>

    {:else if sourceFolders.length > 0 && !status.running && stacks.length === 0}
      <!-- STATE 2: Folders attached, not yet indexed -->
      <div class="flex flex-col gap-3">
        <div class="text-xs font-medium text-gray-500 uppercase tracking-wider">Source Folders</div>
        <ul class="flex flex-col gap-1">
          {#each sourceFolders as folder (folder.id)}
            <li class="flex items-center gap-2 text-sm text-gray-300">
              <span class="text-gray-500">📁</span>
              <span class="flex-1 font-mono text-xs truncate">{folder.path}</span>
              <button
                class="text-gray-600 hover:text-red-400 transition-colors text-xs px-1"
                onclick={() => handleRemoveFolder(folder.id)}
                title="Remove folder"
              >×</button>
            </li>
          {/each}
        </ul>
        <button
          class="self-start px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm rounded transition-colors"
          onclick={handleAddFolder}
        >
          + Add Folder
        </button>
      </div>

      <hr class="border-gray-800" />

      <div class="flex items-center gap-3">
        <button
          class="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded transition-colors"
          onclick={handleIndex}
        >
          Index Photos
        </button>
        <span class="text-xs text-gray-600">or press <kbd class="font-mono bg-gray-800 px-1 rounded">i</kbd></span>
      </div>

    {:else if status.running}
      <!-- STATE 3: Indexing in progress -->
      <div class="flex flex-col gap-3">
        <div class="text-xs font-medium text-gray-500 uppercase tracking-wider">Source Folders</div>
        <ul class="flex flex-col gap-1">
          {#each sourceFolders as folder (folder.id)}
            <li class="flex items-center gap-2 text-sm text-gray-300">
              <span class="text-gray-500">📁</span>
              <span class="flex-1 font-mono text-xs truncate">{folder.path}</span>
            </li>
          {/each}
        </ul>
      </div>

      <hr class="border-gray-800" />

      <div class="flex flex-col gap-3 max-w-lg">
        {#if isGeneratingThumbnails}
          <div class="flex flex-col gap-2 max-w-lg">
            <div class="text-sm text-gray-300 font-medium">Generating thumbnails…</div>
            {#if status.thumbnails_total > 0}
              <!-- Determinate progress bar -->
              <div class="w-full bg-gray-800 rounded-full h-2">
                <div
                  class="bg-blue-500 h-2 rounded-full transition-all duration-300"
                  style="width: {thumbnailPct()}%"
                ></div>
              </div>
              <div class="text-xs text-gray-500">
                {status.thumbnails_done.toLocaleString()} / {status.thumbnails_total.toLocaleString()} thumbnails
                ({thumbnailPct()}%)
                {#if status.errors > 0}
                  <span class="text-red-400 ml-2">{status.errors} error{status.errors === 1 ? '' : 's'}</span>
                {/if}
              </div>
            {:else}
              <!-- Indeterminate spinner (before thumbnails_total is populated) -->
              <div class="flex items-center gap-2">
                <div class="w-4 h-4 rounded-full border-2 border-blue-500 border-t-transparent animate-spin flex-shrink-0"></div>
                <div class="text-xs text-gray-500">
                  {status.total.toLocaleString()} files indexed
                  {#if status.errors > 0}
                    <span class="text-red-400 ml-2">{status.errors} error{status.errors === 1 ? '' : 's'}</span>
                  {/if}
                </div>
              </div>
            {/if}
          </div>
        {:else}
          <!-- EXIF / scan phase -->
          <div class="text-sm text-gray-300 font-medium">Indexing…</div>
          <div class="w-full bg-gray-800 rounded-full h-2">
            <div
              class="bg-blue-500 h-2 rounded-full transition-all duration-300"
              style="width: {progressPct()}%"
            ></div>
          </div>
          <div class="text-xs text-gray-500">
            {status.processed.toLocaleString()} / {status.total.toLocaleString()} files
            {#if status.errors > 0}
              <span class="text-red-400 ml-2">{status.errors} error{status.errors === 1 ? '' : 's'}</span>
            {/if}
          </div>
        {/if}

        <div class="flex items-center gap-2">
          {#if status.paused}
            <button
              class="px-3 py-1.5 bg-blue-700 hover:bg-blue-600 text-white text-sm rounded transition-colors"
              onclick={handleResume}
            >
              Resume
            </button>
          {:else}
            <button
              class="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm rounded transition-colors"
              onclick={handlePause}
            >
              Pause
            </button>
          {/if}
          <button
            class="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm rounded transition-colors"
            onclick={handleCancel}
          >
            Cancel
          </button>
        </div>
      </div>

    {:else}
      <!-- STATE 4: Indexed, stacks visible (thumbnails may still be generating) -->
      <div class="flex flex-col gap-3">
        <div class="text-xs font-medium text-gray-500 uppercase tracking-wider">Source Folders</div>
        <ul class="flex flex-col gap-1">
          {#each sourceFolders as folder (folder.id)}
            <li class="flex items-center gap-2 text-sm text-gray-300">
              <span class="text-gray-500">📁</span>
              <span class="flex-1 font-mono text-xs truncate">{folder.path}</span>
              <button
                class="text-gray-600 hover:text-red-400 transition-colors text-xs px-1"
                onclick={() => handleRemoveFolder(folder.id)}
                title="Remove folder"
              >×</button>
            </li>
          {/each}
        </ul>
        <div class="flex items-center gap-2">
          <button
            class="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm rounded transition-colors"
            onclick={handleAddFolder}
          >
            + Add Folder
          </button>
          <button
            class="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm rounded transition-colors"
            onclick={handleIndex}
          >
            Re-index
          </button>
          <span class="text-xs text-gray-600">or press <kbd class="font-mono bg-gray-800 px-1 rounded">r</kbd></span>
        </div>
      </div>

      <hr class="border-gray-800" />

      {#if isGeneratingThumbnails}
        <div class="flex flex-col gap-2 max-w-lg">
          <div class="text-sm text-gray-300 font-medium">Generating thumbnails…</div>
          {#if status.thumbnails_total > 0}
            <!-- Determinate progress bar -->
            <div class="w-full bg-gray-800 rounded-full h-2">
              <div
                class="bg-blue-500 h-2 rounded-full transition-all duration-300"
                style="width: {thumbnailPct()}%"
              ></div>
            </div>
            <div class="text-xs text-gray-500">
              {status.thumbnails_done.toLocaleString()} / {status.thumbnails_total.toLocaleString()} thumbnails
              ({thumbnailPct()}%)
              {#if status.errors > 0}
                <span class="text-red-400 ml-2">{status.errors} error{status.errors === 1 ? '' : 's'}</span>
              {/if}
            </div>
          {:else}
            <!-- Indeterminate spinner (before thumbnails_total is populated) -->
            <div class="flex items-center gap-2">
              <div class="w-4 h-4 rounded-full border-2 border-blue-500 border-t-transparent animate-spin flex-shrink-0"></div>
              <div class="text-xs text-gray-500">
                {status.total.toLocaleString()} files indexed
                {#if status.errors > 0}
                  <span class="text-red-400 ml-2">{status.errors} error{status.errors === 1 ? '' : 's'}</span>
                {/if}
              </div>
            </div>
          {/if}
        </div>
      {/if}

      <!-- Summary line -->
      <div class="flex flex-col gap-2">
        <div class="text-sm text-gray-300">
          Index complete.
          <span class="text-gray-400 ml-2">Stacks: <span class="text-gray-100 font-medium">{stacks.length.toLocaleString()}</span></span>
          <span class="text-gray-400 ml-2">Logical Photos: <span class="text-gray-100 font-medium">{totalLogicalPhotos().toLocaleString()}</span></span>
        </div>

        {#if status.last_stats && status.last_stats.errors > 0}
          <div>
            <button
              class="text-xs text-red-400 hover:text-red-300 transition-colors"
              onclick={() => showErrors = !showErrors}
            >
              {showErrors ? '▾' : '▸'} Show {status.last_stats.errors} error{status.last_stats.errors === 1 ? '' : 's'}
            </button>
            {#if showErrors && status.last_stats.error_log.length > 0}
              <ul class="mt-2 flex flex-col gap-1 max-h-32 overflow-y-auto">
                {#each status.last_stats.error_log as err}
                  <li class="text-xs text-red-400 font-mono">{err}</li>
                {/each}
              </ul>
            {/if}
          </div>
        {/if}
      </div>

      <!-- Stack grid -->
      <div class="grid grid-cols-4 gap-3">
        {#each stacks as stack, i (stack.stack_id)}
          <button
            data-stack-card
            class="flex flex-col rounded-lg overflow-hidden border transition-all text-left
              {i === focusedIndex
                ? 'border-blue-500 ring-2 ring-blue-500/30 bg-gray-800'
                : 'border-gray-800 bg-gray-900 hover:border-gray-600'}"
            onclick={() => {
              focusedIndex = i
              navigation.stackOverviewFocusIndex = i
              navigate({ kind: 'stack-focus', projectSlug, projectName, stackId: stack.stack_id })
            }}
          >
            <!-- Thumbnail -->
            <div class="aspect-square w-full bg-gray-800 flex items-center justify-center overflow-hidden">
              {#if stack.thumbnail_path}
                <img src={getThumbnailUrl(stack.thumbnail_path)} alt="Stack {i + 1} thumbnail" class="w-full h-full object-cover" />
              {:else}
                <span class="text-3xl text-gray-600">📷</span>
              {/if}
            </div>

            <!-- Card info -->
            <div class="p-2 flex flex-col gap-0.5">
              <div class="text-xs font-medium text-gray-300">Stack #{i + 1}</div>
              <div class="text-xs text-gray-500">
                {stack.logical_photo_count} photo{stack.logical_photo_count === 1 ? '' : 's'}
              </div>
              <div class="text-xs text-gray-600">{formatDate(stack.earliest_capture)}</div>
            </div>
          </button>
        {/each}
      </div>
    {/if}

    {/if}

  </main>
</div>
