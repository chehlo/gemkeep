use crate::photos::model::PhotoFormat;
use std::path::{Path, PathBuf};
use walkdir::WalkDir;

const RAW_EXTENSIONS: &[&str] = &["cr2", "cr3", "arw"];
const JPEG_EXTENSIONS: &[&str] = &["jpg", "jpeg"];

pub struct ScannedPath {
    pub path: PathBuf,
    pub format: PhotoFormat,
}

/// Recursively scan a directory and return all supported photo files.
/// Symlinks are skipped. Permission errors are logged and skipped.
/// Returns (files, error_log).
pub fn scan_directory(dir: &Path) -> (Vec<ScannedPath>, Vec<String>) {
    let mut files = Vec::new();
    let mut errors = Vec::new();

    for entry in WalkDir::new(dir)
        .follow_links(false)
        .into_iter()
        .filter_entry(|e| !e.path_is_symlink())
    {
        match entry {
            Err(e) => {
                let msg = format!("scan error: {}", e);
                tracing::warn!("{}", msg);
                errors.push(msg);
            }
            Ok(entry) => {
                if !entry.file_type().is_file() {
                    continue;
                }
                if entry.path_is_symlink() {
                    tracing::debug!("skipping symlink: {:?}", entry.path());
                    continue;
                }
                if let Some(format) = detect_format(entry.path()) {
                    files.push(ScannedPath {
                        path: entry.path().to_path_buf(),
                        format,
                    });
                }
            }
        }
    }

    tracing::debug!(
        "scan_directory {:?}: {} files, {} errors",
        dir,
        files.len(),
        errors.len()
    );
    (files, errors)
}

/// Detect the photo format from the file extension (case-insensitive).
/// Returns None for unsupported extensions.
pub fn detect_format(path: &Path) -> Option<PhotoFormat> {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .map(|s| s.to_lowercase())?;

    if JPEG_EXTENSIONS.contains(&ext.as_str()) {
        Some(PhotoFormat::Jpeg)
    } else if RAW_EXTENSIONS.contains(&ext.as_str()) {
        Some(PhotoFormat::Raw)
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    fn make_tmp() -> TempDir {
        tempfile::tempdir().unwrap()
    }

    fn touch(dir: &Path, name: &str) -> PathBuf {
        let p = dir.join(name);
        fs::write(&p, b"").unwrap();
        p
    }

    #[test]
    fn test_scan_empty_folder() {
        let tmp = make_tmp();
        let (files, errors) = scan_directory(tmp.path());
        assert!(files.is_empty());
        assert!(errors.is_empty());
    }

    #[test]
    fn test_scan_jpeg_and_raw() {
        let tmp = make_tmp();
        touch(tmp.path(), "photo.jpg");
        touch(tmp.path(), "photo.cr2");
        touch(tmp.path(), "document.pdf");
        touch(tmp.path(), "readme.txt");

        let (files, errors) = scan_directory(tmp.path());
        assert_eq!(files.len(), 2);
        assert!(errors.is_empty());
        let has_jpeg = files.iter().any(|f| f.format == PhotoFormat::Jpeg);
        let has_raw = files.iter().any(|f| f.format == PhotoFormat::Raw);
        assert!(has_jpeg);
        assert!(has_raw);
    }

    #[test]
    fn test_extension_case_insensitive() {
        let tmp = make_tmp();
        touch(tmp.path(), "photo.CR2");
        touch(tmp.path(), "photo.JPG");
        touch(tmp.path(), "photo.JPEG");
        touch(tmp.path(), "photo.ARW");

        let (files, _) = scan_directory(tmp.path());
        assert_eq!(files.len(), 4);
    }

    #[test]
    fn test_scan_no_symlinks() {
        let tmp = make_tmp();
        let real_file = touch(tmp.path(), "real.jpg");
        let link_path = tmp.path().join("link.jpg");
        // Create symlink; skip on platforms where this fails (e.g. Windows CI)
        if std::os::unix::fs::symlink(&real_file, &link_path).is_ok() {
            let (files, _) = scan_directory(tmp.path());
            // Only the real file should appear; the symlink is skipped
            assert_eq!(files.len(), 1);
        }
    }

    #[test]
    fn test_detect_format_unsupported() {
        assert!(detect_format(Path::new("file.nef")).is_none());
        assert!(detect_format(Path::new("file.txt")).is_none());
        assert!(detect_format(Path::new("file")).is_none());
    }

    #[test]
    fn test_detect_format_supported() {
        assert_eq!(detect_format(Path::new("a.jpg")), Some(PhotoFormat::Jpeg));
        assert_eq!(detect_format(Path::new("a.jpeg")), Some(PhotoFormat::Jpeg));
        assert_eq!(detect_format(Path::new("a.cr2")), Some(PhotoFormat::Raw));
        assert_eq!(detect_format(Path::new("a.cr3")), Some(PhotoFormat::Raw));
        assert_eq!(detect_format(Path::new("a.arw")), Some(PhotoFormat::Raw));
    }

    #[test]
    #[cfg(unix)]
    fn test_scan_permission_error() {
        use std::os::unix::fs::PermissionsExt;
        let tmp = make_tmp();
        let subdir = tmp.path().join("restricted");
        std::fs::create_dir_all(&subdir).unwrap();
        // Create a readable JPEG in parent dir
        let parent_file = touch(tmp.path(), "visible.jpg");
        // Make subdir unreadable
        std::fs::set_permissions(&subdir, std::fs::Permissions::from_mode(0o000)).unwrap();
        let (files, _errors) = scan_directory(tmp.path());
        // Restore permissions so TempDir cleanup works
        std::fs::set_permissions(&subdir, std::fs::Permissions::from_mode(0o755)).unwrap();
        // scan_directory must succeed (return a vec, not panic) even when a subdir is unreadable
        assert!(
            files.iter().any(|f| f.path == parent_file),
            "must still find files in accessible directories"
        );
    }
}
