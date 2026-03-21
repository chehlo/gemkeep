<script lang="ts">
  import { onMount, onDestroy } from 'svelte'
  import { navigation, navigate, back } from '$lib/stores/navigation.svelte.js'
  import {
    getPhotoDetail, listLogicalPhotos, getStackDecisions, getRoundStatus,
    makeDecision, undoDecision,
    type PhotoDetail, type LogicalPhotoSummary, type PhotoDecisionStatus, type RoundStatus, type DecisionStatus
  } from '$lib/api/index.js'
  import PhotoFrame from '$lib/components/PhotoFrame.svelte'
  import { DECISION_TEXT, DECISION_TEXT_COLORS } from '$lib/constants/decisions'
  import { updateDecisionState as _updateDecisionState } from '$lib/utils/photos.js'
  import { createTimedError } from '$lib/utils/errors.js'
  import { resolveDisplaySrc } from '$lib/utils/display.js'
  import { toggleFileOverlay, copyToClipboard } from '$lib/utils/filepath.js'

  // Derive screen info from navigation state
  const screen = $derived(
    navigation.current.kind === 'single-view' ? navigation.current : null
  )
  const projectSlug = $derived(screen?.projectSlug ?? '')
  const projectName = $derived(screen?.projectName ?? '')
  const stackId = $derived(screen?.stackId ?? 0)
  const photoId = $derived(screen?.photoId ?? 0)

  // State
  let loading = $state(true)
  let currentPhoto = $state<PhotoDetail | null>(null)
  let photoList = $state<LogicalPhotoSummary[]>([])
  let decisions = $state<PhotoDecisionStatus[]>([])
  let roundStatus = $state<RoundStatus | null>(null)
  let currentIndex = $state(0)
  let showCameraParams = $state(true)
  let filePathOverlay = $state<string | null>(null)
  let decisionError = $state<string | null>(null)
  const { show: showDecisionError, cleanup: cleanupErrorTimer } = createTimedError(3000, (v) => { decisionError = v })

  onMount(async () => {
    window.addEventListener('keydown', handleKey)
    if (projectSlug && stackId && photoId) {
      try {
        currentPhoto = await getPhotoDetail(projectSlug, photoId)
        photoList = await listLogicalPhotos(projectSlug, stackId)
        decisions = await getStackDecisions(projectSlug, stackId)
        roundStatus = await getRoundStatus(projectSlug, stackId)
        // Find current index in photo list
        const idx = photoList.findIndex(p => p.logical_photo_id === photoId)
        if (idx >= 0) currentIndex = idx
      } catch (e) {
        console.error('SingleView mount failed:', e)
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
    if (e.key === 'Escape') {
      back()
      return
    }

    if (e.key === 'i' || e.key === 'I') {
      showCameraParams = !showCameraParams
      return
    }

    if ((e.key === 'f' || e.key === 'F') && !e.ctrlKey && !e.shiftKey && !e.altKey && currentPhoto) {
      const { overlay, shouldCopy } = toggleFileOverlay(filePathOverlay, currentPhoto)
      filePathOverlay = overlay
      if (shouldCopy && overlay) {
        copyToClipboard(overlay)
      }
      return
    }

    if (e.key === 'Tab' && !e.shiftKey) {
      e.preventDefault()
      // Jump to next undecided photo
      if (decisions.length > 0 && photoList.length > 0) {
        for (let offset = 1; offset < photoList.length; offset++) {
          const idx = (currentIndex + offset) % photoList.length
          const photoAtIdx = photoList[idx]
          const decision = decisions.find(d => d.logical_photo_id === photoAtIdx.logical_photo_id)
          if (!decision || decision.current_status === 'undecided') {
            currentIndex = idx
            currentPhoto = await getPhotoDetail(projectSlug, photoAtIdx.logical_photo_id)
            return
          }
        }
        showDecisionError('No undecided photos')
      }
      return
    }

    if (e.key === 'Tab' && e.shiftKey) {
      e.preventDefault()
      // Jump to previous undecided photo
      if (decisions.length > 0 && photoList.length > 0) {
        for (let offset = 1; offset < photoList.length; offset++) {
          const idx = (currentIndex - offset + photoList.length) % photoList.length
          const photoAtIdx = photoList[idx]
          const decision = decisions.find(d => d.logical_photo_id === photoAtIdx.logical_photo_id)
          if (!decision || decision.current_status === 'undecided') {
            currentIndex = idx
            currentPhoto = await getPhotoDetail(projectSlug, photoAtIdx.logical_photo_id)
            return
          }
        }
        showDecisionError('No undecided photos')
      }
      return
    }

    if (e.key === 'Home') {
      e.preventDefault()
      if (photoList.length > 0) {
        currentIndex = 0
        currentPhoto = await getPhotoDetail(projectSlug, photoList[0].logical_photo_id)
      }
      return
    }

    if (e.key === 'End') {
      e.preventDefault()
      if (photoList.length > 0) {
        currentIndex = photoList.length - 1
        currentPhoto = await getPhotoDetail(projectSlug, photoList[currentIndex].logical_photo_id)
      }
      return
    }

    if ((e.key === 'y' || e.key === 'Y') && currentPhoto) {
      try {
        await makeDecision(projectSlug, currentPhoto.logical_photo_id, 'keep')
        currentPhoto = { ...currentPhoto, current_status: 'keep' }
        updateDecisionState(currentPhoto.logical_photo_id, 'keep')
        roundStatus = await getRoundStatus(projectSlug, stackId)
      } catch (err) {
        console.error('makeDecision failed:', err)
        showDecisionError('Failed to save decision. Please try again.')
      }
      return
    }

    if ((e.key === 'x' || e.key === 'X') && currentPhoto) {
      try {
        await makeDecision(projectSlug, currentPhoto.logical_photo_id, 'eliminate')
        currentPhoto = { ...currentPhoto, current_status: 'eliminate' }
        updateDecisionState(currentPhoto.logical_photo_id, 'eliminate')
        roundStatus = await getRoundStatus(projectSlug, stackId)
      } catch (err) {
        console.error('makeDecision failed:', err)
        showDecisionError('Failed to save decision. Please try again.')
      }
      return
    }

    if ((e.key === 'u' || e.key === 'U') && currentPhoto) {
      try {
        await undoDecision(projectSlug, currentPhoto.logical_photo_id)
        currentPhoto = { ...currentPhoto, current_status: 'undecided' }
        updateDecisionState(currentPhoto.logical_photo_id, 'undecided')
        roundStatus = await getRoundStatus(projectSlug, stackId)
      } catch (err) { console.error('undoDecision failed:', err) }
      return
    }

    if (e.key === 'ArrowRight' || e.key === 'l') {
      if (photoList.length > 0 && currentIndex < photoList.length - 1) {
        currentIndex++
        currentPhoto = await getPhotoDetail(projectSlug, photoList[currentIndex].logical_photo_id)
      }
      e.preventDefault()
      return
    }

    if (e.key === 'ArrowLeft' || e.key === 'h') {
      if (photoList.length > 0 && currentIndex > 0) {
        currentIndex--
        currentPhoto = await getPhotoDetail(projectSlug, photoList[currentIndex].logical_photo_id)
      }
      e.preventDefault()
      return
    }
  }

  function updateDecisionState(photoId: number, status: DecisionStatus) {
    decisions = _updateDecisionState(decisions, photoId, status)
  }

  const statusText = (s: DecisionStatus) => DECISION_TEXT[s] || 'UNDECIDED'
  const statusClass = (s: DecisionStatus) => DECISION_TEXT_COLORS[s] || 'text-gray-400'

  const displaySrc = $derived(resolveDisplaySrc('full', currentPhoto))
</script>

<div class="h-screen bg-black text-gray-100 flex flex-col overflow-hidden">
  {#if loading}
    <div data-testid="loading-indicator">Loading...</div>
  {:else if currentPhoto}
    <!-- Photo display + camera params -->
    <PhotoFrame
      layout="fill"
      photo={currentPhoto}
      status={currentPhoto.current_status}
      imageUrl={displaySrc.quality !== 'none' ? displaySrc.url : null}
      showFilePath={filePathOverlay}
      showMetadata={showCameraParams}
      alt="Photo"
    />

    <!-- Decision error banner -->
    {#if decisionError}
      <div class="px-4 py-2 bg-red-900/80 text-red-200 text-sm" data-testid="decision-error">
        {decisionError}
      </div>
    {/if}

    <!-- Status bar -->
    <div class="px-4 py-2 bg-gray-900 border-t border-gray-800 text-sm text-gray-400">
      Photo {currentIndex + 1}/{photoList.length} — <span class={statusClass(currentPhoto.current_status)}>{statusText(currentPhoto.current_status)}{#if roundStatus?.state === 'committed'} (read-only){/if}</span>{#if roundStatus} — Stack #{stackId} · Round {roundStatus.round_number}{/if}
    </div>
  {/if}
</div>
