<script lang="ts">
  import { navigation } from '$lib/stores/navigation.svelte.js'

  const projectName = $derived(
    navigation.current.kind === 'stack-overview' ? navigation.current.projectName : ''
  )
</script>

<div class="p-8">
  <h1 class="text-2xl font-bold">{projectName} — Stack Overview</h1>
</div>
