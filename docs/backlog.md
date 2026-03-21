# GemKeep Backlog

Single source of truth for all pending work. Items sourced from sprint-plan, screen-review-gaps, sprint-improvements, code-improvements, and test-improvements.

**Last updated:** 2026-03-21 (after Sprint 7+8 squash-merge to main)

---

## Completed Sprints

| Sprint | Branch | Status | Summary |
|--------|--------|--------|---------|
| S1 | main | Done | Skeleton: Tauri + Svelte + Rust wired |
| S2 | main | Done | Project management (CRUD, slug, isolation) |
| S3 | main | Done | Import, EXIF, RAW+JPEG pairs, burst stacking |
| S4 | main | Done | Thumbnail pipeline (EXIF fast path, orientation, rayon) |
| S5 | main | Done | Stack Overview UI, arrow navigation, scroll restore |
| S6 | main | Done | Burst config UI, thumbnail resume, progress display |
| S7 | main | Done | Decision engine, SingleView, camera params, stack merge, visual feedback |
| S8 | main | Done | Bug fixes: viewport overflow, sticky headers, RAW preview quality |

**Test counts (current):** 385 Rust + 452 frontend = 837 total.

---

## Next Sprint: S9 — Comparison View & Stack Workflow

From sprint-plan.md §Sprint 8 (renumbered to S9 since actual S8 was bug fixes).

**User Stories:** §6 (side-by-side comparison, auto-fill, lock), §5.6 (auto-advance toggle), §9.5 (status bar), §18 (visual stack progress)

### Features
- Side-by-side comparison view (C key) — PRIMARY decision-making view
- Auto-fill on eliminate (next undecided fills slot)
- Lock comparison layout (L key)
- Undo last decision (Ctrl+Z / U)
- Stack decision progress indicator ("5/12 decided | 3 kept | 2 eliminated")
- Stack completion detection + advance to next stack
- Auto-advance toggle (Caps Lock)
- Stack Overview progress badges (untouched / in-progress / complete)

### Success criteria
See `docs/sprints/sprint-plan.md` §Sprint 8 success criteria (items 1-10).

---

## Future Sprints

### S10 — Multi-Round Engine & Restoration
- Multi-round progression (Round 1 → 2 → 3)
- Immutable round snapshots
- Decision overrides in later rounds
- Restore eliminated photos
- Round navigation ([ ] keys)
- Round finalize action

### S11 — GemStack — Final Curation
- GemStack: special stack for final curation (G key promotes survivors)
- GemStack behaves like a regular stack (same round engine, Y/X, comparison)
- Re-promotion replaces previous promotions from that stack
- Provenance display (source stack per photo in GemStack)
- Promoted badge on stack cards in StackOverview
- F key jumps to GemStack from StackOverview
- Project-wide progress indicators (stacks promoted / total)

### S12 — Export & Labels
- Export GemStack survivors (copy / hard-link / JPEG-only)
- RAW+JPEG pair-aware export
- JSON manifest + XMP sidecar output
- Custom tags (create, rename, color, filter)
- Non-destructive guarantee

### S13 — Zoom, Search & Polish
- Zoom/pan in Single View (+/-, mouse wheel, 100% / fit)
- RAW toggle on demand (R key)
- Fuzzy search (/ key)
- Metadata filters in Stack Overview
- ~~Keyboard help overlay (? key)~~ **[DONE]**
- First-use onboarding
- Quick preview (Space in Stack Overview)

---

## UX Improvements (from sprint-improvements.md)

### HIGH priority

1. ~~**StackFocus: Decision borders on cards**~~ **[DONE]** — Absorbed into PhotoFrame border styling (Sprint 7)

2. ~~**StackFocus: Camera params on grid cards**~~ **[DONE]** — Camera params in PhotoFrame metadata (Sprint 7)

3. ~~**StackFocus: scrollIntoView on arrow nav**~~ **[DONE]** — Scroll-into-view after arrow nav (Sprint 7)

### MEDIUM priority

4. **ProjectList: Arrow Up/Down row selection** — Visual row highlight, Enter opens. Currently Tab-only. [sprint-improvements §ProjectList]

5. ~~**StackOverview: Non-adjacent stack selection**~~ **[DONE]** — S key toggle select + click-to-select in selection mode

6. **SingleView: EXIF panel as right-side overlay** — Wireframe shows floating right panel, implementation is bottom bar. [screen-review-gaps #5]

7. ~~**Missing keyboard shortcuts**~~ **[DONE]** — hjkl, Home/End, E key all implemented (Sprint 7)

8. ~~**SingleView: Stack name in status bar**~~ **[DONE]** — Shows "Stack #N · Round N" now

9. **Responsive grid columns** — Grid currently hardcoded to 4 columns. Should adapt to window size (e.g., 8 columns when maximized). Affects StackOverview and StackFocus. [SVE-19]

### LOW priority

9. **ProjectList: "No projects yet" text** — Empty state text. [screen-review-gaps #12]
10. **ProjectList: Focus rings on buttons** — Visible ring-2 on Tab focus. [screen-review-gaps #13]
11. **SingleView: Decision flash animation** — Brief green/red flash before settling. [screen-review-gaps #7]
12. **HelpOverlay: Update shortcut lists** — Add new shortcuts once implemented. [screen-review-gaps #14]

---

## Code Quality (from code-improvements.md)

28 items remaining. Full details in `docs/code-improvements.md`.

### HIGH impact (do first)
- **ABS-05**: burst_gap_secs global → per-project [MEDIUM effort]
- **MIS-01**: No transaction helper (3+ manual sites) [MEDIUM]
- **MIS-02**: Dynamic SQL placeholder generation duplicated [MEDIUM]
- **ABS-01**: No camera abstraction for vendor quirks [LARGE]
- **ABS-02**: Near-duplicate JPEG/RAW EXIF extractors [LARGE]

### Quick wins (TRIVIAL effort)
- DUP-05, DEAD-01 through DEAD-07, MIS-03/04/06, DUP-09/10/11, INC-05 (13 items)

### SMALL effort
- DUP-04, ABS-03/04, DEAD-05/06, DUP-06/07, INC-01/02/03 (10 items)

---

## Test Infrastructure (from test-improvements.md)

10 items remaining. Full details in `docs/test-improvements.md`.

### HIGH priority
- **SQL-01**: engine.rs setup_test_db() inline SQL → TestLibraryBuilder
- **SQL-02**: Photo-detail tests duplicate project+stack+photo SQL
- **SQL-03**: repository.rs setup_merge_test_db → TestLibraryBuilder
- **SD-01**: Four ad-hoc JPEG writer functions in integration_tests.rs
- **SD-02**: setup() + pipeline boilerplate in every test

### MEDIUM priority
- SQL-04, SQL-05, TB-01, TB-03

### LOW priority
- TB-02

---

## Architecture Debt

1. **Per-project context isolation** — `AppState` uses global `Arc<AtomicBool>` for indexing. Should be `HashMap<String, ProjectContext>`. P0 invariant from sprint-plan.md. [sprint-plan §Cross-Sprint Standards]

2. **Shared visual components** — PhotoFrame.svelte is the unified frame component. CameraParams, FormatBadges, formatCaptureTime still duplicated across screens. [screen-review-gaps §Architecture]

---

## Reference Documents (kept, not consolidated)

| Document | Purpose |
|----------|---------|
| `docs/sprints/sprint-plan.md` | Full roadmap with sprint specs and success criteria |
| `docs/ui-wireframes.md` | ASCII wireframes for every screen state |
| `docs/keyboard-map.md` | Complete keyboard shortcut specification |
| `docs/architecture.md` | High-level system architecture |
| `docs/low-level-design.md` | Detailed code reference with file paths |
| `docs/testing-philosophy.md` | 20 testing rules + TDD methodology |
| `docs/user_stories.md` | Feature requirements with P0/P1/P2 + status |
| `docs/coding-standards.md` | Code quality standards |
| `docs/competitive-analysis.md` | Competitor analysis (Photo Mechanic, LR, etc.) |
| `docs/manual-tests.md` | Non-automated test checklist |
| `docs/test-fixture-design.md` | Manifest-driven fixture pattern |
| `docs/code-improvements.md` | Detailed code refactoring items (28 remaining) |
| `docs/test-improvements.md` | Detailed test infrastructure items (10 remaining) |
