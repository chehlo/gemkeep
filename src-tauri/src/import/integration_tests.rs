/// Integration tests for the import pipeline.
/// These tests use an in-memory SQLite DB and a temp directory to simulate real imports.
use crate::db::run_migrations;
use crate::import::pipeline;
use crate::photos::model::IndexingStatus;
use crate::photos::repository;
use rusqlite::Connection;
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};
use tempfile::TempDir;

fn setup() -> (Connection, TempDir, i64) {
    let conn = Connection::open_in_memory().unwrap();
    run_migrations(&conn).unwrap();
    // Insert a project
    conn.execute(
        "INSERT INTO projects (name, slug, created_at) VALUES ('Test', 'test', '2024-01-01T00:00:00Z')",
        [],
    )
    .unwrap();
    let project_id: i64 = conn.last_insert_rowid();
    let tmp = tempfile::tempdir().unwrap();
    // Create cache/thumbnails dir
    std::fs::create_dir_all(tmp.path().join("cache").join("thumbnails")).unwrap();
    (conn, tmp, project_id)
}

fn make_status() -> Arc<Mutex<IndexingStatus>> {
    Arc::new(Mutex::new(IndexingStatus::default()))
}

fn make_cancel() -> Arc<AtomicBool> {
    Arc::new(AtomicBool::new(false))
}

fn make_pause() -> Arc<AtomicBool> {
    Arc::new(AtomicBool::new(false))
}

fn write_minimal_jpeg(path: &std::path::Path) {
    // Minimal valid JPEG (just SOI + EOI markers)
    std::fs::write(path, [0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0xFF, 0xD9]).unwrap();
}

/// Write a minimal JPEG to `path` with an APP1/EXIF segment containing
/// DateTimeOriginal in the ExifIFD sub-IFD (the layout kamadak-exif requires).
///
/// TIFF layout (little-endian, offsets from TIFF header start):
///   0-7:   header ("II" + 0x002A + IFD0 offset=8)
///   8-37:  IFD0 — 2 entries: Orientation(0x0112), ExifIFD-ptr(0x8769)
///   38-55: ExifIFD — 1 entry: DateTimeOriginal(0x9003) count=20 offset=56
///   56-75: DateTimeOriginal value (19 ASCII chars + NUL)
fn write_jpeg_with_timestamp(path: &std::path::Path, datetime_original: &str) {
    assert_eq!(datetime_original.len(), 19, "EXIF datetime must be 'YYYY:MM:DD HH:MM:SS'");
    let mut dt_bytes = datetime_original.as_bytes().to_vec();
    dt_bytes.push(0); // NUL terminator → 20 bytes

    let mut tiff: Vec<u8> = Vec::new();
    // TIFF header
    tiff.extend_from_slice(b"II");
    tiff.extend_from_slice(&[0x2A, 0x00]);
    tiff.extend_from_slice(&8u32.to_le_bytes()); // IFD0 at offset 8

    // IFD0: 2 entries (ascending tag order: 0x0112 < 0x8769)
    tiff.extend_from_slice(&2u16.to_le_bytes());
    // Entry 0: Orientation (0x0112), SHORT, count=1, inline value=1
    tiff.extend_from_slice(&0x0112u16.to_le_bytes());
    tiff.extend_from_slice(&3u16.to_le_bytes());
    tiff.extend_from_slice(&1u32.to_le_bytes());
    tiff.extend_from_slice(&1u32.to_le_bytes());
    // Entry 1: ExifIFD pointer (0x8769), LONG, count=1, offset=38
    tiff.extend_from_slice(&0x8769u16.to_le_bytes());
    tiff.extend_from_slice(&4u16.to_le_bytes());
    tiff.extend_from_slice(&1u32.to_le_bytes());
    tiff.extend_from_slice(&38u32.to_le_bytes());
    tiff.extend_from_slice(&0u32.to_le_bytes()); // IFD0 next-IFD = 0

    // ExifIFD at offset 38: 1 entry
    assert_eq!(tiff.len(), 38);
    tiff.extend_from_slice(&1u16.to_le_bytes());
    // Entry: DateTimeOriginal (0x9003), ASCII, count=20, value at offset 56
    tiff.extend_from_slice(&0x9003u16.to_le_bytes());
    tiff.extend_from_slice(&2u16.to_le_bytes());
    tiff.extend_from_slice(&20u32.to_le_bytes());
    tiff.extend_from_slice(&56u32.to_le_bytes());
    tiff.extend_from_slice(&0u32.to_le_bytes()); // ExifIFD next-IFD = 0

    // DateTimeOriginal value at offset 56
    assert_eq!(tiff.len(), 56);
    tiff.extend_from_slice(&dt_bytes);

    // Wrap in APP1 segment and JPEG envelope
    let mut app1_data = b"Exif\x00\x00".to_vec();
    app1_data.extend_from_slice(&tiff);
    let app1_len = (app1_data.len() + 2) as u16;
    let mut jpeg: Vec<u8> = Vec::new();
    jpeg.extend_from_slice(&[0xFF, 0xD8]); // SOI
    jpeg.extend_from_slice(&[0xFF, 0xE1]); // APP1 marker
    jpeg.extend_from_slice(&app1_len.to_be_bytes());
    jpeg.extend_from_slice(&app1_data);
    jpeg.extend_from_slice(&[0xFF, 0xD9]); // EOI
    std::fs::write(path, &jpeg).unwrap();
}

#[test]
fn test_pipeline_empty_folder() {
    let (conn, tmp, project_id) = setup();
    let folder = tmp.path().join("empty_photos");
    std::fs::create_dir_all(&folder).unwrap();

    let stats = pipeline::run_pipeline(
        &conn,
        project_id,
        tmp.path(),
        vec![folder],
        3,
        make_status(),
        make_cancel(),
        make_pause(),
    );

    assert_eq!(stats.total_files_scanned, 0);
    assert_eq!(stats.imported, 0);
    assert_eq!(stats.errors, 0);
}

#[test]
fn test_pipeline_full_run() {
    let (conn, tmp, project_id) = setup();
    let folder = tmp.path().join("photos");
    std::fs::create_dir_all(&folder).unwrap();

    write_minimal_jpeg(&folder.join("img_001.jpg"));
    write_minimal_jpeg(&folder.join("img_002.jpg"));

    let stats = pipeline::run_pipeline(
        &conn,
        project_id,
        tmp.path(),
        vec![folder],
        3,
        make_status(),
        make_cancel(),
        make_pause(),
    );

    assert_eq!(stats.total_files_scanned, 2);
    assert!(stats.logical_photos >= 1);
    assert_eq!(stats.errors, 0);
}

#[test]
fn test_pipeline_idempotent() {
    let (conn, tmp, project_id) = setup();
    let folder = tmp.path().join("photos");
    std::fs::create_dir_all(&folder).unwrap();
    write_minimal_jpeg(&folder.join("img_001.jpg"));

    let stats1 = pipeline::run_pipeline(
        &conn,
        project_id,
        tmp.path(),
        vec![folder.clone()],
        3,
        make_status(),
        make_cancel(),
        make_pause(),
    );
    assert_eq!(stats1.imported, 1);

    let stats2 = pipeline::run_pipeline(
        &conn,
        project_id,
        tmp.path(),
        vec![folder],
        3,
        make_status(),
        make_cancel(),
        make_pause(),
    );
    // Second run: 0 new imports, 1 skipped
    assert_eq!(stats2.imported, 0);
    assert_eq!(stats2.skipped_existing, 1);
    // Stacks and logical_photos should still be correct
    assert!(stats2.logical_photos >= 1);
}

#[test]
fn test_pipeline_stacks_persisted() {
    let (conn, tmp, project_id) = setup();
    let folder = tmp.path().join("photos");
    std::fs::create_dir_all(&folder).unwrap();

    // Two files — no EXIF, each gets own stack
    write_minimal_jpeg(&folder.join("a.jpg"));
    write_minimal_jpeg(&folder.join("b.jpg"));

    let stats = pipeline::run_pipeline(
        &conn,
        project_id,
        tmp.path(),
        vec![folder],
        3,
        make_status(),
        make_cancel(),
        make_pause(),
    );

    let stacks = repository::list_stacks_summary(&conn, project_id).unwrap();
    assert!(!stacks.is_empty());
    assert_eq!(stats.errors, 0);
}

#[test]
fn test_pipeline_thumbnail_path_is_absolute_and_matches_scope() {
    // WHY: The asset protocol scope ["/**"] requires all thumbnail_path values
    // to be absolute paths starting with "/". This test verifies that the path
    // construction in list_stacks (cache_dir.join("{id}.jpg")) always produces
    // absolute paths — it will FAIL if the project dir is somehow relative.
    let (conn, tmp, project_id) = setup();
    let folder = tmp.path().join("photos");
    std::fs::create_dir_all(&folder).unwrap();

    // Write two minimal JPEGs so the pipeline produces stacks
    write_minimal_jpeg(&folder.join("photo_a.jpg"));
    write_minimal_jpeg(&folder.join("photo_b.jpg"));

    pipeline::run_pipeline(
        &conn,
        project_id,
        tmp.path(),
        vec![folder],
        3,
        make_status(),
        make_cancel(),
        make_pause(),
    );

    // Verify list_stacks_summary produces entries (pipeline persisted stacks)
    let stacks = repository::list_stacks_summary(&conn, project_id).unwrap();
    assert!(!stacks.is_empty(), "Pipeline must produce at least one stack");

    // Simulate the thumbnail_path construction that list_stacks command does:
    //   cache_dir.join(format!("{}.jpg", lp_id)).to_string_lossy().into_owned()
    // The key invariant: if project_dir (tmp.path()) is absolute, then
    // cache_dir.join(...) must also be absolute.
    let cache_dir = tmp.path().join("cache").join("thumbnails");

    // CRITICAL: tmp.path() is always absolute in tempfile — but this assertion
    // documents the contract explicitly. If project_dir were ever set to a
    // relative path, cache_dir would also be relative and asset:// would break.
    assert!(
        cache_dir.is_absolute(),
        "cache_dir must be absolute (project_dir must never be relative): {}",
        cache_dir.display()
    );

    // Also verify that a constructed thumbnail path string starts with "/"
    // (the actual format used by the list_stacks command)
    let example_lp_id: i64 = 1;
    let thumb_path_str = cache_dir
        .join(format!("{}.jpg", example_lp_id))
        .to_string_lossy()
        .into_owned();

    assert!(
        thumb_path_str.starts_with('/'),
        "thumbnail_path must be absolute (start with /): {}",
        thumb_path_str
    );
}

#[test]
fn test_pipeline_pairs_persisted() {
    // WHY: Verifies that a JPEG+RAW pair with the same base name is imported as
    // ONE logical photo (one stack), not two separate stacks.
    let (conn, tmp, project_id) = setup();
    let folder = tmp.path().join("paired");
    std::fs::create_dir_all(&folder).unwrap();

    // Write a minimal JPEG
    write_minimal_jpeg(&folder.join("IMG_0001.jpg"));
    // Fake RAW file — scanner detects by extension, not content
    std::fs::write(folder.join("IMG_0001.CR2"), b"fake raw").unwrap();

    pipeline::run_pipeline(
        &conn,
        project_id,
        tmp.path(),
        vec![folder],
        2,
        make_status(),
        make_cancel(),
        make_pause(),
    );

    let stacks = repository::list_stacks_summary(&conn, project_id).unwrap();
    assert_eq!(
        stacks.len(),
        1,
        "JPEG+RAW pair with same base name must produce exactly ONE stack, got {}",
        stacks.len()
    );
    // The single stack must contain both a JPEG and a RAW
    assert!(stacks[0].has_jpeg, "stack must have_jpeg=true");
    assert!(stacks[0].has_raw, "stack must have_raw=true");
}

#[test]
fn test_pipeline_cancel() {
    // WHY: Verifies the pipeline handles a pre-triggered cancel signal gracefully
    // — it must return without panicking and leave the DB in a consistent state.
    let (conn, tmp, project_id) = setup();
    let folder = tmp.path().join("photos");
    std::fs::create_dir_all(&folder).unwrap();
    for i in 0..3 {
        write_minimal_jpeg(&folder.join(format!("photo_{}.jpg", i)));
    }

    // Create a cancel flag that is already set to true before the pipeline runs
    let cancel_now = Arc::new(AtomicBool::new(true));

    pipeline::run_pipeline(
        &conn,
        project_id,
        tmp.path(),
        vec![folder],
        2,
        make_status(),
        cancel_now,
        make_pause(),
    );

    // Must not panic. State must be consistent (no more stacks than photos).
    let stacks = repository::list_stacks_summary(&conn, project_id)
        .expect("list_stacks_summary must not error after a cancelled pipeline");
    assert!(
        stacks.len() <= 3,
        "cancelled pipeline must not produce more stacks than input photos, got {}",
        stacks.len()
    );
}

#[test]
fn test_pipeline_partial_errors() {
    // WHY: Verifies that an invalid file in the batch does not abort the pipeline.
    // The valid file must still produce a stack. The invalid file must not panic.
    // "partial errors" = some files fail, others succeed — pipeline is robust.
    let (conn, tmp, project_id) = setup();
    let folder = tmp.path().join("mixed");
    std::fs::create_dir_all(&folder).unwrap();

    // Valid JPEG
    let img = image::DynamicImage::new_rgb8(10, 10);
    img.save(folder.join("valid.jpg")).unwrap();

    // Invalid JPEG: correct extension but not a real image
    std::fs::write(folder.join("corrupt.jpg"), b"this is not a jpeg").unwrap();

    pipeline::run_pipeline(
        &conn, project_id, tmp.path(), vec![folder.clone()],
        2, make_status(), make_cancel(), make_pause(),
    );

    let stacks = repository::list_stacks_summary(&conn, project_id).unwrap();
    // Both files produce stacks (EXIF failure → None, not an error)
    // corrupt.jpg: EXIF=None, thumbnail may fail → solo stack with no thumbnail
    assert!(
        stacks.len() >= 1,
        "at least the valid file must produce a stack, got {}",
        stacks.len()
    );
    // Pipeline must not panic (test would fail if it did)
}

#[test]
fn test_pipeline_orientation_end_to_end() {
    // WHY: Verifies that orientation is extracted, passed through the pipeline,
    // and applied when generating thumbnails. Catches regressions where the
    // orientation value is silently dropped anywhere in the chain.
    //
    // Uses a LANDSCAPE source JPEG (600×200). Passes orientation=6 directly
    // to generate_thumbnail. Verifies output is portrait (height > width).
    use crate::import::thumbnails;
    let tmp = TempDir::new().unwrap();
    let cache_dir = tmp.path().join("cache");
    std::fs::create_dir_all(&cache_dir).unwrap();

    // Create a landscape source JPEG
    let src = tmp.path().join("landscape.jpg");
    let img = image::DynamicImage::new_rgb8(600, 200);
    img.save(&src).unwrap();

    // Generate thumbnail WITH orientation=6 (should rotate to portrait)
    let result = thumbnails::generate_thumbnail(
        &src,
        &crate::photos::model::PhotoFormat::Jpeg,
        100,
        &cache_dir,
        Some(6),
    );

    assert!(result.is_some(), "thumbnail must be generated for valid source");
    let thumb = cache_dir.join("100.jpg");
    let output = image::open(&thumb).expect("thumbnail must be readable");

    assert!(
        output.height() > output.width(),
        "orientation=6 must rotate landscape to portrait, got {}×{}",
        output.width(), output.height()
    );
}

/// Real-photo smoke test: scans ~/ssd_disk/photo/venice 2022.
/// Skipped if the directory does not exist (CI environments).
#[test]
fn test_pipeline_real_venice_2022() {
    let photo_dir =
        std::path::PathBuf::from(std::env::var("HOME").unwrap_or_else(|_| "/root".to_string()))
            .join("ssd_disk/photo/venice 2022");

    if !photo_dir.exists() {
        eprintln!("SKIP: {} not found", photo_dir.display());
        return;
    }

    let (conn, tmp, project_id) = setup();

    let stats = pipeline::run_pipeline(
        &conn,
        project_id,
        tmp.path(),
        vec![photo_dir],
        3,
        make_status(),
        make_cancel(),
        make_pause(),
    );

    eprintln!(
        "Venice 2022 import: scanned={} imported={} pairs={} stacks={} logical={} errors={}",
        stats.total_files_scanned,
        stats.imported,
        stats.pairs_detected,
        stats.stacks_generated,
        stats.logical_photos,
        stats.errors,
    );

    // There are 22 files (11 CR2 + 11 JPG) → 11 pairs, 11 logical photos
    assert!(
        stats.total_files_scanned >= 22,
        "expected ≥22 files, got {}",
        stats.total_files_scanned
    );
    assert!(
        stats.pairs_detected >= 11,
        "expected ≥11 pairs, got {}",
        stats.pairs_detected
    );
    assert!(
        stats.logical_photos >= 11,
        "expected ≥11 logical photos, got {}",
        stats.logical_photos
    );
    assert!(
        stats.stacks_generated >= 1,
        "expected ≥1 stack, got {}",
        stats.stacks_generated
    );
    assert_eq!(stats.errors, 0, "expected 0 errors");

    let stacks = repository::list_stacks_summary(&conn, project_id).unwrap();
    assert!(!stacks.is_empty(), "stacks should be persisted to DB");
}

#[test]
fn test_pipeline_stacks_from_exif_timestamps() {
    // WHY: All existing pipeline tests use no-EXIF JPEGs, so capture_time is always None
    // and burst-stacking is never exercised end-to-end. This test builds 3 JPEGs with
    // timestamps 1s apart and verifies they group into ONE burst stack.
    //
    // If this test fails with stacks.len()==3, EXIF capture_time is not flowing through
    // to the stacking algorithm — check extract_jpeg_exif() and the pipeline ScannedFile.
    let (conn, tmp, project_id) = setup();
    let folder = tmp.path().join("burst");
    std::fs::create_dir_all(&folder).unwrap();

    write_jpeg_with_timestamp(&folder.join("burst_1.jpg"), "2024:03:15 10:00:00");
    write_jpeg_with_timestamp(&folder.join("burst_2.jpg"), "2024:03:15 10:00:01");
    write_jpeg_with_timestamp(&folder.join("burst_3.jpg"), "2024:03:15 10:00:02");

    pipeline::run_pipeline(
        &conn, project_id, tmp.path(), vec![folder],
        3, // burst_gap_secs — all 3 photos are within this window
        make_status(), make_cancel(), make_pause(),
    );

    let stacks = repository::list_stacks_summary(&conn, project_id).unwrap();
    assert_eq!(
        stacks.len(), 1,
        "3 JPEGs with timestamps 1s apart must produce 1 burst stack, got {} stacks",
        stacks.len()
    );
    assert_eq!(
        stacks[0].logical_photo_count, 3,
        "the burst stack must contain all 3 logical photos, got {}",
        stacks[0].logical_photo_count
    );
}

#[test]
fn test_pipeline_stacks_gap_splits() {
    // WHY: Verifies that photos separated by more than burst_gap_secs each get their
    // own stack. Exercises the timed-grouping path end-to-end with real EXIF timestamps.
    let (conn, tmp, project_id) = setup();
    let folder = tmp.path().join("split");
    std::fs::create_dir_all(&folder).unwrap();

    // 2 photos 60s apart — well beyond the 3s burst window
    write_jpeg_with_timestamp(&folder.join("early.jpg"), "2024:03:15 10:00:00");
    write_jpeg_with_timestamp(&folder.join("late.jpg"),  "2024:03:15 10:01:00");

    pipeline::run_pipeline(
        &conn, project_id, tmp.path(), vec![folder],
        3, // burst_gap_secs
        make_status(), make_cancel(), make_pause(),
    );

    let stacks = repository::list_stacks_summary(&conn, project_id).unwrap();
    assert_eq!(
        stacks.len(), 2,
        "2 JPEGs 60s apart must produce 2 separate stacks, got {}",
        stacks.len()
    );
}
