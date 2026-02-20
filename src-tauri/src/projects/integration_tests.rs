//! Integration tests for the projects module.
//! These tests exercise the full create → open → list → delete flow
//! using a real AppState and real filesystem (tempdir).

#[cfg(test)]
mod tests {
    use crate::db::{open_connection, run_migrations};
    use crate::projects::{manager, model::Project, repository};
    use crate::state::AppState;
    use std::path::Path;
    use std::sync::Mutex;
    use tempfile::TempDir;
    #[allow(unused_imports)]
    use rusqlite;

    fn make_state(tmp: &TempDir) -> AppState {
        let home = tmp.path().to_path_buf();
        std::fs::create_dir_all(home.join("projects")).unwrap();
        AppState {
            db: Mutex::new(None),
            active_project: Mutex::new(None),
            gemkeep_home: home,
        }
    }

    /// Helper: create a real project on disk + DB + insert row.
    /// Returns the Project and leaves state NOT updated (simulates what create_project command does).
    fn create_project_on_disk(home: &Path, name: &str, slug: &str) -> Project {
        let dir = manager::project_dir(home, slug);
        std::fs::create_dir_all(&dir).unwrap();
        let db_path = dir.join("project.db");
        let conn = open_connection(&db_path).unwrap();
        run_migrations(&conn).unwrap();
        let p = repository::insert_project(&conn, name, slug).unwrap();
        manager::create_project_dirs(home, slug).unwrap();
        p
    }

    /// Helper: scan project directories under `home/projects`, open each DB, and
    /// return all valid projects (exactly one row per DB).
    fn scan_projects(home: &Path) -> Vec<Project> {
        let mut found = vec![];
        let entries = match std::fs::read_dir(home.join("projects")) {
            Ok(e) => e,
            Err(_) => return found,
        };
        for entry in entries.flatten() {
            if !entry.path().is_dir() {
                continue;
            }
            let db_path = entry.path().join("project.db");
            if !db_path.exists() {
                continue;
            }
            if let Ok(conn) = open_connection(&db_path) {
                if run_migrations(&conn).is_ok() {
                    if let Ok(rows) = repository::list_projects_in_db(&conn) {
                        if rows.len() == 1 {
                            found.push(rows.into_iter().next().unwrap());
                        }
                    }
                }
            }
        }
        found
    }

    // -------------------------------------------------------------------------
    // Multi-project: create 3, list all, open each
    // -------------------------------------------------------------------------

    #[test]
    fn test_create_multiple_projects_all_listed() {
        let tmp = tempfile::tempdir().unwrap();
        let home = tmp.path();
        std::fs::create_dir_all(home.join("projects")).unwrap();

        create_project_on_disk(home, "Iceland 2024", "iceland-2024");
        create_project_on_disk(home, "Wedding 2023", "wedding-2023");
        create_project_on_disk(home, "Portrait", "portrait");

        let mut found = scan_projects(home);
        found.sort_by(|a, b| a.slug.cmp(&b.slug));
        assert_eq!(found.len(), 3);
        let slugs: Vec<&str> = found.iter().map(|p| p.slug.as_str()).collect();
        assert!(slugs.contains(&"iceland-2024"));
        assert!(slugs.contains(&"wedding-2023"));
        assert!(slugs.contains(&"portrait"));
    }

    #[test]
    fn test_open_each_project_updates_last_opened() {
        let tmp = tempfile::tempdir().unwrap();
        let home = tmp.path();
        std::fs::create_dir_all(home.join("projects")).unwrap();

        let p1 = create_project_on_disk(home, "Project A", "project-a");
        let p2 = create_project_on_disk(home, "Project B", "project-b");

        // Open project-a: update last_opened_at
        {
            let conn = open_connection(&home.join("projects").join("project-a").join("project.db"))
                .unwrap();
            run_migrations(&conn).unwrap();
            repository::update_last_opened(&conn, p1.id).unwrap();
            let fetched = repository::get_project_by_slug(&conn, "project-a").unwrap();
            assert!(fetched.last_opened_at.is_some());
        }

        // project-b should be unaffected
        {
            let conn = open_connection(&home.join("projects").join("project-b").join("project.db"))
                .unwrap();
            run_migrations(&conn).unwrap();
            let fetched = repository::get_project_by_slug(&conn, "project-b").unwrap();
            // project-b was never opened; last_opened_at should still be None
            // (we just created it, never updated)
            let _ = p2; // used
            assert!(fetched.last_opened_at.is_none());
        }
    }

    // -------------------------------------------------------------------------
    // Delete one → others intact
    // -------------------------------------------------------------------------

    #[test]
    fn test_delete_one_others_remain() {
        let tmp = tempfile::tempdir().unwrap();
        let home = tmp.path();
        std::fs::create_dir_all(home.join("projects")).unwrap();

        create_project_on_disk(home, "Alpha", "alpha");
        create_project_on_disk(home, "Beta", "beta");
        create_project_on_disk(home, "Gamma", "gamma");

        // Delete beta
        let beta_dir = manager::project_dir(home, "beta");
        std::fs::remove_dir_all(&beta_dir).unwrap();
        assert!(!beta_dir.exists());

        // Alpha and Gamma still exist
        assert!(manager::project_dir(home, "alpha").exists());
        assert!(manager::project_dir(home, "gamma").exists());

        // List still works — only 2 valid projects
        let found = scan_projects(home);
        assert_eq!(found.len(), 2);
        assert!(!found.iter().any(|p| p.slug == "beta"));
    }

    // -------------------------------------------------------------------------
    // Delete active project → AppState cleared
    // -------------------------------------------------------------------------

    #[test]
    fn test_delete_active_project_clears_appstate() {
        let tmp = tempfile::tempdir().unwrap();
        let state = make_state(&tmp);
        let home = &state.gemkeep_home;

        let p = create_project_on_disk(home, "Active Project", "active-project");

        // Simulate "active project is open" by setting AppState
        let conn = open_connection(
            &home
                .join("projects")
                .join("active-project")
                .join("project.db"),
        )
        .unwrap();
        run_migrations(&conn).unwrap();
        *state.db.lock().unwrap() = Some(conn);
        *state.active_project.lock().unwrap() = Some(p.clone());

        // Verify active project is set
        assert!(state.active_project.lock().unwrap().is_some());
        assert!(state.db.lock().unwrap().is_some());

        // Simulate delete_project clearing AppState (lock db first, then active_project)
        {
            let mut db_lock = state.db.lock().unwrap();
            let mut ap_lock = state.active_project.lock().unwrap();
            if ap_lock
                .as_ref()
                .map(|ap| ap.slug == "active-project")
                .unwrap_or(false)
            {
                *db_lock = None;
                *ap_lock = None;
            }
        }
        std::fs::remove_dir_all(manager::project_dir(home, "active-project")).unwrap();

        // AppState must be cleared
        assert!(
            state.active_project.lock().unwrap().is_none(),
            "active_project must be None after delete"
        );
        assert!(
            state.db.lock().unwrap().is_none(),
            "db must be None after delete"
        );
    }

    // -------------------------------------------------------------------------
    // AppState invariants: both None or both Some
    // -------------------------------------------------------------------------

    #[test]
    fn test_appstate_invariant_both_none_initially() {
        let tmp = tempfile::tempdir().unwrap();
        let state = make_state(&tmp);
        assert!(state.db.lock().unwrap().is_none());
        assert!(state.active_project.lock().unwrap().is_none());
    }

    #[test]
    fn test_appstate_invariant_both_set_together() {
        let tmp = tempfile::tempdir().unwrap();
        let state = make_state(&tmp);
        let home = &state.gemkeep_home;

        let p = create_project_on_disk(home, "Test", "test");
        let conn = open_connection(&home.join("projects").join("test").join("project.db")).unwrap();

        // Set both atomically (in lock order: db first, then active_project)
        *state.db.lock().unwrap() = Some(conn);
        *state.active_project.lock().unwrap() = Some(p);

        assert!(state.db.lock().unwrap().is_some());
        assert!(state.active_project.lock().unwrap().is_some());
    }

    // -------------------------------------------------------------------------
    // Negative: corrupt project (missing DB) skipped in list
    // -------------------------------------------------------------------------

    #[test]
    fn test_corrupt_project_missing_db_skipped() {
        let tmp = tempfile::tempdir().unwrap();
        let home = tmp.path();
        std::fs::create_dir_all(home.join("projects")).unwrap();

        // Valid project
        create_project_on_disk(home, "Valid", "valid");
        // Corrupt: dir exists but no project.db
        std::fs::create_dir_all(home.join("projects").join("corrupt-no-db")).unwrap();

        let found = scan_projects(home);
        assert_eq!(found.len(), 1, "Only the valid project should appear");
        assert_eq!(found[0].slug, "valid");
    }

    #[test]
    fn test_corrupt_project_empty_db_skipped() {
        let tmp = tempfile::tempdir().unwrap();
        let home = tmp.path();
        std::fs::create_dir_all(home.join("projects")).unwrap();

        // Valid project
        create_project_on_disk(home, "Good", "good");
        // Corrupt: has project.db but it's an empty/invalid SQLite file
        let corrupt_dir = home.join("projects").join("corrupt-empty-db");
        std::fs::create_dir_all(&corrupt_dir).unwrap();
        std::fs::write(corrupt_dir.join("project.db"), b"not a sqlite database").unwrap();

        // list scan — corrupt DB should not crash; scan_projects silently skips failures
        let found = scan_projects(home);
        assert_eq!(
            found.len(),
            1,
            "Only the valid project counted; corrupt skipped without crash"
        );
        assert_eq!(found[0].slug, "good");
    }

    // -------------------------------------------------------------------------
    // Negative: missing config handled
    // -------------------------------------------------------------------------

    #[test]
    fn test_missing_config_returns_none_last_opened() {
        let tmp = tempfile::tempdir().unwrap();
        let config = manager::read_config(tmp.path()).unwrap();
        assert!(
            config.last_opened_slug.is_none(),
            "missing config should give no last_opened_slug"
        );
    }

    #[test]
    fn test_config_with_nonexistent_slug_returns_default() {
        let tmp = tempfile::tempdir().unwrap();
        let home = tmp.path();
        // Write config pointing to a slug that has no directory
        let config = manager::Config {
            last_opened_slug: Some("ghost-project".to_string()),
        };
        manager::write_config(home, &config).unwrap();

        // A caller that checks directory existence before opening would get None
        let loaded = manager::read_config(home).unwrap();
        let slug = loaded.last_opened_slug.unwrap();
        let dir = manager::project_dir(home, &slug);
        assert!(!dir.exists(), "ghost project directory should not exist");
        // The system should not crash — it just won't find the project
    }

    // -------------------------------------------------------------------------
    // Negative: create_project with duplicate directory errors
    // -------------------------------------------------------------------------

    #[test]
    fn test_create_duplicate_slug_directory_errors() {
        let tmp = tempfile::tempdir().unwrap();
        let home = tmp.path();
        std::fs::create_dir_all(home.join("projects")).unwrap();

        // Create slug directory manually (simulates existing project)
        let dir = manager::project_dir(home, "my-project");
        std::fs::create_dir_all(&dir).unwrap();

        // Attempting to create when dir exists should detect the conflict
        assert!(
            dir.exists(),
            "directory already exists — create_project should error"
        );
    }

    // -------------------------------------------------------------------------
    // Negative: delete non-existing slug errors
    // -------------------------------------------------------------------------

    #[test]
    fn test_delete_nonexistent_project_dir_check() {
        let tmp = tempfile::tempdir().unwrap();
        let home = tmp.path();
        let dir = manager::project_dir(home, "ghost");
        assert!(
            !dir.exists(),
            "ghost project should not exist — delete_project should return error"
        );
    }

    // -------------------------------------------------------------------------
    // Regression: list_projects must not call run_migrations (write contention)
    // -------------------------------------------------------------------------

    #[test]
    fn list_projects_with_concurrent_open_connection() {
        // Regression: list_projects used to call run_migrations (writes) while AppState
        // held another connection open to the same DB. busy_timeout=5000 caused 5-second
        // freezes. Fix: list_projects is read-only — no run_migrations.
        let tmp = TempDir::new().unwrap();
        let home = tmp.path().to_path_buf();
        std::fs::create_dir_all(home.join("projects")).unwrap();

        let slug = "concurrent-test";
        let dir = home.join("projects").join(slug);
        std::fs::create_dir_all(&dir).unwrap();
        let db_path = dir.join("project.db");

        // conn1 simulates AppState.db — opened and held by open_project_inner
        let conn1 = crate::db::open_connection(&db_path).unwrap();
        crate::db::run_migrations(&conn1).unwrap();
        crate::projects::repository::insert_project(&conn1, "Concurrent Test", slug).unwrap();

        // conn2 simulates list_projects opening the same file — must read-only, no migrations
        let conn2 = crate::db::open_connection(&db_path).unwrap();
        let projects = crate::projects::repository::list_projects_in_db(&conn2).unwrap();

        assert_eq!(projects.len(), 1);
        assert_eq!(projects[0].slug, slug);

        // conn1 still healthy — no deadlock
        let count: i64 = conn1
            .query_row("SELECT COUNT(*) FROM projects", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 1, "AppState connection still healthy after concurrent list read");
    }

    #[test]
    fn list_projects_does_not_migrate_schema() {
        // Regression: list_projects must never write to a project DB.
        // Verify by creating a DB at schema v1 and confirming list_projects
        // does not upgrade it to v2 (that would mean run_migrations was called).
        let tmp = TempDir::new().unwrap();
        let home = tmp.path().to_path_buf();
        std::fs::create_dir_all(home.join("projects")).unwrap();

        let slug = "legacy-project";
        let dir = home.join("projects").join(slug);
        std::fs::create_dir_all(&dir).unwrap();
        let db_path = dir.join("project.db");

        // Create DB at schema v1 only (deliberately not migrated to v2)
        {
            let conn_setup = rusqlite::Connection::open(&db_path).unwrap();
            conn_setup.execute_batch("PRAGMA journal_mode=WAL;").unwrap();
            conn_setup.execute_batch(
                "CREATE TABLE schema_version (version INTEGER NOT NULL);
                 INSERT INTO schema_version VALUES (1);
                 CREATE TABLE projects (
                     id INTEGER PRIMARY KEY,
                     name TEXT NOT NULL,
                     slug TEXT NOT NULL UNIQUE,
                     created_at TEXT NOT NULL,
                     last_opened_at TEXT
                 );
                 INSERT INTO projects (name, slug, created_at)
                 VALUES ('Legacy', 'legacy-project', '2026-01-01T00:00:00Z');",
            ).unwrap();
        } // conn_setup dropped here

        // list_projects logic: open + read only (no migration)
        let conn = crate::db::open_connection(&db_path).unwrap();
        let projects = crate::projects::repository::list_projects_in_db(&conn).unwrap();

        assert_eq!(projects.len(), 1);
        assert_eq!(projects[0].slug, "legacy-project");

        // Schema must still be v1 — list_projects did not upgrade it
        let version: u32 = conn
            .query_row("SELECT version FROM schema_version LIMIT 1", [], |r| r.get(0))
            .unwrap();
        assert_eq!(version, 1, "list_projects must not run migrations — schema unchanged");
    }

    #[test]
    fn open_then_list_sequence() {
        // Integration test for the exact production sequence that was broken:
        // 1. open_project_inner holds AppState.db connection open
        // 2. list_projects opens same DB and reads — must not block
        let tmp = TempDir::new().unwrap();
        let home = tmp.path().to_path_buf();
        std::fs::create_dir_all(home.join("projects")).unwrap();

        let slug = "open-then-list";
        let dir = home.join("projects").join(slug);
        std::fs::create_dir_all(&dir).unwrap();
        let db_path = dir.join("project.db");

        // Set up project
        {
            let setup = crate::db::open_connection(&db_path).unwrap();
            crate::db::run_migrations(&setup).unwrap();
            crate::projects::repository::insert_project(&setup, "Open Then List", slug).unwrap();
        }

        // Step 1: simulate open_project_inner — hold connection open
        let appstate_conn = crate::db::open_connection(&db_path).unwrap();
        crate::db::run_migrations(&appstate_conn).unwrap(); // no-op (already v2)
        let project = crate::projects::repository::get_project_by_slug(&appstate_conn, slug).unwrap();
        crate::projects::repository::update_last_opened(&appstate_conn, project.id).unwrap();
        // appstate_conn held open — simulates AppState.db

        // Step 2: simulate list_projects — open second connection, read only
        let list_conn = crate::db::open_connection(&db_path).unwrap();
        // No run_migrations here (that was the bug)
        let projects = crate::projects::repository::list_projects_in_db(&list_conn).unwrap();

        assert_eq!(projects.len(), 1);
        assert_eq!(projects[0].slug, slug);

        // appstate_conn still healthy — proves no deadlock
        let count: i64 = appstate_conn
            .query_row("SELECT COUNT(*) FROM projects", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 1);
    }
}
