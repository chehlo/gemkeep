# Sprint: Improvements (Backlog)

> **Superseded by `docs/backlog.md`.** All items consolidated there. This file kept for historical reference.

Non-blocking UX improvements discovered during screen-by-screen review.
These are refinements to existing features — not new features.

---

## ProjectList — Keyboard Navigation

**Context:** App is keyboard-first but ProjectList relies on browser Tab
for navigation. Arrow-key navigation with visual row selection would be
more consistent with the rest of the app.

### Items

1. **Arrow Up/Down row selection** — highlight active project row,
   Enter opens it. Visual indicator matches `ring-2 ring-blue-500/30`
   used elsewhere. Delete should remain less accessible (not single-key).

2. **`/` fuzzy search** — filter projects by name. Useful when the list
   grows beyond a handful.

3. **`N` shortcut** — toggle New Project form open/closed.

4. **`D` or `Del` on selected row** — opens delete confirmation modal.
   Requires confirmation step (never single-key destructive).

5. **Focus rings on all interactive elements** — Resume Open button,
   + New Project, project row Open/Delete buttons should show visible
   focus ring when Tab-focused.

6. **"No projects yet" text** — show when project list is empty and no
   Resume card is present.

---

## StackOverview — Navigation & Selection

**Context:** Several S7-spec keyboard shortcuts are not yet implemented.
The header scrolls off-screen making source folders inaccessible. Stack
merge only works with adjacent selection (Shift+Arrow).

### Items

1. **Sticky header / scroll boundary** — Source folders + summary area
   should not scroll off-screen when arrow-navigating the stack grid.
   The grid area should scroll independently.

2. **hjkl Vim-style navigation** — Spec'd for S7 in keyboard-map.md
   but not implemented. Should mirror arrow key behavior.

3. **Home/End jump to first/last stack** — Spec'd for S7 in
   keyboard-map.md but not implemented.

4. **Non-adjacent stack selection for merge** — Currently only
   Shift+Arrow selects adjacent stacks. Need Ctrl+Click or a toggle key
   to add/remove individual stacks from the selection so non-adjacent
   stacks can be merged.

5. **Update ? help overlay** — Add hjkl, Home/End once implemented.

---

## StackFocus — Visual & Data Gaps

**Context:** Decision indicators don't match wireframe. Camera params
are incomplete. Missing keyboard shortcuts from S7 spec.

### Items

1. **Decision indicators must match wireframe** — Green border + text
   badge for kept, red border + dim + text badge for eliminated. Current
   small dots are inconsistent with SingleView's full-border approach.
   Must use shared component (see Architecture section below).

2. **Add camera params to grid cards** — Extend `LogicalPhotoSummary`
   with `aperture`, `shutter_speed`, `iso`, `focal_length` from the
   `photos` table. Display below each thumbnail per wireframe §3.1.

3. **scrollIntoView on arrow navigation** — Copy pattern from
   StackOverview (`scrollFocusedCardIntoView()` after every arrow press).

4. **hjkl Vim-style navigation** — Mirror arrow key behavior.

5. **Home/End first/last photo** — Jump focus to first/last card.

6. **E key opens SingleView** — Alternative to Enter, per keyboard-map.

7. **Update ? help overlay** — Add Home/End, E once implemented.

---

## SingleView — Layout & Polish

**Context:** Camera params panel position doesn't match wireframe. Some
status bar info missing. Full-res photos may display with wrong orientation.

### Items

1. **EXIF panel as right-side overlay** — Wireframe §4.4 shows a
   floating panel over the right edge of the photo. Implementation
   renders a horizontal bar below. Move to overlaid position.

2. **Stack name in status bar** — Wireframe shows "Stack: Iceland Sunset"
   in the status bar. Implementation only shows photo position and status.

3. **Decision flash animation** — Brief green/red flash (200ms) before
   settling to persistent border. Low priority polish.

4. **Full-res orientation correction** — SingleView shows original JPEG
   via `convertFileSrc(jpeg_path)`. Thumbnails are pre-rotated by Rust,
   but original files are served raw — cameras with EXIF orientation != 1
   will display incorrectly. Fix: add `orientation` field to
   `LogicalPhotoSummary` (Rust struct + SQL query + TS type), pass it to
   the frontend, apply CSS `transform: rotate()` based on orientation
   value. Affects: `model.rs`, `repository.rs`, `api/index.ts`,
   `SingleView.svelte`, `StackFocus.svelte` (data-orientation attribute).
   Tests: restore orientation.test.ts (removed in sprint-7 cleanup).

---

## Architecture — Shared Visual Components

**Context:** Decision indicators, focus rings, camera params, and
format badges are duplicated across screens. Style changes require
editing multiple files. User requirement: "if we want to change it,
it should be single place where it's updated for entire product."

### Components to extract

1. **`DecisionIndicator.svelte`** — Renders keep/eliminate/undecided
   state. Two variants: `grid` (for card overlays in StackFocus) and
   `viewport` (for full-screen border in SingleView). Single source
   of truth for colors, badge text, opacity, border style.

2. **`CameraParams.svelte`** — Renders EXIF fields. Two layouts:
   `compact` (for grid cards: time, f/, 1/s, ISO, mm) and `full`
   (for SingleView overlay: all fields + camera body + lens).

3. **`FormatBadges.svelte`** — RAW/JPEG pills. Used in StackFocus
   cards, SingleView params, and StackOverview cards.

4. **`formatCaptureTime()`** — Move from duplicated function in
   StackFocus.svelte + SingleView.svelte to `src/lib/utils/date.ts`.

### Files currently duplicating logic

| Component | StackOverview | StackFocus | SingleView |
|---|---|---|---|
| Decision badge | — | inline dots | inline border |
| Camera params | — | partial (model, lens) | full (all EXIF) |
| RAW/JPEG badges | inline | inline | inline |
| Focus ring | inline | inline | — |
| formatCaptureTime | — | inline | inline |

---

## HelpOverlay — Content Updates

Once keyboard gaps above are implemented, update the shortcut lists
in `HelpOverlay.svelte` (lines 23-81):

- StackOverview: add hjkl, Home/End
- StackFocus: add Home/End, E
- All screens stay in sync with `keyboard-map.md`
