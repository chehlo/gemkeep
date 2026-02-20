/**
 * E2E critical-journey tests for GemKeep project management.
 *
 * These tests run against a live `cargo tauri dev` instance (http://localhost:1420).
 * Run with: npm run test:e2e  (requires the dev server to be running or will start it)
 *
 * WHY THIS FILE EXISTS — bugs these tests would have caught:
 *
 * Test 1 "shows project list screen on first load"
 *   → Baseline smoke test. Catches complete render failures.
 *
 * Test 2 "can create a project and navigate to Stack Overview"
 *   → Catches create_project command failures or navigation bugs post-create.
 *
 * Test 3 "Escape from Stack Overview returns to project list without freezing"
 *   → WOULD HAVE CAUGHT: The SQLite write-contention freeze (list_projects calling
 *     run_migrations while AppState held an open DB connection — caused 5s hang).
 *     Timing assertion (< 2000ms) makes the hang an automatic test failure.
 *
 * Test 4 "two projects both appear in the list (no duplicate key crash)"
 *   → WOULD HAVE CAUGHT: The Svelte each_key_duplicate error caused by list_projects
 *     returning multiple projects all with id=1 (each project has its own SQLite DB,
 *     so autoincrement starts at 1 in every DB). The fix was using project.slug as
 *     the {#each} key. With 2+ projects, the Svelte error makes the page unusable.
 */

import { test, expect } from '@playwright/test'

// Helper: create a project by name and wait for Stack Overview to appear
async function createProject(page: import('@playwright/test').Page, name: string) {
  await page.click('text=New Project')
  await page.fill('#project-name', name)
  await page.keyboard.press('Enter')
  await expect(page.getByText(name)).toBeVisible({ timeout: 10_000 })
}

test('shows project list screen on first load', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'GemKeep' })).toBeVisible()
  await expect(page.getByText('New Project')).toBeVisible()
})

test('can create a project and navigate to Stack Overview', async ({ page }) => {
  await page.goto('/')
  await createProject(page, 'E2E Test Project')
  // After creation, Stack Overview shows the project name
  await expect(page.getByText('E2E Test Project')).toBeVisible()
})

test('Escape from Stack Overview returns to project list without freezing', async ({ page }) => {
  await page.goto('/')
  await createProject(page, 'Freeze Test Project')

  // Navigate back with Escape — measure how long it takes
  const start = Date.now()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('heading', { name: 'GemKeep' })).toBeVisible({ timeout: 2_000 })
  const elapsed = Date.now() - start

  // If this exceeds 2000ms, it indicates SQLite contention or a render block
  expect(elapsed).toBeLessThan(2_000)
})

test('two projects both appear in the list (no duplicate key crash)', async ({ page }) => {
  await page.goto('/')

  // Create first project
  await createProject(page, 'Alpha Project')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('heading', { name: 'GemKeep' })).toBeVisible()

  // Create second project
  await createProject(page, 'Beta Project')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('heading', { name: 'GemKeep' })).toBeVisible()

  // Both projects must appear in the list — proves no duplicate-key crash
  await expect(page.getByText('Alpha Project')).toBeVisible()
  await expect(page.getByText('Beta Project')).toBeVisible()
})
