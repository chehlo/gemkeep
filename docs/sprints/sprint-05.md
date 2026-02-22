# Sprint 5 — Thumbnail Progress Display & Resume on Re-open

> Two independent pain points with the same root: the frontend has no way to know how many thumbnails are left, and no logic to restart generation after an interrupted session. Both are fixed with a surgical Rust + frontend change — no schema migration, no new DB columns.

---

## 1. Architectural Principles

### 1.1 Counter Strategy: Local `AtomicUsize` in the Pipeline, Live Read by `get_indexing_status`

`IndexingStatus` lives behind an `Arc<Mutex<IndexingStatus>>`. To count completed thumbnails across rayon threads without Mutex contention in the hot loop, a standalone `Arc<AtomicUsize>` is added to `AppState` (alongside the existing `cancel_indexing` and `pause_indexing` atomics). The pipeline increments it with `fetch_add(1, Relaxed)`. `get_indexing_status` reads it lock-free and injects the value into the `IndexingStatus` snapshot it returns.

### 1.2 Resume Logic: Separate Command, Not a Re-run of `run_pipeline`

`run_pipeline` is the full import pipeline. Re-running it for a resume would clear and rebuild all stacks (Step 7 calls `clear_stacks_and_logical_photos`) — all unnecessary work when the DB is complete and only some thumbnails are missing.

`resume_thumbnails` is a new, simpler Tauri command that:
1. Reads `list_first_lp_ids_for_project` from the DB.
2. Does a `read_dir` of the thumbnail cache to find which `lp_id.jpg` files exist.
3. Computes the difference: `lp_ids_without_thumbnail`.
4. Reads each photo's path/format/orientation from the DB for those lp_ids.
5. Runs `thumbnails::generate_thumbnail` in a rayon pool for each missing one, emitting `thumbnail-ready` as normal.
6. Updates `indexing_status` (`thumbnails_running`, `thumbnails_total`, counter).

No `run_pipeline` involvement. No DB writes. Filesystem is the source of truth.

### 1.3 Frontend Resume Trigger: Automatic on Project Open

`resume_thumbnails` is called automatically in `loadAll()` when:
- `!status.running` (not currently indexing)
- `!status.thumbnails_running` (not currently generating)
- `stacks.length > 0` (the project has been indexed)
- `stacks.some(s => s.thumbnail_path === null)` (at least one stack is missing a thumbnail)

Safe to call on every project open: if all thumbnails are present, the DB query returns an empty set and the command returns immediately with no visible effect.

### 1.4 `IndexingStatus` Evolution (Additive, Backward-Compatible)

Two new fields:
- `thumbnails_total: usize` — set before Step 8 starts; 0 until then
- `thumbnails_done: usize` — read live from `AtomicUsize` by `get_indexing_status`

### 1.5 UI Design: Real Progress Bar for Thumbnail Phase

- When `thumbnails_total > 0`: determinate progress bar + "X / Y thumbnails (N%)" text
- When `thumbnails_total == 0`: existing spinner (brief window before first status poll)
- No "0 / 0 (0%)" ever shown

---

## 2. File Changes

| File | Change |
|------|--------|
| `src-tauri/src/photos/model.rs` | Add `thumbnails_total: usize` and `thumbnails_done: usize` to `IndexingStatus` |
| `src-tauri/src/state.rs` | Add `thumbnails_done_counter: Arc<AtomicUsize>` to `AppState`; init to 0 |
| `src-tauri/src/photos/repository.rs` | Add `list_representative_photos_for_lp_ids(conn, project_id, lp_ids)` + unit tests |
| `src-tauri/src/import/pipeline.rs` | Add `thumbnails_done_counter: Arc<AtomicUsize>` param; set `thumbnails_total` pre-pool; `fetch_add` post-write |
| `src-tauri/src/commands/import.rs` | Update `get_indexing_status` to inject live counter; update `start_indexing` to reset counter + pass to pipeline; add `resume_thumbnails` command |
| `src-tauri/src/lib.rs` | Register `resume_thumbnails` in `generate_handler![]` |
| `src-tauri/src/commands/ipc_tests.rs` | Add `resume_thumbnails` to `make_app()`; add tests P1-04, P1-05 |
| `src-tauri/src/import/integration_tests.rs` | Add tests P1-01 through P1-03, P2-03 through P2-06; add `write_valid_jpeg` helper |
| `src/lib/api/index.ts` | Add `thumbnails_total`/`thumbnails_done` to `IndexingStatus`; add `resumeThumbnails` export |
| `src/lib/components/screens/StackOverview.svelte` | Add `thumbnailPct()`; conditional progress bar vs spinner; `handleResumeThumbnails()` + resume condition in `loadAll()` |
| `src/lib/components/screens/StackOverview.test.ts` | Add fields to all `IndexingStatus` mocks; replace old spinner test; add P1-06, P1-07, P1-08, P2-07 through P2-10 |
| `tests/e2e/import-flow.spec.ts` | Update `IndexingStatus` fixture with new fields |
| `tests/e2e/thumbnail-pipeline.spec.ts` | NEW: P1-E2E-01, P1-E2E-02 |

---

## 3. TDD Test Specifications

### 3.A Rust: Progress Counter Tests

#### P1-01: `test_thumbnails_total_set_on_status_before_pool_runs`
**WHY**: `thumbnails_total` must be written to `IndexingStatus` (via `update_status`) before the rayon pool starts. If not, early status polls during thumbnail generation would see `thumbnails_total=0` and show the spinner instead of the progress bar.
- Setup: 3 JPEG files, run_pipeline
- Assert: after pipeline returns, `status.thumbnails_total == 3`

#### P1-02: `test_thumbnails_done_counter_increments_per_successful_thumbnail`
**WHY (Rule 1)**: each successful `generate_thumbnail` must increment `thumbnails_done_counter`. Without this the progress bar stays at 0%.
- Setup: 3 decode-able JPEG files (use `image::DynamicImage::new_rgb8(50,50).save(...)` to make real JPEGs)
- Assert: `thumbnails_done_counter.load(Relaxed) == 3` after pipeline

#### P1-03: `test_thumbnails_done_counter_not_incremented_for_failed_thumbnail`
**WHY (Rule 4 negative)**: `generate_thumbnail` returns `None` for corrupt sources. The counter must NOT be touched.
- Setup: 1 corrupt `.jpg` file (b"not a jpeg")
- Assert: `thumbnails_done_counter.load(Relaxed) == 0`

#### P1-04: `test_get_indexing_status_returns_live_thumbnails_done`
**WHY (Rule 1)**: `get_indexing_status` must read the live `AtomicUsize`, not a stale snapshot in the Mutex.
- Setup: set `state.thumbnails_done_counter.store(42, SeqCst)` directly
- Call `get_indexing_status`
- Assert: `status.thumbnails_done == 42`

#### P1-05: `test_thumbnails_counters_zero_before_indexing_starts`
**WHY (Rule 4 negative)**: fresh `AppState` must have both counters at 0 so the frontend shows the spinner, not a "0/0 (0%)" bar.
- Assert: `status.thumbnails_total == 0 && status.thumbnails_done == 0`

### 3.B Rust: Repository Tests

#### P2-01: `test_list_representative_photos_for_lp_ids_returns_correct_rows`
**WHY (Rule 1)**: new DB query must return `(lp_id, path, PhotoFormat, Option<u16>)` matching what was inserted. Wrong fields → `resume_thumbnails` generates wrong file.
- Insert project, stack, photo (`path="/fake/photo.jpg"`, `format="jpeg"`, `orientation=1`), logical_photo with representative_photo_id
- Call `list_representative_photos_for_lp_ids(&conn, project_id, &[lp_id])`
- Assert: 1 row, correct path/format/orientation

#### P2-02: `test_list_representative_photos_for_lp_ids_empty_input`
**WHY (Rule 4 negative)**: empty `lp_ids` slice must return `Ok(vec![])`, not a SQL error from `IN ()`.
- Call with `&[]`
- Assert: `Ok(vec![])`

### 3.C Rust: Resume Integration Tests

#### P2-03: `test_resume_thumbnails_generates_missing_only`
**WHY (Rule 1)**: resume must skip existing thumbnails and generate only missing ones. Generating all would re-write existing files and waste time.
- Insert 3 logical photos. Write `1.jpg` and `2.jpg` to cache dir. Record mtime of `1.jpg`.
- Call resume logic with lp_ids [1,2,3] and 3 real source files.
- Assert: `cache_dir/1.jpg` mtime unchanged (not regenerated). `cache_dir/3.jpg` exists if source is decodable.

#### P2-04: `test_resume_thumbnails_noop_when_all_thumbnails_present`
**WHY (Rule 4 negative)**: if all thumbnails are on disk, `resume_thumbnails` must return immediately without setting `thumbnails_running=true`.
- Write thumbnails for all lp_ids. Call resume.
- Assert: `status.thumbnails_running == false` after call.

#### P2-05: `test_resume_thumbnails_noop_when_already_running`
**WHY (Rule 4 negative)**: calling resume while `thumbnails_running=true` must be a no-op to prevent double-starting the background thread.
- Set `status.thumbnails_running = true`. Call resume.
- Assert: returns `Ok(())`. Status still `thumbnails_running=true`.

#### P2-06: `test_resume_thumbnails_noop_when_no_logical_photos`
**WHY (Rule 4 negative)**: if the project has no stacks/logical_photos (never indexed), `lp_ids_without_thumbnail` is empty. Must return immediately.
- Fresh project (no photos inserted). Call resume.
- Assert: `status.thumbnails_running == false`.

### 3.D Frontend: Progress Bar Tests

#### P1-06: `renders_determinate_progress_bar_when_thumbnails_total_nonzero`
**WHY (Rule 1)**: when `thumbnails_total > 0`, a progress bar with "X / Y thumbnails (N%)" must be rendered. This is the core progress display.
- Status: `thumbnails_running=true, thumbnails_total=100, thumbnails_done=42`
- Assert: `screen.getByText(/42.*100.*thumbnail/i)` in DOM
- Assert: text matching `/42%/` in DOM

#### P1-07: `renders_spinner_when_thumbnails_total_is_zero`
**WHY**: before `thumbnails_total` is populated (early polling window), the spinner must be shown. A "0 / 0 (0%)" bar is useless and confusing.
- Status: `thumbnails_running=true, thumbnails_total=0, thumbnails_done=0`
- Assert: `.animate-spin` present
- Assert: no text matching `/%/` in DOM

#### P1-08: `thumbnail_progress_indicator_is_never_static_full_width_pulsing_bar`
Replaces existing `thumbnail_progress_indicator_is_NOT_a_static_full_width_bar` test.
**WHY**: neither the progress bar nor the spinner must be a `w-full animate-pulse` element (that pattern looks like "already 100% done").
- Status: `thumbnails_running=true, thumbnails_total=0`
- Assert: if `.animate-pulse` exists, it does NOT have class `w-full`

### 3.E Frontend: Resume Tests

#### P2-07: `calls_resume_thumbnails_when_stacks_exist_and_some_have_null_thumbnail`
**WHY (Rule 1)**: the auto-resume trigger must fire on project open when stacks exist but some have `thumbnail_path=null`.
- `list_stacks` returns `[STACK_1, STACK_2]` (both `thumbnail_path: null`)
- `get_indexing_status` returns `IDLE_STATUS` (not running)
- Assert: `invoke('resume_thumbnails', { slug: 'iceland-2024' })` called

#### P2-08: `does_not_call_resume_thumbnails_when_all_stacks_have_thumbnails`
**WHY (Rule 4 negative)**: no resume needed when all stacks have thumbnails.
- `list_stacks` returns stacks with non-null `thumbnail_path`
- Assert: `resume_thumbnails` NOT called

#### P2-09: `does_not_call_resume_thumbnails_when_stacks_array_is_empty`
**WHY (Rule 4 negative)**: empty stacks = project not indexed. `start_indexing` fires instead (existing auto-start).
- `list_stacks` returns `[]`
- Assert: `start_indexing` called, `resume_thumbnails` NOT called

#### P2-10: `does_not_call_resume_thumbnails_when_thumbnails_already_running`
**WHY (Rule 4 negative)**: `thumbnails_running=true` → `startPolling()` fires, not resume.
- Status: `thumbnails_running=true`; stacks with `thumbnail_path: null`
- Assert: `resume_thumbnails` NOT called

### 3.F E2E Tests (`tests/e2e/thumbnail-pipeline.spec.ts`)

#### P1-E2E-01: `thumbnail_progress_bar_shows_count_and_percentage`
**WHY**: visual regression guard — verifies text like "20 / 50 thumbnails (40%)" and the progress bar element are visible in the actual Tauri webview during thumbnail phase.

#### P1-E2E-02: `spinner_shown_when_thumbnails_total_is_zero`
**WHY**: visual regression guard — verifies the spinner is shown and no `%` text appears when `thumbnails_total=0`.

---

## 4. Implementation Order (TDD)

**Problem 1 — Progress Display:**
1. Write P1-01, P1-02, P1-03 → RED
2. Write P1-04, P1-05 → RED
3. Add `thumbnails_total`/`thumbnails_done` to `IndexingStatus` (model.rs)
4. Add `thumbnails_done_counter: Arc<AtomicUsize>` to `AppState` (state.rs) → P1-05 GREEN
5. Update `get_indexing_status` to inject live counter → P1-04 GREEN
6. Update `run_pipeline` signature + pre-pool `thumbnails_total` set + `fetch_add` in loop → P1-01, P1-02, P1-03 GREEN
7. Update `start_indexing` to reset counter + pass to pipeline
8. Update TypeScript `IndexingStatus` + all mock objects in test files
9. Write P1-06, P1-07, P1-08 → RED
10. Update `StackOverview.svelte` (progress bar / spinner) → P1-06, P1-07, P1-08 GREEN
11. Write and run E2E tests P1-E2E-01, P1-E2E-02

**Problem 2 — Resume on Re-open:**
12. Write P2-01, P2-02 → RED
13. Implement `list_representative_photos_for_lp_ids` (repository.rs) → P2-01, P2-02 GREEN
14. Write P2-03 through P2-06 → RED
15. Implement `resume_thumbnails` command (import.rs) + register in lib.rs → P2-03 through P2-06 GREEN
16. Add `resumeThumbnails` to `api/index.ts`
17. Write P2-07 through P2-10 → RED
18. Update `loadAll()` in `StackOverview.svelte` → P2-07 through P2-10 GREEN
19. Full suite: `cargo test`, `npm test`, `npm run test:e2e` all GREEN
20. `cargo clippy` clean, `cargo fmt` clean

---

## 5. Definition of Done

### P1 — Progress Display
- [ ] P1-01 through P1-08 pass
- [ ] P1-E2E-01, P1-E2E-02 pass
- [ ] `IndexingStatus` has `thumbnails_total`/`thumbnails_done` (Rust + TypeScript)
- [ ] `AppState` has `thumbnails_done_counter: Arc<AtomicUsize>`
- [ ] `get_indexing_status` reads live counter into snapshot
- [ ] `run_pipeline` sets `thumbnails_total` before pool; `fetch_add` in loop
- [ ] UI: determinate progress bar with "X / Y thumbnails (N%)" when `thumbnails_total > 0`
- [ ] UI: spinner when `thumbnails_total == 0`
- [ ] No "0 / 0 (0%)" shown

### P2 — Resume on Re-open
- [ ] P2-01 through P2-10 pass
- [ ] `resume_thumbnails` Tauri command registered in `lib.rs`
- [ ] `resumeThumbnails` exported from `api/index.ts`
- [ ] `loadAll()` auto-calls resume when: stacks exist, some have null thumbnail_path, not running
- [ ] `resume_thumbnails` does not call `run_pipeline`; no DB writes
- [ ] `resume_thumbnails` emits `thumbnail-ready` per thumbnail
- [ ] `resume_thumbnails` sets `thumbnails_running` + `thumbnails_total` + resets counter

### Overall
- [ ] All Sprint 4 tests continue to pass
- [ ] `cargo clippy -- -D warnings` clean
- [ ] `cargo fmt` clean
- [ ] Manual tests MT-05-01 through MT-05-04 completed

---

## 6. Manual Test Checklist

### MT-05-01: Progress count advances
1. `cargo tauri dev` with a project that has 200+ photos
2. Trigger re-index (clears thumbnail cache)
3. Watch the thumbnail banner after stacks appear
4. Verify: "X / Y thumbnails (N%)" text advances — X increases over time
5. Verify: percentage increases and reaches 100%
6. Verify: banner disappears after all thumbnails generated

### MT-05-02: Progress bar fills correctly
1. Same project as MT-05-01
2. Observe the progress bar width
3. Verify: bar starts narrow and grows to full width
4. Verify: bar is never immediately at full width on first render

### MT-05-03: Resume after interrupted generation
1. `cargo tauri dev`, re-index a project with 200+ photos
2. Close the app window while thumbnails are still generating (observe X < Y)
3. Re-open the app
4. Navigate to the same project
5. Verify: thumbnail generation resumes automatically (progress banner appears, X increases)
6. Verify: existing thumbnails are NOT regenerated (fast completion for partially-done set)
7. Verify: all stack cards show thumbnails after completion

### MT-05-04: No double-resume
1. Re-open a project where all thumbnails are present
2. Verify: resume_thumbnails is NOT called (no progress banner flashes)

---

## 7. Out of Scope

| Feature | Reason |
|---------|--------|
| Cancel/Pause in `resume_thumbnails` | Deferred; resume runs fast, no UI to trigger cancel |
| Per-thumbnail targeted card update (vs full re-query) | Sprint 6 (needs lp_id → stack_id map in frontend) |
| Resume of mid-EXIF scan (partial import) | Different problem; out of scope |
| Frontend "Resume" button | Automatic is sufficient |
| LRU in-memory thumbnail cache | Sprint 6 |
