pub mod commands;
pub mod db;
pub mod import;
pub mod photos;
pub mod projects;
pub mod state;

use projects::manager;
use state::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tracing_subscriber::fmt::init();
    let home = manager::gemkeep_home();
    std::fs::create_dir_all(home.join("projects")).expect("cannot create gemkeep home");
    tauri::Builder::default()
        .manage(AppState::new(home))
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
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
            commands::import::get_indexing_status,
            commands::import::list_stacks,
            commands::import::read_thumbnail,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
