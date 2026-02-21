use crate::photos::model::{LogicalPhotoSummary, SourceFolderRow, StackSummary};
use rusqlite::{params, Connection};

// ── Private helpers ───────────────────────────────────────────────────────────

/// Execute a prepared statement, collect all rows with `f`, and return a Vec.
/// Factored out to avoid the repetitive `prepare → query_map → collect` boilerplate.
fn collect_rows<T, F>(
    conn: &Connection,
    sql: &str,
    params: impl rusqlite::Params,
    f: F,
) -> rusqlite::Result<Vec<T>>
where
    F: Fn(&rusqlite::Row<'_>) -> rusqlite::Result<T>,
{
    let mut stmt = conn.prepare(sql)?;
    let rows = stmt.query_map(params, f)?;
    rows.collect()
}

/// Run a `SELECT COUNT(*) … WHERE …` query and return `count > 0`.
fn exists_query(
    conn: &Connection,
    sql: &str,
    params: impl rusqlite::Params,
) -> rusqlite::Result<bool> {
    let count: i64 = conn.query_row(sql, params, |row| row.get(0))?;
    Ok(count > 0)
}

// ── Public API ────────────────────────────────────────────────────────────────

/// Returns true if a photo with the given path already exists in the DB.
pub fn photo_exists(conn: &Connection, path: &str) -> rusqlite::Result<bool> {
    exists_query(
        conn,
        "SELECT COUNT(*) FROM photos WHERE path = ?1",
        params![path],
    )
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
    collect_rows(
        conn,
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
        params![project_id],
        |row| {
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
        },
    )
}

/// Return a summary of all logical photos in a given stack, ordered by capture time.
/// Thumbnail path is resolved from disk: `cache_dir/{lp_id}.jpg`.
pub fn list_logical_photos_by_stack(
    conn: &Connection,
    stack_id: i64,
    cache_dir: &std::path::Path,
) -> rusqlite::Result<Vec<LogicalPhotoSummary>> {
    // Build the set of logical_photo ids that have a thumbnail on disk.
    // One readdir is cheaper than N stat() calls.
    let existing_thumbs: std::collections::HashSet<i64> = if cache_dir.exists() {
        std::fs::read_dir(cache_dir)
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

    let mut summaries = collect_rows(
        conn,
        // representative_photo (rep) supplies capture_time, camera_model, lens.
        // All photos in the logical photo (p) determine has_raw / has_jpeg flags.
        "SELECT
            lp.id                                               AS logical_photo_id,
            rep.capture_time                                    AS capture_time,
            rep.camera_model                                    AS camera_model,
            rep.lens                                            AS lens,
            MAX(CASE WHEN p.format = 'raw'  THEN 1 ELSE 0 END) AS has_raw,
            MAX(CASE WHEN p.format = 'jpeg' THEN 1 ELSE 0 END) AS has_jpeg
         FROM logical_photos lp
         LEFT JOIN photos rep ON rep.id = lp.representative_photo_id
         LEFT JOIN photos p   ON p.logical_photo_id = lp.id
         WHERE lp.stack_id = ?1
         GROUP BY lp.id
         ORDER BY rep.capture_time ASC NULLS LAST, lp.id ASC",
        params![stack_id],
        |row| {
            let has_raw: i64 = row.get(4)?;
            let has_jpeg: i64 = row.get(5)?;
            Ok(LogicalPhotoSummary {
                logical_photo_id: row.get(0)?,
                thumbnail_path:   None, // filled below
                capture_time:     row.get(1)?,
                camera_model:     row.get(2)?,
                lens:             row.get(3)?,
                has_raw:          has_raw != 0,
                has_jpeg:         has_jpeg != 0,
            })
        },
    )?;

    // Resolve thumbnail paths from the pre-built set — avoids N stat() calls.
    for summary in &mut summaries {
        if existing_thumbs.contains(&summary.logical_photo_id) {
            summary.thumbnail_path = Some(
                cache_dir
                    .join(format!("{}.jpg", summary.logical_photo_id))
                    .to_string_lossy()
                    .into_owned(),
            );
        }
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
    collect_rows(
        conn,
        "SELECT id, path FROM source_folders WHERE project_id = ?1 ORDER BY added_at ASC",
        params![project_id],
        |row| {
            Ok(SourceFolderRow {
                id: row.get(0)?,
                path: row.get(1)?,
            })
        },
    )
}

/// Check whether a given absolute path is already attached to this project.
pub fn folder_already_attached(
    conn: &Connection,
    project_id: i64,
    path: &str,
) -> rusqlite::Result<bool> {
    exists_query(
        conn,
        "SELECT COUNT(*) FROM source_folders WHERE project_id = ?1 AND path = ?2",
        params![project_id, path],
    )
}

/// Returns a map of stack_id → first logical_photo id for each stack in the project.
/// Used by list_stacks to batch thumbnail path resolution instead of N+1 queries.
pub fn list_first_lp_ids_for_project(
    conn: &Connection,
    project_id: i64,
) -> rusqlite::Result<std::collections::HashMap<i64, i64>> {
    let mut stmt = conn.prepare(
        "SELECT lp.stack_id, MIN(lp.id) \
         FROM logical_photos lp \
         INNER JOIN stacks s ON lp.stack_id = s.id \
         WHERE s.project_id = ?1 \
         GROUP BY lp.stack_id",
    )?;
    let pairs = stmt.query_map([project_id], |row| {
        Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?))
    })?;
    pairs.collect::<rusqlite::Result<std::collections::HashMap<_, _>>>()
}

/// Load all photo paths for a project (for idempotency checks during pipeline).
pub fn list_photo_paths_for_project(
    conn: &Connection,
    project_id: i64,
) -> rusqlite::Result<Vec<String>> {
    // photos table has no project_id column directly; join through logical_photos
    collect_rows(
        conn,
        "SELECT p.path FROM photos p
         JOIN logical_photos lp ON lp.id = p.logical_photo_id
         WHERE lp.project_id = ?1",
        params![project_id],
        |row| row.get(0),
    )
}
