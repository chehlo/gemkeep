# Sprint 10 — Multi-Round Engine & Restoration

**User Stories:** §8 (all: multi-round, immutable snapshots, overrides, restoration, round navigation, commit/finalize), §5.1 (show only active photos in current round), §14.1 (crash resilience for round decisions)

**Goal:** The user can do multiple refinement passes on a stack and reconsider earlier decisions. Round history is immutable and navigable. Eliminated photos can be restored.

**Branch:** `sprint-10`
**Depends on:** S1–S9

---

## Status

| Feature | Status |
|---------|--------|
| Phase A: Unified round-scoping — all APIs require roundId + undo guard | --- |
| F1: Multi-round progression (Round 1 survivors become Round 2 members) | --- |
| F2: Immutable round snapshots + round navigation | --- |
| F3: Decision overrides in later rounds | --- |
| F4: Restoration of eliminated photos | --- |
| F5: Round navigation `[` `]` keys + round tab bar | --- |
| F6: Finalize stack `Ctrl+Shift+Enter` | --- |

---

## What gets built

### Phase A — Unified round-scoping (all photo/decision APIs require roundId)

**Principle (from Sprint 9):** Always pass valid parameters. No optional roundId. Every query that returns photos or decisions MUST be scoped to a specific round.

**Current violations (3 APIs + 2 callers):**

#### 1. `list_logical_photos` — Rust signature still `Option<i64>`

Despite Sprint 9 defining roundId as mandatory in the TypeScript API, the Rust command still accepts `round_id: Option<i64>`. ComparisonView (line 68) and SingleView (line 42) call it WITHOUT roundId — TypeScript doesn't catch this because `invoke` serializes missing params as null.

**Fix:** Change Rust `round_id: Option<i64>` to `round_id: i64` (required). ComparisonView and SingleView must obtain roundId from `getRoundStatus` before calling. Remove the `query_logical_photos_by_stack` fallback path — always use `query_logical_photos_by_round`.

#### 2. `get_stack_decisions` — has NO roundId parameter at all

This API reads `current_status` from the `logical_photos` table — a flat materialized cache that only reflects the LATEST decision across ALL rounds. For round 2+, this shows round-1 decisions mixed with round-2 decisions.

**Fix:** Rename to `get_round_decisions(slug, stack_id, round_id)`. Query decisions for the specific round: derive status from `decisions WHERE round_id = ?` instead of reading `logical_photos.current_status`. The materialized `current_status` remains as a performance cache but is NOT the source of truth for per-round views.

#### 3. `get_round_status` — counts from `logical_photos`, not `round_photos`

Queries `SELECT COUNT(*) FROM logical_photos WHERE stack_id` for total/kept/eliminated. Correct for round 1 (all photos are members), **wrong for round 2+** (eliminated photos still counted).

**Fix:** Count from `round_photos JOIN logical_photos` instead. Same fix needed in `get_round_status_batch` SQL.

#### Frontend callers to update

| Caller | Current | Fix |
|--------|---------|-----|
| ComparisonView.svelte (line 68) | `listLogicalPhotos(slug, stackId)` | Get roundId from getRoundStatus first |
| SingleView.svelte (line 42) | `listLogicalPhotos(slug, stackId)` | Same — get roundId first |
| ComparisonView.svelte (line 70) | `getStackDecisions(slug, stackId)` | Use new `getRoundDecisions(slug, stackId, roundId)` |
| StackFocus.svelte (line 74) | `getStackDecisions(slug, stackId)` | Same |

#### 4. `undo_merge` guard: only allowed in round 1

Currently `undo_last_merge` checks if decisions exist on the merged stack. Simplify: undo is only allowed if the merged stack's latest round has `round_number = 1`. If round > 1, return error "Cannot undo merge: stack has progressed beyond round 1". No complicated decision-checking — just the round number.

**Fix:** In `undo_last_merge` (repository.rs), before proceeding, query `SELECT MAX(round_number) FROM rounds WHERE scope='stack' AND scope_id = merged_stack_id`. If > 1, return error. Replace the existing decisions-based guard.

### Phase A addendum — `current_status` design problem (discovered during lifecycle testing)

**Problem:** `logical_photos.current_status` is a flat denormalized cache that breaks in multi-round context:

1. **After `commit_round`:** survivors are reset to `'undecided'` for the new round, but the `decisions` table still has the round-1 `'keep'` record. The cache reflects the current round, not history.
2. **After `restack`:** photos move to new stacks but `current_status` was stale — it reflected decisions from the old stack's round. **Fixed:** restack now resets `current_status = 'undecided'` for all moved photos.
3. **`decision_status` invariant (Rule 21):** not valid for multi-round because `current_status` only tracks the latest round. Historical round views must use `get_round_decisions()` (implemented in Phase A).

**Design decision:**
- `current_status` remains as a **performance cache for the CURRENT (latest open) round only**
- All historical round views use `get_round_decisions()` which derives status from the `decisions` table per round
- The `decision_status` invariant uses `assert_structural_invariants` (excludes decision status check) for multi-round lifecycle steps
- Future: consider making `decision_status` invariant round-aware by comparing `current_status` against the latest decision in the photo's current stack's latest round

### Phase B — Core multi-round engine

#### F1: Multi-round progression

After committing Round 1 (`Ctrl+Enter`), the user can start Round 2. Round 2 shows only the photos that survived Round 1 (kept or undecided — eliminated photos are hidden). Round 3 shows only Round 2 survivors. And so on. The existing `commit_round()` already creates the next round with survivors and populates `round_photos` — this is partially implemented. What's missing:

- **`make_decision` must allow decisions in Round N+1** — currently it rejects all decisions after a committed round because the "latest round is committed" check finds the committed Round 1 before Round 2 is found. Fix: look for the open round first, only reject if no open round exists AND the latest is committed.
- **`current_status` derivation must be round-aware** — currently `current_status` on `logical_photos` is a global materialized cache. After commit resets survivors to `undecided`, a photo kept in Round 1 shows as `undecided` in Round 2. This is correct behavior (Round 2 starts fresh). However, when viewing Round 1's snapshot, the status must come from the decisions table, not `current_status`.
- **`undo_decision` must recompute `current_status` correctly** — after undo in Round 2, if no Round 2 decisions remain for that photo, `current_status` should be `undecided` (not the Round 1 value).

#### F3: Decision overrides in later rounds

A photo kept in Round 1 can be eliminated in Round 2. The Round 2 decision overrides Round 1 without changing Round 1's snapshot. The decisions log is append-only — `current_status` is derived from the latest entry in the current open round. No code changes needed beyond F1's round-aware status derivation — the existing `record_decision` already appends and updates `current_status`.

### Phase C — Navigation & snapshots

#### F2: Immutable round snapshots + round navigation

Each committed round is a frozen snapshot. Navigating to a past round shows the exact decisions at that point in time. Past rounds are read-only — no editing.

**New IPC: `list_rounds(slug, stack_id)`** — returns all rounds for a stack, ordered by `round_number`. Each entry includes `round_id`, `round_number`, `state` (open/committed), `committed_at`, and summary counts (total/kept/eliminated/undecided derived from `decisions` + `round_photos`).

**New IPC: `get_round_snapshot(slug, round_id)`** — returns the photo list and their decision states as they were when the round was committed. For committed rounds, derives status from the `decisions` table (`SELECT action FROM decisions WHERE round_id = ?1 AND logical_photo_id = ?2 ORDER BY id DESC LIMIT 1`). For the open round, returns current live state.

**Frontend round tab bar** — a horizontal bar above the StackFocus grid showing round numbers as tabs: `[R1] [R2] [R3*]` where `*` marks the current (open) round. Clicking a tab or pressing `[`/`]` navigates between rounds. Past round tabs show committed state; the grid becomes read-only (Y/X/U keys disabled, visual dimming).

#### F5: Round navigation `[` `]` keys

`[` moves to the previous round, `]` moves to the next round. Wraps: pressing `]` on the latest round is a no-op. Pressing `[` on Round 1 is a no-op. These keys work in StackFocus, SingleView, and ComparisonView. When navigating to a committed round, the view enters read-only mode.

**Read-only mode indicators:**
- Decision keys (Y/X/U) are disabled with an inline warning: "Round N is committed — read-only"
- The round tab has a lock icon or "committed" label
- Photo borders show the historical decision state (green/red) but are non-interactive

### Phase D — Restoration & finalize

#### F4: Restoration of eliminated photos

An eliminated photo can be restored in a later round by creating a new "keep" decision that overrides the elimination. Use case: "I eliminated this in Round 1, but after seeing Round 2 survivors, I realize it was actually the best one."

**Show-eliminated toggle:** In StackFocus (current open round), press `E` to toggle visibility of eliminated photos from ALL prior rounds. When visible, eliminated photos appear with a dimmed/grayed-out treatment and a "Eliminated in Round N" label. Pressing `R` on a dimmed eliminated photo restores it to the current round.

**New IPC: `list_eliminated_photos(slug, stack_id, round_id)`** — returns photos that were eliminated in any round up to (but not including) the given round and are NOT already members of the given round. Includes which round eliminated them.

**New IPC: `restore_eliminated_photo(slug, logical_photo_id, round_id)`** — adds the photo to `round_photos` for the given round and records a "keep" decision. Resets `current_status` to `undecided` (restored into the round as undecided, not pre-decided). Guards: only works on open rounds; photo must actually be eliminated; photo must not already be a member of this round.

#### F6: Finalize stack `Ctrl+Shift+Enter`

A "Finalize stack" action marks the stack as done. Its survivors are locked until the user chooses to reopen. Finalized stacks show a distinct visual state in Stack Overview (e.g., a checkmark badge, green background).

**Schema change:** Add `state TEXT NOT NULL DEFAULT 'active'` column to `stacks` table. Valid values: `active`, `finalized`. The existing `active INTEGER` column is kept for soft-delete (merge/restack deactivation). `state` tracks the workflow lifecycle separately:

| `active` | `state` | Meaning |
|-----------|-----------|---------|
| 1 | `active` | Normal working stack |
| 1 | `finalized` | Stack is done, survivors locked |
| 0 | `active` | Soft-deleted (merged/restacked) |
| 0 | `finalized` | Soft-deleted AND was finalized |

**New IPC: `finalize_stack(slug, stack_id)`** — commits the current open round (if any uncommitted decisions exist) and sets `stacks.state = 'finalized'`. Returns the survivor count. Guards: stack must be active; stack must have at least one round.

**New IPC: `reopen_stack(slug, stack_id)`** — sets `stacks.state = 'active'`, allowing new rounds. No new round is created — the user must start one manually (first decision auto-creates).

**Frontend behavior:**
- `Ctrl+Shift+Enter` triggers finalize with a non-modal inline confirmation: "Stack finalized. N survivors."
- Finalized stacks in StackOverview show a distinct badge (checkmark + "Finalized")
- Entering a finalized stack's StackFocus shows survivors in read-only mode with a "Reopen" button
- Pressing `Ctrl+Shift+Enter` again on a finalized stack reopens it

---

## "Good enough" definition

- Round navigation uses a simple numbered tab bar or bracket-key cycling. Not a timeline visualization.
- Restoration works via a keyboard shortcut (`R`) on a visible (but dimmed) eliminated photo after pressing `E` to show eliminated. Not drag-and-drop.
- Finalize confirmation is a non-modal inline message ("Stack finalized. N survivors."), not a dialog box.
- Round snapshots are derived from the decisions log via SQL queries — no separate snapshot tables needed.
- The round tab bar is plain text tabs (`R1 R2 R3*`), not a styled component. Functional over pretty.
- Read-only mode for past rounds disables keys and shows a warning. No visual graying of the entire UI.
- `list_eliminated_photos` returns a flat list. No grouping by "which round eliminated them" in the UI — just a label per photo.

---

## Success criteria

1. After committing Round 1, the user can make decisions in Round 2 which shows only Round 1 survivors
2. Round 2 photo list does not include photos eliminated in Round 1
3. Navigating to Round 1 (via `[` key or tab click) shows the original decisions in read-only mode
4. Y/X/U keys are disabled when viewing a committed round; an inline warning is shown
5. A photo kept in Round 1 can be eliminated in Round 2 without altering Round 1's snapshot
6. Viewing Round 1 after a Round 2 override still shows the photo as "keep" in Round 1
7. `get_round_status` returns correct counts scoped to round members (not all stack photos)
8. `get_round_status` for Round 2 shows only survivor counts, not Round 1 eliminated photos
9. ComparisonView passes `roundId` to `listLogicalPhotos` — only shows current round's photos
10. SingleView passes `roundId` to `listLogicalPhotos` — arrow navigation stays within round members
11. Pressing `E` in StackFocus toggles visibility of eliminated photos from prior rounds
12. Eliminated photos appear dimmed with "Eliminated in Round N" labels
13. Pressing `R` on a dimmed eliminated photo restores it to the current open round as undecided
14. Restored photo appears in the StackFocus grid and is eligible for Y/X decisions
15. `Ctrl+Shift+Enter` finalizes the stack; shows inline confirmation with survivor count
16. Finalized stacks show a distinct badge in StackOverview (checkmark + "Finalized")
17. Entering a finalized stack shows survivors in read-only mode with a "Reopen" option
18. Reopening a finalized stack allows new decisions (new round auto-created on first Y/X)
19. `list_rounds` returns all rounds for a stack with correct summary counts per round
20. Round tab bar displays in StackFocus header; clicking a tab navigates to that round
21. `[` and `]` keys cycle through rounds in StackFocus, SingleView, and ComparisonView
22. Crash during Round 2 preserves all Round 2 decisions on restart (auto-save)
23. `current_status` correctly derives from the latest decision in the current open round
24. Undo in Round 2 correctly resets to undecided (not Round 1's decision)
25. `cargo test` passes: round-scoped counts, multi-round progression, override logic, restoration, snapshot immutability, finalize/reopen state, undo across rounds
26. `npm test` passes: round tab bar, read-only mode, show-eliminated toggle, restore action, finalize flow, round navigation keys
27. Restoring a photo that is already a member of the current round is a no-op (not duplicated)
28. Finalizing a stack with no rounds returns an error

---

## Edge cases & error handling

| # | Scenario | Expected behavior |
|---|----------|-------------------|
| 1 | Commit Round 1 with zero survivors (all eliminated) | Stack marked `active=0`. Round 2 is created but empty. StackFocus shows "No survivors — stack complete." |
| 2 | Press Y/X in a committed round's view | Keys ignored. Inline warning: "Round N is committed — read-only." |
| 3 | Press `]` on the latest (open) round | No-op. No error message. |
| 4 | Press `[` on Round 1 | No-op. No error message. |
| 5 | Restore a photo that was eliminated in Round 1, then eliminate it again in Round 2 | Works normally. Photo added to Round 2 members, then eliminated via X. Decisions log has: R1 eliminate, R2 keep (restore), R2 eliminate. |
| 6 | Restore a photo that is already a member of the current round | No-op — `restore_eliminated_photo` returns Ok without duplicating the `round_photos` entry. |
| 7 | Finalize a stack that has an open round with undecided photos | The open round is committed first (auto-commit), then stack is finalized. Undecided photos in the committed round are treated as implicit keeps. |
| 8 | Finalize a stack with no rounds (no decisions ever made) | Error: "Cannot finalize a stack with no rounds." |
| 9 | Reopen an already-active (non-finalized) stack | No-op — `reopen_stack` returns Ok without state change. |
| 10 | `Ctrl+Shift+Enter` on a finalized stack | Reopens the stack (toggle behavior). Shows "Stack reopened." |
| 11 | Show eliminated (`E`) when no photos have been eliminated | Toggle activates but the grid shows no additional photos. No error. |
| 12 | Navigate to Round 1, press `E` to show eliminated | Show-eliminated is only available in the current open round. In committed rounds, `E` is disabled. |
| 13 | Crash mid-restore (after `round_photos` INSERT, before decision INSERT) | On restart, the photo is a round member with no decision — shows as undecided. Consistent state. |
| 14 | Undo the restore decision in the current round | Photo's decision is removed. Photo remains in `round_photos` but shows as undecided. The user can eliminate it or leave undecided for commit. |
| 15 | Stack with 50+ rounds (stress test) | Round tab bar scrolls horizontally. `[`/`]` keys still work. No performance degradation on `list_rounds`. |
| 16 | `get_round_status_batch` after multi-round progression | Returns correct counts per stack using round-scoped queries. Stacks at different round numbers return their respective latest round's data. |
| 17 | ComparisonView entered during Round 2 | Shows only Round 2 member photos. Auto-fill only considers Round 2 undecided photos. |
| 18 | Multiple rapid commits (Round 1 → 2 → 3 without decisions in between) | Each commit creates an empty next round with survivors. Rounds with zero decisions are valid committed rounds. |

---

## Architecture constraints

Per `sprint-plan.md` cross-sprint standards:

1. **Per-project context isolation**: All round navigation state, show-eliminated toggle, and finalize state MUST be scoped to the active project. Round tab bar selection is frontend-only state. The backend provides data; the frontend tracks which round is being viewed.

2. **Decision engine as standalone module**: All new round logic (list_rounds, get_round_snapshot, restore, finalize) lives in `decisions/engine.rs`. No round logic in command handlers beyond parameter passing.

3. **Append-only decisions log**: Restoration creates a new decision row — never DELETE or UPDATE existing decisions. `current_status` on `logical_photos` remains a materialized cache of the latest decision in the open round.

4. **All IPC commands return `Result<T, String>`**: New commands (`list_rounds`, `get_round_snapshot`, `restore_eliminated_photo`, `finalize_stack`, `reopen_stack`, `list_eliminated_photos`) follow this pattern.

5. **`tracing` for logging**: No `println!` in any new Rust code. Use `tracing::info!` for round commits/finalizes, `tracing::warn!` for edge cases (restore no-op, finalize with no rounds).

6. **Schema migrations are additive**: New `stacks.state` column added via `ALTER TABLE` migration with `DEFAULT 'active'`. No data migration needed — all existing stacks are `active`.

---

## Modules touched

### Rust backend

| File | Changes |
|------|---------|
| `src-tauri/src/decisions/engine.rs` | Fix `get_round_status` to use `round_photos` instead of `logical_photos WHERE stack_id`. Fix `get_round_status_batch` similarly. Add `list_rounds()`, `get_round_snapshot()`, `restore_eliminated_photo()`, `list_eliminated_photos()`, `finalize_stack()`, `reopen_stack()`. |
| `src-tauri/src/decisions/model.rs` | Add `RoundSummary` struct (for `list_rounds`), `RoundSnapshot` struct (photo list + decisions for a committed round), `EliminatedPhoto` struct (photo info + eliminated_in_round), `FinalizeResult` struct. Extend `RoundState` type if needed. |
| `src-tauri/src/commands/decisions.rs` | Add 6 new command functions: `list_rounds`, `get_round_snapshot`, `restore_eliminated_photo`, `finalize_stack`, `reopen_stack`, `list_eliminated_photos`. Fix `make_decision` to find open round correctly (not reject after committed round). |
| `src-tauri/src/db/migrations.rs` | Add migration: `ALTER TABLE stacks ADD COLUMN state TEXT NOT NULL DEFAULT 'active'` |
| `src-tauri/src/lib.rs` | Register 6 new IPC commands |

### Frontend

| File | Changes |
|------|---------|
| `src/lib/api/index.ts` | Add 6 new API functions + types (`RoundSummary`, `RoundSnapshot`, `EliminatedPhoto`, `FinalizeResult`). Add `RoundState` value `'finalized'` if needed. |
| `src/lib/components/screens/StackFocus.svelte` | Round tab bar, `[`/`]` key handlers, show-eliminated toggle (`E`), restore key (`R`), finalize (`Ctrl+Shift+Enter`), read-only mode for committed rounds, "Reopen" action for finalized stacks |
| `src/lib/components/screens/ComparisonView.svelte` | Pass `roundId` to `listLogicalPhotos` (BUG-12 fix). Round navigation keys. Read-only mode. |
| `src/lib/components/screens/SingleView.svelte` | Pass `roundId` to `listLogicalPhotos` (BUG-13 fix). Round navigation keys. Read-only mode. |
| `src/lib/components/screens/StackOverview.svelte` | Finalized badge on stack cards. |
| `src/lib/components/RoundTabBar.svelte` | **NEW** — reusable round tab bar component (round numbers, active indicator, click handler, committed/open state) |
| `src/lib/stores/navigation.svelte.ts` | Add `roundId` to `StackFocusScreen`, `SingleViewScreen`, `ComparisonViewScreen` types for round-aware navigation |

---

## Data model / schema changes

### Schema migration

```sql
ALTER TABLE stacks ADD COLUMN state TEXT NOT NULL DEFAULT 'active';
```

### Existing tables used (no changes)

- **`rounds`** — already has `round_number`, `state` (open/committed), `committed_at`, `scope_id` (stack_id)
- **`round_photos`** — already tracks which photos belong to which round (populated by `find_or_create_round` and `commit_round`)
- **`decisions`** — append-only log with `round_id`, `logical_photo_id`, `action`, `timestamp`
- **`logical_photos`** — `current_status` remains as materialized cache for the open round

### Key query patterns

**Round-scoped status (fix for BUG-11):**
```sql
SELECT COUNT(*) FROM round_photos rp
JOIN logical_photos lp ON lp.id = rp.logical_photo_id
WHERE rp.round_id = ?1 AND lp.current_status = 'keep'
```

**Round snapshot (committed round — historical status):**
```sql
SELECT rp.logical_photo_id,
       COALESCE(
         (SELECT d.action FROM decisions d
          WHERE d.logical_photo_id = rp.logical_photo_id AND d.round_id = ?1
          ORDER BY d.id DESC LIMIT 1),
         'undecided'
       ) AS status
FROM round_photos rp WHERE rp.round_id = ?1
```

**Eliminated photos (candidates for restoration):**
```sql
SELECT lp.id, lp.current_status, d.round_id AS eliminated_in_round, r.round_number
FROM logical_photos lp
JOIN decisions d ON d.logical_photo_id = lp.id
JOIN rounds r ON r.id = d.round_id
WHERE lp.stack_id = ?1
  AND lp.current_status = 'eliminate'
  AND lp.id NOT IN (SELECT logical_photo_id FROM round_photos WHERE round_id = ?2)
GROUP BY lp.id
HAVING d.id = MAX(d.id)
```

---

## Implementation order

### Phase A — Bug fixes (prerequisite — affects existing Round 1 behavior)

1. **BUG-11: Fix `get_round_status` + `get_round_status_batch`** — Replace `logical_photos WHERE stack_id` counts with `round_photos WHERE round_id` JOINs. Existing tests must be updated to reflect correct round-scoped counting.

2. **BUG-12: Fix ComparisonView `listLogicalPhotos` call** — Fetch `roundId` from `getRoundStatus` first, then pass to `listLogicalPhotos`. Requires the round status to be available before photo list fetch.

3. **BUG-13: Fix SingleView `listLogicalPhotos` call** — Same pattern as BUG-12. SingleView navigation screen type needs `roundId`.

### Phase B — Core multi-round engine

4. **Fix `make_decision` committed-round guard** — Change logic to find open round first, only reject if no open round exists. This unblocks Round 2+ decisions.

5. **`list_rounds` IPC** — New engine function + command. Returns all rounds for a stack with per-round summary counts derived from `round_photos` + `decisions`.

6. **`get_round_snapshot` IPC** — New engine function + command. Returns photo list + historical decision states for any round (committed or open).

7. **Round-aware `undo_decision`** — After undo, recompute `current_status` from remaining decisions in the current round (not just set to `undecided`).

### Phase C — Navigation + snapshots (frontend)

8. **`RoundTabBar.svelte` component** — Reusable component showing round tabs. Props: rounds list, active round, onClick handler.

9. **StackFocus round navigation** — Integrate `RoundTabBar`, `[`/`]` key handlers, round-switching logic (re-fetch photos for selected round), read-only mode for committed rounds.

10. **SingleView + ComparisonView round navigation** — Same `[`/`]` keys, read-only mode, round-aware photo lists.

11. **Navigation state update** — Add `roundId` to screen types in `navigation.svelte.ts`. All screen transitions preserve round context.

### Phase D — Restoration + finalize

12. **`list_eliminated_photos` IPC** — New engine function + command. Returns eliminated photos not in the current round.

13. **`restore_eliminated_photo` IPC** — New engine function + command. Adds photo to `round_photos`, records initial undecided state.

14. **Show-eliminated toggle (`E` key)** — StackFocus fetches eliminated photos on toggle, renders them dimmed in the grid. `R` key triggers restore.

15. **Schema migration: `stacks.state`** — Add column. Update stack listing queries to expose `state`.

16. **`finalize_stack` + `reopen_stack` IPCs** — New engine functions + commands. Auto-commits open round if needed.

17. **Finalize UI** — `Ctrl+Shift+Enter` handler in StackFocus, inline confirmation, StackOverview finalized badge, read-only mode for finalized stacks, reopen action.

18. **Edge case hardening** — Zero survivors, no rounds, already finalized, stress test round counts.

---

## Test layers

| Feature | Unit (cargo test) | Component (npm test) | E2E (Playwright) |
|---------|:-:|:-:|:-:|
| BUG-11: Round-scoped status counts | x | | |
| BUG-12: ComparisonView roundId pass-through | | x | |
| BUG-13: SingleView roundId pass-through | | x | |
| Multi-round progression (commit creates R2 with survivors) | x | | |
| Round 2 excludes Round 1 eliminated photos | x | x | |
| `list_rounds` returns correct per-round summaries | x | | |
| `get_round_snapshot` returns historical decisions | x | | |
| Decision override (keep in R1, eliminate in R2) | x | | |
| Round 1 snapshot unchanged after R2 override | x | | |
| `restore_eliminated_photo` adds to round + undecided | x | | |
| Restore already-member photo is no-op | x | | |
| `list_eliminated_photos` excludes current round members | x | | |
| `finalize_stack` sets state + auto-commits | x | | |
| `reopen_stack` resets state | x | | |
| Finalize with no rounds returns error | x | | |
| Round tab bar rendering + click navigation | | x | |
| `[`/`]` key round navigation | | x | |
| Read-only mode (Y/X/U disabled + warning) | | x | |
| Show-eliminated toggle (`E` key) | | x | |
| Restore key (`R` on dimmed photo) | | x | |
| Finalize flow (`Ctrl+Shift+Enter` + confirmation) | | x | |
| Reopen flow (toggle finalize) | | x | |
| Finalized badge in StackOverview | | x | |
| Undo in Round 2 resets to undecided correctly | x | x | |
| `get_round_status_batch` round-scoped (batch) | x | | |
| Crash recovery: Round 2 decisions persist | x | | |
| Full multi-round workflow (R1 → commit → R2 → finalize) | | | x |
| Restore eliminated + re-eliminate workflow | | | x |

**E2E scope (Playwright):** 2 new journey tests:
1. Full multi-round: StackFocus → decide all → commit → Round 2 with survivors → decide → finalize
2. Restoration: Round 1 eliminate → commit → Round 2 → show eliminated → restore → decide

---

## Deferred from this sprint

- **F7: `undo_merge` round restoration** — Currently `undo_merge` creates fresh Round 1 for restored stacks. Ideally it should restore original rounds (they're still in DB — no FK cascade). Design question: what happens to decisions made in the merged stack's round? This requires careful design and is deferred to a future sprint.
- **GemStack (final curation)** — Sprint 11 (stacks must produce survivors through multi-round first)
- **Cross-stack refinement** — Sprint 11 (via GemStack)
- **Visual timeline of selection evolution** — Future/P2
- **Synchronized zoom/pan in comparison** — Sprint 13
- **Multi-step undo history** — Future (current single-level undo is sufficient)
- **Round-level undo (uncommit a round)** — Future (committed rounds are immutable by design)
