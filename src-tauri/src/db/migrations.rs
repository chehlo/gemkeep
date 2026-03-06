// PRE-LAUNCH ONLY — squashed from v1+v2+v3 migration chain.
// All tables are created in one flat block. No migration chain needed
// because there is no shipped user data to preserve.
// If real users ever exist, restore the incremental migration approach.
pub fn run_migrations(conn: &rusqlite::Connection) -> anyhow::Result<()> {
    // Snapshot the version BEFORE the squashed block (which bumps to 4).
    let pre_version = schema_version(conn).unwrap_or(0);

    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS schema_version (
            version INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS projects (
            id              INTEGER PRIMARY KEY,
            name            TEXT NOT NULL,
            slug            TEXT NOT NULL UNIQUE,
            created_at      TEXT NOT NULL,
            last_opened_at  TEXT
        );

        CREATE TABLE IF NOT EXISTS source_folders (
            id          INTEGER PRIMARY KEY,
            project_id  INTEGER NOT NULL REFERENCES projects(id),
            path        TEXT NOT NULL,
            added_at    TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS stacks (
            id          INTEGER PRIMARY KEY,
            project_id  INTEGER NOT NULL REFERENCES projects(id),
            created_at  TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS logical_photos (
            id                      INTEGER PRIMARY KEY,
            project_id              INTEGER NOT NULL REFERENCES projects(id),
            representative_photo_id INTEGER REFERENCES photos(id),
            stack_id                INTEGER REFERENCES stacks(id),
            current_status          TEXT NOT NULL DEFAULT 'undecided'
        );

        CREATE TABLE IF NOT EXISTS photos (
            id               INTEGER PRIMARY KEY,
            path             TEXT NOT NULL UNIQUE,
            format           TEXT NOT NULL,
            capture_time     TEXT,
            orientation      INTEGER,
            camera_model     TEXT,
            lens             TEXT,
            logical_photo_id INTEGER REFERENCES logical_photos(id),
            aperture         REAL,
            shutter_speed    TEXT,
            iso              INTEGER,
            focal_length     REAL,
            exposure_comp    REAL
        );

        CREATE TABLE IF NOT EXISTS rounds (
            id           INTEGER PRIMARY KEY,
            project_id   INTEGER NOT NULL REFERENCES projects(id),
            scope        TEXT NOT NULL,
            scope_id     INTEGER NOT NULL,
            round_number INTEGER NOT NULL,
            state        TEXT NOT NULL DEFAULT 'open',
            created_at   TEXT NOT NULL,
            committed_at TEXT
        );

        CREATE TABLE IF NOT EXISTS decisions (
            id               INTEGER PRIMARY KEY,
            logical_photo_id INTEGER NOT NULL REFERENCES logical_photos(id),
            round_id         INTEGER NOT NULL REFERENCES rounds(id),
            action           TEXT NOT NULL,
            timestamp        TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS merges (
            id                  INTEGER PRIMARY KEY,
            project_id          INTEGER NOT NULL REFERENCES projects(id),
            merged_stack_id     INTEGER,
            original_stack_ids  TEXT NOT NULL,
            timestamp           TEXT NOT NULL,
            undone              INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS stack_transactions (
            id          INTEGER PRIMARY KEY,
            project_id  INTEGER NOT NULL REFERENCES projects(id),
            action      TEXT NOT NULL,
            details     TEXT NOT NULL,
            created_at  TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS manual_merges (
            id          INTEGER PRIMARY KEY,
            project_id  INTEGER NOT NULL REFERENCES projects(id),
            merge_group TEXT NOT NULL,
            created_at  TEXT NOT NULL,
            active      INTEGER NOT NULL DEFAULT 1
        );

        CREATE INDEX IF NOT EXISTS idx_photos_capture_time ON photos(capture_time);
        CREATE INDEX IF NOT EXISTS idx_logical_stack        ON logical_photos(stack_id);
        CREATE INDEX IF NOT EXISTS idx_logical_project      ON logical_photos(project_id);
        CREATE INDEX IF NOT EXISTS idx_stack_tx_project
            ON stack_transactions(project_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_manual_merges_project
            ON manual_merges(project_id, active);

        -- Set version = 4. On a fresh DB: insert 0 first, then update.
        -- On an existing v4 DB: INSERT is skipped (row exists), UPDATE is no-op.
        INSERT INTO schema_version SELECT 0
            WHERE NOT EXISTS (SELECT 1 FROM schema_version);
        UPDATE schema_version SET version = 4 WHERE version < 4;
        ",
    )?;

    // Incremental migration: v3 → v4
    // Existing v3 databases have photos table WITHOUT camera-param columns.
    // CREATE TABLE IF NOT EXISTS is a no-op for existing tables, so we must
    // ALTER TABLE to add the missing columns.
    if pre_version < 4 {
        // Check if columns already exist (fresh DB has them from CREATE TABLE above).
        let has_aperture: bool = conn.prepare("SELECT aperture FROM photos LIMIT 0").is_ok();
        if !has_aperture {
            conn.execute_batch(
                "
                ALTER TABLE photos ADD COLUMN aperture      REAL;
                ALTER TABLE photos ADD COLUMN shutter_speed  TEXT;
                ALTER TABLE photos ADD COLUMN iso            INTEGER;
                ALTER TABLE photos ADD COLUMN focal_length   REAL;
                ALTER TABLE photos ADD COLUMN exposure_comp  REAL;
                ",
            )?;
        }

        // Add stack_transactions and manual_merges tables if missing (v3 → v4).
        conn.execute_batch(
            "
            CREATE TABLE IF NOT EXISTS stack_transactions (
                id          INTEGER PRIMARY KEY,
                project_id  INTEGER NOT NULL REFERENCES projects(id),
                action      TEXT NOT NULL,
                details     TEXT NOT NULL,
                created_at  TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS manual_merges (
                id          INTEGER PRIMARY KEY,
                project_id  INTEGER NOT NULL REFERENCES projects(id),
                merge_group TEXT NOT NULL,
                created_at  TEXT NOT NULL,
                active      INTEGER NOT NULL DEFAULT 1
            );
            CREATE INDEX IF NOT EXISTS idx_stack_tx_project
                ON stack_transactions(project_id, created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_manual_merges_project
                ON manual_merges(project_id, active);
            UPDATE schema_version SET version = 4 WHERE version < 4;
            ",
        )?;
    }

    Ok(())
}

pub fn schema_version(conn: &rusqlite::Connection) -> anyhow::Result<u32> {
    let version: u32 = conn.query_row("SELECT version FROM schema_version LIMIT 1", [], |row| {
        row.get(0)
    })?;
    Ok(version)
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    fn in_memory() -> Connection {
        Connection::open_in_memory().unwrap()
    }

    #[test]
    fn test_run_migrations_succeeds() {
        let conn = in_memory();
        assert!(run_migrations(&conn).is_ok());
    }

    #[test]
    fn test_schema_version_is_3_after_migration() {
        let conn = in_memory();
        run_migrations(&conn).unwrap();
        assert_eq!(schema_version(&conn).unwrap(), 4);
    }

    #[test]
    fn test_all_tables_exist() {
        let conn = in_memory();
        run_migrations(&conn).unwrap();
        let tables = [
            "schema_version",
            "projects",
            "source_folders",
            "stacks",
            "logical_photos",
            "photos",
            "rounds",
            "decisions",
            "merges",
        ];
        for table in &tables {
            let count: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?1",
                    rusqlite::params![table],
                    |row| row.get(0),
                )
                .unwrap();
            assert_eq!(count, 1, "Table {} should exist", table);
        }
    }

    #[test]
    fn test_run_migrations_is_idempotent() {
        let conn = in_memory();
        run_migrations(&conn).unwrap();
        assert!(run_migrations(&conn).is_ok()); // second call must succeed
        assert_eq!(schema_version(&conn).unwrap(), 4);
    }

    #[test]
    fn test_squashed_migrations_photos_column_set() {
        // Rule 1: verify actual schema columns, not just "no panic".
        // photos must have v3 columns and NOT old v1 columns (pair_id, stack_id, etc.)
        let conn = in_memory();
        run_migrations(&conn).unwrap();

        let mut stmt = conn.prepare("PRAGMA table_info(photos)").unwrap();
        let cols: Vec<String> = stmt
            .query_map([], |r| r.get(1))
            .unwrap()
            .filter_map(|r| r.ok())
            .collect();

        // v3 columns must be present:
        for col in &[
            "id",
            "path",
            "format",
            "capture_time",
            "orientation",
            "camera_model",
            "lens",
            "logical_photo_id",
        ] {
            assert!(
                cols.contains(&col.to_string()),
                "photos must have column {}",
                col
            );
        }

        // Old v1 columns must be absent:
        for col in &["pair_id", "stack_id", "current_status"] {
            assert!(
                !cols.contains(&col.to_string()),
                "photos must NOT have old v1 column {}",
                col
            );
        }
    }

    #[test]
    fn test_schema_version_is_4_after_migration() {
        // Sprint 7: migration bumps schema version from 3 to 4.
        let conn = in_memory();
        run_migrations(&conn).unwrap();
        assert_eq!(
            schema_version(&conn).unwrap(),
            4,
            "schema version must be 4 after Sprint 7 migration"
        );
    }

    #[test]
    fn test_photos_has_camera_param_columns() {
        // Sprint 7 §3.3: photos table gains aperture, shutter_speed, iso,
        // focal_length, exposure_comp columns for camera parameters.
        let conn = in_memory();
        run_migrations(&conn).unwrap();

        let mut stmt = conn.prepare("PRAGMA table_info(photos)").unwrap();
        let cols: Vec<String> = stmt
            .query_map([], |r| r.get(1))
            .unwrap()
            .filter_map(|r| r.ok())
            .collect();

        for col in &[
            "aperture",
            "shutter_speed",
            "iso",
            "focal_length",
            "exposure_comp",
        ] {
            assert!(
                cols.contains(&col.to_string()),
                "photos table must have column '{}' (Sprint 7 camera params), found: {:?}",
                col,
                cols
            );
        }
    }

    #[test]
    fn test_stack_transactions_table_exists() {
        // Sprint 7 §3.1: stack_transactions table records every structural
        // change (merge, split, restack, import) like a git log.
        let conn = in_memory();
        run_migrations(&conn).unwrap();

        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='stack_transactions'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(
            count, 1,
            "stack_transactions table must exist after migration"
        );
    }

    #[test]
    fn test_manual_merges_table_exists() {
        // Sprint 7 §3.2: manual_merges table tracks which logical photos
        // were manually grouped so that restack can preserve them.
        let conn = in_memory();
        run_migrations(&conn).unwrap();

        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='manual_merges'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 1, "manual_merges table must exist after migration");
    }

    #[test]
    fn test_squashed_migrations_decisions_references_logical_photo() {
        // decisions must have logical_photo_id (v3), NOT photo_id (v1).
        let conn = in_memory();
        run_migrations(&conn).unwrap();

        let mut stmt = conn.prepare("PRAGMA table_info(decisions)").unwrap();
        let cols: Vec<String> = stmt
            .query_map([], |r| r.get(1))
            .unwrap()
            .filter_map(|r| r.ok())
            .collect();

        assert!(
            cols.contains(&"logical_photo_id".to_string()),
            "decisions must have logical_photo_id column"
        );
        assert!(
            !cols.contains(&"photo_id".to_string()),
            "decisions must NOT have old photo_id column"
        );
    }

    /// Create a v3 schema (before Sprint 7 camera-param columns).
    fn create_v3_schema(conn: &Connection) {
        conn.execute_batch(
            "
            CREATE TABLE schema_version (version INTEGER NOT NULL);
            INSERT INTO schema_version VALUES (3);

            CREATE TABLE projects (
                id INTEGER PRIMARY KEY, name TEXT NOT NULL,
                slug TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL,
                last_opened_at TEXT
            );
            CREATE TABLE source_folders (
                id INTEGER PRIMARY KEY,
                project_id INTEGER NOT NULL REFERENCES projects(id),
                path TEXT NOT NULL, added_at TEXT NOT NULL
            );
            CREATE TABLE stacks (
                id INTEGER PRIMARY KEY,
                project_id INTEGER NOT NULL REFERENCES projects(id),
                created_at TEXT NOT NULL
            );
            CREATE TABLE logical_photos (
                id INTEGER PRIMARY KEY,
                project_id INTEGER NOT NULL REFERENCES projects(id),
                representative_photo_id INTEGER REFERENCES photos(id),
                stack_id INTEGER REFERENCES stacks(id),
                current_status TEXT NOT NULL DEFAULT 'undecided'
            );
            CREATE TABLE photos (
                id INTEGER PRIMARY KEY, path TEXT NOT NULL UNIQUE,
                format TEXT NOT NULL, capture_time TEXT,
                orientation INTEGER, camera_model TEXT, lens TEXT,
                logical_photo_id INTEGER REFERENCES logical_photos(id)
            );
            CREATE TABLE rounds (
                id INTEGER PRIMARY KEY,
                project_id INTEGER NOT NULL REFERENCES projects(id),
                scope TEXT NOT NULL, scope_id INTEGER NOT NULL,
                round_number INTEGER NOT NULL,
                state TEXT NOT NULL DEFAULT 'open',
                created_at TEXT NOT NULL, committed_at TEXT
            );
            CREATE TABLE decisions (
                id INTEGER PRIMARY KEY,
                logical_photo_id INTEGER NOT NULL REFERENCES logical_photos(id),
                round_id INTEGER NOT NULL REFERENCES rounds(id),
                action TEXT NOT NULL, timestamp TEXT NOT NULL
            );
            CREATE TABLE merges (
                id INTEGER PRIMARY KEY,
                project_id INTEGER NOT NULL REFERENCES projects(id),
                merged_stack_id INTEGER, original_stack_ids TEXT NOT NULL,
                timestamp TEXT NOT NULL, undone INTEGER NOT NULL DEFAULT 0
            );
            ",
        )
        .unwrap();
    }

    #[test]
    fn test_v3_to_v4_migration_adds_camera_param_columns() {
        let conn = in_memory();
        create_v3_schema(&conn);

        // v3 photos table should NOT have aperture
        assert!(
            conn.prepare("SELECT aperture FROM photos LIMIT 0").is_err(),
            "v3 photos must not have aperture column"
        );

        // Run migrations — should upgrade to v4
        run_migrations(&conn).unwrap();
        assert_eq!(schema_version(&conn).unwrap(), 4);

        // Now photos must have all 5 camera-param columns
        let mut stmt = conn.prepare("PRAGMA table_info(photos)").unwrap();
        let cols: Vec<String> = stmt
            .query_map([], |r| r.get(1))
            .unwrap()
            .filter_map(|r| r.ok())
            .collect();

        for col in &[
            "aperture",
            "shutter_speed",
            "iso",
            "focal_length",
            "exposure_comp",
        ] {
            assert!(
                cols.contains(&col.to_string()),
                "v3→v4 migration must add '{}' column, found: {:?}",
                col,
                cols
            );
        }
    }

    #[test]
    fn test_v3_to_v4_migration_adds_new_tables() {
        let conn = in_memory();
        create_v3_schema(&conn);

        run_migrations(&conn).unwrap();

        for table in &["stack_transactions", "manual_merges"] {
            let count: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?1",
                    rusqlite::params![table],
                    |row| row.get(0),
                )
                .unwrap();
            assert_eq!(count, 1, "v3→v4 must create {} table", table);
        }
    }

    #[test]
    fn test_v3_to_v4_insert_photo_with_camera_params() {
        // After v3→v4 migration, insert_photo with camera params must succeed.
        let conn = in_memory();
        create_v3_schema(&conn);
        run_migrations(&conn).unwrap();

        conn.execute(
            "INSERT INTO photos (path, format, capture_time, orientation, camera_model, lens, \
             aperture, shutter_speed, iso, focal_length, exposure_comp) \
             VALUES ('/test.jpg', 'jpeg', '2026-01-01T00:00:00', 1, 'Canon', 'EF 85mm', \
             2.8, '1/250', 400, 85.0, 0.7)",
            [],
        )
        .expect("insert_photo with camera params must work after v3→v4 migration");

        let aperture: f64 = conn
            .query_row(
                "SELECT aperture FROM photos WHERE path = '/test.jpg'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert!((aperture - 2.8).abs() < 0.01);
    }
}
