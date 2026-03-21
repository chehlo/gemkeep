/// RED tests for unified metadata extraction.
///
/// Tests call `extract_metadata(path)` which auto-detects format from extension
/// and returns normalized ExifData. Uses manifest-driven fixtures via test_fixtures.rs.
///
/// These tests are IMMUTABLE after RED commit (Rule R3).
use crate::import::exif::{extract_metadata, ExifData};
use crate::import::scanner::detect_format;
use crate::import::test_fixtures::{
    assert_exif_matches, for_each_fixture, load_manifest, resolve_fixture_path,
};
use crate::photos::model::PhotoFormat;
use std::path::Path;

// ═══════════════════════════════════════════════════════════════════════════
// Behavior: extract_metadata iterates ALL exif-layer fixtures from manifest
// ═══════════════════════════════════════════════════════════════════════════

#[test]
fn test_extract_metadata_matches_manifest_for_all_exif_fixtures() {
    let mut tested = 0;
    for_each_fixture("exif", |fixture, path| {
        if !fixture.expected.exif_parseable {
            // Corrupt/no-exif fixtures: just verify no panic and fields are None
            let data = extract_metadata(path);
            assert!(
                data.camera_model.is_none(),
                "Fixture {}: corrupt file should have camera_model=None, got {:?}",
                fixture.id,
                data.camera_model
            );
            tested += 1;
            return;
        }

        let data = extract_metadata(path);
        assert_exif_matches(&fixture.id, &data, &fixture.expected);
        tested += 1;
    });
    assert!(
        tested >= 10,
        "Expected at least 10 exif-layer fixtures tested, got {}",
        tested
    );
}

// ═══════════════════════════════════════════════════════════════════════════
// Behavior: extract_metadata auto-detects format from extension
// ═══════════════════════════════════════════════════════════════════════════

#[test]
fn test_extract_metadata_jpeg_orientation_variants() {
    let manifest = load_manifest();
    // s1=orient1, s2=orient3, s3=orient6, s4=orient8
    for id in &["s1", "s2", "s3", "s4"] {
        let fixture = manifest.fixtures.iter().find(|f| f.id == *id).unwrap();
        let path = resolve_fixture_path(fixture).unwrap();
        let data = extract_metadata(&path);
        assert_eq!(
            data.orientation, fixture.expected.orientation,
            "Fixture {}: orientation mismatch",
            id
        );
    }
}

#[test]
fn test_extract_metadata_no_exif_returns_all_none() {
    let manifest = load_manifest();
    let fixture = manifest.fixtures.iter().find(|f| f.id == "s5").unwrap();
    let path = resolve_fixture_path(fixture).unwrap();
    let data = extract_metadata(&path);
    assert!(
        data.camera_model.is_none(),
        "no_exif.jpg: camera_model should be None"
    );
    assert!(
        data.orientation.is_none(),
        "no_exif.jpg: orientation should be None"
    );
    assert!(
        data.capture_time.is_none(),
        "no_exif.jpg: capture_time should be None"
    );
    assert!(
        data.aperture.is_none(),
        "no_exif.jpg: aperture should be None"
    );
}

#[test]
fn test_extract_metadata_all_camera_params() {
    let manifest = load_manifest();
    let fixture = manifest.fixtures.iter().find(|f| f.id == "s8").unwrap();
    let path = resolve_fixture_path(fixture).unwrap();
    let data = extract_metadata(&path);
    assert_exif_matches("s8", &data, &fixture.expected);
}

#[test]
fn test_extract_metadata_zero_denom_fnumber() {
    let manifest = load_manifest();
    let fixture = manifest.fixtures.iter().find(|f| f.id == "s9").unwrap();
    let path = resolve_fixture_path(fixture).unwrap();
    let data = extract_metadata(&path);
    // FNumber=0/0 should result in aperture=None (not panic or NaN)
    assert!(
        data.aperture.is_none(),
        "zero_denom_fnumber: aperture should be None for 0/0, got {:?}",
        data.aperture
    );
}

// ═══════════════════════════════════════════════════════════════════════════
// Behavior: extract_metadata handles corrupt files gracefully
// ═══════════════════════════════════════════════════════════════════════════

#[test]
fn test_extract_metadata_corrupt_files_no_panic() {
    let manifest = load_manifest();
    for id in &["c1", "c2", "c3", "c4"] {
        let fixture = manifest.fixtures.iter().find(|f| f.id == *id).unwrap();
        if let Some(path) = resolve_fixture_path(fixture) {
            // Must not panic — just return default
            let data = extract_metadata(&path);
            assert!(
                data.capture_time.is_none(),
                "Fixture {}: corrupt file should have capture_time=None",
                id
            );
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// Behavior: detect_format recognizes NEF, RAF, RW2
// ═══════════════════════════════════════════════════════════════════════════

#[test]
fn test_detect_format_nef() {
    assert_eq!(
        detect_format(Path::new("photo.nef")),
        Some(PhotoFormat::Raw),
        ".nef should be detected as Raw"
    );
    assert_eq!(
        detect_format(Path::new("photo.NEF")),
        Some(PhotoFormat::Raw),
        ".NEF (uppercase) should be detected as Raw"
    );
}

#[test]
fn test_detect_format_raf() {
    assert_eq!(
        detect_format(Path::new("photo.raf")),
        Some(PhotoFormat::Raw),
        ".raf should be detected as Raw"
    );
    assert_eq!(
        detect_format(Path::new("photo.RAF")),
        Some(PhotoFormat::Raw),
        ".RAF (uppercase) should be detected as Raw"
    );
}

#[test]
fn test_detect_format_rw2() {
    assert_eq!(
        detect_format(Path::new("photo.rw2")),
        Some(PhotoFormat::Raw),
        ".rw2 should be detected as Raw"
    );
    assert_eq!(
        detect_format(Path::new("photo.RW2")),
        Some(PhotoFormat::Raw),
        ".RW2 (uppercase) should be detected as Raw"
    );
}

// ═══════════════════════════════════════════════════════════════════════════
// Behavior: scan_directory finds NEF, RAF, RW2 files
// ═══════════════════════════════════════════════════════════════════════════

#[test]
fn test_scan_directory_includes_new_raw_formats() {
    use crate::import::scanner::scan_directory;
    let tmp = tempfile::tempdir().unwrap();
    // Create dummy files with new extensions
    std::fs::write(tmp.path().join("test.nef"), b"fake nef").unwrap();
    std::fs::write(tmp.path().join("test.raf"), b"fake raf").unwrap();
    std::fs::write(tmp.path().join("test.rw2"), b"fake rw2").unwrap();
    std::fs::write(tmp.path().join("test.jpg"), b"fake jpg").unwrap();
    std::fs::write(tmp.path().join("test.txt"), b"not a photo").unwrap();

    let (files, _errors) = scan_directory(tmp.path());
    assert_eq!(
        files.len(),
        4,
        "Should find 4 photo files (nef, raf, rw2, jpg), got {}",
        files.len()
    );

    let raw_count = files
        .iter()
        .filter(|f| f.format == PhotoFormat::Raw)
        .count();
    assert_eq!(raw_count, 3, "Should find 3 RAW files, got {}", raw_count);
}

// ═══════════════════════════════════════════════════════════════════════════
// Behavior: extract_metadata on real RAW fixtures (if downloaded)
// ═══════════════════════════════════════════════════════════════════════════

#[test]
fn test_extract_metadata_real_raw_fixtures() {
    let manifest = load_manifest();
    let mut tested = 0;
    for id in &["r1", "r2", "r3", "r4", "r5"] {
        let fixture = manifest.fixtures.iter().find(|f| f.id == *id).unwrap();
        if let Some(path) = resolve_fixture_path(fixture) {
            let data = extract_metadata(&path);
            assert_exif_matches(*id, &data, &fixture.expected);
            tested += 1;
        } else {
            eprintln!(
                "SKIP: {} not downloaded",
                fixture.file.as_deref().unwrap_or("?")
            );
        }
    }
    // At least Canon + Sony should exist (they were in original fixture set)
    assert!(
        tested >= 2,
        "Expected at least 2 real RAW fixtures tested, got {} (run setup-fixtures.sh)",
        tested
    );
}
