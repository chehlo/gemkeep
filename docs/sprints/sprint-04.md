# Sprint 4 — Thumbnail Quality, DB Migration Squash, Progressive Loading

> Backend correctness != usable product.
> Sprint 4 is small and surgical: improve what Sprint 3 shipped without rearchitecting it.

---

## Goal

After Sprint 4, a user can:

1. Open a project that was indexed in Sprint 3
2. See stack thumbnails that fill the grid cells properly (no letterboxed grey bars)
3. See thumbnail quality that is crisp on 160×120+ embedded previews (no blur on upscale)
4. See thumbnails appear progressively — card by card — as they are generated, not in a
   single batch after all 968 thumbnails have been written to disk
5. (Developer) Read `db/migrations.rs` and understand the full schema at a glance —
   no migration chain to trace

No culling, no rounds, no new IPC commands beyond the `thumbnail-ready` Tauri event.

**User Stories:** §4 (representative thumbnail per logical photo), §13 (thumbnails instant,
smooth scrolling, app responsive)

---

## 1. Architectural Principles

### 1.1 Thumbnail Generation Is Non-Blocking

Since Sprint 3, `pipeline.rs` already separates DB writes (Step 7) from thumbnail
generation (Step 8). The UI renders the stack grid as soon as Step 7 completes.
Sprint 4 does not change this architecture — it improves the signal from Step 8.

### 1.2 No Full RAW Decode for Thumbnails, Ever

The priority order is fixed and must not change:
1. Embedded JPEG in EXIF IFD1 (fastest — 7 ms/photo typical)
2. Sidecar JPEG (paired JPEG for a RAW file)
3. Full JPEG decode via `image::open()` (slow fallback — 1-4 s/photo)
4. RAW embedded JPEG via rsraw (only for RAW-only logical photos)

Full RAW pixel decode is never used for thumbnails. It is reserved for Sprint 9
(100% zoom in Single View).

### 1.3 Pixel Crop vs Letterbox — Documented Choice

The current code uses `img.thumbnail(256, 256)` which letterboxes: a 160×120 source
produces a 160×120 output, not a 256×256 output (grey bars fill the remaining space
because the container is square).

The grid uses `object-cover` CSS which crops the image to fill the container. This
means the letterboxed output is cropped anyway — but the effective resolution is
lower than it needs to be, because the pixel source is 160×120 upscaled.

Sprint 4 changes the resize method to `resize_to_fill(256, 256, FilterType::Lanczos3)`.
This crops the embedded thumbnail to fill 256×256, giving the `object-cover`
container a same-resolution image to work with.

**Important:** `resize_to_fill` still letterboxes if the source is smaller than 256px
in both dimensions. The minimum-size check (below) prevents this by falling through to
a higher-quality source before reaching `resize_to_fill`.

### 1.4 Minimum Size Check Before Using Embedded Thumbnail

If the embedded EXIF thumbnail is smaller than 200px in its shorter dimension, it is
rejected and the next fallback is tried. This threshold is calibrated to avoid
upscaling tiny previews (e.g. 80×60 icons embedded in some camera JPEGs) that would
produce visibly blurry 256×256 outputs.

Threshold: `min(width, height) < 200` → reject embedded thumbnail.

### 1.5 Tauri `thumbnail-ready` Event — Pragmatic Scope

The full in-memory LRU cache (sprint-plan.md §4 goal) is deferred to Sprint 5.
Sprint 4 adds only the `thumbnail-ready` Tauri event, emitted from the Rust backend
after each thumbnail is written to disk.

The frontend subscribes and updates the relevant `StackSummary.thumbnail_path` field
in the `stacks` array reactively. This replaces the 500ms-poll approach for thumbnail
visibility during generation.

The `asset://` URL scheme for serving thumbnails is unchanged.

### 1.6 DB Migration Squash — Pre-Launch Only

The migration squash is valid only because there is no shipped user data. The squash:
- Creates all tables in a single `CREATE TABLE IF NOT EXISTS` block
- Sets `schema_version` to `3` directly (preserving the version number)
- Deletes the `if version < 1`, `if version < 2`, `if version < 3` chain
- Retains a `// PRE-LAUNCH ONLY` comment documenting the constraint

After squash, `run_migrations` is idempotent on a fresh DB (all tables created) and
on a DB already at version 3 (all `CREATE TABLE IF NOT EXISTS` are no-ops).

**This squash must never be applied to a real user DB.** Document this constraint
with a `// PRE-LAUNCH ONLY` comment in the squashed code.

---

## 2. Changes Required

### 2.A DB Migration Squash (migrations.rs)

**Problem:** The current `run_migrations` has three chained `if version < N` blocks.
The v3 block uses `DROP TABLE IF EXISTS` to replace the v1 schema, which is fragile
and hard to read.

**Solution:** Replace the entire body of `run_migrations` with a single `execute_batch`
that creates all tables with `CREATE TABLE IF NOT EXISTS` and sets `schema_version = 3`.

**Final schema (version 3):**

```sql
CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS projects (
    id              INTEGER PRIMARY KEY,
    name            TEXT NOT NULL,
    slug            TEXT NOT NULL UNIQUE,
    created_at      TEXT NOT NULL,
    last_opened_at  TEXT
);

CREATE TABLE IF NOT EXISTS source_folders (
    id          INTEGER PRIMARY KEY,
    project_id  INTEGER NOT NULL REFERENCES projects(id),
    path        TEXT NOT NULL,
    added_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS stacks (
    id          INTEGER PRIMARY KEY,
    project_id  INTEGER NOT NULL REFERENCES projects(id),
    created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS logical_photos (
    id                      INTEGER PRIMARY KEY,
    project_id              INTEGER NOT NULL REFERENCES projects(id),
    representative_photo_id INTEGER REFERENCES photos(id),
    stack_id                INTEGER REFERENCES stacks(id),
    current_status          TEXT NOT NULL DEFAULT 'undecided'
);

CREATE TABLE IF NOT EXISTS photos (
    id               INTEGER PRIMARY KEY,
    path             TEXT NOT NULL UNIQUE,
    format           TEXT NOT NULL,
    capture_time     TEXT,
    orientation      INTEGER,
    camera_model     TEXT,
    lens             TEXT,
    logical_photo_id INTEGER REFERENCES logical_photos(id)
);

CREATE TABLE IF NOT EXISTS rounds (
    id           INTEGER PRIMARY KEY,
    project_id   INTEGER NOT NULL REFERENCES projects(id),
    scope        TEXT NOT NULL,
    scope_id     INTEGER NOT NULL,
    round_number INTEGER NOT NULL,
    state        TEXT NOT NULL DEFAULT 'open',
    created_at   TEXT NOT NULL,
    committed_at TEXT
);

CREATE TABLE IF NOT EXISTS decisions (
    id               INTEGER PRIMARY KEY,
    logical_photo_id INTEGER NOT NULL REFERENCES logical_photos(id),
    round_id         INTEGER NOT NULL REFERENCES rounds(id),
    action           TEXT NOT NULL,
    timestamp        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS merges (
    id                  INTEGER PRIMARY KEY,
    project_id          INTEGER NOT NULL REFERENCES projects(id),
    merged_stack_id     INTEGER,
    original_stack_ids  TEXT NOT NULL,
    timestamp           TEXT NOT NULL,
    undone              INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_photos_capture_time ON photos(capture_time);
CREATE INDEX IF NOT EXISTS idx_logical_stack        ON logical_photos(stack_id);
CREATE INDEX IF NOT EXISTS idx_logical_project      ON logical_photos(project_id);
```

**Version handling (idempotent):**

```rust
// Insert 0 only on a fresh DB; skip if schema_version row already exists.
// Then update to 3 only if currently lower than 3.
INSERT INTO schema_version SELECT 0
    WHERE NOT EXISTS (SELECT 1 FROM schema_version);
UPDATE schema_version SET version = 3 WHERE version < 3;
```

### 2.B Thumbnail Quality Fix (thumbnails.rs)

Three related changes:

**Change B1 — Minimum size check on embedded thumbnail:**

After decoding the embedded JPEG bytes, check `min(width, height)`. If `< 200`, skip
the embedded path and fall through to the next option (full decode).

Requires refactoring `generate_thumbnail_from_bytes` into two functions:
- `generate_thumbnail_from_bytes(bytes: &[u8], ...) -> Option<PathBuf>` — decodes then delegates
- `generate_thumbnail_from_image(img: DynamicImage, ...) -> Option<PathBuf>` — resizes + saves

In `generate_jpeg_thumbnail`:
```rust
if let Some(bytes) = extract_exif_embedded_thumbnail(source_path) {
    if let Ok(img) = image::load_from_memory(&bytes) {
        let short_side = img.width().min(img.height());
        if short_side >= 200 {
            if let Some(result) = generate_thumbnail_from_image(img, out_path, orientation) {
                tracing::debug!("thumbnail: embedded EXIF path ({}px short) for {:?}", short_side, source_path);
                return Some(result);
            }
        } else {
            tracing::debug!(
                "thumbnail: embedded too small ({}×{}, short={}), falling back for {:?}",
                img.width(), img.height(), short_side, source_path
            );
        }
    }
}
```

**Change B2 — `resize_to_fill` instead of `thumbnail`:**

In `generate_thumbnail_from_image`, replace:
```rust
img.thumbnail(256, 256)
```
with:
```rust
img.resize_to_fill(256, 256, image::imageops::FilterType::Lanczos3)
```

This fills the 256×256 output by cropping (aspect-ratio crop from centre), eliminating
the grey letterbox bars that `object-cover` would have cropped anyway.

**Change B3 — RAW thumbnail also resized to 256×256:**

Currently `generate_raw_thumbnail` writes the rsraw embedded JPEG bytes (typically
1620×1080) directly to disk without resize. This wastes disk space and the grid still
displays a 1620-pixel image via `object-cover`.

Update:
```rust
fn generate_raw_thumbnail(source_path: &Path, out_path: &Path) -> Option<PathBuf> {
    let jpeg_bytes = extract_raw_embedded_jpeg(source_path)?;
    let img = image::load_from_memory(&jpeg_bytes).ok()?;
    generate_thumbnail_from_image(img, out_path, None)  // RAW preview is pre-oriented
}
```

### 2.C Progressive Loading via Tauri `thumbnail-ready` Event

**Rust side (pipeline.rs):**

Add payload struct:
```rust
#[derive(serde::Serialize, Clone)]
struct ThumbnailReadyPayload {
    logical_photo_id: i64,
    thumbnail_path:   String,
}
```

Add `app_handle: Option<tauri::AppHandle>` parameter to `run_pipeline`. Pass `None`
from tests; pass `Some(handle)` from `start_indexing`.

In Step 8 (parallel thumbnail loop), after each successful write:
```rust
if let Some(ref handle) = app_handle {
    let _ = handle.emit("thumbnail-ready", ThumbnailReadyPayload {
        logical_photo_id: *lp_id,
        thumbnail_path: path.to_string_lossy().into_owned(),
    });
}
```

`AppHandle::emit` is sync in Tauri 2.x. Works correctly inside `rayon::par_iter`.

**Frontend side (StackOverview.svelte):**

Subscribe in `onMount` after `loadAll()`:
```typescript
import { listen } from '@tauri-apps/api/event'

const unlisten = await listen<{ logical_photo_id: number; thumbnail_path: string }>(
    'thumbnail-ready',
    async () => {
        // Re-query stacks to pick up newly available thumbnails.
        // A targeted single-card update (without re-query) is deferred to Sprint 5.
        if (projectSlug) stacks = await listStacks(projectSlug)
    }
)
```

In `onDestroy`, call `unlisten()` before existing cleanup.

**Note:** The 500ms poll continues during `thumbnails_running`. The event provides a
sub-500ms progressive update signal; the poll provides correctness. Both coexist.

---

## 3. TDD Test Specifications

All tests listed below must be **written BEFORE the implementation they test**.
Red → Green → Refactor for each step.

---

### 3.A DB Migration Tests (Layer 6 — migrations.rs)

Write tests A1–A5 first, run them, confirm they all PASS against current code
(they establish the baseline). Then squash migrations.rs and confirm they still pass.

#### Test A1: `test_squashed_migrations_schema_version_is_3`
```rust
let conn = in_memory();
run_migrations(&conn).unwrap();
assert_eq!(schema_version(&conn).unwrap(), 3);
```

#### Test A2: `test_squashed_migrations_all_tables_exist`
```rust
let conn = in_memory();
run_migrations(&conn).unwrap();
for table in &["schema_version", "projects", "source_folders", "stacks",
               "logical_photos", "photos", "rounds", "decisions", "merges"] {
    let count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?1",
        rusqlite::params![table], |r| r.get(0)
    ).unwrap();
    assert_eq!(count, 1, "table {} must exist", table);
}
```

#### Test A3: `test_squashed_migrations_idempotent`
```rust
let conn = in_memory();
run_migrations(&conn).unwrap();
run_migrations(&conn).unwrap(); // must not panic or error
assert_eq!(schema_version(&conn).unwrap(), 3);
```

#### Test A4: `test_squashed_migrations_photos_column_set`
```rust
// Rule 1: verify the actual schema, not just "no panic".
// photos must have the v3 columns and NOT the old v1 columns.
let conn = in_memory();
run_migrations(&conn).unwrap();
let mut stmt = conn.prepare("PRAGMA table_info(photos)").unwrap();
let cols: Vec<String> = stmt.query_map([], |r| r.get(1))
    .unwrap().filter_map(|r| r.ok()).collect();
// v3 columns present:
for col in &["id", "path", "format", "capture_time", "orientation",
             "camera_model", "lens", "logical_photo_id"] {
    assert!(cols.contains(&col.to_string()), "photos must have column {}", col);
}
// v1 columns absent:
for col in &["pair_id", "stack_id", "project_id", "current_status"] {
    assert!(!cols.contains(&col.to_string()),
        "photos must NOT have old column {}", col);
}
```

#### Test A5: `test_squashed_migrations_decisions_references_logical_photo`
```rust
let conn = in_memory();
run_migrations(&conn).unwrap();
let mut stmt = conn.prepare("PRAGMA table_info(decisions)").unwrap();
let cols: Vec<String> = stmt.query_map([], |r| r.get(1))
    .unwrap().filter_map(|r| r.ok()).collect();
assert!(cols.contains(&"logical_photo_id".to_string()));
assert!(!cols.contains(&"photo_id".to_string()),
    "decisions must use logical_photo_id, not old photo_id");
```

---

### 3.B Thumbnail Quality Tests (Layer 1 — thumbnails.rs)

Write B1–B6 BEFORE making changes. B3, B5 will be RED immediately (they assert exact
256×256 which `thumbnail()` cannot produce for non-square sources). B1, B2, B6 will
be RED after adding the size check. B4 will be RED after adding RAW resize.

#### Test B1: `test_jpeg_thumbnail_small_embedded_rejected`
```rust
// Embedded thumb 80×60 (short=60 < 200) → rejected.
// Main body has no SOS → fallback fails → None.
// Proves the size check rejects tiny embedded thumbnails.
let src = make_jpeg_with_embedded_thumb(80, 60);
let cache_dir = TempDir::new().unwrap();
let result = generate_thumbnail(src.path(), &PhotoFormat::Jpeg, 500, cache_dir.path(), None);
assert!(
    result.is_none(),
    "embedded 80×60 (short=60) must be rejected; empty body fallback → None"
);
```

#### Test B2: `test_jpeg_thumbnail_large_embedded_accepted`
```rust
// Embedded thumb 320×213 (short=213 >= 200) → accepted.
// Main body has no SOS, so Some(_) can only come from embedded path.
let src = make_jpeg_with_embedded_thumb(320, 213);
let cache_dir = TempDir::new().unwrap();
let result = generate_thumbnail(src.path(), &PhotoFormat::Jpeg, 501, cache_dir.path(), None);
assert!(result.is_some(), "320×213 embedded (short=213) must be accepted");
```

#### Test B3: `test_jpeg_thumbnail_output_fills_256x256`
```rust
// Rule 1. After resize_to_fill, output must be exactly 256×256 (not letterboxed).
// Uses full-decode path (make_jpeg has no EXIF embedded thumb).
// CURRENTLY RED: thumbnail() produces 256×192 for a 4:3 source.
let src = make_jpeg(800, 600);
let cache_dir = TempDir::new().unwrap();
generate_thumbnail(src.path(), &PhotoFormat::Jpeg, 600, cache_dir.path(), None);
let img = image::open(cache_dir.path().join("600.jpg")).unwrap();
assert_eq!(img.width(), 256, "width must be exactly 256 (not letterboxed)");
assert_eq!(img.height(), 256, "height must be exactly 256 (not letterboxed)");
```

#### Test B4: `test_raw_thumbnail_output_fills_256x256`
```rust
// Rule 1. RAW thumbnails must also be resized to 256×256.
// Tests generate_thumbnail_from_image directly (bypasses rsraw for unit test).
let img = image::DynamicImage::new_rgb8(1620, 1080);
let out_dir = TempDir::new().unwrap();
let out_path = out_dir.path().join("raw_test.jpg");
let result = generate_thumbnail_from_image(img, &out_path, None);
assert!(result.is_some());
let output = image::open(&out_path).unwrap();
assert_eq!(output.width(), 256);
assert_eq!(output.height(), 256);
```

#### Test B5: `test_thumbnail_output_fills_256x256_via_embedded_path`
```rust
// Rule 1. Embedded EXIF path must also produce exactly 256×256.
// CURRENTLY RED: embedded path uses thumbnail() → letterboxed.
let src = make_jpeg_with_embedded_thumb(400, 300); // short=300 >= 200, accepted
let cache_dir = TempDir::new().unwrap();
generate_thumbnail(src.path(), &PhotoFormat::Jpeg, 700, cache_dir.path(), None);
let img = image::open(cache_dir.path().join("700.jpg")).unwrap();
assert_eq!(img.width(), 256, "embedded path must produce exactly 256×256");
assert_eq!(img.height(), 256, "embedded path must produce exactly 256×256");
```

#### Test B6: `test_thumbnail_size_boundary_200px`
```rust
// Validates exact boundary: short=200 accepted, short=199 rejected.
let src_ok  = make_jpeg_with_embedded_thumb(300, 200); // short=200 → accepted
let src_bad = make_jpeg_with_embedded_thumb(299, 199); // short=199 → rejected

let cache_ok = TempDir::new().unwrap();
let result_ok = generate_thumbnail(src_ok.path(), &PhotoFormat::Jpeg, 800, cache_ok.path(), None);
assert!(result_ok.is_some(), "short=200 must be accepted");

let cache_bad = TempDir::new().unwrap();
let result_bad = generate_thumbnail(src_bad.path(), &PhotoFormat::Jpeg, 801, cache_bad.path(), None);
assert!(result_bad.is_none(), "short=199 must be rejected; empty body fallback → None");
```

#### Negative test: `test_thumbnail_single_pixel_source_does_not_panic`
```rust
// Degenerate input: 1×1 source. Must not panic (catch_unwind covers it).
let src = make_jpeg(1, 1);
let cache_dir = TempDir::new().unwrap();
let _ = generate_thumbnail(src.path(), &PhotoFormat::Jpeg, 999, cache_dir.path(), None);
// Result may be Some or None; must not panic.
```

#### Performance test update

After implementing Lanczos3 resize, re-measure and update
`test_jpeg_thumbnail_performance_968_photos_under_30s`:

```
// Measured YYYY-MM-DD on AMD Ryzen 5 5625U: XXms/photo with Lanczos3.
// Threshold: XXms × 3 = YYms/photo → YYs total for 968 photos / 10 threads.
assert!(elapsed.as_secs() < YY, "...");
```

Replace `YY` with the actual measured total × 3. Document date + hardware.

---

### 3.C Progressive Loading Tests

#### Test C1: `test_thumbnail_ready_payload_serializes_correctly` (pipeline.rs or thumbnails.rs)
```rust
// Rule 1. Verify ThumbnailReadyPayload serializes to the expected JSON shape.
// No Tauri runtime needed — serde_json round-trip only.
let payload = ThumbnailReadyPayload {
    logical_photo_id: 42,
    thumbnail_path: "/home/user/.gem-keep/projects/test/cache/thumbnails/42.jpg".to_string(),
};
let json = serde_json::to_string(&payload).unwrap();
let v: serde_json::Value = serde_json::from_str(&json).unwrap();
assert_eq!(v["logical_photo_id"], 42);
assert!(v["thumbnail_path"].as_str().unwrap().ends_with("42.jpg"));
```

#### Test C2: Frontend — `receiving thumbnail-ready event updates stack thumbnail`
```typescript
// In StackOverview.test.ts. Requires @tauri-apps/api/event mock (see §4.2).
it('calls listStacks when thumbnail-ready event fires', async () => {
    let capturedHandler: ((e: any) => void) | null = null
    mockListen.mockImplementation(async (event, handler) => {
        if (event === 'thumbnail-ready') capturedHandler = handler as any
        return async () => {}
    })
    // Setup: stacks initially have no thumbnail
    mockInvoke
        .mockResolvedValueOnce([FOLDER_A])
        .mockResolvedValueOnce([{ ...STACK_1, thumbnail_path: null }])
        .mockResolvedValueOnce(THUMBNAIL_RUNNING_STATUS)
        // After event: listStacks returns updated data
        .mockResolvedValueOnce([{ ...STACK_1, thumbnail_path: '/cache/42.jpg' }])

    render(StackOverview, { props: { slug: 'test' } })
    await waitFor(() => screen.getByText('Stack #1'))

    // Fire the event
    await act(async () => {
        capturedHandler?.({ payload: { logical_photo_id: 42, thumbnail_path: '/cache/42.jpg' } })
    })

    // listStacks should have been called again → img should appear
    await waitFor(() => {
        expect(container.querySelector('img')).toBeInTheDocument()
    })
})
```

#### Test C3: Frontend — `unlisten called on component destroy`
```typescript
it('calls unlisten when component is destroyed', async () => {
    const mockUnlisten = vi.fn()
    mockListen.mockResolvedValue(mockUnlisten)
    const { unmount } = render(StackOverview, { props: { slug: 'test' } })
    await waitFor(() => /* component loaded */)
    unmount()
    expect(mockUnlisten).toHaveBeenCalled()
})
```

#### Test C4: E2E — `thumbnail appears progressively after thumbnail-ready event`

File: `tests/e2e/thumbnail-pipeline.spec.ts`

```typescript
test('stack card shows thumbnail after thumbnail-ready event', async ({ page }) => {
    // Inject event capture into the IPC mock addInitScript
    await page.addInitScript(() => {
        window.__tauriEventHandlers = {}
        // Override the mock listen() to capture handlers
        const origListen = window.__tauri?.event?.listen
        if (window.__tauri?.event) {
            window.__tauri.event.listen = async (eventName, handler) => {
                window.__tauriEventHandlers[eventName] = handler
                return async () => {}
            }
        }
        // Expose trigger helper
        window.triggerThumbnailReady = (payload) => {
            const h = window.__tauriEventHandlers['thumbnail-ready']
            if (h) h({ payload })
        }
    })

    // Navigate to a project with stacks but no thumbnails yet
    // ... project navigation steps ...

    // Verify no img element initially
    await expect(page.locator('[data-stack-card] img')).toHaveCount(0)

    // Trigger thumbnail-ready event
    await page.evaluate(() =>
        window.triggerThumbnailReady({ logical_photo_id: 1, thumbnail_path: '/fake/1.jpg' })
    )

    // img should appear (after listStacks re-query resolves)
    await expect(page.locator('[data-stack-card] img').first()).toBeVisible({ timeout: 2000 })
})
```

---

## 4. Testing Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│  L10: E2E Journey  (Playwright, Chromium + injected event mock)     │
│  tests/e2e/thumbnail-pipeline.spec.ts (NEW — test C4)              │
├─────────────────────────────────────────────────────────────────────┤
│  L9:  Frontend UI  (Vitest + @testing-library/svelte + jsdom)       │
│  src/lib/components/screens/StackOverview.test.ts (UPDATED)         │
│  Tests C2, C3. Requires @tauri-apps/api/event mock in setup.ts.    │
├─────────────────────────────────────────────────────────────────────┤
│  L8:  Tauri Runtime (asset:// protocol, real event system)          │
│  ❌ CANNOT be automated — manual checklist (§12)                   │
├─────────────────────────────────────────────────────────────────────┤
│  L7:  Event contract (ThumbnailReadyPayload serde)                  │
│  Test C1 — no Tauri runtime needed                                  │
├─────────────────────────────────────────────────────────────────────┤
│  L6:  Database  (migration squash, schema correctness)              │
│  src-tauri/src/db/migrations.rs — tests A1–A5                      │
├─────────────────────────────────────────────────────────────────────┤
│  L1:  Thumbnail Quality (size check, resize_to_fill, RAW resize)    │
│  src-tauri/src/import/thumbnails.rs — tests B1–B6 + negative       │
└─────────────────────────────────────────────────────────────────────┘
```

### 4.1 Existing Tests That Must Continue to Pass

All sprint-03 tests pass unchanged. One update required:

- `test_jpeg_thumbnail_embedded_output_fits_256px` — currently uses `<= 256` assertions.
  After change B2, update to `== 256` (exact) to match the new `resize_to_fill` behaviour.

### 4.2 New Mock Required: `@tauri-apps/api/event`

Add to `src/test/setup.ts`:
```typescript
vi.mock('@tauri-apps/api/event', () => ({
    listen: vi.fn().mockResolvedValue(async () => {}),
    emit:   vi.fn().mockResolvedValue(undefined),
    once:   vi.fn().mockResolvedValue(undefined),
}))
```

### 4.3 Performance Thresholds (Rule 7)

| Operation | Measured (2026-02-21) | Threshold |
|-----------|----------------------|-----------|
| Embedded EXIF (7ms/photo, 968 photos, 10 threads) | 6.4s total | 30s total |
| Embedded + Lanczos3 resize (estimate 12ms/photo) | ~12s total | **re-measure and set 3×** |
| Full JPEG decode fallback (single photo) | ~3s | 9s |
| run_migrations on fresh in-memory DB | <5ms | 15ms |

**After implementing Lanczos3:** Measure the actual time, update the performance test
threshold, and document measurement date and hardware.

---

## 5. Sequencing (TDD Implementation Order)

Maintain a green test suite throughout:

1. **Write tests A1–A5** → run → all PASS (baseline)
2. **Squash migrations.rs** → run → all PASS (mechanism changed, schema identical)
3. **Write tests B3, B5** → run → FAIL (letterboxing; `thumbnail()` doesn't fill 256×256)
4. **Write tests B1, B2, B6** → run → FAIL (no size check yet)
5. **Write test B4** → run → FAIL (RAW path writes raw bytes without resize)
6. **Implement B1** (size check, refactor to `generate_thumbnail_from_image`) → B1, B2, B6 PASS
7. **Implement B2** (resize_to_fill in `generate_thumbnail_from_image`) → B3, B5 PASS
8. **Implement B3** (RAW resize via `generate_thumbnail_from_image`) → B4 PASS
9. **Write test C1** → run → FAIL (struct doesn't exist yet)
10. **Add ThumbnailReadyPayload** → C1 PASS
11. **Write tests C2, C3** (frontend) → FAIL (listen() not called yet)
12. **Add `app_handle` to `run_pipeline`**, emit event in Step 8 → C1 context ready
13. **Add `listen('thumbnail-ready', ...)` to StackOverview.svelte** → C2, C3 PASS
14. **Write and run E2E test C4**
15. **Run full suite** — all tests green, clippy clean

---

## 6. Cargo.toml Changes

No new dependencies required. All crates already present:

| Crate | Already present | Used for |
|-------|----------------|---------|
| `image = { version = "0.25", features = ["jpeg"] }` | ✓ | `resize_to_fill`, `FilterType::Lanczos3` |
| `kamadak-exif = "0.5"` | ✓ | Embedded thumbnail extraction |
| `rsraw = "0.1"` | ✓ | RAW embedded JPEG |
| `rayon = "1"` | ✓ | Parallel thumbnail generation |
| `tauri = { version = "2", ... }` | ✓ | `AppHandle::emit` |

`FilterType::Lanczos3` is at `image::imageops::FilterType::Lanczos3`.

---

## 7. IPC / Event Contract Additions

No new `invoke` commands in Sprint 4.

**New Tauri event (Rust → Frontend, fire-and-forget):**

| Event | Direction | Payload |
|-------|-----------|---------|
| `thumbnail-ready` | Rust → Frontend | `{ logical_photo_id: number, thumbnail_path: string }` |

Emitted after each successful thumbnail write in pipeline Step 8. Not emitted on failure.

**Frontend subscription (StackOverview.svelte, not an API export):**
```typescript
import { listen } from '@tauri-apps/api/event'
```

---

## 8. Frontend Changes

**Files changed:**
- `src/lib/components/screens/StackOverview.svelte` — add `listen('thumbnail-ready', ...)`
- `src/test/setup.ts` — add `@tauri-apps/api/event` mock

**StackOverview.svelte:**
1. Import `listen` and `onDestroy` from their respective packages
2. In `onMount`, after `loadAll()`:
   ```typescript
   const unlisten = await listen<{ logical_photo_id: number; thumbnail_path: string }>(
       'thumbnail-ready',
       async () => {
           if (projectSlug) stacks = await listStacks(projectSlug)
       }
   )
   ```
3. In `onDestroy`, call `unlisten()`

The 500ms poll during `thumbnails_running` remains unchanged. The event provides
progressive per-thumbnail updates; the poll provides correctness.

---

## 9. Out of Scope

| Feature | Sprint |
|---------|--------|
| In-memory LRU thumbnail cache (200 MB) | Sprint 5 |
| Frontend `logical_photo_id → stack_id` mapping (targeted card update) | Sprint 5 |
| Expanded RAW format list (NEF, RAF, RW2, DNG) | Near-term, low effort |
| Full RAW pixel decode for thumbnails | Never (see §1.2) |
| `asset://` replacement with IPC binary transfer | Sprint 5 |
| Per-project config (burst_gap_secs) | Sprint 5 |
| Sidecar JPEG fallback (priority level 2) | Sprint 5 |

---

## 10. Definition of Done

### Part A — DB Migration Squash
- [ ] Test A1: `test_squashed_migrations_schema_version_is_3` passes
- [ ] Test A2: `test_squashed_migrations_all_tables_exist` passes (9 tables verified)
- [ ] Test A3: `test_squashed_migrations_idempotent` passes
- [ ] Test A4: `test_squashed_migrations_photos_column_set` passes (pair_id, stack_id, project_id, current_status confirmed absent)
- [ ] Test A5: `test_squashed_migrations_decisions_references_logical_photo` passes
- [ ] `migrations.rs` has no `if version < N` chain — single flat `CREATE TABLE IF NOT EXISTS` block
- [ ] `// PRE-LAUNCH ONLY` comment present in `run_migrations`

### Part B — Thumbnail Quality
- [ ] Test B1: `test_jpeg_thumbnail_small_embedded_rejected` passes
- [ ] Test B2: `test_jpeg_thumbnail_large_embedded_accepted` passes
- [ ] Test B3: `test_jpeg_thumbnail_output_fills_256x256` passes (exact 256×256, full-decode path)
- [ ] Test B4: `test_raw_thumbnail_output_fills_256x256` passes
- [ ] Test B5: `test_thumbnail_output_fills_256x256_via_embedded_path` passes
- [ ] Test B6: `test_thumbnail_size_boundary_200px` passes
- [ ] `test_thumbnail_single_pixel_source_does_not_panic` passes
- [ ] `generate_thumbnail_from_image` helper exists and uses `resize_to_fill(256, 256, FilterType::Lanczos3)`
- [ ] RAW thumbnails resized to 256×256 (not written as raw bytes)
- [ ] Performance test threshold updated with post-Lanczos3 measurement × 3 + date comment

### Part C — Progressive Loading
- [ ] Test C1: `test_thumbnail_ready_payload_serializes_correctly` passes
- [ ] Test C2: frontend thumbnail-ready event test passes
- [ ] Test C3: frontend unlisten-on-destroy test passes
- [ ] Test C4 (E2E): `thumbnail-pipeline.spec.ts` passes
- [ ] `@tauri-apps/api/event` mocked in `src/test/setup.ts`
- [ ] `StackOverview.svelte` calls `listen('thumbnail-ready', ...)` in onMount
- [ ] `StackOverview.svelte` calls `unlisten()` in onDestroy

### Overall
- [ ] All sprint-03 tests continue to pass (`cargo test`, `npm test`, `npm run test:e2e`)
- [ ] `cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings` clean
- [ ] `cargo fmt --manifest-path src-tauri/Cargo.toml` clean
- [ ] Manual tests T4-01 through T4-04 completed (see §12)
- [ ] Committed: `feat: sprint-4 thumbnail quality, migration squash, progressive loading`

---

## 11. Negative Tests

| Scenario | Expected | Test |
|----------|----------|------|
| Embedded thumbnail < 200px short side | Rejected; falls back | B1 |
| Embedded thumbnail > 200px short side | Accepted | B2 |
| Short side exactly 200px | Accepted | B6 |
| Short side exactly 199px | Rejected | B6 |
| Embedded thumbnail corrupt bytes | Fallback | existing: `test_jpeg_thumbnail_falls_back_to_full_decode_when_no_embedded_exif` |
| thumbnail-ready fires after component destroyed | unlisten prevents update | C3 |
| run_migrations on existing v3 DB | No-op | A3 |
| 1×1 source image | No panic, Some or None | negative B |

---

## 12. Manual Test Checklist (Layer 8 — Tauri Runtime)

Add to `docs/manual-tests.md` after Sprint 4 ships:

```
## Sprint 4 Manual Tests

### T4-01: Thumbnail fill (no letterboxing)
1. cargo tauri dev with a real project (previously indexed in Sprint 3)
2. Open Stack Overview with 10+ stacks
3. Verify: stack card thumbnails fill the grid cells edge-to-edge (no grey bars)
4. Verify: portrait photos appear portrait (not landscape)

### T4-02: Thumbnail quality
1. Same project as T4-01
2. Compare grid thumbnail sharpness to Sprint 3 thumbnails
3. Verify: thumbnails are visibly sharper (Lanczos3 vs bilinear upscale on tiny src)

### T4-03: Progressive loading
1. Re-index the project (clears thumbnail cache)
2. Immediately after start_indexing returns: verify stack grid is visible with placeholders
3. Watch thumbnails appear one by one (not all at once after 10+ seconds)
4. Verify: each placeholder is replaced by an image without user action

### T4-04: Asset protocol still works
1. After T4-03, navigate away and back to Stack Overview
2. Verify: all thumbnails load correctly via asset:// URLs
3. DevTools → Network → verify no 4xx errors on image loads

Trigger: Run after any change to thumbnails.rs, pipeline.rs (Step 8),
StackOverview.svelte (listener, listStacks), or tauri.conf.json.
```
