use crate::projects::model::Project;
use rusqlite::Connection;
use std::path::PathBuf;
use std::sync::Mutex;

// LOCK ORDER: always lock `db` first, then `active_project`. Never reverse.
pub struct AppState {
    pub db: Mutex<Option<Connection>>,
    pub active_project: Mutex<Option<Project>>,
    pub gemkeep_home: PathBuf,
}

impl AppState {
    pub fn new(gemkeep_home: PathBuf) -> Self {
        Self {
            db: Mutex::new(None),
            active_project: Mutex::new(None),
            gemkeep_home,
        }
    }
}
