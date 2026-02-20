<script lang="ts">
  import { navigation, back } from '$lib/stores/navigation.svelte.js'

  const projectName = $derived(
    navigation.current.kind === 'stack-overview' ? navigation.current.projectName : ''
  )
</script>

<div class="min-h-screen bg-gray-950 text-gray-100 flex flex-col">
  <!-- Topbar navigation -->
  <header class="flex items-center gap-3 px-4 py-3 border-b border-gray-800 bg-gray-900">
    <button
      class="flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-200 transition-colors"
      onclick={back}
      title="Back to Projects (Esc)"
    >
      <span class="text-base">←</span>
      Projects
    </button>
    <span class="text-gray-600">/</span>
    <span class="text-sm text-gray-200 font-medium">{projectName}</span>
    <span class="ml-auto text-xs text-gray-600">Esc</span>
  </header>

  <!-- Main content area (placeholder for Sprint 3+) -->
  <main class="flex-1 flex items-center justify-center">
    <div class="text-center text-gray-600">
      <div class="text-4xl mb-3">📷</div>
      <div class="text-sm">No photos imported yet</div>
      <div class="text-xs mt-1">Stack overview coming in Sprint 3</div>
    </div>
  </main>
</div>
