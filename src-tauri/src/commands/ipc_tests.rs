// src-tauri/src/commands/ipc_tests.rs
// Tauri IPC integration tests: test commands through the real Tauri dispatch layer.
// Catches bugs that pure Rust tests and mocked-frontend tests cannot:
// command registration, state passing through Tauri's managed-state system,
// and serialization of results.

#[cfg(test)]
mod tests {
    use crate::commands::import::*;
    use crate::commands::projects::*;
    use crate::state::AppState;
    use tauri::ipc::CallbackFn;
    use tauri::test::{mock_builder, mock_context, noop_assets};
    use tauri::webview::InvokeRequest;
    use tempfile::TempDir;

    fn create_project_on_disk(home: &std::path::Path, name: &str, slug: &str) {
        let dir = home.join("projects").join(slug);
        std::fs::create_dir_all(&dir).unwrap();
        let db_path = dir.join("project.db");
        let conn = crate::db::open_connection(&db_path).unwrap();
        crate::db::run_migrations(&conn).unwrap();
        crate::projects::repository::insert_project(&conn, name, slug).unwrap();
    }

    fn make_app(home: std::path::PathBuf) -> tauri::App<tauri::test::MockRuntime> {
        mock_builder()
            .manage(AppState::new(home))
            .invoke_handler(tauri::generate_handler![
                list_projects,
                create_project,
                open_project,
                get_last_project,
                delete_project,
                suggest_slug,
                add_source_folder,
                remove_source_folder,
                list_source_folders,
                get_indexing_status,
                list_stacks,
                list_logical_photos,
            ])
            .build(mock_context(noop_assets()))
            .unwrap()
    }

    fn make_webview(
        app: &tauri::App<tauri::test::MockRuntime>,
    ) -> tauri::WebviewWindow<tauri::test::MockRuntime> {
        tauri::WebviewWindowBuilder::new(app, "main", Default::default())
            .build()
            .unwrap()
    }

    fn invoke_req(cmd: &str, payload: serde_json::Value) -> InvokeRequest {
        InvokeRequest {
            cmd: cmd.into(),
            callback: CallbackFn(0),
            error: CallbackFn(1),
            url: "http://tauri.localhost".parse().unwrap(),
            body: tauri::ipc::InvokeBody::Json(payload),
            headers: Default::default(),
            invoke_key: tauri::test::INVOKE_KEY.to_string(),
        }
    }

    #[test]
    fn ipc_list_projects_empty() {
        let tmp = TempDir::new().unwrap();
        let home = tmp.path().to_path_buf();
        std::fs::create_dir_all(home.join("projects")).unwrap();
        let app = make_app(home);
        let wv = make_webview(&app);
        tauri::test::assert_ipc_response(
            &wv,
            invoke_req("list_projects", serde_json::json!({})),
            Ok::<serde_json::Value, serde_json::Value>(serde_json::json!([])),
        );
    }

    #[test]
    fn ipc_open_then_list_no_freeze() {
        // THE KEY IPC TEST: the exact production sequence that caused the UI freeze.
        // open_project sets AppState.db. list_projects must complete fast, not block.
        let tmp = TempDir::new().unwrap();
        let home = tmp.path().to_path_buf();
        std::fs::create_dir_all(home.join("projects")).unwrap();
        create_project_on_disk(&home, "Test", "test");
        let app = make_app(home);
        let wv = make_webview(&app);

        // Step 1: open_project (sets AppState.db)
        // Use get_ipc_response instead of assert_ipc_response to avoid matching
        // the dynamic created_at / last_opened_at timestamps.
        let open_result = tauri::test::get_ipc_response(
            &wv,
            invoke_req("open_project", serde_json::json!({ "slug": "test" })),
        );
        assert!(open_result.is_ok(), "open_project should succeed");
        let open_val: serde_json::Value = open_result.unwrap().deserialize().unwrap();
        assert_eq!(open_val["slug"], "test");
        assert_eq!(open_val["name"], "Test");

        // Step 2: list_projects — verify it responds and is not frozen
        let start = std::time::Instant::now();
        let list_result =
            tauri::test::get_ipc_response(&wv, invoke_req("list_projects", serde_json::json!({})));
        let elapsed = start.elapsed();
        assert!(
            list_result.is_ok(),
            "list_projects should succeed after open_project"
        );
        let list_val: serde_json::Value = list_result.unwrap().deserialize().unwrap();
        let arr = list_val
            .as_array()
            .expect("list_projects should return an array");
        assert_eq!(arr.len(), 1, "list_projects should return 1 project");
        assert_eq!(arr[0]["slug"], "test");
        assert!(
            elapsed.as_millis() < 500,
            "list_projects took {}ms after open_project — possible SQLite contention (< 500ms tightened from 1000ms to catch earlier regressions)",
            elapsed.as_millis()
        );
    }

    #[test]
    fn ipc_get_last_project_no_config() {
        // Should return null gracefully when no config.json exists
        let tmp = TempDir::new().unwrap();
        let home = tmp.path().to_path_buf();
        std::fs::create_dir_all(home.join("projects")).unwrap();
        let app = make_app(home);
        let wv = make_webview(&app);
        tauri::test::assert_ipc_response(
            &wv,
            invoke_req("get_last_project", serde_json::json!({})),
            Ok::<serde_json::Value, serde_json::Value>(serde_json::json!(null)),
        );
    }

    #[test]
    fn ipc_add_and_list_source_folders() {
        // Verify that add_source_folder persists a folder and list_source_folders
        // returns it, confirming both commands are registered and work end-to-end.
        let tmp = TempDir::new().unwrap();
        let home = tmp.path().to_path_buf();
        std::fs::create_dir_all(home.join("projects")).unwrap();
        create_project_on_disk(&home, "Test", "test");

        // Create a real directory on disk that add_source_folder will validate
        let photo_dir = tmp.path().join("photos");
        std::fs::create_dir_all(&photo_dir).unwrap();
        let photo_dir_str = photo_dir.to_string_lossy().into_owned();

        let app = make_app(home);
        let wv = make_webview(&app);

        // First open the project so AppState.db is populated
        let open_result = tauri::test::get_ipc_response(
            &wv,
            invoke_req("open_project", serde_json::json!({ "slug": "test" })),
        );
        assert!(open_result.is_ok(), "open_project should succeed");

        // Step 1: add a source folder
        let add_result = tauri::test::get_ipc_response(
            &wv,
            invoke_req(
                "add_source_folder",
                serde_json::json!({ "slug": "test", "path": photo_dir_str }),
            ),
        );
        assert!(
            add_result.is_ok(),
            "add_source_folder should succeed: {:?}",
            add_result.err()
        );

        // Step 2: list source folders — verify the folder appears
        let list_result = tauri::test::get_ipc_response(
            &wv,
            invoke_req("list_source_folders", serde_json::json!({ "slug": "test" })),
        );
        assert!(list_result.is_ok(), "list_source_folders should succeed");
        let list_val: serde_json::Value = list_result.unwrap().deserialize().unwrap();
        let folders = list_val.as_array().expect("list_source_folders must return array");
        assert_eq!(folders.len(), 1, "should have exactly 1 source folder");
        assert_eq!(
            folders[0]["path"], photo_dir_str,
            "folder path must match what was added"
        );
    }

    #[test]
    fn ipc_list_stacks_empty_project() {
        // Verify that list_stacks returns an empty array for a freshly opened project
        // with no indexing. This confirms list_stacks is registered and doesn't panic
        // when there is no data.
        let tmp = TempDir::new().unwrap();
        let home = tmp.path().to_path_buf();
        std::fs::create_dir_all(home.join("projects")).unwrap();
        create_project_on_disk(&home, "Test", "test");

        let app = make_app(home);
        let wv = make_webview(&app);

        // Open the project first
        let open_result = tauri::test::get_ipc_response(
            &wv,
            invoke_req("open_project", serde_json::json!({ "slug": "test" })),
        );
        assert!(open_result.is_ok(), "open_project should succeed");

        // list_stacks on an empty project should return []
        tauri::test::assert_ipc_response(
            &wv,
            invoke_req("list_stacks", serde_json::json!({ "slug": "test" })),
            Ok::<serde_json::Value, serde_json::Value>(serde_json::json!([])),
        );
    }

    #[test]
    fn ipc_list_logical_photos_empty_stack() {
        // WHY: Verifies that list_logical_photos is registered, accepts a valid
        // stack_id, returns an array, and that the array has at least 1 entry
        // after the pipeline has ingested a JPEG into that stack.
        use crate::db::run_migrations;
        use crate::import::pipeline;
        use crate::photos::model::IndexingStatus;
        use std::sync::atomic::AtomicBool;
        use std::sync::{Arc, Mutex};

        let tmp = tempfile::TempDir::new().unwrap();
        let home = tmp.path().join("home");
        std::fs::create_dir_all(home.join("projects")).unwrap();

        // Create project on disk in the home dir (as make_app expects)
        create_project_on_disk(&home, "Test", "test");

        // Run the import pipeline directly using the project DB.
        // We need to produce at least 1 stack + logical_photo so the IPC call
        // returns a non-empty array.
        let project_dir = home.join("projects").join("test");
        let db_path = project_dir.join("project.db");
        let conn = crate::db::open_connection(&db_path).unwrap();
        run_migrations(&conn).unwrap();

        // Fetch the project_id from the DB
        let project_id: i64 = conn
            .query_row("SELECT id FROM projects WHERE slug = 'test'", [], |row| {
                row.get(0)
            })
            .unwrap();

        // Write a minimal valid JPEG using the `image` crate (same as integration tests)
        let photo_dir = tmp.path().join("photos");
        std::fs::create_dir_all(&photo_dir).unwrap();
        image::DynamicImage::new_rgb8(10, 10)
            .save(photo_dir.join("shot.jpg"))
            .unwrap();

        // Create the thumbnails cache dir the pipeline expects
        std::fs::create_dir_all(project_dir.join("cache").join("thumbnails")).unwrap();

        let status = Arc::new(Mutex::new(IndexingStatus::default()));
        let cancel = Arc::new(AtomicBool::new(false));
        let pause = Arc::new(AtomicBool::new(false));

        pipeline::run_pipeline(
            &conn,
            project_id,
            &project_dir,
            vec![photo_dir],
            3,
            status,
            cancel,
            pause,
            None,
            std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0)),
        );

        // Drop the direct connection so the IPC app can open the same DB
        drop(conn);

        // Build the Tauri mock app and open the project via IPC
        let app = make_app(home);
        let wv = make_webview(&app);

        let open_result = tauri::test::get_ipc_response(
            &wv,
            invoke_req("open_project", serde_json::json!({ "slug": "test" })),
        );
        assert!(open_result.is_ok(), "open_project should succeed");

        // Retrieve the first stack via list_stacks to get a valid stack_id
        let stacks_result = tauri::test::get_ipc_response(
            &wv,
            invoke_req("list_stacks", serde_json::json!({ "slug": "test" })),
        );
        assert!(stacks_result.is_ok(), "list_stacks should succeed");
        let stacks_val: serde_json::Value = stacks_result.unwrap().deserialize().unwrap();
        let stacks = stacks_val.as_array().expect("list_stacks must return an array");
        assert!(
            !stacks.is_empty(),
            "pipeline must have created at least one stack"
        );
        let stack_id = stacks[0]["stack_id"].as_i64().expect("stack_id must be i64");

        // Call list_logical_photos for that stack_id
        let lp_result = tauri::test::get_ipc_response(
            &wv,
            invoke_req(
                "list_logical_photos",
                serde_json::json!({ "slug": "test", "stackId": stack_id }),
            ),
        );
        assert!(
            lp_result.is_ok(),
            "list_logical_photos should succeed: {:?}",
            lp_result.err()
        );
        let lp_val: serde_json::Value = lp_result.unwrap().deserialize().unwrap();
        let photos = lp_val
            .as_array()
            .expect("list_logical_photos must return an array");
        assert!(
            !photos.is_empty(),
            "list_logical_photos must return at least 1 entry for a stack with photos"
        );

        // Verify the shape of the first entry matches LogicalPhotoSummary IPC contract
        let first = &photos[0];
        assert!(
            first["logical_photo_id"].is_number(),
            "logical_photo_id must be a number"
        );
        assert!(
            first["has_jpeg"].is_boolean(),
            "has_jpeg must be a boolean"
        );
        assert!(first["has_raw"].is_boolean(), "has_raw must be a boolean");
    }

    #[test]
    fn ipc_remove_source_folder() {
        // WHY: Verifies that remove_source_folder (IPC command) correctly removes
        // an attached folder and that list_source_folders reflects the removal.
        // remove_source_folder takes folder_id: i64, not a path string, so we must
        // read the id from list_source_folders after add_source_folder.
        let tmp = TempDir::new().unwrap();
        let home = tmp.path().to_path_buf();
        std::fs::create_dir_all(home.join("projects")).unwrap();
        create_project_on_disk(&home, "Test", "test");

        let photo_dir = tmp.path().join("photos");
        std::fs::create_dir_all(&photo_dir).unwrap();
        let photo_dir_str = photo_dir.to_str().unwrap().to_string();

        let app = make_app(home);
        let wv = make_webview(&app);

        // Open the project
        let open_result = tauri::test::get_ipc_response(
            &wv,
            invoke_req("open_project", serde_json::json!({ "slug": "test" })),
        );
        assert!(open_result.is_ok(), "open_project must succeed");

        // Add the source folder
        let add_result = tauri::test::get_ipc_response(
            &wv,
            invoke_req(
                "add_source_folder",
                serde_json::json!({ "slug": "test", "path": photo_dir_str }),
            ),
        );
        assert!(
            add_result.is_ok(),
            "add_source_folder must succeed: {:?}",
            add_result
        );

        // List to retrieve the folder_id assigned by the DB
        let list_result = tauri::test::get_ipc_response(
            &wv,
            invoke_req("list_source_folders", serde_json::json!({ "slug": "test" })),
        );
        assert!(list_result.is_ok(), "list_source_folders must succeed");
        let folders: serde_json::Value = list_result.unwrap().deserialize().unwrap();
        let folders_arr = folders.as_array().expect("must be array");
        assert_eq!(folders_arr.len(), 1, "must have exactly one folder after add");
        let folder_id = folders_arr[0]["id"]
            .as_i64()
            .expect("folder must have an integer id");

        // Remove by folderId — Tauri serialises snake_case Rust param names as camelCase in IPC
        let remove_result = tauri::test::get_ipc_response(
            &wv,
            invoke_req(
                "remove_source_folder",
                serde_json::json!({ "slug": "test", "folderId": folder_id }),
            ),
        );
        assert!(
            remove_result.is_ok(),
            "remove_source_folder must succeed: {:?}",
            remove_result
        );

        // Verify the folder is gone
        let list_after = tauri::test::get_ipc_response(
            &wv,
            invoke_req("list_source_folders", serde_json::json!({ "slug": "test" })),
        );
        let folders_after: serde_json::Value = list_after.unwrap().deserialize().unwrap();
        assert_eq!(
            folders_after.as_array().unwrap().len(),
            0,
            "source folders must be empty after remove_source_folder"
        );
    }

    #[test]
    fn ipc_get_indexing_status_returns_valid_shape() {
        // WHY: Verifies the IPC contract for get_indexing_status — the frontend
        // (StackOverview.svelte) expects `running` and `thumbnails_running` booleans.
        // Also verifies the command is registered and the idle state is correct.
        // Note: get_indexing_status does NOT require an open project or a slug param.
        let tmp = TempDir::new().unwrap();
        let home = tmp.path().to_path_buf();
        std::fs::create_dir_all(home.join("projects")).unwrap();

        let app = make_app(home);
        let wv = make_webview(&app);

        let result = tauri::test::get_ipc_response(
            &wv,
            invoke_req("get_indexing_status", serde_json::json!({})),
        );
        assert!(
            result.is_ok(),
            "get_indexing_status must succeed: {:?}",
            result
        );
        let status: serde_json::Value = result.unwrap().deserialize().unwrap();

        // Verify IPC contract fields (must match what the frontend expects)
        assert!(
            status["running"].is_boolean(),
            "running must be a boolean, got: {:?}",
            status["running"]
        );
        assert!(
            status["thumbnails_running"].is_boolean(),
            "thumbnails_running must be a boolean, got: {:?}",
            status["thumbnails_running"]
        );
        assert_eq!(
            status["running"].as_bool(),
            Some(false),
            "idle app must report running=false"
        );
        assert_eq!(
            status["thumbnails_running"].as_bool(),
            Some(false),
            "idle app must report thumbnails_running=false"
        );
    }

    #[test]
    fn test_get_indexing_status_returns_live_thumbnails_done() {
        // P1-04: WHY (Rule 1) — get_indexing_status must read the live AtomicUsize,
        // not a stale snapshot in the Mutex. If the counter isn't injected, the
        // progress bar always shows 0%.
        use std::sync::atomic::Ordering;
        use tauri::Manager;

        let tmp = TempDir::new().unwrap();
        let home = tmp.path().to_path_buf();
        std::fs::create_dir_all(home.join("projects")).unwrap();

        let app = make_app(home);
        let wv = make_webview(&app);

        // Store 42 directly in the counter (simulating pipeline progress)
        let state: tauri::State<crate::state::AppState> = app.state();
        state.thumbnails_done_counter.store(42, Ordering::SeqCst);

        let result = tauri::test::get_ipc_response(
            &wv,
            invoke_req("get_indexing_status", serde_json::json!({})),
        );
        assert!(result.is_ok(), "get_indexing_status must succeed");
        let status: serde_json::Value = result.unwrap().deserialize().unwrap();

        assert_eq!(
            status["thumbnails_done"].as_u64(),
            Some(42),
            "thumbnails_done must reflect the live counter value (42), got: {:?}",
            status["thumbnails_done"]
        );
    }

    #[test]
    fn test_thumbnails_counters_zero_before_indexing_starts() {
        // P1-05: WHY (Rule 4 negative) — fresh AppState must have both counters at 0
        // so the frontend shows the spinner, not a "0/0 (0%)" bar.
        let tmp = TempDir::new().unwrap();
        let home = tmp.path().to_path_buf();
        std::fs::create_dir_all(home.join("projects")).unwrap();

        let app = make_app(home);
        let wv = make_webview(&app);

        let result = tauri::test::get_ipc_response(
            &wv,
            invoke_req("get_indexing_status", serde_json::json!({})),
        );
        assert!(result.is_ok(), "get_indexing_status must succeed");
        let status: serde_json::Value = result.unwrap().deserialize().unwrap();

        assert_eq!(
            status["thumbnails_total"].as_u64(),
            Some(0),
            "thumbnails_total must be 0 before indexing starts, got: {:?}",
            status["thumbnails_total"]
        );
        assert_eq!(
            status["thumbnails_done"].as_u64(),
            Some(0),
            "thumbnails_done must be 0 before indexing starts, got: {:?}",
            status["thumbnails_done"]
        );
    }
}
