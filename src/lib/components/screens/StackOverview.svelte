<script lang="ts">
  import { onMount, onDestroy, tick } from 'svelte'
  import { listen } from '@tauri-apps/api/event'
  import { open } from '@tauri-apps/plugin-dialog'
  import { navigation, back, navigate } from '$lib/stores/navigation.svelte.js'
  import {
    addSourceFolder, removeSourceFolder, listSourceFolders,
    startIndexing, cancelIndexing, pauseIndexing, resumeIndexing,
    getIndexingStatus, listStacks, getThumbnailUrl, resumeThumbnails,
    getBurstGap, setBurstGap, restack, mergeStacks, undoLastMerge,
    expandSourceScopes, getRoundStatus, getStackProgressBatch,
    type SourceFolder, type IndexingStatus, type StackSummary, type RoundStatus
  } from '$lib/api/index.js'
  import { formatDate } from '$lib/utils/date.js'
  import { createTimedError } from '$lib/utils/errors.js'
  import { mapVimKey, gridNavigate } from '$lib/utils/keyboard.js'
  import { createSelection, toggleSelect, extendSelection, clearSelection, getSelectedIds, type SelectionState } from '$lib/utils/selection.js'
  import ThumbnailProgress from '$lib/components/ThumbnailProgress.svelte'
  import BurstGapModal from '$lib/components/BurstGapModal.svelte'
  import IndexingPanel from '$lib/components/IndexingPanel.svelte'

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
  let showBurstPanel = $state(false)
  let burstRestacking = $state(false)
  let burstGapValue = $state(3)
  let selection = $state<SelectionState>(createSelection())
  let actionError = $state<string | null>(null)
  let thumbnailDebounceTimer: ReturnType<typeof setTimeout> | null = null
  const { show: showActionError, cleanup: cleanupErrorTimer } = createTimedError(5000, (v) => { actionError = v })
  let stackProgress = $state<Map<number, RoundStatus>>(new Map())

  async function loadStackProgress() {
    if (!projectSlug || stacks.length === 0) return
    try {
      const stackIds = stacks.map(s => s.stack_id)
      const batch = await getStackProgressBatch(projectSlug, stackIds)
      const progress = new Map<number, RoundStatus>()
      for (const [idStr, rs] of Object.entries(batch)) {
        if (rs && rs.decided > 0) progress.set(Number(idStr), rs)
      }
      stackProgress = progress
    } catch {
      stackProgress = new Map()
    }
  }

  // Load initial state
  onMount(async () => {
    window.addEventListener('keydown', handleKey)

    // Progressive thumbnail updates: debounce rapid thumbnail-ready events so that
    // bursts from the rayon pool are collapsed into a single listStacks call.
    unlistenThumbnail = await listen('thumbnail-ready', () => {
      if (thumbnailDebounceTimer) clearTimeout(thumbnailDebounceTimer)
      thumbnailDebounceTimer = setTimeout(async () => {
        if (projectSlug) stacks = await listStacks(projectSlug)
      }, 300)
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
    // Expand asset protocol scope for source folders (fire-and-forget, non-blocking)
    if (projectSlug) expandSourceScopes(projectSlug).catch(() => {})
    // Load stack progress badges (fire-and-forget)
    loadStackProgress().catch(() => {})
  })

  onDestroy(() => {
    window.removeEventListener('keydown', handleKey)
    if (pollInterval) clearInterval(pollInterval)
    unlistenThumbnail?.()
    cleanupErrorTimer()
    if (thumbnailDebounceTimer) clearTimeout(thumbnailDebounceTimer)
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
    await expandSourceScopes(projectSlug)
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
      try { status = await getIndexingStatus(projectSlug) } catch {
        status = { ...status, running: false, thumbnails_running: false }
      }
      try { stacks = await listStacks(projectSlug) } catch {}
      showActionError('Failed to start indexing. Please try again.')
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
    await cancelIndexing(projectSlug)
  }

  async function handlePause() {
    await pauseIndexing(projectSlug)
  }

  async function handleResume() {
    await resumeIndexing(projectSlug)
  }

  async function openBurstPanel() {
    try {
      burstGapValue = await getBurstGap()
    } catch (e) {
      console.warn('getBurstGap failed, using default:', e)
      burstGapValue = 3
    }
    showBurstPanel = true
  }

  async function saveBurstGap(gap: number) {
    burstRestacking = true
    try {
      await setBurstGap(gap)
      await restack(projectSlug)
      stacks = await listStacks(projectSlug)
      showBurstPanel = false
    } finally {
      burstRestacking = false
    }
  }

  function handleKey(e: KeyboardEvent) {
    if (e.key.toLowerCase() === 'b' && e.ctrlKey) { e.preventDefault(); openBurstPanel(); return }
    if (e.key.toLowerCase() === 'z' && e.ctrlKey) { e.preventDefault(); handleUndoMerge(); return }
    if (e.key === 'Escape' && showBurstPanel) { showBurstPanel = false; return }
    if (e.key === 'Escape') { back(); return }
    if (e.key === 'i' && sourceFolders.length > 0 && !status.running) { handleIndex(); return }
    if (e.key === 'r' && stacks.length > 0 && !status.running) { handleIndex(); return }
    if ((e.key === 'm' || e.key === 'M') && stacks.length > 0 && !status.running) { handleMerge(); return }
    if (e.key === 's' && stacks.length > 0 && !status.running) {
      selection = toggleSelect(selection, stacks[focusedIndex].stack_id, null)
      return
    }
    if (stacks.length > 0 && !status.running) {
      const cols = 4
      const mappedKey = mapVimKey(e)

      // Shift+Arrow: multi-select stacks in all 4 directions
      if (e.shiftKey && ['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp'].includes(e.key)) {
        const fromId = stacks[focusedIndex].stack_id
        const newIdx = gridNavigate(e.key, focusedIndex, stacks.length, cols)
        if (newIdx !== null) focusedIndex = newIdx
        selection = extendSelection(selection, fromId, stacks[focusedIndex].stack_id, null)
        e.preventDefault()
        scrollFocusedCardIntoView()
        return
      }

      const newIdx = gridNavigate(mappedKey, focusedIndex, stacks.length, cols)
      if (newIdx !== null) {
        focusedIndex = newIdx
        e.preventDefault()
        scrollFocusedCardIntoView()
      }

      if (e.key === 'Enter' && !(e.target instanceof HTMLInputElement)) {
        const stack = stacks[focusedIndex]
        navigation.stackOverviewFocusIndex = focusedIndex
        navigate({ kind: 'stack-focus', projectSlug, projectName, stackId: stack.stack_id })
      }
    }
  }

  function scrollFocusedCardIntoView() {
    tick().then(() => {
      const cards = document.querySelectorAll('[data-stack-card]')
      cards[focusedIndex]?.scrollIntoView({ block: 'nearest' })
    })
  }

  async function handleMerge() {
    const selectedIds = getSelectedIds(selection)
    if (selectedIds.length < 2) return
    try {
      const result = await mergeStacks(projectSlug, selectedIds)
      stacks = await listStacks(projectSlug)
      selection = clearSelection()
      // Focus on the merged stack
      const mergedIdx = stacks.findIndex(s => s.stack_id === result.merged_stack_id)
      focusedIndex = mergedIdx >= 0 ? mergedIdx : 0
    } catch (e) {
      console.error('mergeStacks failed:', e)
      showActionError('Failed to merge stacks. Please try again.')
    }
  }

  async function handleUndoMerge() {
    try {
      await undoLastMerge(projectSlug)
      stacks = await listStacks(projectSlug)
    } catch (e) {
      console.error('undoLastMerge failed:', e)
      showActionError('Failed to undo merge. Please try again.')
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

  function totalLogicalPhotos(): number {
    if (status.last_stats) return status.last_stats.logical_photos
    return stacks.reduce((sum, s) => sum + s.logical_photo_count, 0)
  }
</script>

{#snippet folderList(showRemove: boolean)}
  <div class="text-xs font-medium text-gray-500 uppercase tracking-wider">Source Folders</div>
  <ul class="flex flex-col gap-1">
    {#each sourceFolders as folder (folder.id)}
      <li class="flex items-center gap-2 text-sm text-gray-300">
        <span class="text-gray-500">📁</span>
        <span class="flex-1 font-mono text-xs truncate">{folder.path}</span>
        {#if showRemove}
          <button
            class="text-gray-600 hover:text-red-400 transition-colors text-xs px-1"
            onclick={() => handleRemoveFolder(folder.id)}
            title="Remove folder"
          >×</button>
        {/if}
      </li>
    {/each}
  </ul>
{/snippet}

<div class="h-screen bg-gray-950 text-gray-100 flex flex-col overflow-hidden">
  <!-- Topbar navigation -->
  <header class="sticky top-0 z-10 flex items-center gap-3 px-4 py-3 border-b border-gray-800 bg-gray-900">
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

  <main class="flex-1 min-h-0 flex flex-col p-6 gap-6 overflow-hidden">

    {#if initialLoading}
      <div class="text-sm text-gray-500 animate-pulse">Loading…</div>
    {:else}

    {#if stacks.length === 0 || status.running}
      <!-- States 1-3: No folders / Pre-index / Indexing in progress -->
      <IndexingPanel
        {sourceFolders}
        {status}
        {isGeneratingThumbnails}
        progressPct={progressPct()}
        thumbnailPct={thumbnailPct()}
        onAddFolder={handleAddFolder}
        onRemoveFolder={handleRemoveFolder}
        onStartIndex={handleIndex}
        onCancel={handleCancel}
        onPause={handlePause}
        onResume={handleResume}
      />

    {:else}
      <!-- STATE 4: Indexed, stacks visible (thumbnails may still be generating) -->
      <div class="flex flex-col gap-3">
        {@render folderList(true)}
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
        <ThumbnailProgress
          thumbnailsTotal={status.thumbnails_total}
          thumbnailsDone={status.thumbnails_done}
          thumbnailPct={thumbnailPct()}
          filesIndexed={status.total}
          errors={status.errors}
        />
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

      <!-- Stack grid (scrollable) -->
      <div class="flex-1 min-h-0 overflow-y-auto">
      <div class="grid grid-cols-4 gap-3">
        {#each stacks as stack, i (stack.stack_id)}
          <button
            data-stack-card
            class="flex flex-col rounded-lg overflow-hidden border transition-all text-left
              {i === focusedIndex
                ? 'border-blue-500 ring-2 ring-blue-500/30 bg-gray-800'
                : 'border-gray-800 bg-gray-900 hover:border-gray-600'}
              {selection.selected.has(stack.stack_id) ? 'ring-2 ring-yellow-400 border-yellow-400' : ''}"
            onclick={() => {
              focusedIndex = i
              if (selection.selected.size > 0) {
                // Selection mode: click toggles selection instead of entering
                selection = toggleSelect(selection, stack.stack_id, null)
              } else {
                navigation.stackOverviewFocusIndex = i
                navigate({ kind: 'stack-focus', projectSlug, projectName, stackId: stack.stack_id })
              }
            }}
            ondblclick={() => {
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
              <div class="text-xs text-gray-600">{formatDate(stack.earliest_capture, '(no EXIF)')}</div>
              {#if stackProgress.has(stack.stack_id)}
                {@const progress = stackProgress.get(stack.stack_id)!}
                {#if progress.undecided === 0}
                  <div class="text-xs text-green-400 flex items-center gap-1" data-testid="stack-badge-complete">
                    <span>✓</span> {progress.decided}/{progress.total_photos}
                  </div>
                {:else}
                  <div class="text-xs text-yellow-400 flex items-center gap-1" data-testid="stack-badge-progress">
                    <span>●</span> {progress.decided}/{progress.total_photos}
                  </div>
                {/if}
              {/if}
            </div>
          </button>
        {/each}
      </div>
      </div>
    {/if}

    {/if}

    {#if actionError}
      <div class="px-4 py-2 bg-red-900/80 text-red-200 text-sm rounded" data-testid="action-error">
        {actionError}
      </div>
    {/if}

  </main>

  {#if showBurstPanel}
    <BurstGapModal
      burstGap={burstGapValue}
      restacking={burstRestacking}
      onSave={saveBurstGap}
      onCancel={() => { showBurstPanel = false }}
    />
  {/if}
</div>
