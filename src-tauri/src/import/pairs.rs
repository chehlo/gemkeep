use crate::photos::model::{PhotoFormat, ScannedFile};
use std::collections::HashMap;

#[derive(Clone)]
pub struct LogicalGroup {
    pub jpeg: Option<ScannedFile>,
    pub raw: Option<ScannedFile>,
    /// true iff both jpeg and raw are Some
    pub is_pair: bool,
}

impl LogicalGroup {
    /// Return the representative file for this group.
    /// JPEG is preferred; falls back to RAW if no JPEG.
    pub fn representative(&self) -> &ScannedFile {
        self.jpeg.as_ref().unwrap_or_else(|| {
            self.raw
                .as_ref()
                .expect("group must have at least one file")
        })
    }

    /// The best available capture time for burst grouping.
    pub fn capture_time(&self) -> Option<chrono::DateTime<chrono::Utc>> {
        self.representative().capture_time
    }
}

/// Group scanned files into logical groups.
///
/// - JPEG + RAW with the same base_name in the same directory → pair (is_pair = true)
/// - Single file → unpaired (is_pair = false)
/// - 3+ files with the same (dir, base_name) → log warning, split to singles
pub fn detect_pairs(files: Vec<ScannedFile>) -> Vec<LogicalGroup> {
    // Key: (dir, base_name)
    let mut groups: HashMap<(std::path::PathBuf, String), Vec<ScannedFile>> = HashMap::new();

    for file in files {
        let key = (file.dir.clone(), file.base_name.clone());
        groups.entry(key).or_default().push(file);
    }

    let mut result = Vec::new();

    for ((dir, base), members) in groups {
        result.extend(resolve_group(&dir, &base, members));
    }

    result
}

/// Dispatch a bucket of same-(dir, base_name) files into LogicalGroup(s).
fn resolve_group(
    dir: &std::path::Path,
    base: &str,
    members: Vec<ScannedFile>,
) -> Vec<LogicalGroup> {
    match members.len() {
        0 => vec![], // impossible
        1 => vec![single_group(members.into_iter().next().unwrap())],
        2 => make_pair(dir, base, members),
        _ => split_to_singles(dir, base, members),
    }
}

/// Form a pair from exactly two files that share the same (dir, base_name).
///
/// If the two files are one JPEG + one RAW, returns a paired LogicalGroup.
/// If both are the same format (two JPEGs or two RAWs), warns and returns two singles.
fn make_pair(dir: &std::path::Path, base: &str, members: Vec<ScannedFile>) -> Vec<LogicalGroup> {
    let (jpegs, raws): (Vec<_>, Vec<_>) = members
        .into_iter()
        .partition(|f| f.format == PhotoFormat::Jpeg);

    if jpegs.len() == 1 && raws.len() == 1 {
        vec![LogicalGroup {
            jpeg: Some(jpegs.into_iter().next().unwrap()),
            raw: Some(raws.into_iter().next().unwrap()),
            is_pair: true,
        }]
    } else {
        // e.g. two JPEGs or two RAWs with same base — treat as singles
        tracing::warn!(
            "two files with same base {:?}/{} but not one JPEG + one RAW — treating as singles",
            dir,
            base
        );
        jpegs.into_iter().chain(raws).map(single_group).collect()
    }
}

/// Warn and return all members as individual singles (n >= 3 case).
fn split_to_singles(
    dir: &std::path::Path,
    base: &str,
    members: Vec<ScannedFile>,
) -> Vec<LogicalGroup> {
    tracing::warn!(
        "{} files with same base {:?}/{} — treating all as singles",
        members.len(),
        dir,
        base
    );
    members.into_iter().map(single_group).collect()
}

fn single_group(f: ScannedFile) -> LogicalGroup {
    let is_jpeg = f.format == PhotoFormat::Jpeg;
    LogicalGroup {
        jpeg: if is_jpeg { Some(f.clone()) } else { None },
        raw: if !is_jpeg { Some(f) } else { None },
        is_pair: false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::photos::model::PhotoFormat;
    use std::path::PathBuf;

    fn make_file(dir: &str, name: &str, format: PhotoFormat) -> ScannedFile {
        ScannedFile {
            path: PathBuf::from(dir).join(name),
            format,
            capture_time: None,
            camera_model: None,
            lens: None,
            orientation: None,
            base_name: std::path::Path::new(name)
                .file_stem()
                .unwrap()
                .to_str()
                .unwrap()
                .to_lowercase(),
            dir: PathBuf::from(dir),
        }
    }

    #[test]
    fn test_pair_cr2_jpeg() {
        let files = vec![
            make_file("/photos", "img_0001.cr2", PhotoFormat::Raw),
            make_file("/photos", "img_0001.jpg", PhotoFormat::Jpeg),
        ];
        let groups = detect_pairs(files);
        assert_eq!(groups.len(), 1);
        assert!(groups[0].is_pair);
        assert!(groups[0].jpeg.is_some());
        assert!(groups[0].raw.is_some());
    }

    #[test]
    fn test_pair_case_insensitive() {
        // base_name lowercasing is done by the caller when building ScannedFile.
        // Simulate the correct lowercased base_name:
        let mut f1 = make_file("/photos", "IMG_0001.cr2", PhotoFormat::Raw);
        f1.base_name = "img_0001".to_string();
        let mut f2 = make_file("/photos", "IMG_0001.jpg", PhotoFormat::Jpeg);
        f2.base_name = "img_0001".to_string();

        let groups = detect_pairs(vec![f1, f2]);
        assert_eq!(groups.len(), 1);
        assert!(groups[0].is_pair);
    }

    #[test]
    fn test_pair_no_match() {
        let files = vec![
            make_file("/photos", "img_0001.cr2", PhotoFormat::Raw),
            make_file("/photos", "img_0002.jpg", PhotoFormat::Jpeg),
        ];
        let groups = detect_pairs(files);
        assert_eq!(groups.len(), 2);
        assert!(groups.iter().all(|g| !g.is_pair));
    }

    #[test]
    fn test_pair_jpeg_only() {
        let files = vec![make_file("/photos", "img.jpg", PhotoFormat::Jpeg)];
        let groups = detect_pairs(files);
        assert_eq!(groups.len(), 1);
        assert!(!groups[0].is_pair);
        assert!(groups[0].jpeg.is_some());
        assert!(groups[0].raw.is_none());
    }

    #[test]
    fn test_pair_raw_only() {
        let files = vec![make_file("/photos", "img.cr2", PhotoFormat::Raw)];
        let groups = detect_pairs(files);
        assert_eq!(groups.len(), 1);
        assert!(!groups[0].is_pair);
        assert!(groups[0].raw.is_some());
        assert!(groups[0].jpeg.is_none());
    }

    #[test]
    fn test_pair_three_way() {
        // A.cr2 + A.cr3 + A.jpg — 3 files, treat all as singles with warning
        let mut f1 = make_file("/photos", "a.cr2", PhotoFormat::Raw);
        f1.base_name = "a".to_string();
        let mut f2 = make_file("/photos", "a.cr3", PhotoFormat::Raw);
        f2.base_name = "a".to_string();
        let mut f3 = make_file("/photos", "a.jpg", PhotoFormat::Jpeg);
        f3.base_name = "a".to_string();

        let groups = detect_pairs(vec![f1, f2, f3]);
        assert_eq!(groups.len(), 3);
        assert!(groups.iter().all(|g| !g.is_pair));
    }

    #[test]
    fn test_pair_cross_directory() {
        // Same base_name but different directories → NOT a pair
        let files = vec![
            make_file("/photos/a", "img.cr2", PhotoFormat::Raw),
            make_file("/photos/b", "img.jpg", PhotoFormat::Jpeg),
        ];
        let groups = detect_pairs(files);
        assert_eq!(groups.len(), 2);
        assert!(groups.iter().all(|g| !g.is_pair));
    }
}
