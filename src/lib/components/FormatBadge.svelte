<script lang="ts">
  interface Props {
    has_raw: boolean
    has_jpeg: boolean
  }

  let { has_raw, has_jpeg }: Props = $props()
</script>

{#if has_raw}
  <span class="text-xs px-1 py-0.5 rounded bg-green-800 text-green-200 font-medium leading-none">RAW</span>
{/if}
{#if has_jpeg}
  <span class="text-xs px-1 py-0.5 rounded bg-blue-800 text-blue-200 font-medium leading-none">JPEG</span>
{/if}
