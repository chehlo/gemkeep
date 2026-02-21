use crate::photos::model::{SourceFolderRow, StackSummary};
use rusqlite::{params, Connection};

/// Returns true if a photo with the given path already exists in the DB.
pub fn photo_exists(conn: &Connection, path: &str) -> rusqlite::Result<bool> {
    let count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM photos WHERE path = ?1",
        params![path],
        |row| row.get(0),
    )?;
    Ok(count > 0)
}

/// Insert a new photo row. Returns the new row id.
pub fn insert_photo(
    conn: &Connection,
    path: &str,
    format: &str,
    capture_time: Option<&str>,
    orientation: Option<u16>,
    camera_model: Option<&str>,
    lens: Option<&str>,
) -> rusqlite::Result<i64> {
    conn.execute(
        "INSERT OR IGNORE INTO photos (path, format, capture_time, orientation, camera_model, lens)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![path, format, capture_time, orientation, camera_model, lens],
    )?;
    // If the row already existed, the INSERT OR IGNORE does nothing; return the existing id.
    let id: i64 = conn.query_row(
        "SELECT id FROM photos WHERE path = ?1",
        params![path],
        |row| row.get(0),
    )?;
    Ok(id)
}

/// Set the logical_photo_id foreign key on a photos row.
pub fn set_logical_photo_id(
    conn: &Connection,
    photo_id: i64,
    logical_photo_id: i64,
) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE photos SET logical_photo_id = ?1 WHERE id = ?2",
        params![logical_photo_id, photo_id],
    )?;
    Ok(())
}

/// Insert a new stack row. Returns the new stack id.
pub fn insert_stack(conn: &Connection, project_id: i64) -> rusqlite::Result<i64> {
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO stacks (project_id, created_at) VALUES (?1, ?2)",
        params![project_id, now],
    )?;
    Ok(conn.last_insert_rowid())
}

/// Insert a new logical_photo row. Returns the new logical_photo id.
pub fn insert_logical_photo(
    conn: &Connection,
    project_id: i64,
    representative_photo_id: i64,
    stack_id: i64,
) -> rusqlite::Result<i64> {
    conn.execute(
        "INSERT INTO logical_photos (project_id, representative_photo_id, stack_id)
         VALUES (?1, ?2, ?3)",
        params![project_id, representative_photo_id, stack_id],
    )?;
    Ok(conn.last_insert_rowid())
}

/// Delete all stacks and logical_photos for this project (for idempotent re-indexing).
/// Photos rows are kept (they represent files on disk) but their logical_photo_id is cleared.
pub fn clear_stacks_and_logical_photos(conn: &Connection, project_id: i64) -> rusqlite::Result<()> {
    // Clear logical_photo_id references in photos first to avoid FK constraint issues.
    conn.execute(
        "UPDATE photos SET logical_photo_id = NULL
         WHERE logical_photo_id IN (
             SELECT id FROM logical_photos WHERE project_id = ?1
         )",
        params![project_id],
    )?;
    conn.execute(
        "DELETE FROM logical_photos WHERE project_id = ?1",
        params![project_id],
    )?;
    conn.execute(
        "DELETE FROM stacks WHERE project_id = ?1",
        params![project_id],
    )?;
    Ok(())
}

/// Return a summary of all stacks for the project, ordered by earliest capture time.
pub fn list_stacks_summary(
    conn: &Connection,
    project_id: i64,
) -> rusqlite::Result<Vec<StackSummary>> {
    let mut stmt = conn.prepare(
        "SELECT
            s.id                                        AS stack_id,
            COUNT(lp.id)                                AS logical_photo_count,
            MIN(p.capture_time)                         AS earliest_capture,
            MAX(CASE WHEN p.format = 'raw'  THEN 1 ELSE 0 END) AS has_raw,
            MAX(CASE WHEN p.format = 'jpeg' THEN 1 ELSE 0 END) AS has_jpeg
         FROM stacks s
         JOIN logical_photos lp ON lp.stack_id = s.id
         LEFT JOIN photos p ON p.logical_photo_id = lp.id
         WHERE s.project_id = ?1
         GROUP BY s.id
         ORDER BY earliest_capture ASC NULLS LAST, s.id ASC",
    )?;

    let rows = stmt.query_map(params![project_id], |row| {
        let has_raw: i64 = row.get(3)?;
        let has_jpeg: i64 = row.get(4)?;
        Ok(StackSummary {
            stack_id: row.get(0)?,
            logical_photo_count: row.get(1)?,
            earliest_capture: row.get(2)?,
            has_raw: has_raw != 0,
            has_jpeg: has_jpeg != 0,
            thumbnail_path: None, // filled in by pipeline after thumbnail generation
        })
    })?;

    let mut summaries = Vec::new();
    for row in rows {
        summaries.push(row?);
    }
    Ok(summaries)
}

/// Add a source folder to a project. Returns the new row id.
pub fn add_source_folder(conn: &Connection, project_id: i64, path: &str) -> rusqlite::Result<i64> {
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO source_folders (project_id, path, added_at) VALUES (?1, ?2, ?3)",
        params![project_id, path, now],
    )?;
    Ok(conn.last_insert_rowid())
}

/// Remove a source folder by id (project-scoped for safety).
pub fn remove_source_folder(
    conn: &Connection,
    project_id: i64,
    folder_id: i64,
) -> rusqlite::Result<()> {
    conn.execute(
        "DELETE FROM source_folders WHERE id = ?1 AND project_id = ?2",
        params![folder_id, project_id],
    )?;
    Ok(())
}

/// List all source folders for a project.
pub fn list_source_folders(
    conn: &Connection,
    project_id: i64,
) -> rusqlite::Result<Vec<SourceFolderRow>> {
    let mut stmt = conn.prepare(
        "SELECT id, path FROM source_folders WHERE project_id = ?1 ORDER BY added_at ASC",
    )?;
    let rows = stmt.query_map(params![project_id], |row| {
        Ok(SourceFolderRow {
            id: row.get(0)?,
            path: row.get(1)?,
        })
    })?;
    let mut result = Vec::new();
    for row in rows {
        result.push(row?);
    }
    Ok(result)
}

/// Check whether a given absolute path is already attached to this project.
pub fn folder_already_attached(
    conn: &Connection,
    project_id: i64,
    path: &str,
) -> rusqlite::Result<bool> {
    let count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM source_folders WHERE project_id = ?1 AND path = ?2",
        params![project_id, path],
        |row| row.get(0),
    )?;
    Ok(count > 0)
}

/// Load all photo paths for a project (for idempotency checks during pipeline).
pub fn list_photo_paths_for_project(
    conn: &Connection,
    project_id: i64,
) -> rusqlite::Result<Vec<String>> {
    // photos table has no project_id column directly; join through logical_photos
    let mut stmt = conn.prepare(
        "SELECT p.path FROM photos p
         JOIN logical_photos lp ON lp.id = p.logical_photo_id
         WHERE lp.project_id = ?1",
    )?;
    let rows = stmt.query_map(params![project_id], |row| row.get(0))?;
    let mut paths = Vec::new();
    for row in rows {
        paths.push(row?);
    }
    Ok(paths)
}
