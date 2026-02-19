pub mod commands;
pub mod db;
pub mod state;

use state::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tracing_subscriber::fmt::init();

    tauri::Builder::default()
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![commands::dev::ping])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
