# Test Improvements: Prioritized Refactoring List

This document catalogs test-level improvements across the GemKeep codebase, focused on migrating tests to use `TestLibraryBuilder` as the single source of truth and eliminating test setup duplication. Organized by category and sorted by severity within each category.

**Exemplar files (do not modify, use as reference):**
- `orientation_tests.rs` — gold-standard TestLibraryBuilder usage (5-camera × 8-orientation matrix)
- `metadata_tests.rs` — gold-standard manifest-driven fixture pattern (`for_each_fixture`)
- `asset_scope_tests.rs` — exemplary regression test documenting a real bug

## Completion Status

| Item | Status | Commit | Notes |
|------|--------|--------|-------|
| GAP-01 | DONE | `4464628` | Per-photo configurable capture_time |
| GAP-02 | DONE | `5ea69d3` | DB-only build mode |
| GAP-03 | DONE | `3ebec5e`, `0c1c78f` | Stack layout control + burst timestamps |
| GAP-04 | DONE | `f45f4ac` | CameraParams support |
| GAP-05 | DONE | `5c9cd6f` | Multi-project (with_project_name) |
| TB-01 | NOT STARTED | — | Blocked on nothing now (GAP-01 done) |
| TB-02 | NOT STARTED | — | Blocked on nothing now (GAP-01 done) |
| TB-03 | NOT STARTED | — | Optional (GAP-05 done) |
| TB-04 | SKIPPED | — | Low priority, needs Builder layout changes |
| SQL-01 | NOT STARTED | — | Unblocked (GAP-02 done) |
| SQL-02 | NOT STARTED | — | Unblocked (GAP-02 + GAP-04 done) |
| SQL-03 | NOT STARTED | — | Unblocked (GAP-02 + GAP-03 done) |
| SQL-04 | NOT STARTED | — | Unblocked (GAP-03 done) |
| SQL-05 | NOT STARTED | — | No dependencies |
| SQL-06 | DONE | `c8ae1b1` | Verification helpers extracted |
| SD-01 | NOT STARTED | — | Unblocked (GAP-01 done) |
| SD-02 | NOT STARTED | — | No dependencies |
| SD-03 | DONE | `fefe8a3` | Used setup_project_with_photos |
| SD-04 | DONE | `fefe8a3` | Extracted setup_ipc_with_photos (6 tests) |
| SD-05 | DONE | `fefe8a3` | Extracted setup_ipc_home (21 uses) |
| SD-06 | SKIPPED | — | Intentionally independent setup |
| TH-01 | DONE | `c8ae1b1` | count_thumbnails + existing_thumbnail_set |
| TH-02 | DONE | `c8ae1b1` | get_lp_ids helper |
| TH-03 | DONE | `c8ae1b1` | get_status helper |
| TH-04 | SKIPPED | — | No change needed (appropriate unit test) |
| FE-01 | DONE | `42827b3` | IDLE_STATUS extracted to fixtures.ts |
| FE-02 | DONE | `42827b3` | PHOTO_1/2/3 + makePhoto() factory |
| FE-03 | DONE | `42827b3` | OPEN_ROUND + makeRoundStatus/makeDecisionStatus |
| FE-04 | DONE | `bcb6ed0` | renderStackOverview() shared helper |
| FE-05 | DONE | `bc874b9` | mockStackFocusMount() extraction |
| FE-06 | DONE | `bc874b9` | mockMountSequence() extraction |
| FE-07 | DONE | `bcb6ed0` | resetInvokeMock() shared helper |
| FE-08 | DONE | `bcb6ed0` | makePhotoList() + makeDecisionList() factories |
| FE-09 | DONE | `42827b3` | makeStack() factory |
| FE-10 | DONE | `42827b3` | makeDecisionResult() factory |
| FE-11 | DONE | `bcb6ed0` | waitForCards() shared browser helper |
| FE-12 | DONE | `bc874b9` | Mock factories shared module |
| TQ-01 | DONE | — | Exact assertions in pipeline tests |
| TQ-02 | DONE | — | Post-commit rejection assertion added |
| TQ-03 | SKIPPED | — | Depends on SQL-05 |
| TQ-04 | DONE | — | DECISION_SELECTORS already in use |
| TQ-05 | DONE | — | setTimeout pattern appropriate for negative assertions |
| TQ-06 | SKIPPED | — | Low priority thin wrapper |
| TQ-07 | DONE | — | Negative slug assertions in corrupt project tests |

**Summary:** 29/44 items completed, 5 skipped, 10 remaining (SQL-01–05, TB-01–03, SD-01, SD-02).

---

## 0. TestLibraryBuilder API Gaps

These capabilities must be added to `TestLibraryBuilder` before the migrations in sections 1–2 can proceed.

### GAP-01: Per-photo configurable capture_time [HIGH] — RESOLVED

**Files:** `src-tauri/src/import/test_fixtures.rs`

**Current:** `build_jpeg_with_exif()` hardcodes `"2024:06:15 12:00:00"` as DateTimeOriginal. `PhotoSpec` has no `capture_time` field.

**Fix:** Add `capture_time: Option<String>` to `PhotoSpec`. Update `build_jpeg_with_exif` and `build_exif_app1` to accept a configurable datetime parameter. Default to `"2024:06:15 12:00:00"` when `None`.

**Effort:** SMALL
**Dependencies:** None
**Blocks:** TB-01, SD-01

---

### GAP-02: DB-only build mode (no filesystem) [HIGH] — RESOLVED

**Files:** `src-tauri/src/import/test_fixtures.rs`

**Current:** `TestLibraryBuilder.build()` always creates files on disk. Decision engine tests (`engine.rs`) need only DB state (project, stacks, logical_photos, photos rows) — no files.

**Fix:** Add `.build_db_only()` method that inserts project/stack/logical_photos/photos rows directly into an in-memory DB without creating files on disk. Returns `TestProject` with `conn`, `project_id`, `stack_id`, and `lp_ids`.

**Effort:** MEDIUM
**Dependencies:** None
**Blocks:** SQL-01, SQL-02

---

### GAP-03: Stack layout control [MEDIUM] — RESOLVED

**Files:** `src-tauri/src/import/test_fixtures.rs`

**Current:** Builder creates photos on disk but does NOT insert them into DB stacks. Merge/restack tests need specific stack arrangements (e.g., 3 stacks with [2, 3, 1] photos each).

**Fix:** Add `.with_stack_layout(&[usize])` method that creates specific stack/lp arrangements in DB. Example: `.with_stack_layout(&[3, 2])` creates 2 stacks with 3 and 2 photos respectively.

**Effort:** MEDIUM
**Dependencies:** GAP-02
**Blocks:** SQL-03

---

### GAP-04: Camera parameter support in PhotoSpec [MEDIUM] — RESOLVED

**Files:** `src-tauri/src/import/test_fixtures.rs`

**Current:** `PhotoSpec` has `camera`, `orientation`, `file_type` but no aperture, shutter_speed, iso, focal_length, exposure_comp, lens fields. Tests needing camera params use inline SQL.

**Fix:** Add optional camera parameter fields to `PhotoSpec` or a separate `CameraParams` struct. Builder passes them through to DB rows when using `build_db_only()`.

**Effort:** SMALL
**Dependencies:** GAP-02
**Blocks:** SQL-02

---

### GAP-05: Multi-project support [LOW] — RESOLVED

**Files:** `src-tauri/src/import/test_fixtures.rs`

**Current:** Builder hardcodes a single project (`'test-builder'`). Project isolation tests (BUG-02) need 2+ projects in the same DB.

**Fix:** Added `.with_project_name(name)` to customize the project name/slug for both `build()` and `build_db_only()` paths. For multi-project boundary testing, create two separate builders with different names — each gets its own TempDir and DB.

**Effort:** SMALL
**Dependencies:** None
**Blocks:** None

**FUTURE:** GemKeep uses one DB per project (not shared). Real multi-project file boundary testing (verifying project A's pipeline doesn't reach into project B's file tree) will need a higher-level `MultiProjectBuilder` or similar. Deferred until concrete test needs it — current `with_project_name()` gives the foundation.

---

## 1. Builder Migration Opportunities

Tests using ad-hoc file creation / inline EXIF that should use TestLibraryBuilder.

### TB-01: Burst-stacking tests use manual TIFF/EXIF byte construction [MEDIUM]

**Files:** `src-tauri/src/import/integration_tests.rs`

**Current:** `test_pipeline_stacks_from_exif_timestamps`, `test_pipeline_stacks_gap_splits`, `test_restack_preserves_logical_photo_ids`, `test_restack_during_active_thumbnails_does_not_interfere` use `write_jpeg_with_timestamp()` which manually constructs 76 lines of TIFF IFD bytes for DateTimeOriginal. This duplicates what `build_jpeg_with_exif` in TestLibraryBuilder already does.

**Fix:** Once GAP-01 is resolved, use `TestLibraryBuilder::new().add_photo(PhotoSpec { camera: Synthetic, orientation: 1, file_type: Jpeg, capture_time: Some("2024:03:15 10:00:00".into()) })`.

**Effort:** SMALL
**Dependencies:** GAP-01
**Affected tests:** `test_pipeline_stacks_from_exif_timestamps`, `test_pipeline_stacks_gap_splits`, `test_restack_preserves_logical_photo_ids`, `test_restack_during_active_thumbnails_does_not_interfere`

---

### TB-02: Tests needing valid decodable JPEGs with timestamps [LOW]

**Files:** `src-tauri/src/import/integration_tests.rs`

**Current:** `write_valid_jpeg_with_timestamp()` creates a 50×50 RGB image then splices EXIF APP1 header — 120 lines of byte manipulation. TestLibraryBuilder's `build_jpeg_with_exif()` creates 4×4 decodable JPEGs with EXIF already.

**Fix:** After GAP-01, replace `write_valid_jpeg_with_timestamp()` calls with Builder-created photos. The 4×4 size is sufficient for pipeline tests.

**Effort:** SMALL
**Dependencies:** GAP-01
**Affected tests:** `test_pipeline_stacks_from_exif_timestamps`, `test_pipeline_stacks_gap_splits`

---

### TB-03: BUG-01/02 regression tests use Builder but still do manual insert_photo [MEDIUM]

**Files:** `src-tauri/src/photos/repository.rs`

**Current:** `test_insert_photo_roundtrips_camera_params` and `test_load_existing_scanned_files_project_isolation` create a `TestLibraryBuilder` project just for `conn` + `project_id`, then manually call `insert_photo`/`insert_stack`/`insert_logical_photo` with raw SQL. The Builder photo is unused.

**Fix:** For BUG-01 tests that test `insert_photo` itself, inline SQL is actually appropriate. For BUG-02 project isolation, Builder could create both projects if it supported multi-project setup (GAP-05). Low priority since tests are correct.

**Effort:** SMALL
**Dependencies:** GAP-05 (optional)
**Affected tests:** `test_insert_photo_roundtrips_camera_params`, `test_insert_photo_camera_params_none_stays_null`, `test_load_existing_scanned_files_project_isolation`, `test_load_existing_scanned_files_returns_camera_params`

---

### TB-04: ipc_tests.rs setup_project_with_photos could use TestLibraryBuilder [LOW] — SKIPPED

**Files:** `src-tauri/src/commands/ipc_tests.rs`

**Current:** `setup_project_with_photos()` manually writes minimal JPEGs and calls `run_pipeline()`. TestLibraryBuilder could provide the photos, but the IPC tests need an on-disk project layout compatible with Tauri's `gemkeep_home()` path structure.

**Fix:** If Builder supported configurable project directories matching the production layout, IPC tests could use it. Low priority — current setup works.

**Effort:** MEDIUM
**Dependencies:** Builder would need project directory layout matching production
**Affected tests:** `setup_project_with_photos`, `ipc_list_logical_photos_empty_stack`

---

## 2. Inline SQL Setup Replacement

Tests manually INSERT-ing rows when Builder + pipeline could create realistic data.

### SQL-01: engine.rs setup_test_db() — 50 lines of inline SQL [HIGH]

**Files:** `src-tauri/src/decisions/engine.rs`

**Current:** `setup_test_db()` manually INSERTs into projects, stacks, photos, and logical_photos tables (lines 272-321). This 50-line function hand-rolls DB setup that mirrors what `TestLibraryBuilder.build_db_only()` would produce. Used by 10 tests.

**Fix:** Once GAP-02 is resolved, replace with `TestLibraryBuilder::new().add_photo(...).repeat(n).build_db_only()`. Returns `(conn, project_id, stack_id, Vec<lp_id>)`.

**Effort:** SMALL (after GAP-02)
**Dependencies:** GAP-02
**Affected tests:** `test_find_or_create_round_creates_round_1`, `test_find_or_create_round_reuses_existing`, `test_make_decision_keep`, `test_make_decision_eliminate`, `test_decision_re_decide_overwrites`, `test_decision_updates_current_status`, `test_decision_audit_log_append_only`, `test_undo_decision_sets_undecided`, `test_round_auto_created_on_first_decision`, `test_get_round_status_counts`

---

### SQL-02: Photo-detail tests duplicate full project+stack+photo SQL setup [HIGH]

**Files:** `src-tauri/src/decisions/engine.rs`

**Current:** Tests `test_get_photo_detail_with_camera_params`, `test_get_photo_detail_missing_params`, `test_get_photo_detail_pair_has_both_paths`, and `test_bug1_get_photo_detail_finds_thumbnail` each manually create project, stack, photos, and logical_photos with 15-40 lines of raw SQL. The pair test and bug1 test also duplicate the RAW+JPEG pair creation pattern.

**Fix:** Extract `setup_test_db_with_pair()` helper for RAW+JPEG tests. For camera-params tests, use Builder with GAP-04 (camera parameter support).

**Effort:** SMALL
**Dependencies:** GAP-02, GAP-04 (for camera params variant)
**Affected tests:** `test_get_photo_detail_with_camera_params`, `test_get_photo_detail_missing_params`, `test_get_photo_detail_pair_has_both_paths`, `test_bug1_get_photo_detail_finds_thumbnail_with_correct_filename`

---

### SQL-03: repository.rs setup_merge_test_db — 50+ lines of inline SQL [HIGH]

**Files:** `src-tauri/src/photos/repository.rs`

**Current:** `setup_merge_test_db()` (lines 1145-1197) manually creates in-memory DB, runs migrations, inserts project row, then loops calling `insert_photo` with 11 `None` args and `insert_logical_photo`. Used by 11 merge/undo/restack tests.

**Fix:** Once GAP-02 + GAP-03 are resolved, use `TestLibraryBuilder::new().add_photo(...).repeat(n).with_stack_layout(&[3, 3]).build_db_only()`.

**Effort:** SMALL (after GAP-02 + GAP-03)
**Dependencies:** GAP-02, GAP-03
**Affected tests:** `test_merge_two_stacks`, `test_merge_three_stacks`, `test_merge_logs_transaction`, `test_merge_creates_manual_merge_record`, `test_merge_invalid_single_stack`, `test_merge_nonexistent_stack`, `test_undo_merge_restores_stacks`, `test_undo_merge_no_merges`, `test_restack_preserves_manual_merges`, `test_undo_last_merge_preserves_earlier_merge`, `test_undo_merge_only_deactivates_target_manual_merge`

---

### SQL-04: repository.rs representative-photos and logical-photo-count tests [MEDIUM]

**Files:** `src-tauri/src/photos/repository.rs`

**Current:** `test_list_representative_photos_for_lp_ids_returns_correct_rows` and `test_logical_photo_count_is_one_for_raw_jpeg_pair` manually INSERT INTO projects, call `insert_photo` with 11 positional params (most `None`), then `insert_stack`, `insert_logical_photo`. TestLibraryBuilder already handles project creation.

**Fix:** Use `TestLibraryBuilder::new().add_photo(Canon, 1, Both).build()` for RAW+JPEG pair test. For representative photos test, use Builder with stack layout.

**Effort:** SMALL
**Dependencies:** GAP-03 (for stack layout)
**Affected tests:** `test_list_representative_photos_for_lp_ids_returns_correct_rows`, `test_logical_photo_count_is_one_for_raw_jpeg_pair`

---

### SQL-05: test_decision_applies_to_pair — 90 lines of RAW+JPEG pair SQL [MEDIUM]

**Files:** `src-tauri/src/decisions/engine.rs`

**Current:** `test_decision_applies_to_pair` (lines 547-639) manually creates a full project, stack, two photos (RAW + JPEG), and a logical_photo linking them — 90 lines of raw SQL. Duplicated in `test_get_photo_detail_pair_has_both_paths`.

**Fix:** Extract `setup_test_db_pair() -> (Connection, i64, i64, i64)` returning (conn, project_id, stack_id, lp_id) with RAW+JPEG pair pre-created. Both tests then focus on their specific assertions.

**Effort:** SMALL
**Dependencies:** None (can extract helper without Builder changes)
**Affected tests:** `test_decision_applies_to_pair`, `test_get_photo_detail_pair_has_both_paths`

---

### SQL-06: Repetitive inline SQL verification in merge/undo tests [MEDIUM] — RESOLVED

**Files:** `src-tauri/src/photos/repository.rs`

**Current:** Merge and undo tests repeat the same SQL verification queries (count stacks, count logical_photos per stack, check transaction log). Each test has 5-10 lines of nearly identical verification SQL.

**Fix:** Extract verification helpers: `fn assert_stack_count(conn, project_id, expected)`, `fn assert_lp_in_stack(conn, stack_id, expected_count)`, `fn assert_transaction_logged(conn, project_id, expected_type)`.

**Effort:** SMALL
**Dependencies:** None
**Affected tests:** All 11 merge/undo tests in repository.rs

---

## 3. Setup Duplication

Duplicated helper functions and setup patterns across test files.

### SD-01: Four ad-hoc JPEG writer functions in integration_tests.rs [HIGH]

**Files:** `src-tauri/src/import/integration_tests.rs`

**Current:** `write_minimal_jpeg()`, `write_valid_jpeg()`, `write_valid_jpeg_with_timestamp()`, and `write_jpeg_with_timestamp()` — four separate functions (200+ total lines) for creating test JPEG files with varying levels of EXIF data and image validity. TestLibraryBuilder's `build_jpeg_with_exif()` already creates decodable JPEGs with Make, Model, Orientation, and DateTimeOriginal EXIF.

**Fix:** Delete all four. Replace with TestLibraryBuilder (after GAP-01). For tests needing non-decodable JPEGs (`test_pipeline_partial_errors`, `test_thumbnails_done_counter_not_incremented_for_failed_thumbnail`), keep explicit inline corrupt-file writes.

**Effort:** MEDIUM
**Dependencies:** GAP-01
**Affected tests:** 26 tests in integration_tests.rs

---

### SD-02: setup() + make_status/cancel/pause/counter boilerplate in every pipeline test [HIGH]

**Files:** `src-tauri/src/import/integration_tests.rs`

**Current:** Every test calls `setup()` then `make_status()`, `make_cancel()`, `make_pause()`, `make_counter()` separately. The `pipeline::run_pipeline()` call takes 10 arguments and is copy-pasted ~20 times with only minor variations (folder path, burst_gap_secs). The actual test behavior is buried under boilerplate.

**Fix:** Create `PipelineTestHarness` struct that wraps conn, tmp, project_id, status, cancel, pause, counter and exposes `run(&self, folder, burst_gap) -> ImportStats`. Reduces 15-line setup + call blocks to 2-3 lines.

**Effort:** MEDIUM
**Dependencies:** None
**Affected tests:** 23 tests in integration_tests.rs

---

### SD-03: ipc_tests.rs inline setup duplicates setup_project_with_photos [MEDIUM] — RESOLVED

**Files:** `src-tauri/src/commands/ipc_tests.rs`

**Current:** `ipc_list_logical_photos_empty_stack` (lines 243-364) independently creates a project on disk, writes minimal JPEGs, sets up `Arc<Mutex<IndexingStatus>>`/`AtomicBool`/`AtomicUsize`, and calls `run_pipeline()`. The existing `setup_project_with_photos()` helper does the same thing but was never used here.

**Fix:** Refactor `ipc_list_logical_photos_empty_stack` to use `setup_project_with_photos(tmp, 1)` instead of its 60-line inline setup.

**Effort:** SMALL
**Dependencies:** None
**Affected tests:** `ipc_list_logical_photos_empty_stack`

---

### SD-04: IPC decision tests repeat open_project + list_stacks + list_logical_photos sequence [MEDIUM] — RESOLVED

**Files:** `src-tauri/src/commands/ipc_tests.rs`

**Current:** At least 5 IPC tests repeat the same 20-line sequence: `setup_project_with_photos`, `make_app`, `open_project` via IPC, `list_stacks` via IPC, extract `stack_id`, `list_logical_photos` via IPC, extract `lp_ids`.

**Fix:** Extract `setup_ipc_with_photos(num_photos) -> (WebviewWindow, i64, Vec<i64>)` returning the webview, stack_id, and lp_ids.

**Effort:** SMALL
**Dependencies:** None
**Affected tests:** `test_ipc_get_round_status_json_shape`, `test_ipc_get_photo_detail_json_shape`, `test_ipc_get_round_decisions_json_shape`, `test_ipc_commit_round_then_decision_rejected`, `test_ipc_make_decision_json_shape`

---

### SD-05: IPC tests repeat TempDir + home + create_dir_all(projects) boilerplate [LOW] — RESOLVED

**Files:** `src-tauri/src/commands/ipc_tests.rs`

**Current:** Multiple tests create `TempDir`, construct home path, `create_dir_all(home.join("projects"))` independently.

**Fix:** Extract `setup_ipc_home() -> (TempDir, PathBuf)` helper.

**Effort:** TRIVIAL
**Dependencies:** None
**Affected tests:** Multiple IPC tests

---

### SD-06: projects/integration_tests.rs repeated home + projects dir creation [LOW] — SKIPPED

**Files:** `src-tauri/src/projects/integration_tests.rs`

**Current:** Repeated `home + projects` dir creation pattern across tests. However, since these tests exercise the project lifecycle itself, the setup is intentionally independent.

**Fix:** Extract `setup_test_home() -> (TempDir, PathBuf)` if DRY is desired. Low priority — current approach is appropriate for integration tests.

**Effort:** TRIVIAL
**Dependencies:** None
**Affected tests:** Project lifecycle tests

---

## 4. Missing Test Helpers / Factories

Patterns repeated 3+ times that should be extracted.

### TH-01: Thumbnail count and existing_thumbs set construction [MEDIUM] — RESOLVED

**Files:** `src-tauri/src/import/integration_tests.rs`

**Current:** 6+ tests construct `existing_thumbs: HashSet<PathBuf>` by reading the thumbnail cache directory, then count thumbnails. Same 4-line pattern each time.

**Fix:** Extract `fn count_thumbnails(cache_dir: &Path) -> usize` and `fn existing_thumbnail_set(cache_dir: &Path) -> HashSet<PathBuf>` helpers.

**Effort:** TRIVIAL
**Dependencies:** None
**Affected tests:** 6+ thumbnail-related tests in integration_tests.rs

---

### TH-02: LP ID query pattern repeated across tests [MEDIUM] — RESOLVED

**Files:** `src-tauri/src/import/integration_tests.rs`

**Current:** The pattern `conn.query_row("SELECT id FROM logical_photos...", |row| row.get(0))` appears in 4+ tests with minor variations.

**Fix:** Extract `fn get_lp_ids(conn: &Connection, project_id: i64) -> Vec<i64>` helper.

**Effort:** TRIVIAL
**Dependencies:** None
**Affected tests:** 4+ tests in integration_tests.rs

---

### TH-03: current_status query pattern in engine.rs [MEDIUM] — RESOLVED

**Files:** `src-tauri/src/decisions/engine.rs`

**Current:** `conn.query_row("SELECT current_status FROM logical_photos WHERE id = ?1", params![lp_id], |row| row.get(0))` appears 8 times — a 4-line block each time.

**Fix:** Extract `fn get_status(conn: &Connection, lp_id: i64) -> String`. Reduces assertions to: `assert_eq!(get_status(&conn, lp_id), "keep")`.

**Effort:** TRIVIAL
**Dependencies:** None
**Affected tests:** `test_make_decision_keep`, `test_make_decision_eliminate`, `test_decision_re_decide_overwrites`, `test_decision_updates_current_status`, `test_decision_applies_to_pair`, `test_undo_decision_sets_undecided`

---

### TH-04: stacks_tests.rs make_group creates ScannedFile with 12 fields manually [LOW] — SKIPPED

**Files:** `src-tauri/src/import/stacks_tests.rs`

**Current:** `make_group()` constructs `ScannedFile` with 12 fields. This is appropriate for unit tests of the stacking algorithm (no DB involved).

**Fix:** No change needed — this is a pure data-construction helper for a unit test. Not a Builder migration candidate.

**Effort:** N/A
**Dependencies:** None

---

## 5. Frontend Test Improvements

Mock dedup, factory extraction, setup consolidation for Vitest tests.

### FE-01: IndexingStatus constants duplicated across StackOverview tests [HIGH] — RESOLVED

**Files:** `src/lib/components/screens/StackOverview.test.ts`, `src/lib/components/screens/StackOverview.browser.test.ts`

**Current:** `IDLE_STATUS` object defined identically in both jsdom and browser test files with 8 fields.

**Fix:** Extract to `src/test/fixtures.ts`: `export const IDLE_STATUS: IndexingStatus = { ... }`.

**Effort:** TRIVIAL
**Dependencies:** None

---

### FE-02: LogicalPhotoSummary test data duplicated across 3 files [HIGH] — RESOLVED

**Files:** `src/lib/components/screens/StackFocus.test.ts`, `src/lib/components/screens/StackFocus.browser.test.ts`, `src/lib/components/screens/SingleView.test.ts`

**Current:** `PHOTO_1`, `PHOTO_2`, `PHOTO_3` objects with identical structure defined independently in each file. Each has `logical_photo_id`, `representative_path`, `has_raw`, `has_jpeg`, `thumbnail_path`, `current_status`.

**Fix:** Extract to `src/test/fixtures.ts`: `export const PHOTO_1: LogicalPhotoSummary = { ... }`. Add a factory: `export function makePhoto(overrides?: Partial<LogicalPhotoSummary>): LogicalPhotoSummary`.

**Effort:** SMALL
**Dependencies:** None

---

### FE-03: RoundStatus and PhotoDecisionStatus duplicated across 3+ files [HIGH] — RESOLVED

**Files:** `src/lib/components/screens/SingleView.test.ts`, `src/lib/components/screens/StackFocus.test.ts`, browser test variants

**Current:** `ROUND_STATUS` and `DECISION_STATUS` objects with identical structure in multiple files.

**Fix:** Extract to `src/test/fixtures.ts` with factory functions.

**Effort:** SMALL
**Dependencies:** None

---

### FE-04: renderStackOverview() helper duplicated between jsdom and browser tests [HIGH] — RESOLVED

**Files:** `src/lib/components/screens/StackOverview.test.ts`, `src/lib/components/screens/StackOverview.browser.test.ts`

**Current:** `renderStackOverview()` helper function is verbatim identical in both files — sets up navigation state, mocks invoke responses, renders component.

**Fix:** Extract to `src/test/helpers.ts` or `src/test/render-helpers.ts`.

**Effort:** SMALL
**Dependencies:** FE-01 (extract IDLE_STATUS first)

---

### FE-05: mockStackFocusMount() helper duplicated across 3 files [HIGH] — RESOLVED

**Files:** `src/lib/components/screens/StackFocus.test.ts`, `src/lib/components/screens/StackFocus.browser.test.ts`, `src/lib/components/screens/SingleView.test.ts`

**Current:** Nearly identical mock setup for mounting StackFocus — mocks `list_logical_photos`, `get_round_status`, `get_round_decisions`.

**Fix:** Extract to shared helper module.

**Effort:** SMALL
**Dependencies:** FE-02, FE-03

---

### FE-06: mockMountSequence() for SingleView duplicated [MEDIUM] — RESOLVED

**Files:** `src/lib/components/screens/SingleView.test.ts`, `src/lib/components/screens/SingleView.browser.test.ts`

**Current:** Same mock mount sequence in both jsdom and browser test files.

**Fix:** Extract to shared helper.

**Effort:** SMALL
**Dependencies:** FE-02, FE-03

---

### FE-07: beforeEach invoke mock reset pattern repeated in 5 files [MEDIUM] — RESOLVED

**Files:** Multiple test files

**Current:** `beforeEach(() => { vi.mocked(invoke).mockReset(); vi.mocked(invoke).mockImplementation(...) })` pattern repeated.

**Fix:** Extract `resetInvokeMock()` to `src/test/setup.ts` or create a `withCleanInvoke()` helper.

**Effort:** TRIVIAL
**Dependencies:** None

---

### FE-08: Ad-hoc LogicalPhotoSummary arrays for navigation tests [HIGH] — RESOLVED

**Files:** `src/lib/components/screens/StackFocus.test.ts`, `src/lib/components/screens/StackFocus.browser.test.ts`

**Current:** Tab/Home/End navigation tests create inline arrays of `LogicalPhotoSummary` objects with specific `current_status` patterns (mix of undecided/keep/reject). Each test constructs similar arrays independently.

**Fix:** Create factory function: `makePhotoList(statuses: string[]): LogicalPhotoSummary[]` that generates a list with specified statuses, auto-generating IDs and paths.

**Effort:** SMALL
**Dependencies:** FE-02

---

### FE-09: StackSummary objects defined ad-hoc [MEDIUM] — RESOLVED

**Files:** Multiple test files using `list_stacks` mock

**Current:** `StackSummary` objects with `stack_id`, `photo_count`, `representative_thumbnail_path`, `created_at` created inline with minor variations.

**Fix:** Add `makeStack(overrides?)` factory to `src/test/fixtures.ts`.

**Effort:** TRIVIAL
**Dependencies:** None

---

### FE-10: DecisionResult mock objects repeated inline [MEDIUM] — RESOLVED

**Files:** `src/lib/components/screens/StackFocus.test.ts`, `src/lib/components/screens/SingleView.test.ts`

**Current:** `{ logical_photo_id, action, new_status, round_id }` objects created inline in 10+ tests.

**Fix:** Add `makeDecisionResult(overrides?)` factory.

**Effort:** TRIVIAL
**Dependencies:** None

---

### FE-11: waitForCards() helper duplicated [MEDIUM] — RESOLVED

**Files:** `src/lib/components/screens/StackOverview.browser.test.ts`, `src/lib/components/screens/StackFocus.browser.test.ts`

**Current:** `waitForCards()` helper with same implementation in both browser test files.

**Fix:** Extract to `src/test/browser-helpers.ts`.

**Effort:** TRIVIAL
**Dependencies:** None

---

### FE-12: browser-setup.ts and setup.ts have overlapping mock definitions [LOW] — RESOLVED

**Files:** `src/test/setup.ts`, `src/test/browser-setup.ts` (if exists)

**Current:** Similar mock definitions in both files.

**Fix:** Factor common mocks into a shared module imported by both.

**Effort:** SMALL
**Dependencies:** None

---

## 6. Test Quality Issues

### TQ-01: Approximate assertions in pipeline tests [MEDIUM] — RESOLVED

**Files:** `src-tauri/src/import/integration_tests.rs`

**Current:** `test_pipeline_full_run` uses `assert!(stats.logical_photos >= 1)` and `test_pipeline_partial_errors` uses `assert!(stacks.len() >= 1)` — approximate assertions that violate testing-rules.md (exact assertions required).

**Fix:** Use exact assertions: `assert_eq!(stats.logical_photos, 2)` based on known input.

**Effort:** TRIVIAL
**Dependencies:** None
**Affected tests:** `test_pipeline_full_run`, `test_pipeline_partial_errors`

---

### TQ-02: test_commit_round_locks_decisions does not test post-commit rejection [LOW] — RESOLVED

**Files:** `src-tauri/src/decisions/engine.rs`

**Current:** Test verifies the round is committed but does not actually attempt a decision on the committed round to verify it's rejected.

**Fix:** Add an assertion that `record_decision()` on a committed round returns an error.

**Effort:** TRIVIAL
**Dependencies:** None
**Affected tests:** `test_commit_round_locks_decisions`

---

### TQ-03: test_decision_applies_to_pair tests setup assumptions, not behavior [LOW] — SKIPPED (depends on SQL-05)

**Files:** `src-tauri/src/decisions/engine.rs`

**Current:** Test spends 90 lines setting up a RAW+JPEG pair, then verifies both photos have the same `current_status`. Most assertions verify the setup is correct rather than testing decision behavior.

**Fix:** If setup is extracted to a helper (SQL-05), the test would focus purely on the behavioral assertion.

**Effort:** TRIVIAL (after SQL-05)
**Dependencies:** SQL-05
**Affected tests:** `test_decision_applies_to_pair`

---

### TQ-04: Frontend tests check className strings instead of DECISION_SELECTORS [MEDIUM] — RESOLVED

**Files:** `src/lib/components/screens/StackFocus.test.ts`, `src/lib/components/screens/StackFocus.browser.test.ts`

**Current:** Tests check raw className strings for decision badges instead of using shared selector constants.

**Fix:** Define `DECISION_SELECTORS` in a shared test utility and use throughout.

**Effort:** SMALL
**Dependencies:** None

---

### TQ-05: Some frontend tests use setTimeout instead of waitFor for negative assertions [LOW] — RESOLVED

**Files:** Various frontend test files

**Current:** Some tests use `setTimeout` delays to check that something did NOT happen, which is flaky.

**Fix:** Use `waitFor` with appropriate timeout and negative assertion, or use `vi.advanceTimersByTime()`.

**Effort:** SMALL
**Dependencies:** None

---

### TQ-06: api/index.test.ts tests mock behavior, not real behavior [LOW] — SKIPPED (low priority)

**Files:** `src/lib/api/index.test.ts`

**Current:** Tests verify that `convertFileSrc` mock was called correctly, not that the actual function produces correct output.

**Fix:** Low priority — this is a thin wrapper layer. Consider testing with real `convertFileSrc` if Tauri test utilities support it.

**Effort:** SMALL
**Dependencies:** None

---

### TQ-07: projects/integration_tests.rs negative tests assert preconditions but not behavior [LOW] — RESOLVED

**Files:** `src-tauri/src/projects/integration_tests.rs`

**Current:** Two negative tests (`test_corrupt_project_missing_db_skipped`, `test_corrupt_project_empty_db_skipped`) assert on the initial condition but don't clearly verify that the corrupt project is excluded from the listing result.

**Fix:** Strengthen assertions to verify the corrupt project does not appear in the scan result.

**Effort:** TRIVIAL
**Dependencies:** None

---

## Summary

### Progress

| Status | Count |
|--------|-------|
| RESOLVED | 29 |
| SKIPPED | 5 |
| NOT STARTED | 10 |
| **Total** | **44** |

### By Category

| Category | Total | Done | Skipped | Remaining |
|----------|-------|------|---------|-----------|
| API Gaps (GAP) | 5 | 5 | 0 | 0 |
| Builder Migration (TB) | 4 | 0 | 1 | 3 |
| Inline SQL (SQL) | 6 | 1 | 0 | 5 |
| Setup Duplication (SD) | 6 | 3 | 1 | 2 |
| Test Helpers (TH) | 4 | 3 | 1 | 0 |
| Frontend (FE) | 12 | 12 | 0 | 0 |
| Quality (TQ) | 7 | 5 | 2 | 0 |

### Remaining Work (Recommended Order)

All GAP items are complete — every remaining item is now unblocked.

1. **Frontend factory extraction (FE-01 through FE-12):**
   Extract shared test fixtures, factories, and render helpers. 12 items, high impact.

2. **Inline SQL replacement (SQL-01 through SQL-05):**
   Migrate decision engine and repository tests to Builder. All unblocked by GAP completions.

3. **Pipeline test harness (SD-02):**
   Creates `PipelineTestHarness` struct — high impact on integration_tests.rs readability.

4. **Ad-hoc JPEG writer removal (SD-01):**
   Delete four writer functions and migrate 26 tests (GAP-01 done).

5. **Builder migrations (TB-01, TB-02, TB-03):**
   Migrate tests to use TestLibraryBuilder. All unblocked.

6. **Quality improvements (TQ-01 through TQ-07):**
   Opportunistic — fix when touching affected files.
