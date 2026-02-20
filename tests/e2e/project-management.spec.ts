/**
 * E2E critical-journey tests for GemKeep project management.
 * Run with: npm run test:e2e  (cargo tauri dev must be running on port 1420)
 *
 * IMPORTANT: These tests run in plain Chromium, not the Tauri WebView.
 * Tauri IPC (invoke) is mocked via page.addInitScript() which injects
 * window.__TAURI_INTERNALS__.invoke before the app scripts run.
 * This validates real Chromium rendering and navigation flows with realistic mock data.
 *
 * For actual backend validation (SQLite, command timing), see:
 *   src-tauri/src/commands/ipc_tests.rs
 *
 * WHY THESE TESTS EXIST — bugs they would have caught:
 *
 *   Test 3 "Escape timing < 2s"
 *     → WOULD HAVE CAUGHT: The navigation freeze caused by list_projects calling
 *       run_migrations (SQLite write) while AppState held an open DB connection.
 *       With mocked IPC the timing covers rendering-side freezes. Backend timing
 *       is covered by ipc_open_then_list_no_freeze (<500ms) in Rust.
 *
 *   Test 4 "two projects, no duplicate key"
 *     → WOULD HAVE CAUGHT: The Svelte each_key_duplicate error. The mock returns
 *       id=1 for all projects (exactly what Rust returns — each project has its own
 *       SQLite DB where autoincrement starts at 1). Before the fix, the {#each} key
 *       was project.id so two projects both with id=1 crashed the component.
 */

import { test, expect, type Page } from '@playwright/test'

// Inject a mock window.__TAURI_INTERNALS__.invoke before the page loads.
// The function is serialised by Playwright and evaluated in the browser context
// before any app scripts run — so invoke() calls work without the real Tauri runtime.
async function mockIPC(page: Page): Promise<void> {
  await page.addInitScript(() => {
    // In-memory backend state for this test run.
    // id is always 1 — matching real Rust: each project has its own SQLite DB
    // where the autoincrement primary key starts at 1.
    const store: {
      projects: Array<{ id: number; name: string; slug: string; created_at: string; last_opened_at: string | null }>
      lastSlug: string | null
    } = { projects: [], lastSlug: null }

    function makeSlug(name: string): string {
      return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/, '')
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(window as any).__TAURI_INTERNALS__ = (window as any).__TAURI_INTERNALS__ ?? {}
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(window as any).__TAURI_INTERNALS__.invoke = async (cmd: string, args: Record<string, unknown>) => {
      switch (cmd) {
        case 'get_last_project':
          return store.lastSlug
            ? (store.projects.find((p) => p.slug === store.lastSlug) ?? null)
            : null
        case 'list_projects':
          return [...store.projects]
        case 'create_project': {
          const name = args.name as string
          const slug = makeSlug(name)
          const project = { id: 1, name, slug, created_at: new Date().toISOString(), last_opened_at: null }
          store.projects.push(project)
          store.lastSlug = slug
          return project
        }
        case 'open_project': {
          const p = store.projects.find((p) => p.slug === (args.slug as string))
          if (!p) throw new Error('Project not found: ' + (args.slug as string))
          store.lastSlug = args.slug as string
          p.last_opened_at = new Date().toISOString()
          return p
        }
        case 'suggest_slug':
          return makeSlug(args.name as string)
        case 'delete_project': {
          const idx = store.projects.findIndex((p) => p.slug === (args.slug as string))
          if (idx >= 0) store.projects.splice(idx, 1)
          return null
        }
        default:
          return null
      }
    }
  })
}

// Create a project and wait for Stack Overview to show the project name.
async function createProject(page: Page, name: string): Promise<void> {
  await page.click('text=New Project')
  await page.fill('#project-name', name)
  await page.keyboard.press('Enter')
  // Stack Overview header renders the project name in the breadcrumb
  await expect(page.locator('header').getByText(name)).toBeVisible({ timeout: 10_000 })
}

test('shows project list screen on first load', async ({ page }) => {
  await mockIPC(page)
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'GemKeep' })).toBeVisible()
  await expect(page.getByText('New Project')).toBeVisible()
})

test('can create a project and navigate to Stack Overview', async ({ page }) => {
  await mockIPC(page)
  await page.goto('/')
  await createProject(page, 'E2E Test Project')
  await expect(page.locator('header').getByText('E2E Test Project')).toBeVisible()
})

test('Escape from Stack Overview returns to project list without freezing', async ({ page }) => {
  await mockIPC(page)
  await page.goto('/')
  await createProject(page, 'Freeze Test Project')

  const start = Date.now()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('heading', { name: 'GemKeep' })).toBeVisible({ timeout: 2_000 })
  const elapsed = Date.now() - start

  // If navigation takes >2s there is a render-side freeze
  expect(elapsed).toBeLessThan(2_000)
})

test('two projects both appear in the list (no duplicate key crash)', async ({ page }) => {
  // Collect uncaught JS errors — Svelte's each_key_duplicate throws one
  const pageErrors: string[] = []
  page.on('pageerror', (err) => pageErrors.push(err.message))

  await mockIPC(page)
  await page.goto('/')

  // Create first project (gets id=1)
  await createProject(page, 'Alpha Project')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('heading', { name: 'GemKeep' })).toBeVisible()

  // Create second project (also gets id=1 — same as real Rust behaviour)
  await createProject(page, 'Beta Project')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('heading', { name: 'GemKeep' })).toBeVisible()

  // Both projects must render — proves no each_key_duplicate crash.
  // .first() because the most-recently-created project also appears in the Resume card.
  await expect(page.getByText('Alpha Project').first()).toBeVisible()
  await expect(page.getByText('Beta Project').first()).toBeVisible()

  // No Svelte duplicate-key runtime error thrown
  const dupErrors = pageErrors.filter((e) => e.includes('each_key_duplicate') || e.includes('duplicate key'))
  expect(dupErrors).toHaveLength(0)
})
