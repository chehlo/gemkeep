use crate::import::pairs::LogicalGroup;

/// Generic burst grouping algorithm: separate items into timed/untimed,
/// sort timed by time, group consecutive items whose gap is ≤ burst_gap_secs
/// into the same stack, and give each untimed item its own solo stack.
///
/// Returns `(key, stack_index)` pairs where stack_index is 0-based.
///
/// - `items`: the collection to group
/// - `burst_gap_secs`: maximum gap (inclusive) for items to share a stack
/// - `key_fn`: extracts the key (e.g. `LogicalGroup` or `i64`) from each item
/// - `time_fn`: extracts the optional capture time from each item
pub fn burst_group<T, K>(
    items: Vec<T>,
    burst_gap_secs: u64,
    key_fn: impl Fn(&T) -> K,
    time_fn: impl Fn(&T) -> Option<chrono::DateTime<chrono::Utc>>,
) -> Vec<(K, usize)> {
    let mut with_time: Vec<(K, chrono::DateTime<chrono::Utc>)> = Vec::new();
    let mut without_time: Vec<K> = Vec::new();

    for item in &items {
        let key = key_fn(item);
        if let Some(t) = time_fn(item) {
            with_time.push((key, t));
        } else {
            without_time.push(key);
        }
    }

    with_time.sort_by_key(|(_, t)| *t);

    let mut result: Vec<(K, usize)> = Vec::new();
    let mut stack_index: usize = 0;
    let mut last_time: Option<chrono::DateTime<chrono::Utc>> = None;

    for (key, t) in with_time {
        if let Some(prev) = last_time {
            let gap = (t - prev).num_seconds().unsigned_abs();
            if gap > burst_gap_secs {
                stack_index += 1;
            }
        }
        last_time = Some(t);
        result.push((key, stack_index));
    }

    // Each untimed item gets a solo stack
    for key in without_time {
        stack_index += 1;
        result.push((key, stack_index));
    }

    result
}

/// Assign logical groups to stacks based on burst detection.
///
/// Groups with a capture_time are sorted; consecutive groups whose gap is
/// ≤ burst_gap_secs are placed in the same stack. Groups with no capture_time
/// each get their own solo stack.
///
/// Returns (group, stack_index) pairs where stack_index is 0-based.
pub fn assign_stacks_clean(
    groups: Vec<LogicalGroup>,
    burst_gap_secs: u64,
) -> Vec<(LogicalGroup, usize)> {
    burst_group(groups, burst_gap_secs, |g| g.clone(), |g| g.capture_time())
}

/// Primary public API for burst-based stack assignment.
pub use assign_stacks_clean as assign_stacks_by_burst;

#[cfg(test)]
mod tests {
    use super::*;
    use crate::import::stacks_tests::make_group;
    use chrono::{Duration, TimeZone, Utc};

    fn base_time() -> chrono::DateTime<chrono::Utc> {
        Utc.with_ymd_and_hms(2024, 3, 15, 12, 0, 0).unwrap()
    }

    #[test]
    fn test_stack_burst_3s() {
        let t = base_time();
        let groups = vec![
            make_group(Some(t)),
            make_group(Some(t + Duration::seconds(1))),
            make_group(Some(t + Duration::seconds(2))),
            make_group(Some(t + Duration::seconds(3))),
            make_group(Some(t + Duration::seconds(4))),
        ];
        let assigned = assign_stacks_clean(groups, 3);
        // All within 3s gap → all in stack 0
        let indices: Vec<usize> = assigned.iter().map(|(_, i)| *i).collect();
        assert!(
            indices.iter().all(|&i| i == 0),
            "all should be stack 0, got {:?}",
            indices
        );
    }

    #[test]
    fn test_stack_gap() {
        let t = base_time();
        let groups = vec![
            make_group(Some(t)),
            make_group(Some(t + Duration::seconds(2))),
            make_group(Some(t + Duration::seconds(3))),
            // gap of 10s → new stack
            make_group(Some(t + Duration::seconds(13))),
            make_group(Some(t + Duration::seconds(14))),
            make_group(Some(t + Duration::seconds(15))),
        ];
        let assigned = assign_stacks_clean(groups, 3);
        let stack_0: Vec<_> = assigned.iter().filter(|(_, i)| *i == 0).collect();
        let stack_1: Vec<_> = assigned.iter().filter(|(_, i)| *i == 1).collect();
        assert_eq!(stack_0.len(), 3);
        assert_eq!(stack_1.len(), 3);
    }

    #[test]
    fn test_stack_single() {
        let groups = vec![make_group(Some(base_time()))];
        let assigned = assign_stacks_clean(groups, 3);
        assert_eq!(assigned.len(), 1);
        assert_eq!(assigned[0].1, 0);
    }

    #[test]
    fn test_stack_no_exif_solo() {
        // 3 photos with None capture_time → 3 solo stacks (different indices)
        let groups = vec![make_group(None), make_group(None), make_group(None)];
        let assigned = assign_stacks_clean(groups, 3);
        let indices: Vec<usize> = assigned.iter().map(|(_, i)| *i).collect();
        // All indices should be different
        let unique: std::collections::HashSet<usize> = indices.iter().cloned().collect();
        assert_eq!(
            unique.len(),
            3,
            "each untimed group should have its own stack"
        );
    }

    #[test]
    fn test_stack_mixed() {
        let t = base_time();
        // 2 timed + 2 untimed
        let groups = vec![
            make_group(Some(t)),
            make_group(Some(t + Duration::seconds(1))),
            make_group(None),
            make_group(None),
        ];
        let assigned = assign_stacks_clean(groups, 3);
        assert_eq!(assigned.len(), 4);
        // First two share stack 0
        let timed: Vec<_> = assigned
            .iter()
            .filter(|(g, _)| g.capture_time().is_some())
            .collect();
        assert!(timed.iter().all(|(_, i)| *i == 0));
        // The two untimed have different stack indices
        let untimed: Vec<usize> = assigned
            .iter()
            .filter(|(g, _)| g.capture_time().is_none())
            .map(|(_, i)| *i)
            .collect();
        assert_ne!(untimed[0], untimed[1]);
    }

    #[test]
    fn test_stack_configurable_gap() {
        let t = base_time();
        let groups = vec![
            make_group(Some(t)),
            make_group(Some(t + Duration::seconds(5))),
        ];
        // gap=1s: two stacks
        let assigned_1 = assign_stacks_clean(groups.clone(), 1);
        let indices_1: Vec<_> = assigned_1.iter().map(|(_, i)| *i).collect();
        assert_ne!(indices_1[0], indices_1[1], "with gap=1s should be 2 stacks");

        // gap=10s: one stack
        let assigned_10 = assign_stacks_clean(groups, 10);
        let indices_10: Vec<_> = assigned_10.iter().map(|(_, i)| *i).collect();
        assert_eq!(
            indices_10[0], indices_10[1],
            "with gap=10s should be 1 stack"
        );
    }

    #[test]
    fn test_stack_consecutive_not_from_stack_origin() {
        // WHY: Documents and verifies that stacking compares CONSECUTIVE pairs,
        // NOT the gap from the first photo in the current stack.
        //
        // 5 photos each 2s apart (total span = 8s > burst_gap=3):
        //   consecutive gaps: 2,2,2,2 — all ≤ 3 → should all be one stack
        //   distance-from-first: gaps 2,4,6,8 — 4>3 would split after 2nd photo
        //
        // This test FAILS if a distance-from-first algorithm is accidentally used.
        let t = base_time();
        let groups = vec![
            make_group(Some(t)),
            make_group(Some(t + Duration::seconds(2))),
            make_group(Some(t + Duration::seconds(4))),
            make_group(Some(t + Duration::seconds(6))),
            make_group(Some(t + Duration::seconds(8))),
        ];
        let assigned = assign_stacks_clean(groups, 3);
        let indices: Vec<usize> = assigned.iter().map(|(_, i)| *i).collect();
        assert!(
            indices.iter().all(|&i| i == 0),
            "5 photos with 2s consecutive gaps must be in one stack (burst_gap=3), got {:?}",
            indices
        );
    }
}
