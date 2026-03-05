<script lang="ts">
  import AppShell from '$lib/components/layout/AppShell.svelte'
  import HelpOverlay from '$lib/components/HelpOverlay.svelte'
  import { back } from '$lib/stores/navigation.svelte.js'

  let helpVisible = $state(false)

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === '?' && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement)) {
      e.preventDefault()
      helpVisible = !helpVisible
      return
    }
    if (helpVisible && e.key === 'Escape') {
      e.preventDefault()
      e.stopImmediatePropagation()
      helpVisible = false
      return
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      back()
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />
<AppShell />
<HelpOverlay bind:visible={helpVisible} />
