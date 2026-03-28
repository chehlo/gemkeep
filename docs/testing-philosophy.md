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

## Section 2: Sprint 3 Bug Retrospective

### BUG-01: Config::default() reset burst_gap_secs to 0

**What the bug was.**
`Config` implemented `Default` via a hand-written `impl Default`, but an earlier
version had used `#[derive(Default)]`. The `#[serde(default = "default_burst_gap")]`
attribute ensures correct values during JSON *deserialization*, but the `Default` trait
is a separate, independent Rust concept. Any code path that called `Config::default()`
directly received `burst_gap_secs = 0`. Because `open_project_inner` built its config
update using `..Config::default()` struct update syntax (BUG-02), every project open
or create wrote `burst_gap_secs = 0` to disk. With a gap of zero seconds, no two
photos can be within the gap, so every logical photo was assigned its own stack of
size 1. Burst grouping was silently disabled for every project.

**Tests that existed and why they missed it.**
`test_write_and_read_config_round_trip` verified that `last_opened_slug` survived a
write-read cycle. It did not assert the value of `burst_gap_secs`. The bug was
invisible because the test never checked the field that was wrong.

**What would have caught it.**
A single unit test added to `manager.rs`:

```rust
#[test]
fn test_config_default_burst_gap_is_3() {
    let config = Config::default();
    assert_eq!(
        config.burst_gap_secs, 3,
        "Config::default() must have burst_gap_secs=3, got {}",
        config.burst_gap_secs
    );
}
```

This test is now present in the codebase. It would have caught any future regression
in the `Default` implementation immediately.

**Layers involved:** Rust unit, pipeline integration.

---

### BUG-02: open_project clobbered burst_gap_secs in config

**What the bug was.**
`open_project_inner` (in `projects/manager.rs`) needed to update `last_opened_slug`
in the config and write it back. The original implementation constructed the updated
config using struct update syntax:

```rust
let updated = Config {
    last_opened_slug: Some(slug.to_string()),
    ..Config::default()         // BUG: fills all other fields with defaults
};
```

`..Config::default()` fills every unspecified field with the `Default` value. For
`burst_gap_secs` that meant 0 (before BUG-01 was fixed) or 3 (after). Either way,
the existing on-disk value of `burst_gap_secs` was discarded. Any user who had
configured a non-default burst gap would have it reset to 3 on the next project open.

**Tests that existed and why they missed it.**
No test verified that config fields other than `last_opened_slug` were preserved across
an `open_project` call. The test surface only covered the field being written, not the
fields being preserved.

**What would have caught it.**
A round-trip test that writes a non-default config, calls the slug-update operation,
re-reads, and asserts the non-default value survived:

```rust
#[test]
fn test_burst_gap_preserved_when_updating_slug() {
    let tmp = temp_home();
    let home = tmp.path();
    let initial = Config { last_opened_slug: None, burst_gap_secs: 5 };
    write_config(home, &initial).unwrap();
    // Simulate open_project: read existing, update slug, write back
    let mut config = read_config(home).unwrap_or_default();
    config.last_opened_slug = Some("my-project".to_string());
    write_config(home, &config).unwrap();
    let loaded = read_config(home).unwrap();
    assert_eq!(loaded.burst_gap_secs, 5, "burst_gap_secs must not be reset by slug update");
}
```

This test is now present in the codebase.

**Layers involved:** Rust integration.

---

### BUG-03: JPEG thumbnail orientation not applied

**What the bug was.**
Camera photos taken in portrait orientation are stored with EXIF orientation tag = 6
(90-degree rotation). `generate_thumbnail` must read this tag and apply the rotation
before writing the output thumbnail. The implementation read the orientation parameter
but did not apply the transformation. Portrait photos rendered as landscape in the
stack grid — visually obvious once you have real photos, completely invisible to tests
that only checked whether the output file existed.

**Tests that existed and why they missed it.**
The existing thumbnail tests verified:
- The function returns `Ok(())`
- The output file exists at the expected path
- The output file starts with JPEG magic bytes `FF D8`

None of these assertions required the output to have the correct dimensions or
orientation. A function that wrote a corrupt file or a sideways image would pass all
three checks.

**What would have caught it.**
A test using a landscape source image with orientation tag = 6, asserting that the
output has portrait dimensions (height > width):

```rust
#[test]
fn test_thumbnail_orientation_rotation_applied() {
    // synthetic landscape JPEG (w > h) with EXIF orientation=6 (90-degree CW)
    let src = create_synthetic_landscape_jpeg_with_orientation(6);
    let out_dir = tempfile::tempdir().unwrap();
    generate_thumbnail(&src, &PhotoFormat::Jpeg, 1, out_dir.path(), Some(6));
    let img = image::open(out_dir.path().join("1.jpg")).unwrap();
    assert!(
        img.height() > img.width(),
        "orientation=6 must rotate landscape to portrait, got {}x{}",
        img.width(), img.height()
    );
}
```

**Layers involved:** Rust unit.

---

### BUG-04: Scroll position restore works once, breaks on second navigation

**What the bug was.**
`StackOverview` restored scroll position via `requestAnimationFrame` (rAF). The rAF
callback was scheduled inside `loadAll()` while `initialLoading` was still `true`.
The stack cards are rendered inside an `{#if !initialLoading}` block. When the rAF
callback fired, the cards were not yet in the DOM, so `scrollIntoView` silently did
nothing. The first navigation appeared to work because the browser retained scroll
position from the previous render. The second navigation navigated to a different
card (changing the expected scroll target), and the restore reliably failed.

**Tests that existed and why they missed it.**
A single navigation unit test verified that after navigating to a stack and returning,
the previously focused card index was stored. It did not verify that `scrollIntoView`
was called at the right time relative to DOM availability, and it only performed one
round trip.

**What would have caught it.**
An E2E test (or a component test with a full Svelte lifecycle) performing two
complete round trips with different target positions:

```
1. Navigate to stack card 7 → press Escape → verify card 7 is scrolled into view
2. Navigate to stack card 12 → press Escape → verify card 12 is scrolled into view
```

The second step reliably triggers the timing bug because the expected scroll target
has changed.

**Layers involved:** Svelte component lifecycle, E2E.

---

### BUG-05: Stacking algorithm correct in unit tests but wrong in production

**What the bug was.**
`assign_stacks_by_burst` was correct. Its unit tests were thorough and all passed.
But the unit tests called the function with `burst_gap_secs = 3` hardcoded. Production
called the function with `burst_gap_secs = 0` (delivered by the broken config system,
BUG-01). With a gap of 0, no two photos can be within the burst gap — every logical
photo becomes its own stack of size 1. The algorithm was correct; the input was wrong;
and no test had ever threaded real config values through the full call chain.

This is the canonical example of Pattern A: isolated correctness, wrong runtime inputs.
The unit tests and the integration gap lived in parallel universes that never intersected.

**Tests that existed and why they missed it.**
- `test_stack_burst_3s` — hardcoded gap of 3
- `test_stack_gap` — hardcoded gap of 2
- `test_stack_configurable_gap` — called the function with a fixed value; the "config"
  in the test name referred to the parameter, not the real config system

None of these tests exercised the path: read config → extract burst_gap_secs → pass to
pipeline → pipeline calls assign_stacks_by_burst.

**What would have caught it.**
A pipeline integration test that runs the full pipeline with two different config values
and asserts that the output differs:

```rust
#[test]
fn test_pipeline_burst_gap_config_affects_stacks() {
    let (conn, project_dir) = setup_test_db();
    let folder = create_burst_photos_in_tmpdir(3); // 3 photos 1 second apart

    let stats_gap0 = run_pipeline(&conn, ..., burst_gap_secs: 0, ...);
    let stats_gap3 = run_pipeline_fresh(&conn, ..., burst_gap_secs: 3, ...);

    assert_eq!(stats_gap0.stacks_generated, 3, "gap=0: every photo is its own stack");
    assert_eq!(stats_gap3.stacks_generated, 1, "gap=3: all 3 photos in one stack");
}
```

An E2E complement: index a folder containing burst photos, assert that at least one
stack has `logical_photo_count > 1`.

**Layers involved:** Pipeline integration, E2E.

---

### BUG-06: SQLite deadlock on concurrent navigation (Sprint 2, caught late)

**What the bug was.**
`list_projects` held a long-running read lock on the SQLite connection while
`open_project` attempted a write. In WAL mode this produces a serialization delay
rather than a hard deadlock, but the delay reached 3,000–5,000 ms — long enough to
appear as a navigation freeze to the user.

The existing IPC timing test caught something, but its threshold was set at 1,000 ms.
The actual operation took approximately 50 ms under normal conditions. A threshold of
1,000 ms is 20x the measured time — large enough that the test passed while the real
freeze (5,000 ms) was happening in edge cases.

**Tests that existed and why they missed it.**
`test_ipc_open_then_list_no_freeze` used a 1,000 ms threshold. The intent was correct;
the threshold was not calibrated to the actual measurement.

**What would have caught it.**
Setting the threshold to 3x the measured time: if the operation takes 50 ms under
normal conditions, the threshold should be 150 ms. This would have caught the
deadlock-induced delay on the first occurrence.

Additionally, an E2E test that performs rapid project switches while polling
`list_projects` and asserts that each response arrives within 200 ms.

**Layers involved:** IPC integration, E2E.

---

### BUG-07: Duplicate key crash when listing 2+ projects (Sprint 2, caught late)

**What the bug was.**
`ProjectList` used `{#each projects as p (p.id)}`. Each project has its own SQLite
database, and SQLite `INTEGER PRIMARY KEY` auto-increment starts at 1 in every new
database. Two projects created in sequence both have `id = 1`. Svelte's keyed `#each`
block treats the key as a global identifier within the list, so two items with the
same key produce a duplicate key runtime error that crashes the component.

The fix was to use `project.slug` as the key, since slugs are unique across all
projects (they are the directory names).

**Tests that existed and why they missed it.**
`ProjectList.test.ts` mocked a list containing a single project. No test ever rendered
the component with two projects, so the duplicate key condition never arose in the
test environment.

**What would have caught it.**
A component test with two mock projects, both with `id: 1`:

```typescript
it('renders two projects with duplicate numeric ids without crashing', async () => {
    const projects = [
        { id: 1, name: 'Iceland 2024', slug: 'iceland-2024', ... },
        { id: 1, name: 'Wedding 2023', slug: 'wedding-2023', ... },
    ];
    render(ProjectList, { props: { projects } });
    expect(screen.getByText('Iceland 2024')).toBeInTheDocument();
    expect(screen.getByText('Wedding 2023')).toBeInTheDocument();
});
```

This test would have failed immediately with the `(p.id)` key and passed after the
fix to `(p.slug)`.

**Layers involved:** Svelte component, E2E.

---

## Section 3: The Testing Pyramid

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

## Section 4: Rules for Writing Tests

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
| `assertVisuallyKept()` etc. | `src/test/decision-visual-helpers.ts` | Style-agnostic visual assertions (Rule 17) |

**Before creating any new helper:** grep the `src/test/` directory and existing test files
for similar functionality. If a helper exists, use it. If it needs extension, extend it.

### Rule 17: Visual assertions must be style-agnostic

**Browser tests that check computed CSS must use semantic assertion helpers, not raw
`getComputedStyle` checks against specific CSS properties.** This enables future A/B
testing of visual styles without rewriting every test.

**Bad** — tightly coupled to one CSS implementation:
```ts
const bgColor = getComputedStyle(badge).backgroundColor
expect(bgColor).toBe('rgb(34, 197, 94)')
```

**Good** — style-agnostic, survives implementation changes:
```ts
import { assertVisuallyKept } from '$test/decision-visual-helpers'
assertVisuallyKept(cards[0])
```

**Infrastructure:**

| Helper | Location | Purpose |
|--------|----------|---------|
| `assertVisuallyKept(card)` | `src/test/decision-visual-helpers.ts` | Card has green indicator (border or background) |
| `assertVisuallyEliminated(card)` | `src/test/decision-visual-helpers.ts` | Card has red indicator (border or background) |
| `assertVisuallyDimmed(card)` | `src/test/decision-visual-helpers.ts` | Card is dimmed (overlay or opacity) |
| `assertVisuallyUndecided(card)` | `src/test/decision-visual-helpers.ts` | Card has no decision indicators |
| `assertNotDimmed(card)` | `src/test/decision-visual-helpers.ts` | Card has full opacity, no overlay |

**The pattern applies beyond decisions.** Any visual assertion that checks a
computed style (color, opacity, size, visibility) should go through a helper that
accepts multiple valid implementations. When a new visual style variant is added,
update the helper — not every test file.

**Why:** Commit `b3ed905` changed decision indicators from bg-filled badges to
border-frame overlays but only updated CSS selectors in tests, not the property
assertions. This left 3 browser tests permanently broken — caught months later.
Style-agnostic helpers prevent this class of bug entirely.

### Rule 18: Browser tests must assert computed styles, never class names

**In browser tests (`.browser.test.ts`), never use `className.contains()`,
`className.toMatch()`, or `className.includes()` to verify visual appearance.**
These assertions prove the code sets a CSS class — they do NOT prove the user sees
the intended result. A class can be present but visually invisible due to CSS
specificity, property conflicts, or one property hiding another.

**Always assert computed styles** (`getComputedStyle()`) or use the style-agnostic
helpers from Rule 17.

**Bad** — class name is present but visual result is broken:
```ts
// PASSES even when the blue ring is hidden behind a gray border
expect(frame.className).toContain('ring-blue-500')
```

**Good** — asserts what the user actually sees:
```ts
// FAILS when the border is gray, proving the blue indicator is not visible
const borderColor = getComputedStyle(frame).borderColor
expect(borderColor).toBe('rgb(59, 130, 246)')
```

**Also good** — style-agnostic helper (preferred, see Rule 17):
```ts
assertVisuallyFocused(frame)  // checks the right computed property
```

**Class-name assertions are fine in jsdom tests** (`.test.ts`) where you are
testing prop→class logic, not visual rendering. The rule applies only to browser
tests, whose entire purpose is to verify what the user sees.

**Why:** Commit `a7f0284` added `ring-2 ring-inset ring-blue-500` for focused
PhotoFrame cards. All browser tests passed — they checked `className.contains('ring-blue-500')`.
But `ring-inset` produces a `box-shadow` that is painted BEHIND the `border-2 border-gray-700`
on the same element. The blue ring was invisible. A `getComputedStyle().borderColor` assertion
would have caught it immediately: the border was gray, not blue.

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

**Examples:**
```
Category A:
BAD:  "shows green border" (jsdom, checks class)
GOOD: "keep status applies decision-keep class" (jsdom)
GOOD: "keep status shows green border" (browser, computedStyle)

Category B:
BAD:  "C key with 2 selected navigates to ComparisonView with selected photos"
      → only checks navigation.kind, never checks photoIds
GOOD: "C key with 2 selected navigates to ComparisonView with selected photos"
      → checks navigation.kind AND navigation.photoIds === [1, 3]

Category C:
BAD:  "Status bar shows stack name and round number"
      → only checks "Round 1", never checks stack name
GOOD: checks BOTH "Stack" AND "Round 1" in status bar text

Category D:
BAD:  "C key with 1-photo stack shows error"
      → only checks navigation stays, no error element assertion
GOOD: checks navigation stays AND error testid exists
```

**Enforced by:** `validateTestEnvironmentTask` in both behavioral-tdd and
sprint-development processes. Checks all 4 categories at the RED review breakpoint.

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

**The pattern: define an invariant, assert it after every mutation.**

An invariant is a property that must hold at ALL times, regardless of what operations
were performed. It doesn't test a specific operation — it tests the contract between
the system and the user.

```rust
// The invariant: photos visible through the round == photos in the stack
fn assert_round_photo_invariant(conn: &Connection, project_id: i64) {
    for (stack_id, lp_count) in get_all_stacks(conn, project_id) {
        let round_id = get_round_id_for_stack(conn, project_id, stack_id);
        let round_photos = query_logical_photos_by_round(conn, round_id);
        assert_eq!(round_photos.len(), lp_count,
            "INVARIANT: stack {} has {} photos but round shows {}",
            stack_id, lp_count, round_photos.len());
    }
}

#[test]
fn test_invariant_survives_full_lifecycle() {
    // Setup
    init_stacks();
    assert_round_photo_invariant(conn, project_id);  // after import

    merge_stacks(conn, ...);
    assert_round_photo_invariant(conn, project_id);  // after merge

    undo_last_merge(conn, ...);
    assert_round_photo_invariant(conn, project_id);  // after undo

    restack(conn, ...);
    assert_round_photo_invariant(conn, project_id);  // after restack
}
```

**Key properties of a good invariant test:**
1. **The invariant is a user-visible contract** — not an implementation detail.
   "I see the photos in my stack" — not "round_photos table has N rows."
2. **Assert after EVERY mutation** — not just at the end. The first failure
   pinpoints which operation broke the invariant.
3. **Exercise the realistic sequence** — import → decisions → merge → undo →
   restack → more decisions. This is what users do.
4. **The test doesn't know about specific bugs** — it catches ANY bug that
   violates the invariant, including bugs that don't exist yet.

**Invariants to consider for new features:**
- Navigation: after any sequence of screen transitions, `back()` returns to
  the correct parent screen
- Decisions: `current_status` derived from decisions log matches what the UI shows
- Stacks: every logical_photo belongs to exactly one active stack
- Thumbnails: every displayed photo has a loadable thumbnail path
- Data integrity: no orphaned foreign keys after any operation sequence

**When to write lifecycle invariant tests:**
- When a feature touches data that persists across operations (DB state, file system)
- When multiple code paths modify the same data (import creates stacks, merge creates
  stacks, restack creates stacks — all must maintain the same invariant)
- When undo/redo is involved — the forward and reverse paths must both preserve invariants
- After discovering a bug that single-operation tests missed

---

## Section 5: Test Infrastructure

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

## Section 6: Thumbnail Performance Analysis

### Current Approach and Why It Is Too Slow

Sprint 3's thumbnail pipeline (Step 5 in `pipeline.rs`) calls `image::open()` on each
JPEG representative photo. `image::open()` performs a full decode of the entire image.

**Benchmark data (measured 2026-02-21, AMD Ryzen 5 5625U):**

| Metric | Value |
|--------|-------|
| Test folder | `/home/ilya/ssd_disk/photo/venice 2026/il/2` |
| Files | 1,935 (968 CR2 + 967 JPG) |
| Logical photos | 968 (one per RAW+JPEG pair) |
| JPEG dimensions | 6000 x 4000 (24 MP) |
| JPEG file size | ~6.1 MB per file |
| Uncompressed RAM per decode | ~72 MB (6000 x 4000 x 3 bytes) |
| Python Pillow / native libjpeg: decode | 1.21 s |
| Python Pillow / native libjpeg: resize | 0.15 s |
| **Python Pillow total per photo** | **1.36 s** |
| Rust `image` crate (pure Rust jpeg-decoder) | estimated 2.7–4 s per photo |
| rayon threads available | 10 (12 cores - 2) |
| **Estimated total (Rust, 10 threads)** | **5–8 minutes for 968 photos** |

Five to eight minutes to generate thumbnails for a single 968-photo session is
unacceptable. A photographer processing a 5,000-photo shoot would wait 25–40 minutes
before seeing any thumbnails.

### Root Cause

The `image` crate's `image::open()` decodes the full 24 MP image into a 72 MB
uncompressed buffer before any resizing occurs. Generating a 256 px thumbnail
requires decoding 24,000,000 pixels to produce 65,536 pixels — a 366x waste ratio.
The `image` crate's pure-Rust JPEG decoder is also 2–3x slower than native libjpeg.

### Correct Approach (ordered by speed)

**Option 1: EXIF embedded thumbnail (fastest — use this first)**

Every camera JPEG contains an embedded preview image stored in the EXIF APP1 marker
segment. Canon CR2 files shot in RAW+JPEG mode pair with JPEGs that contain this
preview. The embedded thumbnail is typically 160x120 or 320x213, stored as a JPEG
within the EXIF data (~10–30 KB). Extracting and upscaling this thumbnail requires
reading only the first 60–150 KB of the file rather than the full 6 MB.

Estimated time per photo: 0.01–0.05 s
Estimated total for 968 photos (10 threads): **3–15 seconds** (30–50x speedup)

Library: `kamadak-exif` can locate the embedded thumbnail; alternatively parse the
EXIF APP1 marker directly using `nom` or a purpose-built parser.

**Option 2: libjpeg DCT scaling (fast fallback)**

libjpeg supports scale-at-decode: `--scale 1/8` produces a 750x500 output from a
6000x4000 source with 64x less work than full decode. Available via the `jpeg-decoder`
crate with the `platform_independent = false` feature (uses native libjpeg) or the
`mozjpeg` crate.

Estimated time per photo: 0.05–0.1 s (still 10–20x faster than current approach)

**Option 3: Full decode (current — use only if embedded thumbnail absent)**

The current `image::open()` approach is correct as a last resort. It should only
be reached when the file has no embedded thumbnail and DCT scaling is unavailable.

---

## Section 7: BUG-08 — StackFocus badge escapes card (Sprint 7)

**What the bug was.**
Decision badges (`.badge-keep`, `.badge-eliminate`) in StackFocus used
`absolute top-1 right-1` positioning, but the parent card div had no
`position: relative`. The badges floated to the nearest positioned ancestor
(the page body), rendering at `y=4` while the card was at `y=73`.

**Tests that existed and why they missed it.**
Vitest/jsdom component tests verified `document.querySelector('.badge-keep')` existed
after pressing Y. jsdom has no layout engine — it cannot compute bounding boxes or
detect that an absolutely-positioned element escaped its intended container.

**What caught it.**
A Playwright E2E test using `boundingBox()` comparison:
```typescript
const cardBox = await firstCard.boundingBox()
const badgeBox = await badge.boundingBox()
expect(badgeBox!.y).toBeGreaterThanOrEqual(cardBox!.y) // FAILED: 4 < 73
```

**Fix:** Add `relative` to the card div's class list.

**Layers involved:** Playwright E2E (Layer 4, visual CSS assertions).
Note: with vitest-browser-svelte (Layer 3), this class of bug can now be caught
at the component level, which is faster and more targeted.
This bug established Rule 14 and Section 8 of this document.

---

## Section 8: Visual Testing Methodology

### The Problem jsdom Cannot Solve

jsdom has no layout engine. It parses HTML and builds a DOM tree, but it does not
compute CSS layout, resolve `position: absolute` containment, apply `opacity`
transitions, or compile Tailwind utility classes into actual pixel values.

A jsdom test can verify that `element.classList.contains('border-green-500')` is true.
It cannot verify that the border is visible, correctly positioned, or the right color.
The following bugs are **invisible to jsdom**:

| Bug | jsdom sees | Real Chromium sees (vitest-browser-svelte / Playwright) |
|-----|------------|----------------------------------------------------------|
| `absolute` badge escapes card (no `relative` on parent) | Class present, element exists | `boundingBox()` outside card bounds |
| Tailwind class purged from build (not in content scan) | Class present in source | `getComputedStyle().borderColor` = transparent |
| `opacity-50` not reactively applied after state change | Class added to DOM | `getComputedStyle().opacity` = 1.0 (stale) |
| `z-index` stacking hides badge behind sibling | Element exists | `isVisible()` returns false |

### Visual Assertions with Real Chromium

Both vitest-browser-svelte (Layer 3) and Playwright (Layer 4) run real Chromium
with full CSS layout, Tailwind compilation, and computed styles. The assertion
patterns are similar but use different APIs. Use vitest-browser-svelte for
component-scoped tests; use Playwright for journey-level tests.

**Bounding box containment** — verify positioned elements stay within their parent:
```typescript
// vitest-browser-svelte (Layer 3 — component-scoped)
const card = screen.getByTestId('photo-card')
const badge = card.getByRole('status')  // or appropriate selector
const cardBox = await card.element().getBoundingClientRect()
const badgeBox = await badge.element().getBoundingClientRect()
expect(badgeBox.y).toBeGreaterThanOrEqual(cardBox.y)

// Playwright (Layer 4 — journey-level)
const card = page.locator('[data-testid="photo-card"]').first()
const badge = card.locator('.badge-keep')
const cardBox = await card.boundingBox()
const badgeBox = await badge.boundingBox()
expect(badgeBox!.y).toBeGreaterThanOrEqual(cardBox!.y)
expect(badgeBox!.x + badgeBox!.width).toBeLessThanOrEqual(cardBox!.x + cardBox!.width)
```

**Computed style verification** — verify CSS values after Tailwind compilation:
```typescript
// vitest-browser-svelte (Layer 3)
const el = screen.getByTestId('photo-card')
const opacity = getComputedStyle(el.element()).opacity
expect(parseFloat(opacity)).toBeCloseTo(0.5, 1)

// Playwright (Layer 4)
const opacity = await page.evaluate(() => {
  const el = document.querySelector('[data-testid="photo-card"]')
  return getComputedStyle(el!).opacity
})
expect(parseFloat(opacity)).toBeCloseTo(0.5, 1)
```

**Color verification** — verify Tailwind colors are compiled and applied:
```typescript
// vitest-browser-svelte (Layer 3)
const badge = screen.getByRole('status')
const bgColor = getComputedStyle(badge.element()).backgroundColor
expect(bgColor).toBe('rgb(34, 197, 94)') // Tailwind bg-green-500

// Playwright (Layer 4)
const bgColor = await page.evaluate(() => {
  const badge = document.querySelector('.badge-keep')
  return getComputedStyle(badge!).backgroundColor
})
expect(bgColor).toBe('rgb(34, 197, 94)') // Tailwind bg-green-500
```

### Cross-Engine Rendering Gap

Both vitest-browser-svelte and Playwright tests run in Chromium. The production app
uses WebKitGTK (Linux) or WebKit (macOS). CSS edge cases can behave differently
between engines. Chromium-based visual tests catch the majority of bugs (missing
`relative`, purged classes, broken reactivity), but **pixel-exact rendering must be
verified manually** in the real app for each sprint.

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
- [ ] Keyboard focus indicators (blue ring) are clearly visible against photo backgrounds

---

## Section 9: Pre-Sprint-Done Checklist (Tier 3)

This checklist corresponds to **Tier 3** — the full gate before a sprint is done.
See Section 8 for Tier 1 (pre-commit) and Tier 2 (pre-push) definitions.

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

## Section 10: Coverage Targets

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
