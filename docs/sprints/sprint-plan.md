# GemKeep Sprint Plan

## Overview
Starting from a blank Tauri 2.x + Svelte 5 + Rust project. All business logic lives in Rust; frontend is thin display + input layer. Each sprint delivers a vertically complete, testable slice and references the user stories it covers. Sprints build strictly on prior ones.

**Target user:** Hobbyist photographer focused on analysis and learning. Side-by-side comparison is the primary decision-making view. Camera parameters (aperture, shutter, ISO, focal length) are core to the experience. Traceability and the ability to revert decisions are non-negotiable. The final output is a small "gem stack" of the best photos worth printing or sharing.

---

## Sprint 1 — Skeleton: Full Stack Wired, No Functionality ✅ Done
Prove all architectural layers compile, communicate, and navigate. No business logic. Every screen exists as an empty shell. One real Tauri IPC round-trip works. Full DB schema defined and migrations run cleanly.

See `sprint-01.md` for detailed design.

---

## Sprint 2 — Project Management ✅ Done
**User Stories:** §1 (all)

Create, open, and list projects. Each project is fully isolated on disk with its own DB, cache directory, and log file. Slug generation (lowercase, hyphens, URL-safe, unique). Remember last opened project. Navigate into (empty) Stack Overview on open.

---

## Sprint 3 — Photo Import, Pair Detection & Stack Generation ✅ Done
**User Stories:** §2 (all), §3 (auto-generation only)

Recursive folder scan. EXIF metadata extraction (capture time, orientation, camera model, lens). RAW+JPEG pair detection by matching base filename. Stack auto-generation by time-proximity burst detection (configurable gap, default 3s). Graceful skipping of corrupt/unreadable files with logging. Returns `ImportStats`.

---

## Sprint 4 — Thumbnail Pipeline & Caching ✅ Done
**User Stories:** §4 (representative thumbnail per logical photo), §13 (thumbnails instant, smooth scroll)

Background thumbnail generation via `rayon`. Priority: embedded JPEG → sidecar JPEG → full JPEG decode → RAW embedded JPEG (never full RAW decode for thumbnails). Disk cache per project. In-memory LRU (200–500 MB). Tauri `thumbnail-ready` events for progressive grid updates.

---

## Sprint 5 — Stack Overview UI & Navigation ✅ Done
**User Stories:** §9 (Stack Overview mode), §13 (smooth scrolling, responsive during processing)

Keyboard-navigable stack grid. Arrow-key navigation + Enter to Stack Focus. Stack card thumbnails via asset protocol. Progress bar during indexing. Pause/resume/cancel controls. Initial loading state. Scroll restore on return from Stack Focus.

---

## Sprint 6 — Burst Threshold Config & Thumbnail Resume ✅ Done
**User Stories:** §3 (burst gap configuration), §13 (thumbnail progress + resume)

Configurable burst gap threshold UI (Ctrl+B panel). Thumbnail progress display with resume on re-open. SQL COUNT fix for stack listing performance. Per-stack thumbnail selection bugs fixed.

---

## Sprint 7 — Minimum Viable Culling + Stack Management
**User Stories:** §3.2 (manual stack merge), §3.3 (restack preserves manual merges), §3.6 (merge transaction log), §4.5 (camera parameters display), §4.3 (pair decisions apply to both files), §5.1–5.3 (keep/eliminate with keyboard, visual feedback), §8.6 (auto-save on every decision), §8.7 (manual commit via Ctrl+Enter), §9.1 (Single View mode)

**Goal:** The user can manually merge stacks (because burst-gap auto-stacking is not always accurate), view photos full-screen with camera parameters, and make keep/eliminate decisions with the keyboard. This is the first sprint where both stack management AND culling are possible.

### Architecture principle: Modularity
All code in this sprint must be designed for future extension without rewriting:
- Decision engine as a standalone Rust module (not coupled to UI or specific views)
- Stack operations (merge, split, restack) as composable repository functions
- Transaction log as a generic audit system usable by any future structural operation
- Frontend components accept data via props, not hardcoded to specific views

### What gets built

#### Stack Management (pre-culling workflow)
- **Manual stack merge:** In Stack Overview, select 2+ stacks (Shift+Arrow or Shift+Click) and press `M` to merge into one stack. All logical_photos from source stacks move to a new combined stack. Source stacks are deleted.
- **Merge-aware restacking:** When the user changes burst gap (Ctrl+B → restack), manual merges are preserved. Implementation: a `merge_group` column or a `manual_merges` table tracks which logical_photos were manually grouped. Restack applies burst-gap to un-merged photos only, then re-applies manual merge groupings on top.
- **Stack transaction log:** Every structural change (merge, split, restack, import) is recorded in a `stack_transactions` table: `id, project_id, action (merge|split|restack|import), before_state (JSON), after_state (JSON), timestamp`. Viewable via a future "stack history" panel (like git log). DB schema addition.
- **Undo last merge:** `Ctrl+Z` in Stack Overview undoes the most recent merge (restores original stacks). Single-level only.

#### Culling (core workflow)
- **Single View mode:** Full-screen photo display (embedded JPEG for speed, not full RAW decode). Enter from Stack Focus thumbnail grid, Esc to return. Arrow keys to navigate between photos within a stack.
- **Camera parameters overlay:** Aperture (f/2.8), shutter speed (1/250), ISO (400), focal length (85mm), exposure compensation (+0.7) displayed alongside the photo. Data already exists in EXIF metadata extracted during Sprint 3. This is P0 because the hobbyist user learns from these parameters.
- **Keep/Eliminate decisions:** `Y` = keep, `X` = eliminate. Decisions apply to the entire logical photo (both RAW+JPEG if paired). Each decision is an INSERT into a `decisions` audit log table (photo_id, round, decision, timestamp). Never UPDATE — append-only for traceability.
- **Visual feedback:** Green border/badge for kept photos, red dimming + strikethrough for eliminated. Visible at both Single View and Stack Focus grid thumbnail size. Bold and obvious (competitive analysis §2.4).
- **Round 1 basics:** All photos start as "undecided" in Round 1. Only manual Round 1 — no multi-round yet. `current_status` view/query derives live state from the decisions log.
- **Crash-safe auto-save:** Every decision is immediately written to SQLite (WAL mode). App crash loses zero decisions.
- **Manual commit:** `Ctrl+Enter` freezes (seals) the current round. After commit, decisions in that round are immutable. No automatic commit — the user decides when the round is "done."
- **Stack Focus integration:** The existing Stack Focus multi-photo grid now shows keep/eliminate badges on thumbnails. Decisions can be made from either Single View or Stack Focus (same keyboard shortcuts).

### After this sprint
"I can import photos, adjust stacks by merging similar bursts that the auto-stacker missed, then open a stack, view each photo full-screen with its camera settings displayed, mark photos as keep or eliminate with Y/X, see my decisions reflected visually, and commit my round when I am done. If I change the burst gap, my manual merges are preserved. If the app crashes, no decisions are lost. Every stack operation is recorded in a transaction log."

### Deferred from this sprint
- **Comparison/side-by-side view** → Sprint 8 (requires Single View and decision engine to exist first)
- **Auto-advance after decision** → Sprint 8 (user wants deliberate workflow; auto-advance is P1)
- **Multi-round** → Sprint 9 (Round 1 is sufficient for first use)
- **Stack split (remove photo from stack)** → Sprint 8 (merge is the priority; split is less common)
- **Stack history viewer UI** → Sprint 12 (transaction log exists in DB; UI to browse it is polish)
- **Zoom/pan** → Sprint 12 (embedded JPEG at screen resolution is sufficient for initial culling)
- **RAW toggle** → Sprint 12 (JPEG preview is the fast default; RAW on demand is polish)

### "Good enough" definition
- Single View fills the window with the photo. No fancy transitions or animations needed.
- Camera parameters displayed in a semi-transparent overlay panel (top or bottom edge). Monospace or tabular layout so numbers align. Not styled — just readable.
- Visual feedback uses CSS borders/overlays, not custom artwork. Green = kept, red/dim = eliminated, no border = undecided.
- Stack Focus grid thumbnails show a small colored dot or border to indicate decision state.
- Stack merge selection uses Shift+Arrow highlighting in Stack Overview. Not drag-and-drop.
- Undo merge is Ctrl+Z for the last merge only. No multi-level undo history.

### Success criteria
1. User can select 2+ stacks in Stack Overview and press M to merge them
2. Merged stacks combine all logical_photos into one stack; source stacks disappear
3. Changing burst gap (Ctrl+B → restack) preserves manual merges
4. Ctrl+Z undoes the last merge (stacks restored to pre-merge state)
5. Every merge/restack is recorded in the stack_transactions table with before/after state
6. User can enter Single View from Stack Focus and navigate between photos with Left/Right arrows
7. Camera parameters (aperture, shutter, ISO, focal length) are visible for every photo that has EXIF data
8. Pressing Y marks a photo as "keep" with immediate green visual feedback
9. Pressing X marks a photo as "eliminate" with immediate red/dim visual feedback
10. Pressing Y or X on an already-decided photo changes the decision (re-decidable before commit)
11. Ctrl+Enter commits the round; after commit, Y/X on committed photos has no effect
12. Killing the app process mid-session and restarting preserves all decisions made before the kill
13. Decisions on a RAW+JPEG pair apply to both files (verified by checking the logical_photo record)
14. `cargo test` passes: merge, merge-aware restack, undo merge, transaction log, decision insert, current_status derivation, commit immutability, crash recovery

---

## Sprint 8 — Comparison View & Stack Workflow
**User Stories:** §6 (all: side-by-side comparison, auto-fill, lock), §5.6 (auto-advance toggle), §9.5 (status bar / progress indicator), §18 (visual stack progress)

**Goal:** The user can compare two photos side by side — their primary decision-making view — and work through a stack systematically with progress feedback.

### What gets built
- **Side-by-side comparison view:** Select two photos in Stack Focus (e.g., Shift+Arrow or click two thumbnails) and press `C` to enter comparison mode. Two photos displayed at equal size with camera parameters visible for both. The user studies the pair, then presses X on the weaker photo to eliminate it. This is the PRIMARY decision-making view for the hobbyist user — it is where learning happens ("why is this photo better than that one?").
- **Auto-fill on eliminate:** When one compared photo is eliminated, the empty slot automatically fills with the next undecided photo from the stack. Comparison flow continues without manual reload (§6.2). If no undecided photos remain, comparison mode exits gracefully.
- **Lock comparison layout:** Press `L` to lock the current pair. Auto-fill is suppressed until the user manually proceeds or unlocks. This lets the user linger and study (§6.3).
- **Undo last decision:** `Ctrl+Z` or `U` undoes the most recent decision within the current round (pops the last entry from the decisions log for the current round, before commit). Single-level undo only.
- **Stack decision progress indicator:** In Stack Focus, a bar or counter shows "5/12 decided | 3 kept | 2 eliminated | 7 undecided." Updates live as decisions are made.
- **Stack completion detection:** When all photos in a stack are decided, show a "Stack complete" indicator. Prompt (non-modal) to advance to the next undecided stack.
- **Advance to next stack:** After completing a stack, Down arrow or a "Next stack" shortcut moves to the next undecided stack in Stack Overview order.
- **Auto-advance toggle:** Caps Lock (or a visible toggle button) enables auto-advance — after Y/X, focus moves to the next undecided photo automatically. Default is OFF (deliberate workflow). When ON, a visible indicator shows "Auto-advance: ON."
- **Stack Overview progress badges:** Each stack card in Stack Overview shows a visual state: untouched (no badge), in-progress (partial fill or yellow dot), complete (green checkmark or full bar). Compact summary like "3/12" on the card.

### After this sprint
"I can compare two similar photos side by side, see their camera settings, eliminate the weaker one, and the next undecided photo automatically fills in. I can see my progress through each stack and the overall session. I can undo a mistake. When a stack is done, I move to the next one."

### Deferred from this sprint
- **Multi-round** → Sprint 9 (one round of keep/eliminate is the immediate need)
- **Restore eliminated photos** → Sprint 9 (requires multi-round engine)
- **Session-wide finalist view** → Sprint 10 (requires all stacks to have finalists first)
- **Bulk keep/eliminate on multi-select** → Sprint 12 (edge case for hobbyist workflow)
- **Synchronized zoom/pan in comparison** → Sprint 12 (useful but not core to decision-making)

### "Good enough" definition
- Comparison view splits the window 50/50. Photos are fit-to-half-width. No synchronized zoom yet.
- Camera parameters shown below or overlaid on each photo in comparison. Same data as Single View.
- Progress indicator is a simple text counter ("5/12 decided"). A progress bar is nice but not required.
- Stack Overview badges can be colored dots or small text labels. Not pixel-perfect.
- Undo only covers the last single decision. No multi-step undo history.

### Success criteria
1. User can select two photos and press C to enter comparison mode
2. Both photos display with camera parameters visible for each
3. Pressing X on a compared photo eliminates it and auto-fills the slot with the next undecided photo
4. Pressing L locks the comparison layout; auto-fill is suppressed until unlock
5. Ctrl+Z or U undoes the last decision (photo returns to undecided state)
6. Stack Focus shows a live progress counter that updates on every decision
7. When all photos in a stack are decided, a completion indicator appears
8. Stack Overview cards show visual state (untouched / in-progress / complete)
9. Auto-advance toggle works: OFF by default, ON shows indicator, Y/X advances to next undecided
10. `cargo test` passes: comparison state management, auto-fill logic, undo, progress counting

---

## Sprint 9 — Multi-Round Engine & Restoration
**User Stories:** §8 (all: multi-round, immutable snapshots, overrides, restoration, round navigation, commit/finalize), §5.1 (show only active photos in current round), §14.1 (crash resilience for round decisions)

**Goal:** The user can do multiple refinement passes on a stack and reconsider earlier decisions. Round history is immutable and navigable.

### What gets built
- **Multi-round progression:** After committing Round 1 (Ctrl+Enter), the user can start Round 2. Round 2 shows only the photos that survived Round 1 (kept or undecided — eliminated photos are hidden). Round 3 shows only Round 2 survivors. And so on.
- **Immutable round snapshots:** Each committed round is a frozen snapshot. Navigating to a past round shows the exact decisions at that point in time. Past rounds are read-only — no editing.
- **Decision overrides in later rounds:** A photo kept in Round 1 can be eliminated in Round 2. The Round 2 decision overrides Round 1 without changing Round 1's snapshot. The decisions log is append-only — `current_status` is derived from the latest entry per photo.
- **Restoration:** An eliminated photo can be restored in a later round by creating a new "keep" decision for it. Use case: "I eliminated this in Round 1, but after seeing Round 2 survivors, I realize it was actually the best one." Explicit action (e.g., press `R` on a grayed-out photo in the round history view) to restore.
- **Round navigation:** Press `[` and `]` (or a round selector UI) to navigate between rounds. Each round shows the state as it was at commit time. Current (uncommitted) round is the editable one.
- **Round commit/finalize:** Ctrl+Enter commits the current round (same as Sprint 7, now extended to any round). After committing the final round (when only 1-2 photos remain, or the user explicitly finalizes), the stack is marked "finalized" — its finalist(s) are locked until the user chooses to reopen.
- **Finalize action:** A "Finalize stack" action (e.g., `Ctrl+Shift+Enter`) marks the stack as done. Shows a non-modal confirmation. Finalized stacks show a distinct visual state in Stack Overview.
- **Auto-save remains:** Every decision in every round is immediately persisted. Crash recovery restores the exact uncommitted state.

### After this sprint
"I can do Round 1 to make quick keep/eliminate decisions, then start Round 2 to narrow my keepers further. If I change my mind, I can restore an eliminated photo in a later round. I can look back at any past round to see what I decided. Each stack produces one or more finalists through progressive refinement."

### Deferred from this sprint
- **Session-wide finalist view** → Sprint 10 (stacks must produce finalists first; this sprint establishes the mechanism)
- **Cross-stack refinement** → Sprint 10 (requires session scope)
- **Structural changes audit log** → Sprint 12 (readable log is P2)
- **Visual timeline of selection evolution** → Future/P2

### "Good enough" definition
- Round navigation uses a simple numbered tab bar or bracket-key cycling. Not a timeline visualization.
- Restoration works via a keyboard shortcut on a visible (but dimmed) eliminated photo in the round history, or via a "show eliminated" toggle. Not drag-and-drop.
- Finalize confirmation is a non-modal inline message ("Stack finalized. 2 finalists."), not a dialog box.
- Round snapshots are derived from the decisions log via SQL queries — no separate snapshot tables needed.

### Success criteria
1. After committing Round 1, user can start Round 2 which shows only Round 1 survivors
2. Navigating to Round 1 shows the original decisions (read-only)
3. A photo kept in Round 1 can be eliminated in Round 2 without altering Round 1's snapshot
4. An eliminated photo can be restored in a later round via explicit action
5. Ctrl+Enter commits any round; committed rounds become read-only
6. Ctrl+Shift+Enter finalizes the stack; finalized stacks show distinct visual state in Stack Overview
7. Crash during Round 2 preserves all Round 2 decisions on restart
8. `current_status` correctly derives from the latest decision across all rounds
9. `cargo test` passes: multi-round progression, override logic, restoration, snapshot immutability, finalize state

---

## Sprint 10 — Session Scope & Finalists
**User Stories:** §7 (all: session-wide finalist view, cross-stack refinement, zero/multiple finalists), §9.2 (seamless scope switching), §18.2 (overall session progress indicator)

**Goal:** The user can see all their stack winners together in one view and do a final cross-stack refinement pass to select the absolute best photos from the entire shoot.

### What gets built
- **Session-wide finalist view:** A new view (accessible from Stack Overview, e.g., press `F` for "Finalists") that shows all finalists from all finalized stacks in a single grid. Photos are grouped by source stack but displayed together. This is the "gem stack" — the collection of best photos across the entire session.
- **Cross-stack refinement:** The same round engine used within stacks now operates across all finalists. The user can run Round 1 of session refinement to further narrow from (e.g.) 200 stack finalists to 50 session finalists. Same Y/X decisions, same comparison view, same commit/finalize flow.
- **Zero and multiple finalists:** Some stacks may produce zero finalists (entire burst was bad) and some may produce multiple (several distinct good shots in one burst). The session finalist view handles both correctly.
- **Global progress indicators:** Session-level stats: "142/387 stacks finalized, 245 remaining" in Stack Overview. Finalist count: "238 finalists from 387 stacks" in the finalist view.
- **Seamless scope switching:** The user can switch between stack scope and session scope without changing keyboard behavior. Y/X/C/arrow keys work identically in both scopes. The only difference is the pool of photos being refined.
- **Session finalize:** After session-level refinement, a "Finalize session" action locks the final gem stack. This is the last step before export.

### After this sprint
"I can see all my stack winners in one place, do a final refinement pass across the entire shoot using the same comparison workflow, and arrive at my final gem stack — the photos worth printing or sharing."

### Deferred from this sprint
- **Export** → Sprint 11 (the finalist set exists but no export mechanism yet)
- **Tags/labels** → Sprint 11 (tagging is a post-selection organizational step)
- **Filters in finalist view** → Sprint 12 (date range, camera model filters are polish)

### "Good enough" definition
- Finalist view is a flat grid of thumbnails, optionally grouped by source stack with a subtle divider or label.
- Global progress is a text counter in the header. Not a fancy dashboard.
- Session refinement reuses the exact same decision UI — no new screens needed beyond the finalist grid.
- Scope switching is via a dedicated key or tab, not a complex mode menu.

### Success criteria
1. Finalist view shows all photos that survived stack-level refinement
2. Stacks with zero finalists contribute nothing to the view; stacks with multiple contribute all
3. Session-level round engine works: Y/X decisions, commit, multi-round, restoration — all identical to stack scope
4. Comparison view (C) works in session scope for cross-stack comparison
5. Global progress indicator shows stacks finalized / total and finalist count
6. Session finalize action locks the gem stack
7. Switching between stack scope and session scope preserves all keyboard shortcuts
8. `cargo test` passes: session finalist aggregation, cross-stack round engine, scope switching, progress counting

---

## Sprint 11 — Export & Labels
**User Stories:** §12 (all: export finalists, pair-aware, JSON manifest, preserve filenames, non-destructive), §16 (all: custom tags, assign, manage, filter by tag)

**Goal:** The user can tag their finalists for organization and export them to a folder for printing, sharing, or import into Lightroom.

### What gets built
- **Custom text tags:** Per-project tags (e.g., "print", "family album", "portfolio", "wall art"). Create, rename, delete, assign a color for visual distinction. Tags are a secondary labeling step applied to finalists — not a replacement for keep/eliminate.
- **Tag assignment:** In finalist view or Stack Focus, select a photo and press a shortcut (e.g., `T` then type tag name, or number keys mapped to tags) to assign one or more tags. Tags are displayed as colored badges on thumbnails.
- **Tag filtering:** In finalist view, filter by tag to see only "portfolio" photos, or only "print" candidates. Combine with session refinement for targeted export.
- **Export finalists:** Export all current session finalists (or a tag-filtered subset) to a new folder. Options:
  - Copy files (safe, uses disk space)
  - Hard-link files (fast, no extra disk space, same filesystem only)
  - Pair handling: export both RAW+JPEG when the logical photo is a pair, or offer JPEG-only / RAW-only options
  - Preserve original filenames and folder structure (with optional flattening)
- **JSON manifest export:** Export a JSON file listing all finalist file paths (including both files of pairs), with metadata (stack ID, round history, tags). Machine-readable for scripting or external tools.
- **XMP sidecar output:** Write XMP sidecar files alongside exported photos with star ratings and labels, so Lightroom/Capture One can read GemKeep's decisions on import. Maps finalists to Pick flag + star rating based on round survived.
- **Non-destructive guarantee:** Export never modifies or moves original source files. Clear messaging in UI.

### After this sprint
"I can tag my finalists by purpose (print, portfolio, family album), export them to a folder with both RAW and JPEG files, and import into Lightroom with my ratings preserved via XMP sidecars."

### Deferred from this sprint
- **Cloud sync / Google Photos** → Future/P2
- **Tag-based auto-grouping** → Future/P2
- **Export progress bar** → Sprint 12 (if export is slow for large sets)

### "Good enough" definition
- Tag management is a simple list panel (not a full tag editor with drag-and-drop). Create/rename/delete/assign color.
- Export dialog is a folder picker + checkboxes for options (copy vs. hard-link, RAW+JPEG vs. JPEG-only). Not a wizard.
- XMP output writes basic `xmp:Rating` and `xmp:Label` fields. Not full IPTC metadata.
- JSON manifest is a flat array of objects. Not a complex schema.

### Success criteria
1. User can create, rename, delete, and color-code custom tags per project
2. Tags can be assigned to finalists; multiple tags per photo supported
3. Finalist view can be filtered by tag
4. Export copies (or hard-links) all finalist files to a chosen folder
5. RAW+JPEG pairs are exported together; JPEG-only option available
6. Original filenames preserved; optional folder flattening works
7. JSON manifest lists all exported files with metadata
8. XMP sidecar files are written and readable by Lightroom (verified manually)
9. Original source files are never modified or moved
10. `cargo test` passes: tag CRUD, tag assignment, export file operations, JSON manifest generation, XMP writing

---

## Sprint 12 — Zoom, Search & Polish
**User Stories:** §10 (all: zoom/pan in Single View), §4.2 (RAW toggle on demand), §11 (fuzzy search, metadata filters), §3.2–3.4 (stack merge/split/undo), §9.6 (keyboard help overlay), §20 (first-use onboarding), §17 (auto-advance refinement), §13.3 (full-res RAW on zoom), §19 (quick preview in Stack Overview)

**Goal:** The app is polished and fully featured. Every remaining user story is addressed.

### What gets built
- **Zoom/pan in Single View:** Mouse wheel zoom (Ctrl+scroll or plain scroll, configurable). Keyboard zoom (+/- keys). Zoom centers on cursor position. Pan via mouse drag or arrow keys / WASD. Shift+arrow for fast pan. Quick toggles: `1` = 100% actual size, `0` = fit-to-screen. Zoom resets on photo change (configurable persist option).
- **RAW toggle:** Press `R` in Single View to switch from JPEG preview to full RAW decode. Shows actual RAW data for exposure evaluation. Toggles back on second press. Only loads RAW on demand — never preloaded.
- **Full-resolution RAW on 100% zoom:** When zoomed to 100% (actual pixels), automatically switch to full-resolution decode (RAW if available, full JPEG otherwise). This is when sharpness evaluation matters.
- **Fuzzy search:** Search bar (press `/` to focus) with fuzzy matching across filenames, capture dates (partial strings), camera model, lens model. Results update as you type. Jump to matching stack or photo.
- **Metadata filters in Stack Overview:** Filter by date range, stack size, has-finalist / no-finalist, contains-RAW, contains-JPEG, camera model. Filter bar appears on press `F` (or toggle). Combinable filters.
- **Stack merge/split:** Select 2+ stacks in Stack Overview and merge into one (preserving all photos and decisions). Remove a photo from a stack to create a new stack of size 1. Single-level undo for last merge. All structural changes recorded with timestamp and before/after state.
- **Keyboard help overlay:** Press `?` to show a non-modal overlay listing all keyboard shortcuts for the current mode (Stack Overview, Stack Focus, Single View, Comparison). Dismiss with `?` or `Esc`.
- **First-use onboarding:** On first launch (no projects exist), show a brief non-modal hint explaining the workflow: create project → add folders → enter stacks → cull with keyboard. Dismissed permanently after first project creation. "What's next?" prompt after import finishes.
- **Auto-advance refinement:** Polish the auto-advance toggle from Sprint 8. Add stack-level auto-advance: after all photos in a stack are decided, auto-advance to the next undecided stack. Ensure Caps Lock convention works reliably.
- **Quick preview in Stack Overview:** Press Space on a focused stack card to see a larger preview of its representative thumbnail without entering Stack Focus. Dismiss on any key or click.
- **Synchronized zoom/pan in comparison:** When zoomed in comparison view, both photos scroll/zoom together for pixel-level comparison.

### After this sprint
"The app is polished and fully featured. I can zoom to check sharpness, toggle RAW for exposure evaluation, search for specific photos, merge or split stacks, and see keyboard shortcuts at a glance. The first-use experience guides new users."

### Deferred to future versions
- Smarter auto-grouping (ML, perceptual hash, location) — §15.1
- Visual timeline of selection evolution across rounds — §15.2
- Basic focus/blur/sharpness auto-tagging — §15.3
- Google Photos / cloud sync — §15.4
- High-contrast mode / enhanced accessibility — §15.5

### "Good enough" definition
- Zoom is smooth but does not need to match Photoshop-level rendering. WebView-based zoom is acceptable.
- Fuzzy search uses simple substring/trigram matching, not a full-text search engine.
- Keyboard help overlay is a styled HTML overlay, not a separate settings page.
- Onboarding is 3-4 steps of inline text, not an interactive tutorial.
- Stack merge/split is available via keyboard shortcut + confirmation, not drag-and-drop.

### Success criteria
1. Mouse wheel zoom works in Single View; zoom centers on cursor position
2. +/- keys zoom in/out; `1` = 100%, `0` = fit-to-screen
3. Pan via mouse drag and keyboard arrows works when zoomed
4. `R` toggles between JPEG preview and full RAW decode
5. 100% zoom triggers full-resolution decode
6. Fuzzy search finds photos by filename, date, camera model
7. Stack Overview filters narrow displayed stacks correctly
8. Stack merge combines two stacks; undo restores them
9. Stack split removes a photo into a new stack of 1
10. `?` shows keyboard shortcuts for the current mode
11. First-use onboarding appears on first launch and dismisses permanently
12. Space in Stack Overview shows a quick preview
13. `cargo test` passes: zoom state, RAW toggle, search matching, merge/split/undo, filter logic

---

## Dependency Chain

```
S1 Skeleton ✅
 └── S2 Project Management ✅
      └── S3 Import + Pairs + Stacks ✅
           └── S4 Thumbnail Pipeline ✅
                └── S5 Stack Overview UI ✅
                     └── S6 Burst Config + Thumbnail Resume ✅
                          └── S7 Minimum Viable Culling
                               └── S8 Comparison View + Stack Workflow
                                    └── S9 Multi-Round Engine + Restoration
                                         └── S10 Session Scope + Finalists
                                              ├── S11 Export + Labels
                                              └── S12 Zoom, Search + Polish
```

Note: Sprints 11 and 12 can be developed in parallel once Sprint 10 is complete. Sprint 11 (Export) depends on finalists existing (Sprint 10). Sprint 12 (Polish) depends on all core views existing (Sprint 10) but not on export.

---

## Cross-Sprint Standards

- `cargo fmt` + `cargo clippy --fix` before every commit
- All errors: `thiserror` (domain) / `anyhow` (propagation); Tauri commands return `Result<T, String>`
- `tracing` for all logging — no `println!`
- In-memory SQLite (`:memory:`) for all Rust unit/integration tests
- Negative test for every error path
- Commit format: `feat|fix|refactor|test|docs|chore: ≤50 chars`

### Per-Project Context Isolation (Architectural Invariant)

**All UI state, background processes, and progress indicators MUST be scoped to the active project.** No global state for anything project-specific.

**Current problem (to fix in Sprint 7):** `AppState` stores indexing control as global `Arc<AtomicBool>` (`cancel_indexing`, `pause_indexing`) and a single `IndexingStatus`. If the user switches from Project A (mid-thumbnail-generation) to Project B and back, Project A's progress is lost or shows stale data.

**Required architecture:**
- `AppState` manages a `HashMap<String, ProjectContext>` keyed by project slug
- Each `ProjectContext` holds: DB connection, indexing status, cancel/pause signals, background task handles
- Switching projects changes the active project but does NOT destroy other projects' contexts
- `get_indexing_status(slug)` returns the status for THAT project, not a global status
- Background tasks (thumbnail generation, indexing) continue running for their project even when another project is active
- The frontend polls status for the ACTIVE project and shows that project's specific progress
- All IPC commands that take a `slug` parameter operate on that project's context, not a global state

This is a **P0 architectural invariant** that must be established in Sprint 7 and maintained in every subsequent sprint.

---

## Priority Matrix

| Feature | Priority | Sprint | Rationale for placement |
|---|---|---|---|
| Single View (full-screen photo) | P0 | S7 | Core viewing mode; prerequisite for all culling |
| Camera parameters display | P0 | S7 | Hobbyist learning experience; core to the user persona |
| Keep/Eliminate decisions (Y/X) | P0 | S7 | Atomic culling action; nothing works without it |
| Pair-aware decisions | P0 | S7 | RAW+JPEG must be one decision unit from day one |
| Visual feedback (keep/eliminate) | P0 | S7 | User must see decision state instantly (competitive §2.4) |
| Auto-save (crash resilience) | P0 | S7 | Non-negotiable for traceability; decisions must survive crashes |
| Manual round commit (Ctrl+Enter) | P0 | S7 | User controls when a round is sealed; core to deliberate workflow |
| Side-by-side comparison view | P0 | S8 | Primary decision-making view for hobbyist; moved earlier than speed-first plan |
| Auto-fill on eliminate in comparison | P0 | S8 | Maintains comparison flow without manual reload |
| Undo last decision | P1 | S8 | Traceability/revert is core to user persona; single-level is sufficient early |
| Stack decision progress indicator | P1 | S8 | User needs to know where they are in a stack |
| Stack completion + advance to next | P1 | S8 | Natural workflow: finish stack, move to next |
| Auto-advance toggle (Caps Lock) | P1 | S8 | Default OFF for deliberate workflow; available for speed passes |
| Stack Overview progress badges | P1 | S8 | At-a-glance session status (competitive §2.4) |
| Lock comparison layout | P1 | S8 | Lets user linger and study without auto-fill interrupting |
| Multi-round (Round 1 → 2 → 3) | P0 | S9 | Progressive refinement is GemKeep's core differentiator |
| Immutable round snapshots | P0 | S9 | Traceability: user can always see what they decided in each round |
| Decision overrides in later rounds | P0 | S9 | Later rounds must be able to change earlier decisions |
| Restore eliminated photos | P0 | S9 | Core to user persona: ability to reconsider is non-negotiable |
| Round navigation (browse history) | P0 | S9 | User wants to review past decisions for learning |
| Round finalize action | P1 | S9 | Explicit "done" signal for a stack's refinement |
| Session-wide finalist view | P0 | S10 | The "gem stack" — the entire point of the application |
| Cross-stack refinement | P0 | S10 | Same round engine applied globally; systematic narrowing |
| Global progress indicators | P1 | S10 | Session-level awareness: how much work remains |
| Seamless scope switching | P0 | S10 | Stack and session scope must feel identical |
| Export finalists (copy/hard-link) | P0 | S11 | Final output: get photos out of the app |
| Pair-aware export (RAW+JPEG) | P0 | S11 | Must export both files of a pair |
| JSON manifest export | P1 | S11 | Machine-readable output for scripting |
| XMP sidecar output | P1 | S11 | Lightroom/Capture One interop (competitive §3.1) |
| Custom text tags | P1 | S11 | Organizational step for finalists (print, portfolio, etc.) |
| Tag management (CRUD + color) | P1 | S11 | Tags need create/rename/delete/color to be useful |
| Tag filtering in finalist view | P1 | S11 | Filter by purpose for targeted export |
| Non-destructive export guarantee | P0 | S11 | Never modify originals; core safety principle |
| Zoom/pan in Single View | P1 | S12 | Sharpness evaluation; important but embedded JPEG suffices initially |
| RAW toggle on demand | P1 | S12 | Exposure evaluation from true RAW data; not needed for initial culling |
| Full-res RAW at 100% zoom | P1 | S12 | Only matters when zoomed; deferred with zoom |
| Fuzzy search | P2 | S12 | Convenience for large sessions; not core workflow |
| Metadata filters (Stack Overview) | P1 | S12 | Navigation aid for large sessions |
| Manual stack merge | P0 | S7 | Auto-stacking is not always accurate; manual merge is pre-culling step |
| Merge-aware restacking | P0 | S7 | Changing burst gap must preserve manual merges |
| Stack transaction log | P0 | S7 | Every structural change recorded in DB like git log |
| Undo last merge | P1 | S7 | Safety net for merge mistakes |
| Stack split (remove photo) | P1 | S8 | Less common than merge; deferred |
| Keyboard help overlay (?) | P1 | S12 | Discoverability; user can learn shortcuts from docs initially |
| First-use onboarding | P2 | S12 | Polish; early users are the developer (hobbyist user persona) |
| Auto-advance stack-level | P1 | S12 | Refinement of S8's auto-advance for full workflow |
| Quick preview (Space) in Overview | P2 | S12 | Convenience; user can enter Stack Focus instead |
| Synchronized zoom in comparison | P2 | S12 | Polish for pixel-level comparison |
| Bulk keep/eliminate (multi-select) | P1 | S12 | Edge case; individual decisions are the norm for deliberate workflow |
