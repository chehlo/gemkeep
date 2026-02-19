# GemKeep Photo Culling Tool -- User Stories

**Guiding principle:** Extremely simple, fast, keyboard-first UX with powerful, traceable structure underneath. Handle RAW + JPEG pairs as one logical photo whenever possible.

## 1. Project Management

────────────────────────────────────────────────────────────

- As a user, I want to create a new project with a display name.
- As a user, I want the application to auto-suggest URL-safe project slug (lowercase, hyphens, no special chars) during creation.
- As a user, I want the slug to be used for the project folder name and to be unique within my projects.
- As a user, I want to attach one or more source folders to a project.
- As a user, I want projects to be completely isolated (own database, cache, logs).
- As a user, I want to list, open, and reopen existing projects.
- As a user, I want the application to remember the last opened project.

## 2. Photo Import & Indexing (with RAW+JPEG awareness)

────────────────────────────────────────────────────────────

- As a user, I want photos to be indexed once per project.
- As a user, I want metadata (EXIF date, orientation, format, camera model) extracted automatically.
- As a user, I want RAW + JPEG pairs (same capture time + matching base filename) to be detected and treated as **one logical photo** during import.
- As a user, I want every logical photo (single file or RAW+JPEG pair) to belong to exactly one stack.
- As a user, I want single-file photos (JPEG-only or RAW-only) treated identically to paired ones in the UI.
- As a user, I want the system to gracefully skip corrupted / unreadable files with clear logging (without breaking pairs).

## 3. Stack Auto-Generation & Management

────────────────────────────────────────────────────────────

- As a user, I want stacks auto-generated on import (time-proximity based).
- As a user, I want to merge two or more stacks into one new stack.
- As a user, I want to remove a photo (or pair) from a stack → creates new stack of size 1 (or pair).
- As a user, I want the last stack merge to be undoable (single-level undo).
- As a user, I want all structural changes (merges, splits) to be recorded with timestamp and before/after state.

## 4. RAW + JPEG Pair Viewing & Switching

────────────────────────────────────────────────────────────

- As a user, I want to see **one representative thumbnail/preview per logical photo** in grids and overview (default: embedded JPEG or OOC JPEG).
- As a user, I want a simple keyboard shortcut / toggle to switch between viewing the JPEG and the RAW preview in Single View mode (and optionally in multi-view).
- As a user, I want decisions (keep / eliminate) to apply to the entire pair — one decision covers both files.
- As a user, I want the system to prefer faster-loading JPEG for quick culling passes, with RAW decode only on explicit request or 100% zoom.

## 5. Stack-Level Refinement (Micro Selection)

────────────────────────────────────────────────────────────

- As a user, I want to refine logical photos inside one stack using linear rounds.
- As a user, I want only active (not eliminated) logical photos shown in the current round.
- As a user, I want to keep / eliminate logical photos (pairs or singles) using only keyboard shortcuts.
- As a user, I want to perform bulk keep / eliminate on multiple selected logical photos in multi-view.
- As a user, I want instant visual feedback (color / icon / dimming) for keep / eliminate decisions.

## 6 Comparison / Side-by-Side in Multi-View

- As a user, in Stack Focus multi-photo grid, I want to select / highlight two logical photos for side-by-side or 2-up comparison (e.g., larger preview, split view, or locked zoom/scroll).
- As a user, when I eliminate one of the compared photos, I want the grid / view to automatically fill the empty slot with the next undecided photo from the stack (maintaining comparison flow without manual reload).
- As a user, I want to optionally lock / freeze the current comparison layout (prevent auto-advance until I manually proceed or unselect).

## 7. Session-Level Refinement (Macro / Cross-Stack Selection)

────────────────────────────────────────────────────────────

- As a user, I want to switch to a session-wide view containing only stack finalists (logical photos).
- As a user, I want to refine the global set of finalists using the exact same round engine and keyboard workflow.
- As a user, I want some stacks to produce zero finalists and some to produce multiple.
- As a user, I want session rounds to behave identically to stack rounds (snapshots, overrides, restoration).

## 8. Rounds & Restoration Rules (Unified Engine)

────────────────────────────────────────────────────────────

- As a user, I want strictly linear rounds: Round 1 → Round 2 → Round 3 → …
- As a user, I want each round to be an immutable snapshot of decisions at that point.
- As a user, I want later rounds to override earlier decisions without changing history.
- As a user, I want to “restore” an eliminated logical photo by creating a new keep decision in a later round.
- As a user, I want to freely navigate between rounds and see the exact state at the end of each round.
- As a user, I want auto-save of the current round state on every decision or round switch.
- As a user, I want to manually “commit” or “freeze” the current round state (for a stack or session) via a dedicated keyboard shortcut (e.g., Enter / Ctrl+Enter / dedicated key), rather than automatic commit on every action.
- As a user, I want a clear “Start Next Round” or “Commit Round” action (non-modal) to advance based on current active photos after manual review.
- As a user, when finalizing the last round in a stack or session, I want an explicit action / confirmation to mark it as “done” / “finalized” (locking finalists until I choose to restore or reopen).

## 9. User Interface & Interaction Consistency

────────────────────────────────────────────────────────────

- As a user, I want three modes: Stack Overview (grid), Stack Focus (multi-photo grid), Single View (full-screen).
- As a user, I want seamless switching between stack scope and session scope without changing keyboard behavior.
- As a user, I want instant navigation (no perceptible delay) between stacks, photos, and rounds.
- As a user, I want no modal dialogs during photo review / culling.
- As a user, I want mouse fallback / click support for every important keyboard action (some people prefer mouse).

## 10 Single View Controls (Zoom & Pan)

- As a user, I want to zoom in/out in Single View using mouse wheel (with optional Ctrl / Cmd modifier) and keyboard shortcuts (e.g. + / - or = / - keys).
- As a user, I want zoom to center on the current mouse cursor position when using mouse wheel.
- As a user, I want to pan / drag around the zoomed image using mouse drag (click + hold + move) or keyboard arrows / WASD / hjkl.
- As a user, I want faster panning while holding Shift (or similar modifier) with keyboard.
- As a user, I want quick toggles: 100% actual size (e.g. 1 key), fit-to-screen / reset zoom (e.g. 0 or double-click or Space).
- As a user, I want zoom level and pan position to reset sensibly (or optionally persist) when navigating to the next/previous photo.

## 11. Filtering & Quick Navigation (with Fuzzy Search)

────────────────────────────────────────────────────────────

- As a user, I want simple filters in Stack Overview mode (date range, stack size, has-finalist / no-finalist, contains-RAW, contains-JPEG).
- As a user, I want fuzzy search across filenames, capture dates (partial strings), and basic metadata (camera model, lens) to quickly jump to stacks or photos.
- As a user, I want to jump to next / previous undecided stack or logical photo via keyboard.

## 12. Export & Final Output

────────────────────────────────────────────────────────────

- As a user, I want to export all current finalists (from session scope) to a new folder (copy or hard-link).
- As a user, I want export to handle pairs correctly: export both RAW + JPEG when the logical photo is selected (or offer JPEG-only / RAW-only options).
- As a user, I want to export a simple text/JSON list of finalist file paths (including both files of pairs).
- As a user, I want export to preserve original filenames and folder structure (optional flattening).
- As a user, I want export to be non-destructive (originals untouched).

## 13. Performance Expectations

────────────────────────────────────────────────────────────

- As a user, I want thumbnails to appear instantly (pre-cached, prefer JPEG/embedded for speed).
- As a user, I want smooth scrolling and zero blocking during background thumbnail generation.
- As a user, I want full-resolution (especially RAW) images loaded only when zooming to 100% or explicitly switching to RAW view.
- As a user, I want the application to remain responsive while processing thousands of photos (pairs).

## 14. Traceability, Logging & Crash Resilience

────────────────────────────────────────────────────────────

- As a user, I want structural changes, pair detections, and round decisions to survive application crashes.
- As a user, I want a readable operation log inside the project folder (merges, restores, round starts, pair groupings).
- As a user, I want clear error messages when files cannot be read / thumbnails cannot be generated / pairs mismatch.

## 15. Future / Low Priority

────────────────────────────────────────────────────────────

- Smarter auto-grouping (ML, perceptual hash, location)
- Visual timeline of selection evolution across rounds
- Basic focus/blur/sharpness auto-tagging to assist early rounds
- Google Photos / cloud sync
- High-contrast mode / enhanced accessibility features
