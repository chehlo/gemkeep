// src/lib/components/HelpOverlay.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte'
import { navigate, navigation } from '$lib/stores/navigation.svelte.js'
import HelpOverlay from './HelpOverlay.svelte'

beforeEach(() => {
  vi.clearAllMocks()
  navigate({ kind: 'project-list' })
})

describe('HelpOverlay — visibility', () => {
  it('does not render when visible is false', () => {
    render(HelpOverlay, { props: { visible: false } })
    expect(screen.queryByTestId('help-overlay')).not.toBeInTheDocument()
  })

  it('renders overlay when visible is true', () => {
    render(HelpOverlay, { props: { visible: true } })
    expect(screen.getByTestId('help-overlay')).toBeInTheDocument()
    expect(screen.getByText('KEYBOARD SHORTCUTS')).toBeInTheDocument()
  })
})

describe('HelpOverlay — context-aware content', () => {
  it('shows Project List shortcuts on project-list screen', () => {
    navigate({ kind: 'project-list' })
    render(HelpOverlay, { props: { visible: true } })
    expect(screen.getByText(/Project List/)).toBeInTheDocument()
    expect(screen.getByText('Open project')).toBeInTheDocument()
  })

  it('shows Stack Overview shortcuts on stack-overview screen', () => {
    navigate({ kind: 'stack-overview', projectSlug: 'test', projectName: 'Test' })
    render(HelpOverlay, { props: { visible: true } })
    expect(screen.getByText(/Stack Overview/)).toBeInTheDocument()
    expect(screen.getByText('Merge selected stacks')).toBeInTheDocument()
    expect(screen.getByText('Undo last merge')).toBeInTheDocument()
    expect(screen.getByText('Burst gap config')).toBeInTheDocument()
    expect(screen.getByText('Multi-select stacks')).toBeInTheDocument()
  })

  it('shows Stack Focus shortcuts on stack-focus screen', () => {
    navigate({ kind: 'stack-focus', projectSlug: 'test', projectName: 'Test', stackId: 1 })
    render(HelpOverlay, { props: { visible: true } })
    expect(screen.getByText(/Stack Focus/)).toBeInTheDocument()
    expect(screen.getByText('Open in single view')).toBeInTheDocument()
    expect(screen.getByText('Keep photo')).toBeInTheDocument()
    expect(screen.getByText('Commit round')).toBeInTheDocument()
  })

  it('shows Single View shortcuts on single-view screen', () => {
    navigate({ kind: 'single-view', projectSlug: 'test', projectName: 'Test', stackId: 1, photoId: 1 })
    render(HelpOverlay, { props: { visible: true } })
    expect(screen.getByText(/Single View/)).toBeInTheDocument()
    expect(screen.getByText('Keep photo')).toBeInTheDocument()
    expect(screen.getByText('Eliminate photo')).toBeInTheDocument()
    expect(screen.getByText('Toggle camera params')).toBeInTheDocument()
    expect(screen.getByText('Jump to next undecided')).toBeInTheDocument()
  })
})

describe('HelpOverlay — only implemented shortcuts', () => {
  it('stack-focus shows "Eliminate photo" (X key now implemented)', () => {
    navigate({ kind: 'stack-focus', projectSlug: 'test', projectName: 'Test', stackId: 1 })
    render(HelpOverlay, { props: { visible: true } })
    expect(screen.getByText('Eliminate photo')).toBeInTheDocument()
  })

  it('project-list does NOT show merge or decision shortcuts', () => {
    navigate({ kind: 'project-list' })
    render(HelpOverlay, { props: { visible: true } })
    expect(screen.queryByText('Merge selected stacks')).not.toBeInTheDocument()
    expect(screen.queryByText('Keep photo')).not.toBeInTheDocument()
  })
})

describe('HelpOverlay — Sprint 7 updated shortcuts', () => {
  it('StackOverview shows Shift+Arrow for multi-select (not just Shift+Right)', () => {
    navigate({ kind: 'stack-overview', projectSlug: 'test', projectName: 'Test' })
    render(HelpOverlay, { props: { visible: true } })
    // The multi-select shortcut should show "Shift+Arrow" (supporting all directions)
    // not just "Shift+Right" which only describes one direction
    const allText = document.body.textContent ?? ''
    expect(allText).toContain('Shift+Arrow')
  })

  it('StackFocus shows Tab shortcut for next undecided', () => {
    navigate({ kind: 'stack-focus', projectSlug: 'test', projectName: 'Test', stackId: 1 })
    render(HelpOverlay, { props: { visible: true } })
    // Tab should be listed in StackFocus shortcuts for jumping to next undecided photo
    const allText = document.body.textContent ?? ''
    const hasTab = allText.includes('Tab') && (allText.includes('undecided') || allText.includes('next'))
    expect(hasTab).toBe(true)
  })

  it('SingleView shows Home and End shortcuts', () => {
    navigate({ kind: 'single-view', projectSlug: 'test', projectName: 'Test', stackId: 1, photoId: 1 })
    render(HelpOverlay, { props: { visible: true } })
    const allText = document.body.textContent ?? ''
    expect(allText).toContain('Home')
    expect(allText).toContain('End')
  })
})

describe('HelpOverlay — header hint', () => {
  it('HO-06: shows "? to close" hint text', () => {
    render(HelpOverlay, { props: { visible: true } })
    expect(screen.getByText('? to close')).toBeInTheDocument()
  })
})

describe('HelpOverlay — ARIA attributes', () => {
  it('HO-16: has role=dialog, aria-modal=true, aria-label="Keyboard shortcuts"', () => {
    render(HelpOverlay, { props: { visible: true } })
    const overlay = screen.getByTestId('help-overlay')
    expect(overlay).toHaveAttribute('role', 'dialog')
    expect(overlay).toHaveAttribute('aria-modal', 'true')
    expect(overlay).toHaveAttribute('aria-label', 'Keyboard shortcuts')
  })
})

describe('HelpOverlay — dismiss behaviors', () => {
  it('HO-10: clicking backdrop dismisses overlay', async () => {
    render(HelpOverlay, { props: { visible: true } })
    const overlay = screen.getByTestId('help-overlay')
    await fireEvent.click(overlay)
    await waitFor(() => {
      expect(screen.queryByTestId('help-overlay')).not.toBeInTheDocument()
    })
  })

  it('HO-11: clicking inside panel does NOT dismiss overlay', async () => {
    render(HelpOverlay, { props: { visible: true } })
    const panel = screen.getByRole('document')
    await fireEvent.click(panel)
    expect(screen.getByTestId('help-overlay')).toBeInTheDocument()
  })

  it('HO-12: Escape key dismisses overlay', async () => {
    render(HelpOverlay, { props: { visible: true } })
    const overlay = screen.getByTestId('help-overlay')
    await fireEvent.keyDown(overlay, { key: 'Escape' })
    await waitFor(() => {
      expect(screen.queryByTestId('help-overlay')).not.toBeInTheDocument()
    })
  })

  it('HO-13: ? key dismisses overlay', async () => {
    render(HelpOverlay, { props: { visible: true } })
    const overlay = screen.getByTestId('help-overlay')
    await fireEvent.keyDown(overlay, { key: '?' })
    await waitFor(() => {
      expect(screen.queryByTestId('help-overlay')).not.toBeInTheDocument()
    })
  })

  it('HO-37: Escape stopPropagation prevents bubbling to outer listeners', async () => {
    const outerHandler = vi.fn()
    document.addEventListener('keydown', outerHandler)

    render(HelpOverlay, { props: { visible: true } })
    const overlay = screen.getByTestId('help-overlay')
    await fireEvent.keyDown(overlay, { key: 'Escape' })

    expect(outerHandler).not.toHaveBeenCalled()
    document.removeEventListener('keydown', outerHandler)
  })
})

describe('HelpOverlay — unknown screen fallback', () => {
  it('HO-35: falls back to PROJECT_LIST shortcuts for unknown screen kind', () => {
    // Force navigation to an unknown screen kind
    ;(navigation as any).current = { kind: 'unknown-screen' }
    render(HelpOverlay, { props: { visible: true } })
    // PROJECT_LIST has "Open project" shortcut
    expect(screen.getByText('Open project')).toBeInTheDocument()
  })

  it('HO-36: falls back to "GemKeep" title for unknown screen kind', () => {
    ;(navigation as any).current = { kind: 'unknown-screen' }
    render(HelpOverlay, { props: { visible: true } })
    expect(screen.getByText(/GemKeep/)).toBeInTheDocument()
  })
})
