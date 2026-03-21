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
/// Cascade order: decisions → rounds → photos.logical_photo_id → logical_photos → stacks.
pub fn clear_stacks_and_logical_photos(conn: &Connection, project_id: i64) -> rusqlite::Result<()> {
    // 1. Delete decisions that reference logical_photos in this project.
    conn.execute(
        "DELETE FROM decisions WHERE logical_photo_id IN (
             SELECT id FROM logical_photos WHERE project_id = ?1
         )",
        params![project_id],
    )?;
    // 2. Delete rounds for this project (decisions are already gone).
    conn.execute(
        "DELETE FROM rounds WHERE project_id = ?1",
        params![project_id],
    )?;
    // 3. Clear logical_photo_id references in photos.
    conn.execute(
        "UPDATE photos SET logical_photo_id = NULL
         WHERE logical_photo_id IN (
             SELECT id FROM logical_photos WHERE project_id = ?1
         )",
        params![project_id],
    )?;
    // 4. Delete logical_photos (no more FK references to them).
    conn.execute(
        "DELETE FROM logical_photos WHERE project_id = ?1",
        params![project_id],
    )?;
    // 5. Delete stacks (no more FK references from logical_photos).
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
            MAX(CASE WHEN p.format = 'jpeg' THEN 1 ELSE 0 END) AS has_jpeg,
            rep.aperture                                        AS aperture,
            rep.shutter_speed                                   AS shutter_speed,
            rep.iso                                             AS iso,
            rep.focal_length                                    AS focal_length
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
                aperture: row.get(6)?,
                shutter_speed: row.get(7)?,
                iso: row.get(8)?,
                focal_length: row.get(9)?,
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

/// Return summaries of logical photos belonging to a specific round.
/// Only photos linked via `round_photos` are included (i.e., survivors of previous rounds).
pub fn query_logical_photos_by_round(
    conn: &Connection,
    round_id: i64,
) -> rusqlite::Result<Vec<LogicalPhotoSummary>> {
    // Validate that the round exists before querying
    let exists: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM rounds WHERE id = ?1)",
        params![round_id],
        |row| row.get(0),
    )?;
    if !exists {
        return Err(rusqlite::Error::QueryReturnedNoRows);
    }

    collect_rows(
        conn,
        "SELECT
            lp.id                                               AS logical_photo_id,
            rep.capture_time                                    AS capture_time,
            rep.camera_model                                    AS camera_model,
            rep.lens                                            AS lens,
            MAX(CASE WHEN p.format = 'raw'  THEN 1 ELSE 0 END) AS has_raw,
            MAX(CASE WHEN p.format = 'jpeg' THEN 1 ELSE 0 END) AS has_jpeg,
            rep.aperture                                        AS aperture,
            rep.shutter_speed                                   AS shutter_speed,
            rep.iso                                             AS iso,
            rep.focal_length                                    AS focal_length
         FROM round_photos rp
         JOIN logical_photos lp ON lp.id = rp.logical_photo_id
         LEFT JOIN photos rep ON rep.id = lp.representative_photo_id
         LEFT JOIN photos p   ON p.logical_photo_id = lp.id
         WHERE rp.round_id = ?1
         GROUP BY lp.id
         ORDER BY rep.capture_time ASC NULLS LAST, lp.id ASC",
        params![round_id],
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
                aperture: row.get(6)?,
                shutter_speed: row.get(7)?,
                iso: row.get(8)?,
                focal_length: row.get(9)?,
            })
        },
    )
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
pub fn load_existing_scanned_files(conn: &Connection, project_id: i64) -> Vec<ScannedFile> {
    let mut stmt = match conn.prepare(
        "SELECT p.path, p.format, p.capture_time, p.orientation, p.camera_model, p.lens, \
                p.aperture, p.shutter_speed, p.iso, p.focal_length, p.exposure_comp \
         FROM photos p \
         INNER JOIN logical_photos lp ON p.logical_photo_id = lp.id \
         WHERE lp.project_id = ?1",
    ) {
        Ok(s) => s,
        Err(e) => {
            tracing::warn!("load_existing_scanned_files prepare: {}", e);
            return vec![];
        }
    };

    let rows = stmt.query_map(params![project_id], |row| {
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

/// Create round 1 for a stack and populate round_photos with all its logical photos.
/// Used after merge, restack, and undo operations to ensure the decision engine is ready.
pub fn init_round_for_stack(
    conn: &Connection,
    project_id: i64,
    stack_id: i64,
) -> anyhow::Result<i64> {
    use rusqlite::OptionalExtension;

    // Idempotent: if a round already exists for this stack, return it
    let existing: Option<i64> = conn
        .query_row(
            "SELECT id FROM rounds WHERE project_id = ?1 AND scope = 'stack' AND scope_id = ?2 ORDER BY id DESC LIMIT 1",
            params![project_id, stack_id],
            |row| row.get(0),
        )
        .optional()?;

    if let Some(round_id) = existing {
        return Ok(round_id);
    }

    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO rounds (project_id, round_number, state, scope, scope_id, created_at) VALUES (?1, 1, 'open', 'stack', ?2, ?3)",
        params![project_id, stack_id, now],
    )?;
    let round_id = conn.last_insert_rowid();
    conn.execute(
        "INSERT INTO round_photos (round_id, logical_photo_id) SELECT ?1, id FROM logical_photos WHERE stack_id = ?2",
        params![round_id, stack_id],
    )?;
    Ok(round_id)
}

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
        // Rounds for source stacks become orphaned but harmless —
        // AUTOINCREMENT on stacks table prevents ID reuse.
        let delete_sql = format!("DELETE FROM stacks WHERE id IN ({})", placeholders);
        conn.execute(&delete_sql, param_refs.as_slice())?;

        // 8. Collect all LP IDs for the merge group
        let all_lp_ids: Vec<i64> = rows.iter().map(|(lp_id, _)| *lp_id).collect();
        let merge_group_json = serde_json::to_string(&all_lp_ids)?;
        conn.execute(
            "INSERT INTO manual_merges (project_id, merge_group, created_at, active) VALUES (?1, ?2, ?3, 1)",
            params![project_id, merge_group_json, now],
        )?;
        let manual_merge_id = conn.last_insert_rowid();

        // 9. INSERT INTO stack_transactions
        let details = serde_json::json!({
            "source_stack_ids": stack_ids,
            "target_stack_id": new_stack_id,
            "photo_assignments": photo_assignments,
            "manual_merge_id": manual_merge_id,
        });
        let details_str = serde_json::to_string(&details)?;
        conn.execute(
            "INSERT INTO stack_transactions (project_id, action, details, created_at) VALUES (?1, 'merge', ?2, ?3)",
            params![project_id, details_str, now],
        )?;
        let transaction_id = conn.last_insert_rowid();

        // Create round 1 for the merged stack
        init_round_for_stack(conn, project_id, new_stack_id)?;

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

        // 7. Mark the specific manual_merges record as inactive
        if let Some(manual_merge_id) = details.get("manual_merge_id").and_then(|v| v.as_i64()) {
            conn.execute(
                "UPDATE manual_merges SET active = 0 WHERE id = ?1",
                params![manual_merge_id],
            )?;
        } else {
            // Fallback for transactions created before manual_merge_id was stored:
            // deactivate the most recently created active manual_merges row for this project.
            conn.execute(
                "UPDATE manual_merges SET active = 0 WHERE id = (SELECT id FROM manual_merges WHERE project_id = ?1 AND active = 1 ORDER BY id DESC LIMIT 1)",
                params![project_id],
            )?;
        }

        // 8. Create round 1 for each restored stack
        for &sid in &source_stack_ids {
            init_round_for_stack(conn, project_id, sid)?;
        }

        // 9. Log undo_merge transaction
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
        // Rounds for old stacks become orphaned but harmless —
        // AUTOINCREMENT on stacks table prevents ID reuse.
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
            init_round_for_stack(conn, project_id, stack_id)?;
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
            init_round_for_stack(conn, project_id, stack_id)?;
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
    use crate::import::test_fixtures::{Camera, FileType, PhotoSpec, TestLibraryBuilder};

    #[test]
    fn test_list_representative_photos_for_lp_ids_returns_correct_rows() {
        let project = TestLibraryBuilder::new()
            .add_photo(PhotoSpec {
                camera: Camera::Canon,
                orientation: 1,
                file_type: FileType::Jpeg,
                capture_time: None,
                camera_params: None,
            })
            .build_db_only();
        let lp_id = project.lp_ids[0];

        // Call the function under test
        let result =
            list_representative_photos_for_lp_ids(&project.conn, project.project_id, &[lp_id])
                .unwrap();

        assert_eq!(result.len(), 1, "should return exactly 1 row");
        let (row_lp_id, _row_path, row_format, row_orientation) = &result[0];
        assert_eq!(*row_lp_id, lp_id, "lp_id must match");
        assert_eq!(
            *row_format,
            crate::photos::model::PhotoFormat::Jpeg,
            "format must be Jpeg"
        );
        assert_eq!(*row_orientation, Some(1u16), "orientation must be Some(1)");
    }

    #[test]
    fn test_list_representative_photos_for_lp_ids_empty_input() {
        // Minimal DB — no photos needed, just testing empty-input edge case
        let project = TestLibraryBuilder::new()
            .add_photo(PhotoSpec {
                camera: Camera::Canon,
                orientation: 1,
                file_type: FileType::Jpeg,
                capture_time: None,
                camera_params: None,
            })
            .build_db_only();

        // Call with empty lp_ids slice — must not produce SQL error from IN ()
        let result =
            list_representative_photos_for_lp_ids(&project.conn, project.project_id, &[]).unwrap();
        assert_eq!(result, vec![], "empty input must return empty vec");
    }

    /// BT-00: Regression guard for COUNT(DISTINCT lp.id).
    /// A stack containing one RAW+JPEG pair (two photos, one logical_photo row) must report
    /// logical_photo_count = 1, not 2.  Before the fix the LEFT JOIN to `photos` inflated the
    /// count: COUNT(lp.id) counted both joined rows even though lp.id was the same value twice.
    #[test]
    fn test_logical_photo_count_is_one_for_raw_jpeg_pair() {
        let project = TestLibraryBuilder::new()
            .add_photo(PhotoSpec {
                camera: Camera::Sony,
                orientation: 1,
                file_type: FileType::Both,
                capture_time: Some("2024:01:01 10:00:00".to_string()),
                camera_params: None,
            })
            .build_db_only();

        let summaries = list_stacks_summary(&project.conn, project.project_id).unwrap();
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
    /// logical photos using TestLibraryBuilder.
    /// Returns (TestProject, project_id, Vec<(stack_id, Vec<lp_id>)>).
    fn setup_merge_test_db(
        _num_stacks: usize,
        lps_per_stack: &[usize],
    ) -> (
        crate::import::test_fixtures::TestProject,
        i64,
        Vec<(i64, Vec<i64>)>,
    ) {
        let total: usize = lps_per_stack.iter().sum();
        let mut builder = TestLibraryBuilder::new();
        for _ in 0..total {
            builder = builder.add_photo(PhotoSpec {
                camera: Camera::Canon,
                orientation: 1,
                file_type: FileType::Jpeg,
                capture_time: None,
                camera_params: None,
            });
        }
        let project = builder.with_layout(lps_per_stack).build_db_only();
        let project_id = project.project_id;
        let stacks = project.stacks_with_lps.clone();
        (project, project_id, stacks)
    }

    /// Check if a stack exists in the DB.
    fn stack_exists(conn: &Connection, stack_id: i64) -> bool {
        conn.query_row(
            "SELECT COUNT(*) FROM stacks WHERE id = ?1",
            params![stack_id],
            |row| row.get::<_, i64>(0),
        )
        .unwrap()
            > 0
    }

    /// Count logical photos in a specific stack.
    fn count_lps_in_stack(conn: &Connection, stack_id: i64) -> i64 {
        conn.query_row(
            "SELECT COUNT(*) FROM logical_photos WHERE stack_id = ?1",
            params![stack_id],
            |row| row.get(0),
        )
        .unwrap()
    }

    /// Count active manual merge records for a project.
    fn count_active_manual_merges(conn: &Connection, project_id: i64) -> i64 {
        conn.query_row(
            "SELECT COUNT(*) FROM manual_merges WHERE project_id = ?1 AND active = 1",
            params![project_id],
            |row| row.get(0),
        )
        .unwrap()
    }

    #[test]
    fn test_merge_two_stacks() {
        // Sprint 7 §16.4: Merge 2 stacks with 3 and 4 LPs respectively.
        // After merge: 1 stack with 7 LPs, source stacks deleted.
        let (project, project_id, stacks) = setup_merge_test_db(2, &[3, 4]);
        let conn = &project.conn;
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
        assert_eq!(
            count_lps_in_stack(&conn, result.merged_stack_id),
            7,
            "merged stack must have 7 logical photos"
        );

        // Verify source stacks no longer exist
        for sid in &stack_ids {
            assert!(
                !stack_exists(&conn, *sid),
                "source stack {} must be deleted",
                sid
            );
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
        let (project, project_id, stacks) = setup_merge_test_db(3, &[2, 3, 2]);
        let conn = &project.conn;
        let stack_ids: Vec<i64> = stacks.iter().map(|(id, _)| *id).collect();

        let result = merge_stacks(&conn, project_id, &stack_ids).unwrap();

        assert_eq!(
            result.logical_photos_moved, 7,
            "merge of 3 stacks must move all 7 LPs"
        );

        assert_eq!(
            count_lps_in_stack(&conn, result.merged_stack_id),
            7,
            "merged stack must contain all 7 LPs"
        );
    }

    #[test]
    fn test_merge_logs_transaction() {
        // Sprint 7 §16.4: merge_stacks must insert a row into stack_transactions.
        let (project, project_id, stacks) = setup_merge_test_db(2, &[2, 3]);
        let conn = &project.conn;
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
        let (project, project_id, stacks) = setup_merge_test_db(2, &[2, 3]);
        let conn = &project.conn;
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
        let (project, project_id, stacks) = setup_merge_test_db(1, &[3]);
        let conn = &project.conn;
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
        let (project, project_id, stacks) = setup_merge_test_db(1, &[3]);
        let conn = &project.conn;
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
        let (project, project_id, stacks) = setup_merge_test_db(2, &[3, 4]);
        let conn = &project.conn;
        let stack_ids: Vec<i64> = stacks.iter().map(|(id, _)| *id).collect();
        let original_lps_per_stack: Vec<Vec<i64>> =
            stacks.iter().map(|(_, lps)| lps.clone()).collect();

        // Merge
        let merge_result = merge_stacks(&conn, project_id, &stack_ids).unwrap();
        assert_eq!(merge_result.logical_photos_moved, 7);

        // Undo
        undo_last_merge(&conn, project_id).unwrap();

        // Verify merged stack is deleted
        assert!(
            !stack_exists(&conn, merge_result.merged_stack_id),
            "merged stack must be deleted after undo"
        );

        // Verify original stacks are recreated
        for (idx, sid) in stack_ids.iter().enumerate() {
            assert!(
                stack_exists(&conn, *sid),
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
        assert_eq!(
            count_active_manual_merges(&conn, project_id),
            0,
            "manual_merges must have active=0 after undo"
        );
    }

    #[test]
    fn test_undo_merge_no_merges() {
        // Sprint 7 §16.4: undo_last_merge with no prior merges must error.
        let (project, project_id, _stacks) = setup_merge_test_db(2, &[3, 4]);
        let conn = &project.conn;

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
        let (project, project_id, stacks) = setup_merge_test_db(4, &[2, 3, 2, 1]);
        let conn = &project.conn;

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

    // ── BUG-01 Regression: insert_photo must persist camera parameters ──────

    #[test]
    fn test_insert_photo_roundtrips_camera_params() {
        // BUG-01: insert_photo previously ignored aperture, shutter_speed, iso,
        // focal_length, exposure_comp — they were silently dropped on INSERT.
        let project = TestLibraryBuilder::new()
            .add_photo(PhotoSpec {
                camera: Camera::Canon,
                orientation: 1,
                file_type: FileType::Jpeg,
                capture_time: None,
                camera_params: None,
            })
            .build();
        let conn = &project.conn;

        let photo_id = insert_photo(
            conn,
            "/test/photo_cam.jpg",
            "jpeg",
            Some("2024-06-15T14:30:00Z"),
            Some(1),
            Some("Canon EOS 80D"),
            Some("EF-S 18-135mm"),
            Some(2.8),
            Some("1/250"),
            Some(400),
            Some(35.0),
            Some(-0.7),
        )
        .unwrap();

        // Read back directly from the DB to verify all columns were written.
        let (aperture, shutter_speed, iso, focal_length, exposure_comp): (
            Option<f64>,
            Option<String>,
            Option<u32>,
            Option<f64>,
            Option<f64>,
        ) = conn
            .query_row(
                "SELECT aperture, shutter_speed, iso, focal_length, exposure_comp FROM photos WHERE id = ?1",
                params![photo_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?)),
            )
            .unwrap();

        assert_eq!(aperture, Some(2.8), "aperture must be persisted");
        assert_eq!(
            shutter_speed,
            Some("1/250".to_string()),
            "shutter_speed must be persisted"
        );
        assert_eq!(iso, Some(400), "iso must be persisted");
        assert_eq!(focal_length, Some(35.0), "focal_length must be persisted");
        assert_eq!(exposure_comp, Some(-0.7), "exposure_comp must be persisted");
    }

    #[test]
    fn test_insert_photo_camera_params_none_stays_null() {
        // Complement to BUG-01: when camera params are None, DB columns stay NULL.
        let project = TestLibraryBuilder::new()
            .add_photo(PhotoSpec {
                camera: Camera::Canon,
                orientation: 1,
                file_type: FileType::Jpeg,
                capture_time: None,
                camera_params: None,
            })
            .build();
        let conn = &project.conn;

        let photo_id = insert_photo(
            conn,
            "/test/no_params.jpg",
            "jpeg",
            None,
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

        let (aperture, iso): (Option<f64>, Option<u32>) = conn
            .query_row(
                "SELECT aperture, iso FROM photos WHERE id = ?1",
                params![photo_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();

        assert_eq!(aperture, None, "aperture must be NULL when not provided");
        assert_eq!(iso, None, "iso must be NULL when not provided");
    }

    // ── BUG-02 Regression: load_existing_scanned_files must scope by project ──

    #[test]
    fn test_load_existing_scanned_files_project_isolation() {
        // BUG-02: load_existing_scanned_files previously returned ALL photos
        // across all projects. With two projects each having distinct photos,
        // querying for project A must NOT return project B's photos.
        let project = TestLibraryBuilder::new()
            .add_photo(PhotoSpec {
                camera: Camera::Canon,
                orientation: 1,
                file_type: FileType::Jpeg,
                capture_time: None,
                camera_params: None,
            })
            .build();
        let conn = &project.conn;
        let project_a = project.project_id;

        // Create a second project in the same DB
        conn.execute(
            "INSERT INTO projects (name, slug, created_at) VALUES ('Beta', 'beta', '2024-01-01T00:00:00Z')",
            [],
        )
        .unwrap();
        let project_b = conn.last_insert_rowid();

        // Insert photos for project A
        let stack_a = insert_stack(&conn, project_a).unwrap();
        let photo_a1 = insert_photo(
            &conn,
            "/alpha/img_001.jpg",
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
        let photo_a2 = insert_photo(
            &conn,
            "/alpha/img_002.jpg",
            "jpeg",
            Some("2024-01-01T10:01:00Z"),
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
        let lp_a1 = insert_logical_photo(&conn, project_a, photo_a1, stack_a).unwrap();
        set_logical_photo_id(&conn, photo_a1, lp_a1).unwrap();
        let lp_a2 = insert_logical_photo(&conn, project_a, photo_a2, stack_a).unwrap();
        set_logical_photo_id(&conn, photo_a2, lp_a2).unwrap();

        // Insert photos for project B
        let stack_b = insert_stack(&conn, project_b).unwrap();
        let photo_b1 = insert_photo(
            &conn,
            "/beta/img_100.jpg",
            "jpeg",
            Some("2024-02-01T10:00:00Z"),
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
        let lp_b1 = insert_logical_photo(&conn, project_b, photo_b1, stack_b).unwrap();
        set_logical_photo_id(&conn, photo_b1, lp_b1).unwrap();

        // Query for project A only
        let files_a = load_existing_scanned_files(&conn, project_a);
        assert_eq!(
            files_a.len(),
            2,
            "project A must return exactly 2 scanned files"
        );
        let paths_a: Vec<String> = files_a
            .iter()
            .map(|f| f.path.to_string_lossy().to_string())
            .collect();
        assert!(
            paths_a.contains(&"/alpha/img_001.jpg".to_string()),
            "project A must contain img_001"
        );
        assert!(
            paths_a.contains(&"/alpha/img_002.jpg".to_string()),
            "project A must contain img_002"
        );

        // Query for project B only
        let files_b = load_existing_scanned_files(&conn, project_b);
        assert_eq!(
            files_b.len(),
            1,
            "project B must return exactly 1 scanned file"
        );
        assert_eq!(
            files_b[0].path.to_string_lossy(),
            "/beta/img_100.jpg",
            "project B must contain only its own photo"
        );
    }

    #[test]
    fn test_load_existing_scanned_files_returns_camera_params() {
        // Cross-check for BUG-01 + BUG-02: camera params survive the
        // insert_photo -> load_existing_scanned_files round-trip.
        let project = TestLibraryBuilder::new()
            .add_photo(PhotoSpec {
                camera: Camera::Sony,
                orientation: 1,
                file_type: FileType::Jpeg,
                capture_time: None,
                camera_params: None,
            })
            .build();
        let conn = &project.conn;
        let project_id = project.project_id;

        let stack_id = insert_stack(conn, project_id).unwrap();
        let photo_id = insert_photo(
            conn,
            "/test/cam_roundtrip.jpg",
            "jpeg",
            Some("2024-01-01T10:00:00Z"),
            None,
            Some("Sony DSC-RX10M4"),
            None,
            Some(5.6),
            Some("1/1000"),
            Some(100),
            Some(24.0),
            Some(0.3),
        )
        .unwrap();
        let lp_id = insert_logical_photo(conn, project_id, photo_id, stack_id).unwrap();
        set_logical_photo_id(conn, photo_id, lp_id).unwrap();

        let files = load_existing_scanned_files(conn, project_id);
        assert_eq!(files.len(), 1, "must return exactly 1 file");
        let f = &files[0];
        assert_eq!(f.aperture, Some(5.6), "aperture must round-trip");
        assert_eq!(
            f.shutter_speed,
            Some("1/1000".to_string()),
            "shutter_speed must round-trip"
        );
        assert_eq!(f.iso, Some(100), "iso must round-trip");
        assert_eq!(f.focal_length, Some(24.0), "focal_length must round-trip");
        assert_eq!(f.exposure_comp, Some(0.3), "exposure_comp must round-trip");
    }

    // ── BUG-03 Regression: undo_last_merge must only undo the LAST merge ────

    #[test]
    fn test_undo_last_merge_preserves_earlier_merge() {
        // BUG-03: undo_last_merge previously ran
        //   UPDATE manual_merges SET active = 0 WHERE project_id = ?1 AND active = 1
        // which deactivated ALL merges, not just the one being undone.
        //
        // Setup: 4 stacks. Merge stacks 0+1, then merge stacks 2+3.
        // Undo the LAST merge (2+3). The first merge (0+1) must remain active.
        let (project, project_id, stacks) = setup_merge_test_db(4, &[2, 2, 2, 2]);
        let conn = &project.conn;

        // First merge: stacks 0 + 1
        let merge1_ids = vec![stacks[0].0, stacks[1].0];
        let merge1_result = merge_stacks(&conn, project_id, &merge1_ids).unwrap();

        // Second merge: stacks 2 + 3
        let merge2_ids = vec![stacks[2].0, stacks[3].0];
        let merge2_result = merge_stacks(&conn, project_id, &merge2_ids).unwrap();

        // Verify we have 2 active manual_merges before undo
        assert_eq!(
            count_active_manual_merges(&conn, project_id),
            2,
            "must have 2 active manual_merges before undo"
        );

        // Undo the LAST merge (merge2: stacks 2+3)
        undo_last_merge(&conn, project_id).unwrap();

        // The first merge must still be active
        assert_eq!(
            count_active_manual_merges(&conn, project_id),
            1,
            "exactly 1 manual_merge must remain active after undoing only the last"
        );

        // The first merge's stack must still exist with all its LPs
        assert_eq!(
            count_lps_in_stack(&conn, merge1_result.merged_stack_id),
            4,
            "first merge stack must still have all 4 LPs"
        );

        // The second merge's stack must be deleted
        assert!(
            !stack_exists(&conn, merge2_result.merged_stack_id),
            "second merge stack must be deleted after undo"
        );

        // Stacks 2 and 3 must be restored
        for &sid in &[stacks[2].0, stacks[3].0] {
            assert!(
                stack_exists(&conn, sid),
                "original stack {} must be restored after undo",
                sid
            );
        }
    }

    #[test]
    fn test_undo_merge_only_deactivates_target_manual_merge() {
        // Direct BUG-03 assertion: after merge1 and merge2, the undo's SQL
        // UPDATE must target only the specific manual_merge_id stored in the
        // transaction details, not blanket-deactivate all active rows.
        let (project, project_id, stacks) = setup_merge_test_db(4, &[2, 2, 2, 2]);
        let conn = &project.conn;

        // Merge stacks 0+1
        let merge1_ids = vec![stacks[0].0, stacks[1].0];
        let merge1_result = merge_stacks(&conn, project_id, &merge1_ids).unwrap();

        // Merge stacks 2+3
        let merge2_ids = vec![stacks[2].0, stacks[3].0];
        merge_stacks(&conn, project_id, &merge2_ids).unwrap();

        // Verify the merge1 transaction details contain manual_merge_id
        let details_json: String = conn
            .query_row(
                "SELECT details FROM stack_transactions WHERE id = ?1",
                params![merge1_result.transaction_id],
                |row| row.get(0),
            )
            .unwrap();
        let details: serde_json::Value = serde_json::from_str(&details_json).unwrap();
        assert!(
            details.get("manual_merge_id").is_some(),
            "merge transaction must store manual_merge_id for targeted undo"
        );

        // Undo only the last merge
        undo_last_merge(&conn, project_id).unwrap();

        // Verify the manual_merge from merge1 is still active
        let merge1_manual_merge_id = details["manual_merge_id"].as_i64().unwrap();
        let still_active: i64 = conn
            .query_row(
                "SELECT active FROM manual_merges WHERE id = ?1",
                params![merge1_manual_merge_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(
            still_active, 1,
            "merge1's manual_merge row must remain active=1 after undoing only merge2"
        );
    }

    // ── Camera params on LogicalPhotoSummary ────────────────────────────────

    #[test]
    fn test_query_logical_photos_returns_camera_params() {
        use crate::import::test_fixtures::CameraParams;

        let project = TestLibraryBuilder::new()
            .add_photo(PhotoSpec {
                camera: Camera::Canon,
                orientation: 1,
                file_type: FileType::Jpeg,
                capture_time: Some("2024:01:15 10:30:00".to_string()),
                camera_params: Some(CameraParams {
                    aperture: Some(2.8),
                    shutter_speed: Some("1/250".to_string()),
                    iso: Some(400),
                    focal_length: Some(85.0),
                    exposure_comp: Some(0.7),
                    lens: Some("EF 85mm f/1.4".to_string()),
                }),
            })
            .build_db_only();

        let summaries = query_logical_photos_by_stack(&project.conn, project.stack_id()).unwrap();

        assert_eq!(summaries.len(), 1);
        let s = &summaries[0];

        // Camera params must be populated from the representative photo
        assert_eq!(s.aperture, Some(2.8), "aperture must be 2.8");
        assert_eq!(
            s.shutter_speed,
            Some("1/250".to_string()),
            "shutter_speed must be 1/250"
        );
        assert_eq!(s.iso, Some(400), "iso must be 400");
        assert_eq!(s.focal_length, Some(85.0), "focal_length must be 85.0");
    }

    #[test]
    fn test_query_logical_photos_returns_none_for_missing_camera_params() {
        // Photo with no camera params — all should be None
        let project = TestLibraryBuilder::new()
            .add_photo(PhotoSpec {
                camera: Camera::Canon,
                orientation: 1,
                file_type: FileType::Jpeg,
                capture_time: Some("2024:01:15 10:30:00".to_string()),
                camera_params: None,
            })
            .build_db_only();

        let summaries = query_logical_photos_by_stack(&project.conn, project.stack_id()).unwrap();

        assert_eq!(summaries.len(), 1);
        let s = &summaries[0];

        assert_eq!(s.aperture, None, "aperture must be None when not set");
        assert_eq!(s.shutter_speed, None, "shutter_speed must be None");
        assert_eq!(s.iso, None, "iso must be None");
        assert_eq!(s.focal_length, None, "focal_length must be None");
    }

    #[test]
    fn test_query_logical_photos_partial_camera_params() {
        use crate::import::test_fixtures::CameraParams;

        // Only aperture and ISO set, rest null
        let project = TestLibraryBuilder::new()
            .add_photo(PhotoSpec {
                camera: Camera::Canon,
                orientation: 1,
                file_type: FileType::Jpeg,
                capture_time: Some("2024:01:15 10:30:00".to_string()),
                camera_params: Some(CameraParams {
                    aperture: Some(5.6),
                    shutter_speed: None,
                    iso: Some(800),
                    focal_length: None,
                    exposure_comp: None,
                    lens: None,
                }),
            })
            .build_db_only();

        let summaries = query_logical_photos_by_stack(&project.conn, project.stack_id()).unwrap();

        assert_eq!(summaries.len(), 1);
        let s = &summaries[0];

        assert_eq!(s.aperture, Some(5.6), "aperture must be 5.6");
        assert_eq!(s.shutter_speed, None, "shutter_speed must be None");
        assert_eq!(s.iso, Some(800), "iso must be 800");
        assert_eq!(s.focal_length, None, "focal_length must be None");
    }

    /// BUG: re-indexing a project that has decisions fails with
    /// "Foreign key constraint failed" because clear_stacks_and_logical_photos
    /// deletes logical_photos without first deleting decisions that reference them.
    #[test]
    fn test_clear_stacks_succeeds_when_decisions_exist() {
        let project = TestLibraryBuilder::new()
            .add_photo(PhotoSpec {
                camera: Camera::Canon,
                orientation: 1,
                file_type: FileType::Jpeg,
                capture_time: None,
                camera_params: None,
            })
            .build_db_only();

        // Enable foreign keys (SQLite default is OFF — production may have it ON)
        project
            .conn
            .execute_batch("PRAGMA foreign_keys = ON;")
            .unwrap();

        let stack_id = project
            .conn
            .query_row(
                "SELECT stack_id FROM logical_photos WHERE project_id = ?1 LIMIT 1",
                params![project.project_id],
                |row| row.get::<_, i64>(0),
            )
            .unwrap();
        let lp_id = project.lp_ids[0];

        // Create a round and a decision — this is the normal flow after user presses Y/X
        let now = chrono::Utc::now().to_rfc3339();
        project
            .conn
            .execute(
                "INSERT INTO rounds (project_id, scope, scope_id, round_number, state, created_at)
             VALUES (?1, 'stack', ?2, 1, 'open', ?3)",
                params![project.project_id, stack_id, now],
            )
            .unwrap();
        let round_id = project.conn.last_insert_rowid();

        project
            .conn
            .execute(
                "INSERT INTO decisions (logical_photo_id, round_id, action, timestamp)
             VALUES (?1, ?2, 'keep', ?3)",
                params![lp_id, round_id, now],
            )
            .unwrap();

        // This is the re-index path — should succeed even with decisions present
        let result = clear_stacks_and_logical_photos(&project.conn, project.project_id);
        assert!(
            result.is_ok(),
            "clear_stacks_and_logical_photos must succeed when decisions exist, got: {:?}",
            result.err()
        );

        // Verify everything was cleaned up
        let lp_count: i64 = project
            .conn
            .query_row(
                "SELECT COUNT(*) FROM logical_photos WHERE project_id = ?1",
                params![project.project_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(lp_count, 0, "all logical_photos should be deleted");

        let decision_count: i64 = project
            .conn
            .query_row("SELECT COUNT(*) FROM decisions", [], |row| row.get(0))
            .unwrap();
        assert_eq!(decision_count, 0, "all decisions should be deleted");
    }

    // ── §R1 Round-creation helpers ──────────────────────────────────────────

    fn count_rounds_for_stack(conn: &Connection, project_id: i64, stack_id: i64) -> i64 {
        conn.query_row(
            "SELECT COUNT(*) FROM rounds WHERE project_id = ?1 AND scope = 'stack' AND scope_id = ?2",
            params![project_id, stack_id],
            |row| row.get(0),
        )
        .unwrap()
    }

    fn count_round_photos(conn: &Connection, round_id: i64) -> i64 {
        conn.query_row(
            "SELECT COUNT(*) FROM round_photos WHERE round_id = ?1",
            params![round_id],
            |row| row.get(0),
        )
        .unwrap()
    }

    fn get_round_id_for_stack(conn: &Connection, project_id: i64, stack_id: i64) -> i64 {
        conn.query_row(
            "SELECT id FROM rounds WHERE project_id = ?1 AND scope = 'stack' AND scope_id = ?2 ORDER BY id DESC LIMIT 1",
            params![project_id, stack_id],
            |row| row.get(0),
        )
        .unwrap()
    }

    // ── INVARIANT: round-visible photos == stack photos after any mutation ──

    /// The user-visible contract: for every stack, get_round_status returns a
    /// round, and query_logical_photos_by_round with that round returns exactly
    /// the logical_photos in that stack. This must hold after any operation.
    fn assert_round_photo_invariant(conn: &Connection, project_id: i64) {
        let stacks: Vec<(i64, i64)> = conn
            .prepare("SELECT s.id, COUNT(lp.id) FROM stacks s LEFT JOIN logical_photos lp ON lp.stack_id = s.id WHERE s.project_id = ?1 GROUP BY s.id")
            .unwrap()
            .query_map(params![project_id], |row| Ok((row.get(0)?, row.get(1)?)))
            .unwrap()
            .collect::<rusqlite::Result<_>>()
            .unwrap();

        for (stack_id, lp_count) in &stacks {
            // get_round_status must succeed (round must exist)
            let round_id = get_round_id_for_stack(conn, project_id, *stack_id);

            // query_logical_photos_by_round must return exactly the stack's photos
            let round_photos = query_logical_photos_by_round(conn, round_id).unwrap();
            assert_eq!(
                round_photos.len() as i64,
                *lp_count,
                "INVARIANT VIOLATED: stack {} has {} logical_photos but round {} returns {} photos",
                stack_id,
                lp_count,
                round_id,
                round_photos.len()
            );

            // Every returned photo must actually belong to this stack
            for p in &round_photos {
                let actual_stack: i64 = conn
                    .query_row(
                        "SELECT stack_id FROM logical_photos WHERE id = ?1",
                        params![p.logical_photo_id],
                        |row| row.get(0),
                    )
                    .unwrap();
                assert_eq!(
                    actual_stack, *stack_id,
                    "INVARIANT VIOLATED: photo {} is in stack {} but round {} (for stack {}) claims it",
                    p.logical_photo_id, actual_stack, round_id, stack_id
                );
            }
        }
    }

    // ── INVARIANT: every logical_photo belongs to exactly one stack ─────────

    fn assert_stack_membership_invariant(conn: &Connection, project_id: i64) {
        // No logical_photo with NULL stack_id
        let null_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM logical_photos WHERE project_id = ?1 AND stack_id IS NULL",
                params![project_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(
            null_count, 0,
            "INVARIANT VIOLATED: {} logical_photos have NULL stack_id",
            null_count
        );

        // Total LPs across all stacks == total LPs for project
        let total_lps: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM logical_photos WHERE project_id = ?1",
                params![project_id],
                |row| row.get(0),
            )
            .unwrap();
        let lps_in_stacks: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM logical_photos lp JOIN stacks s ON s.id = lp.stack_id WHERE s.project_id = ?1",
                params![project_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(
            total_lps, lps_in_stacks,
            "INVARIANT VIOLATED: {} total LPs but {} assigned to stacks",
            total_lps, lps_in_stacks
        );
    }

    // ── INVARIANT: current_status matches latest decision ────────────────────

    fn assert_decision_status_invariant(conn: &Connection, project_id: i64) {
        // For each LP that has decisions, current_status must match the latest one
        let rows: Vec<(i64, String, String)> = conn
            .prepare(
                "SELECT lp.id, lp.current_status,
                        COALESCE(
                            (SELECT d.action FROM decisions d
                             WHERE d.logical_photo_id = lp.id
                             ORDER BY d.id DESC LIMIT 1),
                            'undecided'
                        ) AS derived_status
                 FROM logical_photos lp
                 WHERE lp.project_id = ?1",
            )
            .unwrap()
            .query_map(params![project_id], |row| {
                Ok((row.get(0)?, row.get(1)?, row.get(2)?))
            })
            .unwrap()
            .collect::<rusqlite::Result<_>>()
            .unwrap();

        for (lp_id, current, derived) in &rows {
            assert_eq!(
                current, derived,
                "INVARIANT VIOLATED: LP {} has current_status='{}' but latest decision is '{}'",
                lp_id, current, derived
            );
        }
    }

    /// Assert ALL invariants at once — call after every mutation
    fn assert_all_invariants(conn: &Connection, project_id: i64) {
        assert_round_photo_invariant(conn, project_id);
        assert_stack_membership_invariant(conn, project_id);
        assert_decision_status_invariant(conn, project_id);
    }

    #[test]
    fn test_all_invariants_survive_full_lifecycle() {
        use crate::decisions::engine::{self, find_or_create_round, record_decision};
        use crate::decisions::model::DecisionAction;

        let (project, project_id, stacks) = setup_merge_test_db(3, &[3, 4, 2]);
        let conn = &project.conn;

        // Step 1: init rounds (simulates import)
        for (stack_id, _) in &stacks {
            init_round_for_stack(conn, project_id, *stack_id).unwrap();
        }
        assert_all_invariants(conn, project_id);

        // Step 2: make decisions on stack 0
        let (round_id, _) = find_or_create_round(conn, project_id, stacks[0].0).unwrap();
        record_decision(conn, stacks[0].1[0], round_id, &DecisionAction::Keep).unwrap();
        record_decision(conn, stacks[0].1[1], round_id, &DecisionAction::Eliminate).unwrap();
        assert_all_invariants(conn, project_id);

        // Step 3: undo a decision
        engine::undo_decision(conn, stacks[0].1[1], round_id).unwrap();
        assert_all_invariants(conn, project_id);

        // Step 4: re-decide
        record_decision(conn, stacks[0].1[1], round_id, &DecisionAction::Keep).unwrap();
        assert_all_invariants(conn, project_id);

        // Step 5: init again (double call — idempotency)
        for (stack_id, _) in &stacks {
            init_round_for_stack(conn, project_id, *stack_id).unwrap();
        }
        assert_all_invariants(conn, project_id);

        // Step 6: merge stacks 0 and 1
        let merge_ids = vec![stacks[0].0, stacks[1].0];
        let _merge_result = merge_stacks(conn, project_id, &merge_ids).unwrap();
        assert_all_invariants(conn, project_id);

        // Step 7: undo merge
        undo_last_merge(conn, project_id).unwrap();
        assert_all_invariants(conn, project_id);

        // Step 8: restack with a large gap (all photos → 1 stack)
        restack_merge_aware(conn, project_id, 3600).unwrap();
        assert_all_invariants(conn, project_id);

        // Step 9: restack with tiny gap (many stacks)
        restack_merge_aware(conn, project_id, 1).unwrap();
        assert_all_invariants(conn, project_id);
    }

    // ── §R1 init_round_for_stack is idempotent — never creates duplicates ──

    #[test]
    fn test_init_round_for_stack_is_idempotent() {
        let (project, project_id, stacks) = setup_merge_test_db(1, &[3]);
        let conn = &project.conn;
        let stack_id = stacks[0].0;

        // Call init_round_for_stack twice (simulates double import or restack)
        init_round_for_stack(conn, project_id, stack_id).unwrap();
        init_round_for_stack(conn, project_id, stack_id).unwrap();

        // Must have exactly 1 round, not 2
        assert_eq!(
            count_rounds_for_stack(conn, project_id, stack_id),
            1,
            "init_round_for_stack called twice must produce exactly 1 round, not 2"
        );

        // The round must have all 3 photos
        let round_id = get_round_id_for_stack(conn, project_id, stack_id);
        assert_eq!(
            count_round_photos(conn, round_id),
            3,
            "round must contain all 3 logical photos"
        );
    }

    #[test]
    fn test_get_round_status_and_find_or_create_round_return_same_round() {
        use crate::decisions::engine;

        let (project, project_id, stacks) = setup_merge_test_db(1, &[3]);
        let conn = &project.conn;
        let stack_id = stacks[0].0;

        init_round_for_stack(conn, project_id, stack_id).unwrap();

        // get_round_status and find_or_create_round must agree on the round
        let status = engine::get_round_status(conn, project_id, stack_id).unwrap();
        let (fcr_round_id, _) = engine::find_or_create_round(conn, project_id, stack_id).unwrap();

        assert_eq!(
            status.round_id, fcr_round_id,
            "get_round_status (round_id={}) and find_or_create_round (round_id={}) must return the same round",
            status.round_id, fcr_round_id
        );
    }

    // ── §R2 merge_stacks creates round for new stack ────────────────────────

    #[test]
    fn test_merge_stacks_creates_round_for_merged_stack() {
        let (project, project_id, stacks) = setup_merge_test_db(2, &[3, 4]);
        let conn = &project.conn;
        let stack_ids: Vec<i64> = stacks.iter().map(|(id, _)| *id).collect();
        let total_lps: usize = stacks.iter().map(|(_, lps)| lps.len()).sum();

        let result = merge_stacks(conn, project_id, &stack_ids).unwrap();

        // The merged stack must have round 1 auto-created
        assert_eq!(
            count_rounds_for_stack(conn, project_id, result.merged_stack_id),
            1,
            "merge_stacks must create round 1 for the merged stack"
        );

        // round_photos must contain all logical photos from both source stacks
        let round_id = get_round_id_for_stack(conn, project_id, result.merged_stack_id);
        assert_eq!(
            count_round_photos(conn, round_id),
            total_lps as i64,
            "round_photos must contain all {} logical photos from merged stacks",
            total_lps
        );
    }

    // ── §R3 restack creates rounds for all new stacks ───────────────────────

    #[test]
    fn test_restack_creates_rounds_for_all_new_stacks() {
        let (project, project_id, _stacks) = setup_merge_test_db(2, &[3, 4]);
        let conn = &project.conn;

        // Restack with a huge gap so all photos land in one stack
        restack_merge_aware(conn, project_id, 999_999).unwrap();

        // Get all stacks after restack
        let stacks_after: Vec<(i64, i64)> = conn
            .prepare("SELECT s.id, COUNT(lp.id) FROM stacks s JOIN logical_photos lp ON lp.stack_id = s.id WHERE s.project_id = ?1 GROUP BY s.id")
            .unwrap()
            .query_map(params![project_id], |row| Ok((row.get(0)?, row.get(1)?)))
            .unwrap()
            .collect::<rusqlite::Result<_>>()
            .unwrap();

        assert!(
            !stacks_after.is_empty(),
            "restack must produce at least one stack"
        );

        for (stack_id, lp_count) in &stacks_after {
            assert_eq!(
                count_rounds_for_stack(conn, project_id, *stack_id),
                1,
                "restack must create round 1 for stack {}",
                stack_id
            );

            let round_id = get_round_id_for_stack(conn, project_id, *stack_id);
            assert_eq!(
                count_round_photos(conn, round_id),
                *lp_count,
                "round_photos for stack {} must contain exactly {} logical photos",
                stack_id,
                lp_count
            );
        }
    }

    // ── §R4 undo_merge creates rounds for restored stacks ───────────────────

    #[test]
    fn test_undo_merge_creates_rounds_for_restored_stacks() {
        let (project, project_id, stacks) = setup_merge_test_db(2, &[3, 4]);
        let conn = &project.conn;
        let stack_ids: Vec<i64> = stacks.iter().map(|(id, _)| *id).collect();
        let lps_per_stack: Vec<(i64, usize)> =
            stacks.iter().map(|(id, lps)| (*id, lps.len())).collect();

        // Merge then undo
        merge_stacks(conn, project_id, &stack_ids).unwrap();
        undo_last_merge(conn, project_id).unwrap();

        // Each restored stack must have round 1 with its own logical photos
        for (stack_id, expected_lp_count) in &lps_per_stack {
            assert_eq!(
                count_rounds_for_stack(conn, project_id, *stack_id),
                1,
                "undo_merge must create round 1 for restored stack {}",
                stack_id
            );

            let round_id = get_round_id_for_stack(conn, project_id, *stack_id);
            assert_eq!(
                count_round_photos(conn, round_id),
                *expected_lp_count as i64,
                "round_photos for restored stack {} must contain {} logical photos",
                stack_id,
                expected_lp_count
            );
        }
    }

    // NOTE: undo_merge round restoration deferred to S10 (multi-round design).
    // Currently undo_merge creates fresh round 1 for restored stacks.

    // ── §R5 list_logical_photos works after merge ───────────────────────────

    #[test]
    fn test_list_logical_photos_works_after_merge() {
        let (project, project_id, stacks) = setup_merge_test_db(2, &[3, 4]);
        let conn = &project.conn;
        let stack_ids: Vec<i64> = stacks.iter().map(|(id, _)| *id).collect();
        let all_lp_ids: Vec<i64> = stacks.iter().flat_map(|(_, lps)| lps.clone()).collect();

        let result = merge_stacks(conn, project_id, &stack_ids).unwrap();

        // Get the round for the merged stack
        let round_id = get_round_id_for_stack(conn, project_id, result.merged_stack_id);

        // query_logical_photos_by_round must return all photos from the merged stack
        let photos = query_logical_photos_by_round(conn, round_id).unwrap();
        assert_eq!(
            photos.len(),
            all_lp_ids.len(),
            "query_logical_photos_by_round must return all {} photos after merge",
            all_lp_ids.len()
        );

        // Verify the returned IDs match
        let returned_ids: Vec<i64> = photos.iter().map(|p| p.logical_photo_id).collect();
        for lp_id in &all_lp_ids {
            assert!(
                returned_ids.contains(lp_id),
                "logical photo {} must be in query_logical_photos_by_round results",
                lp_id
            );
        }
    }
}
