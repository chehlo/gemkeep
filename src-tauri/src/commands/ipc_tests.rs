// src-tauri/src/commands/ipc_tests.rs
// Tauri IPC integration tests: test commands through the real Tauri dispatch layer.
// Catches bugs that pure Rust tests and mocked-frontend tests cannot:
// command registration, state passing through Tauri's managed-state system,
// and serialization of results.

#[cfg(test)]
mod tests {
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
}
