# Sprint 10a — Pre-S11 Hardening & E2E Coverage

**Goal:** Close quality gaps from Sprint 10, add missing E2E tests for delivered features, resolve trivial tech debt, and ensure the codebase is solid before starting the GemStack feature (S11).

**Branch:** `sprint-10a`
**Depends on:** S10 (complete)

---

## Status

| Feature | Status |
|---------|--------|
| P1: Missing E2E tests (5 journeys) | PENDING |
| P2: Trivial code-improvements (13 items) | PENDING |
| P3: Stale doc updates | DONE (user_stories, test-coverage-matrix, backlog) |
| P4: SVE-05/SVE-11 completion | PENDING |
| P5: R key conflict resolution for S13 | PENDING |

---

## What gets built

### P1 — Missing E2E Tests

Sprint 10 delivered multi-round, restore, and finalize features but no Playwright E2E tests were added. The Sprint 10 spec called for 2 E2E journeys that were not implemented. This phase adds 5 critical E2E specs.

#### E2E-1: Multi-round workflow
**File:** `tests/e2e/multi-round.spec.ts`

Journey: Open project → enter stack → decide all photos (Y/X) → commit round (Ctrl+Enter) → verify Round 2 shows only survivors → make decisions in Round 2 → verify round tab bar shows R1 R2.

Assertions:
- After commit, grid shows fewer photos (eliminated hidden)
- Round tab bar displays with correct round numbers
- Decisions in Round 2 don't affect Round 1 snapshot

#### E2E-2: Round navigation
**File:** `tests/e2e/round-navigation.spec.ts`

Journey: After multi-round setup → press `[` to navigate to Round 1 → verify read-only mode (Y/X disabled) → press `]` to return to Round 2 → verify editing works again.

Assertions:
- Read-only warning visible in historical round
- Decision keys produce no IPC calls in historical view
- Navigation back to current round re-enables editing

#### E2E-3: Restore eliminated photo
**File:** `tests/e2e/restore-flow.spec.ts`

Journey: Eliminate photo in R1 → commit → in R2, navigate back to R1 → see "Not in R2" badge → press R → return to R2 → verify restored photo appears as undecided.

Assertions:
- Badge "Not in R{N}" visible on eliminated photo in historical view
- After R key, badge disappears
- Photo appears in current round grid

#### E2E-4: Finalize/reopen flow
**File:** `tests/e2e/finalize-flow.spec.ts`

Journey: Decide all photos → press Ctrl+Shift+Enter → see "Stack finalized. N survivors." confirmation → verify read-only mode → press Ctrl+Shift+Enter again to reopen → verify editing works.

Assertions:
- Inline confirmation text appears and auto-dismisses
- Finalized badge visible in StackOverview
- Reopen re-enables decision keys

#### E2E-5: Comparison View workflow
**File:** `tests/e2e/comparison-view.spec.ts`

Journey: Enter stack → press C to enter ComparisonView → verify side-by-side layout → press X on left photo → verify auto-fill replaces it → press Esc to return.

Assertions:
- Two photos displayed side by side
- Eliminate replaces photo with next undecided
- Esc returns to StackFocus

---

### P2 — Trivial Code Improvements (13 items)

All TRIVIAL or LOW effort items from `docs/code-improvements.md` that can be safely fixed without behavior changes. Each is a refactoring — tests must still pass after.

| ID | Title | Effort | Module |
|----|-------|--------|--------|
| DUP-05 | RAW extension list duplicated | TRIVIAL | scanner.rs, exif.rs |
| DUP-09 | Duplicate Esc handling | MEDIUM | App.svelte, screens |
| DUP-10 | Thumbnail progress bar HTML duplicated | LOW | StackOverview.svelte |
| DEAD-01 | ThumbnailStrategy.use_exif_fast_path never read | MEDIUM | pipeline.rs |
| DEAD-02 | generate_thumbnail_from_bytes dead code | LOW | pipeline.rs |
| DEAD-03 | merges table appears dead/legacy | MEDIUM | migrations.rs |
| DEAD-04 | find_missing_thumbnail_targets wrapper | MEDIUM | pipeline.rs |
| DEAD-05 | Two separate restack implementations | LOW | pipeline.rs |
| DEAD-06 | Two redundant EXIF dispatch functions | LOW | exif.rs |
| DEAD-07 | Redundant cancel check in pipeline step 3 | LOW | pipeline.rs |
| MIS-03 | Hardcoded thumbnail size 256x256 | LOW | pipeline.rs |
| MIS-04 | Cache dir path construction repeated | LOW | multiple |
| INC-05 | Orientation applied after resize | LOW | pipeline.rs |

**Process:** Each item is a refactoring with safety net:
1. Run full test suite (must pass before)
2. Apply the fix
3. Run full test suite (must still pass after)
4. Commit with `refactor: resolve {ID} — {title}`

---

### P3 — Stale Doc Updates

**Status: DONE** (completed in this session)

| Document | Update |
|----------|--------|
| `docs/user_stories.md` | 16 items updated from NOT STARTED → DONE with sprint refs |
| `docs/test-coverage-matrix.md` | Counts updated to 932+, Sprint 10D entries added |
| `docs/backlog.md` | Sprint 10 marked complete, test counts updated, pre-S11 section added |

---

### P4 — SVE-05/SVE-11 Completion

Sprint 10d pre-flight partially addressed these:
- **SVE-05** (decision key dedup): `handleDecisionKey` extracted to `src/lib/utils/decisions.ts` but SingleView and ComparisonView may still have inline duplicates. Verify all 3 screens route through the shared utility.
- **SVE-11** (handleKey split): StackFocus `handleKey` reduced from 270→21 lines. Verify it stays under 50 lines after Phase D additions (R key, Ctrl+Shift+Enter).

**Task:** Audit and verify — if screens already use the shared utility, mark as RESOLVED. If not, wire them up.

---

### P5 — R Key Conflict Resolution

Sprint 10D assigned `R` key to "restore eliminated photo" in StackFocus historical views. Sprint 13 plans to use `R` for "RAW toggle on demand." These conflict.

**Decision needed:** Choose one of:
1. `R` = restore (historical views only), `Shift+R` = RAW toggle (everywhere)
2. `R` = RAW toggle (everywhere), `Alt+R` = restore (historical views only)
3. `R` = restore in historical views, `R` = RAW toggle in current round (context-dependent)

**Task:** Document the decision in `docs/keyboard-map.md` and update the spec.

---

## Success criteria

1. 5 new Playwright E2E specs pass (multi-round, round nav, restore, finalize, comparison)
2. 13 code-improvement items resolved and marked `[RESOLVED]` in code-improvements.md
3. SVE-05/SVE-11 verified as fully resolved or completed
4. R key binding conflict documented with clear decision
5. All existing tests still pass (452 Rust + 480 frontend + 29 E2E)
6. `cargo clippy` clean, `cargo fmt` clean

---

## "Good enough" definition

- E2E tests cover the happy path only — no edge cases. 1 journey per spec.
- Code improvements are mechanical refactors. If an item turns out to be MEDIUM+ effort during implementation, defer it — don't redesign.
- SVE-05/SVE-11 audit is pass/fail — either the shared utility is used everywhere or it isn't.
- R key conflict needs a decision documented, not necessarily implemented.

---

## Implementation order

1. **P4** first (audit only — no code changes expected)
2. **P2** second (trivial refactors — mechanical, low risk)
3. **P5** third (decision + docs update)
4. **P1** last (E2E tests — requires working app, highest complexity)

---

## Test layers

| Feature | Unit | Component | E2E |
|---------|:----:|:---------:|:---:|
| Multi-round workflow | existing | existing | NEW |
| Round navigation | existing | existing | NEW |
| Restore eliminated photo | existing | existing | NEW |
| Finalize/reopen | existing | existing | NEW |
| Comparison View | existing | existing | NEW |
| Code improvements (P2) | existing (refactor) | | |
| SVE-05/SVE-11 (P4) | existing | existing | |

---

## Modules touched

| File | Changes |
|------|---------|
| `tests/e2e/*.spec.ts` | 5 new E2E spec files |
| `src-tauri/src/import/pipeline.rs` | DEAD-01/02/04/05/07, MIS-03 |
| `src-tauri/src/import/exif.rs` | DEAD-06, DUP-05 |
| `src-tauri/src/import/scanner.rs` | DUP-05 |
| `src-tauri/src/db/migrations.rs` | DEAD-03 |
| `src/lib/components/screens/StackOverview.svelte` | DUP-10 |
| `docs/keyboard-map.md` | P5 decision |
| `docs/code-improvements.md` | Mark 13 items resolved |

---

## Deferred from this sprint

- ABS-01 (camera abstraction) — LARGE effort, defer to S13
- ABS-02 (JPEG/RAW extractor unification) — LARGE effort, defer
- MIS-01 (transaction helper) — MEDIUM, defer to when a bug is caused by missing transactions
- MIS-02 (SQL placeholder generation) — MEDIUM, defer
- INC-01/INC-04 (structured error types) — MEDIUM, defer to S13 polish
- BUG-07 (pause during thumbnails) — MEDIUM, defer
- DUP-04 (stack_id_map pattern) — depends on DUP-01
- ABS-03/04/05 — MEDIUM+ effort, defer
