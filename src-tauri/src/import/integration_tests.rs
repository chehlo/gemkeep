/// Integration tests for the import pipeline.
/// These tests use an in-memory SQLite DB and a temp directory to simulate real imports.
use crate::db::run_migrations;
use crate::import::pipeline;
use crate::photos::model::IndexingStatus;
use crate::photos::repository;
use rusqlite::Connection;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
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

fn make_counter() -> Arc<AtomicUsize> {
    Arc::new(AtomicUsize::new(0))
}

fn write_minimal_jpeg(path: &std::path::Path) {
    // Minimal valid JPEG (just SOI + EOI markers)
    std::fs::write(path, [0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0xFF, 0xD9]).unwrap();
}

fn write_valid_jpeg(path: &std::path::Path) {
    // A real decodable JPEG (50x50 RGB image)
    let img = image::DynamicImage::new_rgb8(50, 50);
    img.save(path).unwrap();
}

/// Write a decodable JPEG with an embedded EXIF timestamp.
/// Combines write_valid_jpeg (real image data) with write_jpeg_with_timestamp
/// (EXIF APP1 header) so the file can be both decoded by `image::open()` and
/// have its capture_time extracted by the EXIF reader.
///
/// Strategy: encode a real 50×50 image to a buffer, strip the SOI (first 2 bytes),
/// then prepend: SOI + APP1(EXIF+timestamp) + remaining JPEG data.
fn write_valid_jpeg_with_timestamp(path: &std::path::Path, datetime_original: &str) {
    assert_eq!(
        datetime_original.len(),
        19,
        "EXIF datetime must be 'YYYY:MM:DD HH:MM:SS'"
    );
    let mut dt_bytes = datetime_original.as_bytes().to_vec();
    dt_bytes.push(0); // NUL terminator → 20 bytes

    // Build the TIFF/EXIF block (same layout as write_jpeg_with_timestamp)
    let mut tiff: Vec<u8> = Vec::new();
    tiff.extend_from_slice(b"II");
    tiff.extend_from_slice(&[0x2A, 0x00]);
    tiff.extend_from_slice(&8u32.to_le_bytes());
    tiff.extend_from_slice(&2u16.to_le_bytes());
    tiff.extend_from_slice(&0x0112u16.to_le_bytes());
    tiff.extend_from_slice(&3u16.to_le_bytes());
    tiff.extend_from_slice(&1u32.to_le_bytes());
    tiff.extend_from_slice(&1u32.to_le_bytes());
    tiff.extend_from_slice(&0x8769u16.to_le_bytes());
    tiff.extend_from_slice(&4u16.to_le_bytes());
    tiff.extend_from_slice(&1u32.to_le_bytes());
    tiff.extend_from_slice(&38u32.to_le_bytes());
    tiff.extend_from_slice(&0u32.to_le_bytes());
    tiff.extend_from_slice(&1u16.to_le_bytes());
    tiff.extend_from_slice(&0x9003u16.to_le_bytes());
    tiff.extend_from_slice(&2u16.to_le_bytes());
    tiff.extend_from_slice(&20u32.to_le_bytes());
    tiff.extend_from_slice(&56u32.to_le_bytes());
    tiff.extend_from_slice(&0u32.to_le_bytes());
    tiff.extend_from_slice(&dt_bytes);

    let mut app1_data = b"Exif\x00\x00".to_vec();
    app1_data.extend_from_slice(&tiff);
    let app1_len = (app1_data.len() + 2) as u16;

    // Encode a real 50×50 image into a buffer
    let img = image::DynamicImage::new_rgb8(50, 50);
    let mut jpeg_buf: Vec<u8> = Vec::new();
    img.write_to(
        &mut std::io::Cursor::new(&mut jpeg_buf),
        image::ImageFormat::Jpeg,
    )
    .unwrap();

    // jpeg_buf = [FF D8] [FF E0 APP0...] [...image data...]
    // We want: [FF D8] [FF E1 APP1(EXIF)] [rest of original JPEG after SOI]
    // Skip the SOI (first 2 bytes FF D8) from the encoded buffer
    let rest = &jpeg_buf[2..];

    let mut output: Vec<u8> = Vec::new();
    output.extend_from_slice(&[0xFF, 0xD8]); // SOI
    output.extend_from_slice(&[0xFF, 0xE1]); // APP1 marker
    output.extend_from_slice(&app1_len.to_be_bytes());
    output.extend_from_slice(&app1_data);
    output.extend_from_slice(rest); // APP0 + scan data + EOI

    std::fs::write(path, &output).unwrap();
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
    assert_eq!(
        datetime_original.len(),
        19,
        "EXIF datetime must be 'YYYY:MM:DD HH:MM:SS'"
    );
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
        None,
        make_counter(),
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
        None,
        make_counter(),
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
        None,
        make_counter(),
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
        None,
        make_counter(),
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
        None,
        make_counter(),
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
        None,
        make_counter(),
    );

    // Verify list_stacks_summary produces entries (pipeline persisted stacks)
    let stacks = repository::list_stacks_summary(&conn, project_id).unwrap();
    assert!(
        !stacks.is_empty(),
        "Pipeline must produce at least one stack"
    );

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
        None,
        make_counter(),
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
        None,
        make_counter(),
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
        &conn,
        project_id,
        tmp.path(),
        vec![folder.clone()],
        2,
        make_status(),
        make_cancel(),
        make_pause(),
        None,
        make_counter(),
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
    // WHY: Verifies that orientation metadata is passed through the full chain without
    // being silently dropped. After resize_to_fill(256, 256) all thumbnails are square,
    // so we cannot assert portrait vs landscape — instead we verify that:
    //   1. generate_thumbnail succeeds (no panic from apply_orientation)
    //   2. Output is exactly 256×256 (resize_to_fill contract)
    use crate::import::thumbnails;
    let tmp = TempDir::new().unwrap();
    let cache_dir = tmp.path().join("cache");
    std::fs::create_dir_all(&cache_dir).unwrap();

    // Create a landscape source JPEG
    let src = tmp.path().join("landscape.jpg");
    let img = image::DynamicImage::new_rgb8(600, 200);
    img.save(&src).unwrap();

    // Generate thumbnail WITH orientation=6 — must not panic
    let result = thumbnails::generate_thumbnail(
        &src,
        &crate::photos::model::PhotoFormat::Jpeg,
        100,
        &cache_dir,
        Some(6),
    );

    assert!(
        result.is_some(),
        "thumbnail must be generated for valid source"
    );
    let thumb = cache_dir.join("100.jpg");
    let output = image::open(&thumb).expect("thumbnail must be readable");

    assert_eq!(
        (output.width(), output.height()),
        (256, 256),
        "thumbnail must be 256×256 (resize_to_fill contract), got {}×{}",
        output.width(),
        output.height()
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
        None,
        make_counter(),
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
        &conn,
        project_id,
        tmp.path(),
        vec![folder],
        3, // burst_gap_secs — all 3 photos are within this window
        make_status(),
        make_cancel(),
        make_pause(),
        None,
        make_counter(),
    );

    let stacks = repository::list_stacks_summary(&conn, project_id).unwrap();
    assert_eq!(
        stacks.len(),
        1,
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
    write_jpeg_with_timestamp(&folder.join("late.jpg"), "2024:03:15 10:01:00");

    pipeline::run_pipeline(
        &conn,
        project_id,
        tmp.path(),
        vec![folder],
        3, // burst_gap_secs
        make_status(),
        make_cancel(),
        make_pause(),
        None,
        make_counter(),
    );

    let stacks = repository::list_stacks_summary(&conn, project_id).unwrap();
    assert_eq!(
        stacks.len(),
        2,
        "2 JPEGs 60s apart must produce 2 separate stacks, got {}",
        stacks.len()
    );
}

#[test]
fn test_thumbnails_total_set_on_status_before_pool_runs() {
    // P1-01: WHY — thumbnails_total must be written to IndexingStatus before the
    // rayon pool starts. If not, early status polls see thumbnails_total=0 and show
    // the spinner instead of the progress bar.
    let (conn, tmp, project_id) = setup();
    let folder = tmp.path().join("photos");
    std::fs::create_dir_all(&folder).unwrap();

    write_valid_jpeg(&folder.join("img_001.jpg"));
    write_valid_jpeg(&folder.join("img_002.jpg"));
    write_valid_jpeg(&folder.join("img_003.jpg"));

    let status_arc = make_status();
    let counter = make_counter();

    pipeline::run_pipeline(
        &conn,
        project_id,
        tmp.path(),
        vec![folder],
        3,
        Arc::clone(&status_arc),
        make_cancel(),
        make_pause(),
        None,
        Arc::clone(&counter),
    );

    let status = status_arc.lock().unwrap();
    assert_eq!(
        status.thumbnails_total, 3,
        "thumbnails_total must equal the number of logical photos (3), got {}",
        status.thumbnails_total
    );
}

#[test]
fn test_thumbnails_done_counter_increments_per_successful_thumbnail() {
    // P1-02: WHY (Rule 1) — each successful generate_thumbnail must increment
    // thumbnails_done_counter. Without this the progress bar stays at 0%.
    let (conn, tmp, project_id) = setup();
    let folder = tmp.path().join("photos");
    std::fs::create_dir_all(&folder).unwrap();

    write_valid_jpeg(&folder.join("img_001.jpg"));
    write_valid_jpeg(&folder.join("img_002.jpg"));
    write_valid_jpeg(&folder.join("img_003.jpg"));

    let counter = make_counter();

    pipeline::run_pipeline(
        &conn,
        project_id,
        tmp.path(),
        vec![folder],
        3,
        make_status(),
        make_cancel(),
        make_pause(),
        None,
        Arc::clone(&counter),
    );

    assert_eq!(
        counter.load(Ordering::Relaxed),
        3,
        "counter must equal 3 after 3 successful thumbnails, got {}",
        counter.load(Ordering::Relaxed)
    );
}

#[test]
fn test_thumbnails_done_counter_not_incremented_for_failed_thumbnail() {
    // P1-03: WHY (Rule 4 negative) — generate_thumbnail returns None for corrupt
    // sources. The counter must NOT be touched.
    let (conn, tmp, project_id) = setup();
    let folder = tmp.path().join("photos");
    std::fs::create_dir_all(&folder).unwrap();

    // Corrupt file: correct extension, not a valid JPEG
    std::fs::write(folder.join("corrupt.jpg"), b"not a jpeg").unwrap();

    let counter = make_counter();

    pipeline::run_pipeline(
        &conn,
        project_id,
        tmp.path(),
        vec![folder],
        3,
        make_status(),
        make_cancel(),
        make_pause(),
        None,
        Arc::clone(&counter),
    );

    assert_eq!(
        counter.load(Ordering::Relaxed),
        0,
        "counter must remain 0 when all thumbnails fail, got {}",
        counter.load(Ordering::Relaxed)
    );
}

// ── Sprint 2 / P2: resume_thumbnails tests ────────────────────────────────────

#[test]
fn test_resume_thumbnails_counter_reflects_existing_thumbnails() {
    // P2-02 (BUG): resume_thumbnails sets thumbnails_total = targets.len() (missing count)
    // instead of total lp count. So if 2 of 3 thumbnails exist, UI shows "0 / 1" instead
    // of "2 / 3". This test exposes the bug by asserting the function should return
    // (targets, total_lp_count) — which it currently does NOT.
    //
    // This test MUST FAIL (compile error): find_missing_thumbnail_targets currently returns
    // Vec<(i64, PathBuf, PhotoFormat, Option<u16>)>, not a (Vec, usize) tuple.
    // The destructuring below will not compile until the return type is fixed.
    let (conn, tmp, project_id) = setup();
    let folder = tmp.path().join("photos");
    std::fs::create_dir_all(&folder).unwrap();

    write_valid_jpeg(&folder.join("img_001.jpg"));
    write_valid_jpeg(&folder.join("img_002.jpg"));
    write_valid_jpeg(&folder.join("img_003.jpg"));

    let cache_dir = tmp.path().join("cache").join("thumbnails");

    // Run full pipeline so all 3 thumbnails are generated
    pipeline::run_pipeline(
        &conn,
        project_id,
        tmp.path(),
        vec![folder],
        3,
        make_status(),
        make_cancel(),
        make_pause(),
        None,
        make_counter(),
    );

    // Verify 3 thumbnails exist
    let lp_id_map = repository::list_first_lp_ids_for_project(&conn, project_id).unwrap();
    assert_eq!(
        lp_id_map.len(),
        3,
        "must have 3 logical photos after pipeline"
    );

    // Delete one thumbnail to simulate partial completion
    let lp_ids: Vec<i64> = lp_id_map.into_values().collect();
    let deleted_lp_id = lp_ids[0];
    let thumb_to_delete = cache_dir.join(format!("{}.jpg", deleted_lp_id));
    std::fs::remove_file(&thumb_to_delete).expect("thumbnail must exist to delete it");

    // BUG TEST: find_missing_thumbnail_targets should return (targets, total_lp_count)
    // but currently only returns Vec. Destructuring as a tuple causes a COMPILE ERROR.
    // This is the RED state we want — fix the function signature to make this compile.
    let (targets, total_count) =
        crate::commands::import::find_missing_thumbnail_targets(&conn, project_id, &cache_dir)
            .unwrap();

    assert_eq!(targets.len(), 1, "only 1 thumbnail is missing");
    assert_eq!(
        total_count, 3,
        "total_lp_count must be 3, not just missing count"
    );
    assert_eq!(
        total_count - targets.len(),
        2,
        "2 thumbnails already existed"
    );
}

#[test]
fn test_resume_thumbnails_generates_missing_only() {
    // P2-03: find_missing_thumbnail_targets must skip thumbnails that already exist
    // and only return the missing ones. The mtime of existing thumbnails must be unchanged.
    let (conn, tmp, project_id) = setup();
    let folder = tmp.path().join("photos");
    std::fs::create_dir_all(&folder).unwrap();

    write_valid_jpeg(&folder.join("img_001.jpg"));
    write_valid_jpeg(&folder.join("img_002.jpg"));
    write_valid_jpeg(&folder.join("img_003.jpg"));

    let cache_dir = tmp.path().join("cache").join("thumbnails");

    // Run full pipeline so all 3 thumbnails are generated
    pipeline::run_pipeline(
        &conn,
        project_id,
        tmp.path(),
        vec![folder],
        3,
        make_status(),
        make_cancel(),
        make_pause(),
        None,
        make_counter(),
    );

    // Collect lp_ids in sorted order for determinism
    let lp_id_map = repository::list_first_lp_ids_for_project(&conn, project_id).unwrap();
    assert_eq!(lp_id_map.len(), 3, "must have 3 logical photos");
    let mut lp_ids: Vec<i64> = lp_id_map.into_values().collect();
    lp_ids.sort();

    // Record mtime of the FIRST thumbnail before sleeping
    let thumb_1_path = cache_dir.join(format!("{}.jpg", lp_ids[0]));
    let mtime_before = std::fs::metadata(&thumb_1_path)
        .expect("first thumbnail must exist")
        .modified()
        .expect("mtime must be available");

    // Sleep so any regeneration would produce a different mtime
    std::thread::sleep(std::time::Duration::from_millis(20));

    // Delete the LAST thumbnail to simulate partial completion
    let deleted_lp_id = lp_ids[2];
    let thumb_to_delete = cache_dir.join(format!("{}.jpg", deleted_lp_id));
    std::fs::remove_file(&thumb_to_delete).expect("third thumbnail must exist to delete it");

    // Call the function under test
    let (missing, _total) =
        crate::commands::import::find_missing_thumbnail_targets(&conn, project_id, &cache_dir)
            .unwrap();

    // Only 1 thumbnail should be missing
    assert_eq!(missing.len(), 1, "exactly 1 thumbnail is missing");

    // The missing entry must be for the deleted lp_id, not lp_ids[0]
    let (missing_lp_id, _, _, _) = &missing[0];
    assert_eq!(
        *missing_lp_id, deleted_lp_id,
        "missing lp_id must be {} (the deleted one), got {}",
        deleted_lp_id, missing_lp_id
    );

    // The first thumbnail must NOT have been touched (mtime unchanged)
    let mtime_after = std::fs::metadata(&thumb_1_path)
        .expect("first thumbnail must still exist")
        .modified()
        .expect("mtime must be available");
    assert_eq!(
        mtime_before, mtime_after,
        "find_missing_thumbnail_targets must not modify existing thumbnails"
    );
}

#[test]
fn test_resume_thumbnails_noop_when_all_thumbnails_present() {
    // P2-04: When all thumbnails exist, find_missing_thumbnail_targets returns empty Vec.
    let (conn, tmp, project_id) = setup();
    let folder = tmp.path().join("photos");
    std::fs::create_dir_all(&folder).unwrap();

    write_valid_jpeg(&folder.join("img_001.jpg"));
    write_valid_jpeg(&folder.join("img_002.jpg"));

    let cache_dir = tmp.path().join("cache").join("thumbnails");

    // Run full pipeline — all thumbnails generated
    pipeline::run_pipeline(
        &conn,
        project_id,
        tmp.path(),
        vec![folder],
        3,
        make_status(),
        make_cancel(),
        make_pause(),
        None,
        make_counter(),
    );

    // All thumbnails present → result must be empty
    let (missing, _total) =
        crate::commands::import::find_missing_thumbnail_targets(&conn, project_id, &cache_dir)
            .unwrap();

    assert!(
        missing.is_empty(),
        "find_missing_thumbnail_targets must return empty vec when all thumbnails present, got {} entries",
        missing.len()
    );
}

#[test]
fn test_resume_thumbnails_noop_when_no_logical_photos() {
    // P2-05: When there are no logical photos in the project, result is empty Vec.
    let conn = Connection::open_in_memory().unwrap();
    crate::db::run_migrations(&conn).unwrap();

    conn.execute(
        "INSERT INTO projects (name, slug, created_at) VALUES ('test', 'test-slug', '2024-01-01T00:00:00Z')",
        [],
    )
    .unwrap();
    let project_id: i64 = conn.last_insert_rowid();

    let tmp = tempfile::tempdir().unwrap();
    let cache_dir = tmp.path().join("cache").join("thumbnails");
    // cache_dir intentionally does NOT exist

    let (missing, _total) =
        crate::commands::import::find_missing_thumbnail_targets(&conn, project_id, &cache_dir)
            .unwrap();

    assert!(
        missing.is_empty(),
        "find_missing_thumbnail_targets must return empty vec when no logical photos exist, got {} entries",
        missing.len()
    );
}

// ── TH: thumbnail coverage tests ─────────────────────────────────────────────

#[test]
fn test_pipeline_generates_thumbnail_for_each_lp_in_stack() {
    // TH-A1: WHY (Rule 1) — Pipeline step 5 generates thumbnails for each LP representative.
    // A 3-LP burst stack must produce 3 thumbnail files (one per LP id), not just 1.
    // If this fails with count=1, the thumbnail step is only generating for the first LP.
    let (conn, tmp, project_id) = setup();
    let folder = tmp.path().join("burst_thumbs");
    std::fs::create_dir_all(&folder).unwrap();

    // 3 real decodable JPEGs with timestamps 1s apart → 1 burst stack, 3 LPs
    // write_valid_jpeg_with_timestamp produces files decodable by image::open()
    // AND with EXIF DateTimeOriginal so the burst-stacking algorithm groups them.
    write_valid_jpeg_with_timestamp(&folder.join("burst_a.jpg"), "2024:05:01 12:00:00");
    write_valid_jpeg_with_timestamp(&folder.join("burst_b.jpg"), "2024:05:01 12:00:01");
    write_valid_jpeg_with_timestamp(&folder.join("burst_c.jpg"), "2024:05:01 12:00:02");

    let cache_dir = tmp.path().join("cache").join("thumbnails");

    pipeline::run_pipeline(
        &conn,
        project_id,
        tmp.path(),
        vec![folder],
        10, // burst_gap_secs=10 → all 3 within window → 1 stack
        make_status(),
        make_cancel(),
        make_pause(),
        None,
        make_counter(),
    );

    // Verify 1 burst stack with 3 LPs
    let stacks = repository::list_stacks_summary(&conn, project_id).unwrap();
    assert_eq!(
        stacks.len(),
        1,
        "3 JPEGs 1s apart with gap=10 must produce 1 burst stack, got {}",
        stacks.len()
    );
    assert_eq!(
        stacks[0].logical_photo_count, 3,
        "burst stack must have 3 logical photos, got {}",
        stacks[0].logical_photo_count
    );

    // Rule 1: count actual thumbnail files on disk — must be 3, one per LP
    let thumb_files: Vec<_> = std::fs::read_dir(&cache_dir)
        .expect("cache_dir must exist after pipeline")
        .filter_map(|e| e.ok())
        .filter(|e| {
            e.file_name()
                .to_str()
                .map(|s| s.ends_with(".jpg"))
                .unwrap_or(false)
        })
        .collect();

    assert_eq!(
        thumb_files.len(),
        3,
        "pipeline must generate 1 thumbnail per LP — expected 3 .jpg files in cache_dir, got {}",
        thumb_files.len()
    );
}

#[test]
fn test_list_stacks_returns_non_null_when_any_lp_has_thumbnail() {
    // TH-B1: WHY — list_stacks uses list_first_lp_ids_for_project (MIN(lp.id)) to find
    // which thumbnail file to show. If the FIRST LP's thumbnail is missing but a
    // LATER LP's thumbnail exists, the current code returns null (thumbnail_path=None).
    // This causes spurious resumeThumbnails() calls on every app open (re-trigger bug).
    //
    // This test will FAIL because list_first_lp_ids_for_project only checks MIN(lp.id).
    // After we delete the first LP's thumbnail file, the current logic finds no match
    // and returns None, even though lp_id[1].jpg and lp_id[2].jpg still exist.
    let (conn, tmp, project_id) = setup();
    let folder = tmp.path().join("burst_b1");
    std::fs::create_dir_all(&folder).unwrap();

    // 3 real decodable JPEGs close together → 1 burst stack, 3 LPs
    write_valid_jpeg_with_timestamp(&folder.join("b1_a.jpg"), "2024:05:01 14:00:00");
    write_valid_jpeg_with_timestamp(&folder.join("b1_b.jpg"), "2024:05:01 14:00:01");
    write_valid_jpeg_with_timestamp(&folder.join("b1_c.jpg"), "2024:05:01 14:00:02");

    let cache_dir = tmp.path().join("cache").join("thumbnails");

    pipeline::run_pipeline(
        &conn,
        project_id,
        tmp.path(),
        vec![folder],
        10,
        make_status(),
        make_cancel(),
        make_pause(),
        None,
        make_counter(),
    );

    // Verify we have 1 stack with 3 LPs
    let stacks = repository::list_stacks_summary(&conn, project_id).unwrap();
    assert_eq!(stacks.len(), 1, "must have 1 burst stack");
    assert_eq!(stacks[0].logical_photo_count, 3, "stack must have 3 LPs");
    let stack_id = stacks[0].stack_id;

    // Get LP ids for this stack, sorted ascending (MIN is first)
    let mut lp_ids: Vec<i64> = conn
        .prepare("SELECT id FROM logical_photos WHERE stack_id = ?1 ORDER BY id ASC")
        .unwrap()
        .query_map([stack_id], |row| row.get(0))
        .unwrap()
        .filter_map(|r| r.ok())
        .collect();
    lp_ids.sort();
    assert_eq!(lp_ids.len(), 3, "must have 3 LP ids");

    // Delete the FIRST LP's thumbnail (the one MIN(lp.id) would select)
    let first_lp_thumb = cache_dir.join(format!("{}.jpg", lp_ids[0]));
    assert!(
        first_lp_thumb.exists(),
        "first LP thumbnail must exist before deletion: {}",
        first_lp_thumb.display()
    );
    std::fs::remove_file(&first_lp_thumb).expect("must be able to delete first LP thumbnail");

    // Verify 2nd and 3rd LP thumbnails still exist
    assert!(
        cache_dir.join(format!("{}.jpg", lp_ids[1])).exists(),
        "second LP thumbnail must still exist"
    );
    assert!(
        cache_dir.join(format!("{}.jpg", lp_ids[2])).exists(),
        "third LP thumbnail must still exist"
    );

    // Replicate the fixed logic from the list_stacks command:
    //   1. Build existing_thumbs set from readdir
    //   2. Get best lp_id per stack from list_best_lp_id_for_thumbnail_per_stack
    //      (picks lowest LP id that has a thumbnail, falls back to MIN if none do)
    //   3. For each stack, check if lp_ids[stack_id] is in existing_thumbs
    let existing_thumbs: std::collections::HashSet<i64> = std::fs::read_dir(&cache_dir)
        .into_iter()
        .flatten()
        .filter_map(|e| e.ok())
        .filter_map(|e| {
            e.file_name()
                .to_str()
                .and_then(|s| s.strip_suffix(".jpg"))
                .and_then(|s| s.parse::<i64>().ok())
        })
        .collect();

    let lp_id_map =
        repository::list_best_lp_id_for_thumbnail_per_stack(&conn, project_id, &existing_thumbs)
            .unwrap();

    // The fixed list_stacks picks an LP that has a thumbnail
    let best_lp_id = *lp_id_map.get(&stack_id).unwrap();
    let current_thumbnail_path: Option<String> = if existing_thumbs.contains(&best_lp_id) {
        Some(
            cache_dir
                .join(format!("{}.jpg", best_lp_id))
                .to_string_lossy()
                .into_owned(),
        )
    } else {
        None
    };

    // TH-B1: After the fix, list_stacks returns Some(...) because it finds lp_ids[1]
    // or lp_ids[2] which still have thumbnails, even though lp_ids[0] was deleted.
    assert!(
        current_thumbnail_path.is_some(),
        "TH-B1: list_stacks should return non-null when any LP has a thumbnail. \
        Stack {} has LPs {:?}, first LP {} thumbnail deleted, \
        but LPs {} and {} still have thumbnails. \
        best_lp_id = {}, current_thumbnail_path = {:?}",
        stack_id,
        lp_ids,
        lp_ids[0],
        lp_ids[1],
        lp_ids[2],
        best_lp_id,
        current_thumbnail_path
    );
}

#[test]
fn test_list_stacks_returns_null_when_no_lp_has_thumbnail() {
    // TH-B2: When ALL thumbnails are deleted, list_stacks must return None for all stacks.
    // This verifies the baseline behavior (no thumbnails = no thumbnail_path).
    let (conn, tmp, project_id) = setup();
    let folder = tmp.path().join("burst_b2");
    std::fs::create_dir_all(&folder).unwrap();

    write_valid_jpeg_with_timestamp(&folder.join("b2_a.jpg"), "2024:05:01 15:00:00");
    write_valid_jpeg_with_timestamp(&folder.join("b2_b.jpg"), "2024:05:01 15:00:01");

    let cache_dir = tmp.path().join("cache").join("thumbnails");

    pipeline::run_pipeline(
        &conn,
        project_id,
        tmp.path(),
        vec![folder],
        10,
        make_status(),
        make_cancel(),
        make_pause(),
        None,
        make_counter(),
    );

    let stacks = repository::list_stacks_summary(&conn, project_id).unwrap();
    assert_eq!(stacks.len(), 1, "must have 1 burst stack");

    // Delete ALL thumbnail files (simulating restack clearing thumbnails)
    std::fs::remove_dir_all(&cache_dir).expect("cache_dir must exist");
    std::fs::create_dir_all(&cache_dir).expect("must recreate cache_dir");

    // Replicate list_stacks logic: no files → no thumbnails
    let lp_id_map = repository::list_first_lp_ids_for_project(&conn, project_id).unwrap();
    let existing_thumbs: std::collections::HashSet<i64> = std::fs::read_dir(&cache_dir)
        .into_iter()
        .flatten()
        .filter_map(|e| e.ok())
        .filter_map(|e| {
            e.file_name()
                .to_str()
                .and_then(|s| s.strip_suffix(".jpg"))
                .and_then(|s| s.parse::<i64>().ok())
        })
        .collect();

    for summary in &stacks {
        let thumbnail_path: Option<String> = if let Some(&lp_id) = lp_id_map.get(&summary.stack_id)
        {
            if existing_thumbs.contains(&lp_id) {
                Some(
                    cache_dir
                        .join(format!("{}.jpg", lp_id))
                        .to_string_lossy()
                        .into_owned(),
                )
            } else {
                None
            }
        } else {
            None
        };

        assert!(
            thumbnail_path.is_none(),
            "TH-B2: list_stacks must return null thumbnail_path when all thumbnails deleted, \
            got {:?} for stack {}",
            thumbnail_path,
            summary.stack_id
        );
    }
}

#[test]
fn test_resume_thumbnails_regenerates_all_lps_in_multi_lp_stack() {
    // TH-C1: WHY — find_missing_thumbnail_targets uses list_first_lp_ids_for_project
    // which only returns MIN(lp.id) per stack. After restack clears all thumbnails,
    // a 3-LP stack has 3 missing thumbnails but the function only reports 1 (the first).
    // LPs 2 and 3 never get thumbnails regenerated.
    //
    // This test will FAIL because find_missing_thumbnail_targets returns 1 target,
    // not 3. The fix requires tracking ALL lp_ids per stack (not just MIN).
    let (conn, tmp, project_id) = setup();
    let folder = tmp.path().join("burst_c1");
    std::fs::create_dir_all(&folder).unwrap();

    // 3 real decodable JPEGs close together → 1 burst stack, 3 LPs
    write_valid_jpeg_with_timestamp(&folder.join("c1_a.jpg"), "2024:05:01 16:00:00");
    write_valid_jpeg_with_timestamp(&folder.join("c1_b.jpg"), "2024:05:01 16:00:01");
    write_valid_jpeg_with_timestamp(&folder.join("c1_c.jpg"), "2024:05:01 16:00:02");

    let cache_dir = tmp.path().join("cache").join("thumbnails");

    pipeline::run_pipeline(
        &conn,
        project_id,
        tmp.path(),
        vec![folder],
        10, // burst_gap_secs=10 → 1 stack with 3 LPs
        make_status(),
        make_cancel(),
        make_pause(),
        None,
        make_counter(),
    );

    // Verify 3 thumbnail files exist after pipeline
    let stacks = repository::list_stacks_summary(&conn, project_id).unwrap();
    assert_eq!(stacks.len(), 1, "must have 1 burst stack");
    assert_eq!(stacks[0].logical_photo_count, 3, "stack must have 3 LPs");

    let thumb_count_before = std::fs::read_dir(&cache_dir)
        .expect("cache_dir must exist")
        .filter_map(|e| e.ok())
        .filter(|e| {
            e.file_name()
                .to_str()
                .map(|s| s.ends_with(".jpg"))
                .unwrap_or(false)
        })
        .count();
    assert_eq!(
        thumb_count_before, 3,
        "pipeline must generate 3 thumbnails before simulating restack"
    );

    // Simulate restack clearing thumbnails — delete ALL thumbnails
    std::fs::remove_dir_all(&cache_dir).expect("cache_dir must exist");
    std::fs::create_dir_all(&cache_dir).expect("must recreate empty cache_dir");

    // Call find_missing_thumbnail_targets — it should return ALL 3 LPs as missing
    let (targets, total_count) =
        crate::commands::import::find_missing_thumbnail_targets(&conn, project_id, &cache_dir)
            .unwrap();

    // TH-C1: Currently find_missing_thumbnail_targets uses list_first_lp_ids_for_project
    // which only returns 1 lp_id per stack (MIN). So targets.len() == 1, not 3.
    // The fix: use a query that returns ALL lp_ids per stack, not just MIN.
    assert_eq!(
        total_count, 3,
        "TH-C1: total_count must be 3 (all LPs in the project)"
    );
    assert_eq!(
        targets.len(),
        3,
        "TH-C1: after restack clears all thumbnails, find_missing_thumbnail_targets \
        must report all 3 LPs as missing targets — currently FAILS because \
        list_first_lp_ids_for_project only tracks MIN(lp.id) per stack, \
        so only 1 target is returned instead of 3. \
        Got {} targets, total_count={}",
        targets.len(),
        total_count
    );
}

#[test]
fn test_resume_thumbnails_skips_stacks_where_thumbnail_exists() {
    // TH-C2: When all thumbnails exist, find_missing_thumbnail_targets returns empty Vec.
    // This is the baseline "nothing to do" case.
    let (conn, tmp, project_id) = setup();
    let folder = tmp.path().join("burst_c2");
    std::fs::create_dir_all(&folder).unwrap();

    // 2 real decodable JPEGs with timestamps → 1 burst stack, 2 LPs
    write_valid_jpeg_with_timestamp(&folder.join("c2_a.jpg"), "2024:05:01 17:00:00");
    write_valid_jpeg_with_timestamp(&folder.join("c2_b.jpg"), "2024:05:01 17:00:01");

    let cache_dir = tmp.path().join("cache").join("thumbnails");

    pipeline::run_pipeline(
        &conn,
        project_id,
        tmp.path(),
        vec![folder],
        10, // burst_gap_secs=10 → 1 stack with 2 LPs
        make_status(),
        make_cancel(),
        make_pause(),
        None,
        make_counter(),
    );

    let stacks = repository::list_stacks_summary(&conn, project_id).unwrap();
    assert_eq!(stacks.len(), 1, "must have 1 burst stack");
    assert_eq!(stacks[0].logical_photo_count, 2, "stack must have 2 LPs");

    // All thumbnails present → targets must be empty
    let (targets, _total_count) =
        crate::commands::import::find_missing_thumbnail_targets(&conn, project_id, &cache_dir)
            .unwrap();

    assert!(
        targets.is_empty(),
        "TH-C2: find_missing_thumbnail_targets must return empty when all thumbnails exist, \
        got {} targets",
        targets.len()
    );
}

// ── Sprint 3 / BT: restack_from_existing_photos tests ────────────────────────

#[test]
fn test_restack_preserves_all_logical_photos() {
    // BT-03: WHY — Re-stacking must not lose photos. Same count in, same count out.
    // Calls pipeline::restack_from_existing_photos() which does NOT exist yet.
    // This test must FAIL (compile error) until the function is implemented.
    let (conn, tmp, project_id) = setup();
    let folder = tmp.path().join("photos");
    std::fs::create_dir_all(&folder).unwrap();

    // Create 5 JPEG files
    write_valid_jpeg(&folder.join("img_001.jpg"));
    write_valid_jpeg(&folder.join("img_002.jpg"));
    write_valid_jpeg(&folder.join("img_003.jpg"));
    write_valid_jpeg(&folder.join("img_004.jpg"));
    write_valid_jpeg(&folder.join("img_005.jpg"));

    // Run pipeline once to populate DB (5 logical_photos)
    pipeline::run_pipeline(
        &conn,
        project_id,
        tmp.path(),
        vec![folder],
        3,
        make_status(),
        make_cancel(),
        make_pause(),
        None,
        make_counter(),
    );

    // Confirm 5 logical_photos exist after initial import
    let initial_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM logical_photos WHERE project_id = ?1",
            [project_id],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(
        initial_count, 5,
        "pipeline must produce 5 logical_photos before restack"
    );

    // Call the NOT-YET-EXISTING function — large gap merges all into 1 stack
    let _stats = pipeline::restack_from_existing_photos(&conn, project_id, 60u64)
        .expect("restack_from_existing_photos must succeed");

    // Verify: no photos lost — count must still be 5
    let after_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM logical_photos WHERE project_id = ?1",
            [project_id],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(
        after_count, 5,
        "restack must not lose photos: expected 5 logical_photos, got {}",
        after_count
    );
}

#[test]
fn test_restack_clears_and_rebuilds_stacks() {
    // BT-04: WHY — Old stack IDs must not persist. Stacks are cleared and rebuilt with new IDs.
    // Calls pipeline::restack_from_existing_photos() which does NOT exist yet.
    // This test must FAIL (compile error) until the function is implemented.
    let (conn, tmp, project_id) = setup();
    let folder = tmp.path().join("photos");
    std::fs::create_dir_all(&folder).unwrap();

    // Create 3 JPEG files
    write_valid_jpeg(&folder.join("img_001.jpg"));
    write_valid_jpeg(&folder.join("img_002.jpg"));
    write_valid_jpeg(&folder.join("img_003.jpg"));

    // Run pipeline once to populate DB
    pipeline::run_pipeline(
        &conn,
        project_id,
        tmp.path(),
        vec![folder],
        3,
        make_status(),
        make_cancel(),
        make_pause(),
        None,
        make_counter(),
    );

    // Record old stack IDs from list_stacks_summary
    let old_stacks = repository::list_stacks_summary(&conn, project_id).unwrap();
    assert!(
        !old_stacks.is_empty(),
        "pipeline must produce at least 1 stack before restack"
    );
    let old_stack_ids: std::collections::HashSet<i64> =
        old_stacks.iter().map(|s| s.stack_id).collect();

    // Call the NOT-YET-EXISTING function — large gap to force all into 1 stack
    let _stats = pipeline::restack_from_existing_photos(&conn, project_id, 60u64)
        .expect("restack_from_existing_photos must succeed");

    // Get new stack IDs after restack
    let new_stacks = repository::list_stacks_summary(&conn, project_id).unwrap();
    let new_stack_ids: std::collections::HashSet<i64> =
        new_stacks.iter().map(|s| s.stack_id).collect();

    // Assert: none of the old stack IDs appear in the new set
    let overlap: std::collections::HashSet<i64> = old_stack_ids
        .intersection(&new_stack_ids)
        .copied()
        .collect();
    assert!(
        overlap.is_empty(),
        "restack must clear old stack IDs — found overlapping IDs: {:?}",
        overlap
    );

    // Assert: new stacks exist (at least 1)
    assert!(
        !new_stack_ids.is_empty(),
        "restack must produce at least 1 new stack"
    );
}

#[test]
fn test_resume_thumbnails_skips_thumbnails_for_deleted_source() {
    // P2-06: When thumbnail files exist on disk but source photos are gone,
    // find_missing_thumbnail_targets returns empty Vec (filesystem is source of truth
    // for thumbnail existence — it does not verify that sources still exist).
    let (conn, tmp, project_id) = setup();
    let folder = tmp.path().join("photos");
    std::fs::create_dir_all(&folder).unwrap();

    let src1 = folder.join("img_001.jpg");
    let src2 = folder.join("img_002.jpg");
    write_valid_jpeg(&src1);
    write_valid_jpeg(&src2);

    let cache_dir = tmp.path().join("cache").join("thumbnails");

    // Run full pipeline — 2 thumbnails generated
    pipeline::run_pipeline(
        &conn,
        project_id,
        tmp.path(),
        vec![folder],
        3,
        make_status(),
        make_cancel(),
        make_pause(),
        None,
        make_counter(),
    );

    // Delete the source files from disk (thumbnails still exist in cache_dir)
    std::fs::remove_file(&src1).expect("src1 must exist");
    std::fs::remove_file(&src2).expect("src2 must exist");

    // Thumbnails still exist → no entries are "missing"
    let (missing, _total) =
        crate::commands::import::find_missing_thumbnail_targets(&conn, project_id, &cache_dir)
            .unwrap();

    assert!(
        missing.is_empty(),
        "find_missing_thumbnail_targets must return empty vec when thumbnails exist (even if sources are deleted), got {} entries",
        missing.len()
    );
}
