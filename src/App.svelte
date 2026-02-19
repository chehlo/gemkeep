<script lang="ts">
  import AppShell from '$lib/components/layout/AppShell.svelte'
  import { back } from '$lib/stores/navigation.svelte.js'

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault()
      back()
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />
<AppShell />
