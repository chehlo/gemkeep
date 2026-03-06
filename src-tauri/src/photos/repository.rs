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
#[allow(clippy::too_many_arguments)]
pub fn insert_photo(
    conn: &Connection,
    path: &str,
    format: &str,
    capture_time: Option<&str>,
    orientation: Option<u16>,
    camera_model: Option<&str>,
    lens: Option<&str>,
    aperture: Option<f64>,
    shutter_speed: Option<&str>,
    iso: Option<u32>,
    focal_length: Option<f64>,
    exposure_comp: Option<f64>,
) -> rusqlite::Result<i64> {
    conn.execute(
        "INSERT OR IGNORE INTO photos (path, format, capture_time, orientation, camera_model, lens, aperture, shutter_speed, iso, focal_length, exposure_comp)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
        params![path, format, capture_time, orientation, camera_model, lens, aperture, shutter_speed, iso, focal_length, exposure_comp],
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

/// Delete only stacks for this project (preserves logical_photos for restack).
/// NULLs stack_id on logical_photos first to avoid FK constraint issues.
pub fn clear_stacks_only(conn: &Connection, project_id: i64) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE logical_photos SET stack_id = NULL WHERE project_id = ?1",
        params![project_id],
    )?;
    conn.execute(
        "DELETE FROM stacks WHERE project_id = ?1",
        params![project_id],
    )?;
    Ok(())
}

/// Load existing logical_photos with capture times for restacking.
/// Returns (lp_id, capture_time_rfc3339) ordered by capture_time.
pub fn load_logical_photos_for_restack(
    conn: &Connection,
    project_id: i64,
) -> rusqlite::Result<Vec<(i64, Option<String>)>> {
    collect_rows(
        conn,
        "SELECT lp.id, p.capture_time
         FROM logical_photos lp
         JOIN photos p ON p.id = lp.representative_photo_id
         WHERE lp.project_id = ?1
         ORDER BY p.capture_time ASC NULLS LAST, lp.id ASC",
        params![project_id],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )
}

/// Update stack_id on an existing logical_photo row.
pub fn update_logical_photo_stack(
    conn: &Connection,
    lp_id: i64,
    stack_id: i64,
) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE logical_photos SET stack_id = ?1 WHERE id = ?2",
        params![stack_id, lp_id],
    )?;
    Ok(())
}

/// Load existing photos from DB and reconstruct ScannedFile structs for re-stacking.
/// After `clear_stacks_and_logical_photos`, all photos have logical_photo_id = NULL
/// but still exist in the photos table. We reload them to re-pair and re-stack.
pub fn load_existing_scanned_files(conn: &Connection) -> Vec<ScannedFile> {
    let mut stmt = match conn
        .prepare("SELECT path, format, capture_time, orientation, camera_model, lens, aperture, shutter_speed, iso, focal_length, exposure_comp FROM photos")
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
        let aperture: Option<f64> = row.get(6)?;
        let shutter_speed: Option<String> = row.get(7)?;
        let iso: Option<u32> = row.get(8)?;
        let focal_length: Option<f64> = row.get(9)?;
        let exposure_comp: Option<f64> = row.get(10)?;
        Ok((
            path_str,
            format_str,
            capture_time_str,
            orientation,
            camera_model,
            lens,
            aperture,
            shutter_speed,
            iso,
            focal_length,
            exposure_comp,
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
        let (
            path_str,
            format_str,
            capture_time_str,
            orientation,
            camera_model,
            lens,
            aperture,
            shutter_speed,
            iso,
            focal_length,
            exposure_comp,
        ) = row;
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
            aperture,
            shutter_speed,
            iso,
            focal_length,
            exposure_comp,
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

// ── Stack merge operations ───────────────────────────────────────────────────

use crate::photos::model::{MergeResult, StackTransaction};

/// Merge 2+ stacks into one new stack.
/// Moves all logical_photos from source stacks into a new stack.
/// Deletes source stacks. Logs transaction. Creates manual_merges record.
///
/// Validation:
/// - stack_ids must contain >= 2 ids
/// - All stack_ids must exist in stacks table for the project
pub fn merge_stacks(
    conn: &Connection,
    project_id: i64,
    stack_ids: &[i64],
) -> anyhow::Result<MergeResult> {
    use anyhow::anyhow;

    // 1. Validate: need at least 2 stacks
    if stack_ids.len() < 2 {
        return Err(anyhow!("merge_stacks requires at least 2 stack ids"));
    }

    // 2. Verify all stacks exist for this project
    for &sid in stack_ids {
        let count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM stacks WHERE id = ?1 AND project_id = ?2",
            params![sid, project_id],
            |row| row.get(0),
        )?;
        if count == 0 {
            return Err(anyhow!(
                "Stack {} does not exist for project {}",
                sid,
                project_id
            ));
        }
    }

    // 3. BEGIN TRANSACTION
    conn.execute("BEGIN", [])?;

    let result = (|| -> anyhow::Result<MergeResult> {
        // 4. Create new stack row
        let now = chrono::Utc::now().to_rfc3339();
        conn.execute(
            "INSERT INTO stacks (project_id, created_at) VALUES (?1, ?2)",
            params![project_id, now],
        )?;
        let new_stack_id = conn.last_insert_rowid();

        // 5. Collect all LP IDs from source stacks (for photo_assignments map)
        let placeholders: String = stack_ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");

        // Build photo_assignments: lp_id -> original stack_id
        let sql = format!(
            "SELECT id, stack_id FROM logical_photos WHERE stack_id IN ({})",
            placeholders
        );
        let mut stmt = conn.prepare(&sql)?;
        let param_values: Vec<Box<dyn rusqlite::ToSql>> = stack_ids
            .iter()
            .map(|id| Box::new(*id) as Box<dyn rusqlite::ToSql>)
            .collect();
        let param_refs: Vec<&dyn rusqlite::ToSql> =
            param_values.iter().map(|p| p.as_ref()).collect();
        let rows: Vec<(i64, i64)> = stmt
            .query_map(param_refs.as_slice(), |row| Ok((row.get(0)?, row.get(1)?)))?
            .collect::<rusqlite::Result<_>>()?;

        let mut photo_assignments = serde_json::Map::new();
        for (lp_id, orig_stack_id) in &rows {
            photo_assignments.insert(
                lp_id.to_string(),
                serde_json::Value::Number(serde_json::Number::from(*orig_stack_id)),
            );
        }
        let logical_photos_moved = rows.len();

        // 6. UPDATE logical_photos SET stack_id = new_stack_id WHERE stack_id IN (source_ids)
        let update_sql = format!(
            "UPDATE logical_photos SET stack_id = ?1 WHERE stack_id IN ({})",
            placeholders
        );
        let mut update_params: Vec<Box<dyn rusqlite::ToSql>> = vec![Box::new(new_stack_id)];
        for id in stack_ids {
            update_params.push(Box::new(*id));
        }
        let update_refs: Vec<&dyn rusqlite::ToSql> =
            update_params.iter().map(|p| p.as_ref()).collect();
        conn.execute(&update_sql, update_refs.as_slice())?;

        // 7. DELETE FROM stacks WHERE id IN (source_ids)
        let delete_sql = format!("DELETE FROM stacks WHERE id IN ({})", placeholders);
        conn.execute(&delete_sql, param_refs.as_slice())?;

        // 8. Collect all LP IDs for the merge group
        let all_lp_ids: Vec<i64> = rows.iter().map(|(lp_id, _)| *lp_id).collect();
        let merge_group_json = serde_json::to_string(&all_lp_ids)?;
        conn.execute(
            "INSERT INTO manual_merges (project_id, merge_group, created_at, active) VALUES (?1, ?2, ?3, 1)",
            params![project_id, merge_group_json, now],
        )?;

        // 9. INSERT INTO stack_transactions
        let details = serde_json::json!({
            "source_stack_ids": stack_ids,
            "target_stack_id": new_stack_id,
            "photo_assignments": photo_assignments,
        });
        let details_str = serde_json::to_string(&details)?;
        conn.execute(
            "INSERT INTO stack_transactions (project_id, action, details, created_at) VALUES (?1, 'merge', ?2, ?3)",
            params![project_id, details_str, now],
        )?;
        let transaction_id = conn.last_insert_rowid();

        Ok(MergeResult {
            merged_stack_id: new_stack_id,
            logical_photos_moved,
            source_stack_ids: stack_ids.to_vec(),
            transaction_id,
        })
    })();

    match result {
        Ok(merge_result) => {
            conn.execute("COMMIT", [])?;
            Ok(merge_result)
        }
        Err(e) => {
            let _ = conn.execute("ROLLBACK", []);
            Err(e)
        }
    }
}

/// Undo the most recent merge for this project.
/// Reads the last merge transaction, recreates original stacks,
/// moves logical_photos back, deletes the merged stack.
pub fn undo_last_merge(conn: &Connection, project_id: i64) -> anyhow::Result<()> {
    use anyhow::anyhow;
    use rusqlite::OptionalExtension;

    // 1. Find last merge transaction
    let row: Option<(i64, String)> = conn
        .query_row(
            "SELECT id, details FROM stack_transactions WHERE project_id = ?1 AND action = 'merge' ORDER BY id DESC LIMIT 1",
            params![project_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?;

    let (tx_id, details_json) = row.ok_or_else(|| anyhow!("No merge transactions to undo"))?;

    // 2. Parse details JSON
    let details: serde_json::Value = serde_json::from_str(&details_json)?;
    let target_stack_id = details["target_stack_id"]
        .as_i64()
        .ok_or_else(|| anyhow!("Missing target_stack_id in merge details"))?;
    let source_stack_ids: Vec<i64> = details["source_stack_ids"]
        .as_array()
        .ok_or_else(|| anyhow!("Missing source_stack_ids in merge details"))?
        .iter()
        .filter_map(|v| v.as_i64())
        .collect();
    let photo_assignments = details["photo_assignments"]
        .as_object()
        .ok_or_else(|| anyhow!("Missing photo_assignments in merge details"))?;

    // 3. BEGIN TRANSACTION
    conn.execute("BEGIN", [])?;

    let result = (|| -> anyhow::Result<()> {
        let now = chrono::Utc::now().to_rfc3339();

        // 4. Recreate source stacks with original IDs
        for &sid in &source_stack_ids {
            conn.execute(
                "INSERT OR IGNORE INTO stacks (id, project_id, created_at) VALUES (?1, ?2, ?3)",
                params![sid, project_id, now],
            )?;
        }

        // 5. Move logical_photos back to original stacks per photo_assignments
        for (lp_id_str, orig_stack_val) in photo_assignments {
            let lp_id: i64 = lp_id_str.parse()?;
            let orig_stack_id = orig_stack_val
                .as_i64()
                .ok_or_else(|| anyhow::anyhow!("Invalid stack id in photo_assignments"))?;
            conn.execute(
                "UPDATE logical_photos SET stack_id = ?1 WHERE id = ?2",
                params![orig_stack_id, lp_id],
            )?;
        }

        // 6. Delete the merged stack
        conn.execute("DELETE FROM stacks WHERE id = ?1", params![target_stack_id])?;

        // 7. Mark manual_merges record as inactive
        // Find the active manual_merges for this project that contains the LP IDs from this merge
        conn.execute(
            "UPDATE manual_merges SET active = 0 WHERE project_id = ?1 AND active = 1",
            params![project_id],
        )?;

        // 8. Log undo_merge transaction
        let undo_details = serde_json::json!({
            "undone_transaction_id": tx_id,
            "source_stack_ids": source_stack_ids,
            "target_stack_id": target_stack_id,
        });
        let undo_details_str = serde_json::to_string(&undo_details)?;
        conn.execute(
            "INSERT INTO stack_transactions (project_id, action, details, created_at) VALUES (?1, 'undo_merge', ?2, ?3)",
            params![project_id, undo_details_str, now],
        )?;

        Ok(())
    })();

    match result {
        Ok(()) => {
            conn.execute("COMMIT", [])?;
            Ok(())
        }
        Err(e) => {
            let _ = conn.execute("ROLLBACK", []);
            Err(e)
        }
    }
}

/// Re-stack all existing photos for a project, preserving manual merges.
/// Manual merge groups are kept together in a single stack; free (non-merged)
/// logical photos are re-grouped by the burst-gap algorithm.
pub fn restack_merge_aware(
    conn: &Connection,
    project_id: i64,
    burst_gap_secs: u64,
) -> anyhow::Result<()> {
    // 1. Load active manual merge groups
    let merge_groups: Vec<(i64, Vec<i64>)> = {
        let mut stmt = conn.prepare(
            "SELECT id, merge_group FROM manual_merges WHERE project_id = ?1 AND active = 1",
        )?;
        let rows: Vec<(i64, String)> = stmt
            .query_map(params![project_id], |row| Ok((row.get(0)?, row.get(1)?)))?
            .collect::<rusqlite::Result<_>>()?;
        rows.into_iter()
            .filter_map(|(id, json)| {
                let lp_ids: Vec<i64> = serde_json::from_str(&json).ok()?;
                Some((id, lp_ids))
            })
            .collect()
    };

    // 2. Build set of manually merged LP IDs
    let merged_lp_ids: std::collections::HashSet<i64> = merge_groups
        .iter()
        .flat_map(|(_, lps)| lps.iter().copied())
        .collect();

    // 3. Load all LPs with capture times
    let all_lps = load_logical_photos_for_restack(conn, project_id)?;

    if all_lps.is_empty() {
        return Ok(());
    }

    // 4. Separate into merged_lps and free_lps
    let mut free_timed: Vec<(i64, chrono::DateTime<chrono::Utc>)> = Vec::new();
    let mut free_untimed: Vec<i64> = Vec::new();

    for (lp_id, capture_time_str) in &all_lps {
        if merged_lp_ids.contains(lp_id) {
            continue; // Skip merged LPs — they'll be handled by merge groups
        }
        if let Some(ref ct_str) = capture_time_str {
            if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(ct_str) {
                free_timed.push((*lp_id, dt.with_timezone(&chrono::Utc)));
                continue;
            }
        }
        free_untimed.push(*lp_id);
    }

    // 5. Auto-stack free_lps by burst gap
    free_timed.sort_by_key(|(_, t)| *t);

    let mut free_groups: Vec<Vec<i64>> = Vec::new();
    let mut current_group: Vec<i64> = Vec::new();
    let mut last_time: Option<chrono::DateTime<chrono::Utc>> = None;

    for (lp_id, t) in &free_timed {
        if let Some(prev) = last_time {
            let gap = (*t - prev).num_seconds().unsigned_abs();
            if gap > burst_gap_secs && !current_group.is_empty() {
                free_groups.push(std::mem::take(&mut current_group));
            }
        }
        current_group.push(*lp_id);
        last_time = Some(*t);
    }
    if !current_group.is_empty() {
        free_groups.push(current_group);
    }

    // Each untimed free LP gets its own solo stack
    for lp_id in &free_untimed {
        free_groups.push(vec![*lp_id]);
    }

    // 6. BEGIN TRANSACTION
    conn.execute("BEGIN", [])?;

    let result = (|| -> anyhow::Result<()> {
        let now = chrono::Utc::now().to_rfc3339();

        // 7. Delete all stacks for the project (NULL out stack_id first)
        conn.execute(
            "UPDATE logical_photos SET stack_id = NULL WHERE project_id = ?1",
            params![project_id],
        )?;
        conn.execute(
            "DELETE FROM stacks WHERE project_id = ?1",
            params![project_id],
        )?;

        // 8. Create stacks for free LP groups
        for group in &free_groups {
            conn.execute(
                "INSERT INTO stacks (project_id, created_at) VALUES (?1, ?2)",
                params![project_id, now],
            )?;
            let stack_id = conn.last_insert_rowid();
            for &lp_id in group {
                conn.execute(
                    "UPDATE logical_photos SET stack_id = ?1 WHERE id = ?2",
                    params![stack_id, lp_id],
                )?;
            }
        }

        // 9. Create stacks for each merge group
        for (_merge_id, lp_ids) in &merge_groups {
            conn.execute(
                "INSERT INTO stacks (project_id, created_at) VALUES (?1, ?2)",
                params![project_id, now],
            )?;
            let stack_id = conn.last_insert_rowid();
            for &lp_id in lp_ids {
                conn.execute(
                    "UPDATE logical_photos SET stack_id = ?1 WHERE id = ?2",
                    params![stack_id, lp_id],
                )?;
            }
        }

        // 10. Log restack transaction
        let details = serde_json::json!({
            "burst_gap_secs": burst_gap_secs,
            "merge_groups_preserved": merge_groups.len(),
            "free_groups": free_groups.len(),
        });
        let details_str = serde_json::to_string(&details)?;
        conn.execute(
            "INSERT INTO stack_transactions (project_id, action, details, created_at) VALUES (?1, 'restack', ?2, ?3)",
            params![project_id, details_str, now],
        )?;

        Ok(())
    })();

    match result {
        Ok(()) => {
            conn.execute("COMMIT", [])?;
            Ok(())
        }
        Err(e) => {
            let _ = conn.execute("ROLLBACK", []);
            Err(e)
        }
    }
}

/// List all stack transactions for a project, newest first.
pub fn list_stack_transactions(
    conn: &Connection,
    project_id: i64,
) -> rusqlite::Result<Vec<StackTransaction>> {
    collect_rows(
        conn,
        "SELECT id, project_id, action, details, created_at FROM stack_transactions WHERE project_id = ?1 ORDER BY created_at DESC",
        params![project_id],
        |row| {
            Ok(StackTransaction {
                id: row.get(0)?,
                project_id: row.get(1)?,
                action: row.get(2)?,
                details: row.get(3)?,
                created_at: row.get(4)?,
            })
        },
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
            None,
            None,
            None,
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
            None,
            None,
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
            None,
            None,
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

    // ── §16.4 Stack Merge Tests ─────────────────────────────────────────────

    /// Helper: set up a project with N stacks, each containing `lps_per_stack`
    /// logical photos. Returns (conn, project_id, Vec<(stack_id, Vec<lp_id>)>).
    fn setup_merge_test_db(
        num_stacks: usize,
        lps_per_stack: &[usize],
    ) -> (Connection, i64, Vec<(i64, Vec<i64>)>) {
        let conn = Connection::open_in_memory().unwrap();
        run_migrations(&conn).unwrap();

        conn.execute(
            "INSERT INTO projects (name, slug, created_at) VALUES ('Test', 'test', '2024-01-01T00:00:00Z')",
            [],
        )
        .unwrap();
        let project_id = conn.last_insert_rowid();

        let mut stacks_with_lps = Vec::new();
        let mut photo_counter = 0u64;

        for stack_idx in 0..num_stacks {
            let stack_id = insert_stack(&conn, project_id).unwrap();
            let count = lps_per_stack.get(stack_idx).copied().unwrap_or(1);
            let mut lp_ids = Vec::new();
            for _ in 0..count {
                photo_counter += 1;
                let path = format!("/test/photo_{}.jpg", photo_counter);
                let capture_time = format!("2024-01-01T10:{:02}:00Z", photo_counter);
                let photo_id = insert_photo(
                    &conn,
                    &path,
                    "jpeg",
                    Some(&capture_time),
                    None,
                    None,
                    None,
                    None,
                    None,
                    None,
                    None,
                    None,
                )
                .unwrap();
                let lp_id = insert_logical_photo(&conn, project_id, photo_id, stack_id).unwrap();
                conn.execute(
                    "UPDATE photos SET logical_photo_id = ?1 WHERE id = ?2",
                    params![lp_id, photo_id],
                )
                .unwrap();
                lp_ids.push(lp_id);
            }
            stacks_with_lps.push((stack_id, lp_ids));
        }

        (conn, project_id, stacks_with_lps)
    }

    #[test]
    fn test_merge_two_stacks() {
        // Sprint 7 §16.4: Merge 2 stacks with 3 and 4 LPs respectively.
        // After merge: 1 stack with 7 LPs, source stacks deleted.
        let (conn, project_id, stacks) = setup_merge_test_db(2, &[3, 4]);
        let stack_ids: Vec<i64> = stacks.iter().map(|(id, _)| *id).collect();
        let all_lp_ids: Vec<i64> = stacks.iter().flat_map(|(_, lps)| lps.clone()).collect();

        let result = merge_stacks(&conn, project_id, &stack_ids).unwrap();

        assert_eq!(
            result.logical_photos_moved, 7,
            "merge must move all 7 logical photos"
        );
        assert_eq!(
            result.source_stack_ids.len(),
            2,
            "source_stack_ids must list both original stacks"
        );

        // Verify new stack has all 7 LPs
        let lp_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM logical_photos WHERE stack_id = ?1",
                params![result.merged_stack_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(lp_count, 7, "merged stack must have 7 logical photos");

        // Verify source stacks no longer exist
        for sid in &stack_ids {
            let exists: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM stacks WHERE id = ?1",
                    params![sid],
                    |row| row.get(0),
                )
                .unwrap();
            assert_eq!(exists, 0, "source stack {} must be deleted", sid);
        }

        // Verify all LP IDs now point to the merged stack
        for lp_id in &all_lp_ids {
            let sid: i64 = conn
                .query_row(
                    "SELECT stack_id FROM logical_photos WHERE id = ?1",
                    params![lp_id],
                    |row| row.get(0),
                )
                .unwrap();
            assert_eq!(
                sid, result.merged_stack_id,
                "LP {} must be in the merged stack",
                lp_id
            );
        }
    }

    #[test]
    fn test_merge_three_stacks() {
        // Sprint 7 §16.4: Merge 3 stacks into 1.
        let (conn, project_id, stacks) = setup_merge_test_db(3, &[2, 3, 2]);
        let stack_ids: Vec<i64> = stacks.iter().map(|(id, _)| *id).collect();

        let result = merge_stacks(&conn, project_id, &stack_ids).unwrap();

        assert_eq!(
            result.logical_photos_moved, 7,
            "merge of 3 stacks must move all 7 LPs"
        );

        let lp_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM logical_photos WHERE stack_id = ?1",
                params![result.merged_stack_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(lp_count, 7, "merged stack must contain all 7 LPs");
    }

    #[test]
    fn test_merge_logs_transaction() {
        // Sprint 7 §16.4: merge_stacks must insert a row into stack_transactions.
        let (conn, project_id, stacks) = setup_merge_test_db(2, &[2, 3]);
        let stack_ids: Vec<i64> = stacks.iter().map(|(id, _)| *id).collect();

        let result = merge_stacks(&conn, project_id, &stack_ids).unwrap();

        // Verify transaction log
        let (action, details_json): (String, String) = conn
            .query_row(
                "SELECT action, details FROM stack_transactions WHERE id = ?1",
                params![result.transaction_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(action, "merge", "transaction action must be 'merge'");

        // Parse details JSON and verify it contains source_stack_ids and target_stack_id
        let details: serde_json::Value = serde_json::from_str(&details_json).unwrap();
        assert!(
            details.get("source_stack_ids").is_some(),
            "details must contain source_stack_ids"
        );
        assert!(
            details.get("target_stack_id").is_some(),
            "details must contain target_stack_id"
        );
        assert_eq!(
            details["target_stack_id"].as_i64().unwrap(),
            result.merged_stack_id,
            "target_stack_id must match merged_stack_id"
        );
    }

    #[test]
    fn test_merge_creates_manual_merge_record() {
        // Sprint 7 §16.4: merge_stacks must create an active manual_merges row.
        let (conn, project_id, stacks) = setup_merge_test_db(2, &[2, 3]);
        let stack_ids: Vec<i64> = stacks.iter().map(|(id, _)| *id).collect();
        let all_lp_ids: Vec<i64> = stacks.iter().flat_map(|(_, lps)| lps.clone()).collect();

        merge_stacks(&conn, project_id, &stack_ids).unwrap();

        // Verify manual_merges has 1 active row
        let (merge_group_json, active): (String, i64) = conn
            .query_row(
                "SELECT merge_group, active FROM manual_merges WHERE project_id = ?1 AND active = 1",
                params![project_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(active, 1, "manual_merges row must be active");

        // Parse the merge_group JSON array and verify it contains all LP IDs
        let group: Vec<i64> = serde_json::from_str(&merge_group_json).unwrap();
        for lp_id in &all_lp_ids {
            assert!(
                group.contains(lp_id),
                "merge_group must contain LP id {}",
                lp_id
            );
        }
    }

    #[test]
    fn test_merge_invalid_single_stack() {
        // Sprint 7 §16.4: merge_stacks with < 2 stack_ids must error.
        let (conn, project_id, stacks) = setup_merge_test_db(1, &[3]);
        let stack_ids = vec![stacks[0].0];

        let result = merge_stacks(&conn, project_id, &stack_ids);
        assert!(
            result.is_err(),
            "merge_stacks with 1 stack must return an error"
        );
    }

    #[test]
    fn test_merge_nonexistent_stack() {
        // Sprint 7 §16.4: merge_stacks with a non-existent stack_id must error.
        let (conn, project_id, stacks) = setup_merge_test_db(1, &[3]);
        let stack_ids = vec![stacks[0].0, 99999]; // 99999 does not exist

        let result = merge_stacks(&conn, project_id, &stack_ids);
        assert!(
            result.is_err(),
            "merge_stacks with non-existent stack must return an error"
        );
    }

    #[test]
    fn test_undo_merge_restores_stacks() {
        // Sprint 7 §16.4: After merge, undo_last_merge restores original stacks.
        let (conn, project_id, stacks) = setup_merge_test_db(2, &[3, 4]);
        let stack_ids: Vec<i64> = stacks.iter().map(|(id, _)| *id).collect();
        let original_lps_per_stack: Vec<Vec<i64>> =
            stacks.iter().map(|(_, lps)| lps.clone()).collect();

        // Merge
        let merge_result = merge_stacks(&conn, project_id, &stack_ids).unwrap();
        assert_eq!(merge_result.logical_photos_moved, 7);

        // Undo
        undo_last_merge(&conn, project_id).unwrap();

        // Verify merged stack is deleted
        let merged_exists: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM stacks WHERE id = ?1",
                params![merge_result.merged_stack_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(merged_exists, 0, "merged stack must be deleted after undo");

        // Verify original stacks are recreated
        for (idx, sid) in stack_ids.iter().enumerate() {
            let exists: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM stacks WHERE id = ?1",
                    params![sid],
                    |row| row.get(0),
                )
                .unwrap();
            assert_eq!(
                exists, 1,
                "original stack {} must be restored after undo",
                sid
            );

            // Verify logical photos are back in their original stacks
            for lp_id in &original_lps_per_stack[idx] {
                let actual_stack: i64 = conn
                    .query_row(
                        "SELECT stack_id FROM logical_photos WHERE id = ?1",
                        params![lp_id],
                        |row| row.get(0),
                    )
                    .unwrap();
                assert_eq!(
                    actual_stack, *sid,
                    "LP {} must be back in original stack {} after undo, but found stack {}",
                    lp_id, sid, actual_stack
                );
            }
        }

        // Verify manual_merges record marked inactive
        let active_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM manual_merges WHERE project_id = ?1 AND active = 1",
                params![project_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(
            active_count, 0,
            "manual_merges must have active=0 after undo"
        );
    }

    #[test]
    fn test_undo_merge_no_merges() {
        // Sprint 7 §16.4: undo_last_merge with no prior merges must error.
        let (conn, project_id, _stacks) = setup_merge_test_db(2, &[3, 4]);

        let result = undo_last_merge(&conn, project_id);
        assert!(
            result.is_err(),
            "undo_last_merge with no merges must return an error"
        );
    }

    #[test]
    fn test_restack_preserves_manual_merges() {
        // Sprint 7 §16.4: After manually merging stacks 0+1, restack_merge_aware
        // must keep those LPs together in one stack, even with a different burst_gap.
        let (conn, project_id, stacks) = setup_merge_test_db(4, &[2, 3, 2, 1]);

        // Merge stacks 0 and 1 manually
        let merge_stack_ids = vec![stacks[0].0, stacks[1].0];
        let merged_lp_ids: Vec<i64> = stacks[0]
            .1
            .iter()
            .chain(stacks[1].1.iter())
            .copied()
            .collect();
        merge_stacks(&conn, project_id, &merge_stack_ids).unwrap();

        // Restack with a different burst gap (e.g., 1 second — should split most auto-stacks)
        restack_merge_aware(&conn, project_id, 1).unwrap();

        // Verify: all LPs from the manual merge are still in the SAME stack
        let stack_id_of_first: i64 = conn
            .query_row(
                "SELECT stack_id FROM logical_photos WHERE id = ?1",
                params![merged_lp_ids[0]],
                |row| row.get(0),
            )
            .unwrap();

        for lp_id in &merged_lp_ids[1..] {
            let sid: i64 = conn
                .query_row(
                    "SELECT stack_id FROM logical_photos WHERE id = ?1",
                    params![lp_id],
                    |row| row.get(0),
                )
                .unwrap();
            assert_eq!(
                sid, stack_id_of_first,
                "LP {} from manual merge must remain in same stack as LP {} after restack (got stack {} vs {})",
                lp_id, merged_lp_ids[0], sid, stack_id_of_first
            );
        }
    }
}
