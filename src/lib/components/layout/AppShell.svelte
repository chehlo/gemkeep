<script lang="ts">
  import { navigation } from '$lib/stores/navigation.svelte.js'
  import ProjectList from '$lib/components/screens/ProjectList.svelte'
  import StackOverview from '$lib/components/screens/StackOverview.svelte'
  import StackFocus from '$lib/components/screens/StackFocus.svelte'
  import SingleView from '$lib/components/screens/SingleView.svelte'
</script>

<main class="h-screen w-screen bg-gray-950 text-gray-100">
  {#if navigation.current.kind === 'project-list'}
    <ProjectList />
  {:else if navigation.current.kind === 'stack-overview'}
    <StackOverview />
  {:else if navigation.current.kind === 'stack-focus'}
    <StackFocus />
  {:else if navigation.current.kind === 'single-view'}
    <SingleView />
  {/if}
</main>
