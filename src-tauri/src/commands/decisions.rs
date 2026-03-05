use crate::decisions::engine;
use crate::decisions::model::{
    DecisionAction, DecisionResult, PhotoDecisionStatus, PhotoDetail, RoundStatus,
};
use crate::photos::repository;
use crate::projects::manager;
use crate::state::AppState;
use rusqlite::{Connection, OptionalExtension};
use std::sync::MutexGuard;
use tauri::State;

type ProjectGuards<'s> = (
    MutexGuard<'s, Option<Connection>>,
    MutexGuard<'s, Option<crate::projects::model::Project>>,
);

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

/// Record a keep or eliminate decision for a logical photo.
/// Auto-creates Round 1 if no open round exists.
#[tauri::command]
pub fn make_decision(
    slug: String,
    logical_photo_id: i64,
    action: String,
    state: State<'_, AppState>,
) -> Result<DecisionResult, String> {
    let (db_guard, project_guard) = with_open_project(&state, &slug)?;
    let conn = db_guard.as_ref().unwrap();
    let project = project_guard.as_ref().unwrap();

    // Parse the action
    let decision_action = match action.as_str() {
        "keep" => DecisionAction::Keep,
        "eliminate" => DecisionAction::Eliminate,
        _ => return Err(format!("Invalid action: {}", action)),
    };

    // Get the stack_id for this logical photo to find/create a round
    let stack_id: i64 = conn
        .query_row(
            "SELECT stack_id FROM logical_photos WHERE id = ?1",
            rusqlite::params![logical_photo_id],
            |row| row.get(0),
        )
        .map_err(|e| format!("Logical photo {} not found: {}", logical_photo_id, e))?;

    // Check if the most recent round for this stack is committed — if so, reject
    // (multi-round is deferred; once committed, no more decisions allowed)
    {
        let committed_check: Option<String> = conn
            .query_row(
                "SELECT state FROM rounds WHERE project_id = ?1 AND scope = 'stack' AND scope_id = ?2 ORDER BY id DESC LIMIT 1",
                rusqlite::params![project.id, stack_id],
                |row| row.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?;
        if committed_check.as_deref() == Some("committed") {
            return Err("Cannot make decisions on a committed round".to_string());
        }
    }

    // Find or create round
    let (round_id, was_created) =
        engine::find_or_create_round(conn, project.id, stack_id).map_err(|e| e.to_string())?;

    // Record the decision
    let decision_id = engine::record_decision(conn, logical_photo_id, round_id, &decision_action)
        .map_err(|e| e.to_string())?;

    // Read back current_status
    let current_status: String = conn
        .query_row(
            "SELECT current_status FROM logical_photos WHERE id = ?1",
            rusqlite::params![logical_photo_id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;

    Ok(DecisionResult {
        decision_id,
        round_id,
        action: decision_action.as_str().to_string(),
        current_status,
        round_auto_created: was_created,
    })
}

/// Undo the last decision in the current open round for a photo.
#[tauri::command]
pub fn undo_decision(
    slug: String,
    logical_photo_id: i64,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let (db_guard, project_guard) = with_open_project(&state, &slug)?;
    let conn = db_guard.as_ref().unwrap();
    let project = project_guard.as_ref().unwrap();

    // Get stack_id to find the round
    let stack_id: i64 = conn
        .query_row(
            "SELECT stack_id FROM logical_photos WHERE id = ?1",
            rusqlite::params![logical_photo_id],
            |row| row.get(0),
        )
        .map_err(|e| format!("Logical photo {} not found: {}", logical_photo_id, e))?;

    let (round_id, _) =
        engine::find_or_create_round(conn, project.id, stack_id).map_err(|e| e.to_string())?;

    if engine::is_round_committed(conn, round_id).map_err(|e| e.to_string())? {
        return Err("Cannot undo decisions on a committed round".to_string());
    }

    engine::undo_decision(conn, logical_photo_id, round_id).map_err(|e| e.to_string())
}

/// Get the round status for a stack: how many decided, kept, eliminated.
#[tauri::command]
pub fn get_round_status(
    slug: String,
    stack_id: i64,
    state: State<'_, AppState>,
) -> Result<RoundStatus, String> {
    let (db_guard, project_guard) = with_open_project(&state, &slug)?;
    let conn = db_guard.as_ref().unwrap();
    let project = project_guard.as_ref().unwrap();

    // Ensure a round exists (auto-create if needed)
    engine::find_or_create_round(conn, project.id, stack_id).map_err(|e| e.to_string())?;

    engine::get_round_status(conn, project.id, stack_id).map_err(|e| e.to_string())
}

/// Commit (seal) the current open round for a stack.
#[tauri::command]
pub fn commit_round(slug: String, stack_id: i64, state: State<'_, AppState>) -> Result<(), String> {
    let (db_guard, project_guard) = with_open_project(&state, &slug)?;
    let conn = db_guard.as_ref().unwrap();
    let project = project_guard.as_ref().unwrap();

    let (round_id, _) =
        engine::find_or_create_round(conn, project.id, stack_id).map_err(|e| e.to_string())?;

    engine::commit_round(conn, round_id).map_err(|e| e.to_string())
}

/// Get full detail for a single logical photo, including camera parameters.
#[tauri::command]
pub fn get_photo_detail(
    slug: String,
    logical_photo_id: i64,
    state: State<'_, AppState>,
) -> Result<PhotoDetail, String> {
    let (db_guard, _project_guard) = with_open_project(&state, &slug)?;
    let conn = db_guard.as_ref().unwrap();

    let cache_dir = manager::project_dir(&state.gemkeep_home, &slug)
        .join("cache")
        .join("thumbnails");

    engine::get_photo_detail(conn, logical_photo_id, &cache_dir).map_err(|e| e.to_string())
}

/// Get decisions for all logical photos in a stack (for the current round).
#[tauri::command]
pub fn get_stack_decisions(
    slug: String,
    stack_id: i64,
    state: State<'_, AppState>,
) -> Result<Vec<PhotoDecisionStatus>, String> {
    let (db_guard, _project_guard) = with_open_project(&state, &slug)?;
    let conn = db_guard.as_ref().unwrap();

    // Query all logical_photos in the stack and return their current_status
    let photos =
        repository::query_logical_photos_by_stack(conn, stack_id).map_err(|e| e.to_string())?;

    Ok(photos
        .into_iter()
        .map(|lp| PhotoDecisionStatus {
            logical_photo_id: lp.logical_photo_id,
            current_status: conn
                .query_row(
                    "SELECT current_status FROM logical_photos WHERE id = ?1",
                    rusqlite::params![lp.logical_photo_id],
                    |row| row.get::<_, String>(0),
                )
                .unwrap_or_else(|_| "undecided".to_string()),
        })
        .collect())
}
