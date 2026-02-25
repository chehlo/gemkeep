# GemKeep Testing Methodology

> Single source of truth for how tests are written in this project.
> Every rule was earned by a real bug escaping to the running app.
> Replaces: testing-philosophy.md (Sprint 3 retrospective) + testing-standards.md (aspirational).

---

## Section 1: The Core Problem — Why Tests Pass but the App Breaks

A passing test suite is not a clean bill of health. It is a record of the things we
thought to test. The things we did not think to test are the things that break.

In a layered system — Rust backend, SQLite database, Tauri IPC, Svelte frontend — every
layer can be correct in isolation while the composition is wrong. Four integration gap
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

Sprint 3-6 produced multiple bugs fitting these patterns. None were visible to existing
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
                    │  (Vitest/jsdom)  │  flows, strict mock hygiene
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

**Scope:** Full pipeline end-to-end, IPC command dispatch, contract tests.
**Tools:** `cargo test`, Tauri mock runtime (`tauri::test`), real SQLite (in-memory).
**Must test:** Config flow through pipeline (Rule 6), idempotency (Rule 11),
IPC JSON shape (Rule 10), timing with tight thresholds (Rule 7).

### Layer 3: Component Tests (Vitest + jsdom)

**Scope:** Svelte component behavior with varied props and state.
**Tools:** Vitest 3, @testing-library/svelte, jsdom.
**Must test:** Realistic mock data (Rule 4), second navigation (Rule 5),
strict mock hygiene (Rule 9).

### Layer 4: E2E Tests (Playwright, mocked IPC)

**Scope:** Complete user journeys. Real Chromium rendering, mocked IPC.
**Tools:** Playwright, `page.addInitScript()` for IPC mocking.
**Must test:** Critical state machine transitions, timing assertions (Rule 7),
new feature journeys (Rule 8).

### Layer 5: Smoke Test (Playwright, real binary)

**Scope:** One test per sprint that runs against the REAL `cargo tauri dev` binary.
No mocked IPC. Real SQLite, real filesystem, real asset:// protocol.
**Tools:** Playwright, cargo tauri dev via webServer config.
**Must test:** The primary user journey of the sprint, end-to-end with real data.

---

## Section 4: Twelve Rules for Writing Tests

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
npm test                    # vitest (jsdom)
npm run test:e2e           # playwright
```

- Vitest 3 + @testing-library/svelte + jsdom
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

## Section 7: Pre-Sprint-Done Checklist

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

### E2E Tests (Playwright)
- [ ] 1+ new spec file covering this sprint's primary feature
- [ ] Timing assertions with 3x measured threshold

### Smoke Test
- [ ] 1 Playwright test against real cargo tauri dev binary
- [ ] Tests the sprint's primary user journey end-to-end
- [ ] No mocked IPC — real SQLite, real filesystem, real asset://

### Overall
- [ ] cargo test passes (0 failures)
- [ ] cargo clippy -- -D warnings clean
- [ ] cargo fmt --check clean
- [ ] npm test passes (0 failures)
- [ ] npm run test:e2e passes
```

---

*This document is the single source of truth for testing in GemKeep.
`docs/testing-standards.md` and `docs/testing-gap-analysis.md` are superseded and should be deleted.*
