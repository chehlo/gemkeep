# Code Improvements: Prioritized Refactoring List

This document catalogs code-level improvements across the GemKeep codebase, organized by category and sorted by severity within each category. Each item includes file references, current behavior, proposed fix, effort estimate, and dependencies.

---

## 1. Duplication

### DUP-01: Burst stacking algorithm duplicated between stacks.rs and pipeline.rs [HIGH] [RESOLVED - 2026-03-07]

**Files:**
- `src-tauri/src/import/stacks.rs:10-50` — `assign_stacks_clean()` operates on `LogicalGroup`
- `src-tauri/src/import/pipeline.rs:613-634` — `restack_from_existing_photos()` hand-rolls the same consecutive-gap algorithm on `(i64, DateTime)` tuples

**Current:** Two independent implementations of the same algorithm (split timed/untimed, sort by time, compare consecutive gaps, assign stack indices). They differ only in the input type.

**Fix:** Extract a generic `burst_group_by_time<T>(items: Vec<T>, gap: u64, time_fn: impl Fn(&T) -> Option<DateTime>) -> Vec<(T, usize)>`. Both call sites become one-liners.

**Effort:** SMALL
**Dependencies:** None

---

### DUP-02: Rayon pool construction + thumbnail par_iter loop duplicated [HIGH] [RESOLVED - 2026-03-07]

**Files:**
- `src-tauri/src/import/pipeline.rs:316-360` — pipeline thumbnail generation
- `src-tauri/src/commands/import.rs:475-514` — `resume_thumbnails` thumbnail generation

**Current:** Nearly identical code: build ThreadPool with fallback to 1 thread, `pool.install(|| targets.par_iter().for_each(...))`, cancel check, `generate_thumbnail()` call, counter increment, event emit. Only difference is thread count source (strategy vs `capped_num_threads`) and `app_handle` being `Option` vs direct.

**Fix:** Shared function `run_thumbnail_pool(targets, cache_dir, cancel, counter, app_handle: Option<AppHandle>, num_threads)`. Both call sites pass their parameters.

**Effort:** SMALL
**Dependencies:** None

---

### DUP-03: Make+Model concatenation logic triplicated [HIGH] [RESOLVED - 2026-03-07]

**Files:**
- `src-tauri/src/import/exif.rs:66-81` — JPEG extractor
- `src-tauri/src/import/exif.rs:243-257` — RAW extractor
- `src-tauri/src/import/test_fixtures.rs:620-627` — test builder helper

**Current:** Three copies of "display as Make Model, skip make prefix if model already contains it." The JPEG version uses `Option<String>` from `read_ascii_tag`, the RAW version uses `&str` from rawler metadata, and the test version takes `(&str, &str)`. Logic is identical.

**Fix:** Extract `pub fn format_camera_model(make: &str, model: &str) -> Option<String>` in `exif.rs`. All three call sites normalize inputs and delegate.

**Effort:** TRIVIAL
**Dependencies:** None

---

### DUP-04: stack_id_map creation pattern duplicated [MEDIUM]

**Files:**
- `src-tauri/src/import/pipeline.rs:258-274` — initial import path
- `src-tauri/src/import/pipeline.rs:645-670` — restack path

**Current:** Identical `Vec<Option<i64>>` allocation, loop over indices, insert stack rows, populate map. The restack version adds ID-seeding logic but the structure is the same.

**Fix:** Helper `fn create_stack_id_map(conn, project_id, count, seed_after: Option<i64>) -> Vec<Option<i64>>`.

**Effort:** SMALL
**Dependencies:** DUP-01 (if burst grouping is unified first, restack simplifies)

---

### DUP-05: RAW extension list duplicated [LOW]

**Files:**
- `src-tauri/src/import/scanner.rs:5` — `RAW_EXTENSIONS`
- `src-tauri/src/import/exif.rs:330` — inline match arms `"cr2" | "cr3" | "nef" | "arw" | "raf" | "rw2"`

**Current:** Same six extensions listed in two places. Adding a new RAW format requires updating both.

**Fix:** Shared `const RAW_EXTENSIONS` in `import/mod.rs` or a `PhotoFormat::from_extension()` method. `extract_metadata` delegates to `PhotoFormat` for dispatch.

**Effort:** TRIVIAL
**Dependencies:** None

---

### DUP-06: Decision key handling duplicated across StackFocus and SingleView [MEDIUM]

**Files:**
- `src/lib/components/screens/StackFocus.svelte` — keep/reject/undo key handlers
- `src/lib/components/screens/SingleView.svelte` — same handlers, ~80 lines each

**Current:** Both screens handle Y/N/U/1-5 keys with nearly identical invoke calls, state updates, and navigation logic.

**Fix:** Extract `handleDecisionKey(key, photoId, slug)` into a shared utility in `src/lib/utils/decisions.ts`. Both screens call it and handle the returned state change.

**Effort:** MEDIUM
**Dependencies:** FE-BUG-01 (SingleView roundStatus bug) should be fixed first or concurrently

---

### DUP-07: Tab/Shift+Tab undecided-jump logic duplicated [MEDIUM]

**Files:**
- `src/lib/components/screens/StackFocus.svelte` — Tab handler
- `src/lib/components/screens/SingleView.svelte` — Tab handler

**Current:** Same "find next/previous undecided photo" scan logic in both screens.

**Fix:** Extract `findNextUndecided(photos, currentIndex, direction)` utility function.

**Effort:** SMALL
**Dependencies:** DUP-06 (could be done together in a single decision-handling refactor)

---

### DUP-08: with_open_project() copy-pasted across command modules [HIGH] [RESOLVED - 2026-03-07]

**Files:**
- `src-tauri/src/commands/import.rs`
- `src-tauri/src/commands/decisions.rs`
- `src-tauri/src/commands/stacks.rs`

**Current:** Each module has its own `with_open_project()` that acquires `db` and `current_project` mutex guards, checks they are `Some`, and validates the slug. Identical logic, 3 copies.

**Fix:** Move to `src-tauri/src/commands/mod.rs` as `pub(crate) fn with_open_project(state, slug) -> Result<(MutexGuard<Option<Connection>>, MutexGuard<Option<Project>>), String>`.

**Effort:** SMALL
**Dependencies:** None

---

### DUP-09: Duplicate Esc handling between App.svelte and individual screens [MEDIUM]

**Files:**
- `src/App.svelte` — global Esc handler
- Individual screen components — local Esc handlers

**Current:** Esc key is handled at both levels, potentially conflicting or double-firing.

**Fix:** Either remove from App.svelte (let screens own it) or remove from screens (let App.svelte dispatch based on current screen). Recommend screens own it since Esc behavior is context-dependent.

**Effort:** SMALL
**Dependencies:** None

---

### DUP-10: Thumbnail progress bar HTML duplicated in StackOverview [LOW]

**Files:**
- `src/lib/components/screens/StackOverview.svelte` — two progress bar blocks

**Current:** Progress bar markup appears twice with minor variations.

**Fix:** Extract `<ThumbnailProgress>` component.

**Effort:** TRIVIAL
**Dependencies:** None

---

### DUP-11: RAW/JPEG badge markup duplicated [LOW] [RESOLVED - 2026-03-18]

**Files:**
- `src/lib/components/screens/StackFocus.svelte`
- `src/lib/components/screens/SingleView.svelte`

**Current:** Same badge HTML/CSS in both screens.

**Fix:** Extract `<FormatBadge format="RAW"|"JPEG" />` component.

**Effort:** TRIVIAL
**Dependencies:** None

---

## 2. Abstraction Issues

### ABS-01: No camera abstraction for vendor-specific EXIF quirks [MEDIUM]

**Files:**
- `src-tauri/src/import/exif.rs` — JPEG and RAW extractors handle all vendors inline
- `src-tauri/src/import/test_fixtures.rs` — `Camera` enum with `make_model()` method

**Current:** Vendor-specific quirks (Canon make/model format vs Nikon vs Sony) are handled inline in the EXIF extractors. The test fixtures have a `Camera` enum that centralizes make/model pairs, but production code has no equivalent. As more cameras are supported, vendor-specific handling will scatter further.

**Fix:** Introduce `CameraProfile` or `CameraVendor` in production code. Initially just centralizes make/model normalization. Later can hold vendor-specific EXIF field mappings.

**Effort:** LARGE
**Dependencies:** DUP-03 (format_camera_model) should be extracted first

---

### ABS-02: Near-duplicate structure between JPEG and RAW EXIF extractors [MEDIUM]

**Files:**
- `src-tauri/src/import/exif.rs:44-105` — `extract_jpeg_exif()` using kamadak-exif
- `src-tauri/src/import/exif.rs:208-306` — `extract_raw_exif_inner()` using rawler

**Current:** Both functions follow the same pattern: open file, read EXIF, extract capture_time, build camera_model, read lens, read orientation, build ExifData. They differ in the EXIF library used (kamadak-exif vs rawler) and field access syntax.

**Fix:** Define an `ExifSource` trait with methods `capture_time()`, `make()`, `model()`, `lens()`, `orientation()`. Implement for kamadak-exif `Exif` and rawler `RawMetadata`. Single `build_exif_data(source: &impl ExifSource) -> ExifData`.

**Effort:** LARGE
**Dependencies:** DUP-03 (format_camera_model)

---

### ABS-03: run_pipeline takes 10 positional parameters [MEDIUM]

**Files:**
- `src-tauri/src/import/pipeline.rs:44-55`

**Current:** `run_pipeline()` accepts 10 individual parameters, then immediately packs them into `PipelineConfig` and `PipelineControls` structs on lines 56-68. The outer function is a pure adapter.

**Fix:** Have call sites construct `PipelineConfig` and `PipelineControls` directly and call `run_pipeline_inner` (renamed to `run_pipeline`). Remove the wrapper.

**Effort:** SMALL
**Dependencies:** None

---

### ABS-04: make_decision has inline SQL bypassing repository layer [MEDIUM]

**Files:**
- `src-tauri/src/commands/decisions.rs` — direct SQL in a Tauri command

**Current:** Decision-writing SQL is inline in the command handler rather than going through `photos/repository.rs`.

**Fix:** Move to `repository::record_decision()`.

**Effort:** SMALL
**Dependencies:** None

---

### ABS-05: burst_gap_secs is global but should be per-project [MEDIUM]

**Files:**
- `src-tauri/src/state.rs` — global config
- `src-tauri/src/import/pipeline.rs:49` — passed as parameter

**Current:** `burst_gap_secs` comes from a global `Config` struct. All projects share the same value.

**Fix:** Store in per-project settings table. Read from project config when starting import.

**Effort:** MEDIUM
**Dependencies:** Data model migration required

---

## 3. Inconsistencies

### INC-01: Inconsistent error return types across repository functions [MEDIUM]

**Files:**
- `src-tauri/src/photos/repository.rs` — mix of `rusqlite::Result`, `anyhow::Result`, and plain `Vec` (swallowing errors)

**Current:** Some functions return `rusqlite::Result`, some `anyhow::Result`, some return empty `Vec` on error (e.g., `load_existing_scanned_files` at line 466). Callers must handle each differently.

**Fix:** Standardize on `anyhow::Result` for all repository functions. Convert `rusqlite::Error` with `?`. Remove silent error swallowing.

**Effort:** MEDIUM
**Dependencies:** None

---

### INC-02: Inconsistent error return types between run_pipeline and restack [LOW]

**Files:**
- `src-tauri/src/import/pipeline.rs:44-55` — `run_pipeline` returns `ImportStats` (never errors)
- `src-tauri/src/import/pipeline.rs:567` — `restack_from_existing_photos` returns `Result<ImportStats, String>`

**Current:** Same module, same data type, different error handling conventions.

**Fix:** Both should return `Result<ImportStats, String>` (or both `ImportStats` with errors collected in `stats.errors`).

**Effort:** SMALL
**Dependencies:** None

---

### INC-03: Inconsistent error handling between EXIF and thumbnails [LOW]

**Files:**
- `src-tauri/src/import/exif.rs` — returns `ExifData::default()` on failure
- `src-tauri/src/import/thumbnails.rs` — returns `Option<PathBuf>`

**Current:** EXIF silently returns defaults, thumbnails use Option. Neither uses Result.

**Fix:** EXIF should return `Result<ExifData, ExifError>` so callers can distinguish "no EXIF" from "corrupt file." Thumbnails can stay as Option since `None` = generation failed is sufficient.

**Effort:** MEDIUM
**Dependencies:** None

---

### INC-04: No structured error types at IPC boundary [MEDIUM]

**Files:**
- All `src-tauri/src/commands/*.rs` — `Result<T, String>`

**Current:** All Tauri commands return `Result<T, String>`. The frontend cannot distinguish error categories (not found, permission denied, corrupt data).

**Fix:** Define `IpcError` enum with `serde::Serialize`, convert at the boundary. Frontend can pattern-match on error type.

**Effort:** MEDIUM
**Dependencies:** INC-01 (repository errors should be structured first)

---

### INC-05: Orientation applied after resize in thumbnails [LOW]

**Files:**
- `src-tauri/src/import/thumbnails.rs:125-126`

**Current:** `resize_to_fill(256, 256)` then `apply_orientation()`. For 90/270 rotations this means the resize happens on the wrong aspect ratio, then the image is rotated.

**Fix:** Apply orientation first, then resize. Swap lines 125-126.

**Effort:** TRIVIAL
**Dependencies:** Verify with visual tests that output quality is correct

---

## 4. Missing Abstractions

### MIS-01: No transaction helper despite 3+ manual BEGIN/COMMIT sites [MEDIUM]

**Files:**
- `src-tauri/src/photos/repository.rs:593` — merge_stacks
- `src-tauri/src/photos/repository.rs:724` — another transaction site
- `src-tauri/src/photos/repository.rs:868` — another transaction site

**Current:** Each site does `conn.execute("BEGIN", [])`, runs a closure, then `conn.execute("COMMIT"` or `ROLLBACK")`. Error handling varies.

**Fix:** `fn with_transaction<T>(conn: &Connection, f: impl FnOnce() -> Result<T>) -> Result<T>` that handles BEGIN/COMMIT/ROLLBACK uniformly. Or use `rusqlite::Transaction`.

**Effort:** SMALL
**Dependencies:** None

---

### MIS-02: Dynamic SQL placeholder generation duplicated 4+ times [MEDIUM]

**Files:**
- `src-tauri/src/photos/repository.rs` — multiple functions build `"?,?,?"` strings for IN clauses

**Current:** `let placeholders = ids.iter().map(|_| "?").collect::<Vec<_>>().join(",")` pattern repeated.

**Fix:** `fn in_clause_params(count: usize) -> String` helper.

**Effort:** SMALL (TRIVIAL per site, SMALL total)
**Dependencies:** None

---

### MIS-03: Hardcoded thumbnail size 256x256 [LOW]

**Files:**
- `src-tauri/src/import/thumbnails.rs:125` — `resize_to_fill(256, 256, ...)`
- `src-tauri/src/import/thumbnails.rs:142` — same in `generate_thumbnail_from_bytes`

**Current:** Magic number repeated.

**Fix:** `const THUMBNAIL_SIZE: u32 = 256;`

**Effort:** TRIVIAL
**Dependencies:** None

---

### MIS-04: Cache dir path construction repeated 5+ places [LOW]

**Files:**
- `src-tauri/src/commands/import.rs` — multiple functions build `project_dir.join("cache").join("thumbnails")`

**Current:** Same path construction scattered across command functions.

**Fix:** `fn thumbnail_cache_dir(gemkeep_home: &Path, slug: &str) -> PathBuf`.

**Effort:** TRIVIAL
**Dependencies:** None

---

### MIS-05: list_representative_photos_for_lp_ids returns 4-element tuple [LOW]

**Files:**
- `src-tauri/src/photos/repository.rs:369-379`

**Current:** Returns `Vec<(i64, PathBuf, PhotoFormat, Option<u16>)>` — a 4-element tuple that is hard to read at call sites.

**Fix:** Define `ThumbnailTarget { lp_id: i64, path: PathBuf, format: PhotoFormat, orientation: Option<u16> }` struct.

**Effort:** SMALL
**Dependencies:** DUP-02 (thumbnail pool unification would benefit from this struct)

---

### MIS-06: String-typed decision status instead of union type [LOW] [RESOLVED - 2026-03-18]

**Files:**
- Frontend TypeScript files — decision status passed as `string`

**Current:** Decision status is an untyped string. Typos compile fine.

**Fix:** `type DecisionStatus = "undecided" | "keep" | "reject"` union type.

**Effort:** TRIVIAL
**Dependencies:** None

---

## 5. Dead Code / Over-engineering

### DEAD-01: ThumbnailStrategy.use_exif_fast_path computed but never read [MEDIUM]

**Files:**
- `src-tauri/src/import/thumbnails.rs:224-249` — `thumbnail_strategy()` sets `use_exif_fast_path`
- `src-tauri/src/import/pipeline.rs:316-322` — only `strategy.num_threads` is read

**Current:** The `use_exif_fast_path` field is computed based on batch size but never checked anywhere. `generate_thumbnail()` always attempts the EXIF fast path regardless.

**Fix:** Either wire `use_exif_fast_path` into `generate_thumbnail()` to control behavior, or remove the field and simplify `thumbnail_strategy()` to return just `num_threads`.

**Effort:** TRIVIAL
**Dependencies:** None

---

### DEAD-02: generate_thumbnail_from_bytes is dead code [LOW]

**Files:**
- `src-tauri/src/import/thumbnails.rs:143-161`

**Current:** Annotated with `#[cfg_attr(not(test), allow(dead_code))]`. Not called from production code.

**Fix:** Remove entirely, or move to `#[cfg(test)]` if used only in tests.

**Effort:** TRIVIAL
**Dependencies:** None

---

### DEAD-03: merges table appears dead/legacy [MEDIUM]

**Files:**
- `src-tauri/src/db/migrations.rs` — creates `merges` table
- No production code reads from it

**Current:** Table exists in migration but may not be used by current code (manual_merges is the active table).

**Fix:** Audit usage. If truly dead, remove from migration or add a migration to drop it.

**Effort:** TRIVIAL (audit) / SMALL (migration change)
**Dependencies:** Must verify no code references it

---

### DEAD-04: find_missing_thumbnail_targets unnecessary wrapper [MEDIUM]

**Files:**
- `src-tauri/src/commands/import.rs:398-415`

**Current:** `pub(crate) fn find_missing_thumbnail_targets(...)` is a one-line delegation to `pipeline::find_missing_thumbnail_targets(...)`. No transformation, no added error handling.

**Fix:** Call `pipeline::find_missing_thumbnail_targets` directly from call sites. Remove wrapper.

**Effort:** TRIVIAL
**Dependencies:** None

---

### DEAD-05: Two separate restack implementations [LOW]

**Files:**
- `src-tauri/src/commands/import.rs:541-570` — command-level restack
- `src-tauri/src/import/pipeline.rs:567-699` — `restack_from_existing_photos`

**Current:** Two different restack code paths. May have diverged in behavior.

**Fix:** Audit call sites. Ensure single implementation in `pipeline.rs`, command layer delegates.

**Effort:** SMALL
**Dependencies:** DUP-01 (unifying burst algorithm simplifies this)

---

### DEAD-06: Two redundant dispatch functions for EXIF extraction [LOW]

**Files:**
- `src-tauri/src/import/exif.rs:309-314` — `extract_exif(path, format)` dispatches on PhotoFormat
- `src-tauri/src/import/exif.rs:322-333` — `extract_metadata(path)` dispatches on file extension

**Current:** Both do the same thing (call `extract_jpeg_exif` or `extract_raw_exif`) but take different inputs. Call sites use one or the other depending on whether they have a `PhotoFormat` or just a path.

**Fix:** Have `extract_metadata` call `extract_exif` internally after resolving format from extension. Or remove `extract_metadata` and require callers to resolve format first.

**Effort:** SMALL
**Dependencies:** DUP-05 (shared extension list)

---

### DEAD-07: Redundant cancel check in pipeline step 3 [LOW]

**Files:**
- `src-tauri/src/import/pipeline.rs:138-153`

**Current:** Three consecutive cancel checks where two would suffice.

**Fix:** Remove the redundant check.

**Effort:** TRIVIAL
**Dependencies:** None

---

## 6. Bugs Found During Analysis

These are not refactoring items but actual bugs discovered during the code improvement analysis. Listed here for visibility.

### BUG-01: insert_photo does not write Sprint 7 camera parameter columns [HIGH] [RESOLVED - 2026-03-07]

**Files:**
- `src-tauri/src/photos/repository.rs:47-68`

**Current:** `insert_photo()` writes `path, format, capture_time, orientation, camera_model, lens` but not the Sprint 7 columns (aperture, shutter_speed, iso, focal_length, exposure_comp). These columns exist in the schema but are never populated during import.

**Fix:** Extend `insert_photo` signature or add `update_camera_params()` called after insert.

**Effort:** SMALL
**Dependencies:** None

---

### BUG-02: load_existing_scanned_files has no project scoping [HIGH] [RESOLVED - 2026-03-07]

**Files:**
- `src-tauri/src/photos/repository.rs:466`

**Current:** `SELECT ... FROM photos` with no WHERE clause on project. If multiple projects share the same DB (they don't currently, but the API suggests they could), this returns all photos.

**Fix:** Add `WHERE project_id = ?1` or join through logical_photos to scope by project.

**Effort:** SMALL
**Dependencies:** None

---

### BUG-03: undo_last_merge deactivates ALL manual_merges, not just the last [MEDIUM] [RESOLVED - 2026-03-07]

**Files:**
- `src-tauri/src/photos/repository.rs:755` (approximate)

**Current:** Undo operation marks all manual merge records as inactive instead of targeting the specific last merge.

**Fix:** Scope the UPDATE to the most recent merge (by timestamp or ID).

**Effort:** MEDIUM
**Dependencies:** None

---

### BUG-04: get_stack_decisions is an N+1 query [HIGH] [RESOLVED - 2026-03-07]

**Files:**
- `src-tauri/src/commands/decisions.rs:196-213`

**Current:** Queries all logical_photos in a stack, then loops and runs a separate `SELECT current_status FROM logical_photos WHERE id = ?1` for each one. The data was already available from the first query.

**Fix:** Include `current_status` in the initial query. Single SQL statement.

**Effort:** SMALL
**Dependencies:** None

---

### BUG-05: SingleView does not update roundStatus after decisions [MEDIUM] [RESOLVED - 2026-03-07]

**Files:**
- `src/lib/components/screens/SingleView.svelte`

**Current:** After a keep/reject decision, the visual round status indicator does not refresh.

**Fix:** Call status refresh after decision invoke completes.

**Effort:** SMALL
**Dependencies:** DUP-06 (decision handler extraction)

---

### BUG-06: formatCaptureTime mixes local and UTC [MEDIUM] [RESOLVED - 2026-03-07]

**Files:**
- Frontend utility function

**Current:** Timestamp formatting inconsistently uses local vs UTC timezone, leading to times displayed with wrong offset.

**Fix:** Standardize on local time for display (photos are taken in local time).

**Effort:** SMALL
**Dependencies:** None

---

### BUG-07: Pause only works during EXIF extraction, not thumbnail generation [MEDIUM]

**Files:**
- `src-tauri/src/import/pipeline.rs:143-148` — pause check in EXIF loop
- `src-tauri/src/import/pipeline.rs:332-360` — no pause check in thumbnail par_iter

**Current:** The pause `AtomicBool` is checked during EXIF extraction but not inside the rayon thumbnail loop. Clicking Pause during thumbnail generation has no effect.

**Fix:** Add `pause.load(Ordering::SeqCst)` check inside the `par_iter` closure, with a spin-wait or `thread::park` loop.

**Effort:** SMALL
**Dependencies:** DUP-02 (if thumbnail loop is unified, fix goes in one place)

---

## 7. Svelte Frontend (from code audit)

### SVE-01: hjkl-to-Arrow key mapping duplicated across 3 screens [HIGH] [RESOLVED - 2026-03-20]

**Files:** StackOverview.svelte, StackFocus.svelte, SingleView.svelte

**Fix applied:** Extracted `mapVimKey()` to `src/lib/utils/keyboard.ts`. StackOverview and StackFocus now use it (commit `c319197`). SingleView uses h/l only (no grid), not yet migrated but low priority.

---

### SVE-02: Grid navigation with clamping duplicated between StackOverview and StackFocus [HIGH] [RESOLVED - 2026-03-20]

**Files:** StackOverview.svelte, StackFocus.svelte

**Fix applied:** Extracted `gridNavigate()` to `src/lib/utils/keyboard.ts` with 18 unit tests. Both screens use it (commit `c319197`). StackOverview went from 12 lines of inline clamping to 2 function calls. StackFocus same.

---

### SVE-05: Decision key handling (Y/X/U) duplicated across 3 screens [HIGH]

**Files:**
- `src/lib/components/screens/StackFocus.svelte`
- `src/lib/components/screens/SingleView.svelte`
- `src/lib/components/screens/ComparisonView.svelte`

**Current:** All three screens inline the same 4-step pattern: guard committed state, call makeDecision/undoDecision, update local decisions state, refresh roundStatus. `decisions.ts` has `handleDecisionKey()` extracted but no screen uses it (dead code).

**Fix:** Wire screens to use `handleDecisionKey()` from `decisions.ts`, passing screen-specific post-decision callbacks. Ensure it routes through `src/lib/api/index.ts`.

**Effort:** MEDIUM
**Dependencies:** None (SVE-01/02 resolved)

---

### SVE-10: StackOverview is a 642-line god component [HIGH] [RESOLVED - 2026-03-20]

**Files:** `src/lib/components/screens/StackOverview.svelte` (519 lines, down from 642)

**What was addressed:**
- Keyboard navigation extracted to shared utility (SVE-01/02)
- Selection unified to SelectionState (SVE-12 resolved)
- BurstGapModal extracted to own component (43 lines)
- IndexingPanel extracted to own component (147 lines)
- Selection bug fixed (S-key persists, click-to-select)
- Per-project indexing context (global state leak fixed)

---

### SVE-11: StackFocus handleKey is 245 lines [HIGH] [PARTIAL - 2026-03-20]

**Files:** `src/lib/components/screens/StackFocus.svelte:78-310` (now ~232 lines, down from 245)

**What was addressed:** Grid navigation section reduced from 30 lines to 10 using `mapVimKey()`/`gridNavigate()`. Shift+Arrow handler simplified.

**What remains:**
- Decision keys (Y/X/U) still inline (~45 lines) — depends on SVE-05
- Tab/Shift+Tab undecided jump still inline (~30 lines) — could use shared utility
- Still sequential if/return structure, not declarative key map
- Target: ~80 lines after SVE-05 extraction + declarative routing

**Effort:** SMALL (remaining work after SVE-05)
**Dependencies:** SVE-05

---

### UX-01: Stack ID display inconsistent after merges [MEDIUM]

**Files:** `src/lib/components/screens/StackFocus.svelte` (header line showing Stack #N)

**Current:** Header shows `Stack #{stackId}` where `stackId` is the DB primary key. After merges, IDs are non-sequential (e.g., Stack #20 when the overview shows it as the 12th card). Confusing to the user.

**Fix:** Remove stack ID display from the header entirely. The stack position in the grid is sufficient context. If an identifier is needed, show stack number (position in the grid), not DB ID.

**Effort:** SMALL
**Dependencies:** None

---

## Summary by Effort

| Effort | Total | Resolved | Remaining |
|--------|-------|----------|-----------|
| TRIVIAL | 13 | 2 | 11 |
| SMALL | 20 | 8 | 12 |
| MEDIUM | 8 | 2 | 6 |
| LARGE | 2 | 0 | 2 |
| **Total** | **43** | **12** | **31** |

### Resolved Items (2026-03-07)
- BUG-01: insert_photo camera params — extended with 5 columns + 6 regression tests
- BUG-02: load_existing_scanned_files project scoping — JOIN through logical_photos
- BUG-03: undo_last_merge — targeted WHERE with manual_merge_id
- BUG-04: get_stack_decisions N+1 — single SQL with COALESCE
- BUG-05: SingleView roundStatus — getRoundStatus() after makeDecision
- BUG-06: formatCaptureTime — consistent local time + regression test
- DUP-01: burst stacking — extracted generic burst_group()
- DUP-02: thumbnail pool — extracted run_thumbnail_pool()
- DUP-03: camera model — extracted format_camera_model()
- DUP-08: with_open_project — unified in commands/mod.rs

### Resolved Items (2026-03-18)
- DUP-11: RAW/JPEG badge markup — centralized in PhotoFrame's FormatBadge
- MIS-06: String-typed decision status — DecisionStatus is now a properly typed string union used consistently

## Recommended Execution Order

1. **Quick wins (TRIVIAL, no dependencies):** DUP-05, DEAD-01, DEAD-02, DEAD-04, DEAD-07, MIS-03, MIS-04
2. **High-value SMALL items:** DUP-04 (stack_id_map), ABS-03 (pipeline params), ABS-04 (make_decision SQL)
3. **Frontend cleanup:** DUP-06 + DUP-07 (decision handling), DUP-09 (Esc), DUP-10 (progress)
4. **Infrastructure:** MIS-01 (transaction helper), MIS-02 (SQL placeholders), INC-01 (error types)
5. **Large refactors (defer to dedicated sprint):** ABS-01 (camera abstraction), ABS-02 (ExifSource trait)
