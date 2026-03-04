<script lang="ts">
  import { onMount, onDestroy } from 'svelte'
  import { navigation, navigate } from '$lib/stores/navigation.svelte.js'
  import {
    listLogicalPhotos, getThumbnailUrl, getStackDecisions, getRoundStatus,
    makeDecision, commitRound, undoDecision,
    type LogicalPhotoSummary, type PhotoDecisionStatus, type RoundStatus
  } from '$lib/api/index.js'

  // Derive screen info from navigation state
  const screen = $derived(
    navigation.current.kind === 'stack-focus' ? navigation.current : null
  )
  const projectSlug = $derived(screen?.projectSlug ?? '')
  const projectName = $derived(screen?.projectName ?? '')
  const stackId = $derived(screen?.stackId ?? 0)

  // State
  let loading = $state(true)
  let photos = $state<LogicalPhotoSummary[]>([])
  let focusedIndex = $state(0)
  let decisions = $state<PhotoDecisionStatus[]>([])
  let roundStatus = $state<RoundStatus | null>(null)
  let actionError = $state<string | null>(null)
  let actionErrorTimer: ReturnType<typeof setTimeout> | null = null

  function showActionError(msg: string) {
    actionError = msg
    if (actionErrorTimer) clearTimeout(actionErrorTimer)
    actionErrorTimer = setTimeout(() => { actionError = null }, 3000)
  }

  function getDecisionStatus(photoId: number): string {
    const d = decisions.find(d => d.logical_photo_id === photoId)
    return d?.current_status ?? 'undecided'
  }

  const decidedCount = $derived(
    decisions.filter(d => d.current_status !== 'undecided').length
  )

  onMount(async () => {
    window.addEventListener('keydown', handleKey)
    if (projectSlug && stackId) {
      try {
        photos = await listLogicalPhotos(projectSlug, stackId)
        try {
          decisions = await getStackDecisions(projectSlug, stackId)
        } catch (e) {
          console.error('getStackDecisions failed:', e)
        }
        try {
          roundStatus = await getRoundStatus(projectSlug, stackId)
        } catch (e) {
          console.error('getRoundStatus failed:', e)
        }
      } catch (e) {
        console.error('listLogicalPhotos failed:', e)
      } finally {
        loading = false
      }
    } else {
      loading = false
    }
  })

  onDestroy(() => {
    window.removeEventListener('keydown', handleKey)
    if (actionErrorTimer) clearTimeout(actionErrorTimer)
  })

  async function handleKey(e: KeyboardEvent) {
    if (e.key === 'Enter' && e.ctrlKey) {
      e.preventDefault()
      try {
        await commitRound(projectSlug, stackId)
      } catch (err) {
        console.error('commitRound failed:', err)
        showActionError('Failed to commit round. Please try again.')
        return
      }
      try {
        roundStatus = await getRoundStatus(projectSlug, stackId)
      } catch (e) {
        console.error('getRoundStatus after commit failed:', e)
      }
      return
    }

    if (e.key === 'Enter' && photos.length > 0) {
      navigate({
        kind: 'single-view',
        projectSlug,
        stackId,
        photoId: photos[focusedIndex].logical_photo_id,
        projectName,
      })
      return
    }

    if (e.key === 'Escape') {
      if (screen) {
        navigate({ kind: 'stack-overview', projectSlug: screen.projectSlug, projectName: screen.projectName })
      }
      return
    }

    if (e.key === 'Tab' && !e.shiftKey) {
      e.preventDefault()
      // Jump to next undecided photo
      if (decisions.length > 0 && photos.length > 0) {
        for (let offset = 1; offset < photos.length; offset++) {
          const idx = (focusedIndex + offset) % photos.length
          const photoAtIdx = photos[idx]
          const decision = decisions.find(d => d.logical_photo_id === photoAtIdx.logical_photo_id)
          if (!decision || decision.current_status === 'undecided') {
            focusedIndex = idx
            return
          }
        }
      }
      return
    }

    if (e.key === 'Tab' && e.shiftKey) {
      e.preventDefault()
      // Jump to previous undecided photo
      if (decisions.length > 0 && photos.length > 0) {
        for (let offset = 1; offset < photos.length; offset++) {
          const idx = (focusedIndex - offset + photos.length) % photos.length
          const photoAtIdx = photos[idx]
          const decision = decisions.find(d => d.logical_photo_id === photoAtIdx.logical_photo_id)
          if (!decision || decision.current_status === 'undecided') {
            focusedIndex = idx
            return
          }
        }
      }
      return
    }

    if ((e.key === 'y' || e.key === 'Y') && photos.length > 0) {
      if (roundStatus && roundStatus.state === 'committed') return
      try {
        await makeDecision(projectSlug, photos[focusedIndex].logical_photo_id, 'keep')
        updateDecisionState(photos[focusedIndex].logical_photo_id, 'keep')
        roundStatus = await getRoundStatus(projectSlug, stackId)
      } catch (err) { console.error('makeDecision failed:', err) }
      return
    }

    if ((e.key === 'x' || e.key === 'X') && photos.length > 0) {
      if (roundStatus && roundStatus.state === 'committed') return
      try {
        await makeDecision(projectSlug, photos[focusedIndex].logical_photo_id, 'eliminate')
        updateDecisionState(photos[focusedIndex].logical_photo_id, 'eliminate')
        roundStatus = await getRoundStatus(projectSlug, stackId)
      } catch (err) { console.error('makeDecision failed:', err) }
      return
    }

    if ((e.key === 'u' || e.key === 'U') && photos.length > 0) {
      if (roundStatus && roundStatus.state === 'committed') return
      try {
        await undoDecision(projectSlug, photos[focusedIndex].logical_photo_id)
        updateDecisionState(photos[focusedIndex].logical_photo_id, 'undecided')
        roundStatus = await getRoundStatus(projectSlug, stackId)
      } catch (err) { console.error('undoDecision failed:', err) }
      return
    }

    if (photos.length > 0) {
      const cols = 4
      if (e.key === 'ArrowRight') { focusedIndex = Math.min(focusedIndex + 1, photos.length - 1); e.preventDefault() }
      if (e.key === 'ArrowLeft')  { focusedIndex = Math.max(focusedIndex - 1, 0); e.preventDefault() }
      if (e.key === 'ArrowDown')  { focusedIndex = Math.min(focusedIndex + cols, photos.length - 1); e.preventDefault() }
      if (e.key === 'ArrowUp')    { focusedIndex = Math.max(focusedIndex - cols, 0); e.preventDefault() }
    }
  }

  function updateDecisionState(photoId: number, status: string) {
    const existing = decisions.findIndex(d => d.logical_photo_id === photoId)
    if (existing >= 0) {
      decisions[existing] = { ...decisions[existing], current_status: status }
    } else {
      decisions = [...decisions, { logical_photo_id: photoId, current_status: status }]
    }
  }

  function formatCaptureTime(iso: string | null): string {
    if (!iso) return '(no date)'
    try {
      const d = new Date(iso)
      const month = d.toLocaleString('en-US', { month: 'short' })
      const day = d.getDate()
      const hours = String(d.getUTCHours()).padStart(2, '0')
      const minutes = String(d.getUTCMinutes()).padStart(2, '0')
      const seconds = String(d.getUTCSeconds()).padStart(2, '0')
      return `${month} ${day} ${hours}:${minutes}:${seconds}`
    } catch {
      return iso
    }
  }

  function truncate(s: string | null, max: number): string {
    if (!s) return ''
    return s.length > max ? s.slice(0, max) : s
  }
</script>

<div class="min-h-screen bg-gray-950 text-gray-100 flex flex-col">
  <!-- Topbar navigation -->
  <header class="flex items-center gap-3 px-4 py-3 border-b border-gray-800 bg-gray-900">
    <button
      class="flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-200 transition-colors"
      onclick={() => {
        if (screen) navigate({ kind: 'stack-overview', projectSlug: screen.projectSlug, projectName: screen.projectName })
      }}
      title="Back to Stacks (Esc)"
    >
      <span class="text-base">←</span>
      Back
    </button>
    <span class="text-gray-600">/</span>
    <span class="text-sm text-gray-400">{projectName}</span>
    <span class="text-gray-600">›</span>
    <span class="text-sm text-gray-200 font-medium">Stack #{stackId}</span>
    {#if decisions?.length > 0}
      <span class="text-sm text-gray-400 ml-2">{decidedCount}/{photos.length} decided</span>
      {#if roundStatus}
        <span class="text-sm text-gray-400 ml-1">&middot; {roundStatus.kept} kept &middot; {roundStatus.eliminated} eliminated &middot; {roundStatus.undecided} undecided &middot; Round {roundStatus.round_number}</span>
      {/if}
    {/if}
    <span class="ml-auto text-xs text-gray-600">Esc</span>
  </header>

  <main class="flex-1 flex flex-col p-6 gap-6">
    {#if loading}
      <div class="text-sm text-gray-500 animate-pulse" data-testid="loading-indicator">Loading...</div>
    {:else if photos.length === 0}
      <div class="text-sm text-gray-500">No photos in this stack.</div>
    {:else}
      <!-- Photo grid -->
      <div class="grid grid-cols-4 gap-3">
        {#each photos as photo, i (photo.logical_photo_id)}
          {@const status = getDecisionStatus(photo.logical_photo_id)}
          <div
            data-testid="photo-card"
            class="relative flex flex-col rounded-lg overflow-hidden border transition-all
              {i === focusedIndex
                ? 'border-blue-500 ring-2 ring-blue-500/30 bg-gray-800'
                : 'border-gray-800 bg-gray-900 hover:border-gray-600'}
              {status === 'eliminate' ? 'opacity-50' : ''}"
            role="button"
            tabindex="0"
            onclick={() => { focusedIndex = i }}
            onkeydown={(e) => { if (e.key === 'Enter') focusedIndex = i }}
          >
            <!-- Decision badge -->
            {#if status === 'keep'}
              <div class="badge-keep absolute top-1 right-1 w-3 h-3 rounded-full bg-green-500"></div>
            {:else if status === 'eliminate'}
              <div class="badge-eliminate absolute top-1 right-1 w-3 h-3 rounded-full bg-red-500"></div>
            {/if}

            <!-- Thumbnail -->
            <div class="aspect-square w-full bg-gray-800 flex items-center justify-center overflow-hidden">
              {#if photo.thumbnail_path}
                <img
                  src={getThumbnailUrl(photo.thumbnail_path)}
                  alt="Photo {i + 1} thumbnail"
                  class="w-full h-full object-cover"
                />
              {:else}
                <span class="text-3xl text-gray-600" data-testid="photo-placeholder">📷</span>
              {/if}
            </div>

            <!-- Card info -->
            <div class="p-2 flex flex-col gap-0.5">
              <div class="text-xs text-gray-500">{formatCaptureTime(photo.capture_time)}</div>
              {#if photo.camera_model}
                <div class="text-xs text-gray-300 overflow-hidden text-ellipsis whitespace-nowrap" style="max-width: 100%">
                  {truncate(photo.camera_model, 18)}
                </div>
              {/if}
              {#if photo.lens}
                <div class="text-xs text-gray-500 overflow-hidden text-ellipsis whitespace-nowrap" style="max-width: 100%">
                  {truncate(photo.lens, 18)}
                </div>
              {/if}
              <!-- Badges -->
              <div class="flex gap-1 mt-0.5">
                {#if photo.has_raw}
                  <span class="text-xs px-1 py-0.5 rounded bg-green-800 text-green-200 font-medium leading-none">RAW</span>
                {/if}
                {#if photo.has_jpeg}
                  <span class="text-xs px-1 py-0.5 rounded bg-blue-800 text-blue-200 font-medium leading-none">JPEG</span>
                {/if}
              </div>
            </div>
          </div>
        {/each}
      </div>
    {/if}

    {#if actionError}
      <div class="px-4 py-2 bg-red-900/80 text-red-200 text-sm rounded" data-testid="action-error">
        {actionError}
      </div>
    {/if}
  </main>
</div>
