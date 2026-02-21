# GemKeep Testing Philosophy

> Written 2026-02-21 as a retrospective on Sprint 3 bugs.
> Every rule in this document was earned by a real bug escaping to production.

---

## Section 1: The Core Problem — Unit Tests Pass but Systems Break

A passing test suite is not a clean bill of health. It is a record of the things we
thought to test. The things we did not think to test are the things that break.

In a layered system — Rust backend, SQLite database, Tauri IPC, Svelte frontend — every
layer can be correct in isolation while the composition is wrong. Unit tests verify
components against mocked or fixed inputs. Integration gaps are the seams between
components where real values flow through, and where assumptions made in one layer
collide with reality delivered by another.

Three integration gap patterns account for most escaped bugs:

**Pattern A: Isolated correctness, wrong runtime inputs.**
The algorithm is correct. The unit tests prove it — but the tests hardcode the config
values that are supposed to come from the real config system. In production, the config
system delivers different (often broken) values. The correct algorithm receives broken
input and produces broken output. No test ever ran the two together.

**Pattern B: Side-effect clobbering.**
A function reads a record, modifies one field, and writes it back. Unit tests verify
that the target field is correct after the write. No test checks that the OTHER fields
survived. A bug in the struct-update expression silently zeros the untested fields on
every call.

**Pattern C: Behavioral regression on the second invocation.**
A UI flow works correctly the first time. A timing dependency, a DOM lifecycle
assumption, or an initialization flag behaves differently on the second invocation.
Tests written to cover a scenario test it once and declare success.

Sprint 3 produced seven bugs. All seven fit one of these three patterns. None were
visible to existing unit tests. The unit tests were not wrong — they were simply not
testing the right things.

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

## Section 3: The Testing Pyramid for GemKeep

Four layers. Each layer has a specific scope, a specific anti-pattern to avoid, and
specific properties that must be verified.

```
                    ┌──────────────────┐
                    │   Layer 4: E2E   │  3-5 journeys per sprint
                    │   (Playwright)   │  Real app, real timing
                    ├──────────────────┤
                    │  Layer 3: Comp.  │  Varied data, multi-step
                    │  (Vitest/jsdom)  │  flows, duplicate IDs
                    ├──────────────────┤
                    │  Layer 2: Rust   │  Full pipeline, real config
                    │  Integration     │  flow, idempotency, locks
                    ├──────────────────┤
                    │  Layer 1: Rust   │  Pure functions, actual
                    │  Unit Tests      │  output values, Default impls
                    └──────────────────┘
```

### Layer 1: Rust Unit Tests

**Scope:** Pure functions, algorithms, data transformations. Scanner, EXIF extraction,
pair detection, stack assignment, thumbnail generation, config read/write.

**Must test: actual output values.**
Do not stop at `assert!(result.is_ok())`. Read back the produced file or value and
assert its content. If a function generates a thumbnail, open the thumbnail with
`image::open()` and assert the dimensions. If a function parses EXIF, assert the
extracted `capture_time` value against a known fixture.

**Must test: Default trait implementations.**
Any struct with `#[derive(Default)]` or `impl Default` where the default value is not
the zero-value of the type requires an explicit test:

```rust
assert_eq!(Config::default().burst_gap_secs, 3);
```

The reason: `#[serde(default = "fn")]` and `impl Default` are independent. A struct
can have correct serde deserialization defaults and wrong Rust defaults simultaneously.
Tests that only exercise the JSON path miss the Rust path.

**Anti-pattern: existence-only assertions.**
```rust
// BAD — proves nothing about correctness
assert!(thumbnail_path.exists());
assert!(result.is_some());
assert!(extract_exif(&path).is_ok());

// GOOD — verifies the produced value
let img = image::open(&thumbnail_path).unwrap();
assert_eq!(img.width(), 256);
assert_eq!(img.height(), 256);

let exif = extract_exif(&path).unwrap();
assert_eq!(exif.orientation, Some(6));
assert_eq!(exif.capture_time.unwrap().timestamp(), known_unix_ts);
```

**Coverage target:** 90%+ of business logic.

---

### Layer 2: Rust Integration Tests

**Scope:** Full pipeline end-to-end. Scan → EXIF → pair detection → stack assignment
→ DB write → DB query. Also: concurrent access, config round-trips, idempotency.

**Must test: config values flow through the full pipeline.**
Run the pipeline with at least two different values of each configurable parameter and
assert that the results differ. This is the direct lesson of BUG-05.

```rust
// Gap of 0: burst grouping disabled
let stats_a = run_pipeline(..., burst_gap_secs: 0, ...);
assert_eq!(stats_a.stacks_generated, n_photos);

// Gap of 3: burst grouping enabled
let stats_b = run_pipeline_fresh(..., burst_gap_secs: 3, ...);
assert!(stats_b.stacks_generated < n_photos);
```

**Must test: idempotency.**
Run the pipeline twice on the same folder. Assert that the second run reports
`imported = 0`, `skipped_existing = N`, and the stack count is unchanged.

**Must test: SQLite concurrent access with tight thresholds.**
If a test is intended to prove the system does not deadlock or freeze, the timing
threshold must be tight. Measure the actual operation time first; set the threshold
to 3x that measurement. Document the measurement alongside the test.

**Must test: config preserved across operations.**
Any function that reads config, modifies one field, and writes it back must have a
test that writes a non-default value to another field, calls the function, re-reads
the config, and asserts the non-default value was not overwritten.

**Anti-pattern: pipeline tests with all values hardcoded.**
A pipeline test that calls `run_pipeline(..., burst_gap_secs: 3, ...)` every time
cannot detect bugs where the real code always uses 0 regardless of what the config
says. The parameter must vary.

---

### Layer 3: Component Tests (Vitest + jsdom)

**Scope:** Svelte component behavior with varied props and state. StackOverview state
machine transitions, ProjectList rendering, navigation store behavior, keyboard handling.

**Must test: realistic data with duplicate IDs.**
Mock data must reflect the real database structure. Two mock projects should both have
`id: 1` because that is what the real system produces. If a component crashes on
duplicate numeric IDs, this test catches it immediately.

```typescript
const twoProjects = [
    { id: 1, name: 'Iceland', slug: 'iceland-2024' },
    { id: 1, name: 'Wedding', slug: 'wedding-2023' },
];
```

**Must test: multi-step flows at least twice.**
For any UI flow that persists and restores state (scroll position, focused card index,
form values), test the round trip at least twice with a different target position on
the second trip. The first trip may succeed by coincidence (retained DOM state). The
second trip proves the restore mechanism works actively.

**Must test: DOM API mocking.**
`scrollIntoView`, `requestAnimationFrame`, `IntersectionObserver`, and similar browser
APIs must be mocked in `src/test/setup.ts`. Tests that rely on these APIs without mocks
produce false positives: the function is called but silently does nothing.

**Anti-pattern: single-item mock data.**
A component test that renders a list with one item cannot detect key collision bugs,
cannot test list navigation, and gives false confidence about any behavior that is
only observable with multiple items.

**Anti-pattern: testing only first navigation.**
```typescript
// BAD — only proves the happy path once
await navigateToStack(7);
await pressEscape();
expect(getScrollTarget()).toBe(7);

// GOOD — proves the mechanism, not just the first execution
await navigateToStack(7);
await pressEscape();
expect(getScrollTarget()).toBe(7);   // first round trip
await navigateToStack(12);
await pressEscape();
expect(getScrollTarget()).toBe(12);  // second round trip — different target
```

---

### Layer 4: E2E Tests (Playwright against cargo tauri dev)

**Scope:** Complete user journeys through the real application. Real Tauri binary, real
SQLite, real file system (or IPC mocked via `addInitScript` when the real binary is
not available in CI).

**Required for: any bug that requires multiple layers to reproduce.**
BUG-05 required a broken config (Layer 1) to produce wrong pipeline input (Layer 2)
to produce wrong DB output (Layer 2) to produce wrong UI display (Layer 3). No single
layer's tests could catch it. Only a test that ran all four layers together would have.

**Required for: timing assertions.**
Timing bugs (BUG-06) are invisible to unit and component tests. They require the real
IPC stack under realistic concurrency. E2E tests are the only automated layer where
timing assertions are meaningful.

**Required for: visual DOM-dependent outcomes.**
Scroll position restoration (BUG-04) depends on cards being in the DOM when
`scrollIntoView` is called. jsdom does not implement layout. Only a real browser
(Chromium via Playwright) can verify scroll position.

**Minimum: 3-5 critical paths per sprint.**
Sprint 3 required at minimum:
- Journey: open project with burst photos → index → verify at least one stack has count > 1
- Journey: navigate to stack card → Escape → navigate to different card → Escape → verify position restored
- Journey: open two projects in sequence → verify no navigation freeze > 200 ms

**Timing threshold rule:** Threshold = 3x actual measured time.
Document the measurement. A threshold of 1,000 ms when the operation takes 50 ms is
not a timing assertion — it is a crash detection test. Real timing assertions are
tight enough to catch degradation before it becomes user-visible.

---

## Section 4: Eight Rules for Future Milestones

### Rule 1: Test the actual output, not the return type

The return type tells you the function completed. The output value tells you it
completed correctly. Always read back the produced artifact.

```rust
// BAD
assert!(generate_thumbnail(&src, &format, 1, &dir, None).is_ok());

// GOOD
generate_thumbnail(&src, &format, 1, &dir, None).unwrap();
let img = image::open(dir.join("1.jpg")).expect("thumbnail must exist");
assert!(img.width() <= 256 && img.height() <= 256, "thumbnail must fit in 256x256");
assert!(img.width() == 256 || img.height() == 256, "thumbnail must fill one dimension");
```

Applies to: thumbnail generation, EXIF extraction, DB writes (re-query and assert),
config writes (re-read and assert), any function that produces a file or record.

---

### Rule 2: Test Default implementations explicitly

Every struct with `#[derive(Default)]` or `impl Default` where any field has a
non-zero or non-empty intended default value must have a dedicated test:

```rust
// After writing or modifying any struct Default:
#[test]
fn test_config_default_values() {
    let c = Config::default();
    assert_eq!(c.burst_gap_secs, 3);          // not 0
    assert!(c.last_opened_slug.is_none());    // obvious, but explicit
}
```

The test name should follow the pattern `test_<struct>_default_<field>_is_<value>`.
Place it immediately after the `impl Default` block or the `#[derive(Default)]`
annotation. This makes regression immediately visible when the implementation changes.

---

### Rule 3: Test config survival across operations

Any function that reads a config, modifies one or more fields, and writes it back
must have a test structured as:

1. Write config with a non-default value for a field the function does NOT modify.
2. Call the function.
3. Re-read the config.
4. Assert the non-default value is unchanged.

This is the specific pattern that catches BUG-02 and any future variant of it.

```rust
// template
let initial = Config { last_opened_slug: None, burst_gap_secs: 99 };
write_config(&home, &initial).unwrap();
update_slug(&home, "some-project").unwrap();   // the function under test
let loaded = read_config(&home).unwrap();
assert_eq!(loaded.burst_gap_secs, 99, "field must survive operation");
```

---

### Rule 4: Use realistic mock data with duplicates

Mock data must reflect the real system's data generation rules.

SQLite `INTEGER PRIMARY KEY` starts at 1 in every new database. Two projects will both
have rows with `id = 1`. Any component that uses numeric IDs as rendering keys will
crash with two projects.

Mock data rule: when testing any list component, include at least 2 items. For
cross-project data (projects list, project selector), both items must have `id: 1`.

```typescript
// BAD — single item gives false confidence
const mockProjects = [{ id: 1, slug: 'iceland', name: 'Iceland 2024' }];

// GOOD — two items, duplicate IDs, distinct slugs
const mockProjects = [
    { id: 1, slug: 'iceland-2024', name: 'Iceland 2024' },
    { id: 1, slug: 'wedding-2023', name: 'Wedding 2023' },
];
```

---

### Rule 5: Test the second navigation, not just the first

For any UI flow that saves and restores position (scroll, focus, form field, tab):
test the full round-trip at least twice. The second test must use a different target
than the first, so that success requires active restoration rather than passive
retention of existing DOM state.

```typescript
// Navigate to position A, return, verify A restored.
// Navigate to position B (different from A), return, verify B restored.
// If only the first half passes, the restore mechanism is broken.
```

This rule directly targets BUG-04. Any timing bug in the restore mechanism will
manifest on the second navigation because the expected target has changed.

---

### Rule 6: Pipeline tests must vary config values

Every pipeline integration test must call the pipeline with at least two different
values of each config parameter and assert that the results differ.

```rust
// Vary burst_gap_secs — results must differ
let result_gap0 = run_pipeline_with_gap(0, &photos);
let result_gap5 = run_pipeline_with_gap(5, &photos);
assert!(result_gap5.stacks_generated < result_gap0.stacks_generated,
    "larger gap must produce fewer stacks");
```

A pipeline test that hardcodes one set of config values cannot detect bugs where the
pipeline ignores config entirely and uses a hardcoded internal value. The parameter
must produce observably different behavior.

---

### Rule 7: Performance assertions must be binding

A timing assertion with a threshold of 10x or 20x the measured operation time is not
a performance test — it is a hang detection test. It will not catch meaningful
regressions.

Threshold formula: `threshold_ms = measured_ms * 3`

Document the measurement alongside the assertion:

```rust
// Measured 2026-02-21 on AMD Ryzen 5 5625U: open_project takes ~50ms
// Threshold: 150ms (3x). If this fails, investigate concurrency or lock contention.
let start = Instant::now();
open_project(&state, "test-project").await.unwrap();
assert!(start.elapsed().as_millis() < 150, "open_project must complete within 150ms");
```

If the measured time changes (hardware, refactor), update both the comment and the
threshold together. Never increase the threshold without re-measuring.

---

### Rule 8: New feature = new E2E spec

Each sprint must add at least one Playwright test file covering its primary
user-facing feature. The E2E spec must exercise the complete user journey, not just
individual component states.

Sprint 3 primary feature: photo import and stack grid display.
Required E2E: `tests/e2e/import-flow.spec.ts` — open project, add folder, index,
verify stacks appear, navigate with keyboard.

The E2E spec is part of the Definition of Done. A sprint is not complete if the
primary feature has no E2E coverage.

---

## Section 5: Thumbnail Performance Analysis

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

### Sprint 4 Mandatory Item

Before the thumbnail pipeline sprint (Sprint 4), implement EXIF embedded thumbnail
extraction for JPEG files in `import/thumbnails.rs`. The extraction should:

1. Open the JPEG file and scan for the EXIF APP1 marker.
2. Locate the embedded thumbnail JPEG within the EXIF IFD1 block.
3. Decode the embedded thumbnail (it is a full JPEG, so any JPEG decoder works).
4. If the embedded thumbnail is too small (< 128px on the short side), fall back to
   Option 2 (DCT scaling) or Option 3 (full decode).
5. Apply EXIF orientation before writing the output.

The pipeline signature in `pipeline.rs` already passes `orientation` to
`generate_thumbnail`, so the orientation-application pathway is in place.

---

## Section 6: Sprint Checklist — Pre-Done Testing Verification

This checklist must be reviewed and checked before marking any sprint as done.
If any item is unchecked, the sprint is not done.

```
## Pre-Sprint-Done Testing Checklist

### Rust Unit Tests
- [ ] All structs with `#[derive(Default)]` or `impl Default` that have non-zero
      intended defaults have an explicit test asserting the expected default value.
      Test name pattern: test_<struct>_default_<field>_is_<value>
- [ ] All output-producing functions (thumbnail generation, EXIF extraction, config
      write, DB insert) have tests that READ BACK the produced value and assert its
      content. No assertion stops at `assert!(result.is_ok())` alone.
- [ ] Negative paths tested: missing files, corrupt input, empty collections,
      zero counts, permission errors.

### Rust Integration Tests
- [ ] Full pipeline tested end-to-end: scan → EXIF → pair → stack → DB → query.
      The test uses a real (in-memory or tmpdir) SQLite database, not mocked repos.
- [ ] Pipeline tested with at least 2 different values of each config parameter.
      Results must differ when parameter differs. This catches "always uses hardcoded
      value" bugs.
- [ ] Re-index tested for idempotency: second run produces imported=0,
      skipped_existing=N, same stack count.
- [ ] All functions that read-modify-write config have a "non-target field preserved"
      test: write non-default value → call function → re-read → assert value unchanged.
- [ ] Any timing assertion has the actual measured time documented in a comment.
      Threshold set to 3x measured time, not 10x.

### Component Tests (Vitest)
- [ ] All list components tested with 2+ items. For cross-project lists, items have
      duplicate numeric IDs (both id: 1) to catch key-collision bugs.
- [ ] All stateful UI flows (scroll restore, focus restore, form state) tested with
      at least 2 complete round trips using different target positions.
- [ ] scrollIntoView, requestAnimationFrame, IntersectionObserver mocked in
      src/test/setup.ts. Tests that rely on these APIs without mocks are false positives.

### E2E Tests (Playwright)
- [ ] At least 1 new Playwright spec file added covering this sprint's primary
      user-facing feature.
- [ ] Navigation operations have timing assertions (threshold = 3x measured).
- [ ] Critical journeys verified end-to-end with the real app or a realistic IPC mock
      injected via addInitScript (not a stub that always returns the happy path).

### Threshold Check
- [ ] Every timing assertion in the codebase has a comment with the actual measured
      time and the derivation of the threshold (e.g., "measured 50ms, threshold 150ms").
      No threshold is more than 3x the measured time.
```

---

*Retrospective compiled 2026-02-21. All seven bugs documented here escaped to production
despite passing unit test suites. The rules in Section 4 and the checklist in Section 6
are the direct remediation of each escape.*
