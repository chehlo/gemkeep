// src-tauri/src/commands/ipc_tests.rs
// Tauri IPC integration tests: test commands through the real Tauri dispatch layer.
// Catches bugs that pure Rust tests and mocked-frontend tests cannot:
// command registration, state passing through Tauri's managed-state system,
// and serialization of results.

#[cfg(test)]
mod tests {
    use crate::commands::decisions::*;
    use crate::commands::import::{
        cancel_indexing, get_burst_gap, pause_indexing, restack, resume_indexing, set_burst_gap, *,
    };
    use crate::commands::projects::*;
    use crate::commands::stacks::*;
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
                get_burst_gap,
                set_burst_gap,
                cancel_indexing,
                pause_indexing,
                resume_indexing,
                restack,
                merge_stacks,
                undo_last_merge,
                list_stack_transactions,
                make_decision,
                undo_decision,
                get_round_status,
                commit_round,
                get_photo_detail,
                get_round_decisions,
                restore_eliminated_photo,
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

    /// SD-05: Creates a TempDir + projects subdirectory, returns both so
    /// the TempDir stays alive (RAII) and home can be passed to make_app.
    fn setup_ipc_home() -> (TempDir, std::path::PathBuf) {
        let tmp = TempDir::new().unwrap();
        let home = tmp.path().to_path_buf();
        std::fs::create_dir_all(home.join("projects")).unwrap();
        (tmp, home)
    }

    #[test]
    fn ipc_list_projects_empty() {
        let (_tmp, home) = setup_ipc_home();
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
        let (_tmp, home) = setup_ipc_home();
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
        let (_tmp, home) = setup_ipc_home();
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
        let (tmp, home) = setup_ipc_home();
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
        let folders = list_val
            .as_array()
            .expect("list_source_folders must return array");
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
        let (_tmp, home) = setup_ipc_home();
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
        let tmp = TempDir::new().unwrap();
        let home = setup_project_with_photos(&tmp, 1);

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
        let stacks = stacks_val
            .as_array()
            .expect("list_stacks must return an array");
        assert!(
            !stacks.is_empty(),
            "pipeline must have created at least one stack"
        );
        let stack_id = stacks[0]["stack_id"]
            .as_i64()
            .expect("stack_id must be i64");

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
        assert!(first["has_jpeg"].is_boolean(), "has_jpeg must be a boolean");
        assert!(first["has_raw"].is_boolean(), "has_raw must be a boolean");
    }

    #[test]
    fn ipc_remove_source_folder() {
        // WHY: Verifies that remove_source_folder (IPC command) correctly removes
        // an attached folder and that list_source_folders reflects the removal.
        // remove_source_folder takes folder_id: i64, not a path string, so we must
        // read the id from list_source_folders after add_source_folder.
        let (tmp, home) = setup_ipc_home();
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
        assert_eq!(
            folders_arr.len(),
            1,
            "must have exactly one folder after add"
        );
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
        // Note: get_indexing_status requires a slug param for per-project context.
        let (_tmp, home) = setup_ipc_home();

        let app = make_app(home);
        let wv = make_webview(&app);

        let result = tauri::test::get_ipc_response(
            &wv,
            invoke_req("get_indexing_status", serde_json::json!({ "slug": "test" })),
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

        let (_tmp, home) = setup_ipc_home();

        let app = make_app(home);
        let wv = make_webview(&app);

        // Store 42 directly in the counter (simulating pipeline progress)
        let state: tauri::State<crate::state::AppState> = app.state();
        let ctx = state.get_or_create_context("test");
        ctx.thumbnails_done_counter.store(42, Ordering::SeqCst);

        let result = tauri::test::get_ipc_response(
            &wv,
            invoke_req("get_indexing_status", serde_json::json!({ "slug": "test" })),
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
        let (_tmp, home) = setup_ipc_home();

        let app = make_app(home);
        let wv = make_webview(&app);

        let result = tauri::test::get_ipc_response(
            &wv,
            invoke_req("get_indexing_status", serde_json::json!({ "slug": "test" })),
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

    #[test]
    fn test_get_burst_gap_returns_default() {
        let (_tmp, home) = setup_ipc_home();

        let app = make_app(home);
        let wv = make_webview(&app);

        let result =
            tauri::test::get_ipc_response(&wv, invoke_req("get_burst_gap", serde_json::json!({})));
        assert!(result.is_ok(), "get_burst_gap must succeed");
        let value: u64 = result.unwrap().deserialize().unwrap();
        assert_eq!(value, 3, "default burst_gap must be 3");
    }

    #[test]
    fn test_set_burst_gap_persists_value() {
        let (_tmp, home) = setup_ipc_home();

        let app = make_app(home);
        let wv = make_webview(&app);

        // Set burst gap to 10
        let set_result = tauri::test::get_ipc_response(
            &wv,
            invoke_req("set_burst_gap", serde_json::json!({ "secs": 10u64 })),
        );
        assert!(set_result.is_ok(), "set_burst_gap must succeed");

        // Read it back
        let get_result =
            tauri::test::get_ipc_response(&wv, invoke_req("get_burst_gap", serde_json::json!({})));
        assert!(get_result.is_ok(), "get_burst_gap after set must succeed");
        let value: u64 = get_result.unwrap().deserialize().unwrap();
        assert_eq!(value, 10, "burst_gap must be 10 after set_burst_gap(10)");
    }

    // ── Sprint 7 §16.5: IPC Contract Tests ──────────────────────────────────

    /// Helper: set up a project on disk with photos ingested via pipeline.
    /// Returns home_path — the caller-owned TempDir must be kept alive (RAII)
    /// to prevent the temp directory from being deleted.
    fn setup_project_with_photos(tmp: &TempDir, num_photos: usize) -> std::path::PathBuf {
        use crate::db::run_migrations;
        use crate::photos::model::IndexingStatus;
        use std::sync::atomic::{AtomicBool, AtomicUsize};
        use std::sync::{Arc, Mutex};

        let home = tmp.path().to_path_buf();
        std::fs::create_dir_all(home.join("projects")).unwrap();
        create_project_on_disk(&home, "Test", "test");

        let project_dir = home.join("projects").join("test");
        let db_path = project_dir.join("project.db");
        let conn = crate::db::open_connection(&db_path).unwrap();
        run_migrations(&conn).unwrap();

        let project_id: i64 = conn
            .query_row("SELECT id FROM projects WHERE slug = 'test'", [], |row| {
                row.get(0)
            })
            .unwrap();

        // Write minimal JPEGs
        let photo_dir = tmp.path().join("photos");
        std::fs::create_dir_all(&photo_dir).unwrap();
        for i in 0..num_photos {
            image::DynamicImage::new_rgb8(10, 10)
                .save(photo_dir.join(format!("shot_{}.jpg", i)))
                .unwrap();
        }

        std::fs::create_dir_all(project_dir.join("cache").join("thumbnails")).unwrap();

        let status = Arc::new(Mutex::new(IndexingStatus::default()));
        let cancel = Arc::new(AtomicBool::new(false));
        let pause = Arc::new(AtomicBool::new(false));

        crate::import::pipeline::run_pipeline(
            &conn,
            project_id,
            &project_dir,
            vec![photo_dir],
            3,
            status,
            cancel,
            pause,
            None,
            Arc::new(AtomicUsize::new(0)),
        );

        drop(conn);
        home
    }

    /// SD-04: Full IPC setup with photos — creates project, ingests photos via
    /// pipeline, builds Tauri app, opens project, retrieves stacks + logical photos.
    /// Returns (TempDir, App, WebviewWindow, first stack_id, logical_photo_ids).
    /// TempDir is returned to keep the temp directory alive (RAII).
    #[allow(clippy::type_complexity)]
    fn setup_ipc_with_photos(
        num_photos: usize,
    ) -> (
        TempDir,
        tauri::App<tauri::test::MockRuntime>,
        tauri::WebviewWindow<tauri::test::MockRuntime>,
        i64,
        Vec<i64>,
    ) {
        let tmp = TempDir::new().unwrap();
        let home = setup_project_with_photos(&tmp, num_photos);
        let app = make_app(home);
        let wv = make_webview(&app);

        // Open project
        let open_result = tauri::test::get_ipc_response(
            &wv,
            invoke_req("open_project", serde_json::json!({ "slug": "test" })),
        );
        assert!(open_result.is_ok(), "open_project must succeed");

        // Get first stack_id
        let stacks_result = tauri::test::get_ipc_response(
            &wv,
            invoke_req("list_stacks", serde_json::json!({ "slug": "test" })),
        );
        assert!(stacks_result.is_ok(), "list_stacks must succeed");
        let stacks: serde_json::Value = stacks_result.unwrap().deserialize().unwrap();
        let stack_id = stacks.as_array().unwrap()[0]["stack_id"].as_i64().unwrap();

        // Get logical photo IDs
        let lp_result = tauri::test::get_ipc_response(
            &wv,
            invoke_req(
                "list_logical_photos",
                serde_json::json!({ "slug": "test", "stackId": stack_id }),
            ),
        );
        assert!(lp_result.is_ok(), "list_logical_photos must succeed");
        let lps: serde_json::Value = lp_result.unwrap().deserialize().unwrap();
        let lp_ids: Vec<i64> = lps
            .as_array()
            .unwrap()
            .iter()
            .map(|lp| lp["logical_photo_id"].as_i64().unwrap())
            .collect();

        (tmp, app, wv, stack_id, lp_ids)
    }

    #[test]
    fn test_ipc_merge_stacks_json_shape() {
        // Sprint 7 §16.5: Contract test — verify merge_stacks returns JSON
        // matching the TypeScript MergeResult interface.
        // NOTE: This test will fail (panic) in RED phase because merge_stacks
        // is not implemented. That is expected for TDD.
        let tmp = TempDir::new().unwrap();
        let home = setup_project_with_photos(&tmp, 4);
        let app = make_app(home);
        let wv = make_webview(&app);

        // Open project
        let open_result = tauri::test::get_ipc_response(
            &wv,
            invoke_req("open_project", serde_json::json!({ "slug": "test" })),
        );
        assert!(open_result.is_ok(), "open_project must succeed");

        // Get stacks to find 2 stack IDs to merge
        // (with burst_gap=3 and 4 photos, we may have 1 stack; we need at least 2
        //  but in the RED phase the merge command panics anyway.)
        let stacks_result = tauri::test::get_ipc_response(
            &wv,
            invoke_req("list_stacks", serde_json::json!({ "slug": "test" })),
        );
        assert!(stacks_result.is_ok(), "list_stacks must succeed");
        let stacks: serde_json::Value = stacks_result.unwrap().deserialize().unwrap();
        let stacks_arr = stacks.as_array().unwrap();

        // For the contract test, we just need any two valid stack IDs.
        // If only 1 stack exists, use it twice (the command should validate and
        // error, but the test is primarily about JSON shape).
        let sid1 = stacks_arr
            .first()
            .and_then(|s| s["stack_id"].as_i64())
            .unwrap_or(1);
        let sid2 = stacks_arr
            .get(1)
            .and_then(|s| s["stack_id"].as_i64())
            .unwrap_or(sid1 + 1);

        let result = tauri::test::get_ipc_response(
            &wv,
            invoke_req(
                "merge_stacks",
                serde_json::json!({ "slug": "test", "stackIds": [sid1, sid2] }),
            ),
        );
        assert!(result.is_ok(), "merge_stacks must succeed: {:?}", result);
        let val: serde_json::Value = result.unwrap().deserialize().unwrap();

        // Verify JSON shape matches TypeScript MergeResult interface
        assert!(
            val["merged_stack_id"].is_number(),
            "merged_stack_id must be a number"
        );
        assert!(
            val["logical_photos_moved"].is_number(),
            "logical_photos_moved must be a number"
        );
        assert!(
            val["source_stack_ids"].is_array(),
            "source_stack_ids must be an array"
        );
        assert!(
            val["transaction_id"].is_number(),
            "transaction_id must be a number"
        );
    }

    #[test]
    fn test_ipc_make_decision_json_shape() {
        // Sprint 7 §16.5: Contract test — verify make_decision returns JSON
        // matching the TypeScript DecisionResult interface.
        let (_tmp, _app, wv, _stack_id, lp_ids) = setup_ipc_with_photos(2);
        let lp_id = lp_ids[0];

        // Call make_decision
        let result = tauri::test::get_ipc_response(
            &wv,
            invoke_req(
                "make_decision",
                serde_json::json!({
                    "slug": "test",
                    "logicalPhotoId": lp_id,
                    "action": "keep"
                }),
            ),
        );
        assert!(result.is_ok(), "make_decision must succeed: {:?}", result);
        let val: serde_json::Value = result.unwrap().deserialize().unwrap();

        // Verify JSON shape matches TypeScript DecisionResult interface
        assert!(
            val["decision_id"].is_number(),
            "decision_id must be a number"
        );
        assert!(val["round_id"].is_number(), "round_id must be a number");
        assert!(val["action"].is_string(), "action must be a string");
        assert!(
            val["current_status"].is_string(),
            "current_status must be a string"
        );
        assert!(
            val["round_auto_created"].is_boolean(),
            "round_auto_created must be a boolean"
        );
    }

    #[test]
    fn test_ipc_get_round_status_json_shape() {
        // Sprint 7 §16.5: Contract test — verify get_round_status returns JSON
        // matching the TypeScript RoundStatus interface.
        let (_tmp, _app, wv, stack_id, _lp_ids) = setup_ipc_with_photos(3);

        // Call get_round_status
        let result = tauri::test::get_ipc_response(
            &wv,
            invoke_req(
                "get_round_status",
                serde_json::json!({ "slug": "test", "stackId": stack_id }),
            ),
        );
        assert!(
            result.is_ok(),
            "get_round_status must succeed: {:?}",
            result
        );
        let val: serde_json::Value = result.unwrap().deserialize().unwrap();

        // Verify JSON shape matches TypeScript RoundStatus interface
        assert!(val["round_id"].is_number(), "round_id must be a number");
        assert!(
            val["round_number"].is_number(),
            "round_number must be a number"
        );
        assert!(val["state"].is_string(), "state must be a string");
        assert!(
            val["total_photos"].is_number(),
            "total_photos must be a number"
        );
        assert!(val["decided"].is_number(), "decided must be a number");
        assert!(val["kept"].is_number(), "kept must be a number");
        assert!(val["eliminated"].is_number(), "eliminated must be a number");
        assert!(val["undecided"].is_number(), "undecided must be a number");
        // committed_at is nullable (null when round is open)
        assert!(
            val["committed_at"].is_null() || val["committed_at"].is_string(),
            "committed_at must be null or string"
        );
    }

    #[test]
    fn test_ipc_get_photo_detail_json_shape() {
        // Sprint 7 §16.5: Contract test — verify get_photo_detail returns JSON
        // matching the TypeScript PhotoDetail interface.
        let (_tmp, _app, wv, _stack_id, lp_ids) = setup_ipc_with_photos(1);
        let lp_id = lp_ids[0];

        // Call get_photo_detail
        let result = tauri::test::get_ipc_response(
            &wv,
            invoke_req(
                "get_photo_detail",
                serde_json::json!({ "slug": "test", "logicalPhotoId": lp_id }),
            ),
        );
        assert!(
            result.is_ok(),
            "get_photo_detail must succeed: {:?}",
            result
        );
        let val: serde_json::Value = result.unwrap().deserialize().unwrap();

        // Verify JSON shape matches TypeScript PhotoDetail interface
        assert!(
            val["logical_photo_id"].is_number(),
            "logical_photo_id must be a number"
        );
        assert!(
            val["thumbnail_path"].is_null() || val["thumbnail_path"].is_string(),
            "thumbnail_path must be null or string"
        );
        assert!(
            val["capture_time"].is_null() || val["capture_time"].is_string(),
            "capture_time must be null or string"
        );
        assert!(
            val["camera_model"].is_null() || val["camera_model"].is_string(),
            "camera_model must be null or string"
        );
        assert!(
            val["lens"].is_null() || val["lens"].is_string(),
            "lens must be null or string"
        );
        assert!(val["has_raw"].is_boolean(), "has_raw must be a boolean");
        assert!(val["has_jpeg"].is_boolean(), "has_jpeg must be a boolean");
        assert!(
            val["current_status"].is_string(),
            "current_status must be a string"
        );
        // Camera parameters (all nullable)
        assert!(
            val["aperture"].is_null() || val["aperture"].is_number(),
            "aperture must be null or number"
        );
        assert!(
            val["shutter_speed"].is_null() || val["shutter_speed"].is_string(),
            "shutter_speed must be null or string"
        );
        assert!(
            val["iso"].is_null() || val["iso"].is_number(),
            "iso must be null or number"
        );
        assert!(
            val["focal_length"].is_null() || val["focal_length"].is_number(),
            "focal_length must be null or number"
        );
        assert!(
            val["exposure_comp"].is_null() || val["exposure_comp"].is_number(),
            "exposure_comp must be null or number"
        );
        // File paths (nullable)
        assert!(
            val["jpeg_path"].is_null() || val["jpeg_path"].is_string(),
            "jpeg_path must be null or string"
        );
        assert!(
            val["raw_path"].is_null() || val["raw_path"].is_string(),
            "raw_path must be null or string"
        );
    }

    #[test]
    fn test_ipc_get_round_decisions_json_shape() {
        // Contract test — verify get_round_decisions returns JSON
        // matching the TypeScript PhotoDecisionStatus[] interface.
        let (_tmp, _app, wv, stack_id, lp_ids) = setup_ipc_with_photos(3);

        // Make a decision first (auto-creates Round 1) so there's data to query
        let decision_result = tauri::test::get_ipc_response(
            &wv,
            invoke_req(
                "make_decision",
                serde_json::json!({
                    "slug": "test",
                    "logicalPhotoId": lp_ids[0],
                    "action": "keep"
                }),
            ),
        );
        assert!(
            decision_result.is_ok(),
            "make_decision must succeed: {:?}",
            decision_result
        );
        let decision_val: serde_json::Value = decision_result.unwrap().deserialize().unwrap();
        let round_id = decision_val["round_id"]
            .as_i64()
            .expect("round_id must be a number");

        // Call get_round_decisions
        let result = tauri::test::get_ipc_response(
            &wv,
            invoke_req(
                "get_round_decisions",
                serde_json::json!({
                    "slug": "test",
                    "stackId": stack_id,
                    "roundId": round_id
                }),
            ),
        );
        assert!(
            result.is_ok(),
            "get_round_decisions must succeed: {:?}",
            result
        );
        let val: serde_json::Value = result.unwrap().deserialize().unwrap();

        // Must be an array
        let arr = val
            .as_array()
            .expect("get_round_decisions must return an array");
        assert_eq!(
            arr.len(),
            lp_ids.len(),
            "get_round_decisions must return one entry per photo in the round"
        );

        // Verify shape of each entry matches PhotoDecisionStatus
        for entry in arr {
            assert!(
                entry["logical_photo_id"].is_number(),
                "logical_photo_id must be a number"
            );
            assert!(
                entry["current_status"].is_string(),
                "current_status must be a string"
            );
        }
    }

    #[test]
    fn test_ipc_commit_round_then_decision_goes_to_new_round() {
        // After commit_round creates Round 2, make_decision on a survivor
        // should succeed (goes to the new open round).
        let (_tmp, _app, wv, stack_id, lp_ids) = setup_ipc_with_photos(2);

        // Step 1: Make a keep decision on the first photo (this auto-creates Round 1)
        let decision_result = tauri::test::get_ipc_response(
            &wv,
            invoke_req(
                "make_decision",
                serde_json::json!({
                    "slug": "test",
                    "logicalPhotoId": lp_ids[0],
                    "action": "keep"
                }),
            ),
        );
        assert!(
            decision_result.is_ok(),
            "first make_decision must succeed: {:?}",
            decision_result
        );

        // Step 2: Commit the round (creates Round 2 with survivors)
        let commit_result = tauri::test::get_ipc_response(
            &wv,
            invoke_req(
                "commit_round",
                serde_json::json!({ "slug": "test", "stackId": stack_id }),
            ),
        );
        assert!(
            commit_result.is_ok(),
            "commit_round must succeed: {:?}",
            commit_result
        );

        // Step 3: Decision on the same photo should succeed (goes to Round 2)
        let round2_decision = tauri::test::get_ipc_response(
            &wv,
            invoke_req(
                "make_decision",
                serde_json::json!({
                    "slug": "test",
                    "logicalPhotoId": lp_ids[0],
                    "action": "eliminate"
                }),
            ),
        );
        assert!(
            round2_decision.is_ok(),
            "make_decision after commit must succeed on new round: {:?}",
            round2_decision
        );
    }

    // ── New IPC contract tests for previously uncovered commands ──────────────

    #[test]
    fn test_ipc_suggest_slug_json_shape() {
        // Contract test: suggest_slug returns a string slug derived from the name.
        // TypeScript: suggestSlug(name: string) => Promise<string>
        let (_tmp, home) = setup_ipc_home();

        let app = make_app(home);
        let wv = make_webview(&app);

        let result = tauri::test::get_ipc_response(
            &wv,
            invoke_req(
                "suggest_slug",
                serde_json::json!({ "name": "My Wedding Shoot" }),
            ),
        );
        assert!(result.is_ok(), "suggest_slug must succeed: {:?}", result);
        let val: serde_json::Value = result.unwrap().deserialize().unwrap();
        assert!(val.is_string(), "suggest_slug must return a string");
        let slug_str = val.as_str().unwrap();
        assert!(!slug_str.is_empty(), "slug must not be empty");
        // Slug should be URL-safe (no spaces, lowercase)
        assert!(
            !slug_str.contains(' '),
            "slug must not contain spaces, got: {}",
            slug_str
        );
    }

    #[test]
    fn test_ipc_suggest_slug_avoids_collision() {
        // Contract test: suggest_slug avoids collisions with existing project slugs.
        let (_tmp, home) = setup_ipc_home();
        // Create a project with slug "test" to force collision avoidance
        create_project_on_disk(&home, "Test", "test");

        let app = make_app(home);
        let wv = make_webview(&app);

        let result = tauri::test::get_ipc_response(
            &wv,
            invoke_req("suggest_slug", serde_json::json!({ "name": "Test" })),
        );
        assert!(result.is_ok(), "suggest_slug must succeed");
        let val: serde_json::Value = result.unwrap().deserialize().unwrap();
        let slug_str = val.as_str().unwrap();
        assert_ne!(
            slug_str, "test",
            "suggest_slug must avoid collision with existing slug 'test', got: {}",
            slug_str
        );
    }

    #[test]
    fn test_ipc_create_project_json_shape() {
        // Contract test: create_project returns JSON matching TypeScript Project interface.
        // TypeScript: { id: number, name: string, slug: string, created_at: string, last_opened_at: string | null }
        let (_tmp, home) = setup_ipc_home();

        let app = make_app(home);
        let wv = make_webview(&app);

        let result = tauri::test::get_ipc_response(
            &wv,
            invoke_req(
                "create_project",
                serde_json::json!({ "name": "My Test Project" }),
            ),
        );
        assert!(result.is_ok(), "create_project must succeed: {:?}", result);
        let val: serde_json::Value = result.unwrap().deserialize().unwrap();

        // Verify JSON shape matches TypeScript Project interface
        assert!(val["id"].is_number(), "id must be a number");
        assert!(val["name"].is_string(), "name must be a string");
        assert_eq!(
            val["name"].as_str().unwrap(),
            "My Test Project",
            "name must match input"
        );
        assert!(val["slug"].is_string(), "slug must be a string");
        assert!(
            !val["slug"].as_str().unwrap().is_empty(),
            "slug must not be empty"
        );
        assert!(val["created_at"].is_string(), "created_at must be a string");
        // last_opened_at can be null or string
        assert!(
            val["last_opened_at"].is_null() || val["last_opened_at"].is_string(),
            "last_opened_at must be null or string"
        );
    }

    #[test]
    fn test_ipc_delete_project_removes_from_list() {
        // Contract test: delete_project succeeds and the project is no longer
        // returned by list_projects.
        // TypeScript: deleteProject(slug: string) => Promise<void>
        let (_tmp, home) = setup_ipc_home();
        create_project_on_disk(&home, "ToDelete", "to-delete");

        let app = make_app(home);
        let wv = make_webview(&app);

        // Verify project exists before delete
        let list_before =
            tauri::test::get_ipc_response(&wv, invoke_req("list_projects", serde_json::json!({})));
        assert!(list_before.is_ok(), "list_projects must succeed");
        let before_val: serde_json::Value = list_before.unwrap().deserialize().unwrap();
        assert_eq!(
            before_val.as_array().unwrap().len(),
            1,
            "must have 1 project before delete"
        );

        // Delete the project
        let delete_result = tauri::test::get_ipc_response(
            &wv,
            invoke_req("delete_project", serde_json::json!({ "slug": "to-delete" })),
        );
        assert!(
            delete_result.is_ok(),
            "delete_project must succeed: {:?}",
            delete_result
        );

        // Verify project is gone
        let list_after =
            tauri::test::get_ipc_response(&wv, invoke_req("list_projects", serde_json::json!({})));
        assert!(
            list_after.is_ok(),
            "list_projects must succeed after delete"
        );
        let after_val: serde_json::Value = list_after.unwrap().deserialize().unwrap();
        assert_eq!(
            after_val.as_array().unwrap().len(),
            0,
            "must have 0 projects after delete"
        );
    }

    #[test]
    fn test_ipc_delete_project_nonexistent_returns_error() {
        // Contract test: delete_project on a nonexistent slug returns an error.
        let (_tmp, home) = setup_ipc_home();

        let app = make_app(home);
        let wv = make_webview(&app);

        let result = tauri::test::get_ipc_response(
            &wv,
            invoke_req(
                "delete_project",
                serde_json::json!({ "slug": "nonexistent" }),
            ),
        );
        assert!(
            result.is_err(),
            "delete_project on nonexistent slug must return error"
        );
    }

    #[test]
    fn test_ipc_cancel_indexing_succeeds() {
        // Contract test: cancel_indexing sets the cancellation flag.
        // TypeScript: cancelIndexing() => Promise<void>
        // cancel_indexing returns () and must not error.
        let (_tmp, home) = setup_ipc_home();

        let app = make_app(home);
        let wv = make_webview(&app);

        let result = tauri::test::get_ipc_response(
            &wv,
            invoke_req("cancel_indexing", serde_json::json!({ "slug": "test" })),
        );
        assert!(result.is_ok(), "cancel_indexing must succeed: {:?}", result);
    }

    #[test]
    fn test_ipc_pause_indexing_sets_paused_flag() {
        // Contract test: pause_indexing succeeds and get_indexing_status reflects paused=true.
        // TypeScript: pauseIndexing() => Promise<void>
        let (_tmp, home) = setup_ipc_home();

        let app = make_app(home);
        let wv = make_webview(&app);

        // Call pause_indexing
        let pause_result = tauri::test::get_ipc_response(
            &wv,
            invoke_req("pause_indexing", serde_json::json!({ "slug": "test" })),
        );
        assert!(
            pause_result.is_ok(),
            "pause_indexing must succeed: {:?}",
            pause_result
        );

        // Verify that get_indexing_status now shows paused=true
        let status_result = tauri::test::get_ipc_response(
            &wv,
            invoke_req("get_indexing_status", serde_json::json!({ "slug": "test" })),
        );
        assert!(status_result.is_ok(), "get_indexing_status must succeed");
        let status: serde_json::Value = status_result.unwrap().deserialize().unwrap();
        assert_eq!(
            status["paused"].as_bool(),
            Some(true),
            "paused must be true after pause_indexing"
        );
    }

    #[test]
    fn test_ipc_resume_indexing_clears_paused_flag() {
        // Contract test: resume_indexing clears paused flag.
        // TypeScript: resumeIndexing() => Promise<void>
        let (_tmp, home) = setup_ipc_home();

        let app = make_app(home);
        let wv = make_webview(&app);

        // First pause
        let pause_result = tauri::test::get_ipc_response(
            &wv,
            invoke_req("pause_indexing", serde_json::json!({ "slug": "test" })),
        );
        assert!(pause_result.is_ok(), "pause_indexing must succeed");

        // Then resume
        let resume_result = tauri::test::get_ipc_response(
            &wv,
            invoke_req("resume_indexing", serde_json::json!({ "slug": "test" })),
        );
        assert!(
            resume_result.is_ok(),
            "resume_indexing must succeed: {:?}",
            resume_result
        );

        // Verify paused=false
        let status_result = tauri::test::get_ipc_response(
            &wv,
            invoke_req("get_indexing_status", serde_json::json!({ "slug": "test" })),
        );
        assert!(status_result.is_ok(), "get_indexing_status must succeed");
        let status: serde_json::Value = status_result.unwrap().deserialize().unwrap();
        assert_eq!(
            status["paused"].as_bool(),
            Some(false),
            "paused must be false after resume_indexing"
        );
    }

    #[test]
    fn test_ipc_restack_on_project_with_photos() {
        // Contract test: restack succeeds on a project with indexed photos.
        // TypeScript: restack(slug: string) => Promise<void>
        let tmp = TempDir::new().unwrap();
        let home = setup_project_with_photos(&tmp, 3);
        let app = make_app(home);
        let wv = make_webview(&app);

        // Open project
        let open_result = tauri::test::get_ipc_response(
            &wv,
            invoke_req("open_project", serde_json::json!({ "slug": "test" })),
        );
        assert!(open_result.is_ok(), "open_project must succeed");

        // Restack
        let result = tauri::test::get_ipc_response(
            &wv,
            invoke_req("restack", serde_json::json!({ "slug": "test" })),
        );
        assert!(result.is_ok(), "restack must succeed: {:?}", result);

        // Verify stacks still exist after restack
        let stacks_result = tauri::test::get_ipc_response(
            &wv,
            invoke_req("list_stacks", serde_json::json!({ "slug": "test" })),
        );
        assert!(
            stacks_result.is_ok(),
            "list_stacks must succeed after restack"
        );
        let stacks: serde_json::Value = stacks_result.unwrap().deserialize().unwrap();
        assert!(
            !stacks.as_array().unwrap().is_empty(),
            "stacks must not be empty after restack"
        );
    }

    #[test]
    fn test_ipc_list_stacks_json_shape_with_data() {
        // Contract test: verify list_stacks returns JSON matching TypeScript StackSummary
        // interface when there is actual data (complements ipc_list_stacks_empty_project
        // which only tests the empty case).
        // TypeScript: { stack_id: number, logical_photo_count: number,
        //   earliest_capture: string | null, has_raw: boolean, has_jpeg: boolean,
        //   thumbnail_path: string | null }
        let tmp = TempDir::new().unwrap();
        let home = setup_project_with_photos(&tmp, 2);
        let app = make_app(home);
        let wv = make_webview(&app);

        // Open project
        let open_result = tauri::test::get_ipc_response(
            &wv,
            invoke_req("open_project", serde_json::json!({ "slug": "test" })),
        );
        assert!(open_result.is_ok(), "open_project must succeed");

        // list_stacks
        let result = tauri::test::get_ipc_response(
            &wv,
            invoke_req("list_stacks", serde_json::json!({ "slug": "test" })),
        );
        assert!(result.is_ok(), "list_stacks must succeed: {:?}", result);
        let val: serde_json::Value = result.unwrap().deserialize().unwrap();
        let stacks = val.as_array().expect("list_stacks must return an array");
        assert!(!stacks.is_empty(), "must have at least one stack");

        // Verify JSON shape of each stack matches TypeScript StackSummary
        for stack in stacks {
            assert!(stack["stack_id"].is_number(), "stack_id must be a number");
            assert!(
                stack["logical_photo_count"].is_number(),
                "logical_photo_count must be a number"
            );
            assert!(
                stack["earliest_capture"].is_null() || stack["earliest_capture"].is_string(),
                "earliest_capture must be null or string"
            );
            assert!(stack["has_raw"].is_boolean(), "has_raw must be a boolean");
            assert!(stack["has_jpeg"].is_boolean(), "has_jpeg must be a boolean");
            assert!(
                stack["thumbnail_path"].is_null() || stack["thumbnail_path"].is_string(),
                "thumbnail_path must be null or string"
            );
        }
    }

    #[test]
    fn test_ipc_undo_last_merge_after_merge() {
        // Contract test: undo_last_merge succeeds after a merge and restores
        // the original stacks.
        // TypeScript: undoLastMerge(slug: string) => Promise<void>
        let tmp = TempDir::new().unwrap();
        let home = setup_project_with_photos(&tmp, 4);
        let app = make_app(home);
        let wv = make_webview(&app);

        // Open project
        let open_result = tauri::test::get_ipc_response(
            &wv,
            invoke_req("open_project", serde_json::json!({ "slug": "test" })),
        );
        assert!(open_result.is_ok(), "open_project must succeed");

        // Get stacks
        let stacks_result = tauri::test::get_ipc_response(
            &wv,
            invoke_req("list_stacks", serde_json::json!({ "slug": "test" })),
        );
        let stacks: serde_json::Value = stacks_result.unwrap().deserialize().unwrap();
        let stacks_arr = stacks.as_array().unwrap();
        let original_count = stacks_arr.len();

        // We need at least 2 stacks to merge. If only 1 exists, get 2 logical
        // photo IDs from it — but merge_stacks expects stack_ids. If there's
        // only one stack, create a second one by direct DB manipulation isn't
        // possible through IPC. Instead, use the same stack_id twice which
        // the merge command should handle (or error). The important thing is
        // verifying the undo contract shape.
        let sid1 = stacks_arr
            .first()
            .and_then(|s| s["stack_id"].as_i64())
            .unwrap();

        if stacks_arr.len() >= 2 {
            let sid2 = stacks_arr[1]["stack_id"].as_i64().unwrap();

            // Merge the two stacks
            let merge_result = tauri::test::get_ipc_response(
                &wv,
                invoke_req(
                    "merge_stacks",
                    serde_json::json!({ "slug": "test", "stackIds": [sid1, sid2] }),
                ),
            );
            assert!(
                merge_result.is_ok(),
                "merge_stacks must succeed: {:?}",
                merge_result
            );

            // Undo the merge
            let undo_result = tauri::test::get_ipc_response(
                &wv,
                invoke_req("undo_last_merge", serde_json::json!({ "slug": "test" })),
            );
            assert!(
                undo_result.is_ok(),
                "undo_last_merge must succeed: {:?}",
                undo_result
            );

            // Verify stacks are restored
            let stacks_after = tauri::test::get_ipc_response(
                &wv,
                invoke_req("list_stacks", serde_json::json!({ "slug": "test" })),
            );
            let after_val: serde_json::Value = stacks_after.unwrap().deserialize().unwrap();
            assert_eq!(
                after_val.as_array().unwrap().len(),
                original_count,
                "stack count must be restored after undo_last_merge"
            );
        } else {
            // Only 1 stack — undo_last_merge with no prior merge should error
            let undo_result = tauri::test::get_ipc_response(
                &wv,
                invoke_req("undo_last_merge", serde_json::json!({ "slug": "test" })),
            );
            assert!(
                undo_result.is_err(),
                "undo_last_merge with no prior merge must return error"
            );
        }
    }

    #[test]
    fn test_ipc_list_stack_transactions_json_shape() {
        // Contract test: list_stack_transactions returns JSON matching TypeScript
        // StackTransaction[] interface.
        // TypeScript: { id: number, project_id: number, action: string,
        //   details: string, created_at: string }
        let tmp = TempDir::new().unwrap();
        let home = setup_project_with_photos(&tmp, 4);
        let app = make_app(home);
        let wv = make_webview(&app);

        // Open project
        let open_result = tauri::test::get_ipc_response(
            &wv,
            invoke_req("open_project", serde_json::json!({ "slug": "test" })),
        );
        assert!(open_result.is_ok(), "open_project must succeed");

        // First call with no merges — should return an array (possibly with import transactions)
        let result = tauri::test::get_ipc_response(
            &wv,
            invoke_req(
                "list_stack_transactions",
                serde_json::json!({ "slug": "test" }),
            ),
        );
        assert!(
            result.is_ok(),
            "list_stack_transactions must succeed: {:?}",
            result
        );
        let val: serde_json::Value = result.unwrap().deserialize().unwrap();
        let txns = val
            .as_array()
            .expect("list_stack_transactions must return an array");

        // If there are transactions (e.g., from import), verify their shape
        for txn in txns {
            assert!(txn["id"].is_number(), "id must be a number");
            assert!(txn["project_id"].is_number(), "project_id must be a number");
            assert!(txn["action"].is_string(), "action must be a string");
            assert!(txn["details"].is_string(), "details must be a string");
            assert!(txn["created_at"].is_string(), "created_at must be a string");
        }

        // Now create a merge transaction to guarantee at least one entry
        let stacks_result = tauri::test::get_ipc_response(
            &wv,
            invoke_req("list_stacks", serde_json::json!({ "slug": "test" })),
        );
        let stacks: serde_json::Value = stacks_result.unwrap().deserialize().unwrap();
        let stacks_arr = stacks.as_array().unwrap();

        if stacks_arr.len() >= 2 {
            let sid1 = stacks_arr[0]["stack_id"].as_i64().unwrap();
            let sid2 = stacks_arr[1]["stack_id"].as_i64().unwrap();

            let merge_result = tauri::test::get_ipc_response(
                &wv,
                invoke_req(
                    "merge_stacks",
                    serde_json::json!({ "slug": "test", "stackIds": [sid1, sid2] }),
                ),
            );
            assert!(merge_result.is_ok(), "merge_stacks must succeed");

            // Now list_stack_transactions should have a merge entry
            let result2 = tauri::test::get_ipc_response(
                &wv,
                invoke_req(
                    "list_stack_transactions",
                    serde_json::json!({ "slug": "test" }),
                ),
            );
            assert!(result2.is_ok(), "list_stack_transactions must succeed");
            let val2: serde_json::Value = result2.unwrap().deserialize().unwrap();
            let txns2 = val2.as_array().unwrap();
            assert!(
                !txns2.is_empty(),
                "must have at least 1 transaction after merge"
            );

            // Verify shape of merge transaction
            let merge_txn = &txns2[0]; // newest first
            assert!(merge_txn["id"].is_number(), "id must be a number");
            assert!(
                merge_txn["project_id"].is_number(),
                "project_id must be a number"
            );
            assert_eq!(
                merge_txn["action"].as_str(),
                Some("merge"),
                "action must be 'merge'"
            );
            assert!(merge_txn["details"].is_string(), "details must be a string");
            assert!(
                merge_txn["created_at"].is_string(),
                "created_at must be a string"
            );
        }
    }

    #[test]
    fn test_ipc_undo_decision_after_keep() {
        // Contract test: undo_decision succeeds after make_decision and the
        // photo returns to "undecided" status.
        // TypeScript: undoDecision(slug: string, logicalPhotoId: number) => Promise<void>
        let (_tmp, _app, wv, _stack_id, lp_ids) = setup_ipc_with_photos(2);
        let lp_id = lp_ids[0];

        // Make a decision
        let decision_result = tauri::test::get_ipc_response(
            &wv,
            invoke_req(
                "make_decision",
                serde_json::json!({
                    "slug": "test",
                    "logicalPhotoId": lp_id,
                    "action": "keep"
                }),
            ),
        );
        assert!(
            decision_result.is_ok(),
            "make_decision must succeed: {:?}",
            decision_result
        );

        // Verify photo is now "keep"
        let detail_result = tauri::test::get_ipc_response(
            &wv,
            invoke_req(
                "get_photo_detail",
                serde_json::json!({ "slug": "test", "logicalPhotoId": lp_id }),
            ),
        );
        let detail: serde_json::Value = detail_result.unwrap().deserialize().unwrap();
        assert_eq!(
            detail["current_status"].as_str(),
            Some("keep"),
            "photo must be 'keep' after make_decision"
        );

        // Undo the decision
        let undo_result = tauri::test::get_ipc_response(
            &wv,
            invoke_req(
                "undo_decision",
                serde_json::json!({ "slug": "test", "logicalPhotoId": lp_id }),
            ),
        );
        assert!(
            undo_result.is_ok(),
            "undo_decision must succeed: {:?}",
            undo_result
        );

        // Verify photo is back to "undecided"
        let detail_after = tauri::test::get_ipc_response(
            &wv,
            invoke_req(
                "get_photo_detail",
                serde_json::json!({ "slug": "test", "logicalPhotoId": lp_id }),
            ),
        );
        let detail_val: serde_json::Value = detail_after.unwrap().deserialize().unwrap();
        assert_eq!(
            detail_val["current_status"].as_str(),
            Some("undecided"),
            "photo must be 'undecided' after undo_decision"
        );
    }

    #[test]
    fn test_ipc_open_project_json_shape() {
        // Contract test: open_project returns JSON matching TypeScript Project interface.
        // Existing tests use open_project but don't fully verify all fields.
        // TypeScript: { id: number, name: string, slug: string, created_at: string, last_opened_at: string | null }
        let (_tmp, home) = setup_ipc_home();
        create_project_on_disk(&home, "Shape Test", "shape-test");

        let app = make_app(home);
        let wv = make_webview(&app);

        let result = tauri::test::get_ipc_response(
            &wv,
            invoke_req("open_project", serde_json::json!({ "slug": "shape-test" })),
        );
        assert!(result.is_ok(), "open_project must succeed: {:?}", result);
        let val: serde_json::Value = result.unwrap().deserialize().unwrap();

        assert!(val["id"].is_number(), "id must be a number");
        assert_eq!(val["name"].as_str(), Some("Shape Test"), "name must match");
        assert_eq!(val["slug"].as_str(), Some("shape-test"), "slug must match");
        assert!(val["created_at"].is_string(), "created_at must be a string");
        assert!(
            val["last_opened_at"].is_null() || val["last_opened_at"].is_string(),
            "last_opened_at must be null or string"
        );
    }

    #[test]
    fn test_ipc_list_projects_json_shape() {
        // Contract test: list_projects returns JSON array where each item matches
        // TypeScript Project interface. Existing tests verify length and slug but
        // not all fields.
        let (_tmp, home) = setup_ipc_home();
        create_project_on_disk(&home, "Alpha", "alpha");
        create_project_on_disk(&home, "Beta", "beta");

        let app = make_app(home);
        let wv = make_webview(&app);

        let result =
            tauri::test::get_ipc_response(&wv, invoke_req("list_projects", serde_json::json!({})));
        assert!(result.is_ok(), "list_projects must succeed");
        let val: serde_json::Value = result.unwrap().deserialize().unwrap();
        let projects = val.as_array().expect("must return an array");
        assert_eq!(projects.len(), 2, "must have 2 projects");

        for project in projects {
            assert!(project["id"].is_number(), "id must be a number");
            assert!(project["name"].is_string(), "name must be a string");
            assert!(project["slug"].is_string(), "slug must be a string");
            assert!(
                project["created_at"].is_string(),
                "created_at must be a string"
            );
            assert!(
                project["last_opened_at"].is_null() || project["last_opened_at"].is_string(),
                "last_opened_at must be null or string"
            );
        }
    }

    // ── Round-commit: list_logical_photos with roundId ─────────────────────

    #[test]
    fn test_ipc_list_logical_photos_with_round_id_returns_only_round_photos() {
        // B3: list_logical_photos with roundId returns only the round's photos.
        // After committing Round 1, Round 2 has fewer photos (survivors only).
        //
        // THIS WILL FAIL because list_logical_photos has no roundId parameter.
        //
        // Setup: use multiple single-photo stacks, merge them into one, then
        // test round-scoped listing. Since setup_ipc_with_photos creates
        // EXIF-less photos (each in its own stack), we merge 3 stacks into 1.
        let tmp = TempDir::new().unwrap();
        let home = setup_project_with_photos(&tmp, 3);
        let app = make_app(home);
        let wv = make_webview(&app);

        // Open project
        let open_result = tauri::test::get_ipc_response(
            &wv,
            invoke_req("open_project", serde_json::json!({ "slug": "test" })),
        );
        assert!(open_result.is_ok(), "open_project must succeed");

        // Get all stacks
        let stacks_result = tauri::test::get_ipc_response(
            &wv,
            invoke_req("list_stacks", serde_json::json!({ "slug": "test" })),
        );
        let stacks: serde_json::Value = stacks_result.unwrap().deserialize().unwrap();
        let stacks_arr = stacks.as_array().unwrap();
        assert!(
            stacks_arr.len() >= 3,
            "need at least 3 stacks for merge, got {}",
            stacks_arr.len()
        );
        let stack_ids: Vec<i64> = stacks_arr
            .iter()
            .map(|s| s["stack_id"].as_i64().unwrap())
            .collect();

        // Merge all stacks into one
        let merge_result = tauri::test::get_ipc_response(
            &wv,
            invoke_req(
                "merge_stacks",
                serde_json::json!({ "slug": "test", "stackIds": stack_ids }),
            ),
        );
        assert!(
            merge_result.is_ok(),
            "merge_stacks must succeed: {:?}",
            merge_result
        );
        let merge_val: serde_json::Value = merge_result.unwrap().deserialize().unwrap();
        let merged_stack_id = merge_val["merged_stack_id"].as_i64().unwrap();

        // Get all logical photos in the merged stack
        let lp_result = tauri::test::get_ipc_response(
            &wv,
            invoke_req(
                "list_logical_photos",
                serde_json::json!({ "slug": "test", "stackId": merged_stack_id }),
            ),
        );
        let lps: serde_json::Value = lp_result.unwrap().deserialize().unwrap();
        let lp_ids: Vec<i64> = lps
            .as_array()
            .unwrap()
            .iter()
            .map(|lp| lp["logical_photo_id"].as_i64().unwrap())
            .collect();
        assert_eq!(lp_ids.len(), 3, "merged stack must have 3 logical photos");

        // Make decisions: keep, eliminate, keep
        for (i, action) in ["keep", "eliminate", "keep"].iter().enumerate() {
            let result = tauri::test::get_ipc_response(
                &wv,
                invoke_req(
                    "make_decision",
                    serde_json::json!({
                        "slug": "test",
                        "logicalPhotoId": lp_ids[i],
                        "action": action
                    }),
                ),
            );
            assert!(result.is_ok(), "make_decision({}) must succeed", action);
        }

        // Commit round
        let commit_result = tauri::test::get_ipc_response(
            &wv,
            invoke_req(
                "commit_round",
                serde_json::json!({ "slug": "test", "stackId": merged_stack_id }),
            ),
        );
        assert!(commit_result.is_ok(), "commit_round must succeed");

        // Get new round ID
        let round_after = tauri::test::get_ipc_response(
            &wv,
            invoke_req(
                "get_round_status",
                serde_json::json!({ "slug": "test", "stackId": merged_stack_id }),
            ),
        );
        let round_after_val: serde_json::Value = round_after.unwrap().deserialize().unwrap();
        let round2_id = round_after_val["round_id"].as_i64().unwrap();

        // Call list_logical_photos WITH roundId parameter
        // THIS IS THE KEY ASSERTION: the roundId parameter must filter results
        let lp_result2 = tauri::test::get_ipc_response(
            &wv,
            invoke_req(
                "list_logical_photos",
                serde_json::json!({
                    "slug": "test",
                    "stackId": merged_stack_id,
                    "roundId": round2_id
                }),
            ),
        );
        assert!(
            lp_result2.is_ok(),
            "list_logical_photos with roundId must succeed: {:?}",
            lp_result2.err()
        );
        let lp_val: serde_json::Value = lp_result2.unwrap().deserialize().unwrap();
        let photos = lp_val.as_array().expect("must return an array");

        // Round 2 should only have 2 survivors (the eliminated photo excluded)
        assert_eq!(
            photos.len(),
            2,
            "list_logical_photos with roundId must return only 2 survivors, got {}",
            photos.len()
        );

        // Verify the eliminated photo (lp_ids[1]) is NOT in the results
        let returned_ids: Vec<i64> = photos
            .iter()
            .map(|p| p["logical_photo_id"].as_i64().unwrap())
            .collect();
        assert!(
            !returned_ids.contains(&lp_ids[1]),
            "eliminated photo {} must not appear in round-scoped results, got {:?}",
            lp_ids[1],
            returned_ids
        );
    }

    #[test]
    fn test_ipc_commit_then_list_fewer_photos_end_to_end() {
        // B4: commit -> list_logical_photos -> fewer photos end-to-end.
        // After commit, list_logical_photos with roundId returns fewer photos.
        //
        // THIS WILL FAIL because list_logical_photos ignores round_photos/roundId.
        let tmp = TempDir::new().unwrap();
        let home = setup_project_with_photos(&tmp, 3);
        let app = make_app(home);
        let wv = make_webview(&app);

        // Open project
        let open_result = tauri::test::get_ipc_response(
            &wv,
            invoke_req("open_project", serde_json::json!({ "slug": "test" })),
        );
        assert!(open_result.is_ok(), "open_project must succeed");

        // Get stacks and merge them into one
        let stacks_result = tauri::test::get_ipc_response(
            &wv,
            invoke_req("list_stacks", serde_json::json!({ "slug": "test" })),
        );
        let stacks: serde_json::Value = stacks_result.unwrap().deserialize().unwrap();
        let stack_ids: Vec<i64> = stacks
            .as_array()
            .unwrap()
            .iter()
            .map(|s| s["stack_id"].as_i64().unwrap())
            .collect();

        let merge_result = tauri::test::get_ipc_response(
            &wv,
            invoke_req(
                "merge_stacks",
                serde_json::json!({ "slug": "test", "stackIds": stack_ids }),
            ),
        );
        assert!(merge_result.is_ok(), "merge_stacks must succeed");
        let merge_val: serde_json::Value = merge_result.unwrap().deserialize().unwrap();
        let stack_id = merge_val["merged_stack_id"].as_i64().unwrap();

        // Get logical photo IDs
        let lp_result = tauri::test::get_ipc_response(
            &wv,
            invoke_req(
                "list_logical_photos",
                serde_json::json!({ "slug": "test", "stackId": stack_id }),
            ),
        );
        let lps: serde_json::Value = lp_result.unwrap().deserialize().unwrap();
        let lp_ids: Vec<i64> = lps
            .as_array()
            .unwrap()
            .iter()
            .map(|lp| lp["logical_photo_id"].as_i64().unwrap())
            .collect();
        assert_eq!(lp_ids.len(), 3, "merged stack must have 3 photos");

        // Make decisions: keep, eliminate, keep
        for (i, action) in ["keep", "eliminate", "keep"].iter().enumerate() {
            let result = tauri::test::get_ipc_response(
                &wv,
                invoke_req(
                    "make_decision",
                    serde_json::json!({
                        "slug": "test",
                        "logicalPhotoId": lp_ids[i],
                        "action": action
                    }),
                ),
            );
            assert!(result.is_ok(), "make_decision must succeed");
        }

        // Commit round
        let commit_result = tauri::test::get_ipc_response(
            &wv,
            invoke_req(
                "commit_round",
                serde_json::json!({ "slug": "test", "stackId": stack_id }),
            ),
        );
        assert!(commit_result.is_ok(), "commit_round must succeed");

        // Get new round ID
        let round_result = tauri::test::get_ipc_response(
            &wv,
            invoke_req(
                "get_round_status",
                serde_json::json!({ "slug": "test", "stackId": stack_id }),
            ),
        );
        let round_val: serde_json::Value = round_result.unwrap().deserialize().unwrap();
        let new_round_id = round_val["round_id"].as_i64().unwrap();

        // list_logical_photos with roundId should return 2 survivors
        let lp_result2 = tauri::test::get_ipc_response(
            &wv,
            invoke_req(
                "list_logical_photos",
                serde_json::json!({
                    "slug": "test",
                    "stackId": stack_id,
                    "roundId": new_round_id
                }),
            ),
        );
        assert!(
            lp_result2.is_ok(),
            "list_logical_photos after commit must succeed: {:?}",
            lp_result2.err()
        );
        let lp_val: serde_json::Value = lp_result2.unwrap().deserialize().unwrap();
        let photos = lp_val.as_array().expect("must be array");
        assert_eq!(
            photos.len(),
            2,
            "after commit, list_logical_photos with roundId must return 2 survivors, got {}",
            photos.len()
        );

        // All survivors must be undecided
        for photo in photos {
            let detail_result = tauri::test::get_ipc_response(
                &wv,
                invoke_req(
                    "get_photo_detail",
                    serde_json::json!({
                        "slug": "test",
                        "logicalPhotoId": photo["logical_photo_id"].as_i64().unwrap()
                    }),
                ),
            );
            let detail: serde_json::Value = detail_result.unwrap().deserialize().unwrap();
            assert_eq!(
                detail["current_status"].as_str(),
                Some("undecided"),
                "survivor photo {} must be undecided after commit",
                photo["logical_photo_id"]
            );
        }
    }

    #[test]
    fn test_ipc_list_logical_photos_round_id_contract() {
        // B-contract-1: IPC contract test for list_logical_photos with roundId.
        // After committing a round where one photo was eliminated, calling
        // list_logical_photos with the new round's ID must return ONLY the
        // survivors (fewer photos than the stack total).
        //
        // THIS WILL FAIL because list_logical_photos ignores roundId and
        // returns ALL photos in the stack regardless of round membership.
        let tmp = TempDir::new().unwrap();
        let home = setup_project_with_photos(&tmp, 2);
        let app = make_app(home);
        let wv = make_webview(&app);

        // Open project
        let open_result = tauri::test::get_ipc_response(
            &wv,
            invoke_req("open_project", serde_json::json!({ "slug": "test" })),
        );
        assert!(open_result.is_ok(), "open_project must succeed");

        // Get stacks and merge into one
        let stacks_result = tauri::test::get_ipc_response(
            &wv,
            invoke_req("list_stacks", serde_json::json!({ "slug": "test" })),
        );
        let stacks: serde_json::Value = stacks_result.unwrap().deserialize().unwrap();
        let stack_ids: Vec<i64> = stacks
            .as_array()
            .unwrap()
            .iter()
            .map(|s| s["stack_id"].as_i64().unwrap())
            .collect();
        assert!(
            stack_ids.len() >= 2,
            "need 2+ stacks to merge, got {}",
            stack_ids.len()
        );

        let merge_result = tauri::test::get_ipc_response(
            &wv,
            invoke_req(
                "merge_stacks",
                serde_json::json!({ "slug": "test", "stackIds": stack_ids }),
            ),
        );
        assert!(merge_result.is_ok(), "merge_stacks must succeed");
        let merge_val: serde_json::Value = merge_result.unwrap().deserialize().unwrap();
        let stack_id = merge_val["merged_stack_id"].as_i64().unwrap();

        // Get logical photo IDs
        let lp_result = tauri::test::get_ipc_response(
            &wv,
            invoke_req(
                "list_logical_photos",
                serde_json::json!({ "slug": "test", "stackId": stack_id }),
            ),
        );
        let lps: serde_json::Value = lp_result.unwrap().deserialize().unwrap();
        let lp_ids: Vec<i64> = lps
            .as_array()
            .unwrap()
            .iter()
            .map(|lp| lp["logical_photo_id"].as_i64().unwrap())
            .collect();
        assert_eq!(lp_ids.len(), 2, "merged stack must have 2 photos");

        // Keep first, eliminate second
        let _ = tauri::test::get_ipc_response(
            &wv,
            invoke_req(
                "make_decision",
                serde_json::json!({ "slug": "test", "logicalPhotoId": lp_ids[0], "action": "keep" }),
            ),
        );
        let _ = tauri::test::get_ipc_response(
            &wv,
            invoke_req(
                "make_decision",
                serde_json::json!({ "slug": "test", "logicalPhotoId": lp_ids[1], "action": "eliminate" }),
            ),
        );

        // Commit
        let commit_result = tauri::test::get_ipc_response(
            &wv,
            invoke_req(
                "commit_round",
                serde_json::json!({ "slug": "test", "stackId": stack_id }),
            ),
        );
        assert!(commit_result.is_ok(), "commit_round must succeed");

        // Get Round 2 ID
        let round_result = tauri::test::get_ipc_response(
            &wv,
            invoke_req(
                "get_round_status",
                serde_json::json!({ "slug": "test", "stackId": stack_id }),
            ),
        );
        let round_val: serde_json::Value = round_result.unwrap().deserialize().unwrap();
        let round2_id = round_val["round_id"].as_i64().unwrap();

        // Contract assertion: list_logical_photos with roundId must return
        // ONLY photos in that round (1 survivor), not all 2 stack photos
        let result = tauri::test::get_ipc_response(
            &wv,
            invoke_req(
                "list_logical_photos",
                serde_json::json!({
                    "slug": "test",
                    "stackId": stack_id,
                    "roundId": round2_id
                }),
            ),
        );
        assert!(
            result.is_ok(),
            "list_logical_photos with roundId must succeed: {:?}",
            result.err()
        );
        let val: serde_json::Value = result.unwrap().deserialize().unwrap();
        let photos = val.as_array().expect("must return an array");

        // THIS IS THE RED ASSERTION: must return 1 (survivor count), not 2 (stack total)
        assert_eq!(
            photos.len(),
            1,
            "list_logical_photos with roundId must return only 1 survivor (round-scoped), got {} (stack-scoped)",
            photos.len()
        );

        // Shape validation
        let photo = &photos[0];
        assert!(
            photo["logical_photo_id"].is_number(),
            "logical_photo_id must be a number"
        );
        assert!(photo["has_jpeg"].is_boolean(), "has_jpeg must be a boolean");
        assert!(photo["has_raw"].is_boolean(), "has_raw must be a boolean");
    }

    // NOTE: start_indexing and resume_thumbnails are NOT tested here because they
    // require a real `tauri::AppHandle` for event emission and spawn background
    // threads. The Tauri mock runtime provides an AppHandle but the async thread
    // spawning + event emission makes these commands non-deterministic in tests.
    // They are covered by the existing E2E Playwright tests and manual testing.

    #[test]
    fn test_ipc_restore_eliminated_photo_json_shape() {
        // F4-10: Contract test — verify restore_eliminated_photo returns JSON
        // matching the TypeScript RestoreResult interface:
        // { restored: boolean, logical_photo_id: number, round_id: number }
        let (_tmp, _app, wv, stack_id, lp_ids) = setup_ipc_with_photos(3);
        let target_lp = lp_ids[0];

        // Step 1: Eliminate photo in R1
        let decide_result = tauri::test::get_ipc_response(
            &wv,
            invoke_req(
                "make_decision",
                serde_json::json!({
                    "slug": "test",
                    "logicalPhotoId": target_lp,
                    "action": "eliminate"
                }),
            ),
        );
        assert!(
            decide_result.is_ok(),
            "make_decision(eliminate) must succeed: {:?}",
            decide_result.err()
        );

        // Step 2: Keep remaining photos and commit
        for &lp_id in &lp_ids[1..] {
            let r = tauri::test::get_ipc_response(
                &wv,
                invoke_req(
                    "make_decision",
                    serde_json::json!({
                        "slug": "test",
                        "logicalPhotoId": lp_id,
                        "action": "keep"
                    }),
                ),
            );
            assert!(r.is_ok(), "make_decision(keep) must succeed");
        }

        let commit_result = tauri::test::get_ipc_response(
            &wv,
            invoke_req(
                "commit_round",
                serde_json::json!({ "slug": "test", "stackId": stack_id }),
            ),
        );
        assert!(
            commit_result.is_ok(),
            "commit_round must succeed: {:?}",
            commit_result.err()
        );

        // Step 3: Get the new round_id (R2) via get_round_status
        let status_result = tauri::test::get_ipc_response(
            &wv,
            invoke_req(
                "get_round_status",
                serde_json::json!({ "slug": "test", "stackId": stack_id }),
            ),
        );
        assert!(status_result.is_ok(), "get_round_status must succeed");
        let status_val: serde_json::Value = status_result.unwrap().deserialize().unwrap();
        let round2_id = status_val["round_id"].as_i64().unwrap();

        // Step 4: Restore the eliminated photo into R2
        let restore_result = tauri::test::get_ipc_response(
            &wv,
            invoke_req(
                "restore_eliminated_photo",
                serde_json::json!({
                    "slug": "test",
                    "logicalPhotoId": target_lp,
                    "roundId": round2_id
                }),
            ),
        );
        assert!(
            restore_result.is_ok(),
            "restore_eliminated_photo must succeed: {:?}",
            restore_result.err()
        );
        let val: serde_json::Value = restore_result.unwrap().deserialize().unwrap();

        // Verify JSON shape matches TypeScript RestoreResult interface
        assert!(
            val["restored"].is_boolean(),
            "restored must be a boolean, got {:?}",
            val["restored"]
        );
        assert!(
            val["logical_photo_id"].is_number(),
            "logical_photo_id must be a number, got {:?}",
            val["logical_photo_id"]
        );
        assert!(
            val["round_id"].is_number(),
            "round_id must be a number, got {:?}",
            val["round_id"]
        );

        // Verify semantic correctness
        assert_eq!(
            val["restored"], true,
            "first restore must return restored=true"
        );
        assert_eq!(
            val["logical_photo_id"], target_lp,
            "must return the correct photo id"
        );
        assert_eq!(
            val["round_id"], round2_id,
            "must return the target round id"
        );
    }
}
