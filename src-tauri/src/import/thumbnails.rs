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

/// Try to extract the EXIF IFD1 embedded JPEG thumbnail from a camera JPEG.
///
/// Camera JPEGs typically embed a ~160×120 preview in the EXIF APP1 block (IFD1).
/// Extracting this is ~50× faster than decoding the full 6MP+ image.
/// Returns None if no embedded thumbnail is present or on any parse error.
fn extract_exif_embedded_thumbnail(source_path: &Path) -> Option<Vec<u8>> {
    let file = std::fs::File::open(source_path).ok()?;
    let mut buf_reader = std::io::BufReader::new(file);
    let exif = exif::Reader::new()
        .read_from_container(&mut buf_reader)
        .ok()?;

    let offset_field =
        exif.get_field(exif::Tag::JPEGInterchangeFormat, exif::In::THUMBNAIL)?;
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
fn apply_orientation(
    img: image::DynamicImage,
    orientation: Option<u16>,
) -> image::DynamicImage {
    match orientation {
        Some(3) => img.rotate180(),
        Some(6) => img.rotate90(),
        Some(8) => img.rotate270(),
        Some(o) if matches!(o, 2 | 4 | 5 | 7) => {
            tracing::debug!("thumbnail: orientation {} (mirror) not applied", o);
            img
        }
        _ => img, // 1 or None: no rotation needed
    }
}

/// Decode `jpeg_bytes`, resize to fit 256×256, apply orientation, and save.
/// Returns the output path on success, None on any failure.
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

    let thumbnail = apply_orientation(img.thumbnail(256, 256), orientation);

    ensure_parent_dir(out_path)?;

    match thumbnail.save(out_path) {
        Ok(_) => {
            tracing::debug!("thumbnail saved from embedded bytes to {:?}", out_path);
            Some(out_path.to_path_buf())
        }
        Err(e) => {
            tracing::warn!("thumbnail: save failed for {:?}: {}", out_path, e);
            None
        }
    }
}

fn generate_jpeg_thumbnail(
    source_path: &Path,
    out_path: &Path,
    orientation: Option<u16>,
) -> Option<PathBuf> {
    // Fast path: extract EXIF IFD1 embedded thumbnail (~160×120, ~30 KB vs 6 MB full decode).
    // Camera JPEGs always carry this; extracting it is ~50× faster than image::open.
    if let Some(bytes) = extract_exif_embedded_thumbnail(source_path) {
        if let Some(result) = generate_thumbnail_from_bytes(&bytes, out_path, orientation) {
            tracing::debug!("thumbnail: embedded EXIF path for {:?}", source_path);
            return Some(result);
        }
        tracing::debug!(
            "thumbnail: embedded bytes present but invalid, falling back for {:?}",
            source_path
        );
    }

    // Fallback: full JPEG decode (slow ~1-4 s/photo, used when no embedded thumbnail).
    tracing::debug!("thumbnail: full decode fallback for {:?}", source_path);
    let img = match image::open(source_path) {
        Ok(i) => i,
        Err(e) => {
            tracing::debug!("thumbnail: cannot open JPEG {:?}: {}", source_path, e);
            return None;
        }
    };

    let thumbnail = apply_orientation(img.thumbnail(256, 256), orientation);

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

        // Generate the embedded thumbnail JPEG in memory.
        let thumb_img = image::DynamicImage::new_rgb8(width, height);
        let mut embedded_bytes: Vec<u8> = Vec::new();
        thumb_img
            .write_to(
                &mut Cursor::new(&mut embedded_bytes),
                image::ImageFormat::Jpeg,
            )
            .unwrap();
        let thumb_len = embedded_bytes.len() as u32;

        // Build TIFF block (little-endian).
        let mut tiff: Vec<u8> = Vec::new();

        // TIFF header: "II" + 0x2A + IFD0 at offset 8
        tiff.extend_from_slice(b"II");
        tiff.extend_from_slice(&[0x2A, 0x00]);
        tiff.extend_from_slice(&8u32.to_le_bytes());

        // IFD0 at offset 8: 1 entry (Orientation=1), next_ifd=26
        assert_eq!(tiff.len(), 8);
        tiff.extend_from_slice(&1u16.to_le_bytes()); // count=1
        // Orientation (0x0112), SHORT (3), count=1, inline value=1
        tiff.extend_from_slice(&0x0112u16.to_le_bytes());
        tiff.extend_from_slice(&3u16.to_le_bytes());
        tiff.extend_from_slice(&1u32.to_le_bytes());
        tiff.extend_from_slice(&1u32.to_le_bytes()); // value=1 (normal)
        tiff.extend_from_slice(&26u32.to_le_bytes()); // next_ifd → IFD1 at 26
        // IFD0: 2 + 12 + 4 = 18 bytes → ends at 26 ✓

        // IFD1 at offset 26: 2 entries, next_ifd=0
        assert_eq!(tiff.len(), 26);
        tiff.extend_from_slice(&2u16.to_le_bytes()); // count=2
        // JPEGInterchangeFormat (0x0201), LONG (4), count=1, value=56 (offset of embedded JPEG)
        tiff.extend_from_slice(&0x0201u16.to_le_bytes());
        tiff.extend_from_slice(&4u16.to_le_bytes());
        tiff.extend_from_slice(&1u32.to_le_bytes());
        tiff.extend_from_slice(&56u32.to_le_bytes());
        // JPEGInterchangeFormatLength (0x0202), LONG (4), count=1, value=thumb_len
        tiff.extend_from_slice(&0x0202u16.to_le_bytes());
        tiff.extend_from_slice(&4u16.to_le_bytes());
        tiff.extend_from_slice(&1u32.to_le_bytes());
        tiff.extend_from_slice(&thumb_len.to_le_bytes());
        tiff.extend_from_slice(&0u32.to_le_bytes()); // next_ifd=0
        // IFD1: 2 + 12 + 12 + 4 = 30 bytes → ends at 56 ✓

        // Embedded JPEG bytes at offset 56
        assert_eq!(tiff.len(), 56);
        tiff.extend_from_slice(&embedded_bytes);

        // Wrap in JPEG envelope: SOI + APP1 + EOI (no image data → image::open fails)
        let mut app1_data: Vec<u8> = b"Exif\x00\x00".to_vec();
        app1_data.extend_from_slice(&tiff);
        let app1_len = (app1_data.len() + 2) as u16;

        let mut jpeg: Vec<u8> = Vec::new();
        jpeg.extend_from_slice(&[0xFF, 0xD8]); // SOI
        jpeg.extend_from_slice(&[0xFF, 0xE1]); // APP1 marker
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

    // ── new TDD tests: embedded EXIF fast path ──────────────────────────────────

    #[test]
    fn test_jpeg_thumbnail_uses_embedded_exif_when_available() {
        // WHY: verify the embedded EXIF fast path is actually taken.
        //
        // Strategy: the test JPEG has a valid IFD1 embedded thumbnail but no main
        // image data (no SOS marker). image::open() fails on the empty body, so the
        // only way generate_thumbnail can return Some(_) is via the embedded path.
        // If the embedded path regresses, this test returns None → assertion fails.
        let src = make_jpeg_with_embedded_thumb(80, 60);
        let cache_dir = TempDir::new().unwrap();

        let result = generate_thumbnail(
            src.path(),
            &crate::photos::model::PhotoFormat::Jpeg,
            100,
            cache_dir.path(),
            None,
        );

        assert!(result.is_some(), "must produce thumbnail via embedded EXIF path");
        let thumb_path = cache_dir.path().join("100.jpg");
        assert!(thumb_path.exists(), "thumbnail file must exist");
        let bytes = std::fs::read(&thumb_path).unwrap();
        assert_eq!(&bytes[0..2], &[0xFF, 0xD8], "output must be a valid JPEG");
    }

    #[test]
    fn test_jpeg_thumbnail_falls_back_to_full_decode_when_no_embedded_exif() {
        // WHY: generate_thumbnail must still work when the JPEG has no embedded EXIF
        // thumbnail (e.g. a web-optimised JPEG stripped of EXIF, or a synthetic image).
        // make_jpeg() produces a plain JPEG with no APP1 → extract_exif_embedded_thumbnail
        // returns None → falls back to image::open (the old slow path).
        let src = make_jpeg(800, 600);
        let cache_dir = TempDir::new().unwrap();

        let result = generate_thumbnail(
            src.path(),
            &crate::photos::model::PhotoFormat::Jpeg,
            200,
            cache_dir.path(),
            None,
        );

        assert!(result.is_some(), "must produce thumbnail via full-decode fallback");
        let thumb_path = cache_dir.path().join("200.jpg");
        let img = image::open(&thumb_path).unwrap();
        assert!(
            img.width() <= 256 && img.height() <= 256,
            "fallback output must fit 256×256, got {}×{}",
            img.width(),
            img.height()
        );
    }

    #[test]
    fn test_jpeg_thumbnail_embedded_output_fits_256px() {
        // WHY (Rule 1 — test output values, not return type): even via the embedded EXIF
        // path, the output must be resized to fit within 256×256. If the resize step is
        // accidentally skipped, the embedded thumbnail (here 400×300) would be saved as-is.
        let src = make_jpeg_with_embedded_thumb(400, 300);
        let cache_dir = TempDir::new().unwrap();

        let result = generate_thumbnail(
            src.path(),
            &crate::photos::model::PhotoFormat::Jpeg,
            300,
            cache_dir.path(),
            None,
        );

        assert!(result.is_some(), "must produce thumbnail via embedded EXIF path");
        let thumb_path = cache_dir.path().join("300.jpg");
        let img = image::open(&thumb_path).unwrap();
        assert!(
            img.width() <= 256 && img.height() <= 256,
            "embedded thumbnail must fit within 256×256, got {}×{}",
            img.width(),
            img.height()
        );
    }

    #[test]
    fn test_jpeg_thumbnail_orientation_preserved_via_embedded_path() {
        // WHY: orientation rotation must be applied even when using the embedded EXIF
        // fast path (the orientation value is separate from the embedded bytes).
        //
        // Strategy: embedded thumbnail is landscape (300×100).
        // Pass orientation=6 (90° CW). After rotation the output must be portrait.
        // If apply_orientation is not called on the embedded decode path, the output
        // stays landscape and the assertion fails.
        let src = make_jpeg_with_embedded_thumb(300, 100); // landscape
        let cache_dir = TempDir::new().unwrap();

        let result = generate_thumbnail(
            src.path(),
            &crate::photos::model::PhotoFormat::Jpeg,
            400,
            cache_dir.path(),
            Some(6), // 90° CW rotation
        );

        assert!(result.is_some(), "must produce thumbnail via embedded EXIF path");
        let thumb_path = cache_dir.path().join("400.jpg");
        let img = image::open(&thumb_path).unwrap();
        assert!(
            img.height() > img.width(),
            "orientation=6 must produce portrait output via embedded path, got {}×{}",
            img.width(),
            img.height()
        );
    }

    #[test]
    #[ignore = "requires real camera JPEGs at /home/ilya/ssd_disk/photo/venice 2026/il/2"]
    fn test_jpeg_thumbnail_performance_968_photos_under_30s() {
        // WHY (Rule 7 — performance threshold at 3× actual measured time):
        // Baseline: ~10 s for ~968 JPEGs with embedded EXIF path on 10 rayon threads.
        // Threshold: 30 s = 3× baseline. Any slowdown that triples latency is a bug.
        use rayon::prelude::*;
        use std::time::Instant;

        let photo_dir =
            std::path::Path::new("/home/ilya/ssd_disk/photo/venice 2026/il/2");
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

        assert!(!jpegs.is_empty(), "should find JPEGs in test folder");
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
            elapsed.as_secs() < 30,
            "thumbnail generation must complete in < 30 s, took {:.1}s for {} photos",
            elapsed.as_secs_f64(),
            jpegs.len()
        );
    }
}
