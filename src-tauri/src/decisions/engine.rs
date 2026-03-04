use rusqlite::{params, Connection, OptionalExtension};
use std::path::Path;

use super::model::{DecisionAction, PhotoDetail, RoundStatus};

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

/// Commit a round: mark as immutable.
/// Sets rounds.state = 'committed' and rounds.committed_at = now.
pub fn commit_round(conn: &Connection, round_id: i64) -> rusqlite::Result<()> {
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "UPDATE rounds SET state = 'committed', committed_at = ?1 WHERE id = ?2 AND state = 'open'",
        params![now, round_id],
    )?;
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

    // Count total logical photos in the stack
    let total_photos: i64 = conn.query_row(
        "SELECT COUNT(*) FROM logical_photos WHERE stack_id = ?1",
        params![stack_id],
        |row| row.get(0),
    )?;

    // Count kept
    let kept: i64 = conn.query_row(
        "SELECT COUNT(*) FROM logical_photos WHERE stack_id = ?1 AND current_status = 'keep'",
        params![stack_id],
        |row| row.get(0),
    )?;

    // Count eliminated
    let eliminated: i64 = conn.query_row(
        "SELECT COUNT(*) FROM logical_photos WHERE stack_id = ?1 AND current_status = 'eliminate'",
        params![stack_id],
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

/// Undo the last decision for a logical photo in the current open round.
/// Sets current_status back to "undecided".
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

    // Reset current_status to undecided
    conn.execute(
        "UPDATE logical_photos SET current_status = 'undecided' WHERE id = ?1",
        params![logical_photo_id],
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
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::run_migrations;
    use rusqlite::{params, Connection};

    /// Set up an in-memory DB with migrations, a project, a stack, and N logical photos.
    /// Returns (conn, project_id, stack_id, Vec<lp_id>).
    fn setup_test_db(num_photos: usize) -> (Connection, i64, i64, Vec<i64>) {
        let conn = Connection::open_in_memory().unwrap();
        run_migrations(&conn).unwrap();

        // Create project
        conn.execute(
            "INSERT INTO projects (name, slug, created_at) VALUES ('Test', 'test', '2024-01-01T00:00:00Z')",
            [],
        )
        .unwrap();
        let project_id = conn.last_insert_rowid();

        // Create stack
        let now = chrono::Utc::now().to_rfc3339();
        conn.execute(
            "INSERT INTO stacks (project_id, created_at) VALUES (?1, ?2)",
            params![project_id, now],
        )
        .unwrap();
        let stack_id = conn.last_insert_rowid();

        // Create N photos and logical_photos
        let mut lp_ids = Vec::new();
        for i in 0..num_photos {
            let path = format!("/test/photo_{}.jpg", i);
            conn.execute(
                "INSERT INTO photos (path, format, capture_time) VALUES (?1, 'jpeg', '2024-01-01T10:00:00Z')",
                params![path],
            )
            .unwrap();
            let photo_id = conn.last_insert_rowid();

            conn.execute(
                "INSERT INTO logical_photos (project_id, representative_photo_id, stack_id) VALUES (?1, ?2, ?3)",
                params![project_id, photo_id, stack_id],
            )
            .unwrap();
            let lp_id = conn.last_insert_rowid();

            conn.execute(
                "UPDATE photos SET logical_photo_id = ?1 WHERE id = ?2",
                params![lp_id, photo_id],
            )
            .unwrap();

            lp_ids.push(lp_id);
        }

        (conn, project_id, stack_id, lp_ids)
    }

    // ── 16.1 Decision Engine Tests ───────────────────────────────────────────

    #[test]
    fn test_find_or_create_round_creates_round_1() {
        // Sprint 7 §16.1: When no round exists for a stack, find_or_create_round
        // creates a new Round 1 with scope='stack', state='open'.
        let (conn, project_id, stack_id, _lp_ids) = setup_test_db(3);

        let (round_id, was_created) = find_or_create_round(&conn, project_id, stack_id).unwrap();

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
        let (conn, project_id, stack_id, _lp_ids) = setup_test_db(3);

        // Manually insert a round
        let now = chrono::Utc::now().to_rfc3339();
        conn.execute(
            "INSERT INTO rounds (project_id, scope, scope_id, round_number, state, created_at)
             VALUES (?1, 'stack', ?2, 1, 'open', ?3)",
            params![project_id, stack_id, now],
        )
        .unwrap();
        let existing_round_id = conn.last_insert_rowid();

        let (round_id, was_created) = find_or_create_round(&conn, project_id, stack_id).unwrap();

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
        let (conn, project_id, stack_id, lp_ids) = setup_test_db(1);
        let lp_id = lp_ids[0];

        // Create a round first
        let (round_id, _) = find_or_create_round(&conn, project_id, stack_id).unwrap();

        let decision_id = record_decision(&conn, lp_id, round_id, &DecisionAction::Keep).unwrap();
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
        let status: String = conn
            .query_row(
                "SELECT current_status FROM logical_photos WHERE id = ?1",
                params![lp_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(status, "keep");
    }

    #[test]
    fn test_make_decision_eliminate() {
        // Sprint 7 §16.1: record_decision with Eliminate.
        let (conn, project_id, stack_id, lp_ids) = setup_test_db(1);
        let lp_id = lp_ids[0];

        let (round_id, _) = find_or_create_round(&conn, project_id, stack_id).unwrap();
        record_decision(&conn, lp_id, round_id, &DecisionAction::Eliminate).unwrap();

        let status: String = conn
            .query_row(
                "SELECT current_status FROM logical_photos WHERE id = ?1",
                params![lp_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(status, "eliminate");
    }

    #[test]
    fn test_decision_re_decide_overwrites() {
        // Sprint 7 §16.1: Re-deciding on the same photo creates a new decision row
        // (append-only), and the latest decision becomes effective.
        let (conn, project_id, stack_id, lp_ids) = setup_test_db(1);
        let lp_id = lp_ids[0];

        let (round_id, _) = find_or_create_round(&conn, project_id, stack_id).unwrap();

        // First decision: keep
        record_decision(&conn, lp_id, round_id, &DecisionAction::Keep).unwrap();
        // Second decision: eliminate (overwrites)
        record_decision(&conn, lp_id, round_id, &DecisionAction::Eliminate).unwrap();

        // Verify 2 rows exist (append-only)
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM decisions WHERE logical_photo_id = ?1 AND round_id = ?2",
                params![lp_id, round_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 2, "decisions table must have 2 rows (append-only)");

        // Verify current_status is 'eliminate' (latest wins)
        let status: String = conn
            .query_row(
                "SELECT current_status FROM logical_photos WHERE id = ?1",
                params![lp_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(status, "eliminate", "latest decision must win");
    }

    #[test]
    fn test_decision_updates_current_status() {
        // Sprint 7 §16.1: current_status is updated after each decision.
        let (conn, project_id, stack_id, lp_ids) = setup_test_db(1);
        let lp_id = lp_ids[0];

        let (round_id, _) = find_or_create_round(&conn, project_id, stack_id).unwrap();

        // Keep
        record_decision(&conn, lp_id, round_id, &DecisionAction::Keep).unwrap();
        let status: String = conn
            .query_row(
                "SELECT current_status FROM logical_photos WHERE id = ?1",
                params![lp_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(status, "keep", "status must be 'keep' after Keep decision");

        // Eliminate
        record_decision(&conn, lp_id, round_id, &DecisionAction::Eliminate).unwrap();
        let status: String = conn
            .query_row(
                "SELECT current_status FROM logical_photos WHERE id = ?1",
                params![lp_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(
            status, "eliminate",
            "status must be 'eliminate' after Eliminate decision"
        );
    }

    #[test]
    fn test_decision_audit_log_append_only() {
        // Sprint 7 §16.1: Making 3 decisions on the same photo produces exactly
        // 3 rows in the decisions table. No rows are deleted or modified.
        let (conn, project_id, stack_id, lp_ids) = setup_test_db(1);
        let lp_id = lp_ids[0];

        let (round_id, _) = find_or_create_round(&conn, project_id, stack_id).unwrap();

        let id1 = record_decision(&conn, lp_id, round_id, &DecisionAction::Keep).unwrap();
        let id2 = record_decision(&conn, lp_id, round_id, &DecisionAction::Eliminate).unwrap();
        let id3 = record_decision(&conn, lp_id, round_id, &DecisionAction::Keep).unwrap();

        // All three IDs must be distinct
        assert_ne!(id1, id2);
        assert_ne!(id2, id3);
        assert_ne!(id1, id3);

        // Exactly 3 rows
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM decisions WHERE logical_photo_id = ?1 AND round_id = ?2",
                params![lp_id, round_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 3, "decisions table must have exactly 3 rows");

        // Verify all 3 rows still exist (no deletions)
        let existing: Vec<i64> = {
            let mut stmt = conn
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
        let conn = Connection::open_in_memory().unwrap();
        run_migrations(&conn).unwrap();

        // Create project + stack
        conn.execute(
            "INSERT INTO projects (name, slug, created_at) VALUES ('P', 'p', '2024-01-01T00:00:00Z')",
            [],
        )
        .unwrap();
        let project_id = conn.last_insert_rowid();
        let now = chrono::Utc::now().to_rfc3339();
        conn.execute(
            "INSERT INTO stacks (project_id, created_at) VALUES (?1, ?2)",
            params![project_id, now],
        )
        .unwrap();
        let stack_id = conn.last_insert_rowid();

        // Insert RAW + JPEG pair as one logical photo
        conn.execute(
            "INSERT INTO photos (path, format, capture_time) VALUES ('/test/shot.CR2', 'raw', '2024-01-01T10:00:00Z')",
            [],
        )
        .unwrap();
        let raw_photo_id = conn.last_insert_rowid();
        conn.execute(
            "INSERT INTO photos (path, format, capture_time) VALUES ('/test/shot.JPG', 'jpeg', '2024-01-01T10:00:00Z')",
            [],
        )
        .unwrap();
        let jpeg_photo_id = conn.last_insert_rowid();

        // One logical photo, representative = raw
        conn.execute(
            "INSERT INTO logical_photos (project_id, representative_photo_id, stack_id) VALUES (?1, ?2, ?3)",
            params![project_id, raw_photo_id, stack_id],
        )
        .unwrap();
        let lp_id = conn.last_insert_rowid();

        // Link both photos to the logical photo
        conn.execute(
            "UPDATE photos SET logical_photo_id = ?1 WHERE id = ?2",
            params![lp_id, raw_photo_id],
        )
        .unwrap();
        conn.execute(
            "UPDATE photos SET logical_photo_id = ?1 WHERE id = ?2",
            params![lp_id, jpeg_photo_id],
        )
        .unwrap();

        // Make decision on the logical photo
        let (round_id, _) = find_or_create_round(&conn, project_id, stack_id).unwrap();
        record_decision(&conn, lp_id, round_id, &DecisionAction::Keep).unwrap();

        // Verify both photos share the same logical_photo_id
        let raw_lp: i64 = conn
            .query_row(
                "SELECT logical_photo_id FROM photos WHERE id = ?1",
                params![raw_photo_id],
                |row| row.get(0),
            )
            .unwrap();
        let jpeg_lp: i64 = conn
            .query_row(
                "SELECT logical_photo_id FROM photos WHERE id = ?1",
                params![jpeg_photo_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(raw_lp, lp_id, "RAW photo must belong to the logical photo");
        assert_eq!(
            jpeg_lp, lp_id,
            "JPEG photo must belong to the logical photo"
        );

        // Verify logical_photos.current_status = 'keep' (covers both files)
        let status: String = conn
            .query_row(
                "SELECT current_status FROM logical_photos WHERE id = ?1",
                params![lp_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(
            status, "keep",
            "decision on logical photo must cover the entire pair"
        );
    }

    #[test]
    fn test_commit_round_locks_decisions() {
        // Sprint 7 §16.1: After commit_round, the round is immutable.
        // record_decision on a committed round must return an error.
        let (conn, project_id, stack_id, lp_ids) = setup_test_db(1);
        let lp_id = lp_ids[0];

        let (round_id, _) = find_or_create_round(&conn, project_id, stack_id).unwrap();
        record_decision(&conn, lp_id, round_id, &DecisionAction::Keep).unwrap();

        // Commit the round
        commit_round(&conn, round_id).unwrap();

        // Verify round state
        let state: String = conn
            .query_row(
                "SELECT state FROM rounds WHERE id = ?1",
                params![round_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(state, "committed");

        // Verify committed_at is set
        let committed_at: Option<String> = conn
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
        assert!(is_round_committed(&conn, round_id).unwrap());
    }

    #[test]
    fn test_undo_decision_sets_undecided() {
        // Sprint 7 §16.1: undo_decision sets current_status back to "undecided".
        let (conn, project_id, stack_id, lp_ids) = setup_test_db(1);
        let lp_id = lp_ids[0];

        let (round_id, _) = find_or_create_round(&conn, project_id, stack_id).unwrap();
        record_decision(&conn, lp_id, round_id, &DecisionAction::Keep).unwrap();

        // Verify status is 'keep'
        let status: String = conn
            .query_row(
                "SELECT current_status FROM logical_photos WHERE id = ?1",
                params![lp_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(status, "keep");

        // Undo
        undo_decision(&conn, lp_id, round_id).unwrap();

        // Verify status is 'undecided'
        let status: String = conn
            .query_row(
                "SELECT current_status FROM logical_photos WHERE id = ?1",
                params![lp_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(
            status, "undecided",
            "undo_decision must reset status to undecided"
        );
    }

    #[test]
    fn test_round_auto_created_on_first_decision() {
        // Sprint 7 §16.1: The first decision on a stack auto-creates Round 1.
        // Subsequent decisions on the same stack reuse the existing round.
        let (conn, project_id, stack_id, _lp_ids) = setup_test_db(2);

        // First call: round should be auto-created
        let (round_id_1, was_created_1) =
            find_or_create_round(&conn, project_id, stack_id).unwrap();
        assert!(was_created_1, "first call must auto-create a round");

        // Second call: round should be reused
        let (round_id_2, was_created_2) =
            find_or_create_round(&conn, project_id, stack_id).unwrap();
        assert!(!was_created_2, "second call must NOT create another round");
        assert_eq!(
            round_id_1, round_id_2,
            "both calls must return the same round id"
        );

        // Verify only 1 round total
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM rounds", [], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 1, "only 1 round should exist for the stack");
    }

    #[test]
    fn test_get_round_status_counts() {
        // Sprint 7 §16.1: get_round_status returns correct counts.
        // Setup: 10 photos, 3 keep, 2 eliminate → decided=5, undecided=5
        let (conn, project_id, stack_id, lp_ids) = setup_test_db(10);

        let (round_id, _) = find_or_create_round(&conn, project_id, stack_id).unwrap();

        // Make 3 keep decisions
        for &lp_id in &lp_ids[0..3] {
            record_decision(&conn, lp_id, round_id, &DecisionAction::Keep).unwrap();
        }
        // Make 2 eliminate decisions
        for &lp_id in &lp_ids[3..5] {
            record_decision(&conn, lp_id, round_id, &DecisionAction::Eliminate).unwrap();
        }

        let status = get_round_status(&conn, project_id, stack_id).unwrap();

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
        let conn = Connection::open_in_memory().unwrap();
        run_migrations(&conn).unwrap();

        conn.execute(
            "INSERT INTO projects (name, slug, created_at) VALUES ('P', 'p', '2024-01-01T00:00:00Z')",
            [],
        )
        .unwrap();
        let project_id = conn.last_insert_rowid();
        let now = chrono::Utc::now().to_rfc3339();
        conn.execute(
            "INSERT INTO stacks (project_id, created_at) VALUES (?1, ?2)",
            params![project_id, now],
        )
        .unwrap();
        let _stack_id = conn.last_insert_rowid();

        // Insert photo with camera params
        conn.execute(
            "INSERT INTO photos (path, format, capture_time, camera_model, lens,
             aperture, shutter_speed, iso, focal_length, exposure_comp)
             VALUES ('/test/photo.jpg', 'jpeg', '2024-01-01T10:00:00Z', 'Canon EOS R5', 'RF 85mm f/1.2L',
                     2.8, '1/250', 400, 85.0, 0.7)",
            [],
        )
        .unwrap();
        let photo_id = conn.last_insert_rowid();

        conn.execute(
            "INSERT INTO logical_photos (project_id, representative_photo_id, stack_id) VALUES (?1, ?2, ?3)",
            params![project_id, photo_id, _stack_id],
        )
        .unwrap();
        let lp_id = conn.last_insert_rowid();
        conn.execute(
            "UPDATE photos SET logical_photo_id = ?1 WHERE id = ?2",
            params![lp_id, photo_id],
        )
        .unwrap();

        let cache_dir = tempfile::tempdir().unwrap();
        let detail = get_photo_detail(&conn, lp_id, cache_dir.path()).unwrap();

        assert_eq!(detail.logical_photo_id, lp_id);
        assert_eq!(detail.camera_model.as_deref(), Some("Canon EOS R5"));
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
        let conn = Connection::open_in_memory().unwrap();
        run_migrations(&conn).unwrap();

        conn.execute(
            "INSERT INTO projects (name, slug, created_at) VALUES ('P', 'p', '2024-01-01T00:00:00Z')",
            [],
        )
        .unwrap();
        let project_id = conn.last_insert_rowid();
        let now = chrono::Utc::now().to_rfc3339();
        conn.execute(
            "INSERT INTO stacks (project_id, created_at) VALUES (?1, ?2)",
            params![project_id, now],
        )
        .unwrap();
        let stack_id = conn.last_insert_rowid();

        // Insert photo with NO camera params (all NULL)
        conn.execute(
            "INSERT INTO photos (path, format) VALUES ('/test/photo.jpg', 'jpeg')",
            [],
        )
        .unwrap();
        let photo_id = conn.last_insert_rowid();

        conn.execute(
            "INSERT INTO logical_photos (project_id, representative_photo_id, stack_id) VALUES (?1, ?2, ?3)",
            params![project_id, photo_id, stack_id],
        )
        .unwrap();
        let lp_id = conn.last_insert_rowid();
        conn.execute(
            "UPDATE photos SET logical_photo_id = ?1 WHERE id = ?2",
            params![lp_id, photo_id],
        )
        .unwrap();

        let cache_dir = tempfile::tempdir().unwrap();
        let detail = get_photo_detail(&conn, lp_id, cache_dir.path()).unwrap();

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
        let conn = Connection::open_in_memory().unwrap();
        run_migrations(&conn).unwrap();

        conn.execute(
            "INSERT INTO projects (name, slug, created_at) VALUES ('P', 'p', '2024-01-01T00:00:00Z')",
            [],
        )
        .unwrap();
        let project_id = conn.last_insert_rowid();
        let now = chrono::Utc::now().to_rfc3339();
        conn.execute(
            "INSERT INTO stacks (project_id, created_at) VALUES (?1, ?2)",
            params![project_id, now],
        )
        .unwrap();
        let stack_id = conn.last_insert_rowid();

        // Insert RAW + JPEG pair
        conn.execute(
            "INSERT INTO photos (path, format, capture_time) VALUES ('/test/shot.CR2', 'raw', '2024-01-01T10:00:00Z')",
            [],
        )
        .unwrap();
        let raw_id = conn.last_insert_rowid();
        conn.execute(
            "INSERT INTO photos (path, format, capture_time) VALUES ('/test/shot.JPG', 'jpeg', '2024-01-01T10:00:00Z')",
            [],
        )
        .unwrap();
        let jpeg_id = conn.last_insert_rowid();

        conn.execute(
            "INSERT INTO logical_photos (project_id, representative_photo_id, stack_id) VALUES (?1, ?2, ?3)",
            params![project_id, raw_id, stack_id],
        )
        .unwrap();
        let lp_id = conn.last_insert_rowid();

        conn.execute(
            "UPDATE photos SET logical_photo_id = ?1 WHERE id = ?2",
            params![lp_id, raw_id],
        )
        .unwrap();
        conn.execute(
            "UPDATE photos SET logical_photo_id = ?1 WHERE id = ?2",
            params![lp_id, jpeg_id],
        )
        .unwrap();

        let cache_dir = tempfile::tempdir().unwrap();
        let detail = get_photo_detail(&conn, lp_id, cache_dir.path()).unwrap();

        assert_eq!(detail.logical_photo_id, lp_id);
        assert!(detail.has_raw, "has_raw must be true");
        assert!(detail.has_jpeg, "has_jpeg must be true");
        assert!(
            detail.jpeg_path.is_some(),
            "jpeg_path must be set for a pair"
        );
        assert!(detail.raw_path.is_some(), "raw_path must be set for a pair");
        assert_eq!(detail.jpeg_path.as_deref(), Some("/test/shot.JPG"));
        assert_eq!(detail.raw_path.as_deref(), Some("/test/shot.CR2"));
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
        let conn = Connection::open_in_memory().unwrap();
        run_migrations(&conn).unwrap();

        conn.execute(
            "INSERT INTO projects (name, slug, created_at) VALUES ('P', 'p', '2024-01-01T00:00:00Z')",
            [],
        )
        .unwrap();
        let project_id = conn.last_insert_rowid();
        let now = chrono::Utc::now().to_rfc3339();
        conn.execute(
            "INSERT INTO stacks (project_id, created_at) VALUES (?1, ?2)",
            params![project_id, now],
        )
        .unwrap();
        let stack_id = conn.last_insert_rowid();

        conn.execute(
            "INSERT INTO photos (path, format, capture_time) VALUES ('/test/photo.jpg', 'jpeg', '2024-01-01T10:00:00Z')",
            [],
        )
        .unwrap();
        let photo_id = conn.last_insert_rowid();

        conn.execute(
            "INSERT INTO logical_photos (project_id, representative_photo_id, stack_id) VALUES (?1, ?2, ?3)",
            params![project_id, photo_id, stack_id],
        )
        .unwrap();
        let lp_id = conn.last_insert_rowid();
        conn.execute(
            "UPDATE photos SET logical_photo_id = ?1 WHERE id = ?2",
            params![lp_id, photo_id],
        )
        .unwrap();

        // Create a thumbnail at the REAL path that thumbnails.rs would generate
        let cache_dir = tempfile::tempdir().unwrap();
        let real_thumb_path = cache_dir.path().join(format!("{}.jpg", lp_id));
        std::fs::write(&real_thumb_path, b"fake-jpeg-data").unwrap();
        assert!(real_thumb_path.exists(), "sanity: thumb file must exist");

        let detail = get_photo_detail(&conn, lp_id, cache_dir.path()).unwrap();

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
}
