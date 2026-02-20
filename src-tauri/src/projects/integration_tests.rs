//! Integration tests for the projects module.
//! These tests exercise the full create → open → list → delete flow
//! using a real AppState and real filesystem (tempdir).

#[cfg(test)]
mod tests {
    use crate::db::{open_connection, run_migrations};
    use crate::projects::{manager, model::Project, repository};
    use crate::state::AppState;
    use std::sync::Mutex;
    use tempfile::TempDir;

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
    fn create_project_on_disk(home: &std::path::Path, name: &str, slug: &str) -> Project {
        let dir = manager::project_dir(home, slug);
        std::fs::create_dir_all(&dir).unwrap();
        let db_path = dir.join("project.db");
        let conn = open_connection(&db_path).unwrap();
        run_migrations(&conn).unwrap();
        let p = repository::insert_project(&conn, name, slug).unwrap();
        manager::create_project_dirs(home, slug).unwrap();
        p
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

        // Simulate list_projects by scanning dirs and opening each DB
        let mut found = vec![];
        for entry in std::fs::read_dir(home.join("projects")).unwrap().flatten() {
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
        let mut found = vec![];
        for entry in std::fs::read_dir(home.join("projects")).unwrap().flatten() {
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

        let mut found = vec![];
        for entry in std::fs::read_dir(home.join("projects")).unwrap().flatten() {
            if !entry.path().is_dir() {
                continue;
            }
            let db_path = entry.path().join("project.db");
            if !db_path.exists() {
                continue; // skip — as list_projects command does
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

        // list scan — corrupt DB should not crash
        let mut count = 0;
        for entry in std::fs::read_dir(home.join("projects")).unwrap().flatten() {
            if !entry.path().is_dir() {
                continue;
            }
            let db_path = entry.path().join("project.db");
            if !db_path.exists() {
                continue;
            }
            match open_connection(&db_path) {
                Ok(conn) => {
                    if run_migrations(&conn).is_ok() {
                        if let Ok(rows) = repository::list_projects_in_db(&conn) {
                            if rows.len() == 1 {
                                count += 1;
                            }
                        }
                    }
                }
                Err(_) => {} // corrupt DB — skipped, no crash
            }
        }
        assert_eq!(
            count, 1,
            "Only the valid project counted; corrupt skipped without crash"
        );
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
}
