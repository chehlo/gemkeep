use crate::import::pairs::LogicalGroup;
use crate::import::stacks::assign_stacks_clean;
use crate::photos::model::{PhotoFormat, ScannedFile};
use chrono::{Duration, TimeZone, Utc};
use std::path::PathBuf;

fn make_group(capture_time: Option<chrono::DateTime<chrono::Utc>>) -> LogicalGroup {
    let sf = ScannedFile {
        path: PathBuf::from("/tmp/photo.jpg"),
        format: PhotoFormat::Jpeg,
        capture_time,
        camera_model: None,
        lens: None,
        orientation: None,
        base_name: "photo".to_string(),
        dir: PathBuf::from("/tmp"),
    };
    LogicalGroup {
        jpeg: Some(sf),
        raw: None,
        is_pair: false,
    }
}

fn count_stacks(result: &[(LogicalGroup, usize)]) -> usize {
    result
        .iter()
        .map(|(_, i)| *i)
        .collect::<std::collections::HashSet<_>>()
        .len()
}

/// BT-01: A larger burst_gap should group more photos together (fewer stacks).
///
/// WHY: If gap=3s creates 4 stacks, gap=30s must create fewer (more photos group together).
///
/// Setup: 10 logical groups with capture times at offsets 0, 1, 2, 10, 11, 12, 20, 21, 22, 30 seconds.
/// Consecutive gaps: 1, 1, 8, 1, 1, 8, 1, 1, 8 seconds.
///
/// With burst_gap=3:  gaps of 8s exceed 3s → 4 stacks: {0,1,2}, {10,11,12}, {20,21,22}, {30}
/// With burst_gap=30: all gaps ≤ 30s → 1 stack
#[test]
fn test_restack_reduces_stacks_on_larger_gap() {
    let base = Utc.with_ymd_and_hms(2024, 1, 1, 10, 0, 0).unwrap();
    let offsets: &[i64] = &[0, 1, 2, 10, 11, 12, 20, 21, 22, 30];

    let groups: Vec<LogicalGroup> = offsets
        .iter()
        .map(|&s| make_group(Some(base + Duration::seconds(s))))
        .collect();

    let result_gap3 = assign_stacks_clean(groups.clone(), 3);
    let result_gap30 = assign_stacks_clean(groups, 30);

    let stacks_gap3 = count_stacks(&result_gap3);
    let stacks_gap30 = count_stacks(&result_gap30);

    assert_eq!(
        stacks_gap3, 4,
        "burst_gap=3s should produce 4 stacks (gaps of 8s split the groups), got {}",
        stacks_gap3
    );
    assert_eq!(
        stacks_gap30, 1,
        "burst_gap=30s should produce 1 stack (all consecutive gaps ≤ 30s), got {}",
        stacks_gap30
    );
}

/// BT-02: A burst_gap of 0 means any gap > 0 creates a new stack → each photo is its own stack.
///
/// WHY: Reducing gap to 0 means any gap > 0 creates a new stack → 10 stacks for 10 photos.
///
/// Uses the same 10 offsets as BT-01. Every consecutive gap is ≥ 1s > 0, so each photo
/// is placed in its own stack.
#[test]
fn test_restack_increases_stacks_on_smaller_gap() {
    let base = Utc.with_ymd_and_hms(2024, 1, 1, 10, 0, 0).unwrap();
    let offsets: &[i64] = &[0, 1, 2, 10, 11, 12, 20, 21, 22, 30];

    let groups: Vec<LogicalGroup> = offsets
        .iter()
        .map(|&s| make_group(Some(base + Duration::seconds(s))))
        .collect();

    let result_gap0 = assign_stacks_clean(groups, 0);
    let stacks_gap0 = count_stacks(&result_gap0);

    assert_eq!(
        stacks_gap0, 10,
        "burst_gap=0 should produce 10 stacks (every gap > 0 splits), got {}",
        stacks_gap0
    );
}
