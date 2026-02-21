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
}
