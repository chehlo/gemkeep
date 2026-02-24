use crate::photos::model::{
    LogicalPhotoSummary, PhotoFormat, ScannedFile, SourceFolderRow, StackSummary,
};
use rusqlite::{params, Connection};
use std::path::PathBuf;

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
            COUNT(DISTINCT lp.id)                       AS logical_photo_count,
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
/// Pure DB query — `thumbnail_path` is always `None`; caller enriches with filesystem data.
pub fn query_logical_photos_by_stack(
    conn: &Connection,
    stack_id: i64,
) -> rusqlite::Result<Vec<LogicalPhotoSummary>> {
    collect_rows(
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
                thumbnail_path: None,
                capture_time: row.get(1)?,
                camera_model: row.get(2)?,
                lens: row.get(3)?,
                has_raw: has_raw != 0,
                has_jpeg: has_jpeg != 0,
            })
        },
    )
}

/// Enrich logical photo summaries with thumbnail paths resolved from disk.
/// Uses one readdir (via `cached_thumbnail_ids`) instead of N stat() calls.
pub fn enrich_with_thumbnails(summaries: &mut [LogicalPhotoSummary], cache_dir: &std::path::Path) {
    let existing_thumbs = crate::import::util::cached_thumbnail_ids(cache_dir);
    for summary in summaries.iter_mut() {
        if existing_thumbs.contains(&summary.logical_photo_id) {
            summary.thumbnail_path = Some(
                cache_dir
                    .join(format!("{}.jpg", summary.logical_photo_id))
                    .to_string_lossy()
                    .into_owned(),
            );
        }
    }
}

/// Return a summary of all logical photos in a given stack, ordered by capture time.
/// Thumbnail path is resolved from disk: `cache_dir/{lp_id}.jpg`.
/// Convenience wrapper composing `query_logical_photos_by_stack` + `enrich_with_thumbnails`.
pub fn list_logical_photos_by_stack(
    conn: &Connection,
    stack_id: i64,
    cache_dir: &std::path::Path,
) -> rusqlite::Result<Vec<LogicalPhotoSummary>> {
    let mut summaries = query_logical_photos_by_stack(conn, stack_id)?;
    enrich_with_thumbnails(&mut summaries, cache_dir);
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

/// Returns Map<stack_id, lp_id> where lp_id is the lowest LP id in the stack
/// that has a thumbnail on disk. Falls back to MIN(lp.id) if none have thumbnails
/// (caller can then check if that id is in existing_thumbs → gets None correctly).
pub fn list_best_lp_id_for_thumbnail_per_stack(
    conn: &Connection,
    project_id: i64,
    existing_thumbs: &std::collections::HashSet<i64>,
) -> rusqlite::Result<std::collections::HashMap<i64, i64>> {
    // Get all (stack_id, lp_id) pairs ordered by lp_id ASC
    let mut stmt = conn.prepare(
        "SELECT lp.stack_id, lp.id \
         FROM logical_photos lp \
         INNER JOIN stacks s ON lp.stack_id = s.id \
         WHERE s.project_id = ?1 \
         ORDER BY lp.stack_id, lp.id ASC",
    )?;
    let pairs: Vec<(i64, i64)> = stmt
        .query_map([project_id], |row| Ok((row.get(0)?, row.get(1)?)))?
        .collect::<rusqlite::Result<_>>()?;

    let mut result: std::collections::HashMap<i64, i64> = std::collections::HashMap::new();
    for (stack_id, lp_id) in pairs {
        let entry = result.entry(stack_id);
        match entry {
            std::collections::hash_map::Entry::Vacant(e) => {
                // First LP for this stack — use it as fallback
                e.insert(lp_id);
            }
            std::collections::hash_map::Entry::Occupied(mut e) => {
                // If we already have a thumbnail for this stack, keep it
                // Otherwise prefer an LP that has a thumbnail
                if !existing_thumbs.contains(e.get()) && existing_thumbs.contains(&lp_id) {
                    e.insert(lp_id);
                }
            }
        }
    }
    Ok(result)
}

/// Returns all logical_photo ids for a project (one per logical photo, not one per stack).
/// Used by resume_thumbnails to regenerate thumbnails for ALL logical photos.
pub fn list_all_lp_ids_for_project(
    conn: &Connection,
    project_id: i64,
) -> rusqlite::Result<Vec<i64>> {
    let mut stmt = conn.prepare(
        "SELECT lp.id \
         FROM logical_photos lp \
         INNER JOIN stacks s ON lp.stack_id = s.id \
         WHERE s.project_id = ?1 \
         ORDER BY lp.id ASC",
    )?;
    let result = stmt
        .query_map([project_id], |row| row.get(0))?
        .collect::<rusqlite::Result<_>>();
    result
}

/// Return (lp_id, source_path, PhotoFormat, Option<orientation>) for each
/// logical photo id in lp_ids. Used by resume_thumbnails to find what to generate.
#[allow(clippy::type_complexity)]
pub fn list_representative_photos_for_lp_ids(
    conn: &Connection,
    project_id: i64,
    lp_ids: &[i64],
) -> rusqlite::Result<
    Vec<(
        i64,
        std::path::PathBuf,
        crate::photos::model::PhotoFormat,
        Option<u16>,
    )>,
> {
    if lp_ids.is_empty() {
        return Ok(vec![]);
    }
    let placeholders: String = lp_ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
    let sql = format!(
        "SELECT lp.id, p.path, p.format, p.orientation
           FROM logical_photos lp
           JOIN photos p ON p.id = lp.representative_photo_id
          WHERE lp.project_id = ? AND lp.id IN ({})",
        placeholders
    );
    let mut stmt = conn.prepare(&sql)?;
    let mut params: Vec<Box<dyn rusqlite::ToSql>> = vec![Box::new(project_id)];
    for id in lp_ids {
        params.push(Box::new(*id));
    }
    let params_refs: Vec<&dyn rusqlite::ToSql> = params.iter().map(|p| p.as_ref()).collect();
    let rows = stmt.query_map(params_refs.as_slice(), |row| {
        let lp_id: i64 = row.get(0)?;
        let path_str: String = row.get(1)?;
        let format_str: String = row.get(2)?;
        let orientation: Option<u16> = row.get(3)?;
        Ok((lp_id, path_str, format_str, orientation))
    })?;
    let mut result = Vec::new();
    for row in rows {
        let (lp_id, path_str, format_str, orientation) = row?;
        let path = std::path::PathBuf::from(path_str);
        let format = match format_str.as_str() {
            "jpeg" => crate::photos::model::PhotoFormat::Jpeg,
            _ => crate::photos::model::PhotoFormat::Raw,
        };
        result.push((lp_id, path, format, orientation));
    }
    Ok(result)
}

/// Load existing photos from DB and reconstruct ScannedFile structs for re-stacking.
/// After `clear_stacks_and_logical_photos`, all photos have logical_photo_id = NULL
/// but still exist in the photos table. We reload them to re-pair and re-stack.
pub fn load_existing_scanned_files(conn: &Connection) -> Vec<ScannedFile> {
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::run_migrations;

    #[test]
    fn test_list_representative_photos_for_lp_ids_returns_correct_rows() {
        let conn = Connection::open_in_memory().unwrap();
        run_migrations(&conn).unwrap();

        // Insert project
        conn.execute(
            "INSERT INTO projects (name, slug, created_at) VALUES ('Test', 'test', '2024-01-01T00:00:00Z')",
            [],
        ).unwrap();
        let project_id: i64 = conn.last_insert_rowid();

        // Insert stack
        let stack_id = insert_stack(&conn, project_id).unwrap();

        // Insert photo
        let photo_id = insert_photo(
            &conn,
            "/fake/photo.jpg",
            "jpeg",
            None,
            Some(1u16),
            None,
            None,
        )
        .unwrap();

        // Insert logical_photo
        let lp_id = insert_logical_photo(&conn, project_id, photo_id, stack_id).unwrap();

        // Call the function under test
        let result = list_representative_photos_for_lp_ids(&conn, project_id, &[lp_id]).unwrap();

        assert_eq!(result.len(), 1, "should return exactly 1 row");
        let (row_lp_id, row_path, row_format, row_orientation) = &result[0];
        assert_eq!(*row_lp_id, lp_id, "lp_id must match");
        assert_eq!(
            *row_path,
            std::path::PathBuf::from("/fake/photo.jpg"),
            "path must match"
        );
        assert_eq!(
            *row_format,
            crate::photos::model::PhotoFormat::Jpeg,
            "format must be Jpeg"
        );
        assert_eq!(*row_orientation, Some(1u16), "orientation must be Some(1)");
    }

    #[test]
    fn test_list_representative_photos_for_lp_ids_empty_input() {
        let conn = Connection::open_in_memory().unwrap();
        run_migrations(&conn).unwrap();

        // Call with empty lp_ids slice — must not produce SQL error from IN ()
        let result = list_representative_photos_for_lp_ids(&conn, 1, &[]).unwrap();
        assert_eq!(result, vec![], "empty input must return empty vec");
    }

    /// BT-00: Regression guard for COUNT(DISTINCT lp.id).
    /// A stack containing one RAW+JPEG pair (two photos, one logical_photo row) must report
    /// logical_photo_count = 1, not 2.  Before the fix the LEFT JOIN to `photos` inflated the
    /// count: COUNT(lp.id) counted both joined rows even though lp.id was the same value twice.
    #[test]
    fn test_logical_photo_count_is_one_for_raw_jpeg_pair() {
        let conn = Connection::open_in_memory().unwrap();
        run_migrations(&conn).unwrap();

        conn.execute(
            "INSERT INTO projects (name, slug, created_at) VALUES ('P', 'p', '2024-01-01T00:00:00Z')",
            [],
        ).unwrap();
        let project_id: i64 = conn.last_insert_rowid();
        let stack_id = insert_stack(&conn, project_id).unwrap();

        // Two physical files (RAW + JPEG) — one logical photo
        let raw_id = insert_photo(
            &conn,
            "/img/shot.ARW",
            "raw",
            Some("2024-01-01T10:00:00Z"),
            None,
            None,
            None,
        )
        .unwrap();
        let jpg_id = insert_photo(
            &conn,
            "/img/shot.JPG",
            "jpeg",
            Some("2024-01-01T10:00:00Z"),
            None,
            None,
            None,
        )
        .unwrap();

        // One logical_photo row (representative = RAW)
        let lp_id = insert_logical_photo(&conn, project_id, raw_id, stack_id).unwrap();
        set_logical_photo_id(&conn, raw_id, lp_id).unwrap();
        set_logical_photo_id(&conn, jpg_id, lp_id).unwrap();

        let summaries = list_stacks_summary(&conn, project_id).unwrap();
        assert_eq!(summaries.len(), 1, "should be exactly one stack");
        assert_eq!(
            summaries[0].logical_photo_count, 1,
            "RAW+JPEG pair must count as 1 logical photo, not 2"
        );
        assert!(summaries[0].has_raw, "has_raw must be true");
        assert!(summaries[0].has_jpeg, "has_jpeg must be true");
    }
}
