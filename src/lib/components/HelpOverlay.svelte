<script lang="ts">
  import { navigation } from '$lib/stores/navigation.svelte.js'

  interface Shortcut {
    key: string
    description: string
  }

  interface ShortcutGroup {
    title: string
    shortcuts: Shortcut[]
  }

  let { visible = $bindable(false) } = $props<{ visible: boolean }>()

  function close() { visible = false }

  const GLOBAL: Shortcut[] = [
    { key: 'Esc', description: 'Go back / close overlay' },
    { key: '?', description: 'Toggle this help' },
  ]

  const PROJECT_LIST: ShortcutGroup[] = [
    { title: 'NAVIGATION', shortcuts: [
      { key: 'Enter', description: 'Open project' },
      ...GLOBAL,
    ]},
  ]

  const STACK_OVERVIEW: ShortcutGroup[] = [
    { title: 'NAVIGATION', shortcuts: [
      { key: 'Arrow keys', description: 'Move focus' },
      { key: 'Enter', description: 'Open stack' },
      ...GLOBAL,
    ]},
    { title: 'SELECTION', shortcuts: [
      { key: 'Shift+Arrow', description: 'Multi-select stacks' },
    ]},
    { title: 'STACK ACTIONS', shortcuts: [
      { key: 'M', description: 'Merge selected stacks' },
      { key: 'Ctrl+Z', description: 'Undo last merge' },
    ]},
    { title: 'OTHER', shortcuts: [
      { key: 'Ctrl+B', description: 'Burst gap config' },
      { key: 'i / r', description: 'Re-index photos' },
    ]},
  ]

  const STACK_FOCUS: ShortcutGroup[] = [
    { title: 'NAVIGATION', shortcuts: [
      { key: 'Arrow keys', description: 'Move focus in grid' },
      { key: 'Enter', description: 'Open in single view' },
      { key: 'Tab', description: 'Jump to next undecided' },
      { key: 'Shift+Tab', description: 'Jump to previous undecided' },
      ...GLOBAL,
    ]},
    { title: 'DECISIONS', shortcuts: [
      { key: 'Y', description: 'Keep photo' },
      { key: 'X', description: 'Eliminate photo' },
      { key: 'Ctrl+Enter', description: 'Commit round' },
    ]},
  ]

  const SINGLE_VIEW: ShortcutGroup[] = [
    { title: 'NAVIGATION', shortcuts: [
      { key: 'Left / Right', description: 'Previous / next photo' },
      { key: 'Home', description: 'Jump to first photo' },
      { key: 'End', description: 'Jump to last photo' },
      { key: 'Tab', description: 'Jump to next undecided' },
      { key: 'Shift+Tab', description: 'Jump to previous undecided' },
      ...GLOBAL,
    ]},
    { title: 'DECISIONS', shortcuts: [
      { key: 'Y', description: 'Keep photo' },
      { key: 'X', description: 'Eliminate photo' },
      { key: 'Ctrl+Enter', description: 'Commit round' },
    ]},
    { title: 'DISPLAY', shortcuts: [
      { key: 'I', description: 'Toggle camera params' },
    ]},
  ]

  const SCREEN_SHORTCUTS: Record<string, ShortcutGroup[]> = {
    'project-list': PROJECT_LIST,
    'stack-overview': STACK_OVERVIEW,
    'stack-focus': STACK_FOCUS,
    'single-view': SINGLE_VIEW,
  }

  const SCREEN_TITLES: Record<string, string> = {
    'project-list': 'Project List',
    'stack-overview': 'Stack Overview',
    'stack-focus': 'Stack Focus',
    'single-view': 'Single View',
  }

  const groups = $derived(SCREEN_SHORTCUTS[navigation.current.kind] ?? PROJECT_LIST)
  const screenTitle = $derived(SCREEN_TITLES[navigation.current.kind] ?? 'GemKeep')
</script>

{#if visible}
  <!-- Backdrop -->
  <div
    class="fixed inset-0 bg-black/70 z-50 flex items-center justify-center"
    onclick={close}
    onkeydown={(e) => { if (e.key === 'Escape' || e.key === '?') { e.stopPropagation(); close() } }}
    role="dialog"
    aria-modal="true"
    aria-label="Keyboard shortcuts"
    data-testid="help-overlay"
  >
    <!-- Panel -->
    <div
      class="bg-gray-900 border border-gray-700 rounded-lg shadow-2xl max-w-xl w-full mx-4 p-6"
      onclick={(e) => e.stopPropagation()}
      onkeydown={() => {}}
      role="document"
    >
      <!-- Header -->
      <div class="flex items-center justify-between mb-5">
        <h2 class="text-lg font-semibold text-gray-100">
          KEYBOARD SHORTCUTS
          <span class="text-gray-500 font-normal ml-2">({screenTitle})</span>
        </h2>
        <span class="text-xs text-gray-600">? to close</span>
      </div>

      <!-- Shortcut groups -->
      <div class="grid grid-cols-2 gap-x-8 gap-y-4">
        {#each groups as group}
          <div>
            <h3 class="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">{group.title}</h3>
            <div class="flex flex-col gap-1.5">
              {#each group.shortcuts as shortcut}
                <div class="flex items-center gap-3 text-sm">
                  <kbd class="font-mono text-xs bg-gray-800 text-gray-300 px-1.5 py-0.5 rounded border border-gray-700 min-w-[4rem] text-center whitespace-nowrap">{shortcut.key}</kbd>
                  <span class="text-gray-400">{shortcut.description}</span>
                </div>
              {/each}
            </div>
          </div>
        {/each}
      </div>
    </div>
  </div>
{/if}
