use crate::db::{open_connection, run_migrations};
use crate::projects::{manager, model::Project, repository, slug};
use crate::state::AppState;
use tauri::State;

// Shared helper: open a project by slug, update AppState
fn open_project_inner(slug_str: &str, state: &AppState) -> Result<Project, String> {
    tracing::info!("IPC open_project_inner: slug={}", slug_str);
    let home = &state.gemkeep_home;
    let dir = manager::project_dir(home, slug_str);
    if !dir.exists() {
        return Err(format!("Project not found: {}", slug_str));
    }
    let db_path = dir.join("project.db");
    let conn = open_connection(&db_path).map_err(|e| e.to_string())?;
    run_migrations(&conn).map_err(|e| e.to_string())?;
    let project = repository::get_project_by_slug(&conn, slug_str).map_err(|e| e.to_string())?;
    repository::update_last_opened(&conn, project.id).map_err(|e| e.to_string())?;
    let mut config = manager::read_config(home).unwrap_or_default();
    config.last_opened_slug = Some(slug_str.to_string());
    manager::write_config(home, &config).map_err(|e| e.to_string())?;
    manager::append_operation_log(home, slug_str, &format!("PROJECT_OPENED slug={}", slug_str));
    // Lock order: db first, then active_project
    let mut db_lock = state
        .db
        .lock()
        .map_err(|_| "state lock poisoned".to_string())?;
    *db_lock = Some(conn);
    *state
        .active_project
        .lock()
        .map_err(|_| "state lock poisoned".to_string())? = Some(project.clone());
    Ok(project)
}

#[tauri::command]
pub fn suggest_slug(name: String, state: State<'_, AppState>) -> Result<String, String> {
    let existing = manager::list_existing_slugs(&state.gemkeep_home);
    Ok(slug::generate_slug(&name, &existing))
}

#[tauri::command]
pub fn create_project(name: String, state: State<'_, AppState>) -> Result<Project, String> {
    let home = &state.gemkeep_home;
    let existing = manager::list_existing_slugs(home);
    let slug_str = slug::generate_slug(&name, &existing);
    let dir = manager::project_dir(home, &slug_str);
    if dir.exists() {
        return Err(format!("Project directory already exists: {}", slug_str));
    }
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let db_path = dir.join("project.db");
    let conn = open_connection(&db_path).map_err(|e| {
        let _ = std::fs::remove_dir_all(&dir);
        e.to_string()
    })?;
    run_migrations(&conn).map_err(|e| {
        let _ = std::fs::remove_dir_all(&dir);
        e.to_string()
    })?;
    let project = repository::insert_project(&conn, &name, &slug_str).map_err(|e| {
        let _ = std::fs::remove_dir_all(&dir);
        e.to_string()
    })?;
    manager::create_project_dirs(home, &slug_str).map_err(|e| e.to_string())?;
    manager::append_operation_log(
        home,
        &slug_str,
        &format!("PROJECT_CREATED slug={}", slug_str),
    );
    let mut config = manager::read_config(home).unwrap_or_default();
    config.last_opened_slug = Some(slug_str.clone());
    manager::write_config(home, &config).map_err(|e| e.to_string())?;
    // Lock order: db first, then active_project
    *state
        .db
        .lock()
        .map_err(|_| "state lock poisoned".to_string())? = Some(conn);
    *state
        .active_project
        .lock()
        .map_err(|_| "state lock poisoned".to_string())? = Some(project.clone());
    Ok(project)
}

#[tauri::command]
pub fn list_projects(state: State<'_, AppState>) -> Result<Vec<Project>, String> {
    tracing::info!("IPC list_projects: start");
    let home = &state.gemkeep_home;
    let projects_dir = home.join("projects");
    if !projects_dir.exists() {
        return Ok(vec![]);
    }
    let mut projects = vec![];
    let entries = std::fs::read_dir(&projects_dir).map_err(|e| e.to_string())?;
    for entry in entries.flatten() {
        if !entry.path().is_dir() {
            continue;
        }
        let db_path = entry.path().join("project.db");
        if !db_path.exists() {
            tracing::warn!("Missing project.db in {:?}", entry.path());
            continue;
        }
        match open_connection(&db_path) {
            Ok(conn) => match repository::list_projects_in_db(&conn) {
                Ok(mut rows) if rows.len() == 1 => projects.push(rows.remove(0)),
                Ok(rows) => tracing::warn!(
                    "Expected 1 project row in {:?}, got {}",
                    db_path,
                    rows.len()
                ),
                Err(e) => tracing::warn!("list error {:?}: {}", db_path, e),
            },
            Err(e) => tracing::warn!("Cannot open {:?}: {}", db_path, e),
        }
    }
    tracing::info!("IPC list_projects: returning {} projects", projects.len());
    Ok(projects)
}

#[tauri::command]
pub fn open_project(slug: String, state: State<'_, AppState>) -> Result<Project, String> {
    open_project_inner(&slug, &state)
}

#[tauri::command]
pub fn get_last_project(state: State<'_, AppState>) -> Result<Option<Project>, String> {
    tracing::info!("IPC get_last_project: start");
    let home = &state.gemkeep_home;
    let config = manager::read_config(home).map_err(|e| e.to_string())?;
    let slug_str = match config.last_opened_slug {
        Some(s) if !s.is_empty() => s,
        _ => return Ok(None),
    };
    match open_project_inner(&slug_str, &state) {
        Ok(p) => Ok(Some(p)),
        Err(e) => {
            tracing::warn!("get_last_project failed: {}", e);
            Ok(None)
        }
    }
}

#[tauri::command]
pub fn delete_project(slug: String, state: State<'_, AppState>) -> Result<(), String> {
    let home = &state.gemkeep_home;
    let dir = manager::project_dir(home, &slug);
    if !dir.exists() {
        return Err(format!("Project not found: {}", slug));
    }
    // Clear AppState if this is the active project — lock db first, then active_project
    {
        let mut db_lock = state
            .db
            .lock()
            .map_err(|_| "state lock poisoned".to_string())?;
        let mut ap_lock = state
            .active_project
            .lock()
            .map_err(|_| "state lock poisoned".to_string())?;
        if ap_lock.as_ref().map(|p| p.slug == slug).unwrap_or(false) {
            *db_lock = None;
            *ap_lock = None;
        }
    }
    tracing::info!("PROJECT_DELETED slug={}", slug);
    std::fs::remove_dir_all(&dir).map_err(|e| e.to_string())?;
    let mut config = manager::read_config(home).unwrap_or_default();
    if config.last_opened_slug.as_deref() == Some(slug.as_str()) {
        config.last_opened_slug = None;
        let _ = manager::write_config(home, &config);
    }
    Ok(())
}
