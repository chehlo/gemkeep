use crate::photos::model::{MergeResult, StackTransaction};
use crate::photos::repository;
use crate::state::AppState;
use tauri::State;

use super::with_open_project;

/// Merge 2+ stacks into one new stack.
/// Moves all logical_photos from source stacks into a new stack.
/// Deletes source stacks. Logs transaction. Creates manual_merges record.
#[tauri::command]
pub fn merge_stacks(
    slug: String,
    stack_ids: Vec<i64>,
    state: State<'_, AppState>,
) -> Result<MergeResult, String> {
    let (db_guard, project_guard) = with_open_project(&state, &slug)?;
    let conn = db_guard.as_ref().unwrap();
    let project = project_guard.as_ref().unwrap();
    repository::merge_stacks(conn, project.id, &stack_ids).map_err(|e| e.to_string())
}

/// Undo the most recent merge for this project.
/// Reads the last merge transaction, recreates original stacks,
/// moves logical_photos back, deletes the merged stack.
#[tauri::command]
pub fn undo_last_merge(slug: String, state: State<'_, AppState>) -> Result<(), String> {
    let (db_guard, project_guard) = with_open_project(&state, &slug)?;
    let conn = db_guard.as_ref().unwrap();
    let project = project_guard.as_ref().unwrap();
    repository::undo_last_merge(conn, project.id).map_err(|e| e.to_string())
}

/// List all stack transactions for the project, newest first.
#[tauri::command]
pub fn list_stack_transactions(
    slug: String,
    state: State<'_, AppState>,
) -> Result<Vec<StackTransaction>, String> {
    let (db_guard, project_guard) = with_open_project(&state, &slug)?;
    let conn = db_guard.as_ref().unwrap();
    let project = project_guard.as_ref().unwrap();
    repository::list_stack_transactions(conn, project.id).map_err(|e| e.to_string())
}
