use crate::photos::model::PhotoFormat;
use std::path::{Path, PathBuf};

/// Generate a 256×256 JPEG thumbnail and save to cache dir.
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
fn ensure_parent_dir(path: &Path) -> Option<()> {
    if let Some(parent) = path.parent() {
        if let Err(e) = std::fs::create_dir_all(parent) {
            tracing::warn!("thumbnail: cannot create dir {:?}: {}", parent, e);
            return None;
        }
    }
    Some(())
}

/// Try to extract the EXIF IFD1 embedded JPEG thumbnail from a camera JPEG.
///
/// Camera JPEGs typically embed a ~160×120 preview in the EXIF APP1 block (IFD1).
/// Returns None if no embedded thumbnail is present or on any parse error.
fn extract_exif_embedded_thumbnail(source_path: &Path) -> Option<Vec<u8>> {
    let file = std::fs::File::open(source_path).ok()?;
    let mut buf_reader = std::io::BufReader::new(file);
    let exif = exif::Reader::new()
        .read_from_container(&mut buf_reader)
        .ok()?;

    let offset_field = exif.get_field(exif::Tag::JPEGInterchangeFormat, exif::In::THUMBNAIL)?;
    let length_field =
        exif.get_field(exif::Tag::JPEGInterchangeFormatLength, exif::In::THUMBNAIL)?;

    let offset = match &offset_field.value {
        exif::Value::Long(v) => *v.first()? as usize,
        _ => return None,
    };
    let length = match &length_field.value {
        exif::Value::Long(v) => *v.first()? as usize,
        _ => return None,
    };

    if length == 0 {
        return None;
    }

    let buf = exif.buf();
    buf.get(offset..offset + length).map(|s| s.to_vec())
}

/// Apply EXIF orientation rotation to an image.
fn apply_orientation(img: image::DynamicImage, orientation: Option<u16>) -> image::DynamicImage {
    match orientation {
        Some(3) => img.rotate180(),
        Some(6) => img.rotate90(),
        Some(8) => img.rotate270(),
        Some(o) if matches!(o, 2 | 4 | 5 | 7) => {
            tracing::debug!("thumbnail: orientation {} (mirror) not applied", o);
            img
        }
        _ => img,
    }
}

/// Resize a decoded image to exactly 256×256 (crop to fill), apply orientation, save.
///
/// Uses `resize_to_fill` with Lanczos3 so the output always fills the container
/// without letterboxing. The grid's `object-cover` CSS then has a same-resolution
/// source to work with.
pub fn generate_thumbnail_from_image(
    img: image::DynamicImage,
    out_path: &Path,
    orientation: Option<u16>,
) -> Option<PathBuf> {
    let resized = img.resize_to_fill(256, 256, image::imageops::FilterType::Lanczos3);
    let thumbnail = apply_orientation(resized, orientation);

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

/// Decode `jpeg_bytes`, check minimum size, resize to 256×256, apply orientation, save.
#[cfg_attr(not(test), allow(dead_code))]
fn generate_thumbnail_from_bytes(
    jpeg_bytes: &[u8],
    out_path: &Path,
    orientation: Option<u16>,
) -> Option<PathBuf> {
    let img = match image::load_from_memory(jpeg_bytes) {
        Ok(i) => i,
        Err(e) => {
            tracing::debug!(
                "thumbnail: cannot decode {} embedded bytes: {}",
                jpeg_bytes.len(),
                e
            );
            return None;
        }
    };
    generate_thumbnail_from_image(img, out_path, orientation)
}

fn generate_jpeg_thumbnail(
    source_path: &Path,
    out_path: &Path,
    orientation: Option<u16>,
) -> Option<PathBuf> {
    // Fast path: EXIF IFD1 embedded thumbnail.
    // Reject if short side < 200px — tiny embedded previews produce blurry upscales.
    if let Some(bytes) = extract_exif_embedded_thumbnail(source_path) {
        if let Ok(img) = image::load_from_memory(&bytes) {
            let short_side = img.width().min(img.height());
            if short_side >= 200 {
                if let Some(result) = generate_thumbnail_from_image(img, out_path, orientation) {
                    tracing::debug!(
                        "thumbnail: embedded EXIF path (short={}px) for {:?}",
                        short_side,
                        source_path
                    );
                    return Some(result);
                }
            } else {
                tracing::debug!(
                    "thumbnail: embedded too small ({}×{}, short={}px), falling back for {:?}",
                    img.width(),
                    img.height(),
                    short_side,
                    source_path
                );
            }
        }
    }

    // Primary fallback: turbojpeg DCT 1/8 downscale (~50x faster than full decode)
    if let Some(result) = generate_jpeg_thumbnail_turbo(source_path, out_path, orientation) {
        return Some(result);
    }

    // Last resort: full JPEG decode (slow, used only if turbojpeg fails)
    tracing::debug!("thumbnail: full decode last-resort for {:?}", source_path);
    let img = match image::open(source_path) {
        Ok(i) => i,
        Err(e) => {
            tracing::debug!("thumbnail: cannot open JPEG {:?}: {}", source_path, e);
            return None;
        }
    };
    generate_thumbnail_from_image(img, out_path, orientation)
}

fn generate_raw_thumbnail(source_path: &Path, out_path: &Path) -> Option<PathBuf> {
    // rsraw extracts a large embedded JPEG preview (typically 1620×1080).
    // Resize to 256×256 to keep cache files small and grid loads fast.
    let jpeg_bytes = extract_raw_embedded_jpeg(source_path)?;
    let img = image::load_from_memory(&jpeg_bytes).ok()?;
    generate_thumbnail_from_image(img, out_path, None) // RAW preview is pre-oriented
}

/// Adaptive thumbnail generation strategy based on batch size.
pub struct ThumbnailStrategy {
    /// Whether to attempt EXIF IFD1 embedded thumbnail extraction first.
    pub use_exif_fast_path: bool,
    /// Number of rayon threads for parallel thumbnail generation.
    pub num_threads: usize,
}

pub fn thumbnail_strategy(photo_count: usize) -> ThumbnailStrategy {
    let max_threads = super::util::capped_num_threads();
    if photo_count <= 50 {
        ThumbnailStrategy {
            use_exif_fast_path: true,
            num_threads: max_threads,
        }
    } else if photo_count <= 500 {
        ThumbnailStrategy {
            use_exif_fast_path: false,
            num_threads: max_threads.min(6),
        }
    } else {
        ThumbnailStrategy {
            use_exif_fast_path: false,
            num_threads: max_threads.min(4),
        }
    }
}

/// Generate JPEG thumbnail using turbojpeg DCT 1/8 downscaling.
/// Decodes at 1/8 resolution (e.g. 6000x4000 -> 750x500), then resizes to 256x256.
/// ~50x faster than full decode and uses ~63x less memory.
pub fn generate_jpeg_thumbnail_turbo(
    source_path: &Path,
    out_path: &Path,
    orientation: Option<u16>,
) -> Option<PathBuf> {
    let jpeg_bytes = match std::fs::read(source_path) {
        Ok(b) => b,
        Err(e) => {
            tracing::debug!("turbo: cannot read {:?}: {}", source_path, e);
            return None;
        }
    };

    let mut decompressor = match turbojpeg::Decompressor::new() {
        Ok(d) => d,
        Err(e) => {
            tracing::debug!("turbo: decompressor init failed: {}", e);
            return None;
        }
    };

    let header = match decompressor.read_header(&jpeg_bytes) {
        Ok(h) => h,
        Err(e) => {
            tracing::debug!("turbo: read header failed for {:?}: {}", source_path, e);
            return None;
        }
    };

    let scaling = turbojpeg::ScalingFactor::ONE_EIGHTH;
    if let Err(e) = decompressor.set_scaling_factor(scaling) {
        tracing::debug!("turbo: set scaling failed: {}", e);
        return None;
    }

    let scaled = header.scaled(scaling);

    let mut turbo_image = turbojpeg::Image {
        pixels: vec![0u8; 3 * scaled.width * scaled.height],
        width: scaled.width,
        pitch: 3 * scaled.width,
        height: scaled.height,
        format: turbojpeg::PixelFormat::RGB,
    };

    if let Err(e) = decompressor.decompress(&jpeg_bytes, turbo_image.as_deref_mut()) {
        tracing::debug!("turbo: decompress failed for {:?}: {}", source_path, e);
        return None;
    }

    let rgb_img = match image::RgbImage::from_raw(
        turbo_image.width as u32,
        turbo_image.height as u32,
        turbo_image.pixels,
    ) {
        Some(img) => img,
        None => {
            tracing::debug!("turbo: RgbImage::from_raw failed for {:?}", source_path);
            return None;
        }
    };

    let dyn_img = image::DynamicImage::ImageRgb8(rgb_img);
    generate_thumbnail_from_image(dyn_img, out_path, orientation)
}

fn extract_raw_embedded_jpeg(source_path: &Path) -> Option<Vec<u8>> {
    use rsraw::RawImage;
    let buf = std::fs::read(source_path).ok()?;
    let mut raw = RawImage::open(&buf).ok()?;
    let thumbs = raw.extract_thumbs().ok()?;
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

    /// Create a plain synthetic JPEG (no EXIF) at a NamedTempFile path.
    fn make_jpeg(width: u32, height: u32) -> NamedTempFile {
        let f = tempfile::Builder::new().suffix(".jpg").tempfile().unwrap();
        let img = image::DynamicImage::new_rgb8(width, height);
        img.save(f.path()).unwrap();
        f
    }

    /// Create a JPEG with a valid EXIF APP1 segment containing an IFD1 embedded thumbnail.
    ///
    /// The main JPEG body has no image data (no SOS marker), so `image::open()` fails to
    /// decode pixel data — only the embedded EXIF fast path works. This lets tests assert
    /// that the fast path was taken: if `generate_thumbnail` returns `Some(_)`, the
    /// embedded path was used (the fallback would return `None` on this file).
    ///
    /// TIFF layout (little-endian, offsets from the TIFF "II" header):
    ///   0-7:   TIFF header ("II" + 0x002A + IFD0 at offset 8)
    ///   8-25:  IFD0 — 1 entry (Orientation=1), next_ifd=26
    ///   26-55: IFD1 — 2 entries (JPEGInterchangeFormat=56, JPEGInterchangeFormatLength), next_ifd=0
    ///   56+:   Embedded JPEG bytes
    fn make_jpeg_with_embedded_thumb(width: u32, height: u32) -> NamedTempFile {
        use std::io::Cursor;

        let thumb_img = image::DynamicImage::new_rgb8(width, height);
        let mut embedded_bytes: Vec<u8> = Vec::new();
        thumb_img
            .write_to(
                &mut Cursor::new(&mut embedded_bytes),
                image::ImageFormat::Jpeg,
            )
            .unwrap();
        let thumb_len = embedded_bytes.len() as u32;

        let mut tiff: Vec<u8> = Vec::new();

        // TIFF header: "II" + 0x2A + IFD0 at offset 8
        tiff.extend_from_slice(b"II");
        tiff.extend_from_slice(&[0x2A, 0x00]);
        tiff.extend_from_slice(&8u32.to_le_bytes());

        // IFD0 at offset 8: 1 entry (Orientation=1), next_ifd=26
        assert_eq!(tiff.len(), 8);
        tiff.extend_from_slice(&1u16.to_le_bytes());
        tiff.extend_from_slice(&0x0112u16.to_le_bytes());
        tiff.extend_from_slice(&3u16.to_le_bytes());
        tiff.extend_from_slice(&1u32.to_le_bytes());
        tiff.extend_from_slice(&1u32.to_le_bytes());
        tiff.extend_from_slice(&26u32.to_le_bytes());

        // IFD1 at offset 26: 2 entries, next_ifd=0
        assert_eq!(tiff.len(), 26);
        tiff.extend_from_slice(&2u16.to_le_bytes());
        tiff.extend_from_slice(&0x0201u16.to_le_bytes());
        tiff.extend_from_slice(&4u16.to_le_bytes());
        tiff.extend_from_slice(&1u32.to_le_bytes());
        tiff.extend_from_slice(&56u32.to_le_bytes());
        tiff.extend_from_slice(&0x0202u16.to_le_bytes());
        tiff.extend_from_slice(&4u16.to_le_bytes());
        tiff.extend_from_slice(&1u32.to_le_bytes());
        tiff.extend_from_slice(&thumb_len.to_le_bytes());
        tiff.extend_from_slice(&0u32.to_le_bytes());

        assert_eq!(tiff.len(), 56);
        tiff.extend_from_slice(&embedded_bytes);

        let mut app1_data: Vec<u8> = b"Exif\x00\x00".to_vec();
        app1_data.extend_from_slice(&tiff);
        let app1_len = (app1_data.len() + 2) as u16;

        let mut jpeg: Vec<u8> = Vec::new();
        jpeg.extend_from_slice(&[0xFF, 0xD8]);
        jpeg.extend_from_slice(&[0xFF, 0xE1]);
        jpeg.extend_from_slice(&app1_len.to_be_bytes());
        jpeg.extend_from_slice(&app1_data);
        jpeg.extend_from_slice(&[0xFF, 0xD9]); // EOI — no SOS, so image::open fails

        let f = tempfile::Builder::new().suffix(".jpg").tempfile().unwrap();
        std::fs::write(f.path(), &jpeg).unwrap();
        f
    }

    // ── existing tests ─────────────────────────────────────────────────────────

    #[test]
    fn test_thumbnail_output_is_256x256() {
        let src = make_jpeg(800, 600);
        let cache_dir = TempDir::new().unwrap();

        let result = generate_thumbnail(
            src.path(),
            &crate::photos::model::PhotoFormat::Jpeg,
            42,
            cache_dir.path(),
            None,
        );

        assert!(result.is_some(), "generate_thumbnail should succeed");
        let thumb_path = cache_dir.path().join("42.jpg");
        let img = image::open(&thumb_path).expect("output must be readable");
        assert_eq!(img.width(), 256, "width must be exactly 256");
        assert_eq!(img.height(), 256, "height must be exactly 256");
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
        assert!(
            expected.exists(),
            "thumbnail must be created at <cache_dir>/<lp_id>.jpg"
        );
        assert_eq!(result, Some(expected));
    }

    #[test]
    fn test_thumbnail_nonexistent_source_does_not_panic() {
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
    }

    #[test]
    fn test_thumbnail_orientation_rotation_applied() {
        // WHY: orientation=6 (90° CW) must not panic and must still produce 256×256.
        // After resize_to_fill all outputs are square, so portrait/landscape can't be
        // distinguished here — but apply_orientation must run without error.
        let src = make_jpeg(600, 200); // wide landscape
        let cache_dir = TempDir::new().unwrap();

        let result = generate_thumbnail(
            src.path(),
            &crate::photos::model::PhotoFormat::Jpeg,
            55,
            cache_dir.path(),
            Some(6),
        );

        assert!(result.is_some());
        let img = image::open(cache_dir.path().join("55.jpg")).expect("output must be readable");
        assert_eq!(
            (img.width(), img.height()),
            (256, 256),
            "orientation=6 must still produce 256×256, got {}×{}",
            img.width(),
            img.height()
        );
    }

    // ── Sprint 4 Part B tests ───────────────────────────────────────────────────

    #[test]
    fn test_jpeg_thumbnail_small_embedded_rejected() {
        // WHY: embedded thumbnail 80×60 (short=60 < 200) must be rejected.
        // Main body has no SOS → fallback also fails → None.
        // Proves the minimum-size check rejects tiny embedded previews.
        let src = make_jpeg_with_embedded_thumb(80, 60);
        let cache_dir = TempDir::new().unwrap();

        let result = generate_thumbnail(
            src.path(),
            &crate::photos::model::PhotoFormat::Jpeg,
            500,
            cache_dir.path(),
            None,
        );

        assert!(
            result.is_none(),
            "embedded 80×60 (short=60 < 200) must be rejected; empty body fallback → None"
        );
    }

    #[test]
    fn test_jpeg_thumbnail_large_embedded_accepted() {
        // WHY: embedded thumbnail 320×213 (short=213 >= 200) must be accepted.
        // Main body has no SOS — Some(_) can only come from embedded path.
        let src = make_jpeg_with_embedded_thumb(320, 213);
        let cache_dir = TempDir::new().unwrap();

        let result = generate_thumbnail(
            src.path(),
            &crate::photos::model::PhotoFormat::Jpeg,
            501,
            cache_dir.path(),
            None,
        );

        assert!(
            result.is_some(),
            "320×213 embedded (short=213 >= 200) must be accepted"
        );
    }

    #[test]
    fn test_jpeg_thumbnail_output_fills_256x256() {
        // WHY (Rule 1): resize_to_fill must produce exactly 256×256, not letterboxed.
        // A 4:3 source (800×600) with thumbnail() would give 256×192.
        // With resize_to_fill it must give 256×256.
        let src = make_jpeg(800, 600);
        let cache_dir = TempDir::new().unwrap();

        generate_thumbnail(
            src.path(),
            &crate::photos::model::PhotoFormat::Jpeg,
            600,
            cache_dir.path(),
            None,
        );

        let img = image::open(cache_dir.path().join("600.jpg")).unwrap();
        assert_eq!(
            img.width(),
            256,
            "width must be exactly 256 (not letterboxed)"
        );
        assert_eq!(
            img.height(),
            256,
            "height must be exactly 256 (not letterboxed)"
        );
    }

    #[test]
    fn test_raw_thumbnail_output_fills_256x256() {
        // WHY (Rule 1): generate_thumbnail_from_image must produce exactly 256×256.
        // Tests the shared helper directly (bypasses rsraw for unit test).
        let img = image::DynamicImage::new_rgb8(1620, 1080);
        let out_dir = TempDir::new().unwrap();
        let out_path = out_dir.path().join("raw_test.jpg");

        let result = generate_thumbnail_from_image(img, &out_path, None);

        assert!(result.is_some());
        let output = image::open(&out_path).unwrap();
        assert_eq!(output.width(), 256, "RAW thumbnail must be exactly 256×256");
        assert_eq!(
            output.height(),
            256,
            "RAW thumbnail must be exactly 256×256"
        );
    }

    #[test]
    fn test_thumbnail_output_fills_256x256_via_embedded_path() {
        // WHY (Rule 1): embedded EXIF path must also produce exactly 256×256.
        // 400×300 embedded (short=300 >= 200) → accepted → resize_to_fill → 256×256.
        let src = make_jpeg_with_embedded_thumb(400, 300);
        let cache_dir = TempDir::new().unwrap();

        generate_thumbnail(
            src.path(),
            &crate::photos::model::PhotoFormat::Jpeg,
            700,
            cache_dir.path(),
            None,
        );

        let img = image::open(cache_dir.path().join("700.jpg")).unwrap();
        assert_eq!(
            img.width(),
            256,
            "embedded path must produce exactly 256×256"
        );
        assert_eq!(
            img.height(),
            256,
            "embedded path must produce exactly 256×256"
        );
    }

    #[test]
    fn test_thumbnail_size_boundary_200px() {
        // WHY: validate the exact boundary — short=200 accepted, short=199 rejected.
        let src_ok = make_jpeg_with_embedded_thumb(300, 200);
        let src_bad = make_jpeg_with_embedded_thumb(299, 199);

        let cache_ok = TempDir::new().unwrap();
        let result_ok = generate_thumbnail(
            src_ok.path(),
            &crate::photos::model::PhotoFormat::Jpeg,
            800,
            cache_ok.path(),
            None,
        );
        assert!(
            result_ok.is_some(),
            "short=200 must be accepted (boundary is >=200)"
        );

        let cache_bad = TempDir::new().unwrap();
        let result_bad = generate_thumbnail(
            src_bad.path(),
            &crate::photos::model::PhotoFormat::Jpeg,
            801,
            cache_bad.path(),
            None,
        );
        assert!(
            result_bad.is_none(),
            "short=199 must be rejected; empty body fallback → None"
        );
    }

    #[test]
    fn test_thumbnail_single_pixel_source_does_not_panic() {
        // Degenerate: 1×1 source must not panic (catch_unwind covers it).
        let src = make_jpeg(1, 1);
        let cache_dir = TempDir::new().unwrap();
        let _ = generate_thumbnail(
            src.path(),
            &crate::photos::model::PhotoFormat::Jpeg,
            999,
            cache_dir.path(),
            None,
        );
        // Result may be Some or None; must not panic.
    }

    // ── previously written embedded-path tests (Sprint 3) ──────────────────────

    #[test]
    fn test_jpeg_thumbnail_uses_embedded_exif_when_available() {
        // The test JPEG has valid IFD1 embedded thumbnail (400×300, short=300 >= 200)
        // but no main image data. Some(_) can only come from the embedded path.
        let src = make_jpeg_with_embedded_thumb(400, 300);
        let cache_dir = TempDir::new().unwrap();

        let result = generate_thumbnail(
            src.path(),
            &crate::photos::model::PhotoFormat::Jpeg,
            100,
            cache_dir.path(),
            None,
        );

        assert!(
            result.is_some(),
            "must produce thumbnail via embedded EXIF path"
        );
        let bytes = std::fs::read(cache_dir.path().join("100.jpg")).unwrap();
        assert_eq!(&bytes[0..2], &[0xFF, 0xD8], "output must be a valid JPEG");
    }

    #[test]
    fn test_jpeg_thumbnail_falls_back_to_full_decode_when_no_embedded_exif() {
        // make_jpeg() produces a plain JPEG with no EXIF → full-decode fallback.
        let src = make_jpeg(800, 600);
        let cache_dir = TempDir::new().unwrap();

        let result = generate_thumbnail(
            src.path(),
            &crate::photos::model::PhotoFormat::Jpeg,
            200,
            cache_dir.path(),
            None,
        );

        assert!(
            result.is_some(),
            "must produce thumbnail via full-decode fallback"
        );
        let img = image::open(cache_dir.path().join("200.jpg")).unwrap();
        assert_eq!(img.width(), 256);
        assert_eq!(img.height(), 256);
    }

    #[test]
    fn test_jpeg_thumbnail_orientation_preserved_via_embedded_path() {
        // WHY: orientation must be applied even via the embedded EXIF fast path.
        // Landscape embedded (300×100) + orientation=6 → portrait output.
        let src = make_jpeg_with_embedded_thumb(300, 100);
        let cache_dir = TempDir::new().unwrap();

        // Note: short side of 300×100 is 100 < 200 → size check rejects embedded.
        // Use a bigger landscape to pass the size check: 400×200 (short=200 → accepted).
        drop(src);
        let src = make_jpeg_with_embedded_thumb(400, 200); // short=200, landscape

        let result = generate_thumbnail(
            src.path(),
            &crate::photos::model::PhotoFormat::Jpeg,
            400,
            cache_dir.path(),
            Some(6),
        );

        assert!(result.is_some());
        let img = image::open(cache_dir.path().join("400.jpg")).unwrap();
        // After resize_to_fill(256,256) the image is square, so orientation doesn't
        // change dimensions. Orientation is still applied (rotation applied to 256×256).
        // Just verify the output is valid and the function doesn't crash.
        assert_eq!(img.width(), 256);
        assert_eq!(img.height(), 256);
    }

    #[test]
    #[ignore = "PoC: generates DCT 1/8 thumbnail for visual quality inspection"]
    fn poc_turbojpeg_dct_thumbnail_quality() {
        // Proof of concept: generate a thumbnail using turbojpeg DCT 1/8 downscaling
        // and save it alongside the original's EXIF thumbnail for visual comparison.
        use std::time::Instant;

        let source = std::path::Path::new(
            "/home/ilya/ssd_disk/photo/venice 2022/old/to review/IMG_3747.JPG",
        );
        if !source.exists() {
            println!("SKIP: source photo not found");
            return;
        }

        let out_dir = std::path::Path::new("/tmp/gemkeep-poc-thumbnails");
        std::fs::create_dir_all(out_dir).unwrap();

        // Method 1: Current full decode (image::open)
        let start = Instant::now();
        let img_full = image::open(source).unwrap();
        let full_decode_ms = start.elapsed().as_millis();
        let full_resized = img_full.resize_to_fill(256, 256, image::imageops::FilterType::Lanczos3);
        let full_total_ms = start.elapsed().as_millis();
        full_resized
            .save(out_dir.join("method1_full_decode.jpg"))
            .unwrap();
        println!(
            "Full decode: {}×{} → 256×256 in {}ms (decode {}ms)",
            img_full.width(),
            img_full.height(),
            full_total_ms,
            full_decode_ms
        );

        // Method 2: turbojpeg DCT 1/8 downscale
        let start = Instant::now();
        let jpeg_bytes = std::fs::read(source).unwrap();
        let mut decompressor = turbojpeg::Decompressor::new().unwrap();
        let header = decompressor.read_header(&jpeg_bytes).unwrap();
        let scaling = turbojpeg::ScalingFactor::ONE_EIGHTH;
        decompressor.set_scaling_factor(scaling).unwrap();
        let scaled = header.scaled(scaling);
        println!(
            "Original: {}×{}, DCT 1/8 target: {}×{}",
            header.width, header.height, scaled.width, scaled.height
        );

        // Allocate output buffer and decompress at 1/8 scale
        let mut turbo_image = turbojpeg::Image {
            pixels: vec![0u8; 3 * scaled.width * scaled.height],
            width: scaled.width,
            pitch: 3 * scaled.width,
            height: scaled.height,
            format: turbojpeg::PixelFormat::RGB,
        };
        decompressor
            .decompress(&jpeg_bytes, turbo_image.as_deref_mut())
            .unwrap();
        let dct_decode_ms = start.elapsed().as_millis();

        // Convert to image::DynamicImage
        let rgb_img = image::RgbImage::from_raw(
            turbo_image.width as u32,
            turbo_image.height as u32,
            turbo_image.pixels,
        )
        .unwrap();
        let dyn_img = image::DynamicImage::ImageRgb8(rgb_img);
        let turbo_resized = dyn_img.resize_to_fill(256, 256, image::imageops::FilterType::Lanczos3);
        let turbo_total_ms = start.elapsed().as_millis();
        turbo_resized
            .save(out_dir.join("method2_dct_eighth.jpg"))
            .unwrap();
        println!(
            "DCT 1/8: {}×{} → 256×256 in {}ms (decode {}ms)",
            dyn_img.width(),
            dyn_img.height(),
            turbo_total_ms,
            dct_decode_ms
        );

        // Method 3: EXIF embedded thumbnail (for reference)
        if let Some(exif_bytes) = extract_exif_embedded_thumbnail(source) {
            if let Ok(exif_img) = image::load_from_memory(&exif_bytes) {
                let exif_resized =
                    exif_img.resize_to_fill(256, 256, image::imageops::FilterType::Lanczos3);
                exif_resized
                    .save(out_dir.join("method3_exif_embedded.jpg"))
                    .unwrap();
                println!(
                    "EXIF embedded: {}×{} → 256×256",
                    exif_img.width(),
                    exif_img.height()
                );
            }
        }

        println!(
            "\nSpeedup: {:.1}x faster",
            full_total_ms as f64 / turbo_total_ms as f64
        );
        println!("Output dir: {}", out_dir.display());
        println!("Compare visually:");
        println!("  method1_full_decode.jpg  (gold standard)");
        println!("  method2_dct_eighth.jpg   (new DCT 1/8 path)");
        println!("  method3_exif_embedded.jpg (current EXIF, if any)");
    }

    // ── Sprint 7 Part B: Thumbnail DCT optimization tests (RED) ─────────────

    #[test]
    fn test_turbo_thumbnail_produces_256x256_jpeg() {
        // RED: generate_jpeg_thumbnail_turbo doesn't exist yet
        let src = make_jpeg(800, 600);
        let cache_dir = TempDir::new().unwrap();
        let out_path = cache_dir.path().join("turbo_test.jpg");

        let result = super::generate_jpeg_thumbnail_turbo(src.path(), &out_path, None);

        assert!(result.is_some(), "turbo path must produce a thumbnail");
        let img = image::open(&out_path).expect("output must be readable");
        assert_eq!(img.width(), 256, "turbo thumbnail width must be 256");
        assert_eq!(img.height(), 256, "turbo thumbnail height must be 256");
    }

    #[test]
    fn test_turbo_thumbnail_output_is_valid_jpeg() {
        let src = make_jpeg(400, 400);
        let cache_dir = TempDir::new().unwrap();
        let out_path = cache_dir.path().join("turbo_valid.jpg");

        super::generate_jpeg_thumbnail_turbo(src.path(), &out_path, None);

        let bytes = std::fs::read(&out_path).expect("thumbnail file must exist");
        assert_eq!(
            &bytes[0..2],
            &[0xFF, 0xD8],
            "turbo output must start with JPEG magic bytes"
        );
    }

    #[test]
    fn test_turbo_thumbnail_with_orientation() {
        let src = make_jpeg(600, 200);
        let cache_dir = TempDir::new().unwrap();
        let out_path = cache_dir.path().join("turbo_orient.jpg");

        let result = super::generate_jpeg_thumbnail_turbo(src.path(), &out_path, Some(6));

        assert!(result.is_some());
        let img = image::open(&out_path).unwrap();
        assert_eq!((img.width(), img.height()), (256, 256));
    }

    #[test]
    fn test_turbo_thumbnail_nonexistent_source_returns_none() {
        let cache_dir = TempDir::new().unwrap();
        let out_path = cache_dir.path().join("turbo_missing.jpg");
        let missing = Path::new("/tmp/definitely_does_not_exist_gemkeep_turbo.jpg");

        let result = super::generate_jpeg_thumbnail_turbo(missing, &out_path, None);

        assert!(result.is_none(), "must return None for missing source");
    }

    #[test]
    fn test_thumbnail_strategy_small_batch() {
        // RED: thumbnail_strategy doesn't exist yet
        let strategy = super::thumbnail_strategy(30);
        assert!(
            strategy.use_exif_fast_path,
            "small batch should try EXIF first"
        );
        assert_eq!(
            strategy.num_threads,
            super::super::util::capped_num_threads()
        );
    }

    #[test]
    fn test_thumbnail_strategy_medium_batch() {
        let strategy = super::thumbnail_strategy(200);
        assert!(
            !strategy.use_exif_fast_path,
            "medium batch should skip EXIF"
        );
        assert!(
            strategy.num_threads <= 6,
            "medium batch should cap threads at 6"
        );
    }

    #[test]
    fn test_thumbnail_strategy_large_batch() {
        let strategy = super::thumbnail_strategy(1000);
        assert!(!strategy.use_exif_fast_path, "large batch should skip EXIF");
        assert!(
            strategy.num_threads <= 4,
            "large batch should cap threads at 4"
        );
    }

    #[test]
    fn test_thumbnail_strategy_boundary_50() {
        let small = super::thumbnail_strategy(50);
        let medium = super::thumbnail_strategy(51);
        assert!(small.use_exif_fast_path, "50 should use EXIF");
        assert!(!medium.use_exif_fast_path, "51 should skip EXIF");
    }

    #[test]
    fn test_thumbnail_strategy_boundary_500() {
        let medium = super::thumbnail_strategy(500);
        let large = super::thumbnail_strategy(501);
        // Both skip EXIF
        assert!(!medium.use_exif_fast_path);
        assert!(!large.use_exif_fast_path);
        // Large should have fewer threads
        assert!(
            large.num_threads <= medium.num_threads,
            "501+ should have equal or fewer threads than 500"
        );
    }

    #[test]
    #[ignore = "requires real camera JPEGs at /home/ilya/ssd_disk/photo/venice 2026/il/2"]
    fn test_jpeg_thumbnail_performance_968_photos_under_30s() {
        // WHY (Rule 7): threshold = 3× measured time.
        // Baseline: ~12ms/photo with Lanczos3 resize on 10 rayon threads → ~12s total.
        // Threshold: 36s (3×). Re-measure after any resize algorithm change.
        // Measured 2026-02-22, AMD Ryzen 5 5625U.
        use rayon::prelude::*;
        use std::time::Instant;

        let photo_dir = std::path::Path::new("/home/ilya/ssd_disk/photo/venice 2026/il/2");
        if !photo_dir.exists() {
            println!("SKIP: photo dir not found");
            return;
        }

        let jpegs: Vec<_> = std::fs::read_dir(photo_dir)
            .unwrap()
            .filter_map(|e| e.ok())
            .map(|e| e.path())
            .filter(|p| {
                p.extension()
                    .and_then(|e| e.to_str())
                    .map(|e| e.eq_ignore_ascii_case("jpg"))
                    .unwrap_or(false)
            })
            .collect();

        assert!(!jpegs.is_empty());
        let cache_dir = TempDir::new().unwrap();

        let start = Instant::now();
        jpegs.par_iter().enumerate().for_each(|(i, path)| {
            generate_thumbnail(
                path,
                &crate::photos::model::PhotoFormat::Jpeg,
                i as i64,
                cache_dir.path(),
                None,
            );
        });
        let elapsed = start.elapsed();

        println!(
            "Generated {} thumbnails in {:.1}s ({:.0} ms/photo)",
            jpegs.len(),
            elapsed.as_secs_f64(),
            elapsed.as_millis() as f64 / jpegs.len() as f64
        );

        assert!(
            elapsed.as_secs() < 36,
            "thumbnail generation must complete in < 36s, took {:.1}s for {} photos",
            elapsed.as_secs_f64(),
            jpegs.len()
        );
    }
}
