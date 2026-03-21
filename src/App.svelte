<script lang="ts">
  import { invoke } from '@tauri-apps/api/core'
  import AppShell from '$lib/components/layout/AppShell.svelte'
  import HelpOverlay from '$lib/components/HelpOverlay.svelte'
  let helpVisible = $state(false)

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'D' && !e.ctrlKey && !e.altKey && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement)) {
      e.preventDefault()
      invoke('toggle_devtools').catch(() => {})
      return
    }
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
    // Esc navigation is handled by individual screen components
    // (StackOverview, StackFocus, SingleView) — each owns its own back() call.
    // Handling it here too would double-fire navigation.
  }
</script>

<svelte:window onkeydown={handleKeydown} />
<AppShell />
<HelpOverlay bind:visible={helpVisible} />
