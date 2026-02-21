# Milestone 3 — Ingestion & Structural Modeling

> Backend correctness ≠ usable product.
> Sprint 3 defines **backend + UI together**.

---

## 🎯 Goal

After Sprint 3, a user can:

1. Open a project
2. Attach one or more source folders (native folder picker)
3. Run indexing (with progress bar + cancel)
4. See generated stacks in Stack Overview (card grid)
5. Navigate stacks with arrow keys and Enter
6. See a representative thumbnail per stack
7. Understand indexing progress and errors

No selection, no rounds, no elimination yet.

**User Stories:** §2 (all), §3 (auto-generation only)

---

# 1. Core Architectural Principles

## 1.1 Indexing Must Be

- **Deterministic** — same input always produces the same stacks
- **Idempotent** — running twice produces no duplicates
- **Restart-safe** — crash mid-index → re-run succeeds cleanly
- **Non-destructive** — source files never touched

Running indexing twice: second run reports 0 imported, same stacks.

---

## 1.2 Logical Photo Is a First-Class Entity

Pair handling is **explicit, not implicit**.

Three tables form the model:

- `photos` — individual files on disk (one row per file)
- `logical_photos` — the atomic unit of culling (one row per pair or unpaired photo)
- `stacks` — burst groups of logical photos

The UI, rounds engine, and decisions table all operate on **logical_photos**, never directly on photos.

---

## 1.3 RAW Processing Library

Use **rsraw** (LibRaw FFI). LibRaw is the industry standard and will be needed for
thumbnail decode (Sprint 4) and full-res RAW decode (Sprint 4+). Establishing the
dependency now avoids rework.

For JPEG EXIF: **kamadak-exif** (pure Rust, most accurate EXIF parser).

For Sprint 3, both libraries are used **only for metadata extraction** — no pixel decode.

---

# 2. Database Changes (Migration v3)

Migration v3 is idempotent. It replaces the Sprint 1/2 `photos` schema with the
logical photo model and adds `logical_photos`.

### 2.1 photos table (replaced)

```sql
-- Drop v1/v2 photos (pair_id, stack_id, current_status move out)
DROP TABLE IF EXISTS photos;

CREATE TABLE photos (
    id              INTEGER PRIMARY KEY,
    path            TEXT NOT NULL UNIQUE,
    format          TEXT NOT NULL,          -- 'jpeg' | 'raw'
    capture_time    TEXT,                   -- ISO-8601 UTC; NULL if EXIF missing
    orientation     INTEGER,                -- EXIF tag 1–8; NULL if missing
    camera_model    TEXT,
    lens            TEXT,
    logical_photo_id INTEGER REFERENCES logical_photos(id)
);
```

### 2.2 logical_photos table (new)

```sql
CREATE TABLE logical_photos (
    id                      INTEGER PRIMARY KEY,
    project_id              INTEGER NOT NULL REFERENCES projects(id),
    representative_photo_id INTEGER REFERENCES photos(id),  -- JPEG preferred; set after pair detection
    stack_id                INTEGER REFERENCES stacks(id),
    current_status          TEXT NOT NULL DEFAULT 'undecided'
);
```

`project_id` is kept on `logical_photos` for efficient project-scoped queries
without joining through stacks.

### 2.3 stacks table (kept, project_id retained)

```sql
-- stacks already has id, project_id, created_at from v1 — no change needed
-- project_id is required for: SELECT * FROM stacks WHERE project_id = ?
```

### 2.4 decisions table (updated)

```sql
-- decisions.photo_id → logical_photo_id
-- Recreate since table is empty (no culling has happened yet)
DROP TABLE IF EXISTS decisions;

CREATE TABLE decisions (
    id              INTEGER PRIMARY KEY,
    logical_photo_id INTEGER NOT NULL REFERENCES logical_photos(id),
    round_id        INTEGER NOT NULL REFERENCES rounds(id),
    action          TEXT NOT NULL,          -- 'keep' | 'eliminate'
    timestamp       TEXT NOT NULL
);
```

### 2.5 Indexes

```sql
CREATE INDEX IF NOT EXISTS idx_photos_capture_time   ON photos(capture_time);
CREATE INDEX IF NOT EXISTS idx_logical_stack          ON logical_photos(stack_id);
CREATE INDEX IF NOT EXISTS idx_logical_project        ON logical_photos(project_id);
```

---

# 3. Rust Module Structure

New top-level module `src-tauri/src/import/` contains the entire indexing pipeline.
New `src-tauri/src/photos/` contains the data model for photos and stacks.

```
src-tauri/src/
├── commands/
│   ├── mod.rs                  (add: pub mod import)
│   ├── projects.rs             (unchanged)
│   └── import.rs               (NEW — all import IPC commands)
├── import/
│   ├── mod.rs
│   ├── scanner.rs              (recursive walkdir, extension filter)
│   ├── exif.rs                 (kamadak-exif for JPEG; rsraw for RAW)
│   ├── pairs.rs                (base-filename matcher → logical_photo creation)
│   ├── stacks.rs               (burst detection by capture_time gap)
│   ├── thumbnails.rs           (extract embedded JPEG or resize JPEG → cache file)
│   └── pipeline.rs             (orchestrates all steps; runs in background thread)
├── photos/
│   ├── mod.rs
│   ├── model.rs                (Photo, LogicalPhoto, StackSummary, ImportStats, IndexingStatus)
│   └── repository.rs           (insert_photo, insert_logical_photo, list_stacks_summary, …)
└── (existing: db/, projects/, state.rs, lib.rs)
```

---

# 4. Rust Types

### PhotoFormat

```rust
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PhotoFormat {
    Jpeg,
    Raw,
}
```

### ScannedFile (intermediate, not persisted)

```rust
pub struct ScannedFile {
    pub path:         PathBuf,
    pub format:       PhotoFormat,
    pub capture_time: Option<chrono::DateTime<chrono::Utc>>,
    pub camera_model: Option<String>,
    pub lens:         Option<String>,
    pub orientation:  Option<u16>,
    pub base_name:    String,    // lowercase, no extension, for pair matching
    pub dir:          PathBuf,   // parent directory
}
```

### ImportStats

```rust
#[derive(Debug, Default, Clone, serde::Serialize, serde::Deserialize)]
pub struct ImportStats {
    pub total_files_scanned:  usize,
    pub imported:             usize,
    pub skipped_existing:     usize,
    pub skipped_unsupported:  usize,
    pub errors:               usize,
    pub pairs_detected:       usize,
    pub stacks_generated:     usize,
    pub logical_photos:       usize,
    pub error_log:            Vec<String>,  // ≤100 entries
}
```

### IndexingStatus (live progress)

```rust
#[derive(Debug, Default, Clone, serde::Serialize, serde::Deserialize)]
pub struct IndexingStatus {
    pub running:    bool,
    pub total:      usize,   // files discovered (may grow during scan)
    pub processed:  usize,   // files completed
    pub errors:     usize,
    pub cancelled:  bool,
    pub last_stats: Option<ImportStats>,  // populated when done
}
```

### StackSummary

```rust
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct StackSummary {
    pub stack_id:          i64,
    pub logical_photo_count: i64,
    pub earliest_capture:  Option<String>,    // ISO-8601 date
    pub has_raw:           bool,
    pub has_jpeg:          bool,
    pub thumbnail_path:    Option<String>,    // absolute path to cached thumbnail
}
```

---

# 5. AppState Changes

```rust
pub struct AppState {
    pub db:              Mutex<Option<Connection>>,
    pub active_project:  Mutex<Option<Project>>,
    pub gemkeep_home:    PathBuf,
    pub indexing_status: Mutex<IndexingStatus>,    // NEW
    pub cancel_indexing: Arc<AtomicBool>,          // NEW — set true to cancel
}
```

`indexing_status` is reset to default on `open_project`. `cancel_indexing` is reset
(set to `false`) on `open_project` and when a new indexing run starts.

---

# 6. Config.json Schema

`burst_gap_secs` is stored in project config (global `config.json` for now; per-project
config is Sprint 5). Backward compatible via `#[serde(default)]`.

```rust
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct GemKeepConfig {
    pub last_opened_slug: Option<String>,
    #[serde(default = "default_burst_gap")]
    pub burst_gap_secs: u64,   // default 3
}

fn default_burst_gap() -> u64 { 3 }
```

---

# 7. Indexing Pipeline (import/pipeline.rs)

Runs in a **background thread** spawned by `start_indexing()`. The main IPC command
returns immediately. Frontend polls `get_indexing_status()`.

```
start_indexing(state, project_id, burst_gap_secs):

  Set indexing_status.running = true
  Set cancel_indexing = false

  STEP 1 — SCAN (import/scanner.rs)
    For each source_folder:
      Walk recursively via walkdir (skip symlinks)
      Handle permission errors gracefully (log + skip folder)
      Filter by extension (case-insensitive):
        JPEG: .jpg, .jpeg
        RAW:  .cr2, .cr3, .arw
      Skip paths already in photos.path (idempotency check)
      Collect ScannedFile structs
      Update indexing_status.total as files are found
      Check cancel_indexing → abort if true

  STEP 2 — EXIF EXTRACTION (import/exif.rs, parallel via rayon)
    For each ScannedFile (rayon::par_iter):
      If JPEG: extract via kamadak-exif
      If RAW:  extract via rsraw / LibRaw
      On parse error: log warning, set all EXIF fields = None
      Catch panics from FFI (std::panic::catch_unwind)
      Update indexing_status.processed

  STEP 3 — PAIR DETECTION (import/pairs.rs)
    Group ScannedFiles by (dir, base_name)
    For groups of exactly (1 RAW + 1 JPEG):
      → one logical_photo (pair); representative = JPEG
    For singles:
      → one logical_photo (unpaired); representative = the file itself
    For 3+ files same base: log warning → treat all as singles
    Photos with no capture_time → solo logical_photo (not burst-grouped)

  STEP 4 — STACK ASSIGNMENT (import/stacks.rs)
    Separate: logical_photos WITH capture_time vs WITHOUT
    For those WITH capture_time:
      Sort by capture_time ascending
      Iterate: if gap ≤ burst_gap_secs → same stack; else → new stack
    For each WITHOUT capture_time:
      Create individual stack of size 1
    Assign stack_id to each logical_photo

  STEP 5 — THUMBNAIL GENERATION (import/thumbnails.rs)
    For each logical_photo's representative photo:
      If RAW: extract embedded JPEG via rsraw
      If JPEG: decode + resize to 256×256 via image crate
      Write to <project>/cache/thumbnails/<logical_photo_id>.jpg
      On failure: log, leave thumbnail_path = NULL (no panic)

  STEP 6 — DB INSERT (single transaction)
    BEGIN TRANSACTION
      For each stack:           INSERT INTO stacks
      For each logical_photo:   INSERT INTO logical_photos
      For each scanned file:    INSERT OR IGNORE INTO photos
      Set photos.logical_photo_id for each file
      Set logical_photos.representative_photo_id
    COMMIT

  STEP 7 — LOG
    [ISO-8601] INDEX_COMPLETED photos=N stacks=N errors=N

  Set indexing_status.running = false
  Set indexing_status.last_stats = ImportStats { … }
```

---

# 8. IPC Commands (commands/import.rs)

### `add_source_folder(slug: String, path: String) → ()`
Validates the path exists on disk. Inserts into `source_folders`. Returns error if
path does not exist or is already attached to this project.

### `remove_source_folder(slug: String, folder_id: i64) → ()`
Removes a source folder by id. Cannot be called while indexing is running (returns
error "indexing in progress").

### `list_source_folders(slug: String) → Vec<{ id: i64, path: String }>`
Returns all attached source folders for the project.

### `start_indexing(slug: String) → ()`
Spawns a background thread running the pipeline. Returns immediately. Returns error
if indexing is already running. Reads `burst_gap_secs` from `GemKeepConfig`.

### `cancel_indexing() → ()`
Sets `cancel_indexing` AtomicBool to true. The background thread checks it between
steps and stops cleanly. Does nothing if not indexing.

### `get_indexing_status() → IndexingStatus`
Returns current `indexing_status` snapshot (thread-safe read). Frontend polls this
every 500ms during indexing.

### `list_stacks(slug: String) → Vec<StackSummary>`
Returns all stacks for the project ordered by `earliest_capture` ascending. Includes
thumbnail path if generated.

---

# 9. Thumbnail Strategy (Minimal, Sprint 3)

- **Source:** embedded JPEG inside RAW (via rsraw), or resize JPEG (via `image` crate)
- **Size:** 256×256 px, JPEG quality 75
- **Storage:** `<project>/cache/thumbnails/<logical_photo_id>.jpg`
- **Timing:** generated during indexing pipeline (Step 5)
- **Failure:** non-fatal; `thumbnail_path` remains NULL; grid shows placeholder icon
- **No LRU, no prefetch, no in-memory cache** — all Sprint 4

---

# 10. Supported File Extensions

| Format | Extensions |
|--------|-----------|
| JPEG   | `.jpg`, `.jpeg` (case-insensitive) |
| RAW    | `.cr2`, `.cr3`, `.arw` (case-insensitive) |

All other extensions are silently ignored.

> `// TODO: expand RAW list to: nef, raf, rw2, dng, orf, pef — low effort when needed`

---

# 11. Cargo.toml Additions

```toml
# Indexing pipeline
kamadak-exif = "0.5"
rsraw        = "0.x"    # requires libraw-dev in ~/.local (same as GTK/WebKit pattern)
walkdir      = "2"
rayon        = "1"
image        = { version = "0.25", default-features = false, features = ["jpeg"] }

# Frontend folder picker
[target.'cfg(not(any(target_os = "android", target_os = "ios")))'.dependencies]
tauri-plugin-dialog = "2"
```

**npm:** `npm install @tauri-apps/plugin-dialog`

**Tauri capabilities** (`src-tauri/capabilities/default.json`): add `"dialog:open"` permission.

---

# 12. Frontend — TypeScript API Additions (src/lib/api/index.ts)

```typescript
export interface ImportStats {
  total_files_scanned:  number
  imported:             number
  skipped_existing:     number
  skipped_unsupported:  number
  errors:               number
  pairs_detected:       number
  stacks_generated:     number
  logical_photos:       number
  error_log:            string[]
}

export interface IndexingStatus {
  running:    boolean
  total:      number
  processed:  number
  errors:     number
  cancelled:  boolean
  last_stats: ImportStats | null
}

export interface SourceFolder {
  id:   number
  path: string
}

export interface StackSummary {
  stack_id:             number
  logical_photo_count:  number
  earliest_capture:     string | null   // ISO-8601 date
  has_raw:              boolean
  has_jpeg:             boolean
  thumbnail_path:       string | null
}

export function addSourceFolder(slug: string, path: string):          Promise<void>
export function removeSourceFolder(slug: string, folderId: number):   Promise<void>
export function listSourceFolders(slug: string):                      Promise<SourceFolder[]>
export function startIndexing(slug: string):                          Promise<void>
export function cancelIndexing():                                     Promise<void>
export function getIndexingStatus(slug: string):                      Promise<IndexingStatus>
export function listStacks(slug: string):                             Promise<StackSummary[]>
```

---

# 13. Frontend — StackOverview.svelte

The screen has four states. All state is derived from IPC calls; no local guessing.

### State 1 — No source folders

```
← Projects    GemKeep › Iceland 2024   [Esc]

  No source folders attached.

  [ + Add Folder ]
```

### State 2 — Folders attached, not yet indexed

```
← Projects    GemKeep › Iceland 2024   [Esc]

  Source Folders:
  📁 /Users/.../Iceland   [×]
  📁 /Users/.../Drone     [×]

  [ + Add Folder ]

  ─────────────────────────────────────────────
  [ Index Photos ]
```

### State 3 — Indexing in progress

```
← Projects    GemKeep › Iceland 2024   [Esc]

  Source Folders:
  📁 /Users/.../Iceland   [×]   ← remove blocked while indexing

  ─────────────────────────────────────────────
  Indexing…
  ██████████░░░░░░░░░░  340 / 1290

  [ Cancel ]
```

Polling: `getIndexingStatus()` called every 500ms. Progress bar updates reactively.

### State 4 — Indexed (stacks visible)

```
← Projects    GemKeep › Iceland 2024   [Esc]

  Source Folders:
  📁 /Users/.../Iceland   [×]
  [ + Add Folder ]   [ Re-index ]

  ─────────────────────────────────────────────
  Index complete.  Stacks: 240   Logical Photos: 1,280

  ┌────────────┐  ┌────────────┐  ┌────────────┐
  │ [thumb]    │  │ [thumb]    │  │  📷        │  ← placeholder if no thumb
  │ Stack #1   │  │ Stack #2   │  │ Stack #3   │
  │ 6 photos   │  │ 4 photos   │  │ 1 photo    │
  │ Mar 15     │  │ Mar 15     │  │ (no EXIF)  │
  └────────────┘  └────────────┘  └────────────┘
  ...
```

If `errors > 0`: collapsible "▸ Show 3 errors" section below the summary line.

---

# 14. Navigation

`StackOverviewScreen` gains `importStats` (populated after index completes):

```typescript
// Keep field name 'kind' (not 'type') — matches existing codebase throughout
type StackOverviewScreen = {
  kind:         'stack-overview'
  projectSlug:  string
  projectName:  string
}
```

**Keyboard in StackOverview:**

| Key | Action |
|-----|--------|
| `Esc` | Back to Projects |
| `i` | Start indexing (if folders attached and not running) |
| `←` `→` `↑` `↓` | Navigate stack grid (after indexing) |
| `Enter` | Open focused stack → navigate to StackFocus |

StackOverview **must not** auto-navigate. No implicit transitions.

---

# 15. Concurrency Rules

- Only **one indexing process** per project at a time
- `start_indexing` returns an error if `indexing_status.running == true`
- Project switch (`open_project`) sets `cancel_indexing = true` and waits for the
  thread to stop before returning (or returns immediately and lets the thread drain)
- `remove_source_folder` returns error if `running == true`
- UI disables "Remove folder" and "Re-index" buttons while running
- UI ignores rapid "Index" clicks (button disabled during run)

---

# 16. Error Handling

| Scenario | Behaviour |
|----------|-----------|
| File not readable | Log warning, `errors++`, skip |
| EXIF parse failure | Log warning, set all fields = None, continue (solo stack if no time) |
| RAW LibRaw panic | `catch_unwind`, log, skip file |
| No capture_time | Solo logical_photo in its own stack (no mtime fallback) |
| 3+ files with same base | Log warning, all treated as singles (unpaired) |
| Entire folder unreadable | Log warning, continue other folders |
| DB constraint violation | `INSERT OR IGNORE`, counts as `skipped_existing` |
| DB transaction failure | Rollback, set `running = false`, return error |
| Thumbnail generation failure | Log warning, `thumbnail_path = NULL`, continue |
| No source folders attached | Return error "no source folders attached" |
| Indexing cancelled | Return partial stats, set `cancelled = true` |

---

# 17. Negative Testing Scenarios

### Backend

- Index with no folders attached → error returned
- Index same folder twice → no duplicates in DB (skipped_existing = N)
- Add invalid folder path → error returned
- Remove folder while indexing → error returned
- Cancel mid-index → DB in clean state, can re-run
- Corrupt file in batch → rest imported, error counted
- Crash mid-index → re-run succeeds (idempotent)
- Pair with 3 files same base → all singles, warning logged

### UI

- Rapid clicking "Index" → button disabled, second click ignored
- Open different project during indexing → indexing stops cleanly
- Delete project during indexing → (Sprint 5 concern; note in code)

---

# 18. Operation Log Entries

```
[2026-02-20T12:00:01Z] SOURCE_FOLDER_ADDED path=/Users/.../Iceland
[2026-02-20T12:00:05Z] SOURCE_FOLDER_REMOVED path=/Users/.../Drone
[2026-02-20T12:01:00Z] INDEX_STARTED folders=1 burst_gap_secs=3
[2026-02-20T12:01:38Z] INDEX_COMPLETED photos=1280 logical_photos=640 stacks=240 errors=2
[2026-02-20T12:01:38Z] INDEX_ERROR path=/Users/.../bad.cr2 reason="LibRaw: unexpected EOF"
[2026-02-20T12:02:10Z] INDEX_CANCELLED processed=340 total=1290
```

---

# 19. Testing Architecture

Sprint 3 has 10 distinct testing layers. Each layer has a specific test type.
Some layers cannot be automated (Layer 8); those require a documented manual procedure.

```
┌─────────────────────────────────────────────────────────────────┐
│  L10: E2E Journey  (Playwright, Chromium + injected IPC mock)   │
│  tests/e2e/import-flow.spec.ts                                   │
├─────────────────────────────────────────────────────────────────┤
│  L9:  Frontend UI  (Vitest + @testing-library/svelte + jsdom)   │
│  src/lib/components/screens/StackOverview.test.ts               │
├─────────────────────────────────────────────────────────────────┤
│  L8:  Tauri Runtime (asset:// protocol, WebKitWebView)          │
│  ❌ CANNOT be automated — only exists inside real Tauri binary  │
│  → Documented manual checklist: docs/manual-tests.md           │
├─────────────────────────────────────────────────────────────────┤
│  L7:  IPC Commands (Rust ↔ TypeScript contract)                 │
│  src-tauri/src/commands/ipc_tests.rs                            │
├─────────────────────────────────────────────────────────────────┤
│  L6:  Database  (SQLite migrations, CRUD, idempotency)          │
│  Rust integration tests with in-memory SQLite                   │
├─────────────────────────────────────────────────────────────────┤
│  L3:  Thumbnail Generation (LibRaw → resize → 256×256 JPEG)    │
│  Rust unit test: generate from synthetic source → verify output │
├─────────────────────────────────────────────────────────────────┤
│  L2:  EXIF Extraction (kamadak-exif + rsraw)                   │
│  Rust unit test: synthetic JPEG with known EXIF → verify values │
├─────────────────────────────────────────────────────────────────┤
│  L1,L4,L5: Scanner, Pairs, Stacks (pure logic + tmpdir)        │
│  Rust unit tests — fully covered                                │
└─────────────────────────────────────────────────────────────────┘
```

### 19.1 Rust Unit Tests

#### Layer 1 — scanner.rs
- `test_scan_empty_folder`
- `test_scan_jpeg_and_raw`
- `test_scan_no_symlinks`
- `test_scan_permission_error`
- `test_extension_case_insensitive`

#### Layer 2 — exif.rs — CORRECTNESS TESTS (synthetic EXIF)

Tests must verify extracted VALUES, not just "no panic".
Use a synthetic approach: construct a minimal JPEG with known EXIF in-test.

- `test_exif_jpeg_extracts_capture_time` — synthetic JPEG with DateTimeOriginal → assert correct UTC DateTime
- `test_exif_jpeg_extracts_camera_model` — synthetic JPEG with Make+Model → assert correct string
- `test_exif_jpeg_extracts_orientation` — synthetic JPEG with Orientation=6 → assert Some(6)
- `test_exif_jpeg_no_exif` — minimal JPEG without EXIF → all fields None, no panic
- `test_exif_jpeg_corrupt` — truncated JPEG bytes → all fields None, no panic

External cross-validation (manual/debugging): `exiftool <file>` for ground truth

#### Layer 3 — thumbnails.rs — OUTPUT VERIFICATION

Tests must verify the OUTPUT FILE, not just that the function returns Ok.

- `test_thumbnail_generated_is_256x256` — generate thumbnail from synthetic JPEG source, read output file with `image::open()`, assert `img.width() == 256 && img.height() == 256`
- `test_thumbnail_is_valid_jpeg` — output file starts with JPEG magic bytes FF D8
- `test_thumbnail_path_created` — output file exists at expected path
- `test_thumbnail_nonexistent_source` — source file missing → function returns without panic, no output file created

External cross-validation (manual/debugging): `identify <thumb.jpg>` (ImageMagick)

#### Layer 4 — pairs.rs
- `test_pair_cr2_jpeg`, `test_pair_case_insensitive`, `test_pair_no_match`
- `test_pair_jpeg_only`, `test_pair_raw_only`, `test_pair_three_way`, `test_pair_cross_directory`

#### Layer 5 — stacks.rs
- `test_stack_burst_3s`, `test_stack_gap`, `test_stack_single`
- `test_stack_no_exif_solo`, `test_stack_mixed`, `test_stack_configurable_gap`

### 19.2 Rust Integration Tests

#### Layer 6 — Database (pipeline.rs integration)
- `test_pipeline_full_run`, `test_pipeline_idempotent`, `test_pipeline_partial_errors`
- `test_pipeline_empty_folder`, `test_pipeline_pairs_persisted`
- `test_pipeline_stacks_persisted`, `test_pipeline_cancel`

#### Layer 7 — IPC Commands (ipc_tests.rs)
- `test_create_project_and_list`, `test_open_project`, `test_ipc_open_then_list_no_freeze`

External cross-validation (manual): `sqlite3 ~/.gem-keep/projects/{slug}/project.db`
  `.tables`, `SELECT * FROM photos LIMIT 5`, `SELECT COUNT(*) FROM stacks`

### 19.3 Frontend Unit Tests (Vitest)

File: `src/lib/components/screens/StackOverview.test.ts`
Mock: `src/test/setup.ts` — invoke() + convertFileSrc() both mocked

- STATE 1: renders no-folders state
- STATE 2: auto-starts indexing when folders present + no stacks
- STATE 2: does NOT auto-start when stacks already exist
- STATE 2: does NOT auto-start when thumbnails_running=true
- STATE 3: progress bar and cancel visible during EXIF scan phase
- STATE 4: stack grid rendered with correct card count
- STATE 4 + thumbnails_running: "Generating thumbnails…" banner visible
- STATE 4 + thumbnails_running: progress indicator is NOT full-width (not w-full)
  WHY: a full-width bar is visually indistinguishable from "100% complete"
- STATE 4: renders img element with asset:// URL when thumbnail_path is set
- STATE 4: renders placeholder icon when thumbnail_path is null
- Keyboard: r key triggers re-index, i key triggers index

Also: `src/lib/api/index.test.ts` — getThumbnailUrl calls convertFileSrc correctly
Also: `src/test/tauri-config.test.ts` — asset protocol scope is an absolute pattern

### 19.4 E2E Tests (Playwright)

File: `tests/e2e/import-flow.spec.ts`
Environment: Playwright + Chromium. IPC mocked via `page.addInitScript()`.
NOTE: Chromium has no `asset://` protocol handler. Thumbnail SRC correctness
is verified at the unit level; E2E verifies the user journey and IPC calls.

#### Journey 1 — STATE 1 empty state
1. Create project → navigate to StackOverview → verify STATE 1 (no folders)
2. Verify "No source folders attached." and Add Folder button present
3. Verify no progress bar, no stack grid

#### Journey 2 — Auto-start
1. Open project where IPC mock returns folders=[FOLDER_A], stacks=[], status=IDLE
2. Verify start_indexing is called automatically (auto-start)

#### Journey 3 — STATE 3 progress
1. With folders present and auto-start → verify progress bar visible during indexing
2. Verify no crash at any state

#### Journey 4 — STATE 4 stack grid
1. Mock returns stacks=[S1, S2, S3], status=DONE
2. Verify stack cards are visible

#### Journey 5 — Thumbnail banner is not a static full-width bar
1. Mock returns thumbnails_running=true
2. Verify "Generating thumbnails…" visible
3. Verify the animated element does NOT have class `w-full`

### 19.5 Manual Tests

Documented in: `docs/manual-tests.md`

Trigger: Run manual tests after any change to:
- `src-tauri/tauri.conf.json` (asset protocol scope)
- `src-tauri/capabilities/` (permissions)
- thumbnail path format (`thumbnail_path` returned by `list_stacks`)
- `getThumbnailUrl` / `convertFileSrc` usage

Tests cover:
- Asset protocol: thumbnail images load without network errors (Layer 8)
- Thumbnail visual quality: not blurry, orientation correct
- End-to-end timing: indexing progress visible, no "stuck at 100%" appearance

---

# 20. Definition of Done

- [ ] `rsraw` crate compiles (libraw-dev in ~/.local)
- [ ] `kamadak-exif` correctly extracts JPEG EXIF (test with real fixture)
- [ ] Pair detection correct for CR2+JPG (same base, same dir)
- [ ] Burst detection uses `burst_gap_secs` from config.json
- [ ] Photos with no capture_time → solo stacks (confirmed by test)
- [ ] `start_indexing` runs in background thread; IPC returns immediately
- [ ] `get_indexing_status` reflects live progress
- [ ] Cancel stops the background thread cleanly
- [ ] Project switch during indexing stops indexing safely
- [ ] `add_source_folder` / `remove_source_folder` / `list_source_folders` work
- [ ] `list_stacks` returns correct `StackSummary` rows in order
- [ ] Representative thumbnails generated into `cache/thumbnails/`
- [ ] StackOverview shows all 4 states correctly
- [ ] Stack grid renders (thumbnail or placeholder, count, date)
- [ ] Arrow-key navigation + Enter to StackFocus works
- [ ] Native folder picker opens and returns path (Linux)
- [ ] All Rust unit + integration tests pass (`cargo test`)
- [ ] All Vitest tests pass (`npm test`)
- [ ] `cargo clippy -- -D warnings` clean
- [ ] `cargo fmt` clean
- [ ] EXIF correctness: synthetic JPEG tests pass (capture_time, camera_model, orientation)
- [ ] Thumbnail output: 256×256 JPEG verified by readback in Rust test
- [ ] UI progress bar: progress indicator does NOT use `w-full` when thumbnails generating
- [ ] E2E import flow: full journey in `import-flow.spec.ts` passes
- [ ] Manual tests completed: see `docs/manual-tests.md` checklist
- [ ] Committed: `feat: sprint-3 photo import, pairs, stacks, stack overview grid`

---

# 21. Out of Scope

| Feature | Sprint |
|---------|--------|
| Thumbnail in-memory LRU / prefetch | Sprint 4 |
| Full-res RAW decode | Sprint 4 |
| Stack grid filters (date range, RAW/JPEG, size) | Sprint 5 |
| Burst gap UI (settings panel) | Sprint 5 |
| Stack merge / split | Sprint 8 |
| Re-stack after changing burst gap | Sprint 5 |
| Expanded RAW format list (NEF, RAF, RW2…) | Near-term, low effort |
| HEIF / PNG / TIFF support | TBD |
