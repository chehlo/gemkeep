use std::collections::HashSet;
use std::path::Path;

/// Return a thread count suitable for CPU-bound rayon pools.
///
/// Reserves 2 cores for the UI / GTK event loop so the app stays responsive,
/// but never returns less than 1.
pub fn capped_num_threads() -> usize {
    std::thread::available_parallelism()
        .map(|n| n.get().saturating_sub(2).max(1))
        .unwrap_or(1)
}

/// Scan a thumbnail cache directory and return the set of logical_photo IDs
/// that already have cached thumbnails (based on filename stems like "123.jpg" → 123).
pub fn cached_thumbnail_ids(cache_dir: &Path) -> HashSet<i64> {
    std::fs::read_dir(cache_dir)
        .into_iter()
        .flatten()
        .filter_map(|e| e.ok())
        .filter_map(|e| {
            e.path()
                .file_stem()
                .and_then(|s| s.to_str())
                .and_then(|s| s.parse::<i64>().ok())
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_capped_num_threads_is_at_least_one() {
        assert!(capped_num_threads() >= 1);
    }
}
