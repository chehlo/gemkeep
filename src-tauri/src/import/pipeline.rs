use crate::import::{exif, pairs, scanner, stacks, thumbnails};
use crate::photos::model::{ImportStats, IndexingStatus, PhotoFormat, ScannedFile};
use crate::photos::repository;
use rusqlite::Connection;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

/// Run the full import pipeline. Designed to be called from a background thread.
///
/// The pipeline is idempotent: running it twice on the same folder produces no duplicates.
/// Existing photos are skipped; stacks and logical_photos are rebuilt from scratch each run.
pub fn run_pipeline(
    conn: &Connection,
    project_id: i64,
    project_dir: &Path,
    folder_paths: Vec<PathBuf>,
    burst_gap_secs: u64,
    status: Arc<Mutex<IndexingStatus>>,
    cancel: Arc<AtomicBool>,
) -> ImportStats {
    let mut stats = ImportStats::default();
    let cache_dir = project_dir.join("cache").join("thumbnails");

    // ── STEP 1: Scan all folders ──────────────────────────────────────────────
    tracing::info!(
        "pipeline: scanning {} folder(s) for project_id={}",
        folder_paths.len(),
        project_id
    );

    let mut scanned_paths: Vec<scanner::ScannedPath> = Vec::new();

    for folder in &folder_paths {
        if cancel.load(Ordering::SeqCst) {
            tracing::info!("pipeline: cancelled during scan");
            update_status(&status, |s| s.cancelled = true);
            stats.cancelled = true;
            return stats;
        }

        let (paths, errors) = scanner::scan_directory(folder);
        stats.total_files_scanned += paths.len();
        for e in errors {
            log_error(&mut stats, e);
        }
        scanned_paths.extend(paths);

        update_status(&status, |s| s.total = stats.total_files_scanned);
    }

    tracing::info!(
        "pipeline: scan complete — {} files found",
        stats.total_files_scanned
    );

    // ── STEP 2: Check existing photos (idempotency) ───────────────────────────
    // Load already-imported paths for this project.
    let existing_paths: std::collections::HashSet<String> =
        match repository::list_photo_paths_for_project(conn, project_id) {
            Ok(paths) => paths.into_iter().collect(),
            Err(e) => {
                tracing::warn!("pipeline: cannot load existing paths: {}", e);
                std::collections::HashSet::new()
            }
        };

    // ── STEP 3: Extract EXIF + build ScannedFile list ─────────────────────────
    if cancel.load(Ordering::SeqCst) {
        update_status(&status, |s| s.cancelled = true);
        stats.cancelled = true;
        return stats;
    }

    let mut new_files: Vec<ScannedFile> = Vec::new();

    for sp in scanned_paths {
        let path_str = sp.path.to_string_lossy().to_string();
        if existing_paths.contains(&path_str) {
            stats.skipped_existing += 1;
            update_status(&status, |s| s.processed += 1);
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

        update_status(&status, |s| s.processed += 1);
    }

    tracing::info!(
        "pipeline: EXIF extracted — {} new files, {} skipped",
        new_files.len(),
        stats.skipped_existing
    );

    if cancel.load(Ordering::SeqCst) {
        update_status(&status, |s| s.cancelled = true);
        stats.cancelled = true;
        return stats;
    }

    // ── STEP 4: Load existing files from DB for re-stacking ───────────────────
    // Load existing photos so they can be re-incorporated into pairs/stacks.
    let existing_scanned = load_existing_scanned_files(conn);
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

    if cancel.load(Ordering::SeqCst) {
        update_status(&status, |s| s.cancelled = true);
        stats.cancelled = true;
        return stats;
    }

    // ── STEP 6: Stack assignment ──────────────────────────────────────────────
    let assigned = stacks::assign_stacks_by_burst(groups, burst_gap_secs);

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
    if cancel.load(Ordering::SeqCst) {
        update_status(&status, |s| s.cancelled = true);
        stats.cancelled = true;
        return stats;
    }

    // Clear old stacks/logical_photos so we can rebuild cleanly.
    if let Err(e) = repository::clear_stacks_and_logical_photos(conn, project_id) {
        let msg = format!("pipeline: failed to clear stacks: {}", e);
        tracing::warn!("{}", msg);
        log_error(&mut stats, msg);
        return stats;
    }

    // Map from stack_index → DB stack id
    let mut stack_id_map: Vec<Option<i64>> = vec![None; max_stack_idx.max(1)];

    // Pre-create all stack rows
    for idx in 0..max_stack_idx {
        match repository::insert_stack(conn, project_id) {
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

    // (lp_id, path, format) for thumbnail generation after DB writes
    let mut lp_thumb_targets: Vec<(i64, PathBuf, PhotoFormat)> = Vec::new();

    for (group, stack_idx) in &assigned {
        let stack_db_id = match stack_id_map.get(*stack_idx).and_then(|o| *o) {
            Some(id) => id,
            None => {
                let msg = format!("pipeline: no stack DB id for index {}", stack_idx);
                tracing::warn!("{}", msg);
                log_error(&mut stats, msg);
                continue;
            }
        };

        let representative = group.representative();
        let representative_path = representative.path.to_string_lossy().to_string();
        let rep_fmt = photo_format_str(&representative.format);

        let representative_id = match repository::insert_photo(
            conn,
            &representative_path,
            rep_fmt,
            representative
                .capture_time
                .as_ref()
                .map(|t| t.to_rfc3339())
                .as_deref(),
            representative.orientation,
            representative.camera_model.as_deref(),
            representative.lens.as_deref(),
        ) {
            Ok(id) => id,
            Err(e) => {
                let msg = format!("pipeline: insert photo {:?}: {}", representative.path, e);
                tracing::warn!("{}", msg);
                log_error(&mut stats, msg);
                continue;
            }
        };

        // Track new imports
        if !existing_paths.contains(&representative_path) {
            stats.imported += 1;
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
                let msg = format!("pipeline: insert logical_photo: {}", e);
                tracing::warn!("{}", msg);
                log_error(&mut stats, msg);
                continue;
            }
        };

        // Link representative photo → logical_photo
        if let Err(e) = repository::set_logical_photo_id(conn, representative_id, lp_id) {
            tracing::warn!("set logical_photo_id on {}: {}", representative_id, e);
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
                let other_path = other.path.to_string_lossy().to_string();
                let other_fmt = photo_format_str(&other.format);
                match repository::insert_photo(
                    conn,
                    &other_path,
                    other_fmt,
                    other
                        .capture_time
                        .as_ref()
                        .map(|t| t.to_rfc3339())
                        .as_deref(),
                    other.orientation,
                    other.camera_model.as_deref(),
                    other.lens.as_deref(),
                ) {
                    Ok(other_id) => {
                        if let Err(e) = repository::set_logical_photo_id(conn, other_id, lp_id) {
                            tracing::warn!("set logical_photo_id on other {}: {}", other_id, e);
                        }
                        if !existing_paths.contains(&other_path) {
                            stats.imported += 1;
                        }
                    }
                    Err(e) => {
                        let msg = format!("pipeline: insert paired photo {:?}: {}", other.path, e);
                        tracing::warn!("{}", msg);
                        log_error(&mut stats, msg);
                    }
                }
            }
        }

        lp_thumb_targets.push((
            lp_id,
            representative.path.clone(),
            representative.format.clone(),
        ));
    }

    tracing::info!(
        "pipeline: DB writes complete — imported={} skipped_existing={} errors={}",
        stats.imported,
        stats.skipped_existing,
        stats.errors
    );

    // ── STEP 8: Thumbnail generation ──────────────────────────────────────────
    if cancel.load(Ordering::SeqCst) {
        update_status(&status, |s| s.cancelled = true);
        stats.cancelled = true;
        update_status_with_stats(&status, &stats, false);
        return stats;
    }

    for (lp_id, path, format) in &lp_thumb_targets {
        if cancel.load(Ordering::SeqCst) {
            break;
        }
        // Non-fatal; thumbnail_path remains NULL if this returns None
        thumbnails::generate_thumbnail(path, format, *lp_id, &cache_dir);
    }

    // ── Done ──────────────────────────────────────────────────────────────────
    update_status_with_stats(&status, &stats, false);
    stats
}

fn photo_format_str(format: &PhotoFormat) -> &'static str {
    match format {
        PhotoFormat::Jpeg => "jpeg",
        PhotoFormat::Raw => "raw",
    }
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

fn update_status_with_stats(
    status: &Arc<Mutex<IndexingStatus>>,
    stats: &ImportStats,
    running: bool,
) {
    update_status(status, |s| {
        s.running = running;
        s.errors = stats.errors;
        s.last_stats = Some(stats.clone());
    });
}

/// Load existing photos from DB and reconstruct ScannedFile structs for re-stacking.
/// After `clear_stacks_and_logical_photos`, all photos have logical_photo_id = NULL
/// but still exist in the photos table. We reload them to re-pair and re-stack.
fn load_existing_scanned_files(conn: &Connection) -> Vec<ScannedFile> {
    let mut stmt = match conn
        .prepare("SELECT path, format, capture_time, orientation, camera_model, lens FROM photos")
    {
        Ok(s) => s,
        Err(e) => {
            tracing::warn!("load_existing_scanned_files prepare: {}", e);
            return vec![];
        }
    };

    let rows = stmt.query_map([], |row| {
        let path_str: String = row.get(0)?;
        let format_str: String = row.get(1)?;
        let capture_time_str: Option<String> = row.get(2)?;
        let orientation: Option<u16> = row.get(3)?;
        let camera_model: Option<String> = row.get(4)?;
        let lens: Option<String> = row.get(5)?;
        Ok((
            path_str,
            format_str,
            capture_time_str,
            orientation,
            camera_model,
            lens,
        ))
    });

    let rows = match rows {
        Ok(r) => r,
        Err(e) => {
            tracing::warn!("load_existing_scanned_files query: {}", e);
            return vec![];
        }
    };

    let mut files = Vec::new();
    for row in rows.flatten() {
        let (path_str, format_str, capture_time_str, orientation, camera_model, lens) = row;
        let path = PathBuf::from(&path_str);
        let format = match format_str.as_str() {
            "jpeg" => PhotoFormat::Jpeg,
            "raw" => PhotoFormat::Raw,
            _ => continue,
        };
        let capture_time = capture_time_str.as_deref().and_then(|s| {
            chrono::DateTime::parse_from_rfc3339(s)
                .ok()
                .map(|dt| dt.with_timezone(&chrono::Utc))
        });
        let base_name = path
            .file_stem()
            .and_then(|s| s.to_str())
            .map(|s| s.to_lowercase())
            .unwrap_or_default();
        let dir = path.parent().map(|p| p.to_path_buf()).unwrap_or_default();

        files.push(ScannedFile {
            path,
            format,
            capture_time,
            camera_model,
            lens,
            orientation,
            base_name,
            dir,
        });
    }

    files
}
