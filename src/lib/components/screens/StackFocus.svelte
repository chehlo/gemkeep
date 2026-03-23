<script lang="ts">
  import { onMount, onDestroy, tick } from 'svelte'
  import { navigation, navigate } from '$lib/stores/navigation.svelte.js'
  import {
    listLogicalPhotos, getThumbnailUrl, getStackDecisions, getRoundStatus,
    makeDecision, commitRound, undoDecision, getPhotoDetail, listStacks, listRounds,
    type LogicalPhotoSummary, type PhotoDecisionStatus, type RoundStatus, type DecisionStatus, type RoundSummary
  } from '$lib/api/index.js'
  import PhotoFrame from '$lib/components/PhotoFrame.svelte'
  import RoundTabBar from '$lib/components/RoundTabBar.svelte'
  import { updateDecisionState as _updateDecisionState, getDecisionStatus as _getDecisionStatus } from '$lib/utils/photos.js'
  import { createTimedError } from '$lib/utils/errors.js'
  import { createSelection, toggleSelect, extendSelection, clearSelection, getSelectedIds, type SelectionState } from '$lib/utils/selection.js'
  import { toggleFileOverlay, copyToClipboard } from '$lib/utils/filepath.js'
  import { mapVimKey, gridNavigate } from '$lib/utils/keyboard.js'

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
  let currentRoundId = $state(0)
  let actionError = $state<string | null>(null)
  let rounds = $state<RoundSummary[]>([])
  let roundError = $state<string | null>(null)
  const { show: showActionError, cleanup: cleanupErrorTimer } = createTimedError(3000, (v) => { actionError = v })
  let autoAdvance = $state(false)
  let filePathOverlay = $state<string | null>(null)
  let selection = $state<SelectionState>(createSelection())
  let shiftSelected = $state(false)

  function getDecisionStatus(photoId: number): DecisionStatus {
    return _getDecisionStatus(decisions, photoId)
  }

  const decidedCount = $derived(
    decisions.filter(d => d.current_status !== 'undecided').length
  )

  const isCommittedRound = $derived(
    roundStatus !== null && roundStatus.state === 'committed'
  )

  const stackComplete = $derived(
    roundStatus !== null && roundStatus.undecided === 0 && roundStatus.total_photos > 0
  )


  onMount(async () => {
    window.addEventListener('keydown', handleKey)
    if (projectSlug && stackId) {
      try {
        // Fetch roundStatus FIRST to get roundId for filtering eliminated photos
        try {
          const rs = await getRoundStatus(projectSlug, stackId)
          if (rs) {
            roundStatus = rs
            currentRoundId = rs.round_id
          }
        } catch (e) {
          console.error('getRoundStatus failed:', e)
        }
        // round_id=0 means no round exists — this is an error condition
        if (currentRoundId === 0) {
          roundError = 'No round found for this stack. Import may have failed.'
          loading = false
          return
        }
        photos = await listLogicalPhotos(projectSlug, stackId, currentRoundId)
        try {
          decisions = await getStackDecisions(projectSlug, stackId)
        } catch (e) {
          console.error('getStackDecisions failed:', e)
        }
        try {
          rounds = await listRounds(projectSlug, stackId)
        } catch (e) {
          console.error('listRounds failed:', e)
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
    cleanupErrorTimer()
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
      // Re-fetch everything for the new round
      try {
        // Concurrent fetch: list uses old roundId; getRoundStatus provides new roundId
        const [, newDecisions, newRoundStatus] = await Promise.all([
          listLogicalPhotos(projectSlug, stackId, currentRoundId),
          getStackDecisions(projectSlug, stackId),
          getRoundStatus(projectSlug, stackId),
        ])
        // Update roundId and re-fetch photos scoped to the new round
        currentRoundId = newRoundStatus.round_id
        const newPhotos = await listLogicalPhotos(projectSlug, stackId, currentRoundId)
        photos = newPhotos
        decisions = newDecisions
        roundStatus = newRoundStatus
      } catch (err) {
        console.error('Re-fetch after commit failed:', err)
      }
      selection = clearSelection()
      focusedIndex = 0
      return
    }

    if ((e.key === 'Enter' || e.key === 'e' || e.key === 'E') && photos.length > 0) {
      navigate({
        kind: 'single-view',
        projectSlug,
        stackId,
        photoId: photos[focusedIndex].logical_photo_id,
        projectName,
      })
      return
    }

    if ((e.key === 'c' || e.key === 'C') && !e.ctrlKey && !e.shiftKey && !e.altKey) {
      const selectedIds = getSelectedIds(selection)
      if (selectedIds.length !== 2) {
        showActionError('Select 2 photos to compare (S key)')
        return
      }
      navigate({
        kind: 'comparison-view',
        projectSlug,
        stackId,
        projectName,
        photoIds: selectedIds,
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
            tick().then(() => {
              document.querySelectorAll('[data-testid="photo-card"]')[focusedIndex]?.scrollIntoView({ block: 'nearest', behavior: 'instant' })
            })
            return
          }
        }
        showActionError('No undecided photos')
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
            tick().then(() => {
              document.querySelectorAll('[data-testid="photo-card"]')[focusedIndex]?.scrollIntoView({ block: 'nearest', behavior: 'instant' })
            })
            return
          }
        }
        showActionError('No undecided photos')
      }
      return
    }

    if ((e.key === 'a' || e.key === 'A') && !e.ctrlKey && !e.shiftKey && !e.altKey) {
      autoAdvance = !autoAdvance
      return
    }

    if ((e.key === 'f' || e.key === 'F') && !e.ctrlKey && !e.shiftKey && !e.altKey && photos.length > 0) {
      if (filePathOverlay !== null) {
        filePathOverlay = null
      } else {
        try {
          const detail = await getPhotoDetail(projectSlug, photos[focusedIndex].logical_photo_id)
          const { overlay, shouldCopy } = toggleFileOverlay(filePathOverlay, detail)
          filePathOverlay = overlay
          if (shouldCopy && overlay) {
            copyToClipboard(overlay)
          }
        } catch (err) {
          console.error('getPhotoDetail failed:', err)
        }
      }
      return
    }

    if (e.key === '[' && currentRoundId > 1) {
      currentRoundId = currentRoundId - 1
      try {
        photos = await listLogicalPhotos(projectSlug, stackId, currentRoundId)
        decisions = await getStackDecisions(projectSlug, stackId)
        roundStatus = await getRoundStatus(projectSlug, stackId)
      } catch (err) { console.error('Round navigation failed:', err) }
      return
    }

    if (e.key === ']') {
      currentRoundId = currentRoundId + 1
      try {
        photos = await listLogicalPhotos(projectSlug, stackId, currentRoundId)
        decisions = await getStackDecisions(projectSlug, stackId)
        roundStatus = await getRoundStatus(projectSlug, stackId)
      } catch (err) { console.error('Round navigation failed:', err) }
      return
    }

    if ((e.key === 'y' || e.key === 'Y') && photos.length > 0) {
      if (isCommittedRound) return
      try {
        await makeDecision(projectSlug, photos[focusedIndex].logical_photo_id, 'keep')
        updateDecisionState(photos[focusedIndex].logical_photo_id, 'keep')
        roundStatus = await getRoundStatus(projectSlug, stackId)
        if (autoAdvance) {
          const next = findNextUndecided(focusedIndex)
          if (next !== null) focusedIndex = next
        }
      } catch (err) { console.error('makeDecision failed:', err) }
      return
    }

    if ((e.key === 'x' || e.key === 'X') && photos.length > 0) {
      if (isCommittedRound) return
      try {
        await makeDecision(projectSlug, photos[focusedIndex].logical_photo_id, 'eliminate')
        updateDecisionState(photos[focusedIndex].logical_photo_id, 'eliminate')
        roundStatus = await getRoundStatus(projectSlug, stackId)
        if (autoAdvance) {
          const next = findNextUndecided(focusedIndex)
          if (next !== null) focusedIndex = next
        }
      } catch (err) { console.error('makeDecision failed:', err) }
      return
    }

    if ((e.key === 'u' || e.key === 'U') && photos.length > 0) {
      if (isCommittedRound) return
      try {
        await undoDecision(projectSlug, photos[focusedIndex].logical_photo_id)
        updateDecisionState(photos[focusedIndex].logical_photo_id, 'undecided')
        roundStatus = await getRoundStatus(projectSlug, stackId)
      } catch (err) { console.error('undoDecision failed:', err) }
      return
    }

    // Stack completion: ↓ advances to next undecided stack
    if (stackComplete && (e.key === 'ArrowDown' || e.key === 'j') && !e.ctrlKey) {
      e.preventDefault()
      try {
        const allStacks = await listStacks(projectSlug)
        const currentIdx = allStacks.findIndex(s => s.stack_id === stackId)
        // Find next stack after current one
        for (let offset = 1; offset < allStacks.length; offset++) {
          const nextIdx = (currentIdx + offset) % allStacks.length
          const nextStack = allStacks[nextIdx]
          try {
            const rs = await getRoundStatus(projectSlug, nextStack.stack_id)
            if (rs.undecided > 0) {
              navigate({ kind: 'stack-focus', projectSlug, stackId: nextStack.stack_id, projectName })
              return
            }
          } catch {
            // No round yet — untouched stack, it's undecided
            navigate({ kind: 'stack-focus', projectSlug, stackId: nextStack.stack_id, projectName })
            return
          }
        }
        // All stacks decided
        showActionError('All stacks decided')
      } catch (err) {
        console.error('listStacks failed:', err)
      }
      return
    }

    if ((e.key === 's' || e.key === 'S') && !e.ctrlKey && !e.shiftKey && !e.altKey && photos.length > 0) {
      selection = toggleSelect(selection, photos[focusedIndex].logical_photo_id, 2)
      return
    }

    if (photos.length > 0) {
      const cols = 4

      // Shift+Arrow: extend selection
      if (e.shiftKey && (e.key === 'ArrowRight' || e.key === 'ArrowLeft' || e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
        const prevIndex = focusedIndex
        const newIdx = gridNavigate(e.key, focusedIndex, photos.length, cols)
        if (newIdx !== null) focusedIndex = newIdx
        e.preventDefault()
        selection = extendSelection(selection, photos[prevIndex].logical_photo_id, photos[focusedIndex].logical_photo_id, 2)
        shiftSelected = true
        tick().then(() => {
          const cards = document.querySelectorAll('[data-testid="photo-card"]')
          cards[focusedIndex]?.scrollIntoView({ block: 'nearest', behavior: 'instant' })
        })
        return
      }

      const mappedKey = mapVimKey(e)
      const newIdx = gridNavigate(mappedKey, focusedIndex, photos.length, cols)

      if (newIdx !== null) {
        focusedIndex = newIdx
        e.preventDefault()
        if (shiftSelected) {
          selection = clearSelection()
          shiftSelected = false
        }
        tick().then(() => {
          const cards = document.querySelectorAll('[data-testid="photo-card"]')
          cards[focusedIndex]?.scrollIntoView({ block: 'nearest', behavior: 'instant' })
        })
      }
    }
  }

  function updateDecisionState(photoId: number, status: DecisionStatus) {
    decisions = _updateDecisionState(decisions, photoId, status)
  }

  function findNextUndecided(fromIndex: number): number | null {
    for (let offset = 1; offset < photos.length; offset++) {
      const idx = (fromIndex + offset) % photos.length
      const photoAtIdx = photos[idx]
      const decision = decisions.find(d => d.logical_photo_id === photoAtIdx.logical_photo_id)
      if (!decision || decision.current_status === 'undecided') {
        return idx
      }
    }
    return null
  }

</script>

<div class="h-screen bg-gray-950 text-gray-100 flex flex-col overflow-hidden">
  <!-- Topbar navigation -->
  <header class="sticky top-0 z-10 flex items-center gap-3 px-4 py-3 border-b border-gray-800 bg-gray-900">
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
    {#if autoAdvance}
      <span class="text-sm text-green-400 ml-2">Auto-advance: ON</span>
    {/if}
    <span class="ml-auto text-xs text-gray-600">Esc</span>
  </header>

  <main class="flex-1 min-h-0 overflow-y-auto flex flex-col p-6 gap-6">
    {#if roundError}
      <div class="text-sm text-red-400" data-testid="round-error">{roundError}</div>
    {:else if loading}
      <div class="text-sm text-gray-500 animate-pulse" data-testid="loading-indicator">Loading...</div>
    {:else if isCommittedRound}
      {#if rounds.length > 0}
        <RoundTabBar {rounds} {currentRoundId} onClick={(roundId) => {
          currentRoundId = roundId
          getRoundStatus(projectSlug, stackId).then(rs => { roundStatus = rs })
          listLogicalPhotos(projectSlug, stackId, roundId).then(p => { photos = p })
          getStackDecisions(projectSlug, stackId).then(d => { decisions = d })
        }} />
      {/if}
      <div class="text-sm text-yellow-400">Round {roundStatus?.round_number} is committed — read-only</div>
      <div class="grid grid-cols-4 gap-3">
        {#each photos as photo, i (photo.logical_photo_id)}
          {@const status = getDecisionStatus(photo.logical_photo_id)}
          {@const isSelected = selection.selected.has(photo.logical_photo_id)}
          <div
            data-testid="photo-card"
            role="button"
            tabindex="0"
            onclick={() => { focusedIndex = i }}
            onkeydown={(e) => { if (e.key === 'Enter') focusedIndex = i }}
          >
            <PhotoFrame
              layout="card"
              focused={i === focusedIndex}
              selected={isSelected}
              {photo}
              {status}
              imageUrl={photo.thumbnail_path ? getThumbnailUrl(photo.thumbnail_path) : null}
              alt="Photo {i + 1} thumbnail"
            />
          </div>
        {/each}
      </div>
    {:else if photos.length === 0}
      <div class="text-sm text-gray-500">No photos in this stack.</div>
    {:else}
      {#if rounds.length > 0}
        <RoundTabBar {rounds} {currentRoundId} onClick={(roundId) => {
          currentRoundId = roundId
          getRoundStatus(projectSlug, stackId).then(rs => { roundStatus = rs })
          listLogicalPhotos(projectSlug, stackId, roundId).then(p => { photos = p })
          getStackDecisions(projectSlug, stackId).then(d => { decisions = d })
        }} />
      {/if}
      <!-- Photo grid -->
      <div class="grid grid-cols-4 gap-3">
        {#each photos as photo, i (photo.logical_photo_id)}
          {@const status = getDecisionStatus(photo.logical_photo_id)}
          {@const isSelected = selection.selected.has(photo.logical_photo_id)}
          <div
            data-testid="photo-card"
            role="button"
            tabindex="0"
            onclick={() => {
              focusedIndex = i
              navigate({
                kind: 'single-view',
                projectSlug,
                stackId,
                photoId: photo.logical_photo_id,
                projectName,
              })
            }}
            onkeydown={(e) => { if (e.key === 'Enter') focusedIndex = i }}
          >
            <PhotoFrame
              layout="card"
              focused={i === focusedIndex}
              selected={isSelected}
              {photo}
              {status}
              imageUrl={photo.thumbnail_path ? getThumbnailUrl(photo.thumbnail_path) : null}
              alt="Photo {i + 1} thumbnail"
            />
          </div>
        {/each}
      </div>
    {/if}

    {#if stackComplete && roundStatus}
      <div class="px-4 py-3 bg-green-900/30 border border-green-800 rounded text-sm" data-testid="completion-banner">
        <div class="text-green-300 font-medium">Stack complete — {roundStatus.kept} kept, {roundStatus.eliminated} eliminated</div>
        <div class="text-green-400/70 mt-1">Press ↓ to go to the next undecided stack</div>
      </div>
    {/if}

    {#if filePathOverlay}
      <div class="px-4 py-2 bg-gray-800 text-gray-200 text-sm rounded font-mono" data-testid="file-path-overlay">
        {#each filePathOverlay.split('\n') as line}
          <div>{line}</div>
        {/each}
      </div>
    {/if}

  </main>

  {#if actionError}
    <div class="fixed bottom-0 left-0 right-0 px-4 py-2 bg-gray-900 text-red-200 text-sm z-50" data-testid="action-error">
      {actionError}
    </div>
  {/if}
</div>
