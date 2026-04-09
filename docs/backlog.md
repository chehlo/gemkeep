# GemKeep Backlog

Single source of truth for all pending work. Items sourced from sprint-plan, screen-review-gaps, sprint-improvements, code-improvements, and test-improvements.

**Last updated:** 2026-03-29 (after Sprint 10 completion — all phases A-D merged to main)

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
| S9 | main | Done | Comparison View, auto-fill, lock, undo, stack progress, auto-advance |
| S10 | main | Done | Multi-round engine (A: round-scoping, B: progression/overrides/snapshots, C: round navigation UI, D: restore eliminated — finalize/reopen added then removed) |

**Test counts (current):** 438 Rust + 512 frontend + 9 E2E = 959 total.

---

## Next Sprint: S11 — GemStack — Final Curation

- GemStack: special stack for final curation (G key promotes survivors)
- GemStack behaves like a regular stack (same round engine, Y/X, comparison)
- Re-promotion replaces previous promotions from that stack
- Provenance display (source stack per photo in GemStack)
- Promoted badge on stack cards in StackOverview
- F key jumps to GemStack from StackOverview
- Project-wide progress indicators (stacks promoted / total)

---

## Pre-S11 Cleanup

Items to address before starting Sprint 11:

### Missing E2E tests
- No E2E coverage for multi-round workflow (R1 → commit → R2, and restore eliminated + re-eliminate)
- No E2E coverage for round navigation ([ ] keys, round tab bar clicks, read-only mode in committed rounds)
- Existing 10 E2E specs cover S1-S9 flows only

### Stale docs updates
- `docs/keyboard-map.md` — remove Ctrl+Shift+Enter "Finalize stack" (finalize was removed from codebase)
- `docs/ui-wireframes.md` — verify round tab bar, restore UX wireframes exist (remove finalized badge wireframe if present)
- `docs/user_stories.md` — update Sprint 10 user story statuses to Done

### Quick wins from code-improvements.md (13 trivial items)
1. **DUP-05** — RAW extension list duplicated (scanner.rs vs exif.rs)
2. **DUP-09** — Duplicate Esc handling between App.svelte and screens
3. **DUP-10** — Thumbnail progress bar HTML duplicated in StackOverview
4. **DEAD-01** — ThumbnailStrategy.use_exif_fast_path computed but never read
5. **DEAD-02** — generate_thumbnail_from_bytes is dead code
6. **DEAD-03** — merges table appears dead/legacy
7. **DEAD-04** — find_missing_thumbnail_targets unnecessary wrapper
8. **DEAD-05** — Two separate restack implementations
9. **DEAD-06** — Two redundant dispatch functions for EXIF extraction
10. **DEAD-07** — Redundant cancel check in pipeline step 3
11. **MIS-03** — Hardcoded thumbnail size 256x256
12. **MIS-04** — Cache dir path construction repeated 5+ places
13. **INC-05** — Orientation applied after resize in thumbnails

### Thumbnail performance regression (PERF-01)

Profiling on macOS (M-series, debug build, 967 Canon 6000×4000 JPEGs, 10 rayon threads) shows **61ms/photo** — dominated by:
- `resize_to_fill` with Lanczos3: **198ms** per photo (debug, no optimizations)
- turbojpeg DCT 1/8 decode: **130ms** per photo (debug)
- EXIF extract + header: **< 1ms** (negligible)

The Linux baseline (same photos, debug build, AMD Ryzen 5 5625U) was **12ms/photo**. The 5× gap is unexpected since the Mac hardware is faster. Likely cause: the Linux benchmark was hitting the EXIF embedded thumbnail fast path (tiny thumbnail, skip decode+resize entirely) while on Mac embedded thumbnails are < 200px short side and get rejected — every photo goes through the expensive turbo+Lanczos3 path.

**Suggested fix:** Add `[profile.test.package.image]` with `opt-level = 2` in Cargo.toml so the `image` crate's Lanczos3 resize runs optimized even in test builds. This is a common Rust pattern for CPU-heavy dependencies. Alternatively, consider using a lighter filter (e.g. `CatmullRom`) for thumbnails where Lanczos3 quality is overkill at 256×256.

---

## Future Sprints

### S12 — Export & Labels
- Export GemStack survivors (copy / hard-link / JPEG-only)
- RAW+JPEG pair-aware export
- JSON manifest + XMP sidecar output
- Custom tags (create, rename, color, filter)
- Non-destructive guarantee

### S13 — Zoom, Search & Polish
- Zoom/pan in Single View (+/-, mouse wheel, 100% / fit)
- RAW toggle on demand (R key — note: R is now "restore" in StackFocus historical views; RAW toggle needs a different key or context-aware binding)
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

31 items remaining (12 resolved through S8-S10). Full details in `docs/code-improvements.md`.

### HIGH impact (do first)
- **ABS-05**: burst_gap_secs global → per-project [MEDIUM effort]
- **MIS-01**: No transaction helper (3+ manual sites) [MEDIUM]
- **MIS-02**: Dynamic SQL placeholder generation duplicated [MEDIUM]
- **ABS-01**: No camera abstraction for vendor quirks [LARGE]
- **ABS-02**: Near-duplicate JPEG/RAW EXIF extractors [LARGE]

### Quick wins (TRIVIAL effort)
- DUP-05, DEAD-01 through DEAD-07, MIS-03/04, DUP-09/10, INC-05 (13 items)
- ~~MIS-06~~ [RESOLVED], ~~DUP-11~~ [RESOLVED]

### SMALL effort
- DUP-04, ABS-03/04, DEAD-05/06, DUP-06/07, INC-01/02/03 (10 items)

### Frontend (MEDIUM effort)
- **SVE-05**: Decision key handling (Y/X/U) duplicated across 3 screens
- **SVE-11**: StackFocus handleKey still ~232 lines (depends on SVE-05)
- **UX-01**: Stack ID display inconsistent after merges

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

3. **undo_merge round restoration** — (deferred from S10) Currently `undo_merge` creates fresh Round 1 for restored stacks. Should restore original rounds (they're still in DB — no FK cascade). Design question: what happens to decisions made in the merged stack's round?

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
| `docs/code-improvements.md` | Detailed code refactoring items (31 remaining) |
| `docs/sprints/sprint-10.md` | Sprint 10 spec — multi-round engine (all phases A-D complete) |
| `docs/test-improvements.md` | Detailed test infrastructure items (10 remaining) |
