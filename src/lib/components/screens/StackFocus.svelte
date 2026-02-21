<script lang="ts">
  import { onMount, onDestroy } from 'svelte'
  import { navigation, navigate } from '$lib/stores/navigation.svelte.js'
  import {
    listLogicalPhotos, getThumbnailUrl,
    type LogicalPhotoSummary
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

  onMount(() => {
    window.addEventListener('keydown', handleKey)
    if (projectSlug && stackId) {
      listLogicalPhotos(projectSlug, stackId)
        .then(result => { photos = result })
        .catch(e => console.error('listLogicalPhotos failed:', e))
        .finally(() => { loading = false })
    } else {
      loading = false
    }
  })

  onDestroy(() => {
    window.removeEventListener('keydown', handleKey)
  })

  function handleKey(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      if (screen) {
        navigate({ kind: 'stack-overview', projectSlug: screen.projectSlug, projectName: screen.projectName })
      }
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
          <div
            data-testid="photo-card"
            class="flex flex-col rounded-lg overflow-hidden border transition-all
              {i === focusedIndex
                ? 'border-blue-500 ring-2 ring-blue-500/30 bg-gray-800'
                : 'border-gray-800 bg-gray-900 hover:border-gray-600'}"
            role="button"
            tabindex="0"
            onclick={() => { focusedIndex = i }}
            onkeydown={(e) => { if (e.key === 'Enter') focusedIndex = i }}
          >
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
  </main>
</div>
