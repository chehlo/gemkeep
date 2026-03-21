<script lang="ts">
  import type { PhotoDetail, LogicalPhotoSummary, DecisionStatus } from '$lib/api/index.js'
  import { formatCameraParams, formatCaptureTime, truncate } from '$lib/utils/photos.js'
  import FormatBadge from './FormatBadge.svelte'

  interface Props {
    photo: PhotoDetail | LogicalPhotoSummary | null
    status?: DecisionStatus
    imageUrl?: string | null
    layout?: 'fill' | 'card' | 'panel'
    focused?: boolean
    selected?: boolean
    showMetadata?: boolean
    showFilePath?: string | null
    alt?: string
  }

  let {
    photo = null,
    status = 'undecided',
    imageUrl = null,
    layout = 'fill',
    focused = false,
    selected = false,
    showMetadata = true,
    showFilePath = null,
    alt = '',
  }: Props = $props()

  const layoutSizing = $derived(layout === 'card' ? '' : 'flex-1 min-h-0')
  const isRounded = $derived(layout === 'card')
  const compact = $derived(layout !== 'fill')
  const imgClass = $derived(layout === 'card' ? 'w-full h-full object-cover' : 'w-full h-full object-contain')
  const ringClass = $derived(
    selected ? 'ring-2 ring-inset ring-yellow-500' :
    focused ? 'ring-2 ring-inset ring-blue-500' :
    ''
  )
  const borderClass = $derived(
    status === 'keep' ? 'border-2 border-green-500 decision-keep' :
    status === 'eliminate' ? 'border-2 border-red-500 decision-eliminate' :
    selected ? 'border-2 border-yellow-500' :
    focused ? 'border-2 border-blue-500' :
    'border-2 border-gray-700'
  )
</script>

<div class="relative flex flex-col {layoutSizing} {isRounded ? 'rounded-lg' : ''} {ringClass} {borderClass} bg-gray-900" data-testid="photo-frame">
  <!-- Photo area -->
  <div class="flex-1 min-h-0 relative flex items-center justify-center bg-black overflow-hidden" data-testid="photo-area">
    {#if imageUrl}
      <img src={imageUrl} {alt} class="{imgClass}" />
    {:else}
      <!-- Placeholder -->
      {#if compact}
        <span class="text-3xl text-gray-600" data-testid="photo-placeholder">📷</span>
      {:else}
        <div class="text-gray-500 text-sm" data-testid="no-preview">No preview available</div>
      {/if}
    {/if}

    <!-- File path overlay (inside photo area) -->
    {#if showFilePath}
      <div class="absolute bottom-0 left-0 right-0 bg-black/80 px-4 py-2 text-sm font-mono text-gray-200" data-testid="file-path-overlay">
        {#each showFilePath.split('\n') as line}
          <div>{line}</div>
        {/each}
      </div>
    {/if}

    {#if status === 'eliminate'}
      <div class="decision-dim-overlay absolute inset-0 z-10 bg-black/50 pointer-events-none"></div>
    {/if}
  </div>

  <!-- Metadata section -->
  {#if showMetadata && photo}
    <div class="{compact ? 'p-2' : 'p-3'} bg-gray-900 border-t border-gray-800" data-testid="metadata-section">
      <!-- Capture time -->
      <div class="text-xs text-gray-500">{formatCaptureTime(photo.capture_time, '(no date)')}</div>

      <!-- Camera model -->
      {#if photo.camera_model}
        <div class="text-xs text-gray-300 {compact ? 'overflow-hidden text-ellipsis whitespace-nowrap' : ''}">
          {compact ? truncate(photo.camera_model, 18) : photo.camera_model}
        </div>
      {/if}

      <!-- Lens (compact only, separate line) -->
      {#if compact && photo.lens}
        <div class="text-xs text-gray-500 overflow-hidden text-ellipsis whitespace-nowrap">
          {truncate(photo.lens, 18)}
        </div>
      {/if}

      <!-- Camera params -->
      {#if !compact}
        <!-- Full mode: space-separated, with exposure comp and lens -->
        <div class="flex gap-4 text-sm text-gray-300">
          {#if photo.aperture != null}<div>f/{photo.aperture}</div>{/if}
          {#if photo.shutter_speed != null}<div>{photo.shutter_speed}</div>{/if}
          {#if photo.iso != null}<div>ISO {photo.iso}</div>{/if}
          {#if photo.focal_length != null || ('lens' in photo && photo.lens)}
            <div>{photo.focal_length ? `${Math.round(photo.focal_length)}mm` : ''}{#if 'lens' in photo && photo.lens}{photo.focal_length ? ' ' : ''}{photo.lens}{/if}</div>
          {/if}
          {#if 'exposure_comp' in photo && photo.exposure_comp != null}
            <div>{photo.exposure_comp >= 0 ? '+' : ''}{photo.exposure_comp.toFixed(1)} EV</div>
          {/if}
        </div>
      {:else}
        <!-- Compact mode: dot-separated via formatCameraParams -->
        {#if formatCameraParams(photo)}
          <div class="text-xs text-gray-500 overflow-hidden text-ellipsis whitespace-nowrap" data-testid="camera-params">
            {formatCameraParams(photo)}
          </div>
        {/if}
      {/if}

      <!-- Format badges -->
      <div class="flex gap-1 {compact ? 'mt-0.5' : 'mt-1'}">
        <FormatBadge has_raw={photo.has_raw} has_jpeg={photo.has_jpeg} />
      </div>
    </div>
  {/if}
</div>
