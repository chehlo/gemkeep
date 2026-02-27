# GemKeep Keyboard Shortcut Map

Complete keyboard shortcut specification for every mode.

---

## Design Principles

1. **Single-key actions for common operations.** The most frequent actions
   (keep, eliminate, navigate) require exactly one keypress with no
   modifier. This matches Photo Mechanic's speed and beats FastRawViewer's
   Alt+key requirement.

2. **Y/X for decisions, not P/X.** Lightroom uses P for "Pick" but P is
   ambiguous (print? pause? pan?). Y = "Yes, keep this" and X = "cross
   it out" are unambiguous and do not conflict with other shortcuts.

3. **Auto-advance OFF by default.** The target user is a hobbyist focused
   on analysis and learning. They want to study camera parameters and
   compare photos deliberately. Auto-advance is available via toggle
   for speed passes but never forced.

4. **Modifier keys reserved for power actions.** Ctrl+Enter commits a
   round. Ctrl+Z undoes. Ctrl+B opens burst config. Single keys handle
   the minute-to-minute workflow; modifier combos handle structural
   actions that should require intention.

5. **Vim-style hjkl as alternative navigation.** Available everywhere
   arrow keys work. Never the only option -- always a supplement.

6. **Esc is always "go back."** Every screen has a single, predictable
   escape hatch. Esc never destroys data.

7. **No modal dialogs during culling.** All feedback is inline. The
   only modal is the delete-project confirmation in ProjectList.

---

## Global Shortcuts

These work in every screen of the application.

| Key | Action | Notes |
|---|---|---|
| `Esc` | Go back / dismiss overlay | Returns to parent screen. In ProjectList, does nothing. Dismisses help overlay, burst panel, quick preview. |
| `Ctrl+B` | Open burst gap config | Opens the burst threshold panel as an overlay. Available from any screen but most useful in StackOverview. |
| `?` | Toggle keyboard help overlay | Shows all shortcuts for the current screen. Press again or Esc to dismiss. |
| `Ctrl+Z` | Undo last decision | Pops the most recent decision in the current round. Single-level undo. No effect if round is committed. Sprint 8. |

---

## ProjectList Shortcuts

Minimal keyboard support. This screen is primarily mouse-driven
since it is visited infrequently.

| Key | Action | Notes |
|---|---|---|
| `Enter` | Open focused project / submit form | When the create-project form is focused, submits. When a project row is focused, opens it. |
| `Esc` | -- | No parent screen to return to. |

---

## StackOverview Shortcuts

The main navigation hub. Grid of stack cards with arrow-key focus.

| Key | Action | Sprint | Notes |
|---|---|---|---|
| `Arrow Right` | Move focus right | Done | Wraps at row end: no (stops at last item) |
| `Arrow Left` | Move focus left | Done | Stops at first item |
| `Arrow Down` | Move focus down one row | Done | Jumps by column count (4) |
| `Arrow Up` | Move focus up one row | Done | Jumps by column count (4) |
| `h` / `j` / `k` / `l` | Vim-style left/down/up/right | S7 | Alternative to arrow keys |
| `Enter` | Open focused stack (StackFocus) | Done | Saves focus index for scroll restore on return |
| `Space` | Quick preview of focused stack | S12 | Large thumbnail overlay, dismiss with any key |
| `i` | Start indexing | Done | Only when source folders exist and not already indexing |
| `r` | Re-index photos | Done | Only when stacks exist and not already indexing |
| `F` | Open Finalist View | S10 | Shows all stack winners for cross-stack refinement |
| `Ctrl+B` | Open burst gap config | Done | Overlay panel for burst threshold |
| `Esc` | Back to ProjectList | Done | Preserves resume-project state |
| `?` | Keyboard help overlay | S12 | Shows StackOverview-specific shortcuts |
| `Tab` | Jump to next undecided stack | S8 | Skips stacks that are complete or finalized |
| `Shift+Tab` | Jump to previous undecided stack | S8 | Reverse of Tab |
| `/` | Open search / filter bar | S12 | Fuzzy search across filenames, dates, metadata |

---

## StackFocus Shortcuts

The culling grid. Thumbnails with decision indicators and camera
parameters. This is where most decisions begin.

| Key | Action | Sprint | Notes |
|---|---|---|---|
| `Arrow Right` | Move focus right | Done | |
| `Arrow Left` | Move focus left | Done | |
| `Arrow Down` | Move focus down one row | Done | |
| `Arrow Up` | Move focus up one row | Done | |
| `h` / `j` / `k` / `l` | Vim-style navigation | S7 | |
| `Enter` or `E` | Open focused photo in SingleView | S7 | Preserves photo index for return |
| `Y` | Keep focused photo | S7 | Green border + badge. Applies to entire logical photo (RAW+JPEG pair). Re-decidable before commit. |
| `X` | Eliminate focused photo | S7 | Red dim + badge. Applies to entire logical photo. Re-decidable before commit. |
| `U` | Undo last decision | S8 | Reverts most recent Y/X in current round. Only before commit. |
| `C` | Enter Comparison View | S8 | Pairs focused photo with next undecided. Or if two are multi-selected, compares those two. |
| `Shift+Arrow` | Extend multi-selection | S8 | Select multiple photos for comparison or bulk operations |
| `Tab` | Jump to next undecided photo | S7 | Skips kept and eliminated photos |
| `Shift+Tab` | Jump to previous undecided photo | S7 | Reverse |
| `A` | Toggle auto-advance | S8 | When ON, Y/X auto-advances to next undecided. Shows `[AUTO >>]` indicator. Default OFF. |
| `Ctrl+Enter` | Commit current round | S7 | Seals the round. Decisions become read-only. Non-reversible. |
| `Ctrl+Shift+Enter` | Finalize stack | S9 | Marks stack as done. Finalist(s) locked. Shows confirmation inline. |
| `[` | Previous round | S9 | Navigate to earlier round snapshot (read-only) |
| `]` | Next round / current round | S9 | Navigate forward through rounds |
| `R` | Restore eliminated photo | S9 | Only in round-history view on a dimmed photo. Creates a keep in the current round. |
| `Home` | Jump to first photo | S7 | |
| `End` | Jump to last photo | S7 | |
| `Esc` | Back to StackOverview | Done | Restores scroll position in StackOverview |
| `?` | Keyboard help overlay | S12 | |

---

## SingleView Shortcuts

Full-screen photo display with camera parameters. The per-photo
evaluation screen.

| Key | Action | Sprint | Notes |
|---|---|---|---|
| `Arrow Right` or `l` | Next photo in stack | S7 | Wraps: no (stops at last) |
| `Arrow Left` or `h` | Previous photo in stack | S7 | Stops at first |
| `Y` | Keep this photo | S7 | Green border flash, then persistent green edge. Status bar updates to `KEPT`. |
| `X` | Eliminate this photo | S7 | Red flash, then persistent dim + red edge. Status bar updates to `ELIMINATED`. |
| `U` | Undo last decision | S8 | Reverts to undecided. Removes visual feedback. |
| `Tab` | Jump to next undecided photo | S7 | Skips decided photos. Useful for reviewing remaining undecided. |
| `Shift+Tab` | Jump to previous undecided | S7 | Reverse |
| `A` | Toggle auto-advance | S8 | Same toggle as StackFocus. Shared state. |
| `Ctrl+Enter` | Commit current round | S7 | Same as StackFocus. Can commit from SingleView. |
| `C` | Enter Comparison View | S8 | Opens comparison with current photo on left, next undecided on right |
| `I` | Toggle camera parameters panel | S7 | Show/hide the EXIF overlay. Default: visible. |
| `0` | Fit photo to screen | S12 | Reset zoom to fit-to-window |
| `1` | Zoom to 100% (actual pixels) | S12 | Centers on photo center (or last cursor position) |
| `+` or `=` | Zoom in | S12 | Step zoom |
| `-` | Zoom out | S12 | Step zoom |
| `R` (in SingleView) | Toggle RAW/JPEG preview | S12 | Switches between embedded JPEG and full RAW decode. Only for RAW+JPEG pairs. |
| `Home` | First photo in stack | S7 | |
| `End` | Last photo in stack | S7 | |
| `Esc` | Back to StackFocus | S7 | Returns to grid, focused on the photo that was viewed |
| `?` | Keyboard help overlay | S12 | |

---

## Comparison View Shortcuts

Side-by-side 50/50 split. Two photos with camera parameters for both.
This is the PRIMARY decision-making view for the hobbyist user.

| Key | Action | Sprint | Notes |
|---|---|---|---|
| `Tab` | Switch active side (A <-> B) | S8 | Blue border moves to indicate which photo receives Y/X |
| `Y` | Keep the active photo | S8 | Green feedback on the active side. Does not affect the other side. |
| `X` | Eliminate the active photo | S8 | Red dim on the active side. If not locked, auto-fills the slot with next undecided. |
| `U` | Undo last decision | S8 | Reverts the most recent decision. Restores the previous photo if it was auto-filled away. |
| `L` | Toggle lock | S8 | When locked: auto-fill suppressed after elimination. User must manually proceed. Lock icon shows in header. |
| `Arrow Left` | Replace active photo with previous | S8 | Manual photo replacement when locked or browsing |
| `Arrow Right` | Replace active photo with next | S8 | Manual photo replacement |
| `Shift+Arrow Left` | Replace inactive photo with prev | S8 | Change the non-active side without switching |
| `Shift+Arrow Right` | Replace inactive photo with next | S8 | |
| `I` | Toggle camera parameters | S8 | Show/hide EXIF panels for both photos |
| `Ctrl+Enter` | Commit current round | S8 | Same behavior as other views |
| `A` | Toggle auto-advance | S8 | When ON and not locked, eliminating one auto-fills AND switches active to the new photo |
| `Esc` | Back to StackFocus | S8 | Returns to grid view |
| `?` | Keyboard help overlay | S12 | |

---

## Session Finalist Shortcuts

Same as StackFocus but operating on the cross-stack finalist pool.
Keyboard behavior is identical to ensure seamless scope switching.

| Key | Action | Sprint | Notes |
|---|---|---|---|
| `Arrow keys` / `hjkl` | Navigate finalist grid | S10 | Same as StackFocus |
| `Enter` or `E` | Open finalist in SingleView | S10 | |
| `Y` | Keep finalist | S10 | Session-level decision |
| `X` | Eliminate finalist | S10 | |
| `U` | Undo last session decision | S10 | |
| `C` | Compare two finalists | S10 | Opens comparison view with session-scope photo pool |
| `Tab` | Next undecided finalist | S10 | |
| `A` | Toggle auto-advance | S10 | |
| `Ctrl+Enter` | Commit session round | S10 | |
| `Ctrl+Shift+Enter` | Finalize session | S10 | Locks the gem stack |
| `[` / `]` | Navigate session rounds | S10 | |
| `E` | Export finalists | S11 | Opens export dialog after session finalization |
| `T` | Tag management | S11 | Opens tag assignment panel |
| `Esc` | Back to StackOverview | S10 | |
| `?` | Keyboard help overlay | S12 | |

---

## Decision Flow Diagrams

### Single-Photo Decision (no auto-advance)

```
User focuses photo
      │
      ├── presses Y ──> decision = KEPT
      │                   │
      │                   ├── green border flash (200ms)
      │                   ├── persistent green edge
      │                   ├── status bar: "✓ KEPT"
      │                   ├── INSERT into decisions table
      │                   └── cursor stays on same photo
      │
      ├── presses X ──> decision = ELIMINATED
      │                   │
      │                   ├── red flash (200ms)
      │                   ├── dim to 50% + red edge
      │                   ├── status bar: "✗ ELIMINATED"
      │                   ├── INSERT into decisions table
      │                   └── cursor stays on same photo
      │
      └── presses Y or X on already-decided photo
                          │
                          └── overwrites decision (re-decidable before commit)
```

### Single-Photo Decision (auto-advance ON)

```
User focuses photo
      │
      ├── presses Y ──> decision = KEPT
      │                   │
      │                   ├── green flash (200ms)
      │                   ├── INSERT into decisions table
      │                   └── immediately advance to next undecided
      │                         │
      │                         ├── if more undecided exist: focus moves
      │                         └── if none remain: "Stack complete!" message
      │
      └── presses X ──> decision = ELIMINATED
                          │
                          ├── red flash (200ms)
                          ├── INSERT into decisions table
                          └── immediately advance to next undecided
```

### Comparison Decision Flow

```
Photo A (active) vs Photo B
      │
      ├── presses X on A ──> A eliminated
      │                        │
      │                        ├── if locked: A stays (dimmed), no auto-fill
      │                        │
      │                        └── if unlocked:
      │                              ├── A slot fills with next undecided
      │                              ├── if no undecided left: show completion
      │                              └── active side stays on A (new photo)
      │
      ├── presses Y on A ──> A kept
      │                        │
      │                        └── green badge on A; no auto-fill
      │                            (keeping does not remove from comparison)
      │
      └── presses Tab ──> switch active to B
                           │
                           └── blue border moves to B; Y/X now target B
```

---

## Keyboard Shortcut Quick Reference Table

Compact lookup table. Sorted by key.

| Key | Action | StackOverview | StackFocus | SingleView | Comparison | Finalists |
|---|---|---|---|---|---|---|
| `Arrow keys` | Navigate | Grid focus | Grid focus | Prev/Next photo | Replace active photo | Grid focus |
| `hjkl` | Vim navigate | Grid focus | Grid focus | Prev/Next photo | -- | Grid focus |
| `Enter` | Open / drill in | Open stack | Single view | -- | -- | Single view |
| `E` | Single view | -- | Single view | -- | -- | Single view |
| `Esc` | Go back | ProjectList | StackOverview | StackFocus | StackFocus | StackOverview |
| `Y` | Keep | -- | Keep focused | Keep current | Keep active | Keep focused |
| `X` | Eliminate | -- | Elim focused | Elim current | Elim active | Elim focused |
| `U` | Undo decision | -- | Undo last | Undo last | Undo last | Undo last |
| `C` | Compare view | -- | Open compare | Open compare | -- | Open compare |
| `Tab` | Next undecided | Next unfinished stack | Next undecided photo | Next undecided | Switch active side | Next undecided |
| `Shift+Tab` | Prev undecided | Prev unfinished | Prev undecided | Prev undecided | -- | Prev undecided |
| `A` | Auto-advance toggle | -- | Toggle | Toggle | Toggle | Toggle |
| `L` | Lock comparison | -- | -- | -- | Toggle lock | -- |
| `I` | Toggle info panel | -- | -- | Toggle EXIF | Toggle EXIF | -- |
| `R` | Restore / RAW toggle | Re-index | Restore photo | RAW toggle | -- | -- |
| `F` | Finalist view | Open finalists | -- | -- | -- | -- |
| `T` | Tag management | -- | -- | -- | -- | Open tags |
| `Space` | Quick preview | Preview stack | -- | -- | -- | -- |
| `/` | Search | Open search | -- | -- | -- | -- |
| `?` | Help overlay | Show help | Show help | Show help | Show help | Show help |
| `0` | Fit to screen | -- | -- | Zoom fit | -- | -- |
| `1` | 100% zoom | -- | -- | Zoom 100% | -- | -- |
| `+` / `=` | Zoom in | -- | -- | Zoom in | -- | -- |
| `-` | Zoom out | -- | -- | Zoom out | -- | -- |
| `Home` | First item | First stack | First photo | First photo | -- | First finalist |
| `End` | Last item | Last stack | Last photo | Last photo | -- | Last finalist |
| `[` | Previous round | -- | Prev round | Prev round | -- | Prev round |
| `]` | Next round | -- | Next round | Next round | -- | Next round |
| `Ctrl+B` | Burst config | Open panel | Open panel | Open panel | Open panel | Open panel |
| `Ctrl+Z` | Undo | -- | Undo last | Undo last | Undo last | Undo last |
| `Ctrl+Enter` | Commit round | -- | Commit | Commit | Commit | Commit |
| `Ctrl+Shift+Enter` | Finalize | -- | Finalize stack | -- | -- | Finalize session |

---

## Shortcut Conflicts & Resolutions

| Key | Potential conflict | Resolution |
|---|---|---|
| `R` | Re-index (StackOverview) vs RAW toggle (SingleView) vs Restore (StackFocus round history) | Context-dependent: each only available in its specific screen. No ambiguity because screens are mutually exclusive. |
| `I` | Start indexing (StackOverview) vs Info toggle (SingleView) | `i` starts indexing only when source folders exist and no stacks are present. In all other contexts, `I` toggles info. |
| `E` | Enter single view vs Export | `E` = single view in StackFocus/Finalists. Export uses `E` only in finalized Finalist view (different context). |
| `F` | Finalist view vs Filter | `F` = finalists from StackOverview. `/` opens the filter/search bar. No overlap. |
| `Tab` | Next undecided (most screens) vs Switch active side (Comparison) | In Comparison, Tab switches sides because "next undecided" is handled by auto-fill. Semantically consistent: Tab always means "move attention to the other thing." |
| `C` | Compare view vs Copy (in some apps) | GemKeep does not have a copy action during culling. No conflict. |

---

## Sprint Implementation Order

**Sprint 7 (Minimum Viable Culling):**
- Y, X (keep/eliminate in StackFocus + SingleView)
- Arrow keys + hjkl (SingleView navigation)
- Enter (StackFocus -> SingleView)
- Esc (SingleView -> StackFocus)
- Tab / Shift+Tab (jump to next/prev undecided)
- Home / End (first/last photo)
- I (toggle camera parameters)
- Ctrl+Enter (commit round)

**Sprint 8 (Comparison View & Stack Workflow):**
- C (enter comparison)
- Tab (switch active side in comparison)
- L (lock comparison)
- U (undo last decision)
- A (auto-advance toggle)
- Shift+Arrow (multi-select, replace in comparison)
- Tab / Shift+Tab in StackOverview (next/prev undecided stack)

**Sprint 9 (Multi-Round):**
- [ / ] (round navigation)
- R (restore eliminated photo)
- Ctrl+Shift+Enter (finalize stack)

**Sprint 10 (Session Scope):**
- F (finalist view from StackOverview)
- All StackFocus shortcuts replicated in Finalist view
- Ctrl+Shift+Enter (finalize session)

**Sprint 11 (Export & Labels):**
- T (tag management)
- E (export, in finalized context)

**Sprint 12 (Polish):**
- ? (help overlay)
- Space (quick preview)
- / (search/filter)
- 0, 1, +, - (zoom controls)
- R in SingleView (RAW toggle)
