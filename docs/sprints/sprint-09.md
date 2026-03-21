# Sprint 9 — Comparison View & Stack Workflow

**User Stories:** §6 (all: side-by-side comparison, auto-fill, lock), §5.6 (auto-advance toggle), §9.5 (status bar / progress indicator), §18 (visual stack progress)

**Goal:** The user can compare two photos side by side — their primary decision-making view — and work through a stack systematically with progress feedback.

**Branch:** `sprint-9`
**Depends on:** S1–S8 ✅

---

## What gets built

### Side-by-side comparison view
Select two photos in Stack Focus (e.g., Shift+Arrow or click two thumbnails) and press `C` to enter comparison mode. Two photos displayed at equal size with camera parameters visible for both. The user studies the pair, then presses X on the weaker photo to eliminate it. This is the PRIMARY decision-making view for the hobbyist user — it is where learning happens ("why is this photo better than that one?").

**Photo targeting in comparison:** Left/Right arrow keys move focus between the left and right photo. The focused photo has a visible highlight border (e.g., 2px blue). Y/X/U apply to the currently focused photo only. Default focus is the left photo on entry.

**Exiting comparison:** Press `Esc` to exit comparison mode and return to Stack Focus. Press `C` again to re-enter with the same (or updated) selection. When comparison exits due to no remaining undecided photos, the user returns to Stack Focus with a "No more undecided photos" inline message.

### Auto-fill on eliminate
When one compared photo is eliminated, the empty slot automatically fills with the next undecided photo from the stack. "Next" is defined by **stack display order** (the same order photos appear in StackFocus grid — by `logical_photos.id` ascending). Comparison flow continues without manual reload (§6.2). If no undecided photos remain, comparison mode exits gracefully to Stack Focus.

### Lock comparison layout
Press `L` to lock the current pair. Auto-fill is suppressed until the user presses `L` again to unlock (toggle behavior). When locked, a visible "Locked" indicator appears (e.g., lock icon or text badge in the comparison header). Eliminating a photo while locked marks it but does NOT auto-fill — the slot shows "Eliminated" state until unlock. This lets the user linger and study (§6.3).

### Undo last decision
`Ctrl+Z` or `U` undoes the most recent decision within the current round (pops the last entry from the decisions log for the current round, before commit). Single-level undo only — pressing undo twice has no additional effect (the second press is a no-op). Scope: comparison view and Stack Focus only (not global). No redo support.

### Stack decision progress indicator
In Stack Focus, a text counter in the header area shows the exact format: `"5/12 decided · 3 kept · 2 eliminated · 7 undecided"`. Uses middle-dot (`·`) as separator. Updates live as decisions are made (re-fetched after each Y/X/U action). The same counter is visible in comparison view header.

### Stack completion detection
When all photos in a stack are decided (undecided count reaches 0), show a non-modal inline banner: `"Stack complete — N kept, M eliminated"`. Below the banner, a prompt: `"Press ↓ to go to the next undecided stack"`. The banner appears in Stack Focus (below the progress counter area). It does NOT auto-dismiss — it stays until the user navigates away.

### Advance to next stack
After completing a stack, `↓` (Down arrow) moves to the next undecided stack in Stack Overview display order (by `stacks.id` ascending). If no undecided stacks remain, show inline message: `"All stacks decided"`. This shortcut is only active when the completion banner is visible.

### Auto-advance toggle
A visible toggle button in the Stack Focus header enables auto-advance — after Y/X, focus moves to the next undecided photo automatically (in StackFocus grid order). Default is OFF (deliberate workflow). When ON, a visible indicator shows `"Auto-advance: ON"` in the header. Toggle via clicking the button or pressing `A` (not Caps Lock — Caps Lock has OS-level side effects). In comparison view with auto-advance ON: after eliminate + auto-fill, focus automatically moves to the newly filled photo.

### Stack Overview progress badges
Each stack card in Stack Overview shows a visual state: untouched (no badge), in-progress (yellow dot + `"3/12"` counter), complete (green checkmark + `"12/12"`). The counter format is `"decided/total"`. Progress data comes from the existing `get_round_status` IPC (or a new batch variant).

### Click on thumbnail enters SingleView (from StackFocus)
Currently, only the Enter key opens SingleView from StackFocus. Mouse click on a thumbnail in the StackFocus grid should also navigate to SingleView for that photo. This mirrors the existing click-to-enter behavior in StackOverview (where clicking a stack card enters StackFocus).

### File path shortcut (F key)
In StackFocus and SingleView: pressing `F` copies the currently focused photo's file path to the system clipboard AND displays a path overlay on the photo. The overlay shows the full absolute path in a semi-transparent dark bar at the bottom of the photo/thumbnail. Pressing `F` again hides the overlay (toggle behavior). The clipboard copy happens only on the first press (show); the second press (hide) does not re-copy. For RAW+JPEG pairs, display both paths (JPEG on first line, RAW on second). The path data is already available in `PhotoDetail.jpeg_path` and `PhotoDetail.raw_path`.

### Bundled: Decision borders on cards
Green border (2px solid) for kept photos, red border (2px solid) for eliminated photos in StackFocus grid. Applies to thumbnail card containers. No border for undecided. Natural to implement alongside comparison view decision feedback. (From wireframe §3.1.)

### Bundled: Camera params on grid cards
Add aperture, shutter speed, ISO, and focal_length to `LogicalPhotoSummary` struct (Rust) and the corresponding TypeScript interface. Display as a single line below each thumbnail in StackFocus grid: `"f/2.8 · 1/250 · ISO400 · 85mm"`. Omit fields that are null. Comparison view reuses the same data.

### Bundled: scrollIntoView on arrow nav
In StackFocus, when arrow-key navigation moves focus to a thumbnail that is off-screen, call `scrollIntoView({ block: 'nearest', behavior: 'smooth' })` on the focused element. Copy the pattern already implemented in StackOverview.

---

## "Good enough" definition

- Comparison view splits the window 50/50. Photos are fit-to-half-width. No synchronized zoom yet.
- Camera parameters shown below or overlaid on each photo in comparison. Same data as Single View.
- Progress indicator is a simple text counter ("5/12 decided"). A progress bar is nice but not required.
- Stack Overview badges can be colored dots or small text labels. Not pixel-perfect.
- Undo only covers the last single decision. No multi-step undo history.
- File path overlay is plain text on a dark background. Not styled beyond readability.
- Click-to-SingleView works identically to Enter key — no special behavior.

---

## Success criteria

1. User can select two photos and press C to enter comparison mode
2. Both photos display side-by-side with camera parameters visible for each
3. Left/Right arrows move focus between compared photos; focused photo has visible highlight
4. Pressing X on the focused compared photo eliminates it and auto-fills the slot with the next undecided photo (by stack display order)
5. When no undecided photos remain, comparison mode exits to Stack Focus with an inline message
6. Pressing L toggles lock: when locked, auto-fill is suppressed and a "Locked" indicator is visible; pressing L again unlocks
7. Ctrl+Z or U undoes the last decision (photo returns to undecided state); second undo is a no-op
8. Stack Focus shows a live progress counter in the format `"N/M decided · K kept · E eliminated · U undecided"` that updates on every decision
9. When all photos in a stack are decided, a completion banner appears with kept/eliminated counts and a prompt to advance
10. Down arrow on completion banner advances to the next undecided stack; shows message if none remain
11. Stack Overview cards show visual state (untouched / in-progress with count / complete with checkmark)
12. Auto-advance toggle works: OFF by default, ON shows indicator, Y/X advances to next undecided photo in grid order
13. Pressing Esc in comparison view returns to Stack Focus
14. Clicking a thumbnail in StackFocus navigates to SingleView for that photo
15. Pressing F in StackFocus or SingleView copies the file path to clipboard and shows a path overlay; pressing F again hides the overlay
16. For RAW+JPEG pairs, the F overlay shows both file paths
17. StackFocus thumbnails have green border for kept, red border for eliminated, no border for undecided
18. StackFocus grid cards display camera params (aperture, shutter, ISO, focal length) below the thumbnail
19. Arrow navigation in StackFocus scrolls the focused thumbnail into view
20. `cargo test` passes: comparison state management, auto-fill ordering logic, lock toggle, undo idempotency, progress counting, decision border state mapping
21. `npm test` passes: comparison view component tests, progress counter format, file path overlay toggle, click-to-SingleView navigation
22. Comparison mode with fewer than 2 photos: if stack has 0 or 1 undecided photos when C is pressed, show inline error "Need at least 2 photos to compare" and stay in Stack Focus

---

## Edge cases & error handling

| Scenario | Expected behavior |
|----------|-------------------|
| Press C with 0 or 1 undecided photos | Inline error: "Need at least 2 photos to compare". Stay in Stack Focus. |
| Press C with exactly 2 undecided photos | Enter comparison. After one is eliminated, no auto-fill candidate — exit to Stack Focus. |
| Press C with no photos selected (no Shift+Arrow selection) | Auto-select the first two undecided photos in stack order. If < 2 undecided, show error. |
| Eliminate both photos in locked comparison | Both marked eliminated in-place. Unlock + no undecided → exit to Stack Focus. |
| Undo in comparison when the undone photo was auto-filled away | Photo returns to undecided but does NOT re-enter the comparison slot. User must re-select or let auto-fill bring it back naturally. |
| Photo has no EXIF data (camera params all null) | Display empty camera params area (no "N/A" text — just omit the line). |
| Corrupt thumbnail in comparison | Show placeholder image (gray box with "No preview" text). Do not crash. |
| Stack with 1 photo total | Stack Focus works normally. C is disabled (error message). Progress shows "0/1 decided". |
| All stacks decided, press ↓ on completion | Inline message: "All stacks decided". No navigation. |
| F key when clipboard API unavailable (e.g., Wayland without wl-clipboard) | Show overlay but log warning if clipboard write fails. Do not block the overlay. |
| Auto-advance ON + last undecided photo decided | Auto-advance has nowhere to go → treat as stack completion (show banner). |
| Press Y on already-kept photo in comparison | Decision is re-recorded (idempotent). No visual change. No auto-fill triggered. |

---

## Architecture constraints

Per `sprint-plan.md` cross-sprint standards:

1. **Per-project context isolation**: All comparison state, progress counters, and auto-advance settings MUST be scoped to the active project. The comparison view state (which two photos, locked/unlocked, auto-advance toggle) is frontend-only state — no new `AppState` fields needed. Progress data comes from existing per-stack `get_round_status` IPC.

2. **Decision engine as standalone module**: Comparison view uses the existing `decisions/engine.rs` functions (`record_decision`, `undo_decision`, `get_round_status`). No comparison-specific decision logic in the engine. The engine remains view-agnostic.

3. **Frontend is thin display layer**: Comparison layout, auto-fill ordering, and lock state are frontend-only concerns (Svelte component state). The backend provides data; the frontend drives the comparison workflow. No new Rust state machines for comparison flow.

4. **All IPC commands return `Result<T, String>`**: Any new commands (e.g., batch progress for Stack Overview badges) follow this pattern.

5. **Modularity principle (from S7)**: Decision key handling extracted as shared utility (addresses DUP-06 from `code-improvements.md`). ComparisonView, StackFocus, and SingleView all use the same `handleDecisionKey()` function.

6. **`tracing` for logging**: No `println!` in any new Rust code. Use `tracing::warn!` for edge cases (clipboard failure, corrupt thumbnails).

---

## Modules touched

### Rust backend

| File | Changes |
|------|---------|
| `src-tauri/src/decisions/engine.rs` | No changes expected — existing API sufficient |
| `src-tauri/src/decisions/model.rs` | Add camera params to `LogicalPhotoSummary` (aperture, shutter_speed, iso, focal_length) |
| `src-tauri/src/commands/decisions.rs` | Add `get_stack_progress_batch` command for Stack Overview badges (batch of stack_ids → progress counts) |
| `src-tauri/src/commands/import.rs` | Extend `list_logical_photos` to include camera params in response |
| `src-tauri/src/photos/repository.rs` | Extend `LogicalPhotoSummary` query to JOIN camera param columns |
| `src-tauri/src/lib.rs` | Register new IPC commands |

### Frontend

| File | Changes |
|------|---------|
| `src/lib/components/screens/ComparisonView.svelte` | **NEW** — side-by-side layout, auto-fill, lock toggle, decision keys |
| `src/lib/components/screens/StackFocus.svelte` | Progress counter, completion banner, decision borders, camera params on cards, scrollIntoView, click handler for SingleView, F key overlay, auto-advance toggle |
| `src/lib/components/screens/SingleView.svelte` | F key overlay |
| `src/lib/components/screens/StackOverview.svelte` | Progress badges on stack cards |
| `src/lib/stores/navigation.svelte.ts` | Add `ComparisonViewScreen` type with `projectSlug`, `stackId`, `leftPhotoId`, `rightPhotoId`, `projectName` |
| `src/lib/api/index.ts` | Add `getStackProgressBatch()` function, extend `LogicalPhotoSummary` type with camera params |
| `src/lib/utils/decisions.ts` | **NEW** — extracted `handleDecisionKey()` shared utility (resolves DUP-06) |
| `src/lib/utils/clipboard.ts` | **NEW** — `copyToClipboard(text)` wrapper with error handling |
| `src/App.svelte` | Add ComparisonView to screen dispatch |

### Code improvement items addressed

| Item | Resolution |
|------|-----------|
| DUP-06 | Decision key handling extracted to `src/lib/utils/decisions.ts` — used by ComparisonView, StackFocus, SingleView |
| DUP-07 | Tab/Shift+Tab undecided-jump logic extracted alongside DUP-06 in the same utility |
| DUP-11 | RAW/JPEG badge markup — extract `<FormatBadge>` component while touching StackFocus and ComparisonView |

---

## Data model / schema changes

No database schema changes required. All new state is frontend-only or derived from existing tables:

- **Comparison state**: frontend component state (`leftPhotoId`, `rightPhotoId`, `isLocked`, `autoAdvance`)
- **Progress data**: derived from existing `rounds` + `decisions` tables via `get_round_status`
- **Camera params on LogicalPhotoSummary**: requires extending the SQL JOIN in `list_logical_photos` to include `photos.aperture`, `photos.shutter_speed`, `photos.iso`, `photos.focal_length` — these columns already exist in the `photos` table (added in Sprint 7, BUG-01 fix)
- **Stack Overview badge data**: new `get_stack_progress_batch` IPC queries `rounds`/`decisions`/`logical_photos` — no new tables

---

## Implementation order

1. **DUP-06/DUP-07 refactor** — Extract `handleDecisionKey()` and `findNextUndecided()` into `src/lib/utils/decisions.ts`. Both StackFocus and SingleView updated to use it. This is prerequisite for ComparisonView to avoid triplicating the code.

2. **Camera params on LogicalPhotoSummary** — Extend Rust `LogicalPhotoSummary` struct + SQL query + TypeScript interface. Needed by both StackFocus grid cards and ComparisonView.

3. **StackFocus enhancements** — Decision borders, camera params display, scrollIntoView, click-to-SingleView, progress counter, completion banner, auto-advance toggle, F key overlay. These are independent of ComparisonView and can be tested in isolation.

4. **Navigation: ComparisonViewScreen** — Add screen type, back() logic (comparison → stack-focus), and App.svelte dispatch.

5. **ComparisonView component** — Core layout (50/50 split), photo display, camera params, focus highlight, decision keys (via shared utility), Esc to exit.

6. **Auto-fill logic** — On eliminate, query next undecided photo by stack display order. Wire into ComparisonView.

7. **Lock toggle** — L key handler, locked indicator, suppress auto-fill when locked.

8. **Stack Overview progress badges** — `get_stack_progress_batch` IPC + badge rendering on stack cards.

9. **F key in SingleView** — Extend path overlay to SingleView (reuse component/logic from StackFocus).

10. **Edge case hardening** — < 2 photos, no undecided stacks, clipboard failures, corrupt thumbnails.

---

## Test layers

| Feature | Unit (cargo test) | Component (npm test) | E2E (Playwright) |
|---------|:-:|:-:|:-:|
| Auto-fill ordering logic | ✓ (if Rust-side) | ✓ | |
| Lock toggle state | | ✓ | |
| Undo idempotency (2nd press = no-op) | ✓ | ✓ | |
| Progress counter format | | ✓ | |
| Completion banner display | | ✓ | |
| Stack Overview badge states | | ✓ | |
| Decision borders (kept/eliminated/undecided) | | ✓ | |
| Camera params on grid cards | ✓ (SQL query) | ✓ (display) | |
| scrollIntoView on arrow nav | | ✓ | |
| Click-to-SingleView | | ✓ | |
| F key clipboard + overlay toggle | | ✓ | |
| Comparison view full workflow | | | ✓ |
| Auto-advance toggle | | ✓ | |
| handleDecisionKey shared utility | | ✓ | |
| get_stack_progress_batch IPC | ✓ | | |
| Edge: < 2 photos for comparison | | ✓ | |
| Edge: all stacks decided | | ✓ | |
| Navigation: comparison → stack-focus → comparison | | ✓ | |

**E2E scope (Playwright):** 1-2 new journey tests:
1. Full comparison workflow: enter StackFocus → select two photos → C → eliminate one → auto-fill → complete stack → advance
2. F key: verify overlay appears and clipboard contains path

---

## Deferred from this sprint
- Multi-round → Sprint 10
- Restore eliminated photos → Sprint 10
- GemStack (final curation) → Sprint 11
- Bulk keep/eliminate on multi-select → Sprint 12
- Synchronized zoom/pan in comparison → Sprint 13
