# GemKeep Low-Level Design

Code-level reference for developers modifying GemKeep. Every section references
actual source files with line numbers (accurate as of sprint-7 branch, 2026-03-07).

---

## Table of Contents

1. [Application State](#1-application-state)
2. [Database Schema](#2-database-schema)
3. [Import Pipeline](#3-import-pipeline)
4. [EXIF Extraction](#4-exif-extraction)
5. [Thumbnail Generation](#5-thumbnail-generation)
6. [RAW+JPEG Pairing](#6-rawjpeg-pairing)
7. [Burst Stack Assignment](#7-burst-stack-assignment)
8. [Indexing State Machine](#8-indexing-state-machine)
9. [IPC Command Reference](#9-ipc-command-reference)
10. [Frontend Architecture](#10-frontend-architecture)
11. [Navigation State Machine](#11-navigation-state-machine)
12. [Project & Config Management](#12-project--config-management)
13. [Decision Engine](#13-decision-engine)

---

## 1. Application State

**File:** `src-tauri/src/state.rs:9-21`

```rust
pub struct AppState {
    pub db: Mutex<Option<Connection>>,                  // Per-project SQLite, WAL mode
    pub active_project: Mutex<Option<Project>>,          // Currently open project metadata
    pub gemkeep_home: PathBuf,                           // ~/.gem-keep
    pub indexing_status: Arc<Mutex<IndexingStatus>>,     // Shared with background thread
    pub cancel_indexing: Arc<AtomicBool>,                // Signal to stop import
    pub pause_indexing: Arc<AtomicBool>,                 // Signal to pause EXIF step
    pub thumbnails_done_counter: Arc<AtomicUsize>,       // Lock-free thumbnail progress
}
```

**Lock order (enforced by convention):** Always acquire `db` before `active_project`.
Reversing this order risks deadlock. See `state.rs:8` comment.

**Threading model:** The main Tauri thread holds the `AppState`. Background indexing
threads get `Arc` clones of the atomic/mutex fields. The background thread opens its
own `Connection` because `rusqlite::Connection` is `!Send` (`commands/import.rs:288-306`).

---

## 2. Database Schema

**File:** `src-tauri/src/db/migrations.rs:5-118`

Connection settings (`db/connection.rs:1-6`):
- `PRAGMA journal_mode=WAL` -- concurrent readers during writes
- `PRAGMA busy_timeout=5000` -- 5s retry on lock contention

Schema version: 4 (set at `migrations.rs:113`).

### Tables

| Table | Columns | Purpose |
|-------|---------|---------|
| `schema_version` | `version INTEGER` | Migration tracking |
| `projects` | `id PK, name TEXT, slug TEXT UNIQUE, created_at TEXT, last_opened_at TEXT` | Project registry (1 row per project DB) |
| `source_folders` | `id PK, project_id FK, path TEXT, added_at TEXT` | Watched directories |
| `stacks` | `id PK, project_id FK, created_at TEXT` | Burst group containers |
| `logical_photos` | `id PK, project_id FK, representative_photo_id FK→photos, stack_id FK→stacks, current_status TEXT DEFAULT 'undecided'` | Culling unit (1 decision per LP) |
| `photos` | `id PK, path TEXT UNIQUE, format TEXT, capture_time TEXT, orientation INTEGER, camera_model TEXT, lens TEXT, logical_photo_id FK→logical_photos, aperture REAL, shutter_speed TEXT, iso INTEGER, focal_length REAL, exposure_comp REAL` | Physical files on disk |
| `rounds` | `id PK, project_id FK, scope TEXT, scope_id INTEGER, round_number INTEGER, state TEXT DEFAULT 'open', created_at TEXT, committed_at TEXT` | Decision rounds (scoped to stack) |
| `decisions` | `id PK, logical_photo_id FK, round_id FK, action TEXT, timestamp TEXT` | Individual keep/eliminate actions |
| `merges` | `id PK, project_id FK, merged_stack_id INTEGER, original_stack_ids TEXT(JSON), timestamp TEXT, undone INTEGER DEFAULT 0` | Merge history for undo |
| `stack_transactions` | `id PK, project_id FK, action TEXT, details TEXT(JSON), created_at TEXT` | Audit log of structural changes |
| `manual_merges` | `id PK, project_id FK, merge_group TEXT(JSON), created_at TEXT, active INTEGER DEFAULT 1` | Preserved across restack |

### Indexes

```sql
idx_photos_capture_time    ON photos(capture_time)
idx_logical_stack          ON logical_photos(stack_id)
idx_logical_project        ON logical_photos(project_id)
idx_stack_tx_project       ON stack_transactions(project_id, created_at DESC)
idx_manual_merges_project  ON manual_merges(project_id, active)
```

### Entity Relationships

```
projects 1───N source_folders
    │
    ├──1───N stacks
    │           │
    │           └──1───N logical_photos
    │                       │
    │                       └──1───N photos  (1 for single, 2 for RAW+JPEG pair)
    │
    ├──1───N rounds
    │           │
    │           └──1───N decisions ──→ logical_photos
    │
    ├──1───N merges
    ├──1───N stack_transactions
    └──1───N manual_merges
```

---

## 3. Import Pipeline

**Entry point:** `import/pipeline.rs:44` `run_pipeline()`
**Orchestrator:** `import/pipeline.rs:73` `run_pipeline_inner()`

### Data Flow

```
                              ┌─────────────────────┐
                              │  Source Folders      │
                              │  (filesystem paths)  │
                              └──────────┬──────────┘
                                         │
                    STEP 1: scan_directory() [scanner.rs:16]
                                         │
                              ┌──────────▼──────────┐
                              │  Vec<ScannedPath>    │
                              │  {path, format}      │
                              └──────────┬──────────┘
                                         │
                    STEP 2: idempotency check [pipeline.rs:111-126]
                            load existing paths from DB
                            filter out already-imported
                                         │
                    STEP 3: EXIF extraction [pipeline.rs:128-194]
                            extract_exif() per file
                            pause/cancel checked per file
                                         │
                              ┌──────────▼──────────┐
                              │  Vec<ScannedFile>    │
                              │  (new files only)    │
                              └──────────┬──────────┘
                                         │
                    STEP 4: merge existing [pipeline.rs:202-205]
                            load_existing_scanned_files()
                            chain with new files
                                         │
                              ┌──────────▼──────────┐
                              │  Vec<ScannedFile>    │
                              │  (all files)         │
                              └──────────┬──────────┘
                                         │
                    STEP 5: detect_pairs() [pairs.rs:34]
                            group by (dir, base_name)
                                         │
                              ┌──────────▼──────────┐
                              │  Vec<LogicalGroup>   │
                              │  {jpeg?, raw?, pair} │
                              └──────────┬──────────┘
                                         │
                    STEP 6: assign_stacks_by_burst() [stacks.rs:10]
                            consecutive-gap algorithm
                                         │
                              ┌──────────▼──────────┐
                              │  Vec<(LogicalGroup,  │
                              │       stack_index)>  │
                              └──────────┬──────────┘
                                         │
                    STEP 7: persist_groups_to_db() [pipeline.rs:377]
                            clear old stacks → insert stacks →
                            insert photos → insert logical_photos →
                            link photos to LPs
                                         │
                              ┌──────────▼──────────┐
                              │  DB rows written     │
                              │  status.running=false│
                              │  thumbnails_running  │
                              │    = true            │
                              └──────────┬──────────┘
                                         │
                    STEP 8: thumbnail generation [pipeline.rs:306-366]
                            rayon par_iter over targets
                            emit thumbnail-ready events
                                         │
                              ┌──────────▼──────────┐
                              │  <cache>/thumbnails/ │
                              │  <lp_id>.jpg files   │
                              └─────────────────────┘
```

### Key Structs

**`ScannedPath`** (`import/scanner.rs:8-11`):
- `path: PathBuf` -- absolute path on disk
- `format: PhotoFormat` -- Jpeg or Raw

**`ScannedFile`** (`photos/model.rs:20-32`):
- `path`, `format` -- from ScannedPath
- `capture_time: Option<DateTime<Utc>>` -- from EXIF DateTimeOriginal
- `camera_model: Option<String>` -- "Make Model" deduplicated
- `lens: Option<String>` -- from LensModel tag
- `orientation: Option<u16>` -- EXIF orientation 1-8
- `base_name: String` -- lowercase filename stem, used for pair matching
- `dir: PathBuf` -- parent directory, used for pair matching

**`LogicalGroup`** (`import/pairs.rs:4-10`):
- `jpeg: Option<ScannedFile>` -- the JPEG half (if present)
- `raw: Option<ScannedFile>` -- the RAW half (if present)
- `is_pair: bool` -- true only when both jpeg and raw are Some
- `representative()` returns JPEG if available, else RAW (`pairs.rs:15-21`)

**`PipelineConfig`** (`import/pipeline.rs:20-25`):
- `project_id`, `project_dir`, `folder_paths`, `burst_gap_secs`

**`PipelineControls`** (`import/pipeline.rs:28-34`):
- `status: Arc<Mutex<IndexingStatus>>`, `cancel: Arc<AtomicBool>`,
  `pause: Arc<AtomicBool>`, `app_handle: Option<AppHandle>`,
  `thumbnails_done_counter: Arc<AtomicUsize>`

**`ImportStats`** (`photos/model.rs:34-48`):
- Accumulates pipeline results: `total_files_scanned`, `imported`,
  `skipped_existing`, `errors`, `pairs_detected`, `stacks_generated`,
  `logical_photos`, `error_log` (capped at 100), `cancelled`

**`IndexingStatus`** (`photos/model.rs:50-67`):
- Polled by frontend via `get_indexing_status` IPC:
  `running`, `thumbnails_running`, `total`, `processed`, `errors`,
  `cancelled`, `paused`, `last_stats`, `thumbnails_total`, `thumbnails_done`

**`PhotoFormat`** (`photos/model.rs:3-8`): enum `Jpeg | Raw`

### Cancel & Pause

- Cancel: `AtomicBool` checked at every step boundary and inside EXIF loop
  (`pipeline.rs:91`, `138`, `196`, `217`, `243`, `307`, `336`)
- Pause: spin-wait with 100ms sleep, only in EXIF extraction step
  (`pipeline.rs:143-148`)
- Cancel clears pause first (`commands/import.rs:356`)

---

## 4. EXIF Extraction

**File:** `src-tauri/src/import/exif.rs`

### Dispatch

```
extract_exif(path, format)          [exif.rs:309-314]
  ├── PhotoFormat::Jpeg → extract_jpeg_exif()  [exif.rs:34]
  └── PhotoFormat::Raw  → extract_raw_exif()   [exif.rs:198]

extract_metadata(path)              [exif.rs:322-333]
  └── auto-detects format from extension
```

### ExifData struct (`exif.rs:4-16`)

```rust
pub struct ExifData {
    pub capture_time: Option<DateTime<Utc>>,     // DateTimeOriginal
    pub camera_model: Option<String>,             // "Make Model" deduplicated
    pub lens: Option<String>,                     // LensModel
    pub orientation: Option<u16>,                 // 1-8
    pub aperture: Option<f64>,                    // FNumber as f64
    pub shutter_speed: Option<String>,            // formatted: "1/250" or "2.5s"
    pub iso: Option<u32>,                         // PhotographicSensitivity
    pub focal_length: Option<f64>,                // mm
    pub exposure_comp: Option<f64>,               // ExposureBiasValue (EV)
}
```

### JPEG path (`extract_jpeg_exif_inner`, exif.rs:44-105)

- Library: `kamadak-exif` (TIFF/EXIF APP1 reader)
- Wrapped in `catch_unwind` -- never panics, returns `ExifData::default()` on error
- Make/Model deduplication (`exif.rs:66-81`): if Model already starts with Make's
  first word, omit Make (e.g., "NIKON CORPORATION" + "NIKON D850" -> "NIKON D850")
- DateTime parsing: `parse_exif_datetime` (`exif.rs:120-130`), converts
  "YYYY:MM:DD HH:MM:SS" to UTC DateTime
- ISO handling: accepts both `Short` and `Long` EXIF value types (`exif.rs:187-194`)

### RAW path (`extract_raw_exif_inner`, exif.rs:208-306)

- Library: `rawler` (pure Rust RAW decoder)
- Same `catch_unwind` + deduplication pattern
- Reads MakerNotes for lens info (Canon/Nikon) that kamadak-exif cannot access
- Same `parse_exif_datetime` for timestamp normalization

### Shutter speed formatting (`exif.rs:20-30`)

- `< 1.0s` -> fraction: `"1/{round(1/val)}"` (e.g., 0.004 -> "1/250")
- `>= 1.0s` -> decimal: `"{val:.1}s"` (e.g., 2.5 -> "2.5s")

---

## 5. Thumbnail Generation

**File:** `src-tauri/src/import/thumbnails.rs`

### Decision Tree

```
generate_thumbnail(source, format, lp_id, cache, orientation)  [thumbnails.rs:6-32]
  │
  ├── catch_unwind wrapper (never panics)
  │
  ├── PhotoFormat::Jpeg → generate_jpeg_thumbnail()  [thumbnails.rs:163-209]
  │     │
  │     ├── Tier 1: EXIF IFD1 embedded thumbnail  [thumbnails.rs:170-192]
  │     │     extract_exif_embedded_thumbnail()  [thumbnails.rs:64-90]
  │     │     Read JPEGInterchangeFormat + JPEGInterchangeFormatLength
  │     │     from IFD1 (In::THUMBNAIL), slice exif.buf()
  │     │     REJECT if short_side < 200px (blurry upscale prevention)
  │     │     → generate_thumbnail_from_image() if accepted
  │     │
  │     ├── Tier 2: turbojpeg DCT 1/8 downscale  [thumbnails.rs:195-197]
  │     │     generate_jpeg_thumbnail_turbo()  [thumbnails.rs:254-318]
  │     │     Reads full JPEG, decompresses at 1/8 resolution
  │     │     (e.g. 6000x4000 → 750x500), ~50x faster than full decode
  │     │     → generate_thumbnail_from_image()
  │     │
  │     └── Tier 3: full decode (last resort)  [thumbnails.rs:200-208]
  │           image::open() → generate_thumbnail_from_image()
  │
  └── PhotoFormat::Raw → generate_raw_thumbnail()  [thumbnails.rs:211-221]
        extract_raw_embedded_jpeg()  [thumbnails.rs:320-330]
        rsraw extracts largest embedded JPEG preview
        → image::load_from_memory() → generate_thumbnail_from_image()
```

### Common resize path (`generate_thumbnail_from_image`, thumbnails.rs:120-140)

1. `resize_to_fill(256, 256, Lanczos3)` -- crop-to-fill, no letterboxing
2. `apply_orientation(resized, orientation)` -- EXIF rotation/flip
3. Save to `<cache_dir>/<logical_photo_id>.jpg`

### Orientation transform (`apply_orientation`, thumbnails.rs:102-113)

| EXIF Value | Transform |
|------------|-----------|
| 1 (or None) | no-op |
| 2 | flip horizontal |
| 3 | rotate 180 |
| 4 | flip vertical |
| 5 | flip-h + rotate 270 |
| 6 | rotate 90 CW |
| 7 | flip-h + rotate 90 |
| 8 | rotate 270 CW |

### Adaptive Strategy (`thumbnail_strategy`, thumbnails.rs:231-249)

| Batch Size | EXIF Fast Path | Max Threads |
|------------|---------------|-------------|
| 1-50 | enabled | all available (cores-2, min 1) |
| 51-500 | disabled | min(available, 6) |
| 501+ | disabled | min(available, 4) |

Thread capping (`import/util.rs:8-19`): `capped_num_threads()` returns
`cores - 2` (min 1) to prevent GTK event loop starvation.

### Resume flow (`commands/import.rs:418-522`)

`resume_thumbnails` command:
1. `find_missing_thumbnail_targets()` (`pipeline.rs:532-558`) diffs all LP IDs
   against `cached_thumbnail_ids()` (single readdir)
2. Spawns background thread with rayon pool
3. Emits `thumbnail-ready` events per completed thumbnail

---

## 6. RAW+JPEG Pairing

**File:** `src-tauri/src/import/pairs.rs`

### Algorithm (`detect_pairs`, pairs.rs:34-50)

1. Group all `ScannedFile`s by key `(dir: PathBuf, base_name: String)`
2. For each group, dispatch by member count:
   - **1 file** -> solo `LogicalGroup` (is_pair=false)
   - **2 files** -> check if one JPEG + one RAW:
     - Yes -> paired `LogicalGroup` (is_pair=true, jpeg=Some, raw=Some)
     - No (e.g. two JPEGs) -> two solo groups + warning
   - **3+ files** -> all become solo groups + warning (`pairs.rs:93-104`)
3. `base_name` is computed during EXIF extraction step (`pipeline.rs:164-169`):
   lowercased filename stem, enabling case-insensitive matching
4. Cross-directory files with the same base_name are NOT paired (different `dir` key)

### Representative selection (`pairs.rs:15-21`)

JPEG is always preferred as the representative. Thumbnail is generated from
the representative file. For RAW-only groups, the RAW file is representative.

---

## 7. Burst Stack Assignment

**File:** `src-tauri/src/import/stacks.rs`

### Consecutive-Gap Algorithm (`assign_stacks_clean`, stacks.rs:10-50)

```
Input:  Vec<LogicalGroup>
Output: Vec<(LogicalGroup, stack_index: usize)>

1. Partition into timed (has capture_time) and untimed
2. Sort timed by capture_time ascending
3. Walk sorted list:
   - First group → stack_index = 0
   - Each subsequent group:
     gap = abs(current_time - previous_time)
     if gap > burst_gap_secs → stack_index += 1
     else → same stack_index
4. Each untimed group → stack_index += 1 (solo stack)
```

**Critical invariant:** The algorithm compares CONSECUTIVE pairs, not distance
from the first photo in a stack. Five photos each 2s apart (total span 8s)
with burst_gap=3 all land in one stack because every consecutive gap is 2s <= 3s.
This is verified by `test_stack_consecutive_not_from_stack_origin` (stacks.rs:176-200).

### Restack (`pipeline.rs:567-699`)

`restack_from_existing_photos()` re-applies burst grouping without re-scanning:
1. Loads existing `logical_photos` with capture times
2. Clears stacks (preserves LP IDs and therefore thumbnail filenames)
3. Applies same consecutive-gap algorithm to LP rows
4. UPDATEs each LP's `stack_id` in place
5. Seeds new stack IDs above the previous max to avoid SQLite rowid reuse

Merge-aware restack: `repository::restack_merge_aware()` preserves
`manual_merges` records across restacking.

---

## 8. Indexing State Machine

### Status Transitions

```
                    start_indexing()
                         │
            ┌────────────▼────────────┐
            │   running=true          │
            │   thumbnails_running=   │
            │     false               │◄──── pause_indexing()
            │   paused=false          │      sets paused=true
            │                         │      (spin-wait in EXIF step)
            │   STEP 1-7 executing    │
            │   processed increments  │──── resume_indexing()
            │                         │      clears paused
            └────────────┬────────────┘
                         │
              Step 7 complete
              (DB writes done)
                         │
            ┌────────────▼────────────┐
            │   running=false         │
            │   thumbnails_running=   │
            │     true                │
            │                         │
            │   STEP 8: rayon pool    │
            │   thumbnails_done       │
            │   increments atomically │
            └────────────┬────────────┘
                         │
              All thumbnails done
              (or cancel)
                         │
            ┌────────────▼────────────┐
            │   running=false         │
            │   thumbnails_running=   │
            │     false               │
            │   last_stats populated  │
            └─────────────────────────┘

    cancel_indexing() at any point:
      → sets cancelled=true
      → clears pause
      → pipeline returns early at next check
```

### Guard in `start_indexing` (`commands/import.rs:201-209`)

Rejects new indexing if `status.running || status.thumbnails_running`.
This prevents launching a second rayon pool while thumbnails are still
generating from a previous run.

### Frontend Polling

- `get_indexing_status` IPC: returns clone of status + live
  `thumbnails_done_counter` value (`commands/import.rs:382-391`)
- Frontend polls every 500ms during indexing
- `thumbnail-ready` Tauri event triggers debounced (300ms) thumbnail refresh

---

## 9. IPC Command Reference

All commands registered in `src-tauri/src/lib.rs:21-52`.
All return `Result<T, String>` at the IPC boundary.

### Project Management

| Command | Handler | Description |
|---------|---------|-------------|
| `suggest_slug` | `commands/projects.rs:37` | Generate URL-safe slug from project name |
| `create_project` | `commands/projects.rs:43` | Create dir, DB, run migrations, set active |
| `list_projects` | `commands/projects.rs:87` | Scan `~/.gem-keep/projects/`, open each DB |
| `open_project` | `commands/projects.rs:123` | Open DB, run migrations, set active, update config |
| `get_last_project` | `commands/projects.rs:128` | Read `config.json`, auto-open last project |
| `delete_project` | `commands/projects.rs:146` | Clear state if active, `remove_dir_all`, update config |

### Source Folders

| Command | Handler | Description |
|---------|---------|-------------|
| `add_source_folder` | `commands/import.rs:85` | Validate path exists, insert DB row |
| `remove_source_folder` | `commands/import.rs:135` | Block during indexing, delete DB row |
| `list_source_folders` | `commands/import.rs:181` | Return `Vec<SourceFolderRow>` |
| `expand_source_scopes` | `commands/import.rs:122` | Expand Tauri asset protocol for source dirs |

### Indexing

| Command | Handler | Description |
|---------|---------|-------------|
| `start_indexing` | `commands/import.rs:195` | Clear cache, spawn background thread, run pipeline |
| `cancel_indexing` | `commands/import.rs:353` | Set cancel flag, clear pause |
| `pause_indexing` | `commands/import.rs:362` | Set pause flag |
| `resume_indexing` | `commands/import.rs:372` | Clear pause flag |
| `get_indexing_status` | `commands/import.rs:382` | Return status + live thumbnail counter |
| `resume_thumbnails` | `commands/import.rs:418` | Generate missing thumbnails only |

### Data Retrieval

| Command | Handler | Description |
|---------|---------|-------------|
| `list_stacks` | `commands/import.rs:575` | Single JOIN query + readdir for thumbnails |
| `list_logical_photos` | `commands/import.rs:614` | Photos in stack + thumbnail enrichment |
| `get_photo_detail` | `commands/decisions.rs:171` | Full photo detail with camera params + file paths |
| `get_stack_decisions` | `commands/decisions.rs:188` | Decision status for all LPs in a stack |

### Decisions

| Command | Handler | Description |
|---------|---------|-------------|
| `make_decision` | `commands/decisions.rs:41` | Record keep/eliminate, auto-create round |
| `undo_decision` | `commands/decisions.rs:111` | Remove last decision for a photo in current round |
| `get_round_status` | `commands/decisions.rs:141` | Counts: decided, kept, eliminated, undecided |
| `commit_round` | `commands/decisions.rs:158` | Seal round (no more decisions allowed) |

### Stack Operations

| Command | Handler | Description |
|---------|---------|-------------|
| `merge_stacks` | `commands/stacks.rs:38` | Merge 2+ stacks, log transaction, record manual_merge |
| `undo_last_merge` | `commands/stacks.rs:53` | Reverse most recent merge from transaction log |
| `list_stack_transactions` | `commands/stacks.rs:62` | Audit trail of merge/split/restack events |

### Config

| Command | Handler | Description |
|---------|---------|-------------|
| `get_burst_gap` | `commands/import.rs:527` | Read `burst_gap_secs` from config |
| `set_burst_gap` | `commands/import.rs:533` | Write `burst_gap_secs` to config |
| `restack` | `commands/import.rs:542` | Re-apply burst grouping with merge preservation |

---

## 10. Frontend Architecture

### Technology

- Svelte 5 with runes (`$state`, class-based singletons)
- TypeScript throughout
- Tailwind CSS for styling
- All IPC calls centralized in `src/lib/api/index.ts`

### IPC Layer (`src/lib/api/index.ts`)

28 exported async functions wrapping `invoke()`. TypeScript interfaces mirror
Rust serde structs. `convertFileSrc()` converts filesystem paths to Tauri
`asset://` URLs for thumbnail display.

### Component Hierarchy

```
App.svelte
  └── AppShell
        ├── ProjectList          (kind: 'project-list')
        ├── StackOverview        (kind: 'stack-overview')
        │     └── grid of stack cards with thumbnails
        ├── StackFocus           (kind: 'stack-focus')
        │     └── grid of logical photo thumbnails
        │           with DecisionIndicator overlays
        └── SingleView           (kind: 'single-view')
              └── full-screen photo with camera params overlay
```

### Keyboard System (3 layers)

**Global** (App.svelte):
- `?` -- toggle HelpOverlay
- `Esc` -- back() or close overlay

**StackOverview**:
- Arrow keys / `hjkl` -- grid navigation
- `Shift+Arrow` -- multi-select for merge
- `m` / `M` -- merge selected stacks
- `Ctrl+Z` -- undo last merge
- `Enter` -- navigate to StackFocus

**StackFocus**:
- Arrow keys / `hjkl` -- grid navigation
- `y` -- keep, `x` -- eliminate, `u` -- undo decision
- `Tab` -- jump to next undecided photo
- `Ctrl+Enter` -- commit round
- `Enter` -- navigate to SingleView
- `Esc` -- back to StackOverview

**SingleView**:
- Left/Right arrows -- navigate between photos in stack
- `y` / `x` / `u` -- decisions
- `i` / `I` -- toggle camera parameters overlay

### Polling

- Indexing progress: 500ms interval polling `get_indexing_status`
- Thumbnail refresh: Tauri `thumbnail-ready` event, debounced 300ms
- State: per-component via `$state`, no shared data store, fresh IPC on mount

---

## 11. Navigation State Machine

**File:** `src/lib/stores/navigation.svelte.ts`

### Screens & Transitions

```
  project-list ──(open project)──► stack-overview
       ▲                                │
       │                          (Enter on stack)
  (Esc/back)                            │
       │                                ▼
       │                          stack-focus
       │                                │
       │                          (Enter on photo)
       │                                │
       │                                ▼
       │                          single-view
       │                                │
       └────────────(Esc chain)─────────┘
```

### Screen Types (`navigation.svelte.ts:4-12`)

```typescript
type ProjectListScreen = {
    kind: 'project-list';
    skipAutoOpen?: boolean;              // prevent re-opening last project
    resumeProject?: { slug, name };      // show project in list as selected
}
type StackOverviewScreen = {
    kind: 'stack-overview';
    projectSlug: string; projectName: string;
}
type StackFocusScreen = {
    kind: 'stack-focus';
    projectSlug: string; stackId: number; projectName: string;
}
type SingleViewScreen = {
    kind: 'single-view';
    projectSlug: string; stackId: number; photoId: number; projectName: string;
}
```

### Back logic (`navigation.svelte.ts:24-38`)

- `single-view` -> `stack-focus` (same stack)
- `stack-focus` -> `stack-overview` (same project)
- `stack-overview` -> `project-list` (with `skipAutoOpen` + `resumeProject`)
- `project-list` -> no-op

### Scroll Restore

`stackOverviewFocusIndex: number | null` (`navigation.svelte.ts:18`):
- Set when leaving StackOverview (Enter key / card click)
- Read and cleared in `loadAll()` after data loads
- Scroll applied after `tick()` (ensures DOM is flushed after `initialLoading=false`)

---

## 12. Project & Config Management

### Filesystem Layout

```
~/.gem-keep/
  ├── config.json                       # Global config
  └── projects/
      └── <slug>/
          ├── project.db                # Per-project SQLite database
          ├── cache/
          │   └── thumbnails/
          │       ├── 1.jpg             # <logical_photo_id>.jpg
          │       ├── 2.jpg
          │       └── ...
          └── logs/
              └── operation.log         # Append-only audit trail
```

### Config (`projects/manager.rs:11-25`)

```rust
pub struct Config {
    pub last_opened_slug: Option<String>,   // Auto-open on launch
    pub burst_gap_secs: u64,                // Default: 3 (custom Default impl)
}
```

Stored at `~/.gem-keep/config.json`. Written atomically via `.tmp` + rename
(`manager.rs:52-58`).

### Project Lifecycle

**Create** (`commands/projects.rs:43-84`):
1. Generate unique slug from name
2. Create directory `~/.gem-keep/projects/<slug>/`
3. Open SQLite DB, run migrations
4. Insert project row, create cache/log subdirs
5. Update `config.json` with `last_opened_slug`
6. Set `AppState.db` and `AppState.active_project`

**Open** (`commands/projects.rs:7-34`):
1. Verify project dir exists
2. Open DB, run migrations
3. Read project row, update `last_opened_at`
4. Update `config.json`, set AppState

**Delete** (`commands/projects.rs:146-175`):
1. If active project, clear `AppState.db` and `active_project` (lock order: db first)
2. `remove_dir_all` the project directory
3. Clear `last_opened_slug` from config if it matches

**List** (`commands/projects.rs:87-120`):
1. Scan `~/.gem-keep/projects/` for subdirectories
2. Open each `project.db`, read the project row
3. Return aggregated list (does not set AppState)

### Asset Protocol Scope

Tauri 2.x `require_literal_leading_dot: true` means `/**` silently skips
`.gem-keep`. The `tauri.conf.json` scope must use `$HOME/.gem-keep/**` with
the literal dot component.

Runtime expansion for source folders: `expand_source_scopes` command calls
`asset_protocol_scope().allow_directory()` for each source folder path
(`commands/import.rs:55-63`).

---

## 13. Decision Engine

**Files:** `src-tauri/src/decisions/engine.rs`, `src-tauri/src/decisions/model.rs`

### Models (`decisions/model.rs`)

**`DecisionAction`** (`model.rs:2-7`): enum `Keep | Eliminate`

**`DecisionResult`** (`model.rs:19-31`): returned from `make_decision`:
- `decision_id`, `round_id`, `action`, `current_status`, `round_auto_created`

**`RoundStatus`** (`model.rs:34-45`): summary for a stack's current round:
- `round_id`, `round_number`, `state` ("open"/"committed"),
  `total_photos`, `decided`, `kept`, `eliminated`, `undecided`, `committed_at`

**`PhotoDetail`** (`model.rs:49-68`): full photo info for SingleView:
- All LogicalPhotoSummary fields plus `current_status`, camera params
  (`aperture`, `shutter_speed`, `iso`, `focal_length`, `exposure_comp`),
  and file paths (`jpeg_path`, `raw_path`)

**`PhotoDecisionStatus`** (`model.rs:72-76`): per-photo status for badge overlay

### Decision Flow

```
make_decision(slug, logical_photo_id, "keep"|"eliminate")
  │
  ├── Resolve stack_id from logical_photos table
  ├── Check most recent round is NOT committed
  ├── find_or_create_round() — auto-creates Round 1 if none exists
  ├── record_decision() — INSERT into decisions + UPDATE logical_photos.current_status
  └── Return DecisionResult with new status

undo_decision(slug, logical_photo_id)
  │
  ├── Find open round for the photo's stack
  ├── Verify round is not committed
  └── Delete most recent decision, revert current_status

commit_round(slug, stack_id)
  │
  ├── Find open round
  └── Set state='committed', committed_at=now
       (no further decisions allowed on this round)
```

### Round Scoping

Rounds are scoped per-stack: `scope='stack', scope_id=<stack_id>`.
Each stack has at most one open round at a time. Multi-round support
(progressive culling) is planned but not yet implemented -- once committed,
no new decisions are allowed on that stack.
