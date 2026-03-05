# Screen Review: Gaps Between Wireframe Spec and Implementation

Systematic comparison of `docs/ui-wireframes.md` + `docs/keyboard-map.md`
against the actual Svelte components. Only mismatches and gaps listed.

---

## Cross-Screen Issue: Decision Indicators Are Inconsistent

**The most important finding.** Decision visual feedback is implemented
differently on each screen and does not match the wireframe spec. There
is no shared component — each screen has its own inline markup.

| Aspect | Wireframe Spec | StackFocus (actual) | SingleView (actual) |
|---|---|---|---|
| Kept indicator | Green left border + `✓ KEPT` text badge (top-left) | Small green dot `w-3 h-3` (top-right), no border | `border-4 border-green-500` full-viewport frame, no badge text |
| Eliminated indicator | Red border + `✗ ELIM` text badge + 50% dim | Small red dot (top-right) + `opacity-50`, no border | `border-4 border-red-500` + `bg-black/50` overlay, no badge text |
| Undecided | Neutral border, no badge | Correct | Correct |

**Code locations:**
- `StackFocus.svelte:226-230` — dot badges
- `SingleView.svelte:207-213` — border overlays

**Consistency requirement:** Both screens should use the same visual
language for decision state. Must be extracted into a shared component
(e.g. `DecisionIndicator.svelte` or a utility) so a style change
propagates project-wide.

**Test coverage for visual bugs:**
- StackFocus: jsdom tests check `.badge-keep` class exists — would NOT
  catch if the badge renders outside the card (BUG-08 pattern). The
  Playwright E2E test (`visual-feedback.spec.ts`) catches boundingBox
  positioning bugs but only tests one specific badge case.
- SingleView: jsdom test checks `.border-red-500` class exists — would
  NOT catch if the border doesn't render visually. No Playwright visual
  test for SingleView.
- **Neither screen has tests verifying consistency** between the two
  implementations.

---

## StackFocus — Gaps

### 1. Camera params missing from grid cards (data gap)

Wireframe §3.1 shows per card: **time, f/2.8, 1/250s, ISO 400, 85mm**

`LogicalPhotoSummary` only returns: `capture_time`, `camera_model`,
`lens`, `has_raw`, `has_jpeg`.

Missing fields: `aperture`, `shutter_speed`, `iso`, `focal_length`.

These exist in the `photos` DB table and are already queried in
`decisions/engine.rs` (PhotoDetail struct). The SQL at
`repository.rs:175` needs to SELECT them and the struct/TS type need
updating.

**Tested?** No — jsdom tests only check camera_model and lens presence.

### 2. No scrollIntoView on arrow navigation

StackOverview calls `scrollFocusedCardIntoView()` after every arrow
press. StackFocus does NOT. With large stacks (12+ photos), focused
cards move off-screen.

**Tested?** No.

### 3. Missing keyboard shortcuts (S7 scope)

Per `keyboard-map.md` Sprint 7:
- `hjkl` Vim-style navigation — not implemented
- `Home` / `End` jump to first/last photo — not implemented
- `E` key to open SingleView — not implemented (only Enter works)

**Tested?** No tests for these shortcuts.

### 4. Decision borders missing on cards

Wireframe §3.1 says kept cards get GREEN border, eliminated cards get
RED border. Implementation only applies blue border to the focused card.
Decided cards have no colored border at all.

**Tested?** No — jsdom tests check for badge dots and opacity, not
border color.

---

## SingleView — Gaps

### 5. Camera params panel position wrong

Wireframe §4.1/§4.4 shows EXIF panel as a floating right-side overlay
on top of the photo. Implementation renders it as a horizontal bar
**below** the photo (`px-4 py-2 bg-gray-900`).

**Tested?** jsdom tests check text content (f/2.8, ISO 400, etc.) is
present — would NOT catch layout position.

### 6. No header / breadcrumb bar

Wireframe shows no visible header (photo fills viewport). Implementation
has no header either — OK. But the wireframe shows a status bar at the
bottom with `Photo 5/12 . Stack: Iceland Sunset . Round 1 . UNDECIDED`.

Implementation status bar (line 256): `Photo {n}/{total} — {STATUS} — Round {n}`

Missing from status bar: **stack name** (wireframe shows "Stack: Iceland Sunset").

**Tested?** jsdom test checks `Photo 1/3` and `KEPT` text — but does
not verify stack name is shown.

### 7. No green flash / red flash animation

Wireframe §4.2 says "brief green flash fills the border, then settles."
§4.3 says "brief red flash." Implementation applies the border
instantly with no flash animation.

**Tested?** Not testable in jsdom. No Playwright test for SingleView
decision feedback.

### 8. Missing keyboard shortcuts (S7 scope)

Per `keyboard-map.md` Sprint 7:
- `hjkl` — `h`/`l` ARE implemented (line 144, 153), `j`/`k` are NOT
  (no up/down in single view, which is correct — wireframe doesn't show
  vertical navigation for SingleView). So `h`/`l` are correct.

All other S7 shortcuts (Tab, Shift+Tab, Home, End, Y, X, I,
Ctrl+Enter, Esc) are implemented.

**No gap here** — SingleView keyboard is complete for S7.

---

## StackOverview — Gaps

### 9. Header/source folders scroll off-screen (user-reported)

The source folders + summary area is not sticky. Arrow-key navigation
scrolls the grid via `scrollIntoView` but the header area scrolls away
with no keyboard way to get back to it.

**Tested?** No — requires real viewport (Playwright).

### 10. Missing keyboard shortcuts (S7 scope)

- `hjkl` Vim-style navigation — not implemented
- `Home` / `End` first/last stack — not implemented

**Tested?** No.

### 11. Non-adjacent stack selection impossible

Shift+Arrow selects a contiguous range only. No Ctrl+Click or toggle
mechanism to select stacks that are not next to each other for merge.

**Tested?** Multi-select tests only cover Shift+Arrow.

---

## ProjectList — Gaps

### 12. No "No projects yet" empty text

When project list is empty and no Resume card is shown, the screen shows
only "GemKeep" heading and "+ New Project" with no explanatory text.
Wireframe §1.1 shows "No projects yet."

**Tested?** No.

### 13. Focus rings not visible on interactive elements

Browser Tab cycles focus but no visible `ring-2 ring-blue-500/30` on
buttons. Keyboard-first app should show focus state clearly.

**Tested?** No.

---

## HelpOverlay — Gaps

### 14. Missing shortcuts per screen

| Screen | Missing from ? overlay |
|---|---|
| ProjectList | (none — minimal by design) |
| StackOverview | `hjkl`, `Home`/`End` (once implemented) |
| StackFocus | `Home`/`End`, `E` key (once implemented) |
| SingleView | (complete for S7) |

**Tested?** No tests for HelpOverlay content accuracy.

---

## Architecture Issue: No Shared Visual Components

Decision indicators, focus rings, and camera param display are
copy-pasted across screens. Changes require editing multiple files:

| Visual element | Files where duplicated |
|---|---|
| Decision badge (keep/eliminate) | `StackFocus.svelte`, `SingleView.svelte` |
| Camera params display | `StackFocus.svelte` (partial), `SingleView.svelte` (full) |
| Focus ring style | `StackFocus.svelte`, `StackOverview.svelte` |
| RAW/JPEG badges | `StackFocus.svelte`, `SingleView.svelte`, `StackOverview.svelte` |
| `formatCaptureTime()` | `StackFocus.svelte`, `SingleView.svelte` (duplicated) |

**Recommendation:** Extract shared primitives:
- `DecisionBadge.svelte` — renders keep/eliminate/undecided indicator
  (used in both grid cards and single-view overlay)
- `CameraParams.svelte` — renders EXIF fields
- `FormatBadges.svelte` — RAW/JPEG pills
- `formatCaptureTime()` — move to `src/lib/utils/`

This enables the user's requirement: "if we want to change [selection
presentation] it should be single place where it's updated for entire
product."

---

## Summary Table

| # | Screen | Gap | Visual bug catchable? | Priority |
|---|---|---|---|---|
| — | **All** | Decision indicators inconsistent + not shared | No | **High** |
| 1 | StackFocus | Camera params missing (aperture, ISO, etc.) | No | High |
| 2 | StackFocus | No scrollIntoView on arrow nav | No (needs Playwright) | Medium |
| 3 | StackFocus | hjkl, Home/End, E key missing | No tests | Medium |
| 4 | StackFocus | No green/red border on decided cards | No | High |
| 5 | SingleView | EXIF panel at bottom, not right-side overlay | No (needs Playwright) | Medium |
| 6 | SingleView | Status bar missing stack name | No | Low |
| 7 | SingleView | No flash animation on Y/X | No (needs Playwright) | Low |
| 9 | StackOverview | Header scrolls off-screen | No (needs Playwright) | Medium |
| 10 | StackOverview | hjkl, Home/End missing | No tests | Medium |
| 11 | StackOverview | Non-adjacent stack selection | Partial (Shift only) | Medium |
| 12 | ProjectList | "No projects yet" text missing | No | Low |
| 13 | ProjectList | Focus rings not visible | No (needs Playwright) | Low |
| 14 | HelpOverlay | Missing shortcut entries | No | Low |
