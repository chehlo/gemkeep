use crate::photos::model::PhotoFormat;
use std::path::{Path, PathBuf};

/// Generate a 256x256 JPEG thumbnail and save to cache dir.
/// Returns path to saved thumbnail, or None on any failure (non-fatal).
pub fn generate_thumbnail(
    source_path: &Path,
    format: &PhotoFormat,
    logical_photo_id: i64,
    cache_dir: &Path,
    orientation: Option<u16>,
) -> Option<PathBuf> {
    match std::panic::catch_unwind(|| {
        generate_thumbnail_inner(
            source_path,
            format,
            logical_photo_id,
            cache_dir,
            orientation,
        )
    }) {
        Ok(result) => result,
        Err(_) => {
            tracing::warn!(
                "panic in generate_thumbnail for {:?} (logical_photo_id={})",
                source_path,
                logical_photo_id
            );
            None
        }
    }
}

fn generate_thumbnail_inner(
    source_path: &Path,
    format: &PhotoFormat,
    logical_photo_id: i64,
    cache_dir: &Path,
    orientation: Option<u16>,
) -> Option<PathBuf> {
    let out_path = cache_dir.join(format!("{}.jpg", logical_photo_id));

    match format {
        PhotoFormat::Jpeg => generate_jpeg_thumbnail(source_path, &out_path, orientation),
        // RAW: camera embeds the preview already oriented — pass None
        PhotoFormat::Raw => generate_raw_thumbnail(source_path, &out_path),
    }
}

/// Create the parent directory of `path` if it does not yet exist.
/// Returns `None` (and logs a warning) on failure.
fn ensure_parent_dir(path: &Path) -> Option<()> {
    if let Some(parent) = path.parent() {
        if let Err(e) = std::fs::create_dir_all(parent) {
            tracing::warn!("thumbnail: cannot create dir {:?}: {}", parent, e);
            return None;
        }
    }
    Some(())
}

fn generate_jpeg_thumbnail(
    source_path: &Path,
    out_path: &Path,
    orientation: Option<u16>,
) -> Option<PathBuf> {
    let img = match image::open(source_path) {
        Ok(i) => i,
        Err(e) => {
            tracing::debug!("thumbnail: cannot open JPEG {:?}: {}", source_path, e);
            return None;
        }
    };

    let thumbnail = img.thumbnail(256, 256);

    // Apply EXIF orientation rotation
    let thumbnail = match orientation {
        Some(3) => thumbnail.rotate180(),
        Some(6) => thumbnail.rotate90(),
        Some(8) => thumbnail.rotate270(),
        Some(o) if matches!(o, 2 | 4 | 5 | 7) => {
            tracing::debug!("thumbnail: orientation {} (mirror) not applied", o);
            thumbnail
        }
        _ => thumbnail, // 1 or None: no rotation needed
    };

    ensure_parent_dir(out_path)?;

    match thumbnail.save(out_path) {
        Ok(_) => {
            tracing::debug!("thumbnail saved to {:?}", out_path);
            Some(out_path.to_path_buf())
        }
        Err(e) => {
            tracing::warn!("thumbnail: save failed for {:?}: {}", out_path, e);
            None
        }
    }
}

fn generate_raw_thumbnail(source_path: &Path, out_path: &Path) -> Option<PathBuf> {
    // Attempt to extract embedded JPEG preview via rsraw (LibRaw FFI).
    // rsraw may panic on unknown RAW formats; catch_unwind at the top handles this.
    let jpeg_bytes = extract_raw_embedded_jpeg(source_path)?;

    ensure_parent_dir(out_path)?;

    match std::fs::write(out_path, &jpeg_bytes) {
        Ok(_) => {
            tracing::debug!("raw thumbnail saved to {:?}", out_path);
            Some(out_path.to_path_buf())
        }
        Err(e) => {
            tracing::warn!("thumbnail: write failed for {:?}: {}", out_path, e);
            None
        }
    }
}

fn extract_raw_embedded_jpeg(source_path: &Path) -> Option<Vec<u8>> {
    use rsraw::RawImage;
    // rsraw::RawImage::open() takes &[u8]
    let buf = std::fs::read(source_path).ok()?;
    let mut raw = RawImage::open(&buf).ok()?;
    // extract_thumbs returns Vec<ThumbnailImage>; pick the largest JPEG thumbnail
    let thumbs = raw.extract_thumbs().ok()?;
    // Find largest thumbnail by data length (prefer JPEG format)
    thumbs
        .into_iter()
        .filter(|t| matches!(t.format, rsraw::ThumbFormat::Jpeg))
        .max_by_key(|t| t.data.len())
        .map(|t| t.data)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::{NamedTempFile, TempDir};

    /// Create a synthetic JPEG at a NamedTempFile path.
    /// Uses `.jpg` suffix so the image crate can detect the format.
    fn make_jpeg(width: u32, height: u32) -> NamedTempFile {
        let f = tempfile::Builder::new().suffix(".jpg").tempfile().unwrap();
        let img = image::DynamicImage::new_rgb8(width, height);
        img.save(f.path()).unwrap();
        f
    }

    #[test]
    fn test_thumbnail_output_is_256x256() {
        // WHY: generate_thumbnail must produce a 256x256 image.
        // Previously there was no test that READ BACK the output — only that the
        // function returned Ok. This test verifies the output file dimensions.
        let src = make_jpeg(800, 600);
        let cache_dir = TempDir::new().unwrap();

        let result = generate_thumbnail(
            src.path(),
            &crate::photos::model::PhotoFormat::Jpeg,
            42,
            cache_dir.path(),
            None,
        );

        assert!(result.is_some(), "generate_thumbnail should succeed for a valid JPEG source");
        let thumb_path = cache_dir.path().join("42.jpg");
        assert!(thumb_path.exists(), "thumbnail file must exist at expected path");

        let img = image::open(&thumb_path).expect("output must be a readable image");
        // image::thumbnail() fits within 256x256 while preserving aspect ratio
        assert!(
            img.width() <= 256 && img.height() <= 256,
            "thumbnail must fit within 256x256, got {}x{}",
            img.width(),
            img.height()
        );
        assert!(
            img.width() == 256 || img.height() == 256,
            "thumbnail must fill at least one dimension to 256px, got {}x{}",
            img.width(),
            img.height()
        );
    }

    #[test]
    fn test_thumbnail_output_is_valid_jpeg() {
        let src = make_jpeg(400, 400);
        let cache_dir = TempDir::new().unwrap();

        generate_thumbnail(
            src.path(),
            &crate::photos::model::PhotoFormat::Jpeg,
            1,
            cache_dir.path(),
            None,
        );

        let thumb_path = cache_dir.path().join("1.jpg");
        let bytes = std::fs::read(&thumb_path).expect("thumbnail file must exist");
        assert_eq!(
            &bytes[0..2],
            &[0xFF, 0xD8],
            "output must start with JPEG magic bytes FF D8"
        );
    }

    #[test]
    fn test_thumbnail_path_created_at_logical_photo_id() {
        let src = make_jpeg(200, 200);
        let cache_dir = TempDir::new().unwrap();
        let lp_id: i64 = 999;

        let result = generate_thumbnail(
            src.path(),
            &crate::photos::model::PhotoFormat::Jpeg,
            lp_id,
            cache_dir.path(),
            None,
        );

        let expected = cache_dir.path().join(format!("{}.jpg", lp_id));
        assert!(expected.exists(), "thumbnail must be created at <cache_dir>/<lp_id>.jpg");
        assert_eq!(result, Some(expected));
    }

    #[test]
    fn test_thumbnail_nonexistent_source_does_not_panic() {
        // WHY: generate_thumbnail is non-fatal. Missing source must not crash.
        let cache_dir = TempDir::new().unwrap();
        let missing = Path::new("/tmp/definitely_does_not_exist_gemkeep_test.jpg");

        let result = generate_thumbnail(
            missing,
            &crate::photos::model::PhotoFormat::Jpeg,
            77,
            cache_dir.path(),
            None,
        );

        assert!(result.is_none(), "must return None for missing source");
        assert!(
            !cache_dir.path().join("77.jpg").exists(),
            "no thumbnail file must be created for missing source"
        );
    }

    #[test]
    fn test_thumbnail_orientation_rotation_applied() {
        // WHY: No existing test verifies that orientation causes actual pixel rotation.
        // If the match block is removed or the orientation arg is ignored,
        // all other thumbnail tests still pass. This test catches that regression.
        //
        // Strategy: generate a LANDSCAPE source image (600×200, width >> height).
        // Pass orientation=6 (90° CW rotation). After rotation, output must be portrait.
        // A 256×85 thumbnail from 600×200 → after rotate90 → 85×256 (height > width).

        let src = make_jpeg(600, 200); // wide landscape
        let cache_dir = TempDir::new().unwrap();

        let result = generate_thumbnail(
            src.path(),
            &crate::photos::model::PhotoFormat::Jpeg,
            55,
            cache_dir.path(),
            Some(6), // orientation=6: 90° CW rotation needed
        );

        assert!(result.is_some(), "generate_thumbnail must succeed");
        let thumb_path = cache_dir.path().join("55.jpg");
        let img = image::open(&thumb_path).expect("output must be readable");

        assert!(
            img.height() > img.width(),
            "orientation=6 (90° rotation) must produce portrait output, got {}×{}",
            img.width(), img.height()
        );
    }
}
