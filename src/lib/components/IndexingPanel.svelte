<script lang="ts">
  import type { SourceFolder, IndexingStatus } from '$lib/api/index.js'
  import ThumbnailProgress from '$lib/components/ThumbnailProgress.svelte'

  interface Props {
    sourceFolders: SourceFolder[]
    status: IndexingStatus
    isGeneratingThumbnails: boolean
    progressPct: number
    thumbnailPct: number
    onAddFolder: () => void
    onRemoveFolder: (id: number) => void
    onStartIndex: () => void
    onCancel: () => void
    onPause: () => void
    onResume: () => void
  }

  let {
    sourceFolders,
    status,
    isGeneratingThumbnails,
    progressPct,
    thumbnailPct,
    onAddFolder,
    onRemoveFolder,
    onStartIndex,
    onCancel,
    onPause,
    onResume,
  }: Props = $props()
</script>

{#snippet folderList(showRemove: boolean)}
  <div class="text-xs font-medium text-gray-500 uppercase tracking-wider">Source Folders</div>
  <ul class="flex flex-col gap-1">
    {#each sourceFolders as folder (folder.id)}
      <li class="flex items-center gap-2 text-sm text-gray-300">
        <span class="text-gray-500">📁</span>
        <span class="flex-1 font-mono text-xs truncate">{folder.path}</span>
        {#if showRemove}
          <button
            class="text-gray-600 hover:text-red-400 transition-colors text-xs px-1"
            onclick={() => onRemoveFolder(folder.id)}
            title="Remove folder"
          >×</button>
        {/if}
      </li>
    {/each}
  </ul>
{/snippet}

{#if sourceFolders.length === 0 && !status.running}
  <!-- STATE 1: No source folders -->
  <div class="flex flex-col items-start gap-4">
    <p class="text-gray-400 text-sm">No source folders attached.</p>
    <button
      class="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded transition-colors"
      onclick={onAddFolder}
    >
      + Add Folder
    </button>
  </div>

{:else if sourceFolders.length > 0 && !status.running}
  <!-- STATE 2: Folders attached, not yet indexed -->
  <div class="flex flex-col gap-3">
    {@render folderList(true)}
    <button
      class="self-start px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm rounded transition-colors"
      onclick={onAddFolder}
    >
      + Add Folder
    </button>
  </div>

  <hr class="border-gray-800" />

  <div class="flex items-center gap-3">
    <button
      class="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded transition-colors"
      onclick={onStartIndex}
    >
      Index Photos
    </button>
    <span class="text-xs text-gray-600">or press <kbd class="font-mono bg-gray-800 px-1 rounded">i</kbd></span>
  </div>

{:else}
  <!-- STATE 3: Indexing in progress -->
  <div class="flex flex-col gap-3">
    {@render folderList(false)}
  </div>

  <hr class="border-gray-800" />

  <div class="flex flex-col gap-3 max-w-lg">
    {#if isGeneratingThumbnails}
      <ThumbnailProgress
        thumbnailsTotal={status.thumbnails_total}
        thumbnailsDone={status.thumbnails_done}
        {thumbnailPct}
        filesIndexed={status.total}
        errors={status.errors}
      />
    {:else}
      <!-- EXIF / scan phase -->
      <div class="text-sm text-gray-300 font-medium">Indexing…</div>
      <div class="w-full bg-gray-800 rounded-full h-2">
        <div
          class="bg-blue-500 h-2 rounded-full transition-all duration-300"
          style="width: {progressPct}%"
          data-testid="progress-bar-fill"
        ></div>
      </div>
      <div class="text-xs text-gray-500">
        {status.processed.toLocaleString()} / {status.total.toLocaleString()} files
        {#if status.errors > 0}
          <span class="text-red-400 ml-2">{status.errors} error{status.errors === 1 ? '' : 's'}</span>
        {/if}
      </div>
    {/if}

    <div class="flex items-center gap-2">
      {#if status.paused}
        <button
          class="px-3 py-1.5 bg-blue-700 hover:bg-blue-600 text-white text-sm rounded transition-colors"
          onclick={onResume}
        >
          Resume
        </button>
      {:else}
        <button
          class="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm rounded transition-colors"
          onclick={onPause}
        >
          Pause
        </button>
      {/if}
      <button
        class="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm rounded transition-colors"
        onclick={onCancel}
      >
        Cancel
      </button>
    </div>
  </div>
{/if}
