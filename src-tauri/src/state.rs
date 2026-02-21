use crate::photos::model::IndexingStatus;
use crate::projects::model::Project;
use rusqlite::Connection;
use std::path::PathBuf;
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};

// LOCK ORDER: always lock `db` first, then `active_project`. Never reverse.
pub struct AppState {
    pub db: Mutex<Option<Connection>>,
    pub active_project: Mutex<Option<Project>>,
    pub gemkeep_home: PathBuf,
    /// Arc so it can be shared with the background indexing thread.
    pub indexing_status: Arc<Mutex<IndexingStatus>>,
    /// Set to true to signal the background thread to stop.
    pub cancel_indexing: Arc<AtomicBool>,
    /// Set to true to pause the background indexing thread.
    pub pause_indexing: Arc<AtomicBool>,
}

impl AppState {
    pub fn new(gemkeep_home: PathBuf) -> Self {
        Self {
            db: Mutex::new(None),
            active_project: Mutex::new(None),
            gemkeep_home,
            indexing_status: Arc::new(Mutex::new(IndexingStatus::default())),
            cancel_indexing: Arc::new(AtomicBool::new(false)),
            pause_indexing: Arc::new(AtomicBool::new(false)),
        }
    }
}
