<script lang="ts">
  import type { RoundSummary } from '$lib/api/index.js'

  let {
    rounds = [],
    currentRoundId = 0,
    openRoundId = 0,
    onClick = (_roundId: number) => {},
    maxVisible = 5,
  }: {
    rounds: RoundSummary[]
    currentRoundId: number
    openRoundId: number
    onClick: (roundId: number) => void
    maxVisible?: number
  } = $props()

  // Compute which rounds to display, with optional ellipsis
  const visibleRounds = $derived.by(() => {
    if (rounds.length <= maxVisible) {
      return { tabs: rounds, ellipsisIndex: -1 }
    }

    // Always show first round
    const first = rounds[0]
    // Tail: last (maxVisible - 2) rounds
    const tailCount = maxVisible - 2
    const tailStart = rounds.length - tailCount
    const tail = rounds.slice(tailStart)

    // Check if viewed round is already in first or tail
    const viewedInFirst = first.round_id === currentRoundId
    const viewedInTail = tail.some(r => r.round_id === currentRoundId)

    if (viewedInFirst || viewedInTail) {
      // R1, ellipsis, tail
      return { tabs: [first, ...tail], ellipsisIndex: 1 }
    } else {
      // R1, viewed round, ellipsis, reduced tail
      const viewedRound = rounds.find(r => r.round_id === currentRoundId)
      if (viewedRound) {
        const reducedTail = rounds.slice(rounds.length - (tailCount - 1))
        return { tabs: [first, viewedRound, ...reducedTail], ellipsisIndex: 2 }
      }
      return { tabs: [first, ...tail], ellipsisIndex: 1 }
    }
  })
</script>

<div class="flex gap-1" data-testid="round-tab-bar">
  {#each visibleRounds.tabs as round, i}
    {#if i === visibleRounds.ellipsisIndex}
      <span class="px-2 py-1 text-gray-500 text-sm" data-testid="round-tab-ellipsis">…</span>
    {/if}
    {@const isOpen = openRoundId !== 0 && round.round_id === openRoundId}
    {@const isActive = round.round_id === currentRoundId}
    <button
      data-testid="round-tab-{round.round_number}"
      class="px-2 py-1 rounded-full text-sm {isOpen ? 'bg-blue-600 text-white' : isActive ? 'ring-2 ring-blue-400 bg-gray-800 text-gray-200' : 'bg-gray-800 text-gray-400'}"
      onclick={() => onClick(round.round_id)}
    >{#if isActive}<span data-testid="round-tab-active"></span>{/if}{#if isOpen}<span data-testid="round-tab-open"></span>{/if}R{round.round_number}{#if isOpen} ●{/if}</button>
  {/each}
</div>
