# Sprint 6 — Stack Count Fix & Burst Threshold Configuration UI

> Two targeted improvements to the stack overview screen: (1) fix a SQL aggregation bug where RAW+JPEG pairs count as 2 instead of 1, and (2) add a keyboard-driven config panel for the burst gap threshold that triggers live re-stacking.

---

## 1. Architectural Principles

### 1.1 ST1 Root Cause: JOIN Fan-Out in `list_stacks_summary`

`list_stacks_summary` joins `stacks → logical_photos → photos`. For a RAW+JPEG pair, one `logical_photos` row links to two `photos` rows. The `LEFT JOIN photos p ON p.logical_photo_id = lp.id` therefore produces **two rows per pair**. `COUNT(lp.id)` counts both, returning 2 instead of 1.

Fix: `COUNT(DISTINCT lp.id)` counts unique logical photo IDs, returning 1 for a pair regardless of how many physical files it contains.

No schema change, no migration, no frontend change — the UI already renders `{stack.logical_photo_count} photo(s)` and will display correctly once the count is correct.

### 1.2 ST2 Re-Stack Without Re-Scan: Extract `restack_from_existing_photos`

`run_pipeline` runs 8 steps. Steps 1–3 scan the filesystem and hash files — expensive I/O. Steps 4–7 are pure CPU: load DB rows, detect pairs, assign stacks, rebuild DB tables. Step 8 generates thumbnails.

Re-stacking with a new burst gap only requires steps 4–7. A new function `restack_from_existing_photos(conn, project_id, burst_gap_secs)` extracts those steps. `run_pipeline` calls it internally. The `restack` Tauri command calls it standalone.

After re-stacking, all `logical_photos` rows are cleared and rebuilt, so all `lp_id`s change. Cached thumbnail files are now orphaned (no matching `lp_id`). Fix: after re-stack, clear the thumbnail cache dir and call `resume_thumbnails` logic (or its internal equivalent) to regenerate.

### 1.3 ST2 Config Persistence: Existing `~/.gem-keep/config.json`

`Config { burst_gap_secs: u64 }` already exists in `src-tauri/src/projects/manager.rs` with atomic write via temp+rename. Two new commands expose it over IPC:
- `get_burst_gap() -> Result<u64, String>` — reads config; returns default (3) if file absent
- `set_burst_gap(secs: u64) -> Result<(), String>` — writes config only; no restack (caller decides)

The `restack(slug: String) -> Result<(), String>` command reads the saved `burst_gap_secs`, calls `restack_from_existing_photos`, clears the thumbnail cache, then auto-starts thumbnail resume. It is synchronous (fast — no I/O, just CPU + DB writes).

### 1.4 ST2 Hotkey: Ctrl+B (Not Ctrl+S)

`Ctrl+S` conflicts with the browser's native "Save Page" in Tauri's WebView — the event may not reliably reach the app handler on all platforms. `Ctrl+B` (B for Burst) is used instead. This is documented here to prevent future attempts to change it back.

### 1.5 ST2 Panel Lifecycle

The panel is a small overlay rendered inside `StackOverview.svelte` (no separate route). It is toggled by a single boolean `$state` variable. On open: fetch `get_burst_gap` to populate the input. On save: call `set_burst_gap` then `restack`, show "Recalculating…" spinner while running, reload stacks + trigger thumbnail resume after restack completes, then close panel. On cancel: close panel, no side effects.

---

## 2. File Changes

| File | Change |
|------|--------|
| `src-tauri/src/photos/repository.rs` | `list_stacks_summary`: `COUNT(lp.id)` → `COUNT(DISTINCT lp.id)` (1 line) |
| `src-tauri/src/import/pipeline.rs` | Extract `restack_from_existing_photos(conn, project_id, burst_gap_secs)`; `run_pipeline` calls it; add thumbnail cache clear after restack |
| `src-tauri/src/commands/import.rs` | Add `get_burst_gap`, `set_burst_gap`, `restack` commands |
| `src-tauri/src/lib.rs` | Register new commands in `generate_handler![]` |
| `src-tauri/src/commands/ipc_tests.rs` | Add BT-05, BT-06 |
| `src-tauri/src/import/stacks_tests.rs` *(new)* | Add BT-01 through BT-04 (pure unit tests for `assign_stacks_by_burst`) |
| `src/lib/api/index.ts` | Add `getBurstGap`, `setBurstGap`, `restack` exports |
| `src/lib/components/screens/StackOverview.svelte` | Add `BurstGapPanel` inline component; Ctrl+B handler in `handleKey` |
| `src/lib/components/screens/StackOverview.test.ts` | Add BT-07 through BT-11 |

---

## 3. TDD Test Specifications

### 3.A ST1: SQL Regression Test

#### BT-00: `test_logical_photo_count_is_one_for_raw_jpeg_pair`
**WHY**: Regression guard for the `COUNT(DISTINCT lp.id)` fix. A stack with one RAW+JPEG pair must return `logical_photo_count = 1`.
- Setup: insert project, stack, 2 photos (RAW + JPEG) both linked to the same `logical_photo` row
- Call `list_stacks_summary(conn, project_id)`
- Assert: `result[0].logical_photo_count == 1`

### 3.B ST2: Rust Unit Tests — Burst Stacking

#### BT-01: `test_restack_reduces_stacks_on_larger_gap`
**WHY**: If `gap=3s` creates 4 stacks, `gap=30s` must create fewer (more photos group together).
- Setup: 10 logical groups with capture times: 0, 1, 2, 10, 11, 12, 20, 21, 22, 30 (seconds)
- `burst_gap=3` → 4 stacks: {0,1,2}, {10,11,12}, {20,21,22}, {30}
- `burst_gap=30` → 1 stack: all fit within 30s max consecutive gap
- Assert distinct stack index counts

#### BT-02: `test_restack_increases_stacks_on_smaller_gap`
**WHY**: Reducing gap splits existing stacks into smaller groups.
- Same data as BT-01, `burst_gap=1` → 10 stacks (each photo alone; all consecutive gaps > 1s)
- Assert: 10 distinct stack indices

#### BT-03: `test_restack_preserves_all_logical_photos`
**WHY**: Re-stacking must not lose photos — same count in, same count out.
- Setup: run pipeline with 5 photos → 5 `logical_photos` rows in DB
- Call `restack_from_existing_photos` with different `burst_gap`
- Assert: `COUNT(logical_photos WHERE project_id=?) == 5` after restack

#### BT-04: `test_restack_clears_and_rebuilds_stacks`
**WHY**: Old stack IDs must not persist — cleared before rebuild.
- Setup: run pipeline → record old stack IDs
- Call `restack_from_existing_photos` with different gap → record new stack IDs
- Assert: no old stack ID appears in the new set (auto-increment guarantees new IDs are higher)

### 3.C ST2: Rust IPC Tests

#### BT-05: `test_get_burst_gap_returns_default`
**WHY**: `get_burst_gap` on a fresh config must return 3 (the compiled-in default).
- Call `get_burst_gap` via IPC with no existing config file
- Assert: returns `Ok(3)`

#### BT-06: `test_set_burst_gap_persists_value`
**WHY**: Round-trip: write then read must reflect the written value.
- Call `set_burst_gap(secs: 10)` → call `get_burst_gap` → assert returns `Ok(10)`
- No open project needed for this test

### 3.D ST2: Frontend Tests

#### BT-07: `test_ctrl_b_opens_burst_gap_panel`
**WHY**: Ctrl+B is the sole trigger for the config panel.
- Render `StackOverview` with stacks loaded
- Dispatch `KeyboardEvent { key: 'b', ctrlKey: true }`
- Assert: element with text matching `/burst gap/i` appears in DOM

#### BT-08: `test_save_burst_gap_calls_set_burst_gap`
**WHY**: Saving must call the IPC command with the entered value.
- Open panel (dispatch Ctrl+B), change numeric input to 10, click "Save"
- Assert: `invoke('set_burst_gap', { secs: 10 })` was called

#### BT-09: `test_save_burst_gap_calls_restack`
**WHY**: After config is saved, re-stacking must be triggered.
- After `set_burst_gap` succeeds: assert `invoke('restack', { slug: '...' })` was called

#### BT-10: `test_panel_closes_after_restack`
**WHY**: Panel must not linger after re-stack completes.
- After `restack` resolves: assert panel element is no longer in DOM

#### BT-11: `test_cancel_closes_panel_without_restack`
**WHY**: Cancel must leave config unchanged.
- Open panel, click "Cancel"
- Assert: panel gone, `set_burst_gap` NOT called, `restack` NOT called

---

## 4. Implementation Order (TDD)

**ST1 — Count Fix (fast path):**
1. Write BT-00 → RED (currently returns 2 for a pair)
2. Change `COUNT(lp.id)` → `COUNT(DISTINCT lp.id)` in `list_stacks_summary` → BT-00 GREEN
3. `cargo test` — full suite green

**ST2 — Burst Threshold Config:**
4. Write BT-01, BT-02 in `src-tauri/src/import/stacks_tests.rs` → RED
5. Verify `assign_stacks_by_burst` already passes BT-01/BT-02 (logic should be correct) — if not, fix
6. Write BT-03, BT-04 as integration tests → RED
7. Extract `restack_from_existing_photos(conn, project_id, burst_gap_secs)` from `run_pipeline` steps 4–7 → BT-03, BT-04 GREEN
8. `run_pipeline` calls `restack_from_existing_photos` internally (no behaviour change)
9. Write BT-05, BT-06 in `ipc_tests.rs` → RED
10. Add `get_burst_gap`, `set_burst_gap` commands → BT-05, BT-06 GREEN
11. Add `restack` command (calls `restack_from_existing_photos` + clear cache + resume thumbnails); register all 3 in `lib.rs`
12. Add `getBurstGap`, `setBurstGap`, `restack` to `api/index.ts`
13. Write BT-07 through BT-11 in `StackOverview.test.ts` → RED
14. Add `BurstGapPanel` inline + Ctrl+B handler in `StackOverview.svelte` → BT-07 through BT-11 GREEN
15. Quality gate: `cargo test`, `npm test` all green
16. `cargo clippy -- -D warnings` clean, `cargo fmt` clean
17. Commit

---

## 5. Definition of Done

### ST1 — Stack Count Fix
- [ ] BT-00 passes
- [ ] `list_stacks_summary` uses `COUNT(DISTINCT lp.id)`
- [ ] Stack with 1 RAW+JPEG pair shows "1 photo" in UI

### ST2 — Burst Threshold Config
- [ ] BT-01 through BT-11 pass
- [ ] `restack_from_existing_photos(conn, project_id, burst_gap_secs)` extracted from `run_pipeline`
- [ ] `run_pipeline` behaviour unchanged (calls the extracted function internally)
- [ ] `get_burst_gap`, `set_burst_gap`, `restack` Tauri commands registered
- [ ] `getBurstGap`, `setBurstGap`, `restack` exported from `api/index.ts`
- [ ] Ctrl+B opens burst gap panel in `StackOverview`
- [ ] Saving new value triggers restack + stack list reload + thumbnail resume
- [ ] Panel shows "Recalculating…" spinner while restack is running
- [ ] After restack: stacks reload, thumbnails resume for new lp_ids

### Overall
- [ ] All Sprint 5 tests continue to pass
- [ ] `cargo clippy -- -D warnings` clean
- [ ] `cargo fmt` clean
- [ ] Manual tests MT-06-01 through MT-06-04 completed

---

## 6. Manual Test Checklist

### MT-06-01: RAW+JPEG pair shows count 1
1. `cargo tauri dev` with a project containing RAW+JPEG pairs
2. Navigate to the stack list screen
3. Find a stack that has both RAW and JPEG (visible from `has_raw`/`has_jpeg` flags in the future, or known from import)
4. Verify: the count label shows "1 photo", not "2 photos"

### MT-06-02: Ctrl+B opens panel
1. Navigate to the stack list screen
2. Press Ctrl+B
3. Verify: a panel appears showing current burst gap value (default: 3 seconds)
4. Verify: there is a numeric input and Save/Cancel buttons

### MT-06-03: Saving new burst gap triggers restack
1. Open panel (Ctrl+B)
2. Change value from 3 to 30
3. Click Save
4. Verify: brief "Recalculating…" message appears
5. Verify: stack list updates — large gap means fewer, bigger stacks
6. Verify: thumbnail placeholders appear (old thumbnails cleared, new ones generating)

### MT-06-04: Cancel leaves config unchanged
1. Open panel (Ctrl+B)
2. Change value to 99
3. Click Cancel
4. Open panel again
5. Verify: value still shows the previous setting (not 99)

---

## 7. Out of Scope

| Feature | Reason |
|---------|--------|
| Per-stack file count display (e.g. "1 photo · RAW+J") | Not requested; logical count alone is sufficient |
| Pause/cancel during restack | Restack is fast (no I/O); cancellation UI not worth the complexity |
| Persistent restack history / undo | Out of scope for this sprint |
| Global hotkey system | Per-screen listeners are sufficient; refactor deferred |
| Configurable per-project burst gap | Global config is sufficient for now |
