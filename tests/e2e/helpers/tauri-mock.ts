/**
 * Shared Tauri IPC mock infrastructure for E2E Playwright tests.
 *
 * Sets up window.__TAURI_INTERNALS__ (invoke, transformCallback, convertFileSrc)
 * and window.__TAURI_EVENT_PLUGIN_INTERNALS__ (unregisterListener) so that
 * both @tauri-apps/api/core and @tauri-apps/api/event work correctly.
 *
 * Usage:
 *   await injectTauriMock(page, (cmd, args, store) => { switch(cmd) { ... } }, scenarioData)
 */
import type { Page } from '@playwright/test'

// ── Reusable presets ──────────────────────────────────────────────────────────

export const FOLDER_ICELAND = { id: 1, path: '/home/user/Photos/Iceland' }

export const IDLE_STATUS = {
  running: false, thumbnails_running: false, total: 0, processed: 0,
  errors: 0, cancelled: false, paused: false, last_stats: null,
  thumbnails_total: 0, thumbnails_done: 0,
}

export const makeStacks = (count: number, withThumbs = false) =>
  Array.from({ length: count }, (_, i) => ({
    stack_id: i + 1,
    logical_photo_count: 4,
    earliest_capture: `2024-03-15T${String(10 + i).padStart(2, '0')}:00:00Z`,
    has_raw: true,
    has_jpeg: true,
    thumbnail_path: withThumbs ? `/cache/${i + 1}.jpg` : null,
  }))

export const THUMBS_RUNNING_PROJECT = {
  initialFolders: [FOLDER_ICELAND],
  initialStacks: makeStacks(3),
  initialStatus: {
    running: false, thumbnails_running: true, total: 50, processed: 50,
    errors: 0, cancelled: false, paused: false, last_stats: null,
    thumbnails_total: 10, thumbnails_done: 0,
  },
  statusHoldMs: 1500,
}

/**
 * Inject a full Tauri IPC + event mock into the page.
 *
 * @param page Playwright page
 * @param scenario Serializable scenario data passed to the handler
 * @param handler A function body (as string) that handles IPC commands.
 *   It receives: cmd (string), args (object), store (mutable scenario state).
 *   It should return the response value, or undefined for void commands.
 *   Event plugin commands (plugin:event|*) are handled automatically.
 */
export async function injectTauriMock(
  page: Page,
  scenario: Record<string, unknown>,
): Promise<void> {
  await page.addInitScript((s) => {
    // ── Callback registration (mirrors @tauri-apps/api/mocks) ──
    const callbacks = new Map<number, (data: unknown) => unknown>()
    let nextId = 1

    function registerCallback(callback: ((data: unknown) => unknown) | null, once = false): number {
      const id = nextId++
      callbacks.set(id, (data: unknown) => {
        if (once) callbacks.delete(id)
        return callback?.(data)
      })
      return id
    }

    // ── Event listener tracking ──
    const eventListeners = new Map<string, number[]>()

    function handleEventListen(args: { event: string; handler: number }): number {
      if (!eventListeners.has(args.event)) eventListeners.set(args.event, [])
      eventListeners.get(args.event)!.push(args.handler)
      return args.handler // returned as eventId
    }

    function handleEventEmit(args: { event: string; payload?: unknown }): null {
      const handlers = eventListeners.get(args.event) ?? []
      for (const id of handlers) {
        const cb = callbacks.get(id)
        cb?.({ event: args.event, id, payload: args.payload })
      }
      return null
    }

    function handleEventUnlisten(args: { event: string; eventId: number }): void {
      callbacks.delete(args.eventId)
      const list = eventListeners.get(args.event)
      if (list) {
        const idx = list.indexOf(args.eventId)
        if (idx !== -1) list.splice(idx, 1)
      }
    }

    // ── Expose trigger helper for tests ──
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(window as any).__triggerTauriEvent = (event: string, payload: unknown) => {
      handleEventEmit({ event, payload })
    }

    // ── Store: mutable state built from scenario ──
    const store = {
      projects: [] as Array<{
        id: number; name: string; slug: string
        created_at: string; last_opened_at: string | null
      }>,
      lastSlug: null as string | null,
      folders: (s.initialFolders ?? []) as Array<{ id: number; path: string }>,
      stacks: (s.initialStacks ?? []) as unknown[],
      status: s.initialStatus as unknown,
      statusSeq: (s.statusSequence ?? []) as unknown[],
      statusIdx: 0,
      statusCallCount: 0,
      statusHoldMs: (s.statusHoldMs ?? 0) as number,
      statusEnteredAt: 0,
      burstGap: (s.burstGap ?? 3) as number,
      startIndexingCallCount: 0,
      resumeCalled: false,
      restacked: false,
      stacksAfterThumbnail: (s.stacksAfterThumbnail ?? null) as unknown[] | null,
      stacksAfterRestack: (s.stacksAfterRestack ?? null) as unknown[] | null,
      stacksAfterResume: (s.stacksAfterResume ?? null) as unknown[] | null,
      thumbnailEventFired: false,
      ipcLog: [] as string[],
    }

    function makeSlug(name: string): string {
      return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/, '')
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(window as any).__ipcLog = store.ipcLog
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(window as any).__store = store

    // ── Install Tauri internals ──
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(window as any).__TAURI_INTERNALS__ = {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      invoke: async (cmd: string, args: Record<string, unknown> = {}): Promise<any> => {
        // Handle event plugin commands automatically
        if (cmd === 'plugin:event|listen') return handleEventListen(args as { event: string; handler: number })
        if (cmd === 'plugin:event|unlisten') return handleEventUnlisten(args as { event: string; eventId: number })
        if (cmd === 'plugin:event|emit') return handleEventEmit(args as { event: string; payload?: unknown })

        store.ipcLog.push(cmd)

        switch (cmd) {
          // ── Project management ──
          case 'get_last_project':
            return store.lastSlug
              ? store.projects.find(p => p.slug === store.lastSlug) ?? null
              : null
          case 'list_projects':
            return [...store.projects]
          case 'create_project': {
            const name = args.name as string
            const slug = makeSlug(name)
            const p = { id: 1, name, slug, created_at: new Date().toISOString(), last_opened_at: null }
            store.projects.push(p)
            store.lastSlug = slug
            return p
          }
          case 'open_project': {
            const p = store.projects.find(p => p.slug === (args.slug as string))
            if (!p) throw new Error('Project not found: ' + (args.slug as string))
            store.lastSlug = p.slug
            return p
          }
          case 'suggest_slug':
            return makeSlug(args.name as string)
          case 'delete_project': {
            const idx = store.projects.findIndex(p => p.slug === (args.slug as string))
            if (idx >= 0) store.projects.splice(idx, 1)
            return null
          }

          // ── Stack overview ──
          case 'list_source_folders':
            return [...store.folders]
          case 'add_source_folder':
            store.folders.push({ id: store.folders.length + 1, path: args.path as string })
            return undefined
          case 'remove_source_folder':
            store.folders = store.folders.filter(f => f.id !== (args.folderId as number))
            return undefined
          case 'list_stacks': {
            if (store.restacked && store.stacksAfterRestack) return [...store.stacksAfterRestack]
            if (store.thumbnailEventFired && store.stacksAfterThumbnail) return [...store.stacksAfterThumbnail]
            if (store.resumeCalled && store.stacksAfterResume) return [...store.stacksAfterResume]
            return [...store.stacks]
          }
          case 'get_indexing_status': {
            // First call returns initialStatus (used by loadAll).
            // Subsequent calls use statusSequence (used by poll).
            store.statusCallCount++
            if (store.statusCallCount === 1) return store.status

            if (store.statusHoldMs === 0) {
              // No hold: advance immediately (existing behavior, backward compat)
              if (store.statusIdx < store.statusSeq.length) {
                const st = store.statusSeq[store.statusIdx++]
                store.status = st
                return st
              }
              return store.status
            }

            // Time-based hold: stay on current status until holdMs elapsed
            const now = Date.now()
            if (store.statusEnteredAt === 0) store.statusEnteredAt = now
            if (now - store.statusEnteredAt >= store.statusHoldMs) {
              if (store.statusIdx < store.statusSeq.length) {
                store.status = store.statusSeq[store.statusIdx++]
                store.statusEnteredAt = now
              }
            }
            return store.status
          }
          case 'start_indexing':
            store.startIndexingCallCount++
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            ;(window as any).__startIndexingCallCount = store.startIndexingCallCount
            return undefined
          case 'cancel_indexing':
          case 'pause_indexing':
          case 'resume_indexing':
            return undefined

          // ── Thumbnails ──
          case 'resume_thumbnails':
            store.resumeCalled = true
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            ;(window as any).__resumeThumbnailsCalled = true
            return undefined

          // ── Burst gap ──
          case 'get_burst_gap':
            return store.burstGap
          case 'set_burst_gap':
            store.burstGap = args.gap as number
            return undefined
          case 'restack':
            store.restacked = true
            return undefined

          default:
            return null
        }
      },

      transformCallback: registerCallback,

      convertFileSrc: (filePath: string, protocol = 'asset') => {
        const path = encodeURIComponent(filePath)
        return `${protocol}://localhost/${path}`
      },
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(window as any).__TAURI_EVENT_PLUGIN_INTERNALS__ = {
      unregisterListener: (event: string, id: number) => {
        callbacks.delete(id)
        const list = eventListeners.get(event)
        if (list) {
          const idx = list.indexOf(id)
          if (idx !== -1) list.splice(idx, 1)
        }
      },
    }

    // Track thumbnail events for progressive tests
    const origTrigger = (window as any).__triggerTauriEvent
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(window as any).__triggerTauriEvent = (event: string, payload: unknown) => {
      if (event === 'thumbnail-ready') store.thumbnailEventFired = true
      origTrigger(event, payload)
    }
  }, scenario)
}

/**
 * Create a project via UI and wait for StackOverview to load.
 *
 * Uses dispatchEvent with bubbles:false instead of page.keyboard.press('Enter')
 * to prevent the Enter keydown from reaching StackOverview's window listener
 * (which would immediately navigate to StackFocus when stacks are pre-loaded).
 */
export async function createProject(page: Page, name: string): Promise<void> {
  const { expect } = await import('@playwright/test')
  await page.click('text=New Project')
  await page.fill('#project-name', name)
  // Non-bubbling Enter: triggers the input's onkeydown handler
  // but won't propagate to StackOverview's window.addEventListener('keydown')
  await page.locator('#project-name').evaluate((el) => {
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
  })
  // Wait for navigation to complete and StackOverview to render
  await expect(page.locator('header').getByText(name)).toBeVisible({ timeout: 10_000 })
  // Ensure we're on StackOverview (not StackFocus from Enter race condition)
  await page.waitForFunction(() => !document.querySelector('button')?.textContent?.includes('← Back'), { timeout: 3_000 }).catch(() => {})
  // If we accidentally ended up on StackFocus, press Escape to go back
  const isStackFocus = await page.locator('button:has-text("Back")').isVisible().catch(() => false)
  if (isStackFocus) {
    await page.keyboard.press('Escape')
    await expect(page.locator('button:has-text("Projects")')).toBeVisible({ timeout: 3_000 })
  }
}
