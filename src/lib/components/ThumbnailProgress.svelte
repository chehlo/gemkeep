<script lang="ts">
  interface Props {
    thumbnailsTotal: number
    thumbnailsDone: number
    thumbnailPct: number
    filesIndexed: number
    errors: number
  }

  let { thumbnailsTotal, thumbnailsDone, thumbnailPct, filesIndexed, errors }: Props = $props()
</script>

<div class="flex flex-col gap-2 max-w-lg">
  <div class="text-sm text-gray-300 font-medium">Generating thumbnails…</div>
  {#if thumbnailsTotal > 0}
    <!-- Determinate progress bar -->
    <div class="w-full bg-gray-800 rounded-full h-2">
      <div
        class="bg-blue-500 h-2 rounded-full transition-all duration-300"
        style="width: {thumbnailPct}%"
        data-testid="progress-bar-fill"
      ></div>
    </div>
    <div class="text-xs text-gray-500">
      {thumbnailsDone.toLocaleString()} / {thumbnailsTotal.toLocaleString()} thumbnails
      ({thumbnailPct}%)
      {#if errors > 0}
        <span class="text-red-400 ml-2">{errors} error{errors === 1 ? '' : 's'}</span>
      {/if}
    </div>
  {:else}
    <!-- Indeterminate spinner (before thumbnails_total is populated) -->
    <div class="flex items-center gap-2">
      <div class="w-4 h-4 rounded-full border-2 border-blue-500 border-t-transparent animate-spin flex-shrink-0"></div>
      <div class="text-xs text-gray-500">
        {filesIndexed.toLocaleString()} files indexed
        {#if errors > 0}
          <span class="text-red-400 ml-2">{errors} error{errors === 1 ? '' : 's'}</span>
        {/if}
      </div>
    </div>
  {/if}
</div>
