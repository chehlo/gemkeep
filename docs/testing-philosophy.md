# GemKeep Testing Methodology

> Single source of truth for how tests are written in this project.
> Every rule was earned by a real bug escaping to the running app.
> Replaces: testing-philosophy.md (Sprint 3 retrospective) + testing-standards.md (aspirational).

---

## Section 1: The Core Problem — Why Tests Pass but the App Breaks

A passing test suite is not a clean bill of health. It is a record of the things we
thought to test. The things we did not think to test are the things that break.

In a layered system — Rust backend, SQLite database, Tauri IPC, Svelte frontend — every
layer can be correct in isolation while the composition is wrong. Five integration gap
patterns account for most escaped bugs:

**Pattern A: Isolated correctness, wrong runtime inputs.**
The algorithm is correct. The unit tests prove it — but the tests hardcode the config
values that are supposed to come from the real config system. In production, the config
system delivers different (often broken) values. No test ever ran the two together.

**Pattern B: Side-effect clobbering.**
A function reads a record, modifies one field, and writes it back. Unit tests verify
that the target field is correct. No test checks that the OTHER fields survived.

**Pattern C: Behavioral regression on the second invocation.**
A UI flow works correctly the first time. A timing dependency or initialization flag
behaves differently on the second invocation. Tests written to cover a scenario test
it once and declare success.

**Pattern D: The mock sandwich.**
Frontend tests mock `invoke()` with hardcoded responses. Backend tests call internal
functions with real data. Nobody tests that the mock responses match what the real backend
returns. The frontend test says "thumbnails exist" (mock data). The real backend says
"thumbnails missing" (filesystem check). No test connects the two. This is the root cause
of the thumbnail re-trigger bug and similar cross-layer failures.

**Pattern F: Runtime scope mismatch (servability gap).**
The backend returns a path or URL. Every test layer accepts it at face value: Rust tests
verify the path is non-empty and points to a real file; frontend tests mock `convertFileSrc()`
to always return a valid URL; E2E tests mock IPC so no real asset serving occurs. But the
runtime has a gatekeeper — Tauri's `assetProtocol.scope`, CORS policy, filesystem permissions —
that silently rejects the path. The result: a black `<img>`, a 403, or a silent load failure
that no test layer catches. This is Pattern D (mock sandwich) compounded with Pattern A
(wrong runtime inputs): every layer is individually correct, but the runtime's allowlist
was never consulted by any test.

*Sprint 7 example:* `get_photo_detail()` returns `jpeg_path: "/home/user/Photos/IMG.jpg"`.
SingleView tries this path first via `convertFileSrc()` → `asset://localhost/home/user/Photos/IMG.jpg`.
Tauri's asset protocol scope is `$HOME/.gem-keep/**` — the original photo path is outside scope.
Tauri silently refuses to serve the file. The `<img>` renders as a black rectangle. All 334
tests passed because: (a) Rust tests verified the path was correct, (b) jsdom tests mocked
`convertFileSrc` to return an always-valid URL, (c) E2E tests mocked IPC so no real Tauri
asset serving occurred, (d) no test connected "path the backend returns" to "paths the
asset protocol will actually serve."

*The fix:* A Rust integration test that reads the real `tauri.conf.json` asset protocol scope
patterns and validates that every path returned by commands like `get_photo_detail()` and
`read_thumbnail()` matches at least one scope pattern. This test requires no mocks on either
side of the seam — it reads real config and checks real paths against real glob patterns.

Sprints 3-7 produced multiple bugs fitting these patterns. None were visible to existing
tests. The tests were not wrong — they were testing the wrong things.

---

## Section 2: The Testing Pyramid

```
                    ┌──────────────────┐
                    │  Layer 5: Smoke  │  1 test per sprint
                    │  (Real binary)   │  cargo tauri dev + Playwright
                    ├──────────────────┤
                    │  Layer 4: E2E    │  3-5 journeys per sprint
                    │  (Playwright)    │  Chromium + mocked IPC
                    ├──────────────────┤
                    │  Layer 3: Comp.  │  Varied data, multi-step
                    │  (vitest-browser │  flows, strict mock hygiene
                    │   -svelte)       │
                    ├──────────────────┤
                    │  Layer 2: Rust   │  Full pipeline, real config
                    │  Integration     │  flow, contract tests, IPC
                    ├──────────────────┤
                    │  Layer 1: Rust   │  Pure functions, actual
                    │  Unit Tests      │  output values, Default impls
                    └──────────────────┘
```

### Layer 1: Rust Unit Tests

**Scope:** Pure functions, algorithms, data transformations.
**Tools:** `cargo test`, in `#[cfg(test)] mod tests` blocks.
**Must test:** Actual output values (Rule 1), Default impls (Rule 2).

### Layer 2: Rust Integration Tests

**Scope:** Full pipeline end-to-end, IPC command dispatch, contract tests, integration seam tests.
**Tools:** `cargo test`, Tauri mock runtime (`tauri::test`), real SQLite (in-memory).
**Must test:** Config flow through pipeline (Rule 6), idempotency (Rule 11),
IPC JSON shape (Rule 10), timing with tight thresholds (Rule 7),
runtime scope validation (Rule 15).

**Integration seam testing:** Where two layers meet (e.g., Rust returns a path, Tauri
serves it via asset protocol), there MUST be at least one test that validates the contract
across the seam without mocks on either side. Seam tests read the real config
(`tauri.conf.json`), call the real backend function, and verify that the output satisfies
the runtime's constraints (e.g., returned paths match `assetProtocol.scope` glob patterns).
Seam tests catch Pattern F bugs that no amount of per-layer testing can detect.

### Layer 3: Component Tests (Vitest)

**Scope:** Svelte component behavior with varied props and state.
**Tools:** vitest-browser-svelte + real Chromium (visual + behavior).
Legacy: Vitest + jsdom (non-visual behavior tests).
**Must test:** Realistic mock data (Rule 4), second navigation (Rule 5),
strict mock hygiene (Rule 9), visual CSS assertions (Rule 14) at the
component level.

### Layer 4: E2E Tests (Playwright, mocked IPC)

**Scope:** Complete user journeys + cross-component visual correctness. Real Chromium rendering, mocked IPC.
**Tools:** Playwright, `page.addInitScript()` for IPC mocking.
**Must test:** Critical state machine transitions, timing assertions (Rule 7),
new feature journeys (Rule 8), journey-level visual CSS assertions (Rule 14) —
boundingBox containment, computed styles, Tailwind class compilation.

### Layer 5: Smoke Test (Playwright, real binary)

**Scope:** One test per sprint that runs against the REAL `cargo tauri dev` binary.
No mocked IPC. Real SQLite, real filesystem, real asset:// protocol.
**Tools:** Playwright, cargo tauri dev via webServer config.
**Must test:** The primary user journey of the sprint, end-to-end with real data.

---

## Section 3: Rules for Writing Tests

### Rule 1: Test the actual output, not the return type

Read back the produced artifact. If a function generates a thumbnail, open it with
`image::open()` and assert dimensions. If it writes to DB, re-query and assert values.

```rust
// BAD
assert!(generate_thumbnail(&src, ...).is_ok());

// GOOD
generate_thumbnail(&src, ...).unwrap();
let img = image::open(dir.join("1.jpg")).unwrap();
assert_eq!(img.width(), 256);
assert_eq!(img.height(), 256);
```

### Rule 2: Test Default implementations explicitly

Any struct with `impl Default` where any field has a non-zero intended default:
```rust
#[test]
fn test_config_default_burst_gap_is_3() {
    assert_eq!(Config::default().burst_gap_secs, 3);
}
```

### Rule 3: Test config survival across operations

Any function that reads config, modifies one field, writes back:
1. Write config with non-default value for a field the function does NOT modify.
2. Call the function.
3. Re-read config.
4. Assert the non-default value survived.

### Rule 4: Use realistic mock data with duplicates

SQLite `INTEGER PRIMARY KEY` starts at 1 in every new database. Two projects both have
`id: 1`. Mock data must reflect this. Lists must have 2+ items.

### Rule 5: Test the second navigation, not just the first

For any flow that saves/restores state, test the round trip at least twice with
different target positions. The second trip proves the mechanism works actively.

### Rule 6: Pipeline tests must vary config values

Run the pipeline with at least two different values of each config parameter.
Assert results differ. A test that hardcodes `burst_gap_secs: 3` every time cannot
detect bugs where the pipeline ignores config entirely.

### Rule 7: Performance assertions must be binding

Threshold = 3x actual measured time. Document the measurement:
```rust
// Measured 2026-02-21 on AMD Ryzen 5 5625U: ~50ms
// Threshold: 150ms (3x)
assert!(elapsed.as_millis() < 150);
```

### Rule 8: New feature = new E2E spec

Each sprint adds at least one Playwright test covering its primary user-facing feature.

### Rule 9: Mock hygiene — default must throw

**The setup.ts default mock for `invoke()` must throw on unmocked commands.**

```typescript
// setup.ts
invoke: vi.fn((cmd: string) => {
  throw new Error(
    `Unmocked invoke("${cmd}"). ` +
    `Add mockInvoke.mockResolvedValueOnce(...) before this call.`
  )
})
```

**Why:** The previous default (`Promise.resolve(undefined)`) silently swallowed
unmocked commands. A test could pass while the component received wrong data from
an exhausted mock queue. With a throwing default:
- Every test must explicitly mock every command the component calls
- Any new invoke call added to a component immediately breaks tests until mocked
- No silent `undefined` flowing through the component as fake data

**Call sequence verification:** After each test, verify the full sequence of calls:
```typescript
const calls = mockInvoke.mock.calls.map(c => c[0])
expect(calls).toEqual([
  'list_source_folders',
  'list_stacks',
  'get_indexing_status',
])
```

This catches: wrong call order, extra calls, missing calls, duplicate calls.

### Rule 10: Cross-layer contract tests

**For each IPC command the frontend depends on, a Rust test must verify the
JSON response shape matches what the frontend expects.**

The mock sandwich problem: frontend tests mock `invoke('list_stacks')` returning
`{ stack_id, thumbnail_path, ... }`. Backend tests call internal Rust functions.
Nobody verifies that the Rust `#[tauri::command]` actually produces that JSON shape.

Contract test pattern (in `ipc_tests.rs`):
```rust
#[test]
fn test_list_stacks_json_shape() {
    // Setup: create project, run pipeline, generate thumbnails
    let app = make_app(temp_home());
    // ... setup steps ...

    let response = get_ipc_response::<Vec<serde_json::Value>>(
        &app, "list_stacks", json!({ "slug": "test" })
    );

    // Verify shape matches TypeScript StackSummary interface
    let stack = &response[0];
    assert!(stack.get("stack_id").unwrap().is_number());
    assert!(stack.get("logical_photo_count").unwrap().is_number());
    assert!(stack.get("earliest_capture").is_some()); // nullable string
    assert!(stack.get("thumbnail_path").is_some());   // nullable string
}
```

**When to add contract tests:** Every time a new IPC command is added or an existing
command's return type changes. The contract test is part of the Definition of Done.

### Rule 11: Idempotency — test every operation twice

Operations that should be idempotent must be tested for idempotency:

```rust
// Pipeline idempotency
let stats1 = run_pipeline(&conn, ...);
assert!(stats1.stacks_generated > 0);
let stats2 = run_pipeline(&conn, ...); // same folder, same config
assert_eq!(stats2.stacks_generated, 0, "second run must import nothing");
```

```typescript
// Thumbnail resume idempotency: mount with all thumbnails, no resume
// Unmount, remount — still no resume
```

```typescript
// Navigation idempotency: navigate → back → navigate → back
// Scroll position correct both times
```

The thumbnail re-trigger bug is an idempotency failure: opening the app should be
idempotent when thumbnails already exist. No test verified this.

### Rule 12: Real-binary smoke test per sprint

One Playwright test per sprint that runs against the REAL `cargo tauri dev` binary.
Not mocked IPC. Tests the complete user journey with real data.

```typescript
// tests/e2e/smoke-real-binary.spec.ts
test('sprint 4: thumbnails display and persist across app restart', async ({ page }) => {
    // Real binary, real SQLite, real filesystem
    // Create project → add folder → index → see thumbnails
    // Navigate away → come back → thumbnails still there (no re-trigger)
})
```

This test is slow (~30s startup + test time). It is the only test that proves all
layers work together. It does not replace unit or component tests — it is the final
gate that catches everything the fast tests miss.

Skip in CI with: `test.skip(!process.env.TAURI_DEV, 'requires cargo tauri dev')`

### Rule 13: TDD — always write the failing test first

Every bug fix and every new feature starts with a test that reproduces the bug
or specifies the new behavior. The test must FAIL (RED) before any implementation.
Only after confirming the failure do you write the minimum code to make it pass (GREEN).

This rule exists because of the restack-thumbnail bug: `restack` unconditionally
deleted all thumbnails and recreated all logical_photo rows with new IDs. Two tests
(TH-D3, Sprint 6-J2) were written AFTER the bug was introduced and treated the
broken behavior as correct — they asserted that `resume_thumbnails` IS called after
restack. Had the test been written first ("restack must NOT trigger thumbnail
regeneration"), the bug would have been caught immediately.

TDD workflow:
1. **RED**: Write test that asserts the correct behavior. Run it. It must FAIL.
2. **GREEN**: Write the minimum code to make the test pass. Run it. It must PASS.
3. **REFACTOR**: Clean up without changing behavior. All tests still pass.

If the test passes on step 1, either the bug does not exist or the test is wrong.
Investigate before proceeding.

```
# RED: test must fail before fix
cargo test test_restack_preserves_thumbnail_files -- --nocapture
# ... FAILED (expected)

# GREEN: implement fix, test must pass
cargo test test_restack_preserves_thumbnail_files -- --nocapture
# ... ok (1 passed)
```

### Rule 14: Visual CSS assertions require a real browser engine, not jsdom

jsdom has no layout engine — it cannot verify CSS positioning, computed styles, or
Tailwind class compilation. Any test that asserts visual correctness (borders visible,
badges positioned inside cards, opacity applied, colors correct) **must** use a real
browser engine via either vitest-browser-svelte (Layer 3, component-scoped) or
Playwright (Layer 4, journey-level).

**Two-tool approach:**
- **vitest-browser-svelte** — component-scoped visual tests: badge positioning within
  a card, element opacity, computed colors on a single component. Fast (~50-100ms/test).
- **Playwright** — journey-level visual tests: cross-component layout, multi-page flows,
  full-page visual assertions. Slower (~1-5s/test) but tests the full page context.
- Both run real Chromium. vitest-browser-svelte is faster and should be preferred for
  single-component visual assertions.

**Never use jsdom to test:**
- Element positioning (`absolute`, `relative`, `fixed`)
- Computed CSS values (opacity, border-color, background-color)
- Whether a Tailwind utility class produces visible output
- Whether overflow clipping hides an element

**jsdom is acceptable for:**
- DOM presence (element exists after state change) — legacy, non-visual assertions
- Class toggling logic (class added/removed in response to props)
- Text content and attribute values

For NEW component tests that need visual assertions, use vitest-browser-svelte
(Layer 3). For tests that only check DOM presence/class toggling/text, jsdom
remains acceptable.

```typescript
// BAD — jsdom "passes" even when badge escapes its card
expect(card.querySelector('.badge-keep')).toBeTruthy()

// GOOD — vitest-browser-svelte catches it at component-test speed
const cardBox = await card.boundingBox()
const badgeBox = await badge.boundingBox()
expect(badgeBox!.y).toBeGreaterThanOrEqual(cardBox!.y)

// ALSO GOOD — Playwright catches it in E2E context (use for journey tests)
const cardBox = await page.locator('[data-testid="card"]').boundingBox()
```

This rule was earned by the StackFocus badge bug (Sprint 7): the badge had
`absolute top-1 right-1` but its parent card lacked `position: relative`. jsdom
tests showed the badge element existed. Playwright proved it rendered at
`y=4` while the card was at `y=73` — the badge escaped the card entirely.

### Rule 15: Runtime scope assertions — validate paths against the runtime's allowlist

**Any backend command that returns a file path consumed by the frontend via
`convertFileSrc()` must have a Rust integration test proving the path falls within
the Tauri `assetProtocol.scope` patterns.**

The asset protocol is a silent gatekeeper: if a path does not match a scope pattern,
Tauri returns nothing (no error, no log, just a black `<img>`). Mocks hide this
completely — `convertFileSrc()` is mocked to always succeed, and E2E tests mock IPC
so no real asset serving occurs.

```rust
#[test]
fn test_photo_detail_paths_within_asset_scope() {
    // Read real tauri.conf.json → extract assetProtocol.scope patterns
    let conf = read_tauri_conf();
    let scope_patterns = conf.asset_protocol.scope;

    // Call get_photo_detail with a real project
    let detail = get_photo_detail(&conn, "test-project", photo_id).unwrap();

    // Every path the frontend will feed to convertFileSrc() must match scope
    if let Some(thumb) = &detail.thumbnail_path {
        assert!(matches_any_scope_pattern(thumb, &scope_patterns),
            "thumbnail_path {} not in asset scope {:?}", thumb, scope_patterns);
    }
    // jpeg_path is an ORIGINAL photo path — it must NOT be assumed servable
    // unless the scope explicitly includes the source folder
}
```

**When to add scope tests:** Every time a new IPC command returns a path that the
frontend will serve via `asset://`. The scope test is part of the Definition of Done
alongside the contract test (Rule 10).

**This rule catches Pattern F** — the gap where every layer is correct but the runtime
silently refuses to serve a path that no test ever validated against the scope.

This rule was earned by the SingleView black screen bug (Sprint 7): `get_photo_detail()`
returned `jpeg_path` pointing to the original photo outside `$HOME/.gem-keep/**`. The
frontend tried `convertFileSrc(jpeg_path)` first, Tauri silently refused, and the
`<img>` rendered black. All 334 tests passed.

### Rule 16: Use existing test infrastructure — mandatory

**Before writing any test setup code, search for and use existing helpers.**
Creating new test utilities when equivalent ones already exist causes the
restructuring debt that led to the test-improvements sprint.

#### Rust — mandatory infrastructure

| Tool | When to use | Exception requires |
|------|------------|-------------------|
| `TestLibraryBuilder` (`crate::import::test_fixtures`) | Any test needing projects, stacks, photos, or logical_photos | Explicit user approval |
| `TestProject` (`crate::import::test_fixtures`) | Any test needing a project directory + DB | Explicit user approval |
| `setup_ipc_home()` / `setup_ipc_with_photos()` (`commands/ipc_tests.rs`) | IPC command tests | None — always use |
| Verification helpers: `count_thumbnails()`, `get_lp_ids()`, `get_status()` | Checking test outcomes | None — always use |

**Forbidden patterns** (without explicit approval):
- `Connection::open_in_memory()` for photo-related tests — use `TestLibraryBuilder::new().build_db_only()` or `TestProject`
- Hand-written `INSERT INTO photos/logical_photos/stacks` SQL — use Builder methods
- Ad-hoc JPEG/EXIF file creation — use `PhotoSpec` with Builder

#### Frontend — mandatory infrastructure

| Tool | Location | When to use |
|------|----------|------------|
| `IDLE_STATUS`, `PHOTO_1/2/3`, `OPEN_ROUND` | `src/test/fixtures.ts` | Any test needing these constants |
| `makePhoto()`, `makeStack()`, `makeDecisionResult()` | `src/test/fixtures.ts` | Creating test data |
| `resetInvokeMock()` | `src/test/helpers.ts` | Every `beforeEach` that clears mocks |
| `renderStackOverview()` | `src/test/helpers.ts` | StackOverview render with mock chain |
| `mockStackFocusMount()` | `src/test/helpers.ts` | StackFocus mount mocking |
| `mockSingleViewMount()` | `src/test/helpers.ts` | SingleView mount mocking |
| `waitForCards()` | `src/test/browser-helpers.ts` | Browser tests waiting for card elements |
| `DECISION_SELECTORS` | `src/test/decision-helpers.ts` | Querying decision badge elements |
| `assertVisuallyKept()` etc. | `src/test/decision-visual-helpers.ts` | Pixel-verified decision/focus/selection assertions (Rule 17) |
| `assertColorVisibleInElementArea()` | `src/test/pixel-verifier.ts` | Low-level pixel ring scan via `page.screenshot()` |
| `SELECTION_COLORS`, `DECISION_COLORS` | `src/lib/constants/{selection,decisions}.ts` | Single source of truth for all indicator colors |

**Before creating any new helper:** grep the `src/test/` directory and existing test files
for similar functionality. If a helper exists, use it. If it needs extension, extend it.

### Rule 17: Visual assertions must be style-agnostic AND pixel-verified

**Browser tests that verify visual indicators must use semantic assertion
helpers that read actual rendered pixels — not `getComputedStyle()`.** Pixel
reads see what the user sees (see Rule 18 for why CSS-property reads are
insufficient). When the visual design changes (border → outline → badge-dot),
only the helper's pixel-sampling strategy updates — tests don't change.

**Helpers (all async, all pixel-verified):**

| Helper | Location | Verifies |
|--------|----------|----------|
| `assertVisuallyKept(el)` | `src/test/decision-visual-helpers.ts` | Kept color visible in el's pixels |
| `assertVisuallyEliminated(el)` | `src/test/decision-visual-helpers.ts` | Eliminated color visible in el's pixels |
| `assertVisuallyDimmed(el)` | `src/test/decision-visual-helpers.ts` | Overlay present or opacity < 0.6 |
| `assertVisuallyUndecided(el)` | `src/test/decision-visual-helpers.ts` | NO decision colors in el's pixels |
| `assertVisuallyFocused(el)` | `src/test/selection-visual-helpers.ts` | Focus color visible in el's pixels |
| `assertVisuallySelected(el)` | `src/test/selection-visual-helpers.ts` | Selection color visible in el's pixels |
| `assertNotVisuallyFocused/Selected(el)` | `src/test/selection-visual-helpers.ts` | Color NOT in el's pixels |
| `waitForVisualFocus/Selection(el)` | `src/test/selection-visual-helpers.ts` | Polls until pixels show the color |
| `countVisuallySelected(els)` | `src/test/selection-visual-helpers.ts` | How many show the selection color |

**How pixel verification works** (`src/test/pixel-verifier.ts`):
`page.screenshot({ base64: true })` captures the viewport; crop to a 3px-inside
+ 3px-outside ring around the element's border-box (stays inside gap-3 / gap-6
grid gaps so neighbours don't bleed in); scan for pixels matching the expected
color within ±3 tolerance. Two pass conditions:
(1) enough matching pixels exist (dynamically scaled to ≥5% of the element's
perimeter — so a 2px frame easily clears but a one-edge sliver of 6 pixels
fails), AND (2) matching pixels appear on ALL 4 sides (top, right, bottom,
left) of the element — ensuring the indicator forms a visible frame, not a
leaked sliver on one edge. Failure diagnostics report the top 5 actual colors
and which sides are missing.

**Color constants are the single source of truth.**
`SELECTION_COLORS.focused/selected` (`src/lib/constants/selection.ts`) and
`DECISION_COLORS.keep/eliminate` (`src/lib/constants/decisions.ts`) define every
indicator color. Even these constants do not appear in test bodies — tests call
semantic helpers, helpers reference the constants (see Rule 24).

**When the visual design changes:**
- Border → outline → badge-dot: **zero test changes**. The ring scan finds the
  color regardless of which CSS channel drew it.
- Color palette swap: update the constant file; no test changes.
- New indicator kind (e.g. "locked"): add constant + helper + tests; existing
  tests untouched.

### Rule 18: Browser tests must verify pixels, not class names or CSS properties

**"The user saw it" is the only meaningful assertion for a visual test.** Three
rungs exist on the visibility ladder — each catches a different class of bug,
and each higher rung subsumes the lower one:

1. **Class name check** (`className.contains('ring-blue-500')`) — proves a class
   is set. Doesn't prove it compiled, was applied, or rendered.
2. **Computed style check** (`getComputedStyle(el).outlineColor === '...'`) —
   proves CSS resolved the class. Doesn't prove the pixels survived the
   paint/composite/clip pipeline.
3. **Pixel read** (`page.screenshot()` + scan for the color) — proves the user
   actually sees the color. **Only rung that matches user experience.**

**Every `.browser.test.ts` visual indicator check must use rung 3** via the
Rule 17 helpers. Class-name assertions remain OK in `.test.ts` (jsdom) tests
for prop → class logic.

**The rendering pipeline** (and where each rung reads):

```
  Svelte → HTML      [0: DOM]
  Tailwind → CSS     [1: computed styles]   ← getComputedStyle() HERE
  Layout engine      [2: element positions] ← getBoundingClientRect() HERE
  Paint              [3: pixels drawn, paint order applied]
  Composite          [4: layers merged, ancestor/viewport clipping]
  Display            [5: pixels the user sees] ← page.screenshot() HERE
```

Bugs below Stage 3 are invisible to `getComputedStyle`:
- **Paint-order occlusion:** `ring-inset` is painted BEFORE border → border
  covers it. `outline` is painted AFTER border → outline covers border on
  overlap.
- **Ancestor clipping:** `outline-offset: 0` draws outside the element; an
  `overflow: hidden` ancestor clips those pixels.
- **Sibling overdraw:** a later-DOM-order sibling with a solid background
  paints over an earlier sibling's outline/shadow pixels.
- **Viewport clipping:** element fills the viewport; outline extends beyond;
  clipped.

**Why — two escalations, both landed in ComparisonView:**
1. `ring-2 ring-inset ring-blue-500` — `className.contains('ring-blue-500')`
   passed. Inset box-shadow painted BEHIND `border-2 border-gray-700`; blue ring
   invisible. Introduced: "use computed styles, not class names".
2. `outline outline-offset-0` — `getComputedStyle(...).outlineColor` passed.
   Outline clipped by `<main overflow-hidden>` and overdrawn by sibling panel;
   user saw nothing. Escalated: "computed styles are not enough — verify pixels."

### Rule 19: Zero unhandled errors — not just zero failures

Every test run must produce **0 unhandled errors**, not just 0 test failures.
Vitest reports unhandled rejections separately from test failures in the `Errors`
line. These are bugs in the test infrastructure, not false positives.

Common causes:
- **Timer leaks:** `setInterval` fires after test assertions complete but before
  `onDestroy` unmounts the component. The mock queue is exhausted and the next
  `invoke()` call throws.
- **Unmocked follow-up calls:** Component adds a new API call (e.g., `getRoundStatus`
  after `makeDecision`) but tests don't mock it.
- **Async lifecycle gaps:** A promise resolves after the test ends, triggering
  an unmocked path.

**Fix:** Use name-based mock routers (see `createMockRouter` in `helpers.ts`)
instead of ordered `mockResolvedValueOnce` queues. Routers match on command name
and return the right response regardless of call order or count. New API calls
only need one line added to the router defaults — zero test changes.

```typescript
// BAD — fragile ordered queue, breaks when component adds new API calls
mockInvoke.mockResolvedValueOnce(photos)    // hope this is list_logical_photos
mockInvoke.mockResolvedValueOnce(decisions) // hope this is get_round_decisions

// GOOD — name-based router, resilient to new API calls
mockInvoke.mockImplementation(mockStackFocusRouter({
  list_logical_photos: [photos],
  get_round_decisions: [decisions],
}))
```

**Why:** Commit `bd2b718` introduced browser tests with ordered mock queues.
When `3b3b266` added `getRoundStatus` after each decision, 13 tests started
producing unhandled `get_round_status` errors. All tests still "passed" because
the component caught the error. The 29 unhandled errors persisted for months
until the mock router refactor eliminated them all.

### Rule 20: Test names must honestly describe what the test verifies

**The test name is a promise to the reader.** Every word in the name must be backed
by an assertion in the code. If the name promises it, the code must verify it.

**Why this matters:** The test audit (docs/test-name-audit.md) found 90+ tests
where names promised behaviors the assertions didn't verify. These tests gave false
confidence — they "passed" while the app had real bugs including: selected photos
not passed to ComparisonView, clipboard copy never wired up, error messages never
shown, and status bar missing stack name.

**Four categories of name-assertion mismatch:**

**Category A: Visual claims in wrong environment**
- jsdom test says "shows green border" but checks `classList` — jsdom can't verify visuals
- Fix: rename to "applies decision-keep class" or move to browser test

**Category B: Name promises data/payload, assertion only checks action**
- Name says "with selected photos" but code only checks `navigation.kind`
- Name says "for the focused photo" but code never checks which photo ID
- Name says "auto-fills with next undecided" but code only checks IPC call, not content
- Fix: add assertion for the promised data

**Category C: Name promises "X and Y", assertion only checks one**
- Name says "eliminates AND auto-fills" but only checks eliminate
- Name says "shows stack name AND round number" but only checks round
- Name says "closes form AND clears input" but only checks form closed
- Fix: add assertion for the missing part

**Category D: Name promises scope, test too narrow**
- Name says "shows error" but only checks navigation stayed, no error assertion
- Name says "each card has correct class" but only checks one card
- Fix: widen assertion to match promised scope

**Enforced by:** `validateTestEnvironmentTask` in behavioral-tdd and
sprint-development processes — checks all 4 categories at the RED review
breakpoint.

#### Process rule

At sprint start, if ANY tests fail (Rust, frontend, E2E), the failure list must be
presented for explicit user approval before proceeding. Never silently categorize
failures as "pre-existing" or "known." Green means green — no exceptions.
**This includes unhandled errors** — the `Errors` line in Vitest output must be
absent or show 0.

### Rule 21: Lifecycle invariant tests — exercise operation sequences, not just single operations

**Every test on a fresh database is lying to you.** A single import, a single merge,
a single restack — each works fine in isolation. The bugs live in the seams between
operations that real users perform in sequence.

**Why this matters:** The round-photo bug escaped 390+ passing tests because every test
ran one operation on a fresh DB. No test ever ran import → merge → undo → restack,
which is what users do. SQLite reused deleted row IDs, orphaned rounds matched new
stacks, and photos disappeared from the UI — all invisible to single-operation tests.

**The pattern: define a user-visible invariant, assert it after every
mutation in a realistic operation sequence.** An invariant is a contract
that must hold at all times regardless of which operations ran.

```rust
// Invariant: photos visible through the round == photos in the stack
fn assert_round_photo_invariant(conn: &Connection, project_id: i64) {
    for (stack_id, lp_count) in get_all_stacks(conn, project_id) {
        let round_id = get_round_id_for_stack(conn, project_id, stack_id);
        assert_eq!(query_logical_photos_by_round(conn, round_id).len(), lp_count);
    }
}

#[test]
fn test_invariant_survives_full_lifecycle() {
    init_stacks();                         assert_round_photo_invariant(...);
    merge_stacks(conn, ...);               assert_round_photo_invariant(...);
    undo_last_merge(conn, ...);            assert_round_photo_invariant(...);
    restack(conn, ...);                    assert_round_photo_invariant(...);
}
```

**Good invariants are user-visible contracts** ("I see my stack photos"),
not implementation details ("table has N rows"). Assert after EVERY mutation
— the first failure pinpoints which operation broke it. Exercise realistic
user sequences (import → decide → merge → undo → restack).

**Write invariant tests when** a feature touches persistent data, multiple
code paths modify the same data, undo/redo is involved, or after a single-
operation test misses a bug.

### Rule 22: Indicator combinations must have explicit pixel coverage per view

**Every view rendering a photo with state must test every meaningful
combination of indicators, not each in isolation.** One photo can carry three
independent states simultaneously: decision (keep/eliminate/undecided),
selection (selected/none), focus (focused/none). A bug where two indicators
collide — one covers the other, one is clipped by a layout, one is absent in
a specific state combination — is invisible to tests that exercise indicators
alone. Existing coverage is patchy; see `docs/test-coverage-matrix.md` for
the current state.

**Minimum per-view coverage** — each row is a distinct visual rendering, each
needs one pixel-verified test:

| decision | selection | focus |
|---|---|---|
| undecided | none | focused |
| undecided | selected | focused |
| keep | none | focused |
| keep | selected | focused |
| eliminate | none | focused |
| eliminate | selected | focused |

```ts
it('focused + kept + selected photo shows ALL three indicators', async () => {
  const frame = /* set up with focused=true, status=keep, selected=true */
  await assertVisuallyFocused(frame)
  await assertVisuallyKept(frame)
  await assertVisuallySelected(frame)
})
```

**Why:** Sprint 10's outline-offset bug manifested per combination.
`focused+kept` in StackFocus had the outline covering the decision border.
`focused+undecided` in ComparisonView had the outline clipped by
`<main overflow-hidden>`. Neither was covered before the refactor landed —
each existing test exercised one indicator in one view that happened to
work. A single `focused+kept` test per view would have caught it
immediately.

### Rule 23: Photo fixtures in visual tests must not contain indicator colors

**Test photos used in pixel-verified tests must have `thumbnail_path: null`
or use dedicated known-color fixture images.** The pixel-verifier scans a
decoration ring that includes the element's own content near the border — a
photo with blue sky or green forest pixels would match `SELECTION_COLORS.focused`
or `DECISION_COLORS.keep` by accident, producing false positives.

- **Default:** `thumbnail_path: null` triggers the `bg-gray-900` dark
  placeholder inside PhotoFrame — no content colors at all. Example:
  `{ ..._PHOTO_1, thumbnail_path: null }`.
- **When real image data is needed** (e.g. thumbnail cropping/orientation
  tests), use dedicated fixture photos with known solid-color content that
  cannot collide with any `SELECTION_COLORS` or `DECISION_COLORS` entry.
  Document the exact RGB content alongside the fixture.
- **Never** use real-world photos as visual test inputs.

For pipeline tests that consume real image data (thumbnail generation, EXIF
parsing, crop, rotation), see Rule 25 — fixtures with designed properties.

### Rule 24: Test bodies are functional descriptions — no colors, no visual `expect()`

**Test files read as sequences of semantic actions and semantic assertions.**
Implementation details (color values, CSS properties, DOM traversal) live in
helpers. Two hard constraints enforce this:

**Constraint 1 — No color literals in tests.** `rgb(`, `rgba(`, `#rrggbb`,
and Tailwind color-scale class names (`green-500`, `yellow-400`, etc.) must
not appear in `*.test.ts` files (including comments). Colors live in
`SELECTION_COLORS`, `DECISION_COLORS`, and similar constants; helpers consume
them; tests call helpers. If a test needs to reference a color, it should be
a helper instead.

**Constraint 2 — No `expect()` on visual state in browser test bodies.**
`expect(getComputedStyle(...))`, `expect(...boundingBox...)`,
`expect(el.className).toContain(...)` — all belong inside helpers, not tests.
Tests call a semantic helper; the helper contains the `expect()`.

`expect()` remains appropriate for non-visual assertions: IPC calls, navigation
state, counts, data shape.

**Gates (must pass before commit):**
```bash
# Constraint 1
grep -rn -E "rgb\(|#[0-9a-fA-F]{6}|(green|red|blue|yellow)-[0-9]" \
  src/ --include="*.test.ts" | grep -v "pixel-verifier.browser.test.ts"
# → zero matches (pixel-verifier's own smoke tests are the one exception)

# Constraint 2
grep -rn -E "expect\(getComputedStyle|expect\(.*\.(borderColor|outlineColor|backgroundColor|boxShadow)|expect\(.*\.className\)\.toContain\(" \
  src/ --include="*.browser.test.ts"
# → zero matches
```

**Good — test reads like English:**
```ts
it('ArrowRight moves focus to the next card', async () => {
  render(StackFocus)
  const cards = await waitForCards(3)
  await assertVisuallyFocused(cards[0])
  await assertNotVisuallyFocused(cards[1])
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
  await waitForVisualFocus(cards[1])
  await assertNotVisuallyFocused(cards[0])
})
```

No colors, no CSS property names, no `expect()` for visual state. When the
indicator substrate changes (border → outline → badge-dot → screenshot diff),
the test is untouched.

**Why:** Sprint 10 had 42 browser-test call sites asserting visual state via
`expect(getComputedStyle(...))`. When the indicator substrate switched twice
in one week, every `expect()` had to be edited separately. Semantic helpers
let us change the substrate four times without touching any test body.

### Rule 25: Image-processing pipelines are verified via designed fixture photos

**Every pipeline that reads, transforms, or extracts data from photos is
verified against fixture images designed to make the output unambiguous.**
"Looks right on a real photo" is human review, not a test — deterministic
properties of known-input fixtures are.

**Shape of a pipeline test:** fixture with known content → run pipeline →
assert output properties derived from the known content.

**What fixtures provide** (designed-in, not accidental):
- Known pixel content — corner markers + center patterns → verifies composition preserved
- Known metadata — EXIF orientation, timestamp, camera, exposure → verifies parsing
- Known file structure — with/without embedded preview, with/without RAW pair → exercises alternate paths
- Minimal size — small dimensions + lowest quality → fast tests
- Catalogued in `src/test/fixtures/photos/README.md` alongside the files, listing each fixture's designed properties

**What pipeline tests assert** (not "looks right"):
- Corner markers present in correct quadrants → no crop, correct rotation
- Parsed EXIF matches baked-in values → metadata extraction correct
- Output aspect ratio ≈ input aspect ratio → resize preserves shape
- Pixels at known fixture locations match known colors → decoding correct

**When to add a fixture:** you are writing a pipeline stage and no existing
fixture exercises its unique input — new codec, new EXIF tag, new size
path, new orientation, new format. Or a bug escaped because no fixture
covered the scenario.

**Applies to all image pipelines:** EXIF parsing, orientation application,
thumbnail generation (fast embedded-preview path AND slow full-decode path),
RAW decoding, crop/resize, preview extraction.

---

## Section 4: Test Infrastructure

### Rust Tests
```bash
cargo test --manifest-path src-tauri/Cargo.toml          # all tests
cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings  # lint
cargo fmt --manifest-path src-tauri/Cargo.toml --check   # format check
```

- Real SQLite (in-memory via `Connection::open_in_memory()`)
- Real filesystem (tempdir via `tempfile` crate)
- Tauri mock runtime for IPC tests (`tauri::test::mock_builder`)
- No repository mocks — real functions, real queries

### Frontend Tests
```bash
npm test                    # vitest (jsdom — legacy non-visual tests)
npm run test:browser        # vitest browser mode (visual component tests)
npm run test:e2e           # playwright (E2E journeys)
```

- vitest-browser-svelte + Chromium (standard for new component tests, visual assertions)
- Vitest + jsdom (legacy, non-visual behavior tests only)
- Config in `vite.config.ts` (test block)
- Global mock in `src/test/setup.ts`
- Mock architecture: `invoke()` throws by default (Rule 9)

### setup.ts Pattern
```typescript
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn((cmd: string) => {
    throw new Error(`Unmocked invoke("${cmd}")`)
  }),
  convertFileSrc: vi.fn((path: string) => `asset://localhost${path}`),
}))

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(async () => {}),
  emit: vi.fn().mockResolvedValue(undefined),
  once: vi.fn().mockResolvedValue(undefined),
}))
```

### Test Data Conventions
- List components: always 2+ items
- Cross-project data: duplicate `id: 1`
- Timestamps: use fixed dates, not `Date.now()`
- File paths: use `/test/...` prefix, never real paths

### IPC Contract Tests (`ipc_tests.rs`)
```rust
fn make_app(home: PathBuf) -> tauri::App<tauri::test::MockRuntime> {
    mock_builder()
        .manage(AppState::new(home))
        .invoke_handler(tauri::generate_handler![...all commands...])
        .build(mock_context(noop_assets()))
        .unwrap()
}
```

Every IPC command used by the frontend must have:
1. A functional test (command works correctly)
2. A contract test (JSON shape matches TypeScript interface)

---

## Section 5: Visual Testing Methodology

Visibility has three levels — class present, CSS applied, pixels displayed —
and each hides a different class of bug. Rules 14, 17, and 18 explain the
progression. This section covers what remains: test tiering, decision guide,
cross-engine limits, and the manual verification checklist.

### Cross-Engine Rendering Gap

vitest-browser-svelte and Playwright tests run in Chromium. The production app
uses WebKitGTK (Linux) or WebKit (macOS). CSS edge cases behave differently
between engines. Chromium-based visual tests catch the majority of bugs
(missing `relative`, purged classes, broken reactivity, clipping), but
**pixel-exact rendering must be verified manually** in the real app each sprint.

### Test Tiering Strategy

As the test suite grows, running everything on every commit becomes impractical.
Tests are organized into tiers by cost and scope:

```
┌──────────────────────────────────────────────────────────────┐
│  Tier 1: Pre-commit                         Budget: < 60s   │
│  ─────────────────────────────────────────────────────────── │
│  cargo clippy --manifest-path src-tauri/Cargo.toml           │
│  npx vitest run --changed              (jsdom + browser mode) │
│  Total: ~15-40s depending on what changed                    │
├──────────────────────────────────────────────────────────────┤
│  Tier 2: Pre-push                           Budget: < 3 min  │
│  ─────────────────────────────────────────────────────────── │
│  cargo test --manifest-path src-tauri/Cargo.toml             │
│  npx vitest run                                (full suite)  │
│  npx playwright test                           (full E2E)    │
│  Total: ~60-90s at current size                              │
├──────────────────────────────────────────────────────────────┤
│  Tier 3: CI / Pre-sprint-done               Budget: < 10 min │
│  ─────────────────────────────────────────────────────────── │
│  Everything in Tier 2                                        │
│  + Visual regression screenshots (toHaveScreenshot)          │
│  + Manual verification in real app (cargo tauri dev)         │
│  + Cross-engine spot check (WebKitGTK vs Chromium)           │
└──────────────────────────────────────────────────────────────┘
```

**`vitest --changed`** is the key enabler for Tier 1. It uses git to detect which
source files changed since the last commit and runs only the tests that import those
files. This keeps pre-commit feedback fast even as the component test suite grows
to hundreds of tests.

**When to run which tier:**
- Tier 1: Every commit (automated via pre-commit hook or manual discipline)
- Tier 2: Before pushing to remote / before opening PR
- Tier 3: Sprint-done gate, dependency updates, weekly

vitest-browser-svelte tests run in Tier 1 (`--changed`) and Tier 2 (full suite).
This means component-level visual assertions run in pre-commit, catching CSS bugs
without waiting for the slower Playwright E2E tests in Tier 2.

### Decision Guide: Where Does This Visual Test Belong?

```
Is it a single component's rendering?
  YES → vitest-browser-svelte (Layer 3)
         boundingBox(), getComputedStyle(), color checks
         Runs in Tier 1 (--changed) — fast feedback

  NO → Is it a multi-step user journey or cross-component layout?
    YES → Playwright E2E (Layer 4)
           Full page assertions, navigation flows, timing
           Runs in Tier 2

    NO → Is it the real Tauri binary with real data?
      YES → Playwright Smoke Test (Layer 5)
             Real SQLite, real filesystem, real asset://
             Runs in Tier 3

Is it a runtime scope or permission assertion?
  (e.g., "Can the asset protocol actually serve this path?")
  YES → Rust integration test (Layer 2) — Rule 15
         Read real tauri.conf.json, call real backend function,
         validate returned paths against scope glob patterns.
         No mocks on either side of the seam.
         Runs in Tier 2 (cargo test)
```

### vitest-browser-svelte: Component-Level Visual Testing (Layer 3)

vitest-browser-svelte is the recommended approach for component-level visual testing.
It runs Svelte component tests in **real Chromium** instead of jsdom, giving component
tests full CSS layout, positioning, computed styles, and Tailwind compilation while
remaining fast (~50-100ms per test).

**Benefits:**
- Component tests verify `boundingBox()`, `getComputedStyle()`, opacity, colors
- Tests that previously required E2E (because jsdom cannot test CSS) run as
  fast component tests instead
- The `--changed` flag works — only modified component tests run in Tier 1
- Catches CSS positioning bugs (like BUG-08) at the component level in pre-commit

**Setup:**
```bash
npm install -D @vitest/browser vitest-browser-svelte
```

```typescript
// vite.config.ts — add browser project alongside existing jsdom project
test: {
  browser: {
    enabled: true,
    provider: 'playwright',
    instances: [{ browser: 'chromium' }],
  },
}
```

**Coexistence:** Both jsdom and browser projects can coexist. New tests with visual
assertions should use browser mode. Existing jsdom tests can be migrated incrementally.

**References:**
- [Svelte official testing docs](https://svelte.dev/docs/svelte/testing)
- [vitest-browser-svelte](https://github.com/vitest-community/vitest-browser-svelte)
- [Vitest Browser Mode](https://vitest.dev/guide/browser/component-testing)

### Manual Verification Checklist (per sprint)

Automated tests (both component-level and E2E) catch CSS positioning and computed
style bugs. The following must still be verified manually in the real app
(`cargo tauri dev`):

- [ ] Colors render correctly in WebKitGTK (not just Chromium)
- [ ] Animations/transitions are smooth (no jank)
- [ ] Visual indicators are visible at all viewport sizes used in practice
- [ ] Keyboard focus and selection indicators are clearly visible against photo backgrounds (including bright edge colors like sky/snow)

---

## Section 6: Pre-Sprint-Done Checklist (Tier 3)

This checklist corresponds to **Tier 3** — the full gate before a sprint is done.
See Section 5 for Tier 1 (pre-commit) and Tier 2 (pre-push) definitions.

```
### Rust Unit Tests
- [ ] All structs with impl Default that have non-zero defaults: explicit test
- [ ] All output-producing functions: read back the produced value and assert content
- [ ] Negative paths tested: missing files, corrupt input, empty collections

### Rust Integration Tests
- [ ] Full pipeline tested end-to-end with real (in-memory) SQLite
- [ ] Pipeline tested with 2+ values of each config parameter (results must differ)
- [ ] Idempotency: second run of pipeline produces imported=0
- [ ] Config read-modify-write: non-target fields preserved
- [ ] Timing thresholds: 3x measured time, measurement documented
- [ ] Runtime scope: all IPC commands returning paths have scope validation tests (Rule 15)

### IPC Contract Tests
- [ ] Every IPC command used by frontend has a JSON shape test in ipc_tests.rs
- [ ] Shape test verifies field names, types, and null/non-null patterns
- [ ] New commands added this sprint: contract test written BEFORE frontend mock

### Component Tests (Vitest)
- [ ] setup.ts default throws on unmocked commands (Rule 9)
- [ ] All list components tested with 2+ items, cross-project with duplicate IDs
- [ ] Stateful flows tested with 2+ round trips, different targets
- [ ] Call sequences verified (not just spot-checked)
- [ ] Error paths: at least 1 rejection test per component
- [ ] Component-level visual assertions use vitest-browser-svelte (boundingBox, computedStyle)

### E2E Tests (Playwright)
- [ ] 1+ new spec file covering this sprint's primary feature
- [ ] Timing assertions with 3x measured threshold
- [ ] Journey-level visual CSS assertions for cross-component indicators (Rule 14)

### Visual Verification
- [ ] Component-level visual tests pass (vitest-browser-svelte, boundingBox/computedStyle)
- [ ] Journey-level visual E2E tests pass (Playwright, full-page assertions)
- [ ] Manual check in real app (cargo tauri dev) — colors, positions, transitions
- [ ] Cross-engine spot check if CSS changes are non-trivial

### Smoke Test
- [ ] 1 Playwright test against real cargo tauri dev binary
- [ ] Tests the sprint's primary user journey end-to-end
- [ ] No mocked IPC — real SQLite, real filesystem, real asset://

### Overall (Tier 2 + 3 combined)
- [ ] cargo test passes (0 failures)
- [ ] cargo clippy -- -D warnings clean
- [ ] cargo fmt --check clean
- [ ] npm test passes (0 failures)
- [ ] npm run test:e2e passes
- [ ] Test tiering verified: `vitest --changed` works for Tier 1
```

---

## Section 7: Coverage Targets

Coverage targets are per-layer, not a single number. Different layers have
different cost-benefit curves — obsessing over 100% in the wrong layer wastes
effort, while under-testing critical paths lets bugs ship.

### Rust Backend

| Area | Target | Rationale |
|------|--------|-----------|
| Decision engine (keep/eliminate/undo/commit) | 95%+ | Core user workflow; state machine errors corrupt data |
| Import pipeline (scanner → EXIF → stacking → DB) | 90%+ | Multi-stage data flow; any gap produces silent data loss |
| Config persistence (read-modify-write, defaults) | 95%+ | BUG-01 and BUG-02 both came from here |
| Database migrations and schema | 90%+ | Irreversible in production; must be correct on first run |
| Thumbnail generation and fallback paths | 80%+ | Performance-sensitive; fallback chain must be tested |
| Slug generation and validation | 80%+ | Input sanitization at system boundary |
| Utility functions (formatting, helpers) | 60%+ | Low risk; test non-obvious edge cases only |

### Tauri IPC Contract

| Area | Target | Rationale |
|------|--------|-----------|
| JSON shape tests (every command) | 100% | The mock sandwich problem (Pattern D) — frontend mocks and backend responses must match |
| Error response shape | 100% | Frontend error handling depends on exact error format |
| New commands per sprint | 100% | Contract test written BEFORE frontend mock (Rule 10) |
| Asset scope validation (path-returning commands) | 100% | Runtime scope mismatch (Pattern F) — paths must be servable by asset protocol (Rule 15) |

Currently 21 of 29 commands have contract tests (72%). Remaining gaps are
commands requiring `AppHandle` (start_indexing, resume_thumbnails) and
source folder management commands. Each sprint should add contract tests
for any new commands introduced that sprint.

### Frontend Components

| Area | Target | Rationale |
|------|--------|-----------|
| Navigation and screen transitions | 90%+ | Core UX; untested transitions = broken app flow |
| Keyboard shortcuts and IPC dispatch | 85%+ | Primary interaction model; every key must do what docs say |
| Decision workflow (Y/X/commit/undo) | 90%+ | User's main task; errors here = lost culling work |
| Form validation and submission | 75%+ | User-facing; bad UX but not data loss |
| Error states and recovery | 70%+ | Defensive; prevents blank screens on API failures |
| Display formatting (dates, counts, truncation) | 60%+ | Visual polish; test non-obvious formatting only |
| Empty states | 50%+ | Low risk; test existence, not styling |

### Visual Assertions (vitest-browser-svelte / Playwright)

| Area | Target | Rationale |
|------|--------|-----------|
| Decision indicators (keep/eliminate badges, borders) | 100% | Most user-visible state; BUG-08 proved jsdom misses these |
| Focus rings and selection indicators | 100% | Must be visible to use keyboard navigation |
| Grid layout (4-column card grids) | 80%+ | Layout breaks are immediately obvious |
| Progress bars (width reflects actual progress) | 80%+ | Visual lie if bar width doesn't match percentage |
| Modal overlays (dimming, centering, z-stacking) | 60%+ | Important but less likely to regress |
| Color themes and hover states | 40%+ | Low risk; verify once, manual check after |

### E2E Journeys (Playwright)

| Area | Target | Rationale |
|------|--------|-----------|
| Critical user journeys per sprint | 3-5 specs | Rule 8: new feature = new E2E spec |
| Cross-screen navigation (Enter/Esc/Back flows) | 100% | The app is 4 screens; every transition must work |
| Decision persistence across navigation | 100% | Data integrity: decisions must survive screen changes |
| Import → thumbnail → grid flow | 1+ E2E | The first thing every new user does |

### Per-Screen Behavior Coverage

Tracked in `docs/test-coverage-matrix.md`. Targets for implemented behaviors:

| Screen | Current | Sprint 8 Target | Long-term Target |
|--------|---------|-----------------|------------------|
| ProjectList | 35% | 65% | 80% |
| StackOverview | 62% | 75% | 85% |
| StackFocus | 49% | 70% | 85% |
| SingleView | 73% | 80% | 90% |
| HelpOverlay | 38% | 60% | 75% |
| **Overall** | **52%** | **70%** | **85%** |

### What NOT to Chase

- 100% line coverage on any layer — diminishing returns past 85-90%
- Coverage on generated files, config files, or type definitions
- Testing Tailwind class names in jsdom — these are wrong-tech (Rule 14)
- Testing framework internals (Svelte reactivity, Tauri event bus wiring)
- Screenshot-diff tests — too brittle for a solo/small-team project; use
  `boundingBox()` and `getComputedStyle()` assertions instead

---

*This document is the single source of truth for testing in GemKeep.
`docs/testing-standards.md` and `docs/testing-gap-analysis.md` are superseded and should be deleted.*
