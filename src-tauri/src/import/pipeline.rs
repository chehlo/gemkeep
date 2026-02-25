use crate::import::pairs::LogicalGroup;
use crate::import::{exif, pairs, scanner, stacks, thumbnails};
use crate::photos::model::{ImportStats, IndexingStatus, PhotoFormat, ScannedFile};
use crate::photos::repository;
use rayon::prelude::*;
use rusqlite::Connection;
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

/// Payload emitted on the `thumbnail-ready` event after each thumbnail is written.
/// Frontend `listen('thumbnail-ready', cb)` receives this to trigger progressive refresh.
#[derive(Serialize, Clone)]
pub struct ThumbnailReadyPayload {
    pub logical_photo_id: i64,
}

/// Static configuration for a pipeline run (source folders, cache, burst settings).
pub struct PipelineConfig {
    pub project_id: i64,
    pub project_dir: PathBuf,
    pub folder_paths: Vec<PathBuf>,
    pub burst_gap_secs: u64,
}

/// Runtime controls shared with the background thread (cancel/pause signals, status, counters).
pub struct PipelineControls {
    pub status: Arc<Mutex<IndexingStatus>>,
    pub cancel: Arc<AtomicBool>,
    pub pause: Arc<AtomicBool>,
    pub app_handle: Option<tauri::AppHandle>,
    pub thumbnails_done_counter: Arc<AtomicUsize>,
}

/// Run the full import pipeline. Designed to be called from a background thread.
///
/// The pipeline is idempotent: running it twice on the same folder produces no duplicates.
/// Existing photos are skipped; stacks and logical_photos are rebuilt from scratch each run.
///
/// `app_handle`: pass `Some(handle)` from a Tauri command to emit `thumbnail-ready` events;
/// pass `None` in tests where no Tauri runtime is available.
#[allow(clippy::too_many_arguments)]
pub fn run_pipeline(
    conn: &Connection,
    project_id: i64,
    project_dir: &Path,
    folder_paths: Vec<PathBuf>,
    burst_gap_secs: u64,
    status: Arc<Mutex<IndexingStatus>>,
    cancel: Arc<AtomicBool>,
    pause: Arc<AtomicBool>,
    app_handle: Option<tauri::AppHandle>,
    thumbnails_done_counter: Arc<AtomicUsize>,
) -> ImportStats {
    let config = PipelineConfig {
        project_id,
        project_dir: project_dir.to_path_buf(),
        folder_paths,
        burst_gap_secs,
    };
    let controls = PipelineControls {
        status,
        cancel,
        pause,
        app_handle,
        thumbnails_done_counter,
    };
    run_pipeline_inner(conn, &config, &controls)
}

/// Internal pipeline implementation that uses structured config/controls.
fn run_pipeline_inner(
    conn: &Connection,
    config: &PipelineConfig,
    controls: &PipelineControls,
) -> ImportStats {
    let mut stats = ImportStats::default();
    let cache_dir = config.project_dir.join("cache").join("thumbnails");

    // ── STEP 1: Scan all folders ──────────────────────────────────────────────
    tracing::info!(
        "pipeline: scanning {} folder(s) for project_id={}",
        config.folder_paths.len(),
        config.project_id
    );

    let mut scanned_paths: Vec<scanner::ScannedPath> = Vec::new();

    for folder in &config.folder_paths {
        if controls.cancel.load(Ordering::SeqCst) {
            tracing::info!("pipeline: cancelled during scan");
            update_status(&controls.status, |s| s.cancelled = true);
            stats.cancelled = true;
            return stats;
        }

        let (paths, errors) = scanner::scan_directory(folder);
        stats.total_files_scanned += paths.len();
        for e in errors {
            log_error(&mut stats, e);
        }
        scanned_paths.extend(paths);
    }

    tracing::info!(
        "pipeline: scan complete — {} files found",
        stats.total_files_scanned
    );

    // ── STEP 2: Check existing photos (idempotency) ───────────────────────────
    // Load already-imported paths for this project.
    let existing_paths: std::collections::HashSet<String> =
        match repository::list_photo_paths_for_project(conn, config.project_id) {
            Ok(paths) => paths.into_iter().collect(),
            Err(e) => {
                tracing::warn!("pipeline: cannot load existing paths: {}", e);
                std::collections::HashSet::new()
            }
        };

    // Set total to ALL scanned files so re-index shows real progress too
    update_status(&controls.status, |s| {
        s.total = scanned_paths.len();
        s.processed = 0;
    });

    // ── STEP 3: Extract EXIF + build ScannedFile list ─────────────────────────
    if controls.cancel.load(Ordering::SeqCst) {
        update_status(&controls.status, |s| s.cancelled = true);
        stats.cancelled = true;
        return stats;
    }

    let mut new_files: Vec<ScannedFile> = Vec::new();

    for sp in scanned_paths {
        if controls.cancel.load(Ordering::SeqCst) {
            update_status(&controls.status, |s| s.cancelled = true);
            stats.cancelled = true;
            return stats;
        }
        while controls.pause.load(Ordering::SeqCst) {
            std::thread::sleep(std::time::Duration::from_millis(100));
            if controls.cancel.load(Ordering::SeqCst) {
                break;
            }
        }
        if controls.cancel.load(Ordering::SeqCst) {
            update_status(&controls.status, |s| s.cancelled = true);
            stats.cancelled = true;
            return stats;
        }

        let path_str = sp.path.to_string_lossy().to_string();
        if existing_paths.contains(&path_str) {
            stats.skipped_existing += 1;
            update_status(&controls.status, |s| s.processed += 1);
            continue;
        }

        let exif_data = exif::extract_exif(&sp.path, &sp.format);

        let base_name = sp
            .path
            .file_stem()
            .and_then(|s| s.to_str())
            .map(|s| s.to_lowercase())
            .unwrap_or_default();
        let dir = sp
            .path
            .parent()
            .map(|p| p.to_path_buf())
            .unwrap_or_default();

        new_files.push(ScannedFile {
            path: sp.path,
            format: sp.format,
            capture_time: exif_data.capture_time,
            camera_model: exif_data.camera_model,
            lens: exif_data.lens,
            orientation: exif_data.orientation,
            base_name,
            dir,
        });

        update_status(&controls.status, |s| s.processed += 1);
    }

    tracing::info!(
        "pipeline: EXIF extracted — {} new files, {} skipped",
        new_files.len(),
        stats.skipped_existing
    );

    if controls.cancel.load(Ordering::SeqCst) {
        update_status(&controls.status, |s| s.cancelled = true);
        stats.cancelled = true;
        return stats;
    }

    // ── STEP 4: Load existing files from DB for re-stacking ───────────────────
    // Load existing photos so they can be re-incorporated into pairs/stacks.
    let existing_scanned = repository::load_existing_scanned_files(conn);
    let all_files: Vec<ScannedFile> = existing_scanned.into_iter().chain(new_files).collect();

    // ── STEP 5: Pair detection ────────────────────────────────────────────────
    let groups = pairs::detect_pairs(all_files);
    let pairs_count = groups.iter().filter(|g| g.is_pair).count();
    stats.pairs_detected = pairs_count;
    tracing::info!(
        "pipeline: {} logical groups ({} pairs)",
        groups.len(),
        pairs_count
    );

    if controls.cancel.load(Ordering::SeqCst) {
        update_status(&controls.status, |s| s.cancelled = true);
        stats.cancelled = true;
        return stats;
    }

    // ── STEP 6: Stack assignment ──────────────────────────────────────────────
    let assigned = stacks::assign_stacks_by_burst(groups, config.burst_gap_secs);

    // Count distinct stacks
    let max_stack_idx = assigned
        .iter()
        .map(|(_, i)| *i)
        .max()
        .map(|m| m + 1)
        .unwrap_or(0);
    stats.stacks_generated = max_stack_idx;
    stats.logical_photos = assigned.len();

    tracing::info!(
        "pipeline: {} stacks, {} logical photos",
        stats.stacks_generated,
        stats.logical_photos
    );

    // ── STEP 7: DB writes ─────────────────────────────────────────────────────
    if controls.cancel.load(Ordering::SeqCst) {
        update_status(&controls.status, |s| s.cancelled = true);
        stats.cancelled = true;
        return stats;
    }

    // Clear old stacks/logical_photos so we can rebuild cleanly.
    if let Err(e) = repository::clear_stacks_and_logical_photos(conn, config.project_id) {
        let msg = format!("pipeline: failed to clear stacks: {}", e);
        tracing::warn!("{}", msg);
        log_error(&mut stats, msg);
        return stats;
    }

    // Map from stack_index → DB stack id
    let mut stack_id_map: Vec<Option<i64>> = vec![None; max_stack_idx.max(1)];

    // Pre-create all stack rows
    for idx in 0..max_stack_idx {
        match repository::insert_stack(conn, config.project_id) {
            Ok(id) => {
                if idx < stack_id_map.len() {
                    stack_id_map[idx] = Some(id);
                }
            }
            Err(e) => {
                let msg = format!("pipeline: insert stack {}: {}", idx, e);
                tracing::warn!("{}", msg);
                log_error(&mut stats, msg);
            }
        }
    }

    // Persist logical photos and link scanned files via shared function.
    let lp_thumb_targets = persist_groups_to_db(
        conn,
        &assigned,
        &stack_id_map,
        config.project_id,
        Some(&existing_paths),
        &mut stats,
    );

    tracing::info!(
        "pipeline: DB writes complete — imported={} skipped_existing={} errors={}",
        stats.imported,
        stats.skipped_existing,
        stats.errors
    );

    // After STEP 7 (DB writes complete — stacks ready to display):
    update_status(&controls.status, |s| {
        s.running = false; // Frontend can show grid now
        s.thumbnails_running = true; // Thumbnails still generating in background
        s.errors = stats.errors;
        s.last_stats = Some(stats.clone());
        s.thumbnails_total = lp_thumb_targets.len();
        s.thumbnails_done = 0;
    });

    // Reset the live counter to 0 before the pool starts
    controls.thumbnails_done_counter.store(0, Ordering::SeqCst);

    // ── STEP 8: Thumbnail generation (non-blocking from UI perspective) ───────
    if controls.cancel.load(Ordering::SeqCst) {
        update_status(&controls.status, |s| {
            s.cancelled = true;
            s.thumbnails_running = false;
        });
        stats.cancelled = true;
        return stats;
    }

    let n_threads = super::util::capped_num_threads();
    let pool = rayon::ThreadPoolBuilder::new()
        .num_threads(n_threads)
        .build()
        .unwrap_or_else(|_| {
            rayon::ThreadPoolBuilder::new()
                .num_threads(1)
                .build()
                .unwrap()
        });
    pool.install(|| {
        lp_thumb_targets
            .par_iter()
            .for_each(|(lp_id, path, format, orientation)| {
                if !controls.cancel.load(Ordering::SeqCst)
                    && thumbnails::generate_thumbnail(
                        path,
                        format,
                        *lp_id,
                        &cache_dir,
                        *orientation,
                    )
                    .is_some()
                {
                    controls
                        .thumbnails_done_counter
                        .fetch_add(1, Ordering::Relaxed);
                    if let Some(handle) = &controls.app_handle {
                        use tauri::Emitter;
                        let _ = handle.emit(
                            "thumbnail-ready",
                            ThumbnailReadyPayload {
                                logical_photo_id: *lp_id,
                            },
                        );
                    }
                }
            });
    });

    // Mark thumbnails done
    update_status(&controls.status, |s| {
        s.thumbnails_running = false;
    });
    stats
}

/// Persist assigned logical groups to the database: insert logical_photo rows,
/// link scanned files, and handle RAW+JPEG pairs.
///
/// Returns thumbnail targets `(lp_id, path, format, orientation)` for each
/// successfully persisted logical photo.
///
/// `existing_paths`: if `Some`, tracks which paths are new imports (incrementing
/// `stats.imported`). Pass `None` when all files are already in the DB (e.g. restack).
fn persist_groups_to_db(
    conn: &Connection,
    assigned: &[(LogicalGroup, usize)],
    stack_id_map: &[Option<i64>],
    project_id: i64,
    existing_paths: Option<&std::collections::HashSet<String>>,
    stats: &mut ImportStats,
) -> Vec<(i64, PathBuf, PhotoFormat, Option<u16>)> {
    let empty_set = std::collections::HashSet::new();
    let paths_ref = existing_paths.unwrap_or(&empty_set);
    let track_imports = existing_paths.is_some();

    let mut lp_thumb_targets: Vec<(i64, PathBuf, PhotoFormat, Option<u16>)> = Vec::new();

    for (group, stack_idx) in assigned {
        let stack_db_id = match stack_id_map.get(*stack_idx).and_then(|o| *o) {
            Some(id) => id,
            None => {
                let msg = format!("persist: no stack DB id for index {}", stack_idx);
                tracing::warn!("{}", msg);
                log_error(stats, msg);
                continue;
            }
        };

        let representative = group.representative();

        let representative_id = match insert_scanned_file(conn, representative) {
            Ok(id) => id,
            Err(e) => {
                let msg = format!("persist: insert photo {:?}: {}", representative.path, e);
                tracing::warn!("{}", msg);
                log_error(stats, msg);
                continue;
            }
        };

        // Track new imports when existing_paths is provided
        if track_imports {
            let representative_path = representative.path.to_string_lossy().to_string();
            if !paths_ref.contains(&representative_path) {
                stats.imported += 1;
            }
        }

        // Insert logical photo row
        let lp_id = match repository::insert_logical_photo(
            conn,
            project_id,
            representative_id,
            stack_db_id,
        ) {
            Ok(id) => id,
            Err(e) => {
                let msg = format!("persist: insert logical_photo: {}", e);
                tracing::warn!("{}", msg);
                log_error(stats, msg);
                continue;
            }
        };

        // Link representative photo → logical_photo
        if let Err(e) = repository::set_logical_photo_id(conn, representative_id, lp_id) {
            tracing::warn!(
                "persist: set_logical_photo_id on {}: {}",
                representative_id,
                e
            );
        }

        // For pairs, also insert the non-representative file
        if group.is_pair {
            let other_opt = group
                .raw
                .as_ref()
                .filter(|f| f.path != representative.path)
                .or_else(|| {
                    group
                        .jpeg
                        .as_ref()
                        .filter(|f| f.path != representative.path)
                });

            if let Some(other) = other_opt {
                match insert_scanned_file(conn, other) {
                    Ok(other_id) => {
                        if let Err(e) = repository::set_logical_photo_id(conn, other_id, lp_id) {
                            tracing::warn!(
                                "persist: set_logical_photo_id on other {}: {}",
                                other_id,
                                e
                            );
                        }
                        if track_imports {
                            let other_path = other.path.to_string_lossy().to_string();
                            if !paths_ref.contains(&other_path) {
                                stats.imported += 1;
                            }
                        }
                    }
                    Err(e) => {
                        let msg = format!("persist: insert paired photo {:?}: {}", other.path, e);
                        tracing::warn!("{}", msg);
                        log_error(stats, msg);
                    }
                }
            }
        }

        lp_thumb_targets.push((
            lp_id,
            representative.path.clone(),
            representative.format.clone(),
            representative.orientation,
        ));
    }

    lp_thumb_targets
}

/// Insert a ScannedFile into the photos table and return its row id.
/// Converts the in-memory representation to the column types expected by the DB.
fn insert_scanned_file(conn: &Connection, file: &ScannedFile) -> rusqlite::Result<i64> {
    let path = file.path.to_string_lossy();
    let capture_time_rfc = file.capture_time.as_ref().map(|t| t.to_rfc3339());
    repository::insert_photo(
        conn,
        &path,
        file.format.as_str(),
        capture_time_rfc.as_deref(),
        file.orientation,
        file.camera_model.as_deref(),
        file.lens.as_deref(),
    )
}

/// Record an error in stats (increments counter + appends to log if < 100 entries).
fn log_error(stats: &mut ImportStats, msg: String) {
    stats.errors += 1;
    if stats.error_log.len() < 100 {
        stats.error_log.push(msg);
    }
}

fn update_status<F: FnOnce(&mut IndexingStatus)>(status: &Arc<Mutex<IndexingStatus>>, f: F) {
    if let Ok(mut lock) = status.lock() {
        f(&mut lock);
    }
}

/// Find logical photo targets that are missing thumbnails on disk.
///
/// Returns `(missing_targets, total_lp_count)` where `missing_targets` contains
/// `(lp_id, source_path, PhotoFormat, orientation)` for each LP without a cached thumbnail.
#[allow(clippy::type_complexity)]
pub fn find_missing_thumbnail_targets(
    conn: &Connection,
    project_id: i64,
    cache_dir: &Path,
) -> Result<(Vec<(i64, PathBuf, PhotoFormat, Option<u16>)>, usize), String> {
    // Get all lp_ids for this project (one per logical photo, not one per stack)
    let all_lp_ids =
        repository::list_all_lp_ids_for_project(conn, project_id).map_err(|e| e.to_string())?;
    let total_lp_count = all_lp_ids.len();

    // Find which thumbnails already exist on disk
    let existing = crate::import::util::cached_thumbnail_ids(cache_dir);

    let missing_ids: Vec<i64> = all_lp_ids
        .into_iter()
        .filter(|id| !existing.contains(id))
        .collect();

    if missing_ids.is_empty() {
        return Ok((vec![], total_lp_count));
    }

    let missing_targets =
        repository::list_representative_photos_for_lp_ids(conn, project_id, &missing_ids)
            .map_err(|e| e.to_string())?;
    Ok((missing_targets, total_lp_count))
}

/// Re-stack all existing photos for a project without re-scanning the filesystem.
///
/// Preserves logical_photo IDs (and therefore thumbnail filenames) by only
/// deleting stacks and updating each logical_photo's stack_id in place.
///
/// Does NOT scan the filesystem (steps 1-3) or generate thumbnails (step 8).
/// Intended for re-stacking after settings changes (e.g. burst gap).
pub fn restack_from_existing_photos(
    conn: &Connection,
    project_id: i64,
    burst_gap_secs: u64,
) -> Result<ImportStats, String> {
    let mut stats = ImportStats::default();

    // Record the global max stack ID before clearing, so we can seed the rowid sequence
    // above it after the delete (SQLite without AUTOINCREMENT reuses IDs after DELETE).
    let max_stack_id_before: i64 = conn
        .query_row("SELECT COALESCE(MAX(id), 0) FROM stacks", [], |row| {
            row.get(0)
        })
        .unwrap_or(0);

    // Load existing logical_photos with capture times BEFORE clearing stacks.
    let lp_rows = repository::load_logical_photos_for_restack(conn, project_id)
        .map_err(|e| format!("restack: load logical photos: {}", e))?;

    if lp_rows.is_empty() {
        return Ok(stats);
    }

    stats.logical_photos = lp_rows.len();

    // Clear only stacks (preserves logical_photo rows).
    repository::clear_stacks_only(conn, project_id)
        .map_err(|e| format!("restack: clear stacks: {}", e))?;

    // Separate into timed and untimed logical photos.
    let mut timed: Vec<(i64, chrono::DateTime<chrono::Utc>)> = Vec::new();
    let mut untimed: Vec<i64> = Vec::new();

    for (lp_id, capture_time_str) in &lp_rows {
        if let Some(ref ct_str) = capture_time_str {
            if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(ct_str) {
                timed.push((*lp_id, dt.with_timezone(&chrono::Utc)));
                continue;
            }
        }
        untimed.push(*lp_id);
    }

    // Sort timed by capture_time
    timed.sort_by_key(|(_, t)| *t);

    // Apply consecutive-gap burst algorithm (same logic as assign_stacks_clean).
    // Build: Vec<(lp_id, stack_index)>
    let mut assignments: Vec<(i64, usize)> = Vec::new();
    let mut stack_index: usize = 0;
    let mut last_time: Option<chrono::DateTime<chrono::Utc>> = None;

    for (lp_id, t) in &timed {
        if let Some(prev) = last_time {
            let gap = (*t - prev).num_seconds().unsigned_abs();
            if gap > burst_gap_secs {
                stack_index += 1;
            }
        }
        last_time = Some(*t);
        assignments.push((*lp_id, stack_index));
    }

    // Each untimed gets its own solo stack
    for lp_id in &untimed {
        stack_index += 1;
        assignments.push((*lp_id, stack_index));
    }

    let max_stack_idx = assignments
        .iter()
        .map(|(_, i)| *i)
        .max()
        .map(|m| m + 1)
        .unwrap_or(0);
    stats.stacks_generated = max_stack_idx;

    // Pre-create all stack rows with ID-seeding to avoid SQLite rowid reuse.
    let mut stack_id_map: Vec<Option<i64>> = vec![None; max_stack_idx.max(1)];
    let mut first_stack_inserted = false;
    for idx in 0..max_stack_idx {
        let result = if !first_stack_inserted && max_stack_id_before > 0 {
            let explicit_id = max_stack_id_before + 1;
            let now = chrono::Utc::now().to_rfc3339();
            conn.execute(
                "INSERT INTO stacks (id, project_id, created_at) VALUES (?1, ?2, ?3)",
                rusqlite::params![explicit_id, project_id, now],
            )
            .map(|_| explicit_id)
        } else {
            repository::insert_stack(conn, project_id)
        };
        first_stack_inserted = true;
        match result {
            Ok(id) => {
                if idx < stack_id_map.len() {
                    stack_id_map[idx] = Some(id);
                }
            }
            Err(e) => {
                log_error(&mut stats, format!("restack: insert stack {}: {}", idx, e));
            }
        }
    }

    // UPDATE existing logical_photos with new stack_ids (no delete/insert).
    for (lp_id, stack_idx) in &assignments {
        let stack_db_id = match stack_id_map.get(*stack_idx).and_then(|o| *o) {
            Some(id) => id,
            None => {
                let msg = format!("restack: no stack DB id for index {}", stack_idx);
                tracing::warn!("{}", msg);
                log_error(&mut stats, msg);
                continue;
            }
        };

        if let Err(e) = repository::update_logical_photo_stack(conn, *lp_id, stack_db_id) {
            let msg = format!("restack: update lp {} stack: {}", lp_id, e);
            tracing::warn!("{}", msg);
            log_error(&mut stats, msg);
        }
    }

    tracing::info!(
        "restack: complete — logical_photos={} stacks={} errors={}",
        stats.logical_photos,
        stats.stacks_generated,
        stats.errors,
    );

    Ok(stats)
}

#[cfg(test)]
mod tests {
    use super::ThumbnailReadyPayload;

    #[test]
    fn test_thumbnail_ready_payload_serializes_correctly() {
        // WHY (Rule 1): ThumbnailReadyPayload must serialize to exactly
        // {"logical_photo_id": 42}. The frontend listen('thumbnail-ready', cb)
        // receives this payload — if the field name changes the JS side silently
        // gets undefined and the progressive refresh stops working.
        let payload = ThumbnailReadyPayload {
            logical_photo_id: 42,
        };
        let json = serde_json::to_string(&payload).expect("must serialize");
        assert_eq!(json, r#"{"logical_photo_id":42}"#);
    }
}
