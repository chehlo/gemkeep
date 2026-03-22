use crate::decisions::engine;
use crate::decisions::model::{
    DecisionAction, DecisionResult, PhotoDecisionStatus, PhotoDetail, RoundStatus,
};
use crate::projects::manager;
use crate::state::AppState;
use tauri::State;

use super::with_open_project;

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

    // Read-only: return status of most recent round, or default if none exists.
    // Do NOT auto-create rounds here — that's a side-effect in a read operation.
    engine::get_round_status(conn, project.id, stack_id).or_else(|_| {
        Ok(RoundStatus {
            round_id: 0,
            round_number: 0,
            state: "none".to_string(),
            total_photos: 0,
            decided: 0,
            kept: 0,
            eliminated: 0,
            undecided: 0,
            committed_at: None,
        })
    })
}

/// Get round status for multiple stacks in one call (batch).
#[tauri::command]
pub fn get_stack_progress_batch(
    slug: String,
    stack_ids: Vec<i64>,
    state: State<'_, AppState>,
) -> Result<std::collections::HashMap<i64, RoundStatus>, String> {
    let (db_guard, project_guard) = with_open_project(&state, &slug)?;
    let conn = db_guard.as_ref().unwrap();
    let project = project_guard.as_ref().unwrap();

    engine::get_round_status_batch(conn, project.id, &stack_ids).map_err(|e| e.to_string())
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

    // Single query: fetch id + current_status for all photos in the stack
    let mut stmt = conn
        .prepare(
            "SELECT id, COALESCE(current_status, 'undecided') as current_status \
             FROM logical_photos WHERE stack_id = ?1 ORDER BY id ASC",
        )
        .map_err(|e| e.to_string())?;

    let results = stmt
        .query_map(rusqlite::params![stack_id], |row| {
            Ok(PhotoDecisionStatus {
                logical_photo_id: row.get(0)?,
                current_status: row.get(1)?,
            })
        })
        .map_err(|e| e.to_string())?;

    results
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}
