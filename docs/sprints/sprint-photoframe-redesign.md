# Sprint: PhotoFrame Final Redesign

## Goal
Implement the Controlled Component pattern for PhotoFrame — component owns ALL visual rendering, screens own only interaction/keyboard handling. Same props = same pixels on any screen.

## Architecture Decision
- Pattern: **Controlled Component** (validated against MUI, Radix, Shadcn)
- PhotoFrame owns: borders, focus ring, selection ring, decision indicators, metadata, photo fitting, dim overlay
- Screens own: keyboard handlers, navigation, data fetching, state management

## Implementation Status

### Already Done (current PhotoFrame.svelte)
- Props interface: `photo`, `status`, `imageUrl`, `layout`, `focused`, `selected`, `showMetadata`, `showFilePath`, `alt`
- Layout variants: `fill`, `panel`, `card` with correct sizing/object-fit/rounding
- Ring indicators: `ring-2 ring-blue-500` (focused), `ring-2 ring-yellow-500` (selected), selected overrides focused
- Undecided border: `border border-gray-700` only when `status === 'undecided'`
- Metadata: full vs compact rendering, format badges, camera params
- Image/placeholder rendering per layout
- All 3 screens already pass `layout`, `focused`, `selected`, `status` props to PhotoFrame

### Still Needed
- **Feature 1**: Absorb DecisionIndicator — move border/dim rendering from overlay child component into PhotoFrame's own container div
- **Feature 1 (dim scoping)**: Move dim overlay from full-frame (`absolute inset-0`) to photo-area only (`[data-testid="photo-area"]`)
- **Feature 5**: Delete DecisionIndicator.svelte, remove import from PhotoFrame.svelte

## Features

### Feature 1: Absorb DecisionIndicator into PhotoFrame
PhotoFrame renders decision borders directly on its container div — no separate overlay component.

**Current state:** PhotoFrame renders `<DecisionIndicator {status} rounded={isRounded} />` as child overlay with `absolute inset-0 z-10 border-4`. The border and dim overlay are separate div elements inside DecisionIndicator.svelte.

**Target state:** PhotoFrame's container div gets border classes directly. No child overlay component.

**Border spec:**
- Always `border-2` on container (note: current DecisionIndicator uses `border-4` via `DECISION_BORDERS` — this is an intentional change)
- Color driven by `status` prop:
  - `undecided` → `border-gray-700` (gray)
  - `keep` → `border-green-500` (green) + marker class `decision-keep` on container
  - `eliminate` → `border-red-500` (red) + marker class `decision-eliminate` on container
- No overlay-based borders (current DecisionIndicator approach is removed)
- Marker classes (`decision-keep`, `decision-eliminate`) MUST remain on the container `[data-testid="photo-frame"]` div — all screen tests query these via `querySelector()`

**Dim overlay spec:**
- `status=eliminate` → `bg-black/50` overlay div with class `decision-dim-overlay`
- Overlay MUST be INSIDE the `[data-testid="photo-area"]` div (dims only photo, NOT metadata)
- Current behavior: overlay is `absolute inset-0` on the entire frame (dims metadata too) — this is a behavioral change
- Overlay must have `pointer-events-none` to not block image interaction

**Acceptance criteria:**
- [ ] `decision-keep` class present on `[data-testid="photo-frame"]` when `status='keep'`
- [ ] `decision-eliminate` class present on `[data-testid="photo-frame"]` when `status='eliminate'`
- [ ] `decision-dim-overlay` element is a child of `[data-testid="photo-area"]`, NOT of `[data-testid="photo-frame"]`
- [ ] No `DecisionIndicator` import in PhotoFrame.svelte
- [ ] Border width is `border-2` on container for all statuses
- [ ] No decision classes/overlay when `status='undecided'`

### Feature 2: Ring indicators for focus/selection
- `focused=true` → `ring-2 ring-blue-500` on container
- `selected=true` → `ring-2 ring-yellow-500` on container (overrides focused)
- Ring (box-shadow) coexists with border (CSS border) — no conflict

**Status:** Already implemented and tested (PhotoFrame.test.ts tests 15).

**Acceptance criteria:**
- [x] `ring-2 ring-blue-500` when focused=true
- [x] `ring-2 ring-yellow-500` when selected=true
- [x] selected overrides focused when both true
- [x] No ring classes when neither

### Feature 3: Layout variants
- `layout="fill"` → flex-1 min-h-0, object-contain, square corners, full metadata
- `layout="panel"` → flex-1 min-h-0, object-contain, square corners, compact metadata
- `layout="card"` → auto-sized, object-cover, rounded-lg, compact metadata

**Status:** Already implemented and tested (PhotoFrame.test.ts tests 10-14).

**Acceptance criteria:**
- [x] fill/panel get `flex-1 min-h-0`, card does not
- [x] card gets `rounded-lg`, others do not
- [x] card uses `object-cover`, others use `object-contain`
- [x] card/panel use compact metadata, fill uses full metadata

### Feature 4: Migrate all screens
- SingleView: `layout="fill"` (already done, verify status prop)
- ComparisonView: `layout="panel"`, `focused` prop, remove wrapper ring/border classes
- StackFocus: `layout="card"`, `focused` + `selected` props, remove wrapper visual classes

**Status:** All 3 screens already pass correct props. No wrapper visual classes found that duplicate PhotoFrame's rendering. Migration is effectively complete — verify after Feature 1.

**Acceptance criteria:**
- [ ] No screen applies `ring-*`, `border-*-500`, or `decision-*` classes outside PhotoFrame
- [ ] All decision visual state comes from PhotoFrame's `status` prop, not from external wrappers
- [ ] Screen tests that query `DECISION_SELECTORS` still pass (selectors find markers on PhotoFrame container)

### Feature 5: Cleanup
- Delete `DecisionIndicator.svelte`
- Remove `import DecisionIndicator from './DecisionIndicator.svelte'` from PhotoFrame.svelte
- Remove `DECISION_BORDERS` from `decisions.ts` if no longer referenced
- Update `DECISION_BORDERS` constant: change `border-4` to `border-2` if kept, or remove if border is now inline
- Zero references to DecisionIndicator in codebase

**Acceptance criteria:**
- [ ] `src/lib/components/DecisionIndicator.svelte` does not exist
- [ ] `grep -r 'DecisionIndicator' src/` returns zero results
- [ ] `DECISION_CLASSES` in `decisions.ts` still exports `decision-keep` and `decision-eliminate` (used by marker classes)
- [ ] `DECISION_SELECTORS` in `decisions.ts` unchanged (used by all test files)
- [ ] No unused imports in any modified file

## DECISION_SELECTORS Migration Plan

The `DECISION_SELECTORS` constants (`.decision-keep`, `.decision-eliminate`, `.decision-dim-overlay`) are used across **4 test files** and **2 test helper files**:

### Files querying DECISION_SELECTORS
| File | Import source | Usage count |
|------|--------------|-------------|
| `src/lib/components/PhotoFrame.test.ts` | `$lib/constants/decisions` | 2 uses |
| `src/lib/components/screens/StackFocus.test.ts` | `$test/decision-helpers` | ~20 uses |
| `src/lib/components/screens/ComparisonView.test.ts` | `$lib/constants/decisions` | 2 uses |
| `src/test/decision-helpers.ts` | `$lib/constants/decisions` | re-exports |
| `src/test/decision-visual-helpers.ts` | `$lib/constants/decisions` | 5 uses |

### Migration approach: KEEP marker classes on container
- PhotoFrame's container div (`[data-testid="photo-frame"]`) gets `decision-keep` or `decision-eliminate` class directly
- This means `container.querySelector('.decision-keep')` finds the container ITSELF (matches on the element, not a child)
- **Critical:** `querySelector()` on a parent DOES match the queried element's descendants, and the container IS a descendant of `[data-testid="photo-card"]` or `[data-testid="comparison-left"]` — so existing screen test queries like `cards[0].querySelector(DECISION_SELECTORS.keep)` will continue to work
- `decision-dim-overlay` remains as a class on the overlay div (now inside photo-area instead of frame-level)
- **No test selector changes required** — all `DECISION_SELECTORS` queries will find their targets

### Constants changes
- `DECISION_CLASSES`: keep as-is (`decision-keep`, `decision-eliminate`)
- `DECISION_BORDERS`: remove or update — PhotoFrame will inline `border-2 border-green-500` instead of using this constant
- `DECISION_SELECTORS`: keep as-is — no changes needed
- `DECISION_TEXT`, `DECISION_TEXT_COLORS`: unrelated, keep as-is

## Feature Dependency Order

```
Feature 1 (Absorb DecisionIndicator)
  └── Feature 4 (Verify screen migration — tests must still pass)
        └── Feature 5 (Cleanup — delete DecisionIndicator.svelte)
```

Features 2 and 3 are already complete and independent.

**Recommended implementation sequence:**
1. Feature 1: Modify PhotoFrame.svelte — add border/marker classes to container, move dim overlay into photo-area, remove `<DecisionIndicator>` usage
2. Run PhotoFrame.test.ts — verify existing decision indicator tests pass
3. Run StackFocus.test.ts and ComparisonView.test.ts — verify DECISION_SELECTORS queries pass
4. Feature 5: Delete DecisionIndicator.svelte, remove dead imports/constants

## Breaking Changes

### Test files that will break during Feature 1
| Test file | What breaks | Why |
|-----------|------------|-----|
| `PhotoFrame.test.ts` (tests 4-5) | `frame.querySelector(DECISION_SELECTORS.keep)` | Currently finds a child div; after change, the frame div itself has the class. `querySelector` on a parent does NOT match the parent itself — **these tests need updating to check `frame.classList.contains()` or use `frame.matches()` instead** |
| `PhotoFrame.test.ts` (test 5) | `frame.querySelector(DECISION_SELECTORS.dimOverlay)` | Overlay moves from frame-level child to photo-area child — still a descendant of frame, so querySelector still works. **No break.** |

**Important subtlety:** `element.querySelector(selector)` searches descendants only, NOT the element itself. If `decision-keep` is placed directly on the `[data-testid="photo-frame"]` div:
- `frame.querySelector('.decision-keep')` will return `null` (class is on frame itself, not a child)
- `parentOfFrame.querySelector('.decision-keep')` will find frame (frame is a descendant of parent)

**Resolution options:**
1. **Add marker class to container AND keep a zero-size marker child** — preserves all querySelector patterns but adds complexity
2. **Update PhotoFrame.test.ts to use `frame.classList.contains('decision-keep')`** — clean but modifies 2 test assertions
3. **Use `frame.closest('.decision-keep') || frame.querySelector('.decision-keep')`** — works for both self and child

**Recommended:** Option 2 for PhotoFrame.test.ts (only 2 assertions to change). Screen tests query from a parent wrapper (`photo-card`, `comparison-left`) so they find PhotoFrame's container div as a descendant — no changes needed.

### Screen test files — NO breaks expected
- `StackFocus.test.ts`: Queries `cards[0].querySelector(DECISION_SELECTORS.keep)` where `cards[0]` is `[data-testid="photo-card"]` — PhotoFrame container is a descendant, so querySelector finds it. **No break.**
- `ComparisonView.test.ts`: Queries `left.querySelector(DECISION_SELECTORS.keep)` where `left` is `[data-testid="comparison-left"]` — PhotoFrame container is a descendant. **No break.**

### Constants file changes
- `src/lib/constants/decisions.ts`: `DECISION_BORDERS` may become unused after Feature 1 (PhotoFrame inlines border classes). Remove in Feature 5 cleanup if no references remain.

## Edge Cases

### Null photo with non-undecided status
- `photo=null` + `status='keep'` → should still render green border (frame visible, placeholder shown, border applied)
- `photo=null` + `status='eliminate'` → should render red border + dim overlay on photo-area (overlay dims placeholder area)
- Rationale: status is a separate concern from photo data — a photo may be marked before its data loads

### Rapid status toggling
- Toggling `status` rapidly between `keep` → `eliminate` → `undecided` must not leave stale marker classes or orphaned dim overlay divs
- Svelte 5 reactivity (`$derived`) handles this — verify no DOM artifacts with a test that renders, updates status prop, and asserts clean state

### Combined rings + borders
- `focused=true` + `status='keep'` → both `ring-2 ring-blue-500` AND `border-2 border-green-500 decision-keep` on container
- `selected=true` + `status='eliminate'` → `ring-2 ring-yellow-500` AND `border-2 border-red-500 decision-eliminate` + dim overlay
- Ring (CSS box-shadow) and border (CSS border) are independent CSS properties — no visual conflict

### Layout=card + eliminate
- `layout='card'` + `status='eliminate'` → dim overlay inside photo-area, rounded corners on frame but NOT on overlay (overlay is inside photo-area which has `overflow-hidden`)

## Props Interface
```typescript
interface Props {
  photo: PhotoDetail | LogicalPhotoSummary | null  // default null
  status: DecisionStatus         // default 'undecided'
  imageUrl: string | null        // default null
  layout: 'fill' | 'card' | 'panel'  // default 'fill'
  focused: boolean               // default false
  selected: boolean              // default false
  showMetadata: boolean          // default true
  showFilePath: string | null    // default null
  alt: string                    // default ''
}
```

## Test Strategy
- RED: Write behavioral tests for new border/dim behavior (new test file)
- GREEN: Implement changes in PhotoFrame.svelte, tests must pass
- Migrate: Update all 3 screens, update screen tests
- Cleanup: Delete DecisionIndicator, consolidate tests, remove dead code

## Definition of Done
- [ ] PhotoFrame renders consistent borders on ALL screens (same props = same pixels)
- [ ] Marker classes (`decision-keep`, `decision-eliminate`) on `[data-testid="photo-frame"]` container
- [ ] Dim overlay (`decision-dim-overlay`) inside `[data-testid="photo-area"]` only
- [ ] DecisionIndicator.svelte deleted, zero references in codebase
- [ ] All tests pass (frontend + Rust) — including StackFocus and ComparisonView screen tests
- [ ] `DECISION_SELECTORS` unchanged in `decisions.ts`
- [ ] No orphaned constants (`DECISION_BORDERS` removed if unused)
- [ ] Edge cases covered: null photo + status, rapid toggling, combined rings + borders
- [ ] User visual verification via screenshots
