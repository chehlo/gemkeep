use rusqlite::{params, Connection, OptionalExtension};
use std::path::Path;

use super::model::{DecisionAction, PhotoDetail, PhotoSnapshot, RoundStatus, RoundSummary};

/// Find or auto-create an open round for a stack.
/// Returns (round_id, was_created).
pub fn find_or_create_round(
    conn: &Connection,
    project_id: i64,
    stack_id: i64,
) -> rusqlite::Result<(i64, bool)> {
    // Try to find an existing open round for this stack
    let existing: Option<i64> = conn
        .query_row(
            "SELECT id FROM rounds WHERE project_id = ?1 AND scope = 'stack' AND scope_id = ?2 AND state = 'open' LIMIT 1",
            params![project_id, stack_id],
            |row| row.get(0),
        )
        .optional()?;

    if let Some(round_id) = existing {
        return Ok((round_id, false));
    }

    // No open round found — create a new one
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO rounds (project_id, scope, scope_id, round_number, state, created_at) VALUES (?1, 'stack', ?2, 1, 'open', ?3)",
        params![project_id, stack_id, now],
    )?;
    let round_id = conn.last_insert_rowid();

    // Populate round_photos with all logical photos in the stack
    conn.execute(
        "INSERT INTO round_photos (round_id, logical_photo_id)
         SELECT ?1, id FROM logical_photos WHERE stack_id = ?2",
        params![round_id, stack_id],
    )?;

    Ok((round_id, true))
}

/// Record a decision. Append-only: never UPDATE existing decisions.
/// The latest decision per (logical_photo_id, round_id) is effective.
/// Also updates logical_photos.current_status as a materialized cache.
pub fn record_decision(
    conn: &Connection,
    logical_photo_id: i64,
    round_id: i64,
    action: &DecisionAction,
) -> rusqlite::Result<i64> {
    // Guard: reject decisions on committed (immutable) rounds
    if is_round_committed(conn, round_id)? {
        return Err(rusqlite::Error::QueryReturnedNoRows);
    }

    let now = chrono::Utc::now().to_rfc3339();
    let action_str = action.as_str();

    // Append-only: INSERT a new decision row
    conn.execute(
        "INSERT INTO decisions (logical_photo_id, round_id, action, timestamp) VALUES (?1, ?2, ?3, ?4)",
        params![logical_photo_id, round_id, action_str, now],
    )?;
    let decision_id = conn.last_insert_rowid();

    // Update the materialized cache on logical_photos
    conn.execute(
        "UPDATE logical_photos SET current_status = ?1 WHERE id = ?2",
        params![action_str, logical_photo_id],
    )?;

    Ok(decision_id)
}

/// Commit a round: mark as immutable, reset survivors to undecided,
/// create next round with survivors only.
/// Returns Ok(()) on success.
pub fn commit_round(conn: &Connection, round_id: i64) -> rusqlite::Result<()> {
    // Guard: reject if round is already committed
    if is_round_committed(conn, round_id)? {
        return Err(rusqlite::Error::QueryReturnedNoRows);
    }

    let now = chrono::Utc::now().to_rfc3339();

    // 1. Seal current round
    conn.execute(
        "UPDATE rounds SET state = 'committed', committed_at = ?1 WHERE id = ?2 AND state = 'open'",
        params![now, round_id],
    )?;

    // 2. Get round metadata
    let (project_id, stack_id, round_number): (i64, i64, i32) = conn.query_row(
        "SELECT project_id, scope_id, round_number FROM rounds WHERE id = ?1",
        params![round_id],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
    )?;

    // 3. Reset survivors (non-eliminated) to undecided
    conn.execute(
        "UPDATE logical_photos SET current_status = 'undecided'
         WHERE id IN (SELECT logical_photo_id FROM round_photos WHERE round_id = ?1)
         AND current_status != 'eliminate'",
        params![round_id],
    )?;

    // 4. Get survivor IDs (those now undecided in this round's photos)
    let mut stmt = conn.prepare(
        "SELECT rp.logical_photo_id FROM round_photos rp
         JOIN logical_photos lp ON rp.logical_photo_id = lp.id
         WHERE rp.round_id = ?1 AND lp.current_status = 'undecided'",
    )?;
    let survivor_ids: Vec<i64> = stmt
        .query_map(params![round_id], |row| row.get(0))?
        .filter_map(|r| r.ok())
        .collect();

    // 5. Create next round
    conn.execute(
        "INSERT INTO rounds (project_id, scope, scope_id, round_number, state, created_at)
         VALUES (?1, 'stack', ?2, ?3, 'open', ?4)",
        params![project_id, stack_id, round_number + 1, now],
    )?;
    let new_round_id = conn.last_insert_rowid();

    // 6. Populate round_photos for new round with survivors
    for lp_id in &survivor_ids {
        conn.execute(
            "INSERT INTO round_photos (round_id, logical_photo_id) VALUES (?1, ?2)",
            params![new_round_id, lp_id],
        )?;
    }

    // 7. If zero survivors, mark the stack as inactive
    if survivor_ids.is_empty() {
        conn.execute(
            "UPDATE stacks SET active = 0 WHERE id = ?1",
            params![stack_id],
        )?;
    }

    Ok(())
}

/// Check if a round is committed (read-only).
pub fn is_round_committed(conn: &Connection, round_id: i64) -> rusqlite::Result<bool> {
    let state: String = conn.query_row(
        "SELECT state FROM rounds WHERE id = ?1",
        params![round_id],
        |row| row.get(0),
    )?;
    Ok(state == "committed")
}

/// Get round status for multiple stacks in a single SQL query.
/// Returns a map from stack_id to RoundStatus. Stacks with no rounds are omitted.
pub fn get_round_status_batch(
    conn: &Connection,
    project_id: i64,
    stack_ids: &[i64],
) -> rusqlite::Result<std::collections::HashMap<i64, RoundStatus>> {
    use std::collections::HashMap;

    if stack_ids.is_empty() {
        return Ok(HashMap::new());
    }

    // Single query: latest round per stack + decision counts
    // Uses a subquery to find the latest round_id per stack, then joins for counts.
    let placeholders: String = stack_ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
    let sql = format!(
        "SELECT
            r.scope_id                                          AS stack_id,
            r.id                                                AS round_id,
            r.round_number,
            r.state,
            r.committed_at,
            COUNT(rp.logical_photo_id)                              AS total_photos,
            SUM(CASE WHEN lp.current_status = 'keep'      THEN 1 ELSE 0 END) AS kept,
            SUM(CASE WHEN lp.current_status = 'eliminate'  THEN 1 ELSE 0 END) AS eliminated
         FROM rounds r
         JOIN (
             SELECT scope_id, MAX(id) AS max_id
             FROM rounds
             WHERE project_id = ?1 AND scope = 'stack' AND scope_id IN ({placeholders})
             GROUP BY scope_id
         ) latest ON r.id = latest.max_id
         LEFT JOIN round_photos rp ON rp.round_id = r.id
         LEFT JOIN logical_photos lp ON lp.id = rp.logical_photo_id
         GROUP BY r.id"
    );

    // Build params: project_id first, then all stack_ids
    let mut param_values: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();
    param_values.push(Box::new(project_id));
    for &sid in stack_ids {
        param_values.push(Box::new(sid));
    }
    let param_refs: Vec<&dyn rusqlite::ToSql> = param_values.iter().map(|p| p.as_ref()).collect();

    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(param_refs.as_slice(), |row| {
        let stack_id: i64 = row.get(0)?;
        let total_photos: i64 = row.get(5)?;
        let kept: i64 = row.get(6)?;
        let eliminated: i64 = row.get(7)?;
        let decided = kept + eliminated;
        Ok((
            stack_id,
            RoundStatus {
                round_id: row.get(1)?,
                round_number: row.get(2)?,
                state: row.get(3)?,
                committed_at: row.get(4)?,
                total_photos,
                decided,
                kept,
                eliminated,
                undecided: total_photos - decided,
            },
        ))
    })?;

    let mut result = HashMap::new();
    for row in rows {
        let (stack_id, status) = row?;
        result.insert(stack_id, status);
    }
    Ok(result)
}

/// Get round status with decision counts for a stack.
pub fn get_round_status(
    conn: &Connection,
    project_id: i64,
    stack_id: i64,
) -> rusqlite::Result<RoundStatus> {
    // Find the open round (or most recent) for this stack
    let (round_id, round_number, state, committed_at): (i64, i32, String, Option<String>) = conn
        .query_row(
            "SELECT id, round_number, state, committed_at FROM rounds
             WHERE project_id = ?1 AND scope = 'stack' AND scope_id = ?2
             ORDER BY id DESC LIMIT 1",
            params![project_id, stack_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )?;

    // Count total logical photos in the round (from round_photos, not logical_photos)
    let total_photos: i64 = conn.query_row(
        "SELECT COUNT(*) FROM round_photos WHERE round_id = ?1",
        params![round_id],
        |row| row.get(0),
    )?;

    // Count kept (join round_photos with logical_photos for current_status)
    let kept: i64 = conn.query_row(
        "SELECT COUNT(*) FROM round_photos rp JOIN logical_photos lp ON lp.id = rp.logical_photo_id WHERE rp.round_id = ?1 AND lp.current_status = 'keep'",
        params![round_id],
        |row| row.get(0),
    )?;

    // Count eliminated
    let eliminated: i64 = conn.query_row(
        "SELECT COUNT(*) FROM round_photos rp JOIN logical_photos lp ON lp.id = rp.logical_photo_id WHERE rp.round_id = ?1 AND lp.current_status = 'eliminate'",
        params![round_id],
        |row| row.get(0),
    )?;

    let decided = kept + eliminated;
    let undecided = total_photos - decided;

    Ok(RoundStatus {
        round_id,
        round_number,
        state,
        total_photos,
        decided,
        kept,
        eliminated,
        undecided,
        committed_at,
    })
}

/// Get decision statuses for all photos in a specific round.
/// Returns per-photo status derived from the decisions table for the given round,
/// not from the materialized `current_status` cache on `logical_photos`.
pub fn get_round_decisions(
    conn: &Connection,
    _stack_id: i64,
    round_id: i64,
) -> rusqlite::Result<Vec<super::model::PhotoDecisionStatus>> {
    let mut stmt = conn.prepare(
        "SELECT lp.id,
                COALESCE(
                    (SELECT d.action FROM decisions d
                     WHERE d.logical_photo_id = lp.id AND d.round_id = ?1
                     ORDER BY d.id DESC LIMIT 1),
                    'undecided'
                ) AS status
         FROM round_photos rp
         JOIN logical_photos lp ON lp.id = rp.logical_photo_id
         WHERE rp.round_id = ?1",
    )?;
    let rows = stmt.query_map(params![round_id], |row| {
        Ok(super::model::PhotoDecisionStatus {
            logical_photo_id: row.get(0)?,
            current_status: row.get(1)?,
        })
    })?;
    rows.collect()
}

/// Look up the stack_id for a logical photo.
/// Used by IPC commands to resolve stack context before calling engine functions.
pub fn get_stack_id_for_photo(
    conn: &Connection,
    _project_id: i64,
    logical_photo_id: i64,
) -> rusqlite::Result<i64> {
    conn.query_row(
        "SELECT stack_id FROM logical_photos WHERE id = ?1",
        params![logical_photo_id],
        |row| row.get(0),
    )
}

/// Undo the last decision for a logical photo in the current open round.
/// Recomputes current_status from remaining decisions in the same round.
pub fn undo_decision(
    conn: &Connection,
    logical_photo_id: i64,
    round_id: i64,
) -> rusqlite::Result<()> {
    // Delete the most recent decision for this photo in this round
    conn.execute(
        "DELETE FROM decisions WHERE id = (
            SELECT id FROM decisions
            WHERE logical_photo_id = ?1 AND round_id = ?2
            ORDER BY id DESC LIMIT 1
        )",
        params![logical_photo_id, round_id],
    )?;

    // Recompute current_status from remaining decisions in this round
    let remaining_action: Option<String> = conn
        .query_row(
            "SELECT action FROM decisions
             WHERE logical_photo_id = ?1 AND round_id = ?2
             ORDER BY id DESC LIMIT 1",
            params![logical_photo_id, round_id],
            |row| row.get(0),
        )
        .optional()?;

    let new_status = remaining_action.as_deref().unwrap_or("undecided");
    conn.execute(
        "UPDATE logical_photos SET current_status = ?1 WHERE id = ?2",
        params![new_status, logical_photo_id],
    )?;

    Ok(())
}

/// Get full detail for a single logical photo, including camera parameters.
pub fn get_photo_detail(
    conn: &Connection,
    logical_photo_id: i64,
    cache_dir: &Path,
) -> rusqlite::Result<PhotoDetail> {
    // Get the logical photo info
    let (current_status, representative_photo_id): (String, i64) = conn.query_row(
        "SELECT current_status, representative_photo_id FROM logical_photos WHERE id = ?1",
        params![logical_photo_id],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )?;

    // Get camera params from the representative photo
    struct RepPhoto {
        capture_time: Option<String>,
        camera_model: Option<String>,
        lens: Option<String>,
        aperture: Option<f64>,
        shutter_speed: Option<String>,
        iso: Option<u32>,
        focal_length: Option<f64>,
        exposure_comp: Option<f64>,
    }

    let rep = conn.query_row(
        "SELECT capture_time, camera_model, lens, aperture, shutter_speed, iso, focal_length, exposure_comp
         FROM photos WHERE id = ?1",
        params![representative_photo_id],
        |row| {
            Ok(RepPhoto {
                capture_time: row.get(0)?,
                camera_model: row.get(1)?,
                lens: row.get(2)?,
                aperture: row.get(3)?,
                shutter_speed: row.get(4)?,
                iso: row.get(5)?,
                focal_length: row.get(6)?,
                exposure_comp: row.get(7)?,
            })
        },
    )?;

    // Get all photos in this logical photo to determine has_raw, has_jpeg, paths
    let mut stmt = conn.prepare("SELECT path, format FROM photos WHERE logical_photo_id = ?1")?;
    let photos: Vec<(String, String)> = stmt
        .query_map(params![logical_photo_id], |row| {
            Ok((row.get(0)?, row.get(1)?))
        })?
        .filter_map(|r| r.ok())
        .collect();

    let mut has_raw = false;
    let mut has_jpeg = false;
    let mut raw_path: Option<String> = None;
    let mut jpeg_path: Option<String> = None;

    for (path, format) in &photos {
        match format.as_str() {
            "raw" => {
                has_raw = true;
                raw_path = Some(path.clone());
            }
            "jpeg" => {
                has_jpeg = true;
                jpeg_path = Some(path.clone());
            }
            _ => {}
        }
    }

    // Build thumbnail path
    let thumbnail_path = {
        let thumb = cache_dir.join(format!("{}.jpg", logical_photo_id));
        if thumb.exists() {
            Some(thumb.to_string_lossy().to_string())
        } else {
            None
        }
    };

    Ok(PhotoDetail {
        logical_photo_id,
        thumbnail_path,
        capture_time: rep.capture_time,
        camera_model: rep.camera_model,
        lens: rep.lens,
        has_raw,
        has_jpeg,
        current_status,
        aperture: rep.aperture,
        shutter_speed: rep.shutter_speed,
        iso: rep.iso,
        focal_length: rep.focal_length,
        exposure_comp: rep.exposure_comp,
        jpeg_path,
        raw_path,
        preview_path: {
            let preview = cache_dir.join(format!("{}_preview.jpg", logical_photo_id));
            if preview.exists() {
                Some(preview.to_string_lossy().to_string())
            } else {
                None
            }
        },
    })
}

/// List all rounds for a stack with summary counts.
/// Returns a Vec<RoundSummary> ordered by round_number ascending.
/// For committed rounds, counts are derived from the decisions table (historical).
/// For open rounds, counts are derived from logical_photos.current_status (live).
pub fn list_rounds(
    conn: &Connection,
    project_id: i64,
    stack_id: i64,
) -> rusqlite::Result<Vec<RoundSummary>> {
    let mut stmt = conn.prepare(
        "SELECT r.id, r.round_number, r.state, r.committed_at,
                COUNT(rp.logical_photo_id) as total
         FROM rounds r
         LEFT JOIN round_photos rp ON rp.round_id = r.id
         WHERE r.project_id = ?1 AND r.scope = 'stack' AND r.scope_id = ?2
         GROUP BY r.id
         ORDER BY r.round_number",
    )?;

    let rows: Vec<(i64, i32, String, Option<String>, i64)> = stmt
        .query_map(params![project_id, stack_id], |row| {
            Ok((
                row.get(0)?,
                row.get(1)?,
                row.get(2)?,
                row.get(3)?,
                row.get(4)?,
            ))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    let mut results = Vec::with_capacity(rows.len());
    for (round_id, round_number, state, committed_at, total) in rows {
        let (kept, eliminated) = if state == "committed" {
            // Derive from decisions table (latest decision per photo in this round)
            let kept: i64 = conn.query_row(
                "SELECT COUNT(DISTINCT rp.logical_photo_id) FROM round_photos rp
                 WHERE rp.round_id = ?1 AND (
                     SELECT d.action FROM decisions d
                     WHERE d.logical_photo_id = rp.logical_photo_id AND d.round_id = ?1
                     ORDER BY d.id DESC LIMIT 1
                 ) = 'keep'",
                params![round_id],
                |row| row.get(0),
            )?;
            let eliminated: i64 = conn.query_row(
                "SELECT COUNT(DISTINCT rp.logical_photo_id) FROM round_photos rp
                 WHERE rp.round_id = ?1 AND (
                     SELECT d.action FROM decisions d
                     WHERE d.logical_photo_id = rp.logical_photo_id AND d.round_id = ?1
                     ORDER BY d.id DESC LIMIT 1
                 ) = 'eliminate'",
                params![round_id],
                |row| row.get(0),
            )?;
            (kept, eliminated)
        } else {
            // Open round: derive from logical_photos.current_status
            let kept: i64 = conn.query_row(
                "SELECT COUNT(*) FROM round_photos rp
                 JOIN logical_photos lp ON lp.id = rp.logical_photo_id
                 WHERE rp.round_id = ?1 AND lp.current_status = 'keep'",
                params![round_id],
                |row| row.get(0),
            )?;
            let eliminated: i64 = conn.query_row(
                "SELECT COUNT(*) FROM round_photos rp
                 JOIN logical_photos lp ON lp.id = rp.logical_photo_id
                 WHERE rp.round_id = ?1 AND lp.current_status = 'eliminate'",
                params![round_id],
                |row| row.get(0),
            )?;
            (kept, eliminated)
        };

        results.push(RoundSummary {
            round_id,
            round_number,
            state,
            committed_at,
            total,
            kept,
            eliminated,
            undecided: total - kept - eliminated,
        });
    }

    Ok(results)
}

/// Get a snapshot of all photos in a specific round with their historical statuses.
/// For committed rounds, returns decisions as they were at commit time.
/// For open rounds, returns current live state.
pub fn get_round_snapshot(
    conn: &Connection,
    round_id: i64,
) -> rusqlite::Result<Vec<PhotoSnapshot>> {
    let state: String = conn.query_row(
        "SELECT state FROM rounds WHERE id = ?1",
        params![round_id],
        |row| row.get(0),
    )?;

    if state == "committed" {
        // Committed round: derive statuses from decisions table
        let mut stmt = conn.prepare(
            "SELECT rp.logical_photo_id,
                    COALESCE(
                        (SELECT d.action FROM decisions d
                         WHERE d.logical_photo_id = rp.logical_photo_id AND d.round_id = ?1
                         ORDER BY d.id DESC LIMIT 1),
                        'undecided'
                    ) AS status
             FROM round_photos rp WHERE rp.round_id = ?1",
        )?;
        let rows = stmt.query_map(params![round_id], |row| {
            Ok(PhotoSnapshot {
                logical_photo_id: row.get(0)?,
                status: row.get(1)?,
            })
        })?;
        rows.collect()
    } else {
        // Open round: derive from logical_photos.current_status
        let mut stmt = conn.prepare(
            "SELECT rp.logical_photo_id, lp.current_status as status
             FROM round_photos rp
             JOIN logical_photos lp ON lp.id = rp.logical_photo_id
             WHERE rp.round_id = ?1",
        )?;
        let rows = stmt.query_map(params![round_id], |row| {
            Ok(PhotoSnapshot {
                logical_photo_id: row.get(0)?,
                status: row.get(1)?,
            })
        })?;
        rows.collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::import::test_fixtures::{
        Camera, CameraParams, FileType, PhotoSpec, TestLibraryBuilder,
    };
    use rusqlite::params;

    fn get_current_status(conn: &Connection, lp_id: i64) -> String {
        conn.query_row(
            "SELECT current_status FROM logical_photos WHERE id = ?1",
            params![lp_id],
            |row| row.get(0),
        )
        .unwrap()
    }

    /// Set up an in-memory DB with migrations, a project, a stack, and N logical photos
    /// using TestLibraryBuilder. Returns (TestProject, project_id, stack_id, Vec<lp_id>).
    fn setup_test_db(
        num_photos: usize,
    ) -> (
        crate::import::test_fixtures::TestProject,
        i64,
        i64,
        Vec<i64>,
    ) {
        let mut builder = TestLibraryBuilder::new();
        for _ in 0..num_photos {
            builder = builder.add_photo(PhotoSpec {
                camera: Camera::Canon,
                orientation: 1,
                file_type: FileType::Jpeg,
                capture_time: Some("2024:01:01 10:00:00".to_string()),
                camera_params: None,
            });
        }
        let project = builder.build_db_only();
        let project_id = project.project_id;
        let stack_id = project.stack_ids[0];
        let lp_ids = project.lp_ids.clone();
        (project, project_id, stack_id, lp_ids)
    }

    // ── 16.1 Decision Engine Tests ───────────────────────────────────────────

    #[test]
    fn test_find_or_create_round_creates_round_1() {
        // Sprint 7 §16.1: When no round exists for a stack, find_or_create_round
        // creates a new Round 1 with scope='stack', state='open'.
        let (project, project_id, stack_id, _lp_ids) = setup_test_db(3);
        let conn = &project.conn;

        let (round_id, was_created) = find_or_create_round(conn, project_id, stack_id).unwrap();

        assert!(was_created, "round must be newly created");
        assert!(round_id > 0, "round_id must be positive");

        // Verify round exists in DB with correct attributes
        let (scope, scope_id, round_number, state): (String, i64, i32, String) = conn
            .query_row(
                "SELECT scope, scope_id, round_number, state FROM rounds WHERE id = ?1",
                params![round_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .unwrap();
        assert_eq!(scope, "stack");
        assert_eq!(scope_id, stack_id);
        assert_eq!(round_number, 1);
        assert_eq!(state, "open");
    }

    #[test]
    fn test_find_or_create_round_reuses_existing() {
        // Sprint 7 §16.1: If an open round already exists for the stack,
        // find_or_create_round returns it without creating a new one.
        let (project, project_id, stack_id, _lp_ids) = setup_test_db(3);
        let conn = &project.conn;

        // Manually insert a round
        let now = chrono::Utc::now().to_rfc3339();
        conn.execute(
            "INSERT INTO rounds (project_id, scope, scope_id, round_number, state, created_at)
             VALUES (?1, 'stack', ?2, 1, 'open', ?3)",
            params![project_id, stack_id, now],
        )
        .unwrap();
        let existing_round_id = conn.last_insert_rowid();

        let (round_id, was_created) = find_or_create_round(conn, project_id, stack_id).unwrap();

        assert!(!was_created, "round must NOT be newly created");
        assert_eq!(
            round_id, existing_round_id,
            "must return the existing round id"
        );

        // Verify only 1 round exists
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM rounds", [], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 1, "no new round should have been created");
    }

    #[test]
    fn test_make_decision_keep() {
        // Sprint 7 §16.1: record_decision with Keep creates a decisions row
        // and updates logical_photos.current_status.
        let (project, project_id, stack_id, lp_ids) = setup_test_db(1);
        let conn = &project.conn;
        let lp_id = lp_ids[0];

        // Create a round first
        let (round_id, _) = find_or_create_round(conn, project_id, stack_id).unwrap();

        let decision_id = record_decision(conn, lp_id, round_id, &DecisionAction::Keep).unwrap();
        assert!(decision_id > 0, "decision_id must be positive");

        // Verify decisions table
        let (action,): (String,) = conn
            .query_row(
                "SELECT action FROM decisions WHERE id = ?1",
                params![decision_id],
                |row| Ok((row.get(0)?,)),
            )
            .unwrap();
        assert_eq!(action, "keep");

        // Verify current_status updated
        let status = get_current_status(conn, lp_id);
        assert_eq!(status, "keep");
    }

    #[test]
    fn test_make_decision_eliminate() {
        // Sprint 7 §16.1: record_decision with Eliminate.
        let (project, project_id, stack_id, lp_ids) = setup_test_db(1);
        let lp_id = lp_ids[0];

        let (round_id, _) = find_or_create_round(&project.conn, project_id, stack_id).unwrap();
        record_decision(&project.conn, lp_id, round_id, &DecisionAction::Eliminate).unwrap();

        let status = get_current_status(&project.conn, lp_id);
        assert_eq!(status, "eliminate");
    }

    #[test]
    fn test_decision_re_decide_overwrites() {
        // Sprint 7 §16.1: Re-deciding on the same photo creates a new decision row
        // (append-only), and the latest decision becomes effective.
        let (project, project_id, stack_id, lp_ids) = setup_test_db(1);
        let lp_id = lp_ids[0];

        let (round_id, _) = find_or_create_round(&project.conn, project_id, stack_id).unwrap();

        // First decision: keep
        record_decision(&project.conn, lp_id, round_id, &DecisionAction::Keep).unwrap();
        // Second decision: eliminate (overwrites)
        record_decision(&project.conn, lp_id, round_id, &DecisionAction::Eliminate).unwrap();

        // Verify 2 rows exist (append-only)
        let count: i64 = project
            .conn
            .query_row(
                "SELECT COUNT(*) FROM decisions WHERE logical_photo_id = ?1 AND round_id = ?2",
                params![lp_id, round_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 2, "decisions table must have 2 rows (append-only)");

        // Verify current_status is 'eliminate' (latest wins)
        let status = get_current_status(&project.conn, lp_id);
        assert_eq!(status, "eliminate", "latest decision must win");
    }

    #[test]
    fn test_decision_updates_current_status() {
        // Sprint 7 §16.1: current_status is updated after each decision.
        let (project, project_id, stack_id, lp_ids) = setup_test_db(1);
        let lp_id = lp_ids[0];

        let (round_id, _) = find_or_create_round(&project.conn, project_id, stack_id).unwrap();

        // Keep
        record_decision(&project.conn, lp_id, round_id, &DecisionAction::Keep).unwrap();
        let status = get_current_status(&project.conn, lp_id);
        assert_eq!(status, "keep", "status must be 'keep' after Keep decision");

        // Eliminate
        record_decision(&project.conn, lp_id, round_id, &DecisionAction::Eliminate).unwrap();
        let status = get_current_status(&project.conn, lp_id);
        assert_eq!(
            status, "eliminate",
            "status must be 'eliminate' after Eliminate decision"
        );
    }

    #[test]
    fn test_decision_audit_log_append_only() {
        // Sprint 7 §16.1: Making 3 decisions on the same photo produces exactly
        // 3 rows in the decisions table. No rows are deleted or modified.
        let (project, project_id, stack_id, lp_ids) = setup_test_db(1);
        let lp_id = lp_ids[0];

        let (round_id, _) = find_or_create_round(&project.conn, project_id, stack_id).unwrap();

        let id1 = record_decision(&project.conn, lp_id, round_id, &DecisionAction::Keep).unwrap();
        let id2 =
            record_decision(&project.conn, lp_id, round_id, &DecisionAction::Eliminate).unwrap();
        let id3 = record_decision(&project.conn, lp_id, round_id, &DecisionAction::Keep).unwrap();

        // All three IDs must be distinct
        assert_ne!(id1, id2);
        assert_ne!(id2, id3);
        assert_ne!(id1, id3);

        // Exactly 3 rows
        let count: i64 = project
            .conn
            .query_row(
                "SELECT COUNT(*) FROM decisions WHERE logical_photo_id = ?1 AND round_id = ?2",
                params![lp_id, round_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 3, "decisions table must have exactly 3 rows");

        // Verify all 3 rows still exist (no deletions)
        let existing: Vec<i64> = {
            let mut stmt = project
                .conn
                .prepare(
                    "SELECT id FROM decisions WHERE logical_photo_id = ?1 AND round_id = ?2 ORDER BY id",
                )
                .unwrap();
            stmt.query_map(params![lp_id, round_id], |row| row.get(0))
                .unwrap()
                .filter_map(|r| r.ok())
                .collect()
        };
        assert_eq!(existing, vec![id1, id2, id3]);
    }

    #[test]
    fn test_decision_applies_to_pair() {
        // Sprint 7 §16.1: A decision on a logical_photo covers both RAW and JPEG
        // files in the pair. Both photos share the same logical_photo_id.
        let project = TestLibraryBuilder::new()
            .add_photo(PhotoSpec {
                camera: Camera::Canon,
                orientation: 1,
                file_type: FileType::Both,
                capture_time: Some("2024:01:01 10:00:00".to_string()),
                camera_params: None,
            })
            .build_db_only();
        let project_id = project.project_id;
        let stack_id = project.stack_ids[0];
        let lp_id = project.lp_ids[0];

        // Make decision on the logical photo
        let (round_id, _) = find_or_create_round(&project.conn, project_id, stack_id).unwrap();
        record_decision(&project.conn, lp_id, round_id, &DecisionAction::Keep).unwrap();

        // Verify both photos share the same logical_photo_id
        let photo_count: i64 = project
            .conn
            .query_row(
                "SELECT COUNT(*) FROM photos WHERE logical_photo_id = ?1",
                params![lp_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(
            photo_count, 2,
            "pair must have exactly 2 photos linked to the same logical_photo"
        );

        // Verify has both RAW and JPEG formats
        let formats: Vec<String> = {
            let mut stmt = project
                .conn
                .prepare("SELECT format FROM photos WHERE logical_photo_id = ?1 ORDER BY format")
                .unwrap();
            stmt.query_map(params![lp_id], |row| row.get(0))
                .unwrap()
                .filter_map(|r| r.ok())
                .collect()
        };
        assert!(
            formats.contains(&"jpeg".to_string()),
            "pair must include JPEG"
        );
        assert!(
            formats.iter().any(|f| f != "jpeg"),
            "pair must include RAW format"
        );

        // Verify logical_photos.current_status = 'keep' (covers both files)
        let status = get_current_status(&project.conn, lp_id);
        assert_eq!(
            status, "keep",
            "decision on logical photo must cover the entire pair"
        );
    }

    #[test]
    fn test_commit_round_locks_decisions() {
        // Sprint 7 §16.1: After commit_round, the round is immutable.
        // record_decision on a committed round must return an error.
        let (project, project_id, stack_id, lp_ids) = setup_test_db(1);
        let lp_id = lp_ids[0];

        let (round_id, _) = find_or_create_round(&project.conn, project_id, stack_id).unwrap();
        record_decision(&project.conn, lp_id, round_id, &DecisionAction::Keep).unwrap();

        // Commit the round
        commit_round(&project.conn, round_id).unwrap();

        // Verify round state
        let state: String = project
            .conn
            .query_row(
                "SELECT state FROM rounds WHERE id = ?1",
                params![round_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(state, "committed");

        // Verify committed_at is set
        let committed_at: Option<String> = project
            .conn
            .query_row(
                "SELECT committed_at FROM rounds WHERE id = ?1",
                params![round_id],
                |row| row.get(0),
            )
            .unwrap();
        assert!(
            committed_at.is_some(),
            "committed_at must be set after commit"
        );

        // Verify is_round_committed returns true
        assert!(is_round_committed(&project.conn, round_id).unwrap());

        // Verify record_decision on a committed round returns an error
        let result = record_decision(&project.conn, lp_id, round_id, &DecisionAction::Eliminate);
        assert!(
            result.is_err(),
            "record_decision on a committed round must return an error"
        );
    }

    #[test]
    fn test_undo_decision_sets_undecided() {
        // Sprint 7 §16.1: undo_decision sets current_status back to "undecided".
        let (project, project_id, stack_id, lp_ids) = setup_test_db(1);
        let lp_id = lp_ids[0];

        let (round_id, _) = find_or_create_round(&project.conn, project_id, stack_id).unwrap();
        record_decision(&project.conn, lp_id, round_id, &DecisionAction::Keep).unwrap();

        // Verify status is 'keep'
        let status = get_current_status(&project.conn, lp_id);
        assert_eq!(status, "keep");

        // Undo
        undo_decision(&project.conn, lp_id, round_id).unwrap();

        // Verify status is 'undecided'
        let status = get_current_status(&project.conn, lp_id);
        assert_eq!(
            status, "undecided",
            "undo_decision must reset status to undecided"
        );
    }

    #[test]
    fn test_round_auto_created_on_first_decision() {
        // Sprint 7 §16.1: The first decision on a stack auto-creates Round 1.
        // Subsequent decisions on the same stack reuse the existing round.
        let (project, project_id, stack_id, _lp_ids) = setup_test_db(2);

        // First call: round should be auto-created
        let (round_id_1, was_created_1) =
            find_or_create_round(&project.conn, project_id, stack_id).unwrap();
        assert!(was_created_1, "first call must auto-create a round");

        // Second call: round should be reused
        let (round_id_2, was_created_2) =
            find_or_create_round(&project.conn, project_id, stack_id).unwrap();
        assert!(!was_created_2, "second call must NOT create another round");
        assert_eq!(
            round_id_1, round_id_2,
            "both calls must return the same round id"
        );

        // Verify only 1 round total
        let count: i64 = project
            .conn
            .query_row("SELECT COUNT(*) FROM rounds", [], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 1, "only 1 round should exist for the stack");
    }

    #[test]
    fn test_get_round_status_counts() {
        // Sprint 7 §16.1: get_round_status returns correct counts.
        // Setup: 10 photos, 3 keep, 2 eliminate → decided=5, undecided=5
        let (project, project_id, stack_id, lp_ids) = setup_test_db(10);

        let (round_id, _) = find_or_create_round(&project.conn, project_id, stack_id).unwrap();

        // Make 3 keep decisions
        for &lp_id in &lp_ids[0..3] {
            record_decision(&project.conn, lp_id, round_id, &DecisionAction::Keep).unwrap();
        }
        // Make 2 eliminate decisions
        for &lp_id in &lp_ids[3..5] {
            record_decision(&project.conn, lp_id, round_id, &DecisionAction::Eliminate).unwrap();
        }

        let status = get_round_status(&project.conn, project_id, stack_id).unwrap();

        assert_eq!(status.round_id, round_id);
        assert_eq!(status.round_number, 1);
        assert_eq!(status.state, "open");
        assert_eq!(status.total_photos, 10, "total must be 10");
        assert_eq!(
            status.decided, 5,
            "decided must be 5 (3 keep + 2 eliminate)"
        );
        assert_eq!(status.kept, 3, "kept must be 3");
        assert_eq!(status.eliminated, 2, "eliminated must be 2");
        assert_eq!(status.undecided, 5, "undecided must be 5");
        assert!(
            status.committed_at.is_none(),
            "committed_at must be None for open round"
        );
    }

    // ── 16.2 Photo Detail Tests ──────────────────────────────────────────────

    #[test]
    fn test_get_photo_detail_with_camera_params() {
        // Sprint 7 §16.2: get_photo_detail returns camera parameters when present.
        let project = TestLibraryBuilder::new()
            .add_photo(PhotoSpec {
                camera: Camera::Canon,
                orientation: 1,
                file_type: FileType::Jpeg,
                capture_time: Some("2024:01:01 10:00:00".to_string()),
                camera_params: Some(CameraParams {
                    aperture: Some(2.8),
                    shutter_speed: Some("1/250".to_string()),
                    iso: Some(400),
                    focal_length: Some(85.0),
                    exposure_comp: Some(0.7),
                    lens: Some("RF 85mm f/1.2L".to_string()),
                }),
            })
            .build_db_only();
        let lp_id = project.lp_ids[0];

        let cache_dir = tempfile::tempdir().unwrap();
        let detail = get_photo_detail(&project.conn, lp_id, cache_dir.path()).unwrap();

        assert_eq!(detail.logical_photo_id, lp_id);
        assert!(
            detail.camera_model.is_some(),
            "camera_model must be set for Canon"
        );
        assert_eq!(detail.lens.as_deref(), Some("RF 85mm f/1.2L"));
        assert!(
            (detail.aperture.unwrap() - 2.8).abs() < 0.001,
            "aperture must be 2.8"
        );
        assert_eq!(detail.shutter_speed.as_deref(), Some("1/250"));
        assert_eq!(detail.iso, Some(400));
        assert!(
            (detail.focal_length.unwrap() - 85.0).abs() < 0.001,
            "focal_length must be 85.0"
        );
        assert!(
            (detail.exposure_comp.unwrap() - 0.7).abs() < 0.001,
            "exposure_comp must be 0.7"
        );
        assert_eq!(detail.current_status, "undecided");
    }

    #[test]
    fn test_get_photo_detail_missing_params() {
        // Sprint 7 §16.2: get_photo_detail returns None for missing camera params.
        let project = TestLibraryBuilder::new()
            .add_photo(PhotoSpec {
                camera: Camera::Canon,
                orientation: 1,
                file_type: FileType::Jpeg,
                capture_time: Some("2024:01:01 10:00:00".to_string()),
                camera_params: None,
            })
            .build_db_only();
        let lp_id = project.lp_ids[0];

        let cache_dir = tempfile::tempdir().unwrap();
        let detail = get_photo_detail(&project.conn, lp_id, cache_dir.path()).unwrap();

        assert_eq!(detail.logical_photo_id, lp_id);
        assert!(
            detail.aperture.is_none(),
            "aperture must be None when missing"
        );
        assert!(
            detail.shutter_speed.is_none(),
            "shutter_speed must be None when missing"
        );
        assert!(detail.iso.is_none(), "iso must be None when missing");
        assert!(
            detail.focal_length.is_none(),
            "focal_length must be None when missing"
        );
        assert!(
            detail.exposure_comp.is_none(),
            "exposure_comp must be None when missing"
        );
        assert_eq!(detail.current_status, "undecided");
    }

    #[test]
    fn test_get_photo_detail_pair_has_both_paths() {
        // Sprint 7 §16.2: For a RAW+JPEG pair, get_photo_detail returns both paths.
        let project = TestLibraryBuilder::new()
            .add_photo(PhotoSpec {
                camera: Camera::Canon,
                orientation: 1,
                file_type: FileType::Both,
                capture_time: Some("2024:01:01 10:00:00".to_string()),
                camera_params: None,
            })
            .build_db_only();
        let lp_id = project.lp_ids[0];

        let cache_dir = tempfile::tempdir().unwrap();
        let detail = get_photo_detail(&project.conn, lp_id, cache_dir.path()).unwrap();

        assert_eq!(detail.logical_photo_id, lp_id);
        assert!(detail.has_raw, "has_raw must be true");
        assert!(detail.has_jpeg, "has_jpeg must be true");
        assert!(
            detail.jpeg_path.is_some(),
            "jpeg_path must be set for a pair"
        );
        assert!(detail.raw_path.is_some(), "raw_path must be set for a pair");
    }

    // ── Round-commit: round_photos population ──────────────────────────────

    #[test]
    fn test_find_or_create_round_populates_round_photos() {
        // Spec §1: When Round 1 is created, round_photos must be populated
        // with ALL logical photos in the stack.
        let (project, project_id, stack_id, lp_ids) = setup_test_db(3);
        let conn = &project.conn;

        let (round_id, was_created) = find_or_create_round(conn, project_id, stack_id).unwrap();
        assert!(was_created, "round must be newly created");

        // Query round_photos for this round
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM round_photos WHERE round_id = ?1",
                params![round_id],
                |row| row.get(0),
            )
            .unwrap();

        assert_eq!(
            count, 3,
            "round_photos must contain all 3 stack photos after find_or_create_round"
        );

        // Verify the exact lp_ids are present
        let mut stored_ids: Vec<i64> = {
            let mut stmt = conn
                .prepare("SELECT logical_photo_id FROM round_photos WHERE round_id = ?1 ORDER BY logical_photo_id")
                .unwrap();
            stmt.query_map(params![round_id], |row| row.get(0))
                .unwrap()
                .filter_map(|r| r.ok())
                .collect()
        };
        stored_ids.sort();
        let mut expected_ids = lp_ids.clone();
        expected_ids.sort();
        assert_eq!(
            stored_ids, expected_ids,
            "round_photos must contain exactly the stack's logical photo IDs"
        );
    }

    #[test]
    fn test_commit_round_creates_next_round_with_survivors_in_round_photos() {
        // Spec §2: commit_round seals current round, resets survivors to undecided,
        // creates Round N+1, and populates round_photos with survivors only.
        let (project, project_id, stack_id, lp_ids) = setup_test_db(3);
        let conn = &project.conn;

        // Create round 1
        let (round_id, _) = find_or_create_round(conn, project_id, stack_id).unwrap();

        // Make decisions: keep, eliminate, keep
        record_decision(conn, lp_ids[0], round_id, &DecisionAction::Keep).unwrap();
        record_decision(conn, lp_ids[1], round_id, &DecisionAction::Eliminate).unwrap();
        record_decision(conn, lp_ids[2], round_id, &DecisionAction::Keep).unwrap();

        // Commit the round
        commit_round(conn, round_id).unwrap();

        // Assert: old round is committed
        let old_state: String = conn
            .query_row(
                "SELECT state FROM rounds WHERE id = ?1",
                params![round_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(old_state, "committed", "old round must be committed");

        // Assert: new round exists with round_number=2, state='open'
        let (new_round_id, new_round_number, new_state): (i64, i32, String) = conn
            .query_row(
                "SELECT id, round_number, state FROM rounds
                 WHERE project_id = ?1 AND scope = 'stack' AND scope_id = ?2 AND round_number = 2",
                params![project_id, stack_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .expect("Round 2 must exist after commit");
        assert_eq!(new_round_number, 2);
        assert_eq!(new_state, "open");

        // Assert: round_photos for new round has exactly 2 entries (survivors)
        let survivor_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM round_photos WHERE round_id = ?1",
                params![new_round_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(
            survivor_count, 2,
            "round_photos for Round 2 must have exactly 2 survivors (eliminated photo excluded)"
        );

        // Assert: the eliminated photo (lp_ids[1]) is NOT in round_photos for new round
        let eliminated_in_new: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM round_photos WHERE round_id = ?1 AND logical_photo_id = ?2",
                params![new_round_id, lp_ids[1]],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(
            eliminated_in_new, 0,
            "eliminated photo must NOT be in Round 2's round_photos"
        );

        // Assert: survivors' current_status = 'undecided'
        let survivor_statuses: Vec<String> = {
            let mut stmt = conn
                .prepare(
                    "SELECT lp.current_status FROM logical_photos lp
                     INNER JOIN round_photos rp ON rp.logical_photo_id = lp.id
                     WHERE rp.round_id = ?1",
                )
                .unwrap();
            stmt.query_map(params![new_round_id], |row| row.get(0))
                .unwrap()
                .filter_map(|r| r.ok())
                .collect()
        };
        for status in &survivor_statuses {
            assert_eq!(
                status, "undecided",
                "all survivors must be reset to undecided in Round 2"
            );
        }
    }

    // ── Round-commit: idempotency (Rule 11) ────────────────────────────────

    #[test]
    fn test_double_commit_same_round_rejected() {
        // B-idempotency (Rule 11): Committing the same round twice must fail
        // or be a no-op. A second commit on an already-committed round should
        // not create duplicate rounds or corrupt state.
        let (project, project_id, stack_id, lp_ids) = setup_test_db(3);
        let conn = &project.conn;

        // Create round 1 and make decisions
        let (round_id, _) = find_or_create_round(conn, project_id, stack_id).unwrap();
        record_decision(conn, lp_ids[0], round_id, &DecisionAction::Keep).unwrap();
        record_decision(conn, lp_ids[1], round_id, &DecisionAction::Eliminate).unwrap();
        record_decision(conn, lp_ids[2], round_id, &DecisionAction::Keep).unwrap();

        // First commit succeeds
        commit_round(conn, round_id).unwrap();

        // Verify round is committed
        assert!(is_round_committed(conn, round_id).unwrap());

        // Count rounds after first commit
        let round_count_after_first: i64 = conn
            .query_row("SELECT COUNT(*) FROM rounds", [], |row| row.get(0))
            .unwrap();

        // Second commit on the same (already committed) round must fail
        let result = commit_round(conn, round_id);
        assert!(
            result.is_err(),
            "double commit on already-committed round must return an error, but got Ok(())"
        );

        // Verify no extra rounds were created by the failed second commit
        let round_count_after_second: i64 = conn
            .query_row("SELECT COUNT(*) FROM rounds", [], |row| row.get(0))
            .unwrap();
        assert_eq!(
            round_count_after_first, round_count_after_second,
            "failed second commit must not create additional rounds"
        );
    }

    // ── Round-commit: multi-round chain (Rule 5) ─────────────────────────────

    #[test]
    fn test_round_2_to_3_with_correct_survivors() {
        // B-second-commit (Rule 5): Create 5 photos, decide in Round 1,
        // commit to Round 2, decide in Round 2, commit to Round 3.
        // Verify Round 3 has only the correct survivors from Round 2.
        let (project, project_id, stack_id, lp_ids) = setup_test_db(5);
        let conn = &project.conn;

        // ── Round 1: keep 0,1,2; eliminate 3,4 ──
        let (round1_id, _) = find_or_create_round(conn, project_id, stack_id).unwrap();
        record_decision(conn, lp_ids[0], round1_id, &DecisionAction::Keep).unwrap();
        record_decision(conn, lp_ids[1], round1_id, &DecisionAction::Keep).unwrap();
        record_decision(conn, lp_ids[2], round1_id, &DecisionAction::Keep).unwrap();
        record_decision(conn, lp_ids[3], round1_id, &DecisionAction::Eliminate).unwrap();
        record_decision(conn, lp_ids[4], round1_id, &DecisionAction::Eliminate).unwrap();

        // Commit Round 1 -> creates Round 2 with 3 survivors (lp 0,1,2)
        commit_round(conn, round1_id).unwrap();

        // Verify Round 2 exists and has 3 photos
        let (round2_id, round2_number): (i64, i32) = conn
            .query_row(
                "SELECT id, round_number FROM rounds
                 WHERE project_id = ?1 AND scope = 'stack' AND scope_id = ?2 AND state = 'open'",
                params![project_id, stack_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("Round 2 must exist");
        assert_eq!(round2_number, 2);

        let round2_photo_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM round_photos WHERE round_id = ?1",
                params![round2_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(
            round2_photo_count, 3,
            "Round 2 must have 3 survivors from Round 1"
        );

        // ── Round 2: keep 0; eliminate 1,2 ──
        record_decision(conn, lp_ids[0], round2_id, &DecisionAction::Keep).unwrap();
        record_decision(conn, lp_ids[1], round2_id, &DecisionAction::Eliminate).unwrap();
        record_decision(conn, lp_ids[2], round2_id, &DecisionAction::Eliminate).unwrap();

        // Commit Round 2 -> creates Round 3 with 1 survivor (lp 0)
        commit_round(conn, round2_id).unwrap();

        // Verify Round 3 exists
        let (round3_id, round3_number): (i64, i32) = conn
            .query_row(
                "SELECT id, round_number FROM rounds
                 WHERE project_id = ?1 AND scope = 'stack' AND scope_id = ?2 AND state = 'open'",
                params![project_id, stack_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("Round 3 must exist");
        assert_eq!(round3_number, 3);

        // Verify Round 3 has exactly 1 photo (lp_ids[0])
        let round3_photo_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM round_photos WHERE round_id = ?1",
                params![round3_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(
            round3_photo_count, 1,
            "Round 3 must have exactly 1 survivor from Round 2"
        );

        // Verify the survivor is lp_ids[0]
        let survivor_id: i64 = conn
            .query_row(
                "SELECT logical_photo_id FROM round_photos WHERE round_id = ?1",
                params![round3_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(
            survivor_id, lp_ids[0],
            "Round 3's only survivor must be lp_ids[0]"
        );

        // Verify the survivor's status is undecided
        let status = get_current_status(conn, lp_ids[0]);
        assert_eq!(
            status, "undecided",
            "Round 3 survivor must be reset to undecided"
        );

        // Verify eliminated photos from Round 1 are NOT in Round 3
        let eliminated_in_r3: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM round_photos WHERE round_id = ?1 AND logical_photo_id IN (?2, ?3)",
                params![round3_id, lp_ids[3], lp_ids[4]],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(
            eliminated_in_r3, 0,
            "photos eliminated in Round 1 must not appear in Round 3"
        );
    }

    // ── BUG-10: RAW preview path tests ─────────────────────────────────────

    #[test]
    fn test_get_photo_detail_returns_preview_path_when_file_exists() {
        // BUG-10: RAW-only photos need a full-size preview for SingleView.
        // get_photo_detail must return preview_path when {id}_preview.jpg exists.
        let project = TestLibraryBuilder::new()
            .add_photo(PhotoSpec {
                camera: Camera::Canon,
                orientation: 1,
                file_type: FileType::Jpeg,
                capture_time: Some("2024:01:01 10:00:00".to_string()),
                camera_params: None,
            })
            .build_db_only();
        let lp_id = project.lp_ids[0];

        let cache_dir = tempfile::tempdir().unwrap();
        // Create the preview file on disk
        let preview_path = cache_dir.path().join(format!("{}_preview.jpg", lp_id));
        std::fs::write(&preview_path, b"fake-preview-data").unwrap();

        let detail = get_photo_detail(&project.conn, lp_id, cache_dir.path()).unwrap();

        assert!(
            detail.preview_path.is_some(),
            "preview_path must be Some when {}_preview.jpg exists on disk",
            lp_id
        );
        assert!(
            detail.preview_path.unwrap().contains("_preview.jpg"),
            "preview_path must contain '_preview.jpg'"
        );
    }

    #[test]
    fn test_get_photo_detail_returns_none_preview_when_no_file() {
        // When no preview file exists, preview_path must be None.
        let project = TestLibraryBuilder::new()
            .add_photo(PhotoSpec {
                camera: Camera::Canon,
                orientation: 1,
                file_type: FileType::Jpeg,
                capture_time: Some("2024:01:01 10:00:00".to_string()),
                camera_params: None,
            })
            .build_db_only();
        let lp_id = project.lp_ids[0];

        let cache_dir = tempfile::tempdir().unwrap();
        // No preview file created

        let detail = get_photo_detail(&project.conn, lp_id, cache_dir.path()).unwrap();

        assert!(
            detail.preview_path.is_none(),
            "preview_path must be None when no preview file exists"
        );
    }

    // ── Bug 1 RED TEST: Thumbnail path prefix mismatch ─────────────────────

    #[test]
    fn test_bug1_get_photo_detail_finds_thumbnail_with_correct_filename() {
        // BUG: get_photo_detail looks for "thumb_{lp_id}.jpg" but thumbnails.rs
        // generates "{lp_id}.jpg". This causes thumbnail_path to be None even
        // when the thumbnail file exists on disk.
        //
        // This test creates a thumbnail at the REAL path ({lp_id}.jpg) and
        // asserts that get_photo_detail returns Some(thumbnail_path).
        // On current code this FAILS because engine.rs looks for thumb_{lp_id}.jpg.
        let project = TestLibraryBuilder::new()
            .add_photo(PhotoSpec {
                camera: Camera::Canon,
                orientation: 1,
                file_type: FileType::Jpeg,
                capture_time: Some("2024:01:01 10:00:00".to_string()),
                camera_params: None,
            })
            .build_db_only();
        let lp_id = project.lp_ids[0];

        // Create a thumbnail at the REAL path that thumbnails.rs would generate
        let cache_dir = tempfile::tempdir().unwrap();
        let real_thumb_path = cache_dir.path().join(format!("{}.jpg", lp_id));
        std::fs::write(&real_thumb_path, b"fake-jpeg-data").unwrap();
        assert!(real_thumb_path.exists(), "sanity: thumb file must exist");

        let detail = get_photo_detail(&project.conn, lp_id, cache_dir.path()).unwrap();

        // This assertion WILL FAIL on current code because engine.rs looks for
        // "thumb_{lp_id}.jpg" but the file on disk is "{lp_id}.jpg".
        assert!(
            detail.thumbnail_path.is_some(),
            "BUG 1: thumbnail_path must be Some when {}.jpg exists on disk, \
             but get_photo_detail looks for thumb_{}.jpg instead",
            lp_id,
            lp_id
        );
    }

    // ── Sprint 10 Phase A: Unified round-scoping RED tests ──────────────

    #[test]
    fn test_s10a1_get_round_status_counts_from_round_photos_not_logical_photos() {
        // Phase A, Item 1: After committing round 1 (3 photos, 1 eliminated → 2 survivors),
        // get_round_status for round 2 must show total_photos=2, not total_photos=3.
        //
        // BUG: Current get_round_status counts from logical_photos WHERE stack_id,
        // which always returns ALL photos in the stack regardless of round membership.
        // It must count from round_photos WHERE round_id instead.
        let (project, project_id, stack_id, lp_ids) = setup_test_db(3);
        let conn = &project.conn;

        // Create round 1 and make decisions: keep 2, eliminate 1
        let (round_id, _) = find_or_create_round(conn, project_id, stack_id).unwrap();
        record_decision(conn, lp_ids[0], round_id, &DecisionAction::Keep).unwrap();
        record_decision(conn, lp_ids[1], round_id, &DecisionAction::Keep).unwrap();
        record_decision(conn, lp_ids[2], round_id, &DecisionAction::Eliminate).unwrap();

        // Commit round 1 → creates round 2 with 2 survivors
        commit_round(conn, round_id).unwrap();

        // Get round status for round 2 (the latest/open round)
        let status = get_round_status(conn, project_id, stack_id).unwrap();

        assert_eq!(status.round_number, 2, "must be round 2 after commit");
        assert_eq!(status.state, "open", "round 2 must be open");
        // THIS ASSERTION WILL FAIL: current code counts from logical_photos (3),
        // but round 2 only has 2 survivors in round_photos
        assert_eq!(
            status.total_photos, 2,
            "round 2 total_photos must be 2 (survivors only), not 3 (all stack photos)"
        );
    }

    #[test]
    fn test_s10a3_get_round_decisions_returns_round_scoped_statuses() {
        // Phase A, Item 3: get_round_decisions returns per-photo statuses derived
        // from the decisions table for a specific round, not from the materialized
        // current_status cache.
        //
        // After round 1 commit (keep+eliminate), get_round_decisions for round 1
        // must show those historical decisions. get_round_decisions for round 2
        // must show all undecided (fresh round, no decisions yet).
        let (project, project_id, stack_id, lp_ids) = setup_test_db(3);
        let conn = &project.conn;

        // Round 1: keep photo 0, eliminate photo 1, keep photo 2
        let (round1_id, _) = find_or_create_round(conn, project_id, stack_id).unwrap();
        record_decision(conn, lp_ids[0], round1_id, &DecisionAction::Keep).unwrap();
        record_decision(conn, lp_ids[1], round1_id, &DecisionAction::Eliminate).unwrap();
        record_decision(conn, lp_ids[2], round1_id, &DecisionAction::Keep).unwrap();

        // Commit round 1 → creates round 2 with survivors (photos 0 and 2)
        commit_round(conn, round1_id).unwrap();

        // Get round 2 id
        let round2_id: i64 = conn
            .query_row(
                "SELECT id FROM rounds WHERE project_id = ?1 AND scope = 'stack' AND scope_id = ?2 AND round_number = 2",
                params![project_id, stack_id],
                |row| row.get(0),
            )
            .unwrap();

        // get_round_decisions for round 1: must show historical decisions
        // THIS WILL FAIL: get_round_decisions is a todo!() stub
        let r1_decisions = get_round_decisions(conn, stack_id, round1_id).unwrap();
        assert_eq!(r1_decisions.len(), 3, "round 1 must have 3 photo statuses");

        let r1_photo0 = r1_decisions
            .iter()
            .find(|d| d.logical_photo_id == lp_ids[0])
            .unwrap();
        assert_eq!(
            r1_photo0.current_status, "keep",
            "photo 0 was kept in round 1"
        );

        let r1_photo1 = r1_decisions
            .iter()
            .find(|d| d.logical_photo_id == lp_ids[1])
            .unwrap();
        assert_eq!(
            r1_photo1.current_status, "eliminate",
            "photo 1 was eliminated in round 1"
        );

        // get_round_decisions for round 2: survivors start undecided
        let r2_decisions = get_round_decisions(conn, stack_id, round2_id).unwrap();
        assert_eq!(
            r2_decisions.len(),
            2,
            "round 2 must have 2 photo statuses (survivors only)"
        );

        for d in &r2_decisions {
            assert_eq!(
                d.current_status, "undecided",
                "all round 2 photos must be undecided (fresh round)"
            );
        }
    }

    // ── Sprint 10 Phase B: Multi-round decision engine RED tests ────────

    #[test]
    fn test_s10b_make_decision_in_r2_after_r1_committed() {
        // B1: After committing R1, making a decision in R2 should succeed.
        // commit_round creates R2 automatically; find_or_create_round finds it.
        let (project, project_id, stack_id, lp_ids) = setup_test_db(3);
        let conn = &project.conn;

        // R1: decide all, commit
        let (r1_id, _) = find_or_create_round(conn, project_id, stack_id).unwrap();
        record_decision(conn, lp_ids[0], r1_id, &DecisionAction::Keep).unwrap();
        record_decision(conn, lp_ids[1], r1_id, &DecisionAction::Keep).unwrap();
        record_decision(conn, lp_ids[2], r1_id, &DecisionAction::Eliminate).unwrap();
        commit_round(conn, r1_id).unwrap();

        // R2 should exist (auto-created by commit). Make a decision on a survivor.
        let (r2_id, was_created) = find_or_create_round(conn, project_id, stack_id).unwrap();
        assert!(
            !was_created,
            "R2 already exists from commit, should not create new"
        );
        assert_ne!(r2_id, r1_id, "R2 must be a different round than R1");

        // Decision in R2 must succeed
        record_decision(conn, lp_ids[0], r2_id, &DecisionAction::Eliminate).unwrap();

        let status = get_current_status(conn, lp_ids[0]);
        assert_eq!(
            status, "eliminate",
            "current_status must reflect R2 decision"
        );
    }

    #[test]
    fn test_s10b_list_rounds_after_commit() {
        // B2: After R1 commit (3 photos: 2 keep, 1 eliminate), list_rounds must
        // return 2 RoundSummary entries with correct counts.
        let (project, project_id, stack_id, lp_ids) = setup_test_db(3);
        let conn = &project.conn;

        let (r1_id, _) = find_or_create_round(conn, project_id, stack_id).unwrap();
        record_decision(conn, lp_ids[0], r1_id, &DecisionAction::Keep).unwrap();
        record_decision(conn, lp_ids[1], r1_id, &DecisionAction::Keep).unwrap();
        record_decision(conn, lp_ids[2], r1_id, &DecisionAction::Eliminate).unwrap();
        commit_round(conn, r1_id).unwrap();

        let rounds = list_rounds(conn, project_id, stack_id).unwrap();

        assert_eq!(rounds.len(), 2, "must have 2 rounds after commit");

        // R1: committed, total=3, kept=2, eliminated=1, undecided=0
        let r1 = rounds.iter().find(|r| r.round_number == 1).unwrap();
        assert_eq!(r1.state, "committed");
        assert_eq!(r1.total, 3, "R1 total must be 3");
        assert_eq!(r1.kept, 2, "R1 kept must be 2");
        assert_eq!(r1.eliminated, 1, "R1 eliminated must be 1");
        assert_eq!(r1.undecided, 0, "R1 undecided must be 0");

        // R2: open, total=2, kept=0, eliminated=0, undecided=2
        let r2 = rounds.iter().find(|r| r.round_number == 2).unwrap();
        assert_eq!(r2.state, "open");
        assert_eq!(r2.total, 2, "R2 total must be 2 (survivors)");
        assert_eq!(r2.kept, 0, "R2 kept must be 0");
        assert_eq!(r2.eliminated, 0, "R2 eliminated must be 0");
        assert_eq!(r2.undecided, 2, "R2 undecided must be 2");
    }

    #[test]
    fn test_s10b_get_round_snapshot_committed() {
        // B3: After committing R1 (3 photos: 2 keep, 1 eliminate),
        // get_round_snapshot(r1_id) returns historical statuses from decisions table.
        let (project, project_id, stack_id, lp_ids) = setup_test_db(3);
        let conn = &project.conn;

        let (r1_id, _) = find_or_create_round(conn, project_id, stack_id).unwrap();
        record_decision(conn, lp_ids[0], r1_id, &DecisionAction::Keep).unwrap();
        record_decision(conn, lp_ids[1], r1_id, &DecisionAction::Eliminate).unwrap();
        record_decision(conn, lp_ids[2], r1_id, &DecisionAction::Keep).unwrap();
        commit_round(conn, r1_id).unwrap();

        let snapshot = get_round_snapshot(conn, r1_id).unwrap();

        assert_eq!(snapshot.len(), 3, "R1 snapshot must have 3 photos");

        let s0 = snapshot
            .iter()
            .find(|s| s.logical_photo_id == lp_ids[0])
            .unwrap();
        assert_eq!(s0.status, "keep", "photo 0 was kept in R1");

        let s1 = snapshot
            .iter()
            .find(|s| s.logical_photo_id == lp_ids[1])
            .unwrap();
        assert_eq!(s1.status, "eliminate", "photo 1 was eliminated in R1");

        let s2 = snapshot
            .iter()
            .find(|s| s.logical_photo_id == lp_ids[2])
            .unwrap();
        assert_eq!(s2.status, "keep", "photo 2 was kept in R1");
    }

    #[test]
    fn test_s10b_snapshot_immutable_after_r2_override() {
        // B4: Keep photo in R1, commit, eliminate same photo in R2.
        // get_round_snapshot for R1 must still show 'keep'.
        let (project, project_id, stack_id, lp_ids) = setup_test_db(2);
        let conn = &project.conn;

        // R1: keep both
        let (r1_id, _) = find_or_create_round(conn, project_id, stack_id).unwrap();
        record_decision(conn, lp_ids[0], r1_id, &DecisionAction::Keep).unwrap();
        record_decision(conn, lp_ids[1], r1_id, &DecisionAction::Keep).unwrap();
        commit_round(conn, r1_id).unwrap();

        // R2: eliminate photo 0
        let (r2_id, _) = find_or_create_round(conn, project_id, stack_id).unwrap();
        record_decision(conn, lp_ids[0], r2_id, &DecisionAction::Eliminate).unwrap();

        // R1 snapshot must be immutable — photo 0 still 'keep' in R1
        let snapshot = get_round_snapshot(conn, r1_id).unwrap();
        let s0 = snapshot
            .iter()
            .find(|s| s.logical_photo_id == lp_ids[0])
            .unwrap();
        assert_eq!(
            s0.status, "keep",
            "R1 snapshot must be immutable: photo 0 was kept in R1, even though eliminated in R2"
        );
    }

    #[test]
    fn test_s10b_undo_r2_with_remaining_decisions() {
        // B5: In R2, decide 'keep' then 'eliminate' on same photo. Undo last.
        // current_status should be 'keep' (the remaining decision), not 'undecided'.
        //
        // BUG: Current undo_decision always sets current_status = 'undecided',
        // ignoring any remaining earlier decisions in the same round.
        let (project, project_id, stack_id, lp_ids) = setup_test_db(2);
        let conn = &project.conn;

        // R1: keep both, commit
        let (r1_id, _) = find_or_create_round(conn, project_id, stack_id).unwrap();
        record_decision(conn, lp_ids[0], r1_id, &DecisionAction::Keep).unwrap();
        record_decision(conn, lp_ids[1], r1_id, &DecisionAction::Keep).unwrap();
        commit_round(conn, r1_id).unwrap();

        // R2: decide keep then eliminate on photo 0
        let (r2_id, _) = find_or_create_round(conn, project_id, stack_id).unwrap();
        record_decision(conn, lp_ids[0], r2_id, &DecisionAction::Keep).unwrap();
        record_decision(conn, lp_ids[0], r2_id, &DecisionAction::Eliminate).unwrap();

        // Undo last decision (eliminate) — keep decision still remains
        undo_decision(conn, lp_ids[0], r2_id).unwrap();

        let status = get_current_status(conn, lp_ids[0]);
        assert_eq!(
            status, "keep",
            "after undoing eliminate, remaining 'keep' decision must be reflected in current_status"
        );
    }

    #[test]
    fn test_s10b_undo_only_r2_decision() {
        // B6: In R2, make one decision on a photo. Undo it.
        // current_status should be 'undecided' (not R1's value).
        // The photo enters R2 as undecided; after undo, it goes back to undecided.
        let (project, project_id, stack_id, lp_ids) = setup_test_db(2);
        let conn = &project.conn;

        // R1: keep both, commit
        let (r1_id, _) = find_or_create_round(conn, project_id, stack_id).unwrap();
        record_decision(conn, lp_ids[0], r1_id, &DecisionAction::Keep).unwrap();
        record_decision(conn, lp_ids[1], r1_id, &DecisionAction::Keep).unwrap();
        commit_round(conn, r1_id).unwrap();

        // R2: decide eliminate on photo 0
        let (r2_id, _) = find_or_create_round(conn, project_id, stack_id).unwrap();
        record_decision(conn, lp_ids[0], r2_id, &DecisionAction::Eliminate).unwrap();

        // Undo — no remaining decisions in R2 for this photo
        undo_decision(conn, lp_ids[0], r2_id).unwrap();

        let status = get_current_status(conn, lp_ids[0]);
        assert_eq!(
            status, "undecided",
            "after undoing only R2 decision, current_status must be 'undecided'"
        );
    }

    #[test]
    fn test_s10b_make_decision_auto_creates_r1() {
        // B7: On a stack with no rounds, make a decision. Should auto-create R1.
        let (project, project_id, stack_id, lp_ids) = setup_test_db(2);
        let conn = &project.conn;

        // Verify no rounds exist yet
        let round_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM rounds", [], |row| row.get(0))
            .unwrap();
        assert_eq!(round_count, 0, "no rounds should exist initially");

        // find_or_create_round + record_decision (this is what make_decision does)
        let (r1_id, was_created) = find_or_create_round(conn, project_id, stack_id).unwrap();
        assert!(was_created, "round must be auto-created");

        record_decision(conn, lp_ids[0], r1_id, &DecisionAction::Keep).unwrap();

        // Verify R1 exists
        let (round_number, state): (i32, String) = conn
            .query_row(
                "SELECT round_number, state FROM rounds WHERE id = ?1",
                params![r1_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(round_number, 1, "auto-created round must be round 1");
        assert_eq!(state, "open", "auto-created round must be open");

        // Verify decision was recorded
        let status = get_current_status(conn, lp_ids[0]);
        assert_eq!(
            status, "keep",
            "decision must be recorded after auto-create"
        );
    }

    #[test]
    fn test_s10b_list_rounds_empty_stack() {
        // B8: list_rounds on a stack with no rounds returns empty vec.
        let (project, project_id, stack_id, _lp_ids) = setup_test_db(2);
        let conn = &project.conn;

        let rounds = list_rounds(conn, project_id, stack_id).unwrap();
        assert_eq!(
            rounds.len(),
            0,
            "list_rounds on stack with no rounds must return empty vec"
        );
    }

    #[test]
    fn test_s10b_get_round_snapshot_open_round() {
        // B9: Make decisions without committing. get_round_snapshot returns current live state.
        let (project, project_id, stack_id, lp_ids) = setup_test_db(3);
        let conn = &project.conn;

        let (r1_id, _) = find_or_create_round(conn, project_id, stack_id).unwrap();
        record_decision(conn, lp_ids[0], r1_id, &DecisionAction::Keep).unwrap();
        record_decision(conn, lp_ids[1], r1_id, &DecisionAction::Eliminate).unwrap();
        // lp_ids[2] left undecided

        let snapshot = get_round_snapshot(conn, r1_id).unwrap();

        assert_eq!(
            snapshot.len(),
            3,
            "open round snapshot must have all 3 photos"
        );

        let s0 = snapshot
            .iter()
            .find(|s| s.logical_photo_id == lp_ids[0])
            .unwrap();
        assert_eq!(s0.status, "keep", "photo 0 decided keep");

        let s1 = snapshot
            .iter()
            .find(|s| s.logical_photo_id == lp_ids[1])
            .unwrap();
        assert_eq!(s1.status, "eliminate", "photo 1 decided eliminate");

        let s2 = snapshot
            .iter()
            .find(|s| s.logical_photo_id == lp_ids[2])
            .unwrap();
        assert_eq!(s2.status, "undecided", "photo 2 not yet decided");
    }

    #[test]
    fn test_s10b_lifecycle_multiround_invariants() {
        // B10: Full lifecycle test asserting structural invariants at each step.
        // R1: 5 photos → decide all (3 keep, 2 eliminate) → commit
        // R2: 3 survivors → decide 1 keep, 1 eliminate → undo eliminate → re-decide eliminate
        // Assert counts at each step.
        let (project, project_id, stack_id, lp_ids) = setup_test_db(5);
        let conn = &project.conn;

        // ── Step 1: Create R1, decide all ──
        let (r1_id, _) = find_or_create_round(conn, project_id, stack_id).unwrap();

        // round_photos must have 5 entries
        let rp_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM round_photos WHERE round_id = ?1",
                params![r1_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(rp_count, 5, "R1 round_photos must have 5 entries");

        record_decision(conn, lp_ids[0], r1_id, &DecisionAction::Keep).unwrap();
        record_decision(conn, lp_ids[1], r1_id, &DecisionAction::Keep).unwrap();
        record_decision(conn, lp_ids[2], r1_id, &DecisionAction::Keep).unwrap();
        record_decision(conn, lp_ids[3], r1_id, &DecisionAction::Eliminate).unwrap();
        record_decision(conn, lp_ids[4], r1_id, &DecisionAction::Eliminate).unwrap();

        // Invariant: 5 decisions in R1
        let d_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM decisions WHERE round_id = ?1",
                params![r1_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(d_count, 5, "R1 must have 5 decisions");

        // ── Step 2: Commit R1 ──
        commit_round(conn, r1_id).unwrap();

        // R1 must be committed
        assert!(
            is_round_committed(conn, r1_id).unwrap(),
            "R1 must be committed"
        );

        // R2 must exist with 3 survivors
        let r2_id: i64 = conn
            .query_row(
                "SELECT id FROM rounds WHERE project_id = ?1 AND scope = 'stack' AND scope_id = ?2 AND round_number = 2",
                params![project_id, stack_id],
                |row| row.get(0),
            )
            .unwrap();

        let r2_rp_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM round_photos WHERE round_id = ?1",
                params![r2_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(r2_rp_count, 3, "R2 round_photos must have 3 survivors");

        // All 3 survivors must be undecided
        for &lp_id in &lp_ids[0..3] {
            let status = get_current_status(conn, lp_id);
            assert_eq!(
                status, "undecided",
                "survivor {} must be undecided in R2",
                lp_id
            );
        }

        // ── Step 3: R2 decisions with undo ──
        record_decision(conn, lp_ids[0], r2_id, &DecisionAction::Keep).unwrap();
        record_decision(conn, lp_ids[1], r2_id, &DecisionAction::Eliminate).unwrap();

        // Undo eliminate on lp_ids[1]
        undo_decision(conn, lp_ids[1], r2_id).unwrap();

        // After undo, lp_ids[1] should be undecided (no remaining R2 decisions)
        let status_after_undo = get_current_status(conn, lp_ids[1]);
        assert_eq!(
            status_after_undo, "undecided",
            "after undoing only R2 decision, photo must be undecided"
        );

        // Re-decide: eliminate lp_ids[1]
        record_decision(conn, lp_ids[1], r2_id, &DecisionAction::Eliminate).unwrap();

        let status_after_redecide = get_current_status(conn, lp_ids[1]);
        assert_eq!(
            status_after_redecide, "eliminate",
            "re-decided photo must be eliminate"
        );

        // ── Step 4: Verify R2 decision counts ──
        let r2_decisions: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM decisions WHERE round_id = ?1",
                params![r2_id],
                |row| row.get(0),
            )
            .unwrap();
        // keep(lp0) + eliminate(lp1 re-decide) = 2
        // (the undone eliminate was DELETED by undo_decision, so only 2 remain)
        assert_eq!(
            r2_decisions, 2,
            "R2 must have 2 decision rows (keep + re-decide; undone row deleted)"
        );

        // ── Step 5: Verify list_rounds shows correct state ──
        let rounds = list_rounds(conn, project_id, stack_id).unwrap();
        assert_eq!(rounds.len(), 2, "must have 2 rounds");

        let r1_summary = rounds.iter().find(|r| r.round_number == 1).unwrap();
        assert_eq!(r1_summary.state, "committed");
        assert_eq!(r1_summary.total, 5);

        let r2_summary = rounds.iter().find(|r| r.round_number == 2).unwrap();
        assert_eq!(r2_summary.state, "open");
        assert_eq!(r2_summary.total, 3);
    }

    #[test]
    fn test_s10a4_undo_merge_blocked_after_round_1() {
        // Phase A, Item 4: undo_merge is only allowed when the merged stack's
        // latest round has round_number = 1. After committing and creating round 2,
        // undo must fail with an error.
        //
        // Setup: create 2 stacks, merge them, make decisions, commit (creating round 2),
        // then try to undo the merge → must fail.
        use crate::photos::repository::{merge_stacks, undo_last_merge};

        // Create 2 stacks with 2 photos each
        let mut builder = TestLibraryBuilder::new();
        for _ in 0..4 {
            builder = builder.add_photo(PhotoSpec {
                camera: Camera::Canon,
                orientation: 1,
                file_type: FileType::Jpeg,
                capture_time: Some("2024:01:01 10:00:00".to_string()),
                camera_params: None,
            });
        }
        let project = builder.with_layout(&[2, 2]).build_db_only();
        let conn = &project.conn;
        let project_id = project.project_id;
        let stack_ids = &project.stack_ids;

        // Merge stack 0 and stack 1
        let merge_result = merge_stacks(conn, project_id, stack_ids).unwrap();
        let merged_stack_id = merge_result.merged_stack_id;

        // Get all logical photos in merged stack
        let merged_lp_ids: Vec<i64> = {
            let mut stmt = conn
                .prepare("SELECT id FROM logical_photos WHERE stack_id = ?1 ORDER BY id")
                .unwrap();
            stmt.query_map(params![merged_stack_id], |row| row.get(0))
                .unwrap()
                .filter_map(|r| r.ok())
                .collect()
        };

        // Create round 1, make decisions, commit → round 2 created
        let (round_id, _) = find_or_create_round(conn, project_id, merged_stack_id).unwrap();
        record_decision(conn, merged_lp_ids[0], round_id, &DecisionAction::Keep).unwrap();
        record_decision(conn, merged_lp_ids[1], round_id, &DecisionAction::Keep).unwrap();
        record_decision(conn, merged_lp_ids[2], round_id, &DecisionAction::Eliminate).unwrap();
        record_decision(conn, merged_lp_ids[3], round_id, &DecisionAction::Keep).unwrap();
        commit_round(conn, round_id).unwrap();

        // Verify round 2 exists
        let max_round: i32 = conn
            .query_row(
                "SELECT MAX(round_number) FROM rounds WHERE scope = 'stack' AND scope_id = ?1",
                params![merged_stack_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(max_round, 2, "round 2 must exist after commit");

        // Try to undo merge → must fail because stack has progressed beyond round 1
        let result = undo_last_merge(conn, project_id);
        assert!(
            result.is_err(),
            "undo_merge must fail when stack has progressed beyond round 1, but it succeeded"
        );
        let err_msg = result.unwrap_err().to_string();
        assert!(
            err_msg.contains("round 1") || err_msg.contains("beyond"),
            "error message must mention round restriction, got: {}",
            err_msg
        );
    }

    // ─── Sprint 10B: get_stack_id_for_photo (extracted from commands/decisions.rs) ───

    #[test]
    fn test_get_stack_id_for_photo() {
        let (project, project_id, stack_id, lp_ids) = setup_test_db(2);
        let conn = &project.conn;

        let result = get_stack_id_for_photo(conn, project_id, lp_ids[0]);
        assert!(
            result.is_ok(),
            "get_stack_id_for_photo should succeed for existing photo"
        );
        assert_eq!(
            result.unwrap(),
            stack_id,
            "should return the correct stack_id for the logical photo"
        );
    }

    #[test]
    fn test_get_stack_id_for_photo_not_found() {
        let (project, project_id, _stack_id, _lp_ids) = setup_test_db(1);
        let conn = &project.conn;

        let result = get_stack_id_for_photo(conn, project_id, 99999);
        assert!(
            result.is_err(),
            "get_stack_id_for_photo should return error for non-existent photo"
        );
    }

    #[test]
    fn test_s10_crash_recovery_round2_decisions_persist_after_reconnect() {
        // Crash recovery: Round 2 decisions survive connection drop + reconnect.
        // Uses a file-based DB (not in-memory) so we can reopen after drop.
        use tempfile::TempDir;

        let tmp = TempDir::new().expect("cannot create temp dir");
        let db_path = tmp.path().join("test.db");

        // Record IDs we need after the connection is dropped
        let (project_id, stack_id, lp_ids, round2_id, decisions_before);

        {
            // -- First connection: set up schema, data, and make Round 2 decisions --
            let conn = Connection::open(&db_path).unwrap();
            crate::db::run_migrations(&conn).unwrap();

            // Create project, stack, and 3 logical photos (mirrors setup_test_db)
            conn.execute(
                "INSERT INTO projects (name, slug, created_at) VALUES ('crash-test', 'crash-test', '2024-01-01T00:00:00Z')",
                [],
            )
            .unwrap();
            project_id = conn.last_insert_rowid();

            let now = chrono::Utc::now().to_rfc3339();
            conn.execute(
                "INSERT INTO stacks (project_id, created_at) VALUES (?1, ?2)",
                params![project_id, now],
            )
            .unwrap();
            stack_id = conn.last_insert_rowid();

            let mut ids = Vec::new();
            for _ in 0..3 {
                conn.execute(
                    "INSERT INTO logical_photos (project_id, stack_id, current_status) VALUES (?1, ?2, 'undecided')",
                    params![project_id, stack_id],
                )
                .unwrap();
                ids.push(conn.last_insert_rowid());
            }
            lp_ids = ids;

            // Round 1: keep photo 0, eliminate photo 1, keep photo 2
            let (round1_id, _) = find_or_create_round(&conn, project_id, stack_id).unwrap();
            record_decision(&conn, lp_ids[0], round1_id, &DecisionAction::Keep).unwrap();
            record_decision(&conn, lp_ids[1], round1_id, &DecisionAction::Eliminate).unwrap();
            record_decision(&conn, lp_ids[2], round1_id, &DecisionAction::Keep).unwrap();

            // Commit Round 1 -> creates Round 2 with survivors (photos 0 and 2)
            commit_round(&conn, round1_id).unwrap();

            // Find Round 2
            let rounds = list_rounds(&conn, project_id, stack_id).unwrap();
            round2_id = rounds
                .iter()
                .find(|r| r.round_number == 2)
                .expect("Round 2 must exist after commit")
                .round_id;

            // Make a decision in Round 2: eliminate photo 0
            record_decision(&conn, lp_ids[0], round2_id, &DecisionAction::Eliminate).unwrap();

            // Snapshot Round 2 decisions before "crash"
            let mut before = get_round_decisions(&conn, stack_id, round2_id).unwrap();
            before.sort_by_key(|d| d.logical_photo_id);
            decisions_before = before;

            assert_eq!(decisions_before.len(), 2, "Round 2 should have 2 survivors");
        }
        // Connection is now dropped — simulates a crash

        // -- Second connection: reopen the same DB file --
        let conn2 = Connection::open(&db_path).unwrap();

        // Verify Round 2 decisions survived the "crash"
        let mut decisions_after = get_round_decisions(&conn2, stack_id, round2_id).unwrap();
        decisions_after.sort_by_key(|d| d.logical_photo_id);

        assert_eq!(
            decisions_after.len(),
            decisions_before.len(),
            "Round 2 decision count must match after reconnect"
        );

        for (before, after) in decisions_before.iter().zip(decisions_after.iter()) {
            assert_eq!(
                before.logical_photo_id, after.logical_photo_id,
                "logical_photo_id must match after reconnect"
            );
            assert_eq!(
                before.current_status, after.current_status,
                "decision status for photo {} must survive crash",
                before.logical_photo_id
            );
        }

        // Verify specific values: photo 0 = eliminate, photo 2 = undecided
        let photo0_status = decisions_after
            .iter()
            .find(|d| d.logical_photo_id == lp_ids[0])
            .expect("photo 0 must be in round 2");
        assert_eq!(photo0_status.current_status, "eliminate");

        let photo2_status = decisions_after
            .iter()
            .find(|d| d.logical_photo_id == lp_ids[2])
            .expect("photo 2 must be in round 2");
        assert_eq!(photo2_status.current_status, "undecided");
    }
}
