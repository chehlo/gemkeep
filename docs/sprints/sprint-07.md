# Sprint 7 — Minimum Viable Culling + Stack Management

> After this sprint, a user can merge stacks manually, view photos full-screen
> with camera parameters, and make keep/eliminate decisions with the keyboard.

---

## 1. Goal

After Sprint 7, a user can:

1. Select 2+ stacks in Stack Overview and press M to merge them
2. Undo the last merge with Ctrl+Z
3. Change burst gap (Ctrl+B) and have manual merges preserved
4. See every merge/restack recorded in a transaction log
5. Enter Single View from Stack Focus (Enter key)
6. View each photo full-screen with camera parameters (aperture, shutter, ISO, focal length, exposure comp)
7. Mark photos as keep (Y) or eliminate (X) with instant visual feedback
8. See decision badges on thumbnails in Stack Focus
9. Commit a round with Ctrl+Enter (decisions become immutable)
10. Crash the app and lose zero decisions on restart

No comparison view, no auto-advance, no multi-round, no zoom — all deferred.

**User Stories:** §1.6 (per-project context isolation), §3.2 (manual merge), §3.3 (merge-aware restack), §3.5 (undo merge),
§3.6 (transaction log), §4.3 (pair-aware decisions), §4.5 (camera parameters),
§5.1-5.3 (keep/eliminate, visual feedback), §8.6 (auto-save), §8.7 (manual commit),
§9.1 (Single View mode)

---

## 2. Architecture: Modularity Principle

All code in this sprint is designed for future extension without rewriting:

- **Decision engine** as a standalone Rust module `src-tauri/src/decisions/` —
  not coupled to UI or specific views. The same module will serve stack-scope,
  session-scope, and comparison-view decisions in future sprints.
- **Stack operations** as composable repository functions in `src-tauri/src/photos/repository.rs` —
  merge, restack, undo are independent functions that can be composed for future
  split, drag-and-drop merge, and batch operations.
- **Transaction log** as a generic audit system in `stack_transactions` table —
  any future structural operation (split, drag merge, auto-group) logs through the
  same mechanism. The table schema is action-agnostic (JSON details).
- **Frontend components** accept data via props, not hardcoded to specific views —
  the camera parameters overlay, decision badges, and status bar are reusable across
  SingleView, ComparisonView (Sprint 8), and FinalistView (Sprint 10).

### Module Structure (new files)

```
src-tauri/src/
├── decisions/
│   ├── mod.rs            (pub mod engine; pub mod model;)
│   ├── model.rs          (DecisionAction, RoundStatus, PhotoDetail, etc.)
│   └── engine.rs         (make_decision, undo_decision, commit_round, etc.)
├── commands/
│   ├── stacks.rs         (NEW — merge, undo, transaction log IPC commands)
│   └── decisions.rs      (NEW — decision and round IPC commands)
├── photos/
│   └── repository.rs     (extended: merge, transaction log, manual_merges queries)

src/lib/
├── api/
│   └── index.ts          (extended: new IPC wrappers)
├── components/
│   ├── screens/
│   │   ├── SingleView.svelte    (REPLACED — full implementation)
│   │   ├── StackFocus.svelte    (UPDATED — decision badges, Y/X keys, progress)
│   │   └── StackOverview.svelte (UPDATED — multi-select, M key, Ctrl+Z)
│   └── shared/
│       ├── CameraParams.svelte  (NEW — reusable EXIF overlay)
│       ├── DecisionBadge.svelte (NEW — green check / red X badge)
│       └── StatusBar.svelte     (NEW — "Photo 5/12 . Round 1 . KEPT")
```

### Per-Project Context Isolation

All views, progress indicators, and background processes are scoped to the active
project — not global. This is an **architectural invariant** that applies across all sprints.

**Current state (pre-Sprint 7):** `AppState` holds a single `cancel_indexing: Arc<AtomicBool>`,
`pause_indexing: Arc<AtomicBool>`, and a single `IndexingStatus`. Switching projects resets
these globals, losing the previous project's background state.

**Sprint 7 refactoring:** Introduce `ProjectContext` keyed by project slug.

```rust
/// Per-project runtime context — owned by AppState, keyed by slug
pub struct ProjectContext {
    pub db: Connection,                    // already exists (move from AppState)
    pub cancel_indexing: Arc<AtomicBool>,  // move from global
    pub pause_indexing: Arc<AtomicBool>,   // move from global
    pub indexing_status: Arc<Mutex<IndexingStatus>>,  // move from global
    // Future sprints add: comparison_state, session_state, etc.
}

pub struct AppState {
    pub projects: Mutex<HashMap<String, ProjectContext>>,
    pub active_slug: Mutex<Option<String>>,
    pub config: Mutex<Config>,
}
```

**Rules:**

1. `get_indexing_status(slug)` returns the status for THAT project, not a global.
2. `start_indexing(slug)` creates/reuses the `ProjectContext` for that slug.
3. Switching projects (`open_project`) changes `active_slug` but does NOT destroy
   other projects' contexts — their background tasks continue running.
4. All IPC commands that operate on project data take `slug` as a parameter
   (most already do; audit and fix any that use the implicit "current project").
5. Frontend stores `currentProject` slug and passes it to every API call.
6. Progress bar component reads status for `currentProject` slug specifically.

**Migration approach:** This is a refactor of existing code, not new feature code.
Touch `AppState`, `open_project`, `start_indexing`, `get_indexing_status`,
`cancel_indexing`, `resume_thumbnails`, and their Tauri command wrappers.
Test with 2 projects open: start indexing on project A, switch to project B,
verify project B shows its own status (idle), switch back to A, verify progress
resumed from where it was.

---

## 3. DB Schema Changes

All changes are additive. The migration bumps schema version from 3 to 4.

### 3.1 `stack_transactions` table (new)

Records every structural change like a git log. JSON `details` field allows
future operations to store arbitrary before/after state without schema changes.

```sql
CREATE TABLE IF NOT EXISTS stack_transactions (
    id          INTEGER PRIMARY KEY,
    project_id  INTEGER NOT NULL REFERENCES projects(id),
    action      TEXT NOT NULL,          -- 'merge' | 'split' | 'restack' | 'import'
    details     TEXT NOT NULL,          -- JSON: { before_state, after_state, ... }
    created_at  TEXT NOT NULL           -- ISO-8601 UTC
);

CREATE INDEX IF NOT EXISTS idx_stack_tx_project
    ON stack_transactions(project_id, created_at DESC);
```

**`details` JSON schema for `merge` action:**
```json
{
  "source_stack_ids": [4, 7, 12],
  "target_stack_id": 42,
  "logical_photo_ids_moved": [10, 11, 15, 16, 17],
  "source_stacks_deleted": true
}
```

**`details` JSON schema for `restack` action:**
```json
{
  "burst_gap_secs": 5,
  "stacks_before": 240,
  "stacks_after": 180,
  "manual_merges_preserved": 3
}
```

### 3.2 `manual_merges` table (new)

Tracks which logical photos were manually grouped so that restack can preserve
them. Each row represents a set of logical photos that must stay together.

```sql
CREATE TABLE IF NOT EXISTS manual_merges (
    id          INTEGER PRIMARY KEY,
    project_id  INTEGER NOT NULL REFERENCES projects(id),
    merge_group TEXT NOT NULL,           -- JSON array of logical_photo_ids: [10, 11, 15]
    created_at  TEXT NOT NULL,           -- ISO-8601 UTC
    active      INTEGER NOT NULL DEFAULT 1  -- 0 if undone
);

CREATE INDEX IF NOT EXISTS idx_manual_merges_project
    ON manual_merges(project_id, active);
```

**Why a separate table instead of a column on `logical_photos`?**
A merge group can span logical photos from multiple original stacks. A column
approach would require a group-id FK and separate group table — same complexity,
less clarity. The JSON array is simple, queryable, and directly maps to the
"restore original stacks" undo operation.

### 3.3 `photos` table — new columns for camera parameters

The existing `photos` table stores `camera_model` and `lens` but not the numeric
EXIF fields needed for the camera parameters overlay. Add five columns:

```sql
ALTER TABLE photos ADD COLUMN aperture       REAL;     -- f-number, e.g. 2.8
ALTER TABLE photos ADD COLUMN shutter_speed  TEXT;     -- rational string "1/250" or decimal "2.5"
ALTER TABLE photos ADD COLUMN iso            INTEGER;  -- e.g. 400
ALTER TABLE photos ADD COLUMN focal_length   REAL;     -- mm, e.g. 85.0
ALTER TABLE photos ADD COLUMN exposure_comp  REAL;     -- EV, e.g. +0.7 or -1.0
```

**Note:** Since we are pre-launch (no shipped user data), the squashed migration
in `migrations.rs` adds these columns directly to the `CREATE TABLE photos` statement.
No `ALTER TABLE` needed — the table is re-created on every fresh DB.

### 3.4 `rounds` table — no schema change

The existing `rounds` table already has `scope`, `scope_id`, `round_number`, `state`,
`committed_at`. Sprint 7 uses `scope = 'stack'`, `scope_id = stack_id`, `round_number = 1`.

### 3.5 `decisions` table — no schema change

The existing `decisions` table already has `logical_photo_id`, `round_id`, `action`,
`timestamp`. Sprint 7 uses `action = 'keep' | 'eliminate'`.

### 3.6 Schema version bump

```sql
UPDATE schema_version SET version = 4 WHERE version < 4;
```

### 3.7 Squashed migration update

Since we are pre-launch, the squashed migration in `migrations.rs` is updated
in-place to include the new tables and columns. The version becomes 4.

```rust
// In migrations.rs — updated CREATE TABLE photos
CREATE TABLE IF NOT EXISTS photos (
    id               INTEGER PRIMARY KEY,
    path             TEXT NOT NULL UNIQUE,
    format           TEXT NOT NULL,
    capture_time     TEXT,
    orientation      INTEGER,
    camera_model     TEXT,
    lens             TEXT,
    logical_photo_id INTEGER REFERENCES logical_photos(id),
    aperture         REAL,
    shutter_speed    TEXT,
    iso              INTEGER,
    focal_length     REAL,
    exposure_comp    REAL
);

-- New tables
CREATE TABLE IF NOT EXISTS stack_transactions ( ... );
CREATE TABLE IF NOT EXISTS manual_merges ( ... );
```

---

## 4. EXIF Extraction Changes

### 4.1 Extended ExifData struct

```rust
// import/exif.rs
#[derive(Default)]
pub struct ExifData {
    pub capture_time:    Option<chrono::DateTime<chrono::Utc>>,
    pub camera_model:    Option<String>,
    pub lens:            Option<String>,
    pub orientation:     Option<u16>,
    // NEW for Sprint 7:
    pub aperture:        Option<f64>,    // f-number, e.g. 2.8
    pub shutter_speed:   Option<String>, // formatted string "1/250" or "2.5s"
    pub iso:             Option<u32>,    // e.g. 400
    pub focal_length:    Option<f64>,    // mm, e.g. 85.0
    pub exposure_comp:   Option<f64>,    // EV, e.g. +0.7
}
```

### 4.2 JPEG EXIF extraction additions

Extract from kamadak-exif using these EXIF tags:

| EXIF Tag | kamadak-exif constant | Type | Extraction |
|---|---|---|---|
| FNumber | `Tag::FNumber` | Rational | `num/den` as f64 |
| ExposureTime | `Tag::ExposureTime` | Rational | If `num < den`: format as `"1/{den/num}"`, else `"{num/den}s"` |
| ISOSpeedRatings | `Tag::PhotographicSensitivity` | Short/Long | First value as u32 |
| FocalLength | `Tag::FocalLength` | Rational | `num/den` as f64 |
| ExposureBiasValue | `Tag::ExposureBiasValue` | SRational | `num/den` as f64 |

```rust
fn read_rational_tag(exif: &exif::Exif, tag: exif::Tag) -> Option<f64> {
    let field = exif.get_field(tag, exif::In::PRIMARY)?;
    match &field.value {
        exif::Value::Rational(v) => {
            let r = v.first()?;
            if r.denom == 0 { return None; }
            Some(r.num as f64 / r.denom as f64)
        }
        _ => None,
    }
}

fn read_srational_tag(exif: &exif::Exif, tag: exif::Tag) -> Option<f64> {
    let field = exif.get_field(tag, exif::In::PRIMARY)?;
    match &field.value {
        exif::Value::SRational(v) => {
            let r = v.first()?;
            if r.denom == 0 { return None; }
            Some(r.num as f64 / r.denom as f64)
        }
        _ => None,
    }
}

fn read_iso(exif: &exif::Exif) -> Option<u32> {
    let field = exif.get_field(exif::Tag::PhotographicSensitivity, exif::In::PRIMARY)?;
    match &field.value {
        exif::Value::Short(v) => v.first().map(|&v| v as u32),
        exif::Value::Long(v)  => v.first().copied(),
        _ => None,
    }
}

fn format_shutter_speed(rational_value: f64) -> String {
    if rational_value <= 0.0 { return "?".to_string(); }
    if rational_value >= 1.0 {
        format!("{:.1}s", rational_value)
    } else {
        let denom = (1.0 / rational_value).round() as u32;
        format!("1/{}", denom)
    }
}
```

### 4.3 RAW EXIF extraction additions

The rawler crate's `RawMetadata.exif` struct already exposes:
- `fnumber` — Option<f64>
- `exposure_time` — Option<f64> (seconds)
- `iso_speed` — Option<u32>
- `focal_length` — Option<f64>
- `exposure_bias` — Option<f64>

Map these directly to the `ExifData` fields.

### 4.4 Pipeline changes

`insert_photo` in the pipeline must now pass the five new columns to the DB.
The `insert_photo` repository function gains five new parameters.

### 4.5 Backfill for existing projects

Existing projects have photos without camera parameter columns. On first open
after the schema upgrade, the columns default to NULL. The parameters overlay
shows "N/A" for missing fields. No backfill pass is needed — the user can
re-index to populate the new columns.

---

## 5. Rust Data Models

### 5.1 Stack Management Models

```rust
// photos/model.rs — new structs

/// Result of a merge operation.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct MergeResult {
    /// The id of the newly created merged stack
    pub merged_stack_id: i64,
    /// Number of logical photos moved into the merged stack
    pub logical_photos_moved: usize,
    /// IDs of the source stacks that were deleted
    pub source_stack_ids: Vec<i64>,
    /// Transaction log entry id
    pub transaction_id: i64,
}

/// A record from the stack_transactions table.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct StackTransaction {
    pub id: i64,
    pub project_id: i64,
    pub action: String,        // "merge" | "split" | "restack" | "import"
    pub details: String,       // JSON string
    pub created_at: String,    // ISO-8601
}
```

### 5.2 Decision Engine Models

```rust
// decisions/model.rs

/// The action for a decision.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DecisionAction {
    Keep,
    Eliminate,
}

impl DecisionAction {
    pub fn as_str(&self) -> &'static str {
        match self {
            DecisionAction::Keep => "keep",
            DecisionAction::Eliminate => "eliminate",
        }
    }
}

/// Result of making a decision.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct DecisionResult {
    /// The decision row id
    pub decision_id: i64,
    /// The round id the decision was recorded in
    pub round_id: i64,
    /// The action that was recorded
    pub action: String,
    /// Current status of the logical photo after this decision
    pub current_status: String,
    /// Whether the round was auto-created (first decision in stack)
    pub round_auto_created: bool,
}

/// Status of a round for a given stack.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct RoundStatus {
    pub round_id: i64,
    pub round_number: i32,
    pub state: String,         // "open" | "committed"
    pub total_photos: i64,
    pub decided: i64,
    pub kept: i64,
    pub eliminated: i64,
    pub undecided: i64,
    pub committed_at: Option<String>,  // ISO-8601, None if still open
}

/// Full detail for a single logical photo, including camera parameters.
/// Used by SingleView for the full-screen display.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct PhotoDetail {
    pub logical_photo_id: i64,
    pub thumbnail_path: Option<String>,
    pub capture_time: Option<String>,
    pub camera_model: Option<String>,
    pub lens: Option<String>,
    pub has_raw: bool,
    pub has_jpeg: bool,
    pub current_status: String,       // "undecided" | "keep" | "eliminate"
    // Camera parameters (from representative photo EXIF)
    pub aperture: Option<f64>,        // f-number
    pub shutter_speed: Option<String>,// formatted: "1/250"
    pub iso: Option<u32>,
    pub focal_length: Option<f64>,    // mm
    pub exposure_comp: Option<f64>,   // EV
    // File paths for asset protocol display
    pub jpeg_path: Option<String>,    // path to JPEG file (for display)
    pub raw_path: Option<String>,     // path to RAW file (for future toggle)
}
```

---

## 6. New Tauri IPC Commands

### 6.1 Stack Management Commands (`commands/stacks.rs`)

```rust
/// Merge 2+ stacks into one new stack.
/// Moves all logical_photos from source stacks into a new stack.
/// Deletes source stacks. Logs transaction. Creates manual_merges record.
///
/// Validation:
/// - stack_ids must contain >= 2 ids
/// - All stack_ids must belong to the same project
/// - All stack_ids must exist
///
/// Returns MergeResult with the new stack id and transaction details.
#[tauri::command]
pub fn merge_stacks(
    slug: String,
    stack_ids: Vec<i64>,
    state: State<'_, AppState>,
) -> Result<MergeResult, String>
```

```rust
/// Undo the most recent merge for this project.
/// Reads the last merge transaction, recreates original stacks,
/// moves logical_photos back, deletes the merged stack.
/// Marks the manual_merges record as inactive (active = 0).
///
/// Returns error if no undoable merge exists.
#[tauri::command]
pub fn undo_last_merge(
    slug: String,
    state: State<'_, AppState>,
) -> Result<(), String>
```

```rust
/// List all stack transactions for the project, newest first.
/// Used for future "stack history" panel; exists now for debugging
/// and test verification.
#[tauri::command]
pub fn list_stack_transactions(
    slug: String,
    state: State<'_, AppState>,
) -> Result<Vec<StackTransaction>, String>
```

### 6.2 Decision Engine Commands (`commands/decisions.rs`)

```rust
/// Record a keep or eliminate decision for a logical photo.
///
/// Behavior:
/// 1. If no open round exists for this stack, auto-create Round 1
/// 2. INSERT into decisions table (append-only audit log)
/// 3. UPDATE logical_photos.current_status to match the action
/// 4. Decision applies to the entire logical photo (both RAW+JPEG)
/// 5. Re-deciding on an already-decided photo: new INSERT overwrites
///    (the latest decision for a given photo+round is the effective one)
///
/// Returns error if the round is committed (immutable).
#[tauri::command]
pub fn make_decision(
    slug: String,
    logical_photo_id: i64,
    action: String,            // "keep" | "eliminate"
    state: State<'_, AppState>,
) -> Result<DecisionResult, String>
```

```rust
/// Undo the last decision in the current open round for a photo.
/// Inserts a new decision with action = the PREVIOUS status of the photo
/// (or "undecided" if there was only one decision).
///
/// Implementation: query decisions for this photo+round ordered by timestamp DESC.
/// If only one decision exists, set current_status back to "undecided" and
/// DELETE that single decision row. If multiple exist, the previous one
/// becomes effective.
///
/// Returns error if the round is committed.
/// NOTE: Sprint 7 implements undo as "set to undecided". Full undo
/// (reverting to previous keep/eliminate) is Sprint 8.
#[tauri::command]
pub fn undo_decision(
    slug: String,
    logical_photo_id: i64,
    state: State<'_, AppState>,
) -> Result<(), String>
```

```rust
/// Get the round status for a stack: how many decided, kept, eliminated.
/// If no round exists for the stack, returns a "no round" status with
/// all counters at 0 (the round will be auto-created on first decision).
#[tauri::command]
pub fn get_round_status(
    slug: String,
    stack_id: i64,
    state: State<'_, AppState>,
) -> Result<RoundStatus, String>
```

```rust
/// Commit (seal) the current open round for a stack.
/// After commit, decisions in that round are immutable.
/// Sets rounds.state = 'committed' and rounds.committed_at = now.
///
/// Returns error if:
/// - No open round exists for this stack
/// - The round is already committed
#[tauri::command]
pub fn commit_round(
    slug: String,
    stack_id: i64,
    state: State<'_, AppState>,
) -> Result<(), String>
```

```rust
/// Get full detail for a single logical photo, including camera parameters.
/// Used by SingleView for the full-screen display with EXIF overlay.
///
/// Returns paths to both JPEG and RAW files (if paired) for asset protocol display.
/// Thumbnail path resolved from disk cache.
#[tauri::command]
pub fn get_photo_detail(
    slug: String,
    logical_photo_id: i64,
    state: State<'_, AppState>,
) -> Result<PhotoDetail, String>
```

```rust
/// Get decisions for all logical photos in a stack (for the current round).
/// Returns a map of logical_photo_id -> current_status.
/// Used by StackFocus to display decision badges on thumbnails.
#[tauri::command]
pub fn get_stack_decisions(
    slug: String,
    stack_id: i64,
    state: State<'_, AppState>,
) -> Result<Vec<PhotoDecisionStatus>, String>
```

Where `PhotoDecisionStatus` is:

```rust
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct PhotoDecisionStatus {
    pub logical_photo_id: i64,
    pub current_status: String,   // "undecided" | "keep" | "eliminate"
}
```

---

## 7. Stack Management Implementation

### 7.1 merge_stacks

```
merge_stacks(conn, project_id, stack_ids):

  VALIDATE:
    stack_ids.len() >= 2                           → error "Need 2+ stacks to merge"
    All stack_ids exist in stacks table for project → error "Stack {id} not found"

  BEGIN TRANSACTION
    1. Create new stack row (INSERT INTO stacks)   → new_stack_id
    2. Collect all logical_photo_ids from source stacks:
       SELECT id FROM logical_photos WHERE stack_id IN (source_stack_ids)
    3. Move logical_photos:
       UPDATE logical_photos SET stack_id = new_stack_id WHERE stack_id IN (source_stack_ids)
    4. Delete source stacks:
       DELETE FROM stacks WHERE id IN (source_stack_ids) AND project_id = ?
    5. Record manual merge:
       INSERT INTO manual_merges (project_id, merge_group, created_at, active)
       VALUES (?, JSON_ARRAY(lp_ids...), now, 1)
    6. Log transaction:
       INSERT INTO stack_transactions (project_id, action, details, created_at)
       VALUES (?, 'merge', JSON_DETAILS, now)
  COMMIT

  RETURN MergeResult { merged_stack_id, logical_photos_moved, source_stack_ids, transaction_id }
```

### 7.2 undo_last_merge

```
undo_last_merge(conn, project_id):

  1. Find the last merge transaction:
     SELECT * FROM stack_transactions
     WHERE project_id = ? AND action = 'merge'
     ORDER BY created_at DESC LIMIT 1
     → error "No merge to undo" if none found

  2. Parse details JSON:
     source_stack_ids, target_stack_id, logical_photo_ids_moved

  3. Verify target_stack_id still exists:
     → error "Merged stack no longer exists" if deleted by another operation

  BEGIN TRANSACTION
    4. Recreate source stacks:
       For each source_stack_id:
         INSERT INTO stacks (id, project_id, created_at) VALUES (id, ?, now)
         (reuse original IDs so that any existing references remain valid)

    5. Determine which logical_photos originally belonged to each source stack.
       The details JSON stores the mapping. Move them back:
       UPDATE logical_photos SET stack_id = original_stack_id WHERE id IN (original_lp_ids)

    6. Delete the merged stack:
       DELETE FROM stacks WHERE id = target_stack_id

    7. Mark manual_merges record as inactive:
       UPDATE manual_merges SET active = 0
       WHERE project_id = ? AND merge_group contains the moved LP IDs
       AND active = 1
       ORDER BY created_at DESC LIMIT 1

    8. Log undo transaction:
       INSERT INTO stack_transactions (project_id, action, details, created_at)
       VALUES (?, 'undo_merge', JSON_DETAILS, now)
  COMMIT
```

**Note on merge details JSON:** To support undo, the merge transaction must store
the original stack assignment for each logical photo. Updated merge details schema:

```json
{
  "source_stack_ids": [4, 7],
  "target_stack_id": 42,
  "photo_assignments": {
    "10": 4, "11": 4,
    "15": 7, "16": 7, "17": 7
  }
}
```

### 7.3 Merge-aware restack

When the user changes burst gap (Ctrl+B) and triggers restack, manual merges
must be preserved. The algorithm:

```
restack_merge_aware(conn, project_id, burst_gap_secs):

  1. Load active manual merge groups:
     SELECT merge_group FROM manual_merges
     WHERE project_id = ? AND active = 1
     → Set<Set<lp_id>> merge_groups

  2. Build a set of all manually merged LP IDs:
     merged_lp_ids = union of all merge_groups

  3. Load all logical_photos with capture times:
     (lp_id, capture_time) for all LPs in project

  4. Separate into:
     - merged_lps: LPs that belong to any merge group (skip auto-stacking)
     - free_lps: LPs NOT in any merge group (apply burst-gap auto-stacking)

  5. Auto-stack free_lps by burst gap:
     Sort by capture_time ascending.
     Iterate: if gap <= burst_gap_secs → same stack; else → new stack.
     LPs with no capture_time → individual stack of size 1.

  BEGIN TRANSACTION
    6. Delete all existing stacks for the project:
       clear_stacks_only(conn, project_id)

    7. Create stacks for free_lps (from step 5):
       For each auto-generated stack group:
         INSERT INTO stacks → new_stack_id
         UPDATE logical_photos SET stack_id = new_stack_id WHERE id IN (group_lp_ids)

    8. Create stacks for merged groups (from step 1):
       For each active merge_group:
         INSERT INTO stacks → new_stack_id
         UPDATE logical_photos SET stack_id = new_stack_id WHERE id IN (group_lp_ids)

    9. Log transaction:
       INSERT INTO stack_transactions (project_id, action, details, created_at)
       VALUES (?, 'restack', JSON_DETAILS, now)
  COMMIT
```

The existing `restack` IPC command in `commands/import.rs` is updated to call
`restack_merge_aware` instead of `restack_from_existing_photos`.

---

## 8. Decision Engine Implementation

### 8.1 `decisions/engine.rs` — Core Functions

All decision functions operate on a `&Connection` and do not depend on Tauri state.
This makes them testable with in-memory SQLite.

```rust
/// Find or auto-create an open round for a stack.
/// Returns (round_id, was_created).
pub fn find_or_create_round(
    conn: &Connection,
    project_id: i64,
    stack_id: i64,
) -> rusqlite::Result<(i64, bool)> {
    // SELECT id FROM rounds WHERE scope = 'stack' AND scope_id = stack_id
    //   AND state = 'open' AND project_id = project_id
    // If found: return (id, false)
    // If not found: INSERT INTO rounds (...) → return (new_id, true)
}

/// Record a decision. Append-only: never UPDATE existing decisions.
/// The latest decision per (logical_photo_id, round_id) is effective.
pub fn record_decision(
    conn: &Connection,
    logical_photo_id: i64,
    round_id: i64,
    action: &DecisionAction,
) -> rusqlite::Result<i64> {
    // INSERT INTO decisions (logical_photo_id, round_id, action, timestamp)
    // UPDATE logical_photos SET current_status = action WHERE id = logical_photo_id
    // Return decision.id
}

/// Derive current_status for a logical photo from the decisions table.
/// Returns "undecided" if no decisions exist for the photo in the given round.
pub fn derive_current_status(
    conn: &Connection,
    logical_photo_id: i64,
    round_id: i64,
) -> rusqlite::Result<String> {
    // SELECT action FROM decisions
    // WHERE logical_photo_id = ? AND round_id = ?
    // ORDER BY timestamp DESC LIMIT 1
    // If no row: "undecided"
}

/// Commit a round: mark as immutable.
pub fn commit_round(
    conn: &Connection,
    round_id: i64,
) -> rusqlite::Result<()> {
    // UPDATE rounds SET state = 'committed', committed_at = now
    // WHERE id = round_id AND state = 'open'
    // If rows_affected = 0: already committed → error
}

/// Check if a round is committed (read-only).
pub fn is_round_committed(
    conn: &Connection,
    round_id: i64,
) -> rusqlite::Result<bool> {
    // SELECT state FROM rounds WHERE id = ?
    // Return state == "committed"
}

/// Get round status with decision counts.
pub fn get_round_status(
    conn: &Connection,
    project_id: i64,
    stack_id: i64,
) -> rusqlite::Result<RoundStatus> {
    // Find or report the open round for this stack
    // COUNT total logical_photos in stack
    // COUNT decisions with action='keep' for the latest per-photo entry
    // COUNT decisions with action='eliminate' for the latest per-photo entry
    // undecided = total - kept - eliminated
}
```

### 8.2 Append-only audit principle

The `decisions` table is an append-only audit log. Calling `make_decision` with
the same `logical_photo_id` in the same round creates a NEW row — it never
UPDATEs or DELETEs existing rows. The effective decision is the latest one
(by `timestamp`) for a given `(logical_photo_id, round_id)`.

The `current_status` column on `logical_photos` is a materialized cache of the
latest decision. It is always derivable from the decisions table. This cache
exists for performance: `list_stacks` and `list_logical_photos` do not need
to join through `decisions`.

### 8.3 Crash safety

Every decision is an immediate SQLite INSERT in WAL mode. If the app crashes
between decisions:
- All completed decisions are on disk
- `current_status` is consistent (updated in the same statement as the INSERT)
- The round remains open (can continue on restart)
- No partial state: each decision is a single statement, atomic

### 8.4 `get_photo_detail` implementation

```rust
pub fn get_photo_detail(
    conn: &Connection,
    logical_photo_id: i64,
    cache_dir: &Path,
) -> rusqlite::Result<PhotoDetail> {
    // Query:
    // SELECT lp.id, lp.current_status,
    //        rep.capture_time, rep.camera_model, rep.lens,
    //        rep.aperture, rep.shutter_speed, rep.iso,
    //        rep.focal_length, rep.exposure_comp
    // FROM logical_photos lp
    // JOIN photos rep ON rep.id = lp.representative_photo_id
    // WHERE lp.id = ?

    // Also query ALL photos for this logical_photo to find JPEG and RAW paths:
    // SELECT path, format FROM photos WHERE logical_photo_id = ?

    // Resolve thumbnail path from cache_dir
    // Build and return PhotoDetail
}
```

---

## 9. Frontend TypeScript API Additions (`src/lib/api/index.ts`)

```typescript
// ── Stack Management ────────────────────────────────────────────

export interface MergeResult {
  merged_stack_id: number
  logical_photos_moved: number
  source_stack_ids: number[]
  transaction_id: number
}

export interface StackTransaction {
  id: number
  project_id: number
  action: string
  details: string       // JSON string
  created_at: string
}

export async function mergeStacks(slug: string, stackIds: number[]): Promise<MergeResult> {
  return invoke('merge_stacks', { slug, stackIds })
}

export async function undoLastMerge(slug: string): Promise<void> {
  return invoke('undo_last_merge', { slug })
}

export async function listStackTransactions(slug: string): Promise<StackTransaction[]> {
  return invoke('list_stack_transactions', { slug })
}

// ── Decision Engine ─────────────────────────────────────────────

export interface DecisionResult {
  decision_id: number
  round_id: number
  action: string
  current_status: string
  round_auto_created: boolean
}

export interface RoundStatus {
  round_id: number
  round_number: number
  state: string
  total_photos: number
  decided: number
  kept: number
  eliminated: number
  undecided: number
  committed_at: string | null
}

export interface PhotoDetail {
  logical_photo_id: number
  thumbnail_path: string | null
  capture_time: string | null
  camera_model: string | null
  lens: string | null
  has_raw: boolean
  has_jpeg: boolean
  current_status: string
  aperture: number | null
  shutter_speed: string | null
  iso: number | null
  focal_length: number | null
  exposure_comp: number | null
  jpeg_path: string | null
  raw_path: string | null
}

export interface PhotoDecisionStatus {
  logical_photo_id: number
  current_status: string
}

export async function makeDecision(
  slug: string, logicalPhotoId: number, action: string
): Promise<DecisionResult> {
  return invoke('make_decision', { slug, logicalPhotoId, action })
}

export async function undoDecision(slug: string, logicalPhotoId: number): Promise<void> {
  return invoke('undo_decision', { slug, logicalPhotoId })
}

export async function getRoundStatus(slug: string, stackId: number): Promise<RoundStatus> {
  return invoke('get_round_status', { slug, stackId })
}

export async function commitRound(slug: string, stackId: number): Promise<void> {
  return invoke('commit_round', { slug, stackId })
}

export async function getPhotoDetail(slug: string, logicalPhotoId: number): Promise<PhotoDetail> {
  return invoke('get_photo_detail', { slug, logicalPhotoId })
}

export async function getStackDecisions(slug: string, stackId: number): Promise<PhotoDecisionStatus[]> {
  return invoke('get_stack_decisions', { slug, stackId })
}
```

---

## 10. SingleView Component Spec

### 10.1 Props and state

SingleView receives its context from the navigation state machine:

```typescript
// From navigation.svelte.ts — already defined
type SingleViewScreen = {
  kind: 'single-view'
  projectSlug: string
  stackId: number
  photoId: number        // logical_photo_id of the initially focused photo
  projectName: string
}
```

Internal state:

```typescript
let photos = $state<PhotoDetail[]>([])           // all photos in the stack
let currentIndex = $state(0)                      // index into photos[]
let loading = $state(true)
let roundStatus = $state<RoundStatus | null>(null)
let showCameraParams = $state(true)               // toggleable with I key
```

### 10.2 Lifecycle

```
onMount:
  1. Attach keyboard listener
  2. Load all logical photos for the stack:
     photos = await Promise.all(
       (await listLogicalPhotos(slug, stackId))
         .map(lp => getPhotoDetail(slug, lp.logical_photo_id))
     )
  3. Set currentIndex to the index matching photoId
  4. Load round status: roundStatus = await getRoundStatus(slug, stackId)
  5. loading = false

onDestroy:
  Remove keyboard listener
```

### 10.3 Photo display

The photo fills the viewport using `object-contain` to preserve aspect ratio.
The display source is the JPEG file path (via asset protocol `convertFileSrc()`).
For RAW-only logical photos, use the thumbnail path as fallback (full RAW decode
is Sprint 12).

```html
<div class="absolute inset-0 flex items-center justify-center bg-black">
  {#if currentPhoto.jpeg_path}
    <img
      src={getThumbnailUrl(currentPhoto.jpeg_path)}
      alt="Photo {currentIndex + 1}"
      class="max-w-full max-h-full object-contain"
    />
  {:else if currentPhoto.thumbnail_path}
    <img
      src={getThumbnailUrl(currentPhoto.thumbnail_path)}
      alt="Photo {currentIndex + 1} (thumbnail)"
      class="max-w-full max-h-full object-contain"
    />
  {:else}
    <span class="text-6xl text-gray-600">No preview</span>
  {/if}
</div>
```

**Decision visual feedback overlays:**

```html
<!-- Green border for KEPT -->
{#if currentPhoto.current_status === 'keep'}
  <div class="absolute inset-0 border-4 border-green-500 pointer-events-none" />
{/if}

<!-- Red border + dim for ELIMINATED -->
{#if currentPhoto.current_status === 'eliminate'}
  <div class="absolute inset-0 border-4 border-red-500 pointer-events-none" />
  <div class="absolute inset-0 bg-black/50 pointer-events-none" />
{/if}
```

### 10.4 Camera parameters overlay (CameraParams component)

Semi-transparent panel, right edge, visible by default (toggle with I key).
Monospace layout for number alignment.

```
┌──────────────┐
│  PARAMETERS  │
│              │
│  f/2.8       │  ← aperture
│  1/250s      │  ← shutter_speed
│  ISO 400     │  ← iso
│  85mm        │  ← focal_length
│  +0.7 EV     │  ← exposure_comp
│              │
│  Canon EOS R5│  ← camera_model
│  RF 85mm     │  ← lens
│  f/1.2L      │
│              │
│  RAW + JPEG  │  ← format badges
│  Feb 14      │  ← capture date
│  14:23:01    │  ← capture time
└──────────────┘
```

Component: `src/lib/components/shared/CameraParams.svelte`

```typescript
// Props
interface CameraParamsProps {
  aperture: number | null
  shutterSpeed: string | null
  iso: number | null
  focalLength: number | null
  exposureComp: number | null
  cameraModel: string | null
  lens: string | null
  hasRaw: boolean
  hasJpeg: boolean
  captureTime: string | null
}
```

Display formatting:
- Aperture: `f/{value}` with one decimal, e.g. `f/2.8`
- Shutter: as-is from backend, e.g. `1/250`
- ISO: `ISO {value}`, e.g. `ISO 400`
- Focal length: `{value}mm`, rounded to nearest integer
- Exposure comp: `{+/-value} EV`, e.g. `+0.7 EV` or `-1.0 EV`
- Missing values: display `--` (not "N/A" — cleaner)

### 10.5 Status bar (StatusBar component)

Bottom of the screen, persistent.

```
Photo 5/12  .  Stack: Iceland Sunset  .  Round 1  .  KEPT
```

Component: `src/lib/components/shared/StatusBar.svelte`

```typescript
interface StatusBarProps {
  currentIndex: number
  totalPhotos: number
  stackId: number
  roundNumber: number
  currentStatus: string    // "undecided" | "keep" | "eliminate"
  isCommitted: boolean
}
```

Status text:
- `"undecided"` → "UNDECIDED" (no color)
- `"keep"` → "KEPT" (green text)
- `"eliminate"` → "ELIMINATED" (red text)
- When committed: append "(read-only)"

### 10.6 Keyboard handlers

```typescript
function handleKey(e: KeyboardEvent) {
  // Navigation
  if (e.key === 'ArrowRight' || e.key === 'l') { navigateNext(); e.preventDefault() }
  if (e.key === 'ArrowLeft'  || e.key === 'h') { navigatePrev(); e.preventDefault() }
  if (e.key === 'Home')                         { currentIndex = 0; e.preventDefault() }
  if (e.key === 'End')                          { currentIndex = photos.length - 1; e.preventDefault() }
  if (e.key === 'Tab' && !e.shiftKey)           { jumpToNextUndecided(); e.preventDefault() }
  if (e.key === 'Tab' && e.shiftKey)            { jumpToPrevUndecided(); e.preventDefault() }

  // Decisions (only if round is open)
  if (e.key === 'y' || e.key === 'Y') { decide('keep'); e.preventDefault() }
  if (e.key === 'x' || e.key === 'X') { decide('eliminate'); e.preventDefault() }

  // Toggle camera params
  if (e.key === 'i' || e.key === 'I') { showCameraParams = !showCameraParams; e.preventDefault() }

  // Commit round
  if (e.key === 'Enter' && e.ctrlKey) { handleCommitRound(); e.preventDefault() }

  // Back to StackFocus
  if (e.key === 'Escape') { goBack(); e.preventDefault() }
}

async function decide(action: string) {
  if (roundStatus?.state === 'committed') return  // read-only
  const photo = photos[currentIndex]
  const result = await makeDecision(projectSlug, photo.logical_photo_id, action)
  // Update local state immediately (optimistic)
  photos[currentIndex] = { ...photo, current_status: result.current_status }
  // Refresh round status
  roundStatus = await getRoundStatus(projectSlug, stackId)
}
```

### 10.7 Decision visual feedback timing

On Y press:
1. Set `current_status = 'keep'` immediately (no delay)
2. Green border appears instantly
3. Status bar updates to "KEPT" instantly

On X press:
1. Set `current_status = 'eliminate'` immediately
2. Red border + 50% dim appears instantly
3. Status bar updates to "ELIMINATED" instantly

No animation delay. The decision is written to SQLite before the next frame.

---

## 11. StackFocus Updates

### 11.1 Decision badges on thumbnails

Each photo card in the StackFocus grid shows a decision badge:

```html
<!-- DecisionBadge component -->
{#if status === 'keep'}
  <div class="absolute top-1 right-1 w-5 h-5 rounded-full bg-green-500
              flex items-center justify-center text-white text-xs font-bold">
    Y
  </div>
{:else if status === 'eliminate'}
  <div class="absolute top-1 right-1 w-5 h-5 rounded-full bg-red-500
              flex items-center justify-center text-white text-xs font-bold">
    X
  </div>
{/if}
```

Eliminated photos are dimmed: `opacity-50` on the card.

### 11.2 Y/X keyboard shortcuts in StackFocus

Y and X keys work in StackFocus (same as SingleView). The focused photo card
receives the decision. Visual feedback updates immediately.

### 11.3 Progress counter

Header area of StackFocus shows:

```
5/12 decided  .  3 kept  .  2 eliminated  .  7 undecided  .  Round 1
```

Updated on every decision via `getRoundStatus()`.

### 11.4 Enter key → SingleView

Pressing Enter on a focused photo navigates to SingleView:

```typescript
if (e.key === 'Enter') {
  const photo = photos[focusedIndex]
  navigate({
    kind: 'single-view',
    projectSlug,
    stackId,
    photoId: photo.logical_photo_id,
    projectName,
  })
}
```

### 11.5 Tab key → next undecided

Tab jumps focus to the next photo with `current_status === 'undecided'`.
Shift+Tab jumps backward. Wraps around if needed.

### 11.6 Ctrl+Enter → commit round

Available from StackFocus. Same behavior as SingleView.

### 11.7 Vim-style navigation

`h`, `j`, `k`, `l` map to left, down, up, right respectively.

---

## 12. StackOverview Updates

### 12.1 Multi-select stacks

Hold Shift + Arrow keys to extend selection. Selected stacks show a distinct
visual indicator (thicker blue border + subtle blue background).

State:

```typescript
let selectedStacks = $state<Set<number>>(new Set())  // set of stack_ids
```

Shift+Arrow:
- If no selection exists, start from the focused stack
- Add the newly focused stack to the selection set
- Arrow without Shift clears the selection set

### 12.2 M key → merge selected

When 2+ stacks are selected, pressing M calls `mergeStacks()`.

```typescript
if (e.key === 'm' || e.key === 'M') {
  if (selectedStacks.size >= 2) {
    const result = await mergeStacks(projectSlug, [...selectedStacks])
    // Reload stacks list
    stacks = await listStacks(projectSlug)
    // Clear selection, focus on merged stack
    selectedStacks.clear()
    focusedIndex = stacks.findIndex(s => s.stack_id === result.merged_stack_id)
  }
}
```

### 12.3 Ctrl+Z → undo last merge

```typescript
if (e.key === 'z' && e.ctrlKey) {
  try {
    await undoLastMerge(projectSlug)
    stacks = await listStacks(projectSlug)
  } catch (err) {
    // No merge to undo — silently ignore or show brief status message
  }
}
```

### 12.4 Vim-style navigation

`h`, `j`, `k`, `l` map to arrow keys in the stack grid.

---

## 13. Navigation Updates

### 13.1 SingleViewScreen in state machine

Already defined in `navigation.svelte.ts` (Sprint 5 stub). The type includes
`photoId` which specifies the initially focused photo.

### 13.2 State preservation

- **StackFocus → SingleView:** `photoId` saved in navigation state. On return
  (Esc), StackFocus `focusedIndex` is restored to the photo that was viewed.
- **SingleView → StackFocus:** The photo index at the time of Esc is saved.
  Decisions made in SingleView are reflected immediately in StackFocus badges
  (StackFocus reloads decisions on mount).
- **StackOverview → StackFocus → StackOverview:** Existing scroll restore
  pattern (Sprint 5) continues to work.

### 13.3 back() update

The `back()` function in `navigation.svelte.ts` already handles `single-view`
→ `stack-focus` transitions. No change needed.

---

## 14. Restack Integration

### 14.1 Updated restack command

The existing `restack` IPC command in `commands/import.rs` is updated:

```rust
#[tauri::command]
pub fn restack(slug: String, state: State<'_, AppState>) -> Result<(), String> {
    // ... existing project_id and config lookup ...
    // Changed: call restack_merge_aware instead of restack_from_existing_photos
    pipeline::restack_merge_aware(conn, project_id, config.burst_gap_secs)?;
    // ... existing thumbnail resume logic ...
}
```

### 14.2 Thumbnail preservation during restack

The current `restack` implementation (via `restack_from_existing_photos`) calls
`clear_stacks_only` which NULLs `stack_id` on `logical_photos` but does NOT
delete logical_photo rows or their thumbnails. The new `restack_merge_aware`
follows the same pattern: it only changes `stack_id` assignments. Thumbnail
files remain intact because `logical_photo.id` does not change.

No thumbnail regeneration is needed after restack.

---

## 15. "Good Enough" UI Definition

### Must work
- Single View fills the window with the photo (object-contain, black background)
- Camera parameters readable in a semi-transparent panel (monospace, right edge)
- Green border for KEPT, red + dim for ELIMINATED, nothing for undecided
- Decision badges (small colored circles) on StackFocus grid thumbnails
- Stack selection uses Shift+Arrow highlighting (blue border)
- M key merges selected stacks; Ctrl+Z undoes last merge
- Status bar shows current photo index, round number, and decision state
- Y/X work in both SingleView and StackFocus
- Ctrl+Enter commits round; Y/X disabled after commit

### Can be rough
- No transitions or animations on decisions (instant state change)
- Camera parameters panel has no styling beyond semi-transparent dark background
- Merge feedback is a page reload (stacks list refresh), not an animated transition
- Undo merge provides no visual transition — just refreshes the grid
- Status bar is plain text, not a fancy progress bar
- Stack selection uses border changes only, not drag-and-drop
- No "all decided" completion message (that is Sprint 8)
- No auto-advance after decisions (Sprint 8)

---

## 16. Test Plan (TDD — Rule 13)

All tests are defined here and must be written BEFORE implementation.
Each test must FAIL (RED) before the corresponding code is written.

### 16.1 Rust Unit Tests — Decision Engine (`decisions/engine.rs`)

```
test_find_or_create_round_creates_round_1
  Setup: in-memory DB, project, stack with 3 logical_photos
  Call find_or_create_round → returns (round_id, true)
  Verify: round exists in DB with scope='stack', scope_id=stack_id,
          round_number=1, state='open'

test_find_or_create_round_reuses_existing
  Setup: create round manually via INSERT
  Call find_or_create_round → returns (same_id, false)
  Verify: no new round created

test_make_decision_keep
  Setup: project, stack, logical_photo, no round yet
  Call record_decision with Keep → returns decision_id
  Verify: decisions table has 1 row with action='keep'
  Verify: logical_photos.current_status = 'keep'

test_make_decision_eliminate
  Same as above but with Eliminate
  Verify: current_status = 'eliminate'

test_decision_re_decide_overwrites
  Setup: make_decision(keep), then make_decision(eliminate) on same photo
  Verify: decisions table has 2 rows (append-only)
  Verify: current_status = 'eliminate' (latest wins)

test_decision_updates_current_status
  Setup: make_decision(keep) on photo
  Verify: SELECT current_status FROM logical_photos = 'keep'
  make_decision(eliminate) on same photo
  Verify: SELECT current_status FROM logical_photos = 'eliminate'

test_decision_audit_log_append_only
  Setup: make 3 decisions on same photo (keep, eliminate, keep)
  Verify: decisions table has exactly 3 rows for this photo
  Verify: no rows were deleted or modified

test_decision_applies_to_pair
  Setup: RAW+JPEG pair → 1 logical_photo with 2 photos rows
  make_decision(keep) on the logical_photo
  Verify: both photos share the same logical_photo_id
  Verify: logical_photos.current_status = 'keep' (covers both files)

test_commit_round_locks_decisions
  Setup: make_decision(keep), then commit_round
  Verify: round.state = 'committed', committed_at is not null
  Verify: attempting record_decision returns error

test_undo_decision_sets_undecided
  Setup: make_decision(keep), then undo (delete last decision)
  Verify: current_status = 'undecided'

test_round_auto_created_on_first_decision
  Setup: stack with photos, no round exists
  Call make_decision → check round_auto_created = true
  Call make_decision again → check round_auto_created = false

test_get_round_status_counts
  Setup: stack with 10 photos, make 3 keep + 2 eliminate decisions
  Call get_round_status
  Verify: total=10, decided=5, kept=3, eliminated=2, undecided=5
```

### 16.2 Rust Unit Tests — Photo Detail (`decisions/engine.rs` or `photos/repository.rs`)

```
test_get_photo_detail_with_camera_params
  Setup: insert photo with aperture=2.8, shutter_speed="1/250",
         iso=400, focal_length=85.0, exposure_comp=0.7
  Call get_photo_detail
  Verify: all camera param fields match inserted values

test_get_photo_detail_missing_params
  Setup: insert photo with all camera params NULL
  Call get_photo_detail
  Verify: all camera param fields are None, no error

test_get_photo_detail_pair_has_both_paths
  Setup: RAW+JPEG pair (two photo rows, one logical_photo)
  Call get_photo_detail
  Verify: jpeg_path is not None, raw_path is not None
```

### 16.3 Rust Unit Tests — EXIF Extraction (`import/exif.rs`)

```
test_exif_jpeg_extracts_aperture
  Setup: synthetic JPEG with FNumber tag = 2.8
  Call extract_jpeg_exif → verify aperture = Some(2.8)

test_exif_jpeg_extracts_shutter_speed
  Setup: synthetic JPEG with ExposureTime = 1/250
  Call extract_jpeg_exif → verify shutter_speed = Some("1/250")

test_exif_jpeg_extracts_iso
  Setup: synthetic JPEG with ISOSpeedRatings = 400
  Call extract_jpeg_exif → verify iso = Some(400)

test_exif_jpeg_extracts_focal_length
  Setup: synthetic JPEG with FocalLength = 85.0
  Call extract_jpeg_exif → verify focal_length = Some(85.0)

test_exif_jpeg_extracts_exposure_comp
  Setup: synthetic JPEG with ExposureBiasValue = +0.7
  Call extract_jpeg_exif → verify exposure_comp = Some(0.7)

test_format_shutter_speed_fraction
  format_shutter_speed(0.004) → "1/250"

test_format_shutter_speed_seconds
  format_shutter_speed(2.5) → "2.5s"

test_format_shutter_speed_one_second
  format_shutter_speed(1.0) → "1.0s"
```

### 16.4 Rust Unit Tests — Stack Merge (`photos/repository.rs`)

```
test_merge_two_stacks
  Setup: 2 stacks with 3 and 4 logical_photos respectively
  Call merge_stacks → verify MergeResult
  Verify: new stack has 7 logical_photos
  Verify: source stacks deleted
  Verify: logical_photos.stack_id updated to new stack

test_merge_three_stacks
  Setup: 3 stacks
  Call merge_stacks with all 3 → verify all LPs in one stack

test_merge_logs_transaction
  Call merge_stacks → verify stack_transactions has 1 row
  Verify: action = 'merge', details JSON contains source_stack_ids
          and target_stack_id

test_merge_creates_manual_merge_record
  Call merge_stacks → verify manual_merges has 1 active row
  Verify: merge_group JSON contains all moved LP IDs

test_merge_invalid_single_stack
  Call merge_stacks with 1 stack_id → error

test_merge_nonexistent_stack
  Call merge_stacks with non-existent stack_id → error

test_undo_merge_restores_stacks
  Call merge_stacks → verify merged
  Call undo_last_merge → verify:
    - Original stacks re-created
    - Logical_photos back in original stacks
    - Merged stack deleted
    - manual_merges record has active=0

test_undo_merge_no_merges
  Call undo_last_merge with no prior merges → error

test_restack_preserves_manual_merges
  Setup: 4 stacks, merge stacks 1+2 manually
  Call restack_merge_aware with a different burst_gap
  Verify: photos from stacks 1+2 are still in the same stack
  Verify: photos from stacks 3+4 may have been regrouped
```

### 16.5 Rust Integration Tests — IPC Commands

```
test_ipc_merge_stacks_json_shape
  Contract test: verify JSON response matches TypeScript MergeResult interface

test_ipc_make_decision_json_shape
  Contract test: verify JSON response matches TypeScript DecisionResult interface

test_ipc_get_round_status_json_shape
  Contract test: verify JSON response matches TypeScript RoundStatus interface

test_ipc_get_photo_detail_json_shape
  Contract test: verify JSON response matches TypeScript PhotoDetail interface

test_ipc_get_stack_decisions_json_shape
  Contract test: verify JSON response matches TypeScript PhotoDecisionStatus[] interface

test_ipc_commit_round_then_decision_rejected
  Full IPC test: create project, add photos, make_decision, commit_round,
  attempt make_decision → error
```

### 16.6 Rust Tests — DB Migration

```
test_schema_version_is_4_after_migration
  Run migrations → assert schema_version = 4

test_photos_has_camera_param_columns
  Run migrations → PRAGMA table_info(photos)
  Assert columns: aperture, shutter_speed, iso, focal_length, exposure_comp

test_stack_transactions_table_exists
  Run migrations → verify stack_transactions in sqlite_master

test_manual_merges_table_exists
  Run migrations → verify manual_merges in sqlite_master
```

### 16.7 Vitest — SingleView Component

```
SingleView.test.ts

test_renders_loading_state
  Mount SingleView → verify loading indicator visible

test_renders_photo_image
  Mock getPhotoDetail → provide jpeg_path
  Verify: img element with asset:// URL rendered

test_renders_camera_params
  Mock getPhotoDetail → provide aperture, shutter_speed, iso, focal_length
  Verify: "f/2.8", "1/250", "ISO 400", "85mm" visible in DOM

test_renders_camera_params_missing
  Mock getPhotoDetail → all camera params null
  Verify: "--" placeholders rendered (no crash)

test_keyboard_y_marks_keep
  Mount, press Y key
  Verify: makeDecision called with action="keep"
  Verify: green border class applied

test_keyboard_x_marks_eliminate
  Mount, press X key
  Verify: makeDecision called with action="eliminate"
  Verify: red border + dim classes applied

test_keyboard_left_right_navigates
  Mount with 3 photos, press ArrowRight twice
  Verify: currentIndex changed (getPhotoDetail called for new photo)

test_keyboard_escape_goes_back
  Mount, press Escape
  Verify: navigation.back() called → screen changes to stack-focus

test_keyboard_i_toggles_camera_params
  Mount (camera params visible), press I
  Verify: camera params hidden
  Press I again → verify visible again

test_keyboard_ctrl_enter_commits_round
  Mount, press Ctrl+Enter
  Verify: commitRound called

test_committed_round_blocks_decisions
  Mock roundStatus with state='committed'
  Press Y → verify makeDecision NOT called

test_status_bar_shows_correct_info
  Mount with photo 3 of 12, current_status='keep'
  Verify: "Photo 3/12" and "KEPT" visible in DOM

test_keyboard_tab_jumps_to_undecided
  Mount with 5 photos: [keep, undecided, eliminate, undecided, keep]
  Start at index 0, press Tab
  Verify: focus moved to index 1 (first undecided)
```

### 16.8 Vitest — StackFocus Updates

```
StackFocus.test.ts (additions to existing file)

test_decision_badges_displayed
  Mock getStackDecisions → [{id:1, status:'keep'}, {id:2, status:'eliminate'}]
  Verify: green badge on photo 1, red badge on photo 2

test_eliminated_photos_dimmed
  Mock with eliminated photo → verify opacity-50 class

test_progress_counter_displayed
  Mock getRoundStatus → {total:12, decided:5, kept:3, eliminated:2, undecided:7}
  Verify: "5/12 decided" text visible

test_keyboard_y_in_stack_focus
  Press Y on focused photo
  Verify: makeDecision called

test_keyboard_enter_opens_single_view
  Press Enter
  Verify: navigation changed to single-view with correct photoId

test_keyboard_ctrl_enter_commits
  Press Ctrl+Enter
  Verify: commitRound called
```

### 16.9 Vitest — StackOverview Updates

```
StackOverview.test.ts (additions to existing file)

test_shift_arrow_selects_multiple_stacks
  Render with 4 stacks, press Shift+ArrowRight twice
  Verify: 2 stacks have selection indicator class

test_m_key_merges_selected_stacks
  Select 2 stacks, press M
  Verify: mergeStacks called with the 2 stack_ids

test_ctrl_z_undoes_merge
  Press Ctrl+Z
  Verify: undoLastMerge called

test_merge_requires_2_plus_stacks
  Select 1 stack, press M
  Verify: mergeStacks NOT called

test_selection_cleared_after_merge
  Select 2 stacks, press M (mock success), verify selection cleared
```

### 16.10 E2E Tests (Playwright)

```
tests/e2e/merge-flow.spec.ts

Journey 1 — Full merge
  1. Mock: project open, 4 stacks visible
  2. Select stacks 1 and 2 (Shift+Arrow)
  3. Press M
  4. Verify: mergeStacks IPC called with [stack1_id, stack2_id]
  5. Verify: stacks list refreshed, merged stack visible

Journey 2 — Merge undo
  1. After merge (Journey 1), press Ctrl+Z
  2. Verify: undoLastMerge IPC called
  3. Verify: original stacks restored in grid

tests/e2e/culling-flow.spec.ts

Journey 3 — Full culling flow
  1. Mock: project open, 1 stack with 3 photos
  2. Navigate: StackOverview → Enter (StackFocus) → Enter (SingleView)
  3. Verify: photo displayed, camera params visible
  4. Press Y → verify green feedback
  5. Press ArrowRight → press X → verify red feedback
  6. Press Escape → verify StackFocus shows badges (green on photo 1, red on photo 2)
  7. Press Ctrl+Enter → verify round committed

Journey 4 — Decisions persist across navigation
  1. In SingleView, press Y on photo 1
  2. Press Escape (back to StackFocus)
  3. Press Enter (re-enter SingleView on same photo)
  4. Verify: photo 1 still shows green border (decision persisted)

Journey 5 — Camera parameters display
  1. Enter SingleView with photo that has full EXIF data
  2. Verify: "f/2.8", "1/250", "ISO 400", "85mm", "+0.7 EV" visible
  3. Press I → verify params hidden
  4. Press I → verify params visible again
```

---

## 17. Error Handling

| Scenario | Behaviour |
|----------|-----------|
| Merge with < 2 stacks | Return error "Need 2+ stacks to merge" |
| Merge with non-existent stack | Return error "Stack {id} not found" |
| Undo merge with no prior merge | Return error "No merge to undo" |
| Decision on committed round | Return error "Round is committed" |
| Decision with invalid action | Return error "Invalid action: must be 'keep' or 'eliminate'" |
| Commit already-committed round | Return error "Round is already committed" |
| get_photo_detail with non-existent LP | Return error "Logical photo not found" |
| Camera params missing from EXIF | Return None for each missing field (no error) |
| Restack with manual merges referencing deleted LPs | Skip those merge groups (log warning) |
| DB constraint violation during merge | Rollback transaction, return error |

---

## 18. Success Criteria

1. User can select 2+ stacks in Stack Overview with Shift+Arrow and press M to merge them
2. Merged stacks combine all logical_photos into one stack; source stacks disappear from the grid
3. Changing burst gap (Ctrl+B → restack) preserves manual merges — previously merged photos remain in the same stack
4. Ctrl+Z undoes the last merge (original stacks restored with their original photos)
5. Every merge and restack is recorded in the `stack_transactions` table with before/after state in JSON
6. User can enter Single View from Stack Focus (Enter key) and navigate between photos with Left/Right arrows
7. Camera parameters (aperture, shutter speed, ISO, focal length, exposure comp) are visible in Single View for every photo that has EXIF data
8. Pressing I toggles the camera parameters overlay on/off
9. Pressing Y marks a photo as "keep" with immediate green border visual feedback
10. Pressing X marks a photo as "eliminate" with immediate red border + dim visual feedback
11. Pressing Y or X on an already-decided photo changes the decision (re-decidable before commit)
12. Y and X work in both SingleView and StackFocus (same keyboard shortcuts, same behavior)
13. Tab jumps to the next undecided photo; Shift+Tab jumps backward
14. Ctrl+Enter commits the round; after commit, Y/X on committed photos has no effect (returns error silently)
15. Killing the app process mid-session and restarting preserves all decisions made before the kill
16. Decisions on a RAW+JPEG pair apply to both files (verified by checking the `logical_photos.current_status` record covers both physical files)
17. Round 1 is auto-created on the first decision for a stack (no manual "start round" action required)
18. StackFocus shows decision badges (green/red) on thumbnails and a progress counter ("5/12 decided")
19. `cargo test` passes: merge, merge-aware restack, undo merge, transaction log, decision insert, current_status derivation, commit immutability, camera params extraction, photo detail query
20. `npm test` passes: SingleView rendering, keyboard handlers, camera params display, StackFocus badges, StackOverview multi-select
21. `npm run test:e2e` passes: merge flow, culling flow, decision persistence, camera params display

---

## 19. Out of Scope

| Feature | Sprint |
|---------|--------|
| Side-by-side comparison view | Sprint 8 |
| Auto-advance after decision | Sprint 8 |
| Undo last decision (U key) | Sprint 8 |
| Stack split (remove photo from stack) | Sprint 8 |
| Multi-round (Round 2+) | Sprint 9 |
| Restore eliminated photos | Sprint 9 |
| Round navigation ([ and ] keys) | Sprint 9 |
| Finalize stack (Ctrl+Shift+Enter) | Sprint 9 |
| Stack history viewer UI | Sprint 12 |
| Zoom / pan in Single View | Sprint 12 |
| RAW toggle (R key) | Sprint 12 |
| Keyboard help overlay (?) | Sprint 12 |
| Auto-advance toggle (A key) | Sprint 8 |
| Stack completion message | Sprint 8 |

---

## 20. Implementation Order

Recommended implementation sequence to minimize integration risk:

1. **Schema changes** — Update `migrations.rs` with new tables and columns (v4)
2. **EXIF extraction** — Add camera param extraction to `exif.rs`, update `insert_photo`
3. **Decision engine** — `decisions/` module: model.rs, engine.rs with all pure functions
4. **Decision IPC commands** — `commands/decisions.rs`: make_decision, undo_decision, get_round_status, commit_round, get_photo_detail, get_stack_decisions
5. **Stack merge** — Repository functions + `commands/stacks.rs`: merge_stacks, undo_last_merge, list_stack_transactions
6. **Merge-aware restack** — Update pipeline restack to preserve manual merges
7. **Frontend API** — Add all new TypeScript wrappers to `api/index.ts`
8. **SingleView** — Full implementation with photo display, camera params, decisions
9. **StackFocus updates** — Decision badges, Y/X keys, progress counter, Enter→SingleView
10. **StackOverview updates** — Multi-select, M key, Ctrl+Z
11. **E2E tests** — Playwright specs for merge and culling flows

Steps 1-6 are backend-only (all testable with `cargo test`).
Steps 7-10 are frontend (testable with `npm test`).
Step 11 validates the full integration.
