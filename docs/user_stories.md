# GemKeep Photo Culling Tool -- User Stories

**Guiding principle:** Extremely simple, keyboard-first UX with powerful, traceable structure underneath. Handle RAW + JPEG pairs as one logical photo whenever possible.

**Target user:** Hobbyist photographer (not a professional speed-culler). The focus is on *analysis and learning*, not maximum throughput. The user wants to compare similar photos side by side, study camera parameters (aperture, shutter speed, ISO, focal length) to understand *why* one photo is better than another, and make deliberate decisions with the confidence that any decision can be revisited. The final output is a small "gem stack" — the best photos worth printing or sharing. Traceability and the ability to revert decisions are core, not just nice-to-have.

**Priority Key:**
- **P0 — Must Have:** Required to cull photos at all. Core loop.
- **P1 — Should Have:** Significantly improves real workflow. Needed for daily use.
- **P2 — Nice to Have:** Polish, convenience, advanced features.

**Status Key:**
- **[DONE]** — Fully implemented and tested
- **[PARTIAL]** — Started but incomplete
- **[NOT STARTED]** — No implementation yet

---

## 1. Project Management

────────────────────────────────────────────────────────────

- As a user, I want to create a new project with a display name. **[P0] [DONE]**
- As a user, I want the application to auto-suggest URL-safe project slug (lowercase, hyphens, no special chars) during creation. **[P0] [DONE]**
- As a user, I want the slug to be used for the project folder name and to be unique within my projects. **[P0] [DONE]**
- As a user, I want to attach one or more source folders to a project. **[P0] [DONE]**
- As a user, I want projects to be completely isolated (own database, cache, logs). **[P0] [DONE]**
- As a user, I want all screens, progress indicators, and background processes to be scoped to the active project. If I switch from Project A (mid-thumbnail-generation) to Project B and back, Project A's progress should resume exactly where it was. No global state — everything is per-project context. **[P0] [PARTIAL]**
- As a user, I want to list, open, and reopen existing projects. **[P0] [DONE]**
- As a user, I want the application to remember the last opened project. **[P1] [DONE]**

## 2. Photo Import & Indexing (with RAW+JPEG awareness)

────────────────────────────────────────────────────────────

- As a user, I want photos to be indexed once per project. **[P0] [DONE]**
- As a user, I want metadata (EXIF date, orientation, format, camera model) extracted automatically. **[P0] [DONE]**
- As a user, I want RAW + JPEG pairs (same capture time + matching base filename) to be detected and treated as **one logical photo** during import. **[P0] [DONE]**
- As a user, I want every logical photo (single file or RAW+JPEG pair) to belong to exactly one stack. **[P0] [DONE]**
- As a user, I want single-file photos (JPEG-only or RAW-only) treated identically to paired ones in the UI. **[P0] [DONE]**
- As a user, I want the system to gracefully skip corrupted / unreadable files with clear logging (without breaking pairs). **[P1] [DONE]**

## 3. Stack Auto-Generation & Management

────────────────────────────────────────────────────────────

- As a user, I want stacks auto-generated on import (time-proximity based). **[P0] [DONE]**
- As a user, I want to merge two or more stacks into one new stack from the Stack Overview screen, because burst-gap auto-stacking is not always accurate and I need manual control over what constitutes a stack. **[P0] [NOT STARTED]**
- As a user, I want restacking (changing burst gap) to preserve my manual merge decisions — if I merged stacks A and B, changing the burst gap must keep them merged. Manual merges are "sticky" and override auto-stacking. **[P0] [NOT STARTED]**
- As a user, I want to remove a photo (or pair) from a stack, creating a new stack of size 1 (or pair). **[P1] [NOT STARTED]**
- As a user, I want the last stack merge to be undoable (single-level undo). **[P1] [NOT STARTED]**
- As a user, I want all structural changes (merges, splits, restacks) to be recorded in a transaction log with timestamp and before/after state, similar to a git log, so I can review the history of how my stacks evolved. **[P0] [NOT STARTED]**

## 4. RAW + JPEG Pair Viewing & Switching

────────────────────────────────────────────────────────────

- As a user, I want to see **one representative thumbnail/preview per logical photo** in grids and overview (default: embedded JPEG or OOC JPEG). **[P0] [DONE]**
- As a user, I want a simple keyboard shortcut / toggle to switch between viewing the JPEG and the RAW preview in Single View mode (and optionally in multi-view). **[P1] [NOT STARTED]**
- As a user, I want decisions (keep / eliminate) to apply to the entire pair — one decision covers both files. **[P0] [NOT STARTED]**
- As a user, I want the system to prefer faster-loading JPEG for quick culling passes, with RAW decode only on explicit request or 100% zoom. **[P0] [DONE]**
- As a user, I want to see camera parameters (aperture, shutter speed, ISO, focal length, exposure compensation) displayed alongside each photo in Single View and comparison views, so I can learn what settings produce better results. **[P0] [NOT STARTED]**

## 5. Stack-Level Refinement (Micro Selection)

────────────────────────────────────────────────────────────

- As a user, I want to refine logical photos inside one stack using linear rounds. **[P0] [NOT STARTED]**
- As a user, I want only active (not eliminated) logical photos shown in the current round. **[P0] [NOT STARTED]**
- As a user, I want to keep / eliminate logical photos (pairs or singles) using only keyboard shortcuts. **[P0] [NOT STARTED]**
- As a user, I want to perform bulk keep / eliminate on multiple selected logical photos in multi-view. **[P1] [NOT STARTED]**
- As a user, I want instant visual feedback (color / icon / dimming) for keep / eliminate decisions. **[P0] [NOT STARTED]**
- As a user, I want auto-advance to the next undecided photo within the stack after a keep or eliminate decision (inspired by Lightroom P/X + Caps Lock pattern). **[P1] [NOT STARTED]**
- As a user, I want to toggle auto-advance on/off (e.g., Caps Lock or a visible toggle) so I can linger on a photo to zoom or check focus before deciding. Auto-advance OFF is the default (deliberate workflow). **[P1] [NOT STARTED]**

## 6. Comparison / Side-by-Side in Multi-View

────────────────────────────────────────────────────────────

- As a user, in Stack Focus multi-photo grid, I want to select / highlight two logical photos for side-by-side or 2-up comparison (e.g., larger preview, split view, or locked zoom/scroll). This is my primary decision-making view. **[P0] [NOT STARTED]**
- As a user, when I eliminate one of the compared photos, I want the grid / view to automatically fill the empty slot with the next undecided photo from the stack (maintaining comparison flow without manual reload). **[P0] [NOT STARTED]**
- As a user, I want to optionally lock / freeze the current comparison layout (prevent auto-advance until I manually proceed or unselect). **[P1] [NOT STARTED]**

## 7. Session-Level Refinement (Macro / Cross-Stack Selection)

────────────────────────────────────────────────────────────

- As a user, I want to switch to a session-wide view containing only stack finalists (logical photos). **[P0] [NOT STARTED]**
- As a user, I want to refine the global set of finalists using the exact same round engine and keyboard workflow. **[P0] [NOT STARTED]**
- As a user, I want some stacks to produce zero finalists and some to produce multiple. **[P0] [NOT STARTED]**
- As a user, I want session rounds to behave identically to stack rounds (snapshots, overrides, restoration). **[P0] [NOT STARTED]**

## 8. Rounds & Restoration Rules (Unified Engine)

────────────────────────────────────────────────────────────

- As a user, I want strictly linear rounds: Round 1 -> Round 2 -> Round 3 -> ... **[P0] [NOT STARTED]**
- As a user, I want each round to be an immutable snapshot of decisions at that point. **[P0] [NOT STARTED]**
- As a user, I want later rounds to override earlier decisions without changing history. **[P0] [NOT STARTED]**
- As a user, I want to "restore" an eliminated logical photo by creating a new keep decision in a later round, because I often reconsider after seeing other photos. **[P0] [NOT STARTED]**
- As a user, I want to freely navigate between rounds and see the exact state at the end of each round. **[P0] [NOT STARTED]**
- As a user, I want auto-save of the current round state on every decision or round switch. **[P0] [NOT STARTED]**
- As a user, I want to manually "commit" or "freeze" the current round state (for a stack or session) via a dedicated keyboard shortcut (e.g., Ctrl+Enter), rather than automatic commit on every action. Manual commit is the explicit moment when the round is sealed -- auto-save protects against crashes but does not finalize the round. **[P0] [NOT STARTED]**
- As a user, I want a clear "Start Next Round" or "Commit Round" action (non-modal) to advance based on current active photos after manual review. **[P0] [NOT STARTED]**
- As a user, when finalizing the last round in a stack or session, I want an explicit action / confirmation to mark it as "done" / "finalized" (locking finalists until I choose to restore or reopen). **[P1] [NOT STARTED]**

## 9. User Interface & Interaction Consistency

────────────────────────────────────────────────────────────

- As a user, I want three modes: Stack Overview (grid), Stack Focus (multi-photo grid), Single View (full-screen). **[P0] [PARTIAL]**
- As a user, I want seamless switching between stack scope and session scope without changing keyboard behavior. **[P0] [NOT STARTED]**
- As a user, I want instant navigation (no perceptible delay) between stacks, photos, and rounds. **[P0] [PARTIAL]**
- As a user, I want no modal dialogs during photo review / culling. **[P0] [DONE]**
- As a user, I want mouse fallback / click support for every important keyboard action (some people prefer mouse). **[P1] [PARTIAL]**
- As a user, I want a keyboard shortcut help overlay (e.g., `?` key) that shows all available shortcuts for the current mode, so shortcuts are discoverable without memorization. **[P1] [NOT STARTED]**
- As a user, I want a status bar or progress indicator showing my current position within a stack or session (e.g., "Photo 3 of 12 | 2 kept, 1 eliminated, 9 undecided"). **[P1] [NOT STARTED]**

## 10. Single View Controls (Zoom & Pan)

────────────────────────────────────────────────────────────

- As a user, I want to zoom in/out in Single View using mouse wheel (with optional Ctrl / Cmd modifier) and keyboard shortcuts (e.g. + / - or = / - keys). **[P1] [NOT STARTED]**
- As a user, I want zoom to center on the current mouse cursor position when using mouse wheel. **[P2] [NOT STARTED]**
- As a user, I want to pan / drag around the zoomed image using mouse drag (click + hold + move) or keyboard arrows / WASD / hjkl. **[P1] [NOT STARTED]**
- As a user, I want faster panning while holding Shift (or similar modifier) with keyboard. **[P2] [NOT STARTED]**
- As a user, I want quick toggles: 100% actual size (e.g. 1 key), fit-to-screen / reset zoom (e.g. 0 or double-click or Space). **[P1] [NOT STARTED]**
- As a user, I want zoom level and pan position to reset sensibly (or optionally persist) when navigating to the next/previous photo. **[P2] [NOT STARTED]**

## 11. Filtering & Quick Navigation (with Fuzzy Search)

────────────────────────────────────────────────────────────

- As a user, I want simple filters in Stack Overview mode (date range, stack size, has-finalist / no-finalist, contains-RAW, contains-JPEG). **[P1] [NOT STARTED]**
- As a user, I want fuzzy search across filenames, capture dates (partial strings), and basic metadata (camera model, lens) to quickly jump to stacks or photos. **[P2] [NOT STARTED]**
- As a user, I want to jump to next / previous undecided stack or logical photo via keyboard. **[P0] [NOT STARTED]**

## 12. Export & Final Output

────────────────────────────────────────────────────────────

- As a user, I want to export all current finalists (from session scope) to a new folder (copy or hard-link). **[P0] [NOT STARTED]**
- As a user, I want export to handle pairs correctly: export both RAW + JPEG when the logical photo is selected (or offer JPEG-only / RAW-only options). **[P0] [NOT STARTED]**
- As a user, I want to export a simple text/JSON list of finalist file paths (including both files of pairs). **[P1] [NOT STARTED]**
- As a user, I want export to preserve original filenames and folder structure (optional flattening). **[P1] [NOT STARTED]**
- As a user, I want export to be non-destructive (originals untouched). **[P0] [NOT STARTED]**

## 13. Performance Expectations

────────────────────────────────────────────────────────────

- As a user, I want thumbnails to appear instantly (pre-cached, prefer JPEG/embedded for speed). **[P0] [DONE]**
- As a user, I want smooth scrolling and zero blocking during background thumbnail generation. **[P0] [DONE]**
- As a user, I want full-resolution (especially RAW) images loaded only when zooming to 100% or explicitly switching to RAW view. **[P1] [NOT STARTED]**
- As a user, I want the application to remain responsive while processing thousands of photos (pairs). **[P0] [DONE]**

## 14. Traceability, Logging & Crash Resilience

────────────────────────────────────────────────────────────

- As a user, I want structural changes, pair detections, and round decisions to survive application crashes. **[P0] [PARTIAL]**
- As a user, I want a readable operation log inside the project folder (merges, restores, round starts, pair groupings). **[P2] [NOT STARTED]**
- As a user, I want clear error messages when files cannot be read / thumbnails cannot be generated / pairs mismatch. **[P1] [DONE]**

## 15. Future / Low Priority

────────────────────────────────────────────────────────────

- Smarter auto-grouping (ML, perceptual hash, location). **[P2] [NOT STARTED]**
- Visual timeline of selection evolution across rounds. **[P2] [NOT STARTED]**
- Basic focus/blur/sharpness auto-tagging to assist early rounds. **[P2] [NOT STARTED]**
- Google Photos / cloud sync. **[P2] [NOT STARTED]**
- High-contrast mode / enhanced accessibility features. **[P2] [NOT STARTED]**

## 16. Photo Labeling & Tags

────────────────────────────────────────────────────────────

- As a user, I want to create custom text tags (e.g., "print", "family album", "portfolio") for organizing finalists beyond keep/eliminate. **[P1] [NOT STARTED]**
- As a user, I want to assign one or more tags to a logical photo after culling (tags are a secondary labeling step applied to finalists, not a replacement for keep/eliminate). **[P1] [NOT STARTED]**
- As a user, I want tags to be per-project (each project has its own tag set, independent of other projects). **[P1] [NOT STARTED]**
- As a user, I want to manage tags: create, rename, delete, and assign a color for visual distinction in grids and lists. **[P1] [NOT STARTED]**
- As a user, I want to filter finalists by tag in export and session views (e.g., export only "portfolio" tagged photos, or view only "print" candidates). **[P1] [NOT STARTED]**

## 17. Auto-Advance & Decision Flow

────────────────────────────────────────────────────────────

*Competitive insight: Every major culling tool (Photo Mechanic, Lightroom, Capture One) implements auto-advance. It halves total keystrokes. For 5000 photos, that is 5000 fewer keypresses.*

- As a user, I want an option to auto-advance to the next undecided photo after any keep/eliminate decision. Default is OFF (deliberate workflow) but can be toggled on for speed passes. **[P1] [NOT STARTED]**
- As a user, I want auto-advance to also work at the stack level: after all photos in a stack are decided, auto-advance to the next undecided stack in Stack Overview. **[P1] [NOT STARTED]**
- As a user, I want a visible toggle (and/or Caps Lock convention) to switch auto-advance on/off, so I can switch between deliberate study and fast passes. **[P1] [NOT STARTED]**

## 18. Visual Stack Progress

────────────────────────────────────────────────────────────

*Competitive insight: Lightroom and Capture One show progress overlays on thumbnails. Photographers need at-a-glance status without counting manually.*

- As a user, I want to see a progress summary on each stack card in Stack Overview (e.g., "3/12 decided, 2 kept, 1 eliminated") so I know which stacks still need attention. **[P1] [NOT STARTED]**
- As a user, I want to see an overall session progress indicator (e.g., "142/387 stacks complete, 245 remaining") so I know how much culling work remains. **[P1] [NOT STARTED]**
- As a user, I want stack cards to visually distinguish their state: untouched (no decisions), in-progress (some decisions), complete (all decided or finalized). **[P1] [NOT STARTED]**

## 19. Quick Preview in Stack Overview

────────────────────────────────────────────────────────────

- As a user, I want to press a key (e.g., Spacebar) in Stack Overview to see a larger preview of the focused stack's representative thumbnail without entering Stack Focus, so I can quickly triage stacks before committing to enter them. **[P2] [NOT STARTED]**
- As a user, I want the quick preview to dismiss on any key press or click, returning focus to the stack grid. **[P2] [NOT STARTED]**

## 20. First-Use Onboarding

────────────────────────────────────────────────────────────

*Competitive insight: Photo Mechanic and Capture One have steep learning curves. A brief onboarding reduces time-to-first-cull.*

- As a user, when I open the application for the first time (no projects exist), I want a brief, non-modal onboarding hint that explains the workflow: create project, add folders, enter stacks, cull with keyboard. **[P2] [NOT STARTED]**
- As a user, I want the onboarding to be dismissible and never shown again after the first project is created. **[P2] [NOT STARTED]**
- As a user, I want a "What's next?" prompt after import finishes (e.g., "Your photos are ready. Enter a stack to start culling.") so I am not staring at a grid wondering what to do. **[P1] [NOT STARTED]**
