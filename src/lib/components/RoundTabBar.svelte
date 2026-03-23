<script lang="ts">
  import type { RoundSummary } from '$lib/api/index.js'

  // Props — to be implemented in GREEN phase
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

<!-- Stub: renders nothing yet — tests will fail because expected DOM elements are missing -->
