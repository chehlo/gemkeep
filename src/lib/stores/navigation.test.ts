// src/lib/stores/navigation.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { navigation, navigate, back } from './navigation.svelte.js'

function resetNav() {
  navigate({ kind: 'project-list' })
}

describe('navigation store', () => {
  beforeEach(resetNav)

  it('starts on project-list', () => {
    expect(navigation.current.kind).toBe('project-list')
  })

  it('navigates to stack-overview', () => {
    navigate({ kind: 'stack-overview', projectSlug: 'my-proj', projectName: 'My Project' })
    expect(navigation.current.kind).toBe('stack-overview')
  })

  it('back() from stack-overview sets skipAutoOpen and resumeProject', () => {
    navigate({ kind: 'stack-overview', projectSlug: 'iceland', projectName: 'Iceland 2024' })
    back()
    const screen = navigation.current
    expect(screen.kind).toBe('project-list')
    if (screen.kind === 'project-list') {
      expect(screen.skipAutoOpen).toBe(true)
      expect(screen.resumeProject?.slug).toBe('iceland')
      expect(screen.resumeProject?.name).toBe('Iceland 2024')
    }
  })

  it('back() from project-list does nothing', () => {
    navigate({ kind: 'project-list', skipAutoOpen: false })
    back()
    expect(navigation.current.kind).toBe('project-list')
  })

  it('back() from stack-focus goes to stack-overview', () => {
    navigate({ kind: 'stack-focus', projectSlug: 's', stackId: 1, projectName: 'S' })
    back()
    expect(navigation.current.kind).toBe('stack-overview')
  })

  it('back() from single-view goes to stack-focus', () => {
    navigate({ kind: 'single-view', projectSlug: 's', stackId: 1, photoId: 5, projectName: 'S' })
    back()
    expect(navigation.current.kind).toBe('stack-focus')
  })

  it('navigates to comparison-view', () => {
    navigate({ kind: 'comparison-view', projectSlug: 'p', stackId: 1, projectName: 'P' })
    expect(navigation.current.kind).toBe('comparison-view')
    if (navigation.current.kind === 'comparison-view') {
      expect(navigation.current.projectSlug).toBe('p')
      expect(navigation.current.stackId).toBe(1)
      expect(navigation.current.projectName).toBe('P')
    }
  })

  it('back() from comparison-view goes to stack-focus', () => {
    navigate({ kind: 'comparison-view', projectSlug: 's', stackId: 2, projectName: 'S' })
    back()
    expect(navigation.current.kind).toBe('stack-focus')
    if (navigation.current.kind === 'stack-focus') {
      expect(navigation.current.projectSlug).toBe('s')
      expect(navigation.current.stackId).toBe(2)
      expect(navigation.current.projectName).toBe('S')
    }
  })

  it('comparison-view preserves optional photoIds', () => {
    navigate({ kind: 'comparison-view', projectSlug: 'p', stackId: 1, projectName: 'P', photoIds: [3, 7] })
    expect(navigation.current.kind).toBe('comparison-view')
    if (navigation.current.kind === 'comparison-view') {
      expect(navigation.current.photoIds).toEqual([3, 7])
    }
  })
})
