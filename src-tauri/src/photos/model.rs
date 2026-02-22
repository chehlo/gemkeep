use std::path::PathBuf;

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PhotoFormat {
    Jpeg,
    Raw,
}

/// Intermediate struct used during pipeline (not stored directly in DB)
#[derive(Debug, Clone)]
pub struct ScannedFile {
    pub path: PathBuf,
    pub format: PhotoFormat,
    pub capture_time: Option<chrono::DateTime<chrono::Utc>>,
    pub camera_model: Option<String>,
    pub lens: Option<String>,
    pub orientation: Option<u16>,
    /// lowercase filename without extension, for pair matching
    pub base_name: String,
    /// parent directory
    pub dir: PathBuf,
}

#[derive(Debug, Default, Clone, serde::Serialize, serde::Deserialize)]
pub struct ImportStats {
    pub total_files_scanned: usize,
    pub imported: usize,
    pub skipped_existing: usize,
    pub skipped_unsupported: usize,
    pub errors: usize,
    pub pairs_detected: usize,
    pub stacks_generated: usize,
    pub logical_photos: usize,
    /// capped at 100 entries
    pub error_log: Vec<String>,
    /// true if the run was cancelled before completion
    pub cancelled: bool,
}

#[derive(Debug, Default, Clone, serde::Serialize, serde::Deserialize)]
pub struct IndexingStatus {
    pub running: bool,
    pub thumbnails_running: bool,
    /// total files discovered (may grow during scan)
    pub total: usize,
    /// files completed
    pub processed: usize,
    pub errors: usize,
    pub cancelled: bool,
    pub paused: bool,
    /// populated when done
    pub last_stats: Option<ImportStats>,
    /// total thumbnails to generate — set before the rayon pool starts
    pub thumbnails_total: usize,
    /// thumbnails completed — read live from AtomicUsize in get_indexing_status
    pub thumbnails_done: usize,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct StackSummary {
    pub stack_id: i64,
    pub logical_photo_count: i64,
    pub earliest_capture: Option<String>,
    pub has_raw: bool,
    pub has_jpeg: bool,
    pub thumbnail_path: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct LogicalPhotoSummary {
    pub logical_photo_id: i64,
    pub thumbnail_path:   Option<String>,
    pub capture_time:     Option<String>,  // ISO-8601
    pub camera_model:     Option<String>,
    pub lens:             Option<String>,
    pub has_raw:          bool,
    pub has_jpeg:         bool,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct SourceFolderRow {
    pub id: i64,
    pub path: String,
}
