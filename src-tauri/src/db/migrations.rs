// PRE-LAUNCH ONLY — squashed from v1+v2+v3 migration chain.
// All tables are created in one flat block. No migration chain needed
// because there is no shipped user data to preserve.
// If real users ever exist, restore the incremental migration approach.
pub fn run_migrations(conn: &rusqlite::Connection) -> anyhow::Result<()> {
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
            logical_photo_id INTEGER REFERENCES logical_photos(id)
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

        CREATE INDEX IF NOT EXISTS idx_photos_capture_time ON photos(capture_time);
        CREATE INDEX IF NOT EXISTS idx_logical_stack        ON logical_photos(stack_id);
        CREATE INDEX IF NOT EXISTS idx_logical_project      ON logical_photos(project_id);

        -- Set version = 3. On a fresh DB: insert 0 first, then update.
        -- On an existing v3 DB: INSERT is skipped (row exists), UPDATE is no-op.
        INSERT INTO schema_version SELECT 0
            WHERE NOT EXISTS (SELECT 1 FROM schema_version);
        UPDATE schema_version SET version = 3 WHERE version < 3;
        ",
    )?;

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
        assert_eq!(schema_version(&conn).unwrap(), 3);
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
        assert_eq!(schema_version(&conn).unwrap(), 3);
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
}
