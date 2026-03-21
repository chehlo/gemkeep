/**
 * F5 Cleanup verification tests.
 *
 * These tests assert that dead code has been removed after DecisionIndicator
 * was absorbed into PhotoFrame. They use the filesystem and module system
 * to verify cleanup is complete.
 *
 * RED tests (should fail before cleanup, pass after):
 *   - DecisionIndicator.svelte must not exist
 *   - DECISION_BORDERS must not be exported from decisions.ts
 *   - decision-helpers.ts must not reference DECISION_BORDERS
 *
 * GREEN tests (regression guards, should pass now and after):
 *   - decisions.ts still exports DECISION_CLASSES, DECISION_SELECTORS, DECISION_TEXT, DECISION_TEXT_COLORS
 *   - No production .svelte file imports DecisionIndicator
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

// Use process.cwd() — vitest always runs from the project root
const PROJECT_ROOT = process.cwd()
const SRC_DIR = path.join(PROJECT_ROOT, 'src')
const COMPONENTS_DIR = path.join(SRC_DIR, 'lib', 'components')

describe('F5 Cleanup — dead code removal', () => {
  it('DecisionIndicator.svelte must not exist', () => {
    const filePath = path.join(COMPONENTS_DIR, 'DecisionIndicator.svelte')
    expect(fs.existsSync(filePath)).toBe(false)
  })

  it('decisions.ts must not export DECISION_BORDERS', () => {
    const decisionsPath = path.join(COMPONENTS_DIR, '..', 'constants', 'decisions.ts')
    const content = fs.readFileSync(decisionsPath, 'utf-8')
    expect(content).not.toMatch(/export\s+(const|let|var)\s+DECISION_BORDERS/)
  })

  it('decision-helpers.ts must not reference DECISION_BORDERS', () => {
    const helpersPath = path.join(SRC_DIR, 'test', 'decision-helpers.ts')
    const content = fs.readFileSync(helpersPath, 'utf-8')
    expect(content).not.toContain('DECISION_BORDERS')
  })
})

describe('F5 Cleanup — regression guards (surviving exports)', () => {
  it('decisions.ts still exports DECISION_CLASSES', () => {
    const decisionsPath = path.join(COMPONENTS_DIR, '..', 'constants', 'decisions.ts')
    const content = fs.readFileSync(decisionsPath, 'utf-8')
    expect(content).toMatch(/export\s+(const|let|var)\s+DECISION_CLASSES/)
  })

  it('decisions.ts still exports DECISION_SELECTORS', () => {
    const decisionsPath = path.join(COMPONENTS_DIR, '..', 'constants', 'decisions.ts')
    const content = fs.readFileSync(decisionsPath, 'utf-8')
    expect(content).toMatch(/export\s+(const|let|var)\s+DECISION_SELECTORS/)
  })

  it('decisions.ts still exports DECISION_TEXT', () => {
    const decisionsPath = path.join(COMPONENTS_DIR, '..', 'constants', 'decisions.ts')
    const content = fs.readFileSync(decisionsPath, 'utf-8')
    expect(content).toMatch(/export\s+(const|let|var)\s+DECISION_TEXT\b/)
  })

  it('decisions.ts still exports DECISION_TEXT_COLORS', () => {
    const decisionsPath = path.join(COMPONENTS_DIR, '..', 'constants', 'decisions.ts')
    const content = fs.readFileSync(decisionsPath, 'utf-8')
    expect(content).toMatch(/export\s+(const|let|var)\s+DECISION_TEXT_COLORS/)
  })

  it('no production .svelte file imports DecisionIndicator', () => {
    const svelteFiles = findSvelteFiles(path.join(SRC_DIR, 'lib'))
    const offenders: string[] = []

    for (const file of svelteFiles) {
      const content = fs.readFileSync(file, 'utf-8')
      if (/import\s+.*DecisionIndicator/.test(content)) {
        offenders.push(path.relative(SRC_DIR, file))
      }
    }

    expect(offenders).toEqual([])
  })
})

/** Recursively find all .svelte files under a directory */
function findSvelteFiles(dir: string): string[] {
  const results: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      results.push(...findSvelteFiles(fullPath))
    } else if (entry.name.endsWith('.svelte')) {
      results.push(fullPath)
    }
  }
  return results
}
