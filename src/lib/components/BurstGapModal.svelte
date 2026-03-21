<script lang="ts">
  interface Props {
    burstGap: number
    restacking: boolean
    onSave: (gap: number) => void
    onCancel: () => void
  }

  let { burstGap, restacking, onSave, onCancel }: Props = $props()
  let gapInput = $state(burstGap)
</script>

<div class="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
  <div class="bg-zinc-900 border border-zinc-700 rounded-lg p-6 w-80 shadow-xl">
    <h2 class="text-white font-semibold mb-4">Burst gap</h2>
    {#if restacking}
      <p class="text-zinc-400 text-sm mb-4">Recalculating stacks…</p>
    {:else}
      <label class="block text-zinc-400 text-sm mb-2">
        Gap between bursts (seconds)
      </label>
      <input
        type="number"
        min="1"
        max="300"
        value={gapInput}
        oninput={(e) => { gapInput = Number((e.target as HTMLInputElement).value) }}
        onchange={(e) => { gapInput = Number((e.target as HTMLInputElement).value) }}
        class="w-full bg-zinc-800 text-white border border-zinc-600 rounded px-3 py-2 mb-4"
      />
      <div class="flex gap-2 justify-end">
        <button
          onclick={onCancel}
          class="px-4 py-2 text-sm text-zinc-400 hover:text-white"
        >Cancel</button>
        <button
          onclick={() => onSave(gapInput)}
          class="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-500 text-white rounded"
        >Save</button>
      </div>
    {/if}
  </div>
</div>
