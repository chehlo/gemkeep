<script lang="ts">
  import { DECISION_CLASSES, DECISION_BORDERS } from '$lib/constants/decisions'

  let { status = 'undecided', rounded = false }: { status: string; rounded?: boolean } = $props()

  const roundedClass = $derived(rounded ? 'rounded-lg' : '')
</script>

{#if status === 'keep'}
  <div class="{DECISION_CLASSES.keep} absolute inset-0 {DECISION_BORDERS.keep} {roundedClass} pointer-events-none"></div>
{:else if status === 'eliminate'}
  <div class="{DECISION_CLASSES.eliminate} absolute inset-0 {DECISION_BORDERS.eliminate} {roundedClass} pointer-events-none"></div>
  <div class="decision-dim-overlay absolute inset-0 bg-black/50 {roundedClass} pointer-events-none"></div>
{/if}
