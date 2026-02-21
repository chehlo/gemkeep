use crate::db::{open_connection, run_migrations};
use crate::import::pipeline;
use crate::photos::model::{IndexingStatus, LogicalPhotoSummary, SourceFolderRow, StackSummary};
use crate::photos::repository;
use crate::projects::manager;
use crate::projects::model::Project;
use crate::state::AppState;
use rusqlite::Connection;
use std::sync::atomic::Ordering;
use std::sync::MutexGuard;
use tauri::State;

// ── Lock helpers ──────────────────────────────────────────────────────────────

type ProjectGuards<'s> = (
    MutexGuard<'s, Option<Connection>>,
    MutexGuard<'s, Option<Project>>,
);

/// Acquire `db` and `active_project` locks in the correct order, verify that
/// the caller-supplied `slug` matches the open project, and return guards that
/// keep both locks alive for the duration of the caller's scope.
///
/// Callers obtain `&Connection` via `db_guard.as_ref().unwrap()` and
/// `&Project` via `project_guard.as_ref().unwrap()`.
fn with_open_project<'s>(state: &'s AppState, slug: &str) -> Result<ProjectGuards<'s>, String> {
    let db_guard = state.db.lock().map_err(|_| "lock poisoned".to_string())?;
    if db_guard.is_none() {
        return Err("No project open".to_string());
    }

    let project_guard = state
        .active_project
        .lock()
        .map_err(|_| "lock poisoned".to_string())?;
    let project = project_guard
        .as_ref()
        .ok_or_else(|| "No project open".to_string())?;

    if project.slug != slug {
        return Err(format!(
            "Slug mismatch: expected {}, got {}",
            project.slug, slug
        ));
    }

    Ok((db_guard, project_guard))
}

// ── Source folder management ──────────────────────────────────────────────────

#[tauri::command]
pub fn add_source_folder(
    slug: String,
    path: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    // Validate the path exists on disk
    let p = std::path::Path::new(&path);
    if !p.exists() {
        return Err(format!("Path does not exist: {}", path));
    }
    if !p.is_dir() {
        return Err(format!("Path is not a directory: {}", path));
    }

    let (db_guard, project_guard) = with_open_project(&state, &slug)?;
    let conn = db_guard.as_ref().unwrap();
    let project = project_guard.as_ref().unwrap();

    if repository::folder_already_attached(conn, project.id, &path).map_err(|e| e.to_string())? {
        return Err(format!("Folder already attached: {}", path));
    }

    repository::add_source_folder(conn, project.id, &path).map_err(|e| e.to_string())?;

    manager::append_operation_log(
        &state.gemkeep_home,
        &slug,
        &format!("SOURCE_FOLDER_ADDED path={}", path),
    );

    tracing::info!("add_source_folder: slug={} path={}", slug, path);
    Ok(())
}

#[tauri::command]
pub fn remove_source_folder(
    slug: String,
    folder_id: i64,
    state: State<'_, AppState>,
) -> Result<(), String> {
    // Block while indexing
    {
        let status = state
            .indexing_status
            .lock()
            .map_err(|_| "lock poisoned".to_string())?;
        if status.running {
            return Err("Cannot remove folder while indexing is in progress".to_string());
        }
    }

    let (db_guard, project_guard) = with_open_project(&state, &slug)?;
    let conn = db_guard.as_ref().unwrap();
    let project = project_guard.as_ref().unwrap();

    // Get path for logging before deleting
    let folders = repository::list_source_folders(conn, project.id).map_err(|e| e.to_string())?;
    let path_opt = folders
        .iter()
        .find(|f| f.id == folder_id)
        .map(|f| f.path.clone());

    repository::remove_source_folder(conn, project.id, folder_id).map_err(|e| e.to_string())?;

    if let Some(path) = path_opt {
        manager::append_operation_log(
            &state.gemkeep_home,
            &slug,
            &format!("SOURCE_FOLDER_REMOVED path={}", path),
        );
    }

    tracing::info!(
        "remove_source_folder: slug={} folder_id={}",
        slug,
        folder_id
    );
    Ok(())
}

#[tauri::command]
pub fn list_source_folders(
    slug: String,
    state: State<'_, AppState>,
) -> Result<Vec<SourceFolderRow>, String> {
    let (db_guard, project_guard) = with_open_project(&state, &slug)?;
    let conn = db_guard.as_ref().unwrap();
    let project = project_guard.as_ref().unwrap();

    repository::list_source_folders(conn, project.id).map_err(|e| e.to_string())
}

// ── Indexing ──────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn start_indexing(
    slug: String,
    state: State<'_, AppState>,
    _app_handle: tauri::AppHandle,
) -> Result<(), String> {
    // Guard: already running?
    {
        let status = state
            .indexing_status
            .lock()
            .map_err(|_| "lock poisoned".to_string())?;
        if status.running {
            return Err("Indexing is already running".to_string());
        }
    }

    // Collect everything needed for the background thread while locks are held.
    let (project_id, project_dir, folder_paths, burst_gap_secs) = {
        let (db_guard, project_guard) = with_open_project(&state, &slug)?;
        let conn = db_guard.as_ref().unwrap();
        let project = project_guard.as_ref().unwrap();

        let folders =
            repository::list_source_folders(conn, project.id).map_err(|e| e.to_string())?;

        if folders.is_empty() {
            return Err("No source folders attached to this project".to_string());
        }

        let folder_paths: Vec<std::path::PathBuf> = folders
            .iter()
            .map(|f| std::path::PathBuf::from(&f.path))
            .collect();

        let config = manager::read_config(&state.gemkeep_home).unwrap_or_default();
        let burst_gap_secs = config.burst_gap_secs;
        let project_dir = manager::project_dir(&state.gemkeep_home, &slug);
        let project_id = project.id;

        (project_id, project_dir, folder_paths, burst_gap_secs)
    };

    // Clear stale thumbnail cache so re-index starts fresh
    let thumb_dir = project_dir.join("cache").join("thumbnails");
    if thumb_dir.exists() {
        if let Err(e) = std::fs::remove_dir_all(&thumb_dir) {
            tracing::warn!("start_indexing: cannot clear thumbnail cache: {}", e);
        }
    }

    // Reset cancel and pause flags, then mark as running
    state.cancel_indexing.store(false, Ordering::SeqCst);
    state.pause_indexing.store(false, Ordering::SeqCst);
    {
        let mut status = state
            .indexing_status
            .lock()
            .map_err(|_| "lock poisoned".to_string())?;
        *status = IndexingStatus {
            running: true,
            thumbnails_running: false,
            total: 0,
            processed: 0,
            errors: 0,
            cancelled: false,
            paused: false,
            last_stats: None,
        };
    }

    // Log start
    manager::append_operation_log(
        &state.gemkeep_home,
        &slug,
        &format!(
            "INDEX_STARTED folders={} burst_gap_secs={}",
            folder_paths.len(),
            burst_gap_secs
        ),
    );

    // Clone Arcs for the background thread — no reference to AppState or State<> crosses the boundary
    let status_arc = std::sync::Arc::clone(&state.indexing_status);
    let cancel_arc = std::sync::Arc::clone(&state.cancel_indexing);
    let pause_arc = std::sync::Arc::clone(&state.pause_indexing);
    let gemkeep_home = state.gemkeep_home.clone();

    std::thread::spawn(move || {
        // Open a fresh DB connection in the background thread.
        // rusqlite::Connection is !Send, so we cannot move the main connection.
        let db_path = project_dir.join("project.db");
        let conn = match open_connection(&db_path) {
            Ok(c) => c,
            Err(e) => {
                tracing::warn!("start_indexing background: cannot open DB: {}", e);
                if let Ok(mut s) = status_arc.lock() {
                    s.running = false;
                    s.errors = 1;
                    s.last_stats = Some(crate::photos::model::ImportStats {
                        errors: 1,
                        error_log: vec![format!("Cannot open DB: {}", e)],
                        ..Default::default()
                    });
                }
                return;
            }
        };
        if let Err(e) = run_migrations(&conn) {
            tracing::warn!("start_indexing background: migrations: {}", e);
        }

        let stats = pipeline::run_pipeline(
            &conn,
            project_id,
            &project_dir,
            folder_paths.clone(),
            burst_gap_secs,
            std::sync::Arc::clone(&status_arc),
            std::sync::Arc::clone(&cancel_arc),
            std::sync::Arc::clone(&pause_arc),
        );

        // Log completion
        let event = if stats.cancelled {
            format!(
                "INDEX_CANCELLED processed={} total={}",
                stats.imported, stats.total_files_scanned
            )
        } else {
            format!(
                "INDEX_COMPLETED photos={} logical_photos={} stacks={} errors={}",
                stats.imported + stats.skipped_existing,
                stats.logical_photos,
                stats.stacks_generated,
                stats.errors
            )
        };
        manager::append_operation_log(&gemkeep_home, &slug, &event);

        // Mark indexing as done
        if let Ok(mut s) = status_arc.lock() {
            s.running = false;
            s.cancelled = stats.cancelled;
            s.last_stats = Some(stats);
        }
    });

    Ok(())
}

#[tauri::command]
pub fn cancel_indexing(state: State<'_, AppState>) -> Result<(), String> {
    state.cancel_indexing.store(true, Ordering::SeqCst);
    // Also clear pause so the thread can see the cancel signal
    state.pause_indexing.store(false, Ordering::SeqCst);
    tracing::info!("cancel_indexing: signal sent");
    Ok(())
}

#[tauri::command]
pub fn pause_indexing(state: State<'_, AppState>) -> Result<(), String> {
    state.pause_indexing.store(true, Ordering::SeqCst);
    if let Ok(mut s) = state.indexing_status.lock() {
        s.paused = true;
    }
    tracing::info!("pause_indexing: signal sent");
    Ok(())
}

#[tauri::command]
pub fn resume_indexing(state: State<'_, AppState>) -> Result<(), String> {
    state.pause_indexing.store(false, Ordering::SeqCst);
    if let Ok(mut s) = state.indexing_status.lock() {
        s.paused = false;
    }
    tracing::info!("resume_indexing: signal sent");
    Ok(())
}

#[tauri::command]
pub fn get_indexing_status(state: State<'_, AppState>) -> Result<IndexingStatus, String> {
    state
        .indexing_status
        .lock()
        .map_err(|_| "lock poisoned".to_string())
        .map(|s| s.clone())
}

// ── Stack listing ─────────────────────────────────────────────────────────────

#[tauri::command]
pub fn list_stacks(slug: String, state: State<'_, AppState>) -> Result<Vec<StackSummary>, String> {
    let (db_guard, project_guard) = with_open_project(&state, &slug)?;
    let conn = db_guard.as_ref().unwrap();
    let project = project_guard.as_ref().unwrap();

    let mut summaries =
        repository::list_stacks_summary(conn, project.id).map_err(|e| e.to_string())?;

    let cache_dir = manager::project_dir(&state.gemkeep_home, &slug)
        .join("cache")
        .join("thumbnails");

    // Batch: one SQL query instead of N queries
    let lp_ids = repository::list_first_lp_ids_for_project(conn, project.id).unwrap_or_default();

    // One readdir instead of N exists() calls
    let existing_thumbs: std::collections::HashSet<i64> = if cache_dir.exists() {
        std::fs::read_dir(&cache_dir)
            .into_iter()
            .flatten()
            .filter_map(|e| e.ok())
            .filter_map(|e| {
                e.file_name()
                    .to_str()
                    .and_then(|s| s.strip_suffix(".jpg"))
                    .and_then(|s| s.parse::<i64>().ok())
            })
            .collect()
    } else {
        std::collections::HashSet::new()
    };

    for summary in &mut summaries {
        if let Some(&lp_id) = lp_ids.get(&summary.stack_id) {
            if existing_thumbs.contains(&lp_id) {
                summary.thumbnail_path = Some(
                    cache_dir
                        .join(format!("{}.jpg", lp_id))
                        .to_string_lossy()
                        .into_owned(),
                );
            }
        }
    }

    Ok(summaries)
}

// ── Logical photo listing ──────────────────────────────────────────────────────

#[tauri::command]
pub fn list_logical_photos(
    slug: String,
    stack_id: i64,
    state: State<'_, AppState>,
) -> Result<Vec<LogicalPhotoSummary>, String> {
    let (db_guard, _project_guard) = with_open_project(&state, &slug)?;
    let conn = db_guard.as_ref().unwrap();

    let cache_dir = manager::project_dir(&state.gemkeep_home, &slug)
        .join("cache")
        .join("thumbnails");

    repository::list_logical_photos_by_stack(conn, stack_id, &cache_dir)
        .map_err(|e| e.to_string())
}
