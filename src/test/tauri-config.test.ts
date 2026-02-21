import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, it, expect } from 'vitest'

describe('tauri.conf.json — asset protocol configuration', () => {
  const conf = JSON.parse(
    readFileSync(join(__dirname, '../../src-tauri/tauri.conf.json'), 'utf-8')
  )

  it('has asset protocol enabled', () => {
    expect(conf.app.security.assetProtocol.enable).toBe(true)
  })

  it('has scope that covers absolute filesystem paths (not just relative **)', () => {
    const scope = conf.app.security.assetProtocol.scope as string[]
    expect(scope).toBeDefined()
    expect(scope.length).toBeGreaterThan(0)
    // Each scope entry must be either:
    //   - a Tauri path variable ($HOME, $APPDATA, etc.) which resolves to an absolute path
    //   - an absolute path starting with /
    // The pattern ["**"] alone is INVALID — it does not match /home/... paths
    const hasValidEntry = scope.some(
      (p: string) => p.startsWith('$') || p.startsWith('/')
    )
    expect(hasValidEntry).toBe(true)
  })

  it('scope is not just ["**"] which is known-broken for absolute paths', () => {
    const scope = conf.app.security.assetProtocol.scope as string[]
    const isOnlyRelativeWildcard = scope.length === 1 && scope[0] === '**'
    expect(isOnlyRelativeWildcard).toBe(false)
  })
})
