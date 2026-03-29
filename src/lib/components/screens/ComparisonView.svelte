<script lang="ts">
  import { onMount, onDestroy } from 'svelte'
  import { navigation, navigate } from '$lib/stores/navigation.svelte.js'
  import {
    listLogicalPhotos, getPhotoDetail, getRoundDecisions, getRoundStatus,
    type LogicalPhotoSummary, type PhotoDetail, type PhotoDecisionStatus, type RoundStatus, type DecisionStatus
  } from '$lib/api/index.js'
  import PhotoFrame from '$lib/components/PhotoFrame.svelte'
  import HelpOverlay from '$lib/components/HelpOverlay.svelte'
  import { getDecisionStatus as _getDecisionStatus } from '$lib/utils/photos.js'
  import { handleDecisionKey } from '$lib/utils/decisions.js'
  import { createTimedError } from '$lib/utils/errors.js'
  import { resolveDisplaySrc } from '$lib/utils/display.js'
  import { toggleFileOverlay } from '$lib/utils/filepath.js'

  const screen = $derived(
    navigation.current.kind === 'comparison-view' ? navigation.current : null
  )
  const projectSlug = $derived(screen?.projectSlug ?? '')
  const projectName = $derived(screen?.projectName ?? '')
  const stackId = $derived(screen?.stackId ?? 0)

  let loading = $state(true)
  let photos = $state<LogicalPhotoSummary[]>([])
  let decisions = $state<PhotoDecisionStatus[]>([])
  let roundStatus = $state<RoundStatus | null>(null)
  let currentRoundId = $state(0)
  let leftIndex = $state(0)
  let rightIndex = $state(1)
  let focusSide = $state<'left' | 'right'>('left')
  let locked = $state(false)
  let leftDetail = $state<PhotoDetail | null>(null)
  let rightDetail = $state<PhotoDetail | null>(null)
  let filePathOverlay = $state<string | null>(null)
  let showCameraParams = $state(true)
  let showHelp = $state(false)
  let actionError = $state<string | null>(null)
  const { show: showActionError, cleanup: cleanupErrorTimer } = createTimedError(3000, (v) => { actionError = v })

  function getDecisionStatus(photoId: number): DecisionStatus {
    return _getDecisionStatus(decisions, photoId)
  }

  const leftPhoto = $derived(photos[leftIndex] ?? null)
  const rightPhoto = $derived(photos[rightIndex] ?? null)
  const focusedPhoto = $derived(focusSide === 'left' ? leftPhoto : rightPhoto)
  const leftDisplaySrc = $derived(resolveDisplaySrc('full', leftDetail ?? leftPhoto))
  const rightDisplaySrc = $derived(resolveDisplaySrc('full', rightDetail ?? rightPhoto))

  function findNextUndecided(excludeIds: number[]): number | null {
    for (let i = 0; i < photos.length; i++) {
      const photo = photos[i]
      if (excludeIds.includes(photo.logical_photo_id)) continue
      if (i === leftIndex || i === rightIndex) continue
      const status = getDecisionStatus(photo.logical_photo_id)
      if (status === 'undecided') return i
    }
    return null
  }

  onMount(async () => {
    window.addEventListener('keydown', handleKey)
    if (projectSlug && stackId) {
      try {
        photos = await listLogicalPhotos(projectSlug, stackId, currentRoundId || undefined)
        try {
          decisions = await getRoundDecisions(projectSlug, stackId, currentRoundId)
        } catch (e) {
          console.error('getRoundDecisions failed:', e)
        }
        try {
          roundStatus = await getRoundStatus(projectSlug, stackId)
          if (roundStatus) {
            currentRoundId = roundStatus.round_id
            // Re-fetch photos scoped to the correct round
            photos = await listLogicalPhotos(projectSlug, stackId, currentRoundId)
          }
        } catch (e) {
          console.error('getRoundStatus failed:', e)
        }

        // Use selected photoIds if passed from StackFocus, otherwise find first two undecided
        const selectedPhotoIds = screen?.photoIds
        if (selectedPhotoIds && selectedPhotoIds.length === 2) {
          const idx0 = photos.findIndex(p => p.logical_photo_id === selectedPhotoIds[0])
          const idx1 = photos.findIndex(p => p.logical_photo_id === selectedPhotoIds[1])
          if (idx0 >= 0 && idx1 >= 0) {
            leftIndex = idx0
            rightIndex = idx1
          }
        } else {
          const undecidedIndices: number[] = []
          for (let i = 0; i < photos.length && undecidedIndices.length < 2; i++) {
            const status = getDecisionStatus(photos[i].logical_photo_id)
            if (status === 'undecided') undecidedIndices.push(i)
          }
          if (undecidedIndices.length >= 2) {
            leftIndex = undecidedIndices[0]
            rightIndex = undecidedIndices[1]
          } else if (undecidedIndices.length === 1) {
            leftIndex = undecidedIndices[0]
            rightIndex = undecidedIndices[0]
          }
        }
        await fetchDetails()
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
    cleanupErrorTimer()
  })

  async function handleKey(e: KeyboardEvent) {
    if (e.key === '?') {
      showHelp = !showHelp
      return
    }

    if (e.key === 'i' || e.key === 'I') {
      showCameraParams = !showCameraParams
      return
    }

    if (e.key === 'Escape') {
      if (screen) {
        navigate({ kind: 'stack-focus', projectSlug: screen.projectSlug, stackId: screen.stackId, projectName: screen.projectName })
      }
      return
    }

    if (e.key === 'ArrowLeft') {
      e.preventDefault()
      focusSide = 'left'
      return
    }

    if (e.key === 'ArrowRight') {
      e.preventDefault()
      focusSide = 'right'
      return
    }

    if (e.key === 'ArrowDown' || e.key === 'j') {
      e.preventDefault()
      const currentIdx = focusSide === 'left' ? leftIndex : rightIndex
      const otherIdx = focusSide === 'left' ? rightIndex : leftIndex
      let newIdx = (currentIdx + 1) % photos.length
      if (newIdx === otherIdx) newIdx = (newIdx + 1) % photos.length
      if (focusSide === 'left') leftIndex = newIdx; else rightIndex = newIdx
      fetchDetails()
      return
    }

    if (e.key === 'ArrowUp' || e.key === 'k') {
      e.preventDefault()
      const currentIdx = focusSide === 'left' ? leftIndex : rightIndex
      const otherIdx = focusSide === 'left' ? rightIndex : leftIndex
      let newIdx = (currentIdx - 1 + photos.length) % photos.length
      if (newIdx === otherIdx) newIdx = (newIdx - 1 + photos.length) % photos.length
      if (focusSide === 'left') leftIndex = newIdx; else rightIndex = newIdx
      fetchDetails()
      return
    }

    if ((e.key === 'l' || e.key === 'L') && !e.ctrlKey && !e.shiftKey && !e.altKey) {
      locked = !locked
      return
    }

    if ((e.key === 'y' || e.key === 'Y') && focusedPhoto) {
      const result = await handleDecisionKey(projectSlug, focusedPhoto.logical_photo_id, stackId, 'keep', decisions)
      if (result) {
        decisions = result.decisions
        roundStatus = result.roundStatus
      }
      return
    }

    if ((e.key === 'x' || e.key === 'X') && focusedPhoto) {
      const result = await handleDecisionKey(projectSlug, focusedPhoto.logical_photo_id, stackId, 'eliminate', decisions)
      if (result) {
        decisions = result.decisions
        roundStatus = result.roundStatus

        // Auto-fill: replace eliminated photo with next undecided
        if (!locked) {
          const currentSideIndex = focusSide === 'left' ? leftIndex : rightIndex
          const otherSideIndex = focusSide === 'left' ? rightIndex : leftIndex
          const nextIdx = findNextUndecided([photos[otherSideIndex].logical_photo_id])
          if (nextIdx !== null) {
            if (focusSide === 'left') leftIndex = nextIdx
            else rightIndex = nextIdx
            fetchDetails()
          } else {
            // No more undecided — exit to StackFocus
            if (screen) {
              navigate({ kind: 'stack-focus', projectSlug: screen.projectSlug, stackId: screen.stackId, projectName: screen.projectName })
            }
          }
        }
      }
      return
    }

    if ((e.key === 'f' || e.key === 'F') && !e.ctrlKey && !e.shiftKey && !e.altKey) {
      if (filePathOverlay !== null) {
        filePathOverlay = null
      } else {
        const focusedDetail = focusSide === 'left' ? leftDetail : rightDetail
        if (focusedDetail) {
          const { overlay } = toggleFileOverlay(filePathOverlay, focusedDetail)
          filePathOverlay = overlay
        }
      }
      return
    }

    if (e.key === 'Enter' && focusedPhoto) {
      navigate({ kind: 'single-view', projectSlug, stackId, photoId: focusedPhoto.logical_photo_id, projectName, from: 'comparison-view' })
      return
    }

    if ((e.key === 'u' || e.key === 'U') && focusedPhoto) {
      const result = await handleDecisionKey(projectSlug, focusedPhoto.logical_photo_id, stackId, 'undo', decisions)
      if (result) {
        decisions = result.decisions
        roundStatus = result.roundStatus
      }
      return
    }
  }

  async function fetchDetails() {
    if (!projectSlug) return
    const lp = photos[leftIndex]
    const rp = photos[rightIndex]
    if (lp) {
      try { leftDetail = await getPhotoDetail(projectSlug, lp.logical_photo_id) } catch { leftDetail = null }
    } else { leftDetail = null }
    if (rp) {
      try { rightDetail = await getPhotoDetail(projectSlug, rp.logical_photo_id) } catch { rightDetail = null }
    } else { rightDetail = null }
  }

</script>

<div class="relative h-screen bg-black text-gray-100 flex flex-col overflow-hidden">
  <!-- Header -->
  <header class="sticky top-0 z-10 flex items-center gap-3 px-4 py-3 border-b border-gray-800 bg-gray-900">
    <button
      class="flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-200 transition-colors"
      onclick={() => {
        if (screen) navigate({ kind: 'stack-focus', projectSlug: screen.projectSlug, stackId: screen.stackId, projectName: screen.projectName })
      }}
      title="Back to Stack Focus (Esc)"
    >
      <span class="text-base">←</span>
      Back
    </button>
    <span class="text-gray-600">/</span>
    <span class="text-sm text-gray-400">{projectName}</span>
    <span class="text-gray-600">›</span>
    <span class="text-sm text-gray-200 font-medium">Comparison</span>
    {#if locked}
      <span class="text-sm text-yellow-400 ml-2" data-testid="locked-indicator">Locked</span>
    {/if}
    {#if roundStatus}
      <span class="text-sm text-gray-400 ml-2">
        {roundStatus.decided}/{roundStatus.total_photos} decided · {roundStatus.kept} kept · {roundStatus.eliminated} eliminated · {roundStatus.undecided} undecided
      </span>
    {/if}
    <span class="ml-auto text-xs text-gray-600"></span>
  </header>

  <main class="flex-1 min-h-0 overflow-hidden flex">
    {#if loading}
      <div class="flex items-center justify-center w-full text-sm text-gray-500 animate-pulse" data-testid="loading-indicator">Loading...</div>
    {:else if photos.length < 2}
      <div class="flex items-center justify-center w-full text-sm text-gray-500" data-testid="error-message">Need at least 2 photos to compare</div>
    {:else}
      <!-- Left photo -->
      <div class="flex-1 min-h-0 flex flex-col border-r border-gray-800" data-testid="comparison-left">
        {#if leftPhoto}
          <PhotoFrame
            layout="panel"
            focused={focusSide === 'left'}
            photo={leftDetail ?? leftPhoto}
            status={getDecisionStatus(leftPhoto.logical_photo_id)}
            imageUrl={leftDisplaySrc.quality !== 'none' ? leftDisplaySrc.url : null}
            showFilePath={focusSide === 'left' ? filePathOverlay : null}
            showMetadata={showCameraParams}
            alt="Left comparison photo"
          />
        {/if}
      </div>

      <!-- Right photo -->
      <div class="flex-1 min-h-0 flex flex-col" data-testid="comparison-right">
        {#if rightPhoto}
          <PhotoFrame
            layout="panel"
            focused={focusSide === 'right'}
            photo={rightDetail ?? rightPhoto}
            status={getDecisionStatus(rightPhoto.logical_photo_id)}
            imageUrl={rightDisplaySrc.quality !== 'none' ? rightDisplaySrc.url : null}
            showFilePath={focusSide === 'right' ? filePathOverlay : null}
            showMetadata={showCameraParams}
            alt="Right comparison photo"
          />
        {/if}
      </div>
    {/if}
  </main>

  <HelpOverlay bind:visible={showHelp} />

  {#if actionError}
    <div class="fixed bottom-0 left-0 right-0 px-4 py-2 bg-gray-900 text-red-200 text-sm z-50" data-testid="action-error">
      {actionError}
    </div>
  {/if}
</div>
