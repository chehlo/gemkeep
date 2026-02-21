use crate::photos::model::PhotoFormat;
use std::path::{Path, PathBuf};

/// Generate a 256x256 JPEG thumbnail and save to cache dir.
/// Returns path to saved thumbnail, or None on any failure (non-fatal).
pub fn generate_thumbnail(
    source_path: &Path,
    format: &PhotoFormat,
    logical_photo_id: i64,
    cache_dir: &Path,
) -> Option<PathBuf> {
    match std::panic::catch_unwind(|| {
        generate_thumbnail_inner(source_path, format, logical_photo_id, cache_dir)
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
) -> Option<PathBuf> {
    let out_path = cache_dir.join(format!("{}.jpg", logical_photo_id));

    match format {
        PhotoFormat::Jpeg => generate_jpeg_thumbnail(source_path, &out_path),
        PhotoFormat::Raw => generate_raw_thumbnail(source_path, &out_path),
    }
}

fn generate_jpeg_thumbnail(source_path: &Path, out_path: &Path) -> Option<PathBuf> {
    let img = match image::open(source_path) {
        Ok(i) => i,
        Err(e) => {
            tracing::debug!("thumbnail: cannot open JPEG {:?}: {}", source_path, e);
            return None;
        }
    };

    let thumbnail = img.thumbnail(256, 256);

    // Ensure parent directory exists
    if let Some(parent) = out_path.parent() {
        if let Err(e) = std::fs::create_dir_all(parent) {
            tracing::warn!("thumbnail: cannot create dir {:?}: {}", parent, e);
            return None;
        }
    }

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
    match extract_raw_embedded_jpeg(source_path) {
        Some(jpeg_bytes) => {
            if let Some(parent) = out_path.parent() {
                if let Err(e) = std::fs::create_dir_all(parent) {
                    tracing::warn!("thumbnail: cannot create dir {:?}: {}", parent, e);
                    return None;
                }
            }
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
        None => {
            tracing::debug!("no embedded JPEG preview in RAW {:?}", source_path);
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
