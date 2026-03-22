/// The action for a decision.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DecisionAction {
    Keep,
    Eliminate,
}

impl DecisionAction {
    pub fn as_str(&self) -> &'static str {
        match self {
            DecisionAction::Keep => "keep",
            DecisionAction::Eliminate => "eliminate",
        }
    }
}

/// Result of making a decision.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct DecisionResult {
    /// The decision row id
    pub decision_id: i64,
    /// The round id the decision was recorded in
    pub round_id: i64,
    /// The action that was recorded
    pub action: String,
    /// Current status of the logical photo after this decision
    pub current_status: String,
    /// Whether the round was auto-created (first decision in stack)
    pub round_auto_created: bool,
}

/// Status of a round for a given stack.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct RoundStatus {
    pub round_id: i64,
    pub round_number: i32,
    pub state: String, // "open" | "committed"
    pub total_photos: i64,
    pub decided: i64,
    pub kept: i64,
    pub eliminated: i64,
    pub undecided: i64,
    pub committed_at: Option<String>, // ISO-8601, None if still open
}

/// Full detail for a single logical photo, including camera parameters.
/// Used by SingleView for the full-screen display.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct PhotoDetail {
    pub logical_photo_id: i64,
    pub thumbnail_path: Option<String>,
    pub capture_time: Option<String>,
    pub camera_model: Option<String>,
    pub lens: Option<String>,
    pub has_raw: bool,
    pub has_jpeg: bool,
    pub current_status: String, // "undecided" | "keep" | "eliminate"
    // Camera parameters (from representative photo EXIF)
    pub aperture: Option<f64>,         // f-number
    pub shutter_speed: Option<String>, // formatted: "1/250"
    pub iso: Option<u32>,
    pub focal_length: Option<f64>,  // mm
    pub exposure_comp: Option<f64>, // EV
    // File paths for asset protocol display
    pub jpeg_path: Option<String>,    // path to JPEG file (for display)
    pub raw_path: Option<String>,     // path to RAW file (for future toggle)
    pub preview_path: Option<String>, // full-size RAW embedded preview (SingleView fallback)
}

/// Decision status for a single logical photo within a stack.
/// Used by StackFocus to display decision badges on thumbnails.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct PhotoDecisionStatus {
    pub logical_photo_id: i64,
    pub current_status: String, // "undecided" | "keep" | "eliminate"
}

/// Summary of a round for list_rounds display.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct RoundSummary {
    pub round_id: i64,
    pub round_number: i32,
    pub state: String, // "open" | "committed"
    pub committed_at: Option<String>,
    pub total: i64,
    pub kept: i64,
    pub eliminated: i64,
    pub undecided: i64,
}

/// Snapshot of a single photo's status within a specific round.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct PhotoSnapshot {
    pub logical_photo_id: i64,
    pub status: String, // "undecided" | "keep" | "eliminate"
}
