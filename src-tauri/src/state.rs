use crate::photos::model::IndexingStatus;
use crate::projects::model::Project;
use rusqlite::Connection;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicUsize};
use std::sync::{Arc, Mutex};

/// Per-project indexing context. Each project gets its own isolated set of
/// indexing state so that operations on one project do not interfere with another.
pub struct ProjectContext {
    pub indexing_status: Arc<Mutex<IndexingStatus>>,
    pub cancel_indexing: Arc<AtomicBool>,
    pub pause_indexing: Arc<AtomicBool>,
    pub thumbnails_done_counter: Arc<AtomicUsize>,
}

impl ProjectContext {
    pub fn new() -> Self {
        Self {
            indexing_status: Arc::new(Mutex::new(IndexingStatus::default())),
            cancel_indexing: Arc::new(AtomicBool::new(false)),
            pause_indexing: Arc::new(AtomicBool::new(false)),
            thumbnails_done_counter: Arc::new(AtomicUsize::new(0)),
        }
    }
}

// LOCK ORDER: always lock `db` first, then `active_project`, then `project_contexts`. Never reverse.
pub struct AppState {
    pub db: Mutex<Option<Connection>>,
    pub active_project: Mutex<Option<Project>>,
    pub gemkeep_home: PathBuf,
    /// Per-project indexing contexts. Keyed by project slug.
    project_contexts: Mutex<HashMap<String, Arc<ProjectContext>>>,
}

impl AppState {
    pub fn new(gemkeep_home: PathBuf) -> Self {
        Self {
            db: Mutex::new(None),
            active_project: Mutex::new(None),
            gemkeep_home,
            project_contexts: Mutex::new(HashMap::new()),
        }
    }

    /// Returns the `ProjectContext` for the given slug, creating one if it doesn't exist.
    pub fn get_or_create_context(&self, slug: &str) -> Arc<ProjectContext> {
        let mut contexts = self.project_contexts.lock().unwrap();
        contexts
            .entry(slug.to_string())
            .or_insert_with(|| Arc::new(ProjectContext::new()))
            .clone()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::Ordering;

    /// Two different project slugs must get independent contexts.
    /// Setting running=true on project-a must not affect project-b.
    #[test]
    fn test_indexing_status_is_isolated_per_project() {
        let state = AppState::new(PathBuf::from("/tmp/gemkeep-test"));

        let ctx_a = state.get_or_create_context("project-a");
        let ctx_b = state.get_or_create_context("project-b");

        // Simulate "project-a" starting indexing
        {
            let mut status = ctx_a.indexing_status.lock().unwrap();
            status.running = true;
            status.total = 100;
            status.processed = 50;
        }

        // project-b must still be idle
        let status_b = ctx_b.indexing_status.lock().unwrap();
        assert_eq!(
            status_b.running, false,
            "project-b should see running=false when only project-a is indexing"
        );
    }

    /// Cancelling one project must not cancel another.
    #[test]
    fn test_cancel_indexing_is_isolated_per_project() {
        let state = AppState::new(PathBuf::from("/tmp/gemkeep-test"));

        let ctx_a = state.get_or_create_context("project-a");
        let ctx_b = state.get_or_create_context("project-b");

        // Cancel project-a
        ctx_a.cancel_indexing.store(true, Ordering::SeqCst);

        // project-b must not be cancelled
        assert_eq!(
            ctx_b.cancel_indexing.load(Ordering::SeqCst),
            false,
            "project-b cancel flag must remain false when only project-a was cancelled"
        );
    }

    /// Thumbnail counter must be independent per project.
    #[test]
    fn test_thumbnail_counter_is_isolated_per_project() {
        let state = AppState::new(PathBuf::from("/tmp/gemkeep-test"));

        let ctx_a = state.get_or_create_context("project-a");
        let ctx_b = state.get_or_create_context("project-b");

        // project-a generates 42 thumbnails
        ctx_a.thumbnails_done_counter.store(42, Ordering::SeqCst);

        // project-b should have 0
        assert_eq!(
            ctx_b.thumbnails_done_counter.load(Ordering::SeqCst),
            0,
            "project-b should see thumbnails_done=0"
        );
    }

    /// Same slug returns same context (Arc identity).
    #[test]
    fn test_same_slug_returns_same_context() {
        let state = AppState::new(PathBuf::from("/tmp/gemkeep-test"));

        let ctx1 = state.get_or_create_context("project-a");
        let ctx2 = state.get_or_create_context("project-a");

        assert!(Arc::ptr_eq(&ctx1, &ctx2), "same slug must return same Arc");
    }
}
