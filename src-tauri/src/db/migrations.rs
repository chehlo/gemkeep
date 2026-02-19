pub fn run_migrations(conn: &rusqlite::Connection) -> anyhow::Result<()> {
    let version = schema_version(conn).unwrap_or(0);
    if version >= 1 {
        return Ok(());
    }

    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL);
        INSERT INTO schema_version SELECT 0 WHERE NOT EXISTS (SELECT 1 FROM schema_version);
        -- Sprint 2: project management
        CREATE TABLE IF NOT EXISTS projects (
            id INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            slug TEXT NOT NULL UNIQUE,
            created_at TEXT NOT NULL,
            last_opened_at TEXT
        );
        -- Sprint 3: photo import
        CREATE TABLE IF NOT EXISTS photos (
            id INTEGER PRIMARY KEY,
            project_id INTEGER NOT NULL,
            path TEXT NOT NULL,
            format TEXT NOT NULL,
            pair_id INTEGER,
            stack_id INTEGER,
            current_status TEXT NOT NULL DEFAULT 'active',
            capture_time TEXT,
            camera_model TEXT,
            lens TEXT,
            orientation INTEGER,
            FOREIGN KEY(project_id) REFERENCES projects(id)
        );
        CREATE TABLE IF NOT EXISTS stacks (
            id INTEGER PRIMARY KEY,
            project_id INTEGER NOT NULL,
            created_at TEXT NOT NULL,
            FOREIGN KEY(project_id) REFERENCES projects(id)
        );
        -- Sprint 6: round engine
        CREATE TABLE IF NOT EXISTS rounds (
            id INTEGER PRIMARY KEY,
            project_id INTEGER NOT NULL,
            scope TEXT NOT NULL,
            scope_id INTEGER NOT NULL,
            round_number INTEGER NOT NULL,
            state TEXT NOT NULL DEFAULT 'open',
            created_at TEXT NOT NULL,
            committed_at TEXT
        );
        CREATE TABLE IF NOT EXISTS decisions (
            id INTEGER PRIMARY KEY,
            photo_id INTEGER NOT NULL,
            round_id INTEGER NOT NULL,
            action TEXT NOT NULL,
            timestamp TEXT NOT NULL,
            FOREIGN KEY(photo_id) REFERENCES photos(id),
            FOREIGN KEY(round_id) REFERENCES rounds(id)
        );
        -- Sprint 8: stack management
        CREATE TABLE IF NOT EXISTS merges (
            id INTEGER PRIMARY KEY,
            project_id INTEGER NOT NULL,
            merged_stack_id INTEGER,
            original_stack_ids TEXT NOT NULL,
            timestamp TEXT NOT NULL,
            undone INTEGER NOT NULL DEFAULT 0
        );
        -- Set version
        UPDATE schema_version SET version = 1;
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
    fn test_schema_version_is_1_after_migration() {
        let conn = in_memory();
        run_migrations(&conn).unwrap();
        assert_eq!(schema_version(&conn).unwrap(), 1);
    }

    #[test]
    fn test_all_tables_exist() {
        let conn = in_memory();
        run_migrations(&conn).unwrap();
        let tables = [
            "schema_version",
            "projects",
            "photos",
            "stacks",
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
        assert_eq!(schema_version(&conn).unwrap(), 1);
    }
}
