<script lang="ts">
  import type { RoundSummary } from '$lib/api/index.js'

  let {
    rounds = [],
    currentRoundId = 0,
    onClick = (_roundId: number) => {},
  }: {
    rounds: RoundSummary[]
    currentRoundId: number
    onClick: (roundId: number) => void
  } = $props()
</script>

{#each rounds as round, i}
  <button onclick={() => onClick(round.round_id)}>R{round.round_number}{#if round.round_id === currentRoundId}*{/if}</button>
{/each}
