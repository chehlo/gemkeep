pub mod decisions;
pub mod import;
#[cfg(test)]
mod ipc_tests;
pub mod projects;
pub mod stacks;

use rusqlite::Connection;
use std::sync::MutexGuard;

pub(crate) type ProjectGuards<'s> = (
    MutexGuard<'s, Option<Connection>>,
    MutexGuard<'s, Option<crate::projects::model::Project>>,
);

pub(crate) fn with_open_project<'s>(
    state: &'s crate::state::AppState,
    slug: &str,
) -> Result<ProjectGuards<'s>, String> {
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
