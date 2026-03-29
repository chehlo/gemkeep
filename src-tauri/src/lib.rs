pub mod asset_scope_tests;
pub mod commands;
pub mod db;
pub mod decisions;
pub mod import;
pub mod photos;
pub mod projects;
pub mod state;

use projects::manager;
use state::AppState;

#[tauri::command]
fn toggle_devtools(window: tauri::WebviewWindow) {
    if window.is_devtools_open() {
        window.close_devtools();
    } else {
        window.open_devtools();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tracing_subscriber::fmt::init();
    let home = manager::gemkeep_home();
    std::fs::create_dir_all(home.join("projects")).expect("cannot create gemkeep home");
    tauri::Builder::default()
        .manage(AppState::new(home))
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            toggle_devtools,
            commands::projects::suggest_slug,
            commands::projects::create_project,
            commands::projects::list_projects,
            commands::projects::open_project,
            commands::projects::get_last_project,
            commands::projects::delete_project,
            commands::import::add_source_folder,
            commands::import::remove_source_folder,
            commands::import::list_source_folders,
            commands::import::start_indexing,
            commands::import::cancel_indexing,
            commands::import::pause_indexing,
            commands::import::resume_indexing,
            commands::import::get_indexing_status,
            commands::import::list_stacks,
            commands::import::list_logical_photos,
            commands::import::resume_thumbnails,
            commands::import::get_burst_gap,
            commands::import::set_burst_gap,
            commands::import::restack,
            commands::import::expand_source_scopes,
            commands::stacks::merge_stacks,
            commands::stacks::undo_last_merge,
            commands::stacks::list_stack_transactions,
            commands::decisions::make_decision,
            commands::decisions::undo_decision,
            commands::decisions::get_round_status,
            commands::decisions::get_stack_progress_batch,
            commands::decisions::commit_round,
            commands::decisions::get_photo_detail,
            commands::decisions::get_round_decisions,
            commands::decisions::list_rounds,
            commands::decisions::get_round_snapshot,
            commands::decisions::restore_eliminated_photo,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
