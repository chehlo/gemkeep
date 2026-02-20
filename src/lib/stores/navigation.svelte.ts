// Navigation state machine — single source of truth for active screen
// Uses Svelte 5 runes (class-based singleton to allow reassignment)

type ProjectListScreen = { kind: 'project-list' }
type StackOverviewScreen = { kind: 'stack-overview'; projectSlug: string; projectName: string }
type StackFocusScreen = { kind: 'stack-focus'; projectSlug: string; stackId: number; projectName: string }
type SingleViewScreen = { kind: 'single-view'; projectSlug: string; stackId: number; photoId: number; projectName: string }

export type Screen = ProjectListScreen | StackOverviewScreen | StackFocusScreen | SingleViewScreen

class Navigation {
    current = $state<Screen>({ kind: 'project-list' })

    navigate(to: Screen): void {
        this.current = to
    }

    back(): void {
        const s = this.current
        if (s.kind === 'single-view') {
            this.navigate({ kind: 'stack-focus', projectSlug: s.projectSlug, stackId: s.stackId, projectName: s.projectName })
        } else if (s.kind === 'stack-focus') {
            this.navigate({ kind: 'stack-overview', projectSlug: s.projectSlug, projectName: s.projectName })
        } else if (s.kind === 'stack-overview') {
            this.navigate({ kind: 'project-list' })
        }
        // project-list: no further back
    }
}

export const navigation = new Navigation()

// Convenience exports for ergonomic usage
export function navigate(to: Screen): void {
    navigation.navigate(to)
}

export function back(): void {
    navigation.back()
}
