use crate::photos::model::PhotoFormat;
use std::path::Path;

pub struct ExifData {
    pub capture_time: Option<chrono::DateTime<chrono::Utc>>,
    pub camera_model: Option<String>,
    pub lens: Option<String>,
    pub orientation: Option<u16>,
}

impl ExifData {
    fn empty() -> Self {
        ExifData {
            capture_time: None,
            camera_model: None,
            lens: None,
            orientation: None,
        }
    }
}

/// Extract EXIF metadata from a JPEG file using kamadak-exif.
/// Never panics; returns all-None on any error.
pub fn extract_jpeg_exif(path: &Path) -> ExifData {
    match std::panic::catch_unwind(|| extract_jpeg_exif_inner(path)) {
        Ok(data) => data,
        Err(_) => {
            tracing::warn!("panic in extract_jpeg_exif for {:?}", path);
            ExifData::empty()
        }
    }
}

fn extract_jpeg_exif_inner(path: &Path) -> ExifData {
    let file = match std::fs::File::open(path) {
        Ok(f) => f,
        Err(e) => {
            tracing::debug!("cannot open {:?}: {}", path, e);
            return ExifData::empty();
        }
    };
    let mut buf_reader = std::io::BufReader::new(file);
    let exif_reader = exif::Reader::new();
    let exif = match exif_reader.read_from_container(&mut buf_reader) {
        Ok(e) => e,
        Err(e) => {
            tracing::debug!("no EXIF in {:?}: {}", path, e);
            return ExifData::empty();
        }
    };

    let capture_time = read_datetime_original(&exif);
    let camera_model = read_ascii_tag(&exif, exif::Tag::Model);
    let lens = read_ascii_tag(&exif, exif::Tag::LensModel);
    let orientation = read_orientation(&exif);

    ExifData {
        capture_time,
        camera_model,
        lens,
        orientation,
    }
}

fn read_datetime_original(exif: &exif::Exif) -> Option<chrono::DateTime<chrono::Utc>> {
    let field = exif.get_field(exif::Tag::DateTimeOriginal, exif::In::PRIMARY)?;
    let s = match &field.value {
        exif::Value::Ascii(vecs) => vecs
            .first()
            .and_then(|v| std::str::from_utf8(v).ok())?
            .to_string(),
        _ => return None,
    };
    // EXIF datetime format: "YYYY:MM:DD HH:MM:SS"
    parse_exif_datetime(&s)
}

pub fn parse_exif_datetime(s: &str) -> Option<chrono::DateTime<chrono::Utc>> {
    use chrono::{NaiveDateTime, TimeZone};
    if s.len() < 19 {
        return None;
    }
    // Replace colons in date portion for parsing: "2024:03:15 12:30:45" → "2024-03-15 12:30:45"
    let date = s[..10].replace(':', "-");
    let normalized = format!("{} {}", date, &s[11..19]);
    let ndt = NaiveDateTime::parse_from_str(&normalized, "%Y-%m-%d %H:%M:%S").ok()?;
    Some(chrono::Utc.from_utc_datetime(&ndt))
}

fn read_ascii_tag(exif: &exif::Exif, tag: exif::Tag) -> Option<String> {
    let field = exif.get_field(tag, exif::In::PRIMARY)?;
    match &field.value {
        exif::Value::Ascii(vecs) => {
            let s = vecs
                .first()
                .and_then(|v| std::str::from_utf8(v).ok())?
                .trim()
                .to_string();
            if s.is_empty() {
                None
            } else {
                Some(s)
            }
        }
        _ => None,
    }
}

fn read_orientation(exif: &exif::Exif) -> Option<u16> {
    let field = exif.get_field(exif::Tag::Orientation, exif::In::PRIMARY)?;
    match &field.value {
        exif::Value::Short(v) => v.first().copied(),
        _ => None,
    }
}

/// Extract EXIF metadata from a RAW file using rawler (pure Rust).
/// Never panics; returns all-None on any error.
pub fn extract_raw_exif(path: &Path) -> ExifData {
    match std::panic::catch_unwind(|| extract_raw_exif_inner(path)) {
        Ok(data) => data,
        Err(_) => {
            tracing::warn!("panic in extract_raw_exif for {:?}", path);
            ExifData::empty()
        }
    }
}

fn extract_raw_exif_inner(path: &Path) -> ExifData {
    let rawfile = match rawler::rawsource::RawSource::new(path) {
        Ok(r) => r,
        Err(e) => {
            tracing::debug!("rawler: cannot open RawSource {:?}: {}", path, e);
            return ExifData::empty();
        }
    };

    let decoder = match rawler::get_decoder(&rawfile) {
        Ok(dec) => dec,
        Err(e) => {
            tracing::debug!("rawler: cannot get decoder for {:?}: {:?}", path, e);
            return ExifData::empty();
        }
    };

    let params = rawler::decoders::RawDecodeParams { image_index: 0 };
    let metadata = match decoder.raw_metadata(&rawfile, &params) {
        Ok(m) => m,
        Err(e) => {
            tracing::debug!("rawler: cannot decode metadata for {:?}: {:?}", path, e);
            return ExifData::empty();
        }
    };

    let capture_time = metadata
        .exif
        .date_time_original
        .as_deref()
        .and_then(parse_exif_datetime);

    // Combine make + model, avoiding duplicate prefix
    let camera_model = {
        let make = metadata.make.trim().to_string();
        let model = metadata.model.trim().to_string();
        if model.is_empty() && make.is_empty() {
            None
        } else if model.is_empty() {
            Some(make)
        } else if make.is_empty() || model.starts_with(&make) {
            Some(model)
        } else {
            Some(format!("{} {}", make, model))
        }
    };

    let lens = metadata
        .exif
        .lens_model
        .as_deref()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    let orientation = metadata.exif.orientation;

    ExifData {
        capture_time,
        camera_model,
        lens,
        orientation,
    }
}

/// Dispatch to the correct EXIF extractor based on format.
pub fn extract_exif(path: &Path, format: &PhotoFormat) -> ExifData {
    match format {
        PhotoFormat::Jpeg => extract_jpeg_exif(path),
        PhotoFormat::Raw => extract_raw_exif(path),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_exif_jpeg_no_file() {
        let data = extract_jpeg_exif(Path::new("/nonexistent/path/photo.jpg"));
        assert!(data.capture_time.is_none());
        assert!(data.camera_model.is_none());
        assert!(data.lens.is_none());
        assert!(data.orientation.is_none());
    }

    #[test]
    fn test_exif_jpeg_corrupt() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("corrupt.jpg");
        std::fs::write(&path, b"not a jpeg at all -- garbage data").unwrap();
        let data = extract_jpeg_exif(&path);
        // Must not panic; all fields None
        assert!(data.capture_time.is_none());
    }

    #[test]
    fn test_exif_raw_nonexistent() {
        let data = extract_raw_exif(Path::new("/nonexistent/photo.cr2"));
        assert!(data.capture_time.is_none());
        assert!(data.camera_model.is_none());
    }

    #[test]
    fn test_exif_raw_corrupt() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("bad.cr2");
        std::fs::write(&path, b"garbage not a raw file").unwrap();
        let data = extract_raw_exif(&path);
        assert!(data.capture_time.is_none());
    }

    #[test]
    fn test_parse_exif_datetime_valid() {
        let dt = parse_exif_datetime("2024:03:15 12:30:45");
        assert!(dt.is_some());
        let dt = dt.unwrap();
        assert_eq!(dt.format("%Y-%m-%d").to_string(), "2024-03-15");
    }

    #[test]
    fn test_parse_exif_datetime_invalid() {
        assert!(parse_exif_datetime("not a date").is_none());
        assert!(parse_exif_datetime("").is_none());
        assert!(parse_exif_datetime("short").is_none());
    }

    #[test]
    fn test_exif_jpeg_synthetic_no_exif_returns_none() {
        // WHY: image crate does not embed EXIF when creating an ImageBuffer.
        // A freshly created JPEG has no DateTimeOriginal, Make/Model, or Orientation.
        // This test verifies extract_jpeg_exif returns None for all fields — not a panic.
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("synthetic.jpg");
        let img = image::DynamicImage::new_rgb8(100, 100);
        img.save(&path).unwrap();

        let data = extract_jpeg_exif(&path);

        assert!(
            data.capture_time.is_none(),
            "JPEG without EXIF: capture_time must be None"
        );
        assert!(
            data.camera_model.is_none(),
            "JPEG without EXIF: camera_model must be None"
        );
        assert!(
            data.orientation.is_none(),
            "JPEG without EXIF: orientation must be None"
        );
    }

    #[test]
    fn test_exif_parse_datetime_roundtrip() {
        // Cross-check: parse_exif_datetime produces the correct date/time values.
        // This is the "correctness" gate for EXIF timestamp extraction.
        let dt = parse_exif_datetime("2024:03:15 10:30:00");
        let dt = dt.expect("valid EXIF datetime must parse successfully");
        assert_eq!(dt.format("%Y-%m-%d").to_string(), "2024-03-15");
        assert_eq!(dt.format("%H:%M:%S").to_string(), "10:30:00");
    }

    /// Build a minimal valid JPEG containing an APP1/EXIF segment with a known
    /// DateTimeOriginal and Orientation value.
    ///
    /// The TIFF structure uses the correct IFD layout that kamadak-exif expects:
    ///   - IFD0 (Tag namespace "Tiff"): Orientation (0x0112) + ExifIFD pointer (0x8769)
    ///   - ExifIFD (Tag namespace "Exif"): DateTimeOriginal (0x9003)
    ///
    /// DateTimeOriginal MUST be in the ExifIFD sub-IFD (not IFD0) because kamadak-exif
    /// uses separate namespaces: Tag(Exif, 36867) ≠ Tag(Tiff, 36867). Placing 0x9003
    /// directly in IFD0 makes it Tag(Tiff, 36867) which `get_field(DateTimeOriginal, PRIMARY)`
    /// will not find (it looks for Tag(Exif, 36867)).
    fn make_jpeg_with_known_exif(
        datetime_original: &str,
        orientation: u16,
    ) -> tempfile::NamedTempFile {
        // datetime_original must be exactly 19 chars: "YYYY:MM:DD HH:MM:SS"
        assert_eq!(datetime_original.len(), 19);
        let mut dt_bytes = datetime_original.as_bytes().to_vec();
        dt_bytes.push(0); // null terminator → 20 bytes total

        // TIFF layout (all offsets from start of TIFF header at byte 0):
        //
        //   0..8     TIFF header: "II" + 0x002A + IFD0 offset (8)
        //   8..10    IFD0 entry count: 2
        //   10..22   IFD0 entry 0: Orientation (0x0112), SHORT, count=1, inline value
        //   22..34   IFD0 entry 1: ExifIFD ptr (0x8769), LONG, count=1, inline offset→58
        //   34..38   IFD0 next-IFD pointer: 0
        //   --- gap to align ExifIFD at offset 38 ---
        //   38..40   ExifIFD entry count: 1
        //   40..52   ExifIFD entry 0: DateTimeOriginal (0x9003), ASCII, count=20, offset→52
        //            (offset 52 from TIFF start = right after this 12-byte entry)
        //   52..56   ExifIFD next-IFD pointer: 0
        //   56..76   DateTimeOriginal value (20 bytes)

        // Offsets (from TIFF header start):
        // IFD0 at 8, ExifIFD at 38, DateTimeOriginal value at 56
        let exif_ifd_offset: u32 = 38;
        let dt_value_offset: u32 = 56;

        let mut tiff: Vec<u8> = Vec::new();

        // TIFF header (8 bytes)
        tiff.extend_from_slice(b"II");                    // little-endian
        tiff.extend_from_slice(&[0x2A, 0x00]);            // TIFF magic
        tiff.extend_from_slice(&8u32.to_le_bytes());      // IFD0 at offset 8

        // IFD0: 2 entries (tags in ascending order: 0x0112 < 0x8769)
        tiff.extend_from_slice(&2u16.to_le_bytes());      // entry count

        // IFD0 entry 0: Orientation (0x0112), SHORT (3), count=1, inline value
        tiff.extend_from_slice(&0x0112u16.to_le_bytes()); // tag
        tiff.extend_from_slice(&3u16.to_le_bytes());       // type SHORT
        tiff.extend_from_slice(&1u32.to_le_bytes());       // count
        tiff.extend_from_slice(&(orientation as u32).to_le_bytes()); // value (inline, padded to 4)

        // IFD0 entry 1: ExifIFD pointer (0x8769), LONG (4), count=1, offset to ExifIFD
        tiff.extend_from_slice(&0x8769u16.to_le_bytes()); // tag
        tiff.extend_from_slice(&4u16.to_le_bytes());       // type LONG
        tiff.extend_from_slice(&1u32.to_le_bytes());       // count
        tiff.extend_from_slice(&exif_ifd_offset.to_le_bytes()); // ExifIFD offset

        // IFD0 next-IFD pointer
        tiff.extend_from_slice(&0u32.to_le_bytes());

        // Verify we are at offset 38 now (ExifIFD starts here)
        assert_eq!(tiff.len(), exif_ifd_offset as usize);

        // ExifIFD: 1 entry
        tiff.extend_from_slice(&1u16.to_le_bytes()); // entry count

        // ExifIFD entry 0: DateTimeOriginal (0x9003), ASCII (2), count=20, offset to value
        tiff.extend_from_slice(&0x9003u16.to_le_bytes()); // tag
        tiff.extend_from_slice(&2u16.to_le_bytes());       // type ASCII
        tiff.extend_from_slice(&20u32.to_le_bytes());      // count (19 chars + null)
        tiff.extend_from_slice(&dt_value_offset.to_le_bytes()); // offset to value

        // ExifIFD next-IFD pointer
        tiff.extend_from_slice(&0u32.to_le_bytes());

        // Verify we are at offset 56 (DateTimeOriginal value starts here)
        assert_eq!(tiff.len(), dt_value_offset as usize);

        // DateTimeOriginal value (20 bytes: 19 chars + null)
        tiff.extend_from_slice(&dt_bytes);

        // Build APP1 segment: "Exif\0\0" + TIFF payload
        let mut app1_data = b"Exif\x00\x00".to_vec();
        app1_data.extend_from_slice(&tiff);
        let app1_len = (app1_data.len() + 2) as u16; // +2 for the length field itself

        let mut jpeg: Vec<u8> = Vec::new();
        jpeg.extend_from_slice(&[0xFF, 0xD8]); // SOI
        jpeg.extend_from_slice(&[0xFF, 0xE1]); // APP1 marker
        jpeg.extend_from_slice(&app1_len.to_be_bytes());
        jpeg.extend_from_slice(&app1_data);
        jpeg.extend_from_slice(&[0xFF, 0xD9]); // EOI

        let f = tempfile::Builder::new()
            .suffix(".jpg")
            .tempfile()
            .unwrap();
        std::fs::write(f.path(), &jpeg).unwrap();
        f
    }

    #[test]
    fn test_exif_jpeg_extracts_capture_time() {
        // WHY: Verifies that extract_jpeg_exif correctly reads DateTimeOriginal
        // from a hand-crafted TIFF/EXIF segment and parses it to a UTC DateTime.
        let f = make_jpeg_with_known_exif("2023:01:15 10:30:00", 1);
        let data = extract_jpeg_exif(f.path());
        let dt = data
            .capture_time
            .expect("capture_time must be extracted from EXIF DateTimeOriginal");
        assert_eq!(
            dt.format("%Y-%m-%d %H:%M:%S").to_string(),
            "2023-01-15 10:30:00",
            "parsed capture_time must match the value written into the EXIF segment"
        );
    }

    #[test]
    fn test_exif_jpeg_extracts_orientation() {
        // WHY: Verifies that extract_jpeg_exif correctly reads the Orientation tag.
        let f = make_jpeg_with_known_exif("2023:06:01 12:00:00", 6);
        let data = extract_jpeg_exif(f.path());
        assert_eq!(
            data.orientation,
            Some(6),
            "orientation 6 (90° CW) must be extracted from EXIF"
        );
    }

    #[test]
    fn test_extract_exif_dispatch_jpeg() {
        // WHY: Verifies the dispatch function extract_exif(path, &format) routes
        // to the JPEG extractor and returns correct capture_time.
        let f = make_jpeg_with_known_exif("2024:07:04 08:00:00", 1);
        let data = extract_exif(f.path(), &crate::photos::model::PhotoFormat::Jpeg);
        let dt = data
            .capture_time
            .expect("extract_exif must return capture_time for a JPEG with valid EXIF");
        assert_eq!(dt.format("%Y-%m-%d").to_string(), "2024-07-04");
    }

    /// Build a minimal valid JPEG containing an APP1/EXIF segment with Make and Model tags.
    ///
    /// TIFF layout (little-endian):
    ///   Offset 0-7:   TIFF header ("II" + 0x002A + IFD0 offset = 8)
    ///   Offset 8-9:   IFD0 entry count = 3
    ///   Offset 10-21: IFD0 entry 0: Make (0x010F), ASCII, count=6, offset→50
    ///   Offset 22-33: IFD0 entry 1: Model (0x0110), ASCII, count=21, offset→56
    ///   Offset 34-45: IFD0 entry 2: Orientation (0x0112), SHORT, count=1, inline=1
    ///   Offset 46-49: IFD0 next-IFD pointer = 0
    ///   Offset 50-55: Make value = "Canon\0" (6 bytes)
    ///   Offset 56-76: Model value = "Canon EOS 5D Mark IV\0" (21 bytes)
    fn make_jpeg_with_camera_info() -> tempfile::NamedTempFile {
        let make_str = b"Canon\x00"; // 6 bytes
        let model_str = b"Canon EOS 5D Mark IV\x00"; // 21 bytes

        // Value area starts at: 8 (header) + 2 (count) + 3*12 (entries) + 4 (next-IFD) = 50
        let make_offset: u32 = 50;
        let model_offset: u32 = 56; // 50 + 6

        let mut tiff: Vec<u8> = Vec::new();

        // TIFF header (8 bytes)
        tiff.extend_from_slice(b"II");              // little-endian
        tiff.extend_from_slice(&[0x2A, 0x00]);      // TIFF magic 42
        tiff.extend_from_slice(&8u32.to_le_bytes()); // IFD0 at offset 8

        // IFD0: 3 entries (tags in ascending order: 0x010F < 0x0110 < 0x0112)
        tiff.extend_from_slice(&3u16.to_le_bytes()); // entry count

        // Entry 0: Make (0x010F), ASCII (type=2), count=6, offset=50
        tiff.extend_from_slice(&0x010Fu16.to_le_bytes()); // tag
        tiff.extend_from_slice(&2u16.to_le_bytes());       // type ASCII
        tiff.extend_from_slice(&6u32.to_le_bytes());       // count (includes null)
        tiff.extend_from_slice(&make_offset.to_le_bytes()); // offset to value

        // Entry 1: Model (0x0110), ASCII (type=2), count=21, offset=56
        tiff.extend_from_slice(&0x0110u16.to_le_bytes()); // tag
        tiff.extend_from_slice(&2u16.to_le_bytes());       // type ASCII
        tiff.extend_from_slice(&21u32.to_le_bytes());      // count (includes null)
        tiff.extend_from_slice(&model_offset.to_le_bytes()); // offset to value

        // Entry 2: Orientation (0x0112), SHORT (type=3), count=1, inline value=1
        tiff.extend_from_slice(&0x0112u16.to_le_bytes()); // tag
        tiff.extend_from_slice(&3u16.to_le_bytes());       // type SHORT
        tiff.extend_from_slice(&1u32.to_le_bytes());       // count
        tiff.extend_from_slice(&1u32.to_le_bytes());       // inline value (orientation=1)

        // IFD0 next-IFD pointer
        tiff.extend_from_slice(&0u32.to_le_bytes());

        // Verify we are at offset 50 (value area starts here)
        assert_eq!(tiff.len(), make_offset as usize, "Make value must start at offset 50");

        // Make value: "Canon\0" (6 bytes)
        tiff.extend_from_slice(make_str);

        // Verify we are at offset 56 (Model value starts here)
        assert_eq!(tiff.len(), model_offset as usize, "Model value must start at offset 56");

        // Model value: "Canon EOS 5D Mark IV\0" (21 bytes)
        tiff.extend_from_slice(model_str);

        // Build APP1 segment: "Exif\0\0" + TIFF payload
        let mut app1_data = b"Exif\x00\x00".to_vec();
        app1_data.extend_from_slice(&tiff);
        let app1_len = (app1_data.len() + 2) as u16; // +2 for the length field itself

        let mut jpeg: Vec<u8> = Vec::new();
        jpeg.extend_from_slice(&[0xFF, 0xD8]); // SOI
        jpeg.extend_from_slice(&[0xFF, 0xE1]); // APP1 marker
        jpeg.extend_from_slice(&app1_len.to_be_bytes());
        jpeg.extend_from_slice(&app1_data);
        jpeg.extend_from_slice(&[0xFF, 0xD9]); // EOI

        let f = tempfile::Builder::new()
            .suffix(".jpg")
            .tempfile()
            .unwrap();
        std::fs::write(f.path(), &jpeg).unwrap();
        f
    }

    #[test]
    fn test_exif_jpeg_extracts_camera_model() {
        // WHY: extract_jpeg_exif() has camera_model extraction code but no test verifies
        // the value. This would miss a regression if Tag::Model is changed or the field
        // is accidentally set to None.
        let f = make_jpeg_with_camera_info();
        let data = extract_exif(f.path(), &crate::photos::model::PhotoFormat::Jpeg);
        let model = data.camera_model.expect("camera_model must be extracted");
        assert!(
            model.contains("Canon EOS 5D"),
            "camera_model must contain Canon EOS 5D, got: {}",
            model
        );
    }
}
