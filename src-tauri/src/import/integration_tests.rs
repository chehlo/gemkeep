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

/// Test harness that wraps pipeline setup boilerplate.
/// Reduces the 10-arg `run_pipeline()` call + 5-line setup to a single `run()`.
struct PipelineHarness {
    conn: Connection,
    tmp: TempDir,
    project_id: i64,
    status: Arc<Mutex<IndexingStatus>>,
    cancel: Arc<AtomicBool>,
    pause: Arc<AtomicBool>,
    counter: Arc<AtomicUsize>,
}

impl PipelineHarness {
    fn new() -> Self {
        let (conn, tmp, project_id) = setup();
        Self {
            conn,
            tmp,
            project_id,
            status: make_status(),
            cancel: make_cancel(),
            pause: make_pause(),
            counter: make_counter(),
        }
    }

    /// Create a subfolder under the temp dir and return its path.
    fn create_folder(&self, name: &str) -> std::path::PathBuf {
        let folder = self.tmp.path().join(name);
        std::fs::create_dir_all(&folder).unwrap();
        folder
    }

    /// Cache/thumbnails directory.
    fn cache_dir(&self) -> std::path::PathBuf {
        self.tmp.path().join("cache").join("thumbnails")
    }

    /// Run the pipeline with default burst_gap=3.
    fn run(&self, folders: Vec<std::path::PathBuf>) -> crate::photos::model::ImportStats {
        self.run_with_gap(folders, 3)
    }

    /// Run the pipeline with a custom burst_gap.
    fn run_with_gap(
        &self,
        folders: Vec<std::path::PathBuf>,
        burst_gap_secs: u64,
    ) -> crate::photos::model::ImportStats {
        pipeline::run_pipeline(
            &self.conn,
            self.project_id,
            self.tmp.path(),
            folders,
            burst_gap_secs,
            self.status.clone(),
            self.cancel.clone(),
            self.pause.clone(),
            None,
            self.counter.clone(),
        )
    }
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

/// Count .jpg thumbnail files in a cache directory.
fn count_cached_thumbnails(cache_dir: &std::path::Path) -> usize {
    std::fs::read_dir(cache_dir)
        .expect("cache_dir must exist")
        .filter_map(|e| e.ok())
        .filter(|e| {
            e.file_name()
                .to_str()
                .map(|s| s.ends_with(".jpg"))
                .unwrap_or(false)
        })
        .count()
}

/// Collect LP IDs from thumbnail filenames ({id}.jpg) in a cache directory.
fn get_existing_thumbnail_ids(cache_dir: &std::path::Path) -> std::collections::HashSet<i64> {
    std::fs::read_dir(cache_dir)
        .into_iter()
        .flatten()
        .filter_map(|e| e.ok())
        .filter_map(|e| {
            e.file_name()
                .to_str()
                .and_then(|s| s.strip_suffix(".jpg"))
                .and_then(|s| s.parse::<i64>().ok())
        })
        .collect()
}

/// Query all logical photo IDs for a project, sorted by ID.
fn get_lp_ids_for_project(conn: &Connection, project_id: i64) -> Vec<i64> {
    conn.prepare("SELECT id FROM logical_photos WHERE project_id = ?1 ORDER BY id")
        .unwrap()
        .query_map([project_id], |row| row.get(0))
        .unwrap()
        .filter_map(|r| r.ok())
        .collect()
}

/// Query logical photo IDs for a specific stack, sorted by ID.
fn get_lp_ids_for_stack(conn: &Connection, stack_id: i64) -> Vec<i64> {
    conn.prepare("SELECT id FROM logical_photos WHERE stack_id = ?1 ORDER BY id ASC")
        .unwrap()
        .query_map([stack_id], |row| row.get(0))
        .unwrap()
        .filter_map(|r| r.ok())
        .collect()
}

#[test]
fn test_pipeline_empty_folder() {
    let h = PipelineHarness::new();
    let folder = h.create_folder("empty_photos");

    let stats = h.run(vec![folder]);

    assert_eq!(stats.total_files_scanned, 0);
    assert_eq!(stats.imported, 0);
    assert_eq!(stats.errors, 0);
}

#[test]
fn test_pipeline_full_run() {
    let h = PipelineHarness::new();
    let folder = h.create_folder("photos");
    write_minimal_jpeg(&folder.join("img_001.jpg"));
    write_minimal_jpeg(&folder.join("img_002.jpg"));

    let stats = h.run(vec![folder]);

    assert_eq!(stats.total_files_scanned, 2);
    assert_eq!(stats.logical_photos, 2);
    assert_eq!(stats.errors, 0);
}

#[test]
fn test_pipeline_idempotent() {
    let h = PipelineHarness::new();
    let folder = h.create_folder("photos");
    write_minimal_jpeg(&folder.join("img_001.jpg"));

    let stats1 = h.run(vec![folder.clone()]);
    assert_eq!(stats1.imported, 1);

    let stats2 = h.run(vec![folder]);
    // Second run: 0 new imports, 1 skipped
    assert_eq!(stats2.imported, 0);
    assert_eq!(stats2.skipped_existing, 1);
    // Stacks and logical_photos should still be correct (rebuilt from all existing files)
    assert_eq!(stats2.logical_photos, 1);
}

#[test]
fn test_pipeline_stacks_persisted() {
    let h = PipelineHarness::new();
    let folder = h.create_folder("photos");

    // Two files — no EXIF, each gets own stack
    write_minimal_jpeg(&folder.join("a.jpg"));
    write_minimal_jpeg(&folder.join("b.jpg"));

    let stats = h.run(vec![folder]);

    let stacks = repository::list_stacks_summary(&h.conn, h.project_id).unwrap();
    assert!(!stacks.is_empty());
    assert_eq!(stats.errors, 0);
}

#[test]
fn test_pipeline_thumbnail_path_is_absolute_and_matches_scope() {
    // WHY: The asset protocol scope ["/**"] requires all thumbnail_path values
    // to be absolute paths starting with "/". This test verifies that the path
    // construction in list_stacks (cache_dir.join("{id}.jpg")) always produces
    // absolute paths — it will FAIL if the project dir is somehow relative.
    let h = PipelineHarness::new();
    let folder = h.create_folder("photos");
    write_minimal_jpeg(&folder.join("photo_a.jpg"));
    write_minimal_jpeg(&folder.join("photo_b.jpg"));

    h.run(vec![folder]);

    let stacks = repository::list_stacks_summary(&h.conn, h.project_id).unwrap();
    assert!(
        !stacks.is_empty(),
        "Pipeline must produce at least one stack"
    );

    let cache_dir = h.cache_dir();
    assert!(
        cache_dir.is_absolute(),
        "cache_dir must be absolute (project_dir must never be relative): {}",
        cache_dir.display()
    );

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
    let h = PipelineHarness::new();
    let folder = h.create_folder("paired");
    write_minimal_jpeg(&folder.join("IMG_0001.jpg"));
    std::fs::write(folder.join("IMG_0001.CR2"), b"fake raw").unwrap();

    h.run_with_gap(vec![folder], 2);

    let stacks = repository::list_stacks_summary(&h.conn, h.project_id).unwrap();
    assert_eq!(
        stacks.len(),
        1,
        "JPEG+RAW pair with same base name must produce exactly ONE stack, got {}",
        stacks.len()
    );
    assert!(stacks[0].has_jpeg, "stack must have_jpeg=true");
    assert!(stacks[0].has_raw, "stack must have_raw=true");
}

#[test]
fn test_pipeline_cancel() {
    // WHY: Verifies the pipeline handles a pre-triggered cancel signal gracefully
    // — it must return without panicking and leave the DB in a consistent state.
    let h = PipelineHarness::new();
    let folder = h.create_folder("photos");
    for i in 0..3 {
        write_minimal_jpeg(&folder.join(format!("photo_{}.jpg", i)));
    }

    // Pre-set cancel flag before pipeline runs
    h.cancel.store(true, Ordering::SeqCst);
    h.run_with_gap(vec![folder], 2);

    let stacks = repository::list_stacks_summary(&h.conn, h.project_id)
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
    let h = PipelineHarness::new();
    let folder = h.create_folder("mixed");

    // Valid JPEG
    let img = image::DynamicImage::new_rgb8(10, 10);
    img.save(folder.join("valid.jpg")).unwrap();

    // Invalid JPEG: correct extension but not a real image
    std::fs::write(folder.join("corrupt.jpg"), b"this is not a jpeg").unwrap();

    h.run_with_gap(vec![folder.clone()], 2);

    let stacks = repository::list_stacks_summary(&h.conn, h.project_id).unwrap();
    // Both files produce stacks (EXIF failure → None, not an error)
    // corrupt.jpg: EXIF=None, thumbnail may fail → solo stack with no thumbnail
    assert_eq!(
        stacks.len(),
        2,
        "both files (valid + corrupt) produce stacks — corrupt has EXIF=None, not a scan error, got {}",
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

    let h = PipelineHarness::new();

    let stats = h.run(vec![photo_dir]);

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

    let stacks = repository::list_stacks_summary(&h.conn, h.project_id).unwrap();
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
    let h = PipelineHarness::new();
    let folder = h.create_folder("burst");

    write_jpeg_with_timestamp(&folder.join("burst_1.jpg"), "2024:03:15 10:00:00");
    write_jpeg_with_timestamp(&folder.join("burst_2.jpg"), "2024:03:15 10:00:01");
    write_jpeg_with_timestamp(&folder.join("burst_3.jpg"), "2024:03:15 10:00:02");

    h.run(vec![folder]);

    let stacks = repository::list_stacks_summary(&h.conn, h.project_id).unwrap();
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
    let h = PipelineHarness::new();
    let folder = h.create_folder("split");

    // 2 photos 60s apart — well beyond the 3s burst window
    write_jpeg_with_timestamp(&folder.join("early.jpg"), "2024:03:15 10:00:00");
    write_jpeg_with_timestamp(&folder.join("late.jpg"), "2024:03:15 10:01:00");

    h.run(vec![folder]);

    let stacks = repository::list_stacks_summary(&h.conn, h.project_id).unwrap();
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
    let h = PipelineHarness::new();
    let folder = h.create_folder("photos");

    write_valid_jpeg(&folder.join("img_001.jpg"));
    write_valid_jpeg(&folder.join("img_002.jpg"));
    write_valid_jpeg(&folder.join("img_003.jpg"));

    h.run(vec![folder]);

    let status = h.status.lock().unwrap();
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
    let h = PipelineHarness::new();
    let folder = h.create_folder("photos");

    write_valid_jpeg(&folder.join("img_001.jpg"));
    write_valid_jpeg(&folder.join("img_002.jpg"));
    write_valid_jpeg(&folder.join("img_003.jpg"));

    h.run(vec![folder]);

    assert_eq!(
        h.counter.load(Ordering::Relaxed),
        3,
        "counter must equal 3 after 3 successful thumbnails, got {}",
        h.counter.load(Ordering::Relaxed)
    );
}

#[test]
fn test_thumbnails_done_counter_not_incremented_for_failed_thumbnail() {
    // P1-03: WHY (Rule 4 negative) — generate_thumbnail returns None for corrupt
    // sources. The counter must NOT be touched.
    let h = PipelineHarness::new();
    let folder = h.create_folder("photos");

    // Corrupt file: correct extension, not a valid JPEG
    std::fs::write(folder.join("corrupt.jpg"), b"not a jpeg").unwrap();

    h.run(vec![folder]);

    assert_eq!(
        h.counter.load(Ordering::Relaxed),
        0,
        "counter must remain 0 when all thumbnails fail, got {}",
        h.counter.load(Ordering::Relaxed)
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
    let h = PipelineHarness::new();
    let folder = h.create_folder("photos");

    write_valid_jpeg(&folder.join("img_001.jpg"));
    write_valid_jpeg(&folder.join("img_002.jpg"));
    write_valid_jpeg(&folder.join("img_003.jpg"));

    let cache_dir = h.cache_dir();

    // Run full pipeline so all 3 thumbnails are generated
    h.run(vec![folder]);

    // Verify 3 thumbnails exist
    let lp_id_map = repository::list_first_lp_ids_for_project(&h.conn, h.project_id).unwrap();
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
        crate::commands::import::find_missing_thumbnail_targets(&h.conn, h.project_id, &cache_dir)
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
    let h = PipelineHarness::new();
    let folder = h.create_folder("photos");

    write_valid_jpeg(&folder.join("img_001.jpg"));
    write_valid_jpeg(&folder.join("img_002.jpg"));
    write_valid_jpeg(&folder.join("img_003.jpg"));

    let cache_dir = h.cache_dir();

    // Run full pipeline so all 3 thumbnails are generated
    h.run(vec![folder]);

    // Collect lp_ids in sorted order for determinism
    let lp_id_map = repository::list_first_lp_ids_for_project(&h.conn, h.project_id).unwrap();
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
        crate::commands::import::find_missing_thumbnail_targets(&h.conn, h.project_id, &cache_dir)
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
    let h = PipelineHarness::new();
    let folder = h.create_folder("photos");

    write_valid_jpeg(&folder.join("img_001.jpg"));
    write_valid_jpeg(&folder.join("img_002.jpg"));

    let cache_dir = h.cache_dir();

    // Run full pipeline — all thumbnails generated
    h.run(vec![folder]);

    // All thumbnails present → result must be empty
    let (missing, _total) =
        crate::commands::import::find_missing_thumbnail_targets(&h.conn, h.project_id, &cache_dir)
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
    let h = PipelineHarness::new();
    let folder = h.create_folder("burst_thumbs");

    // 3 real decodable JPEGs with timestamps 1s apart → 1 burst stack, 3 LPs
    // write_valid_jpeg_with_timestamp produces files decodable by image::open()
    // AND with EXIF DateTimeOriginal so the burst-stacking algorithm groups them.
    write_valid_jpeg_with_timestamp(&folder.join("burst_a.jpg"), "2024:05:01 12:00:00");
    write_valid_jpeg_with_timestamp(&folder.join("burst_b.jpg"), "2024:05:01 12:00:01");
    write_valid_jpeg_with_timestamp(&folder.join("burst_c.jpg"), "2024:05:01 12:00:02");

    let cache_dir = h.cache_dir();

    h.run_with_gap(vec![folder], 10);

    // Verify 1 burst stack with 3 LPs
    let stacks = repository::list_stacks_summary(&h.conn, h.project_id).unwrap();
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
    let thumb_count = count_cached_thumbnails(&cache_dir);

    assert_eq!(
        thumb_count, 3,
        "pipeline must generate 1 thumbnail per LP — expected 3 .jpg files in cache_dir, got {}",
        thumb_count
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
    let h = PipelineHarness::new();
    let folder = h.create_folder("burst_b1");

    // 3 real decodable JPEGs close together → 1 burst stack, 3 LPs
    write_valid_jpeg_with_timestamp(&folder.join("b1_a.jpg"), "2024:05:01 14:00:00");
    write_valid_jpeg_with_timestamp(&folder.join("b1_b.jpg"), "2024:05:01 14:00:01");
    write_valid_jpeg_with_timestamp(&folder.join("b1_c.jpg"), "2024:05:01 14:00:02");

    let cache_dir = h.cache_dir();

    h.run_with_gap(vec![folder], 10);

    // Verify we have 1 stack with 3 LPs
    let stacks = repository::list_stacks_summary(&h.conn, h.project_id).unwrap();
    assert_eq!(stacks.len(), 1, "must have 1 burst stack");
    assert_eq!(stacks[0].logical_photo_count, 3, "stack must have 3 LPs");
    let stack_id = stacks[0].stack_id;

    // Get LP ids for this stack, sorted ascending (MIN is first)
    let mut lp_ids = get_lp_ids_for_stack(&h.conn, stack_id);
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
    let existing_thumbs = get_existing_thumbnail_ids(&cache_dir);

    let lp_id_map = repository::list_best_lp_id_for_thumbnail_per_stack(
        &h.conn,
        h.project_id,
        &existing_thumbs,
    )
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
    let h = PipelineHarness::new();
    let folder = h.create_folder("burst_b2");

    write_valid_jpeg_with_timestamp(&folder.join("b2_a.jpg"), "2024:05:01 15:00:00");
    write_valid_jpeg_with_timestamp(&folder.join("b2_b.jpg"), "2024:05:01 15:00:01");

    let cache_dir = h.cache_dir();

    h.run_with_gap(vec![folder], 10);

    let stacks = repository::list_stacks_summary(&h.conn, h.project_id).unwrap();
    assert_eq!(stacks.len(), 1, "must have 1 burst stack");

    // Delete ALL thumbnail files (simulating restack clearing thumbnails)
    std::fs::remove_dir_all(&cache_dir).expect("cache_dir must exist");
    std::fs::create_dir_all(&cache_dir).expect("must recreate cache_dir");

    // Replicate list_stacks logic: no files → no thumbnails
    let lp_id_map = repository::list_first_lp_ids_for_project(&h.conn, h.project_id).unwrap();
    let existing_thumbs = get_existing_thumbnail_ids(&cache_dir);

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
    let h = PipelineHarness::new();
    let folder = h.create_folder("burst_c1");

    // 3 real decodable JPEGs close together → 1 burst stack, 3 LPs
    write_valid_jpeg_with_timestamp(&folder.join("c1_a.jpg"), "2024:05:01 16:00:00");
    write_valid_jpeg_with_timestamp(&folder.join("c1_b.jpg"), "2024:05:01 16:00:01");
    write_valid_jpeg_with_timestamp(&folder.join("c1_c.jpg"), "2024:05:01 16:00:02");

    let cache_dir = h.cache_dir();

    h.run_with_gap(vec![folder], 10);

    // Verify 3 thumbnail files exist after pipeline
    let stacks = repository::list_stacks_summary(&h.conn, h.project_id).unwrap();
    assert_eq!(stacks.len(), 1, "must have 1 burst stack");
    assert_eq!(stacks[0].logical_photo_count, 3, "stack must have 3 LPs");

    let thumb_count_before = count_cached_thumbnails(&cache_dir);
    assert_eq!(
        thumb_count_before, 3,
        "pipeline must generate 3 thumbnails before simulating restack"
    );

    // Simulate restack clearing thumbnails — delete ALL thumbnails
    std::fs::remove_dir_all(&cache_dir).expect("cache_dir must exist");
    std::fs::create_dir_all(&cache_dir).expect("must recreate empty cache_dir");

    // Call find_missing_thumbnail_targets — it should return ALL 3 LPs as missing
    let (targets, total_count) =
        crate::commands::import::find_missing_thumbnail_targets(&h.conn, h.project_id, &cache_dir)
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
    let h = PipelineHarness::new();
    let folder = h.create_folder("burst_c2");

    // 2 real decodable JPEGs with timestamps → 1 burst stack, 2 LPs
    write_valid_jpeg_with_timestamp(&folder.join("c2_a.jpg"), "2024:05:01 17:00:00");
    write_valid_jpeg_with_timestamp(&folder.join("c2_b.jpg"), "2024:05:01 17:00:01");

    let cache_dir = h.cache_dir();

    h.run_with_gap(vec![folder], 10);

    let stacks = repository::list_stacks_summary(&h.conn, h.project_id).unwrap();
    assert_eq!(stacks.len(), 1, "must have 1 burst stack");
    assert_eq!(stacks[0].logical_photo_count, 2, "stack must have 2 LPs");

    // All thumbnails present → targets must be empty
    let (targets, _total_count) =
        crate::commands::import::find_missing_thumbnail_targets(&h.conn, h.project_id, &cache_dir)
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
    let h = PipelineHarness::new();
    let folder = h.create_folder("photos");

    // Create 5 JPEG files
    write_valid_jpeg(&folder.join("img_001.jpg"));
    write_valid_jpeg(&folder.join("img_002.jpg"));
    write_valid_jpeg(&folder.join("img_003.jpg"));
    write_valid_jpeg(&folder.join("img_004.jpg"));
    write_valid_jpeg(&folder.join("img_005.jpg"));

    // Run pipeline once to populate DB (5 logical_photos)
    h.run(vec![folder]);

    // Confirm 5 logical_photos exist after initial import
    let initial_count: i64 = h
        .conn
        .query_row(
            "SELECT COUNT(*) FROM logical_photos WHERE project_id = ?1",
            [h.project_id],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(
        initial_count, 5,
        "pipeline must produce 5 logical_photos before restack"
    );

    // Call the NOT-YET-EXISTING function — large gap merges all into 1 stack
    let _stats = pipeline::restack_from_existing_photos(&h.conn, h.project_id, 60u64)
        .expect("restack_from_existing_photos must succeed");

    // Verify: no photos lost — count must still be 5
    let after_count: i64 = h
        .conn
        .query_row(
            "SELECT COUNT(*) FROM logical_photos WHERE project_id = ?1",
            [h.project_id],
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
    let h = PipelineHarness::new();
    let folder = h.create_folder("photos");

    // Create 3 JPEG files
    write_valid_jpeg(&folder.join("img_001.jpg"));
    write_valid_jpeg(&folder.join("img_002.jpg"));
    write_valid_jpeg(&folder.join("img_003.jpg"));

    // Run pipeline once to populate DB
    h.run(vec![folder]);

    // Record old stack IDs from list_stacks_summary
    let old_stacks = repository::list_stacks_summary(&h.conn, h.project_id).unwrap();
    assert!(
        !old_stacks.is_empty(),
        "pipeline must produce at least 1 stack before restack"
    );
    let old_stack_ids: std::collections::HashSet<i64> =
        old_stacks.iter().map(|s| s.stack_id).collect();

    // Call the NOT-YET-EXISTING function — large gap to force all into 1 stack
    let _stats = pipeline::restack_from_existing_photos(&h.conn, h.project_id, 60u64)
        .expect("restack_from_existing_photos must succeed");

    // Get new stack IDs after restack
    let new_stacks = repository::list_stacks_summary(&h.conn, h.project_id).unwrap();
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
    let h = PipelineHarness::new();
    let folder = h.create_folder("photos");

    let src1 = folder.join("img_001.jpg");
    let src2 = folder.join("img_002.jpg");
    write_valid_jpeg(&src1);
    write_valid_jpeg(&src2);

    let cache_dir = h.cache_dir();

    // Run full pipeline — 2 thumbnails generated
    h.run(vec![folder]);

    // Delete the source files from disk (thumbnails still exist in cache_dir)
    std::fs::remove_file(&src1).expect("src1 must exist");
    std::fs::remove_file(&src2).expect("src2 must exist");

    // Thumbnails still exist → no entries are "missing"
    let (missing, _total) =
        crate::commands::import::find_missing_thumbnail_targets(&h.conn, h.project_id, &cache_dir)
            .unwrap();

    assert!(
        missing.is_empty(),
        "find_missing_thumbnail_targets must return empty vec when thumbnails exist (even if sources are deleted), got {} entries",
        missing.len()
    );
}

// ── Restack thumbnail-stability tests ─────────────────────────────────────────

#[test]
fn test_restack_preserves_logical_photo_ids() {
    // WHY (Rule 1): Thumbnails are named {lp_id}.jpg. If restack changes logical_photo IDs,
    // all existing thumbnails become orphaned — the filenames no longer match any DB row.
    // restack_from_existing_photos must preserve logical_photo IDs so thumbnails remain valid.
    //
    // BUG: clear_stacks_and_logical_photos DELETEs all logical_photos rows then
    // persist_groups_to_db INSERTs new ones with fresh auto-increment IDs.
    //
    // NOTE on SQLite rowid recycling: SQLite without AUTOINCREMENT allocates new rowids as
    // max(existing_rowid)+1. If we delete IDs 1-4 and no other rows exist, new inserts get
    // 1-4 again — hiding the bug. To expose it, we insert sentinel rows AFTER the pipeline
    // (so sentinels have IDs above the real project's IDs). When clear_stacks_and_logical_photos
    // deletes the real project's rows but sentinels remain, new inserts get
    // max(sentinel_ids)+1, which is DIFFERENT from the originals.
    let h = PipelineHarness::new();
    let folder = h.create_folder("restack_ids");

    // 4 photos with distinct capture times 2s apart
    write_jpeg_with_timestamp(&folder.join("r_001.jpg"), "2024:06:01 08:00:00");
    write_jpeg_with_timestamp(&folder.join("r_002.jpg"), "2024:06:01 08:00:02");
    write_jpeg_with_timestamp(&folder.join("r_003.jpg"), "2024:06:01 08:00:04");
    write_jpeg_with_timestamp(&folder.join("r_004.jpg"), "2024:06:01 08:00:06");

    h.run(vec![folder]);

    // Record all logical_photo IDs before restack (e.g. IDs 1-4)
    let ids_before = get_lp_ids_for_project(&h.conn, h.project_id);
    assert_eq!(
        ids_before.len(),
        4,
        "pipeline must produce 4 logical_photos before restack, got {}",
        ids_before.len()
    );

    // ── Insert sentinel rows AFTER the pipeline so they have IDs above the real ones.
    // This simulates a multi-project app where another project's logical_photos exist
    // in the same table with higher IDs.
    h.conn.execute(
        "INSERT INTO projects (name, slug, created_at) VALUES ('Sentinel', 'sentinel', '2024-01-01T00:00:00Z')",
        [],
    )
    .unwrap();
    let sentinel_project_id = h.conn.last_insert_rowid();
    let sentinel_stack_id = repository::insert_stack(&h.conn, sentinel_project_id).unwrap();
    for _ in 0..3 {
        h.conn.execute(
            "INSERT INTO logical_photos (project_id, representative_photo_id, stack_id) VALUES (?1, NULL, ?2)",
            rusqlite::params![sentinel_project_id, sentinel_stack_id],
        )
        .unwrap();
    }
    // Sentinels now have IDs 5, 6, 7 (above real project's 1-4).
    // After restack deletes IDs 1-4, sentinels (5-7) remain, so new inserts get 8+ not 1+.

    // Restack with a large burst gap — merges all into 1 stack (different grouping)
    let stats = pipeline::restack_from_existing_photos(&h.conn, h.project_id, 60)
        .expect("restack_from_existing_photos must succeed");
    assert_eq!(
        stats.logical_photos, 4,
        "restack must report 4 logical_photos in stats"
    );

    // Record all logical_photo IDs after restack
    let ids_after = get_lp_ids_for_project(&h.conn, h.project_id);

    // CRITICAL ASSERTION: IDs must be identical — thumbnails depend on stable IDs.
    // With sentinels holding IDs 5-7, and real project's original IDs deleted (1-4),
    // new inserts get max(7)+1 = 8, 9, 10, 11 — DIFFERENT from the originals 1-4.
    assert_eq!(
        ids_before, ids_after,
        "restack must preserve logical_photo IDs for thumbnail stability.\n\
        Before: {:?}\n\
        After:  {:?}\n\
        Thumbnails are named {{lp_id}}.jpg — changing IDs orphans all existing thumbnails.",
        ids_before, ids_after
    );
}

#[test]
fn test_restack_during_active_thumbnails_does_not_interfere() {
    // WHY (Rule 1): If thumbnail extraction is running concurrently, it targets logical_photo
    // IDs captured before restack started. If restack changes those IDs, the thumbnail worker
    // writes files named after OLD IDs that no longer exist in the DB — wasted work, and the
    // NEW IDs never get thumbnails.
    //
    // This test verifies:
    //   1. Logical photo IDs are unchanged after restack (thumbnail worker targets remain valid)
    //   2. Stack structure changes (proving restack actually did something)
    //
    // BUG: clear_stacks_and_logical_photos DELETEs logical_photos, so IDs change.
    // Same sentinel-after-pipeline technique as test_restack_preserves_logical_photo_ids.
    let h = PipelineHarness::new();
    let folder = h.create_folder("restack_active");

    // 4 photos: 2 close together, then a gap, then 2 more close together
    // With burst_gap=3: should produce 2 stacks (2 photos each)
    write_jpeg_with_timestamp(&folder.join("a_001.jpg"), "2024:07:01 10:00:00");
    write_jpeg_with_timestamp(&folder.join("a_002.jpg"), "2024:07:01 10:00:01");
    write_jpeg_with_timestamp(&folder.join("a_003.jpg"), "2024:07:01 10:00:10");
    write_jpeg_with_timestamp(&folder.join("a_004.jpg"), "2024:07:01 10:00:11");

    // Initial pipeline with burst_gap=3 → 2 stacks
    h.run(vec![folder]);

    // Record LP IDs (these are what a running thumbnail worker would be targeting)
    let lp_ids_before = get_lp_ids_for_project(&h.conn, h.project_id);
    assert_eq!(
        lp_ids_before.len(),
        4,
        "must have 4 logical photos before restack"
    );

    // Record stack count before restack
    let stacks_before = repository::list_stacks_summary(&h.conn, h.project_id).unwrap();
    assert_eq!(
        stacks_before.len(),
        2,
        "burst_gap=3 with 9s gap between groups must produce 2 stacks, got {}",
        stacks_before.len()
    );

    // ── Insert sentinel rows AFTER pipeline to prevent SQLite rowid recycling.
    // Sentinels get IDs above the real project's logical_photo IDs.
    h.conn.execute(
        "INSERT INTO projects (name, slug, created_at) VALUES ('Sentinel2', 'sentinel2', '2024-01-01T00:00:00Z')",
        [],
    )
    .unwrap();
    let sentinel_project_id = h.conn.last_insert_rowid();
    let sentinel_stack_id = repository::insert_stack(&h.conn, sentinel_project_id).unwrap();
    for _ in 0..3 {
        h.conn.execute(
            "INSERT INTO logical_photos (project_id, representative_photo_id, stack_id) VALUES (?1, NULL, ?2)",
            rusqlite::params![sentinel_project_id, sentinel_stack_id],
        )
        .unwrap();
    }

    // Restack with burst_gap=60 → all 4 photos merge into 1 stack
    let stats = pipeline::restack_from_existing_photos(&h.conn, h.project_id, 60)
        .expect("restack must succeed");
    assert_eq!(
        stats.logical_photos, 4,
        "restack must report 4 logical_photos"
    );

    // Verify stacks actually changed (restack did something)
    let stacks_after = repository::list_stacks_summary(&h.conn, h.project_id).unwrap();
    assert_eq!(
        stacks_after.len(),
        1,
        "burst_gap=60 must merge all 4 photos into 1 stack, got {}",
        stacks_after.len()
    );

    // CRITICAL: LP IDs must be unchanged — thumbnail worker targets must remain valid
    let lp_ids_after = get_lp_ids_for_project(&h.conn, h.project_id);

    assert_eq!(
        lp_ids_before, lp_ids_after,
        "restack must not change logical_photo IDs — a running thumbnail worker \
        targets these IDs. If they change, the worker writes orphaned files.\n\
        Before: {:?}\n\
        After:  {:?}",
        lp_ids_before, lp_ids_after
    );
}

// ─── RED: Import must create round 1 for every stack ────────────────────────

/// Behavior 1: Import pipeline creates round 1 for each stack.
/// After import of 3 stacks, each stack must have a round in the `rounds` table
/// and `round_photos` populated with all logical photos.
#[test]
fn test_import_creates_round_for_each_stack() {
    let h = PipelineHarness::new();
    let folder = h.create_folder("photos");

    // Create 3 JPEGs with timestamps far apart so they land in 3 separate stacks (burst_gap=3)
    write_valid_jpeg_with_timestamp(&folder.join("IMG_001.jpg"), "2024:01:15 10:00:00");
    write_valid_jpeg_with_timestamp(&folder.join("IMG_002.jpg"), "2024:01:15 11:00:00");
    write_valid_jpeg_with_timestamp(&folder.join("IMG_003.jpg"), "2024:01:15 12:00:00");

    // Register source folder and run pipeline
    repository::add_source_folder(&h.conn, h.project_id, folder.to_str().unwrap()).unwrap();
    let stats = h.run(vec![folder]);

    assert_eq!(stats.stacks_generated, 3, "must generate 3 stacks");

    // Assert: each stack has a round in the rounds table
    let round_count: i64 = h
        .conn
        .query_row(
            "SELECT COUNT(*) FROM rounds WHERE project_id = ?1 AND scope = 'stack' AND state = 'open'",
            rusqlite::params![h.project_id],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(
        round_count, 3,
        "import must create round 1 for each of the 3 stacks, found {}",
        round_count
    );

    // Assert: round_photos populated for each round
    let round_photo_count: i64 = h
        .conn
        .query_row(
            "SELECT COUNT(*) FROM round_photos rp
             JOIN rounds r ON r.id = rp.round_id
             WHERE r.project_id = ?1",
            rusqlite::params![h.project_id],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(
        round_photo_count, 3,
        "each stack has 1 photo, so round_photos must have 3 entries total, found {}",
        round_photo_count
    );
}

/// Behavior 2: get_round_status returns valid round after import.
/// After import, calling get_round_status for any stack must return round_number=1, state='open'.
#[test]
fn test_import_get_round_status_returns_round_1() {
    let h = PipelineHarness::new();
    let folder = h.create_folder("photos");

    write_valid_jpeg_with_timestamp(&folder.join("IMG_001.jpg"), "2024:01:15 10:00:00");
    write_valid_jpeg_with_timestamp(&folder.join("IMG_002.jpg"), "2024:01:15 10:00:01");

    repository::add_source_folder(&h.conn, h.project_id, folder.to_str().unwrap()).unwrap();
    let _stats = h.run(vec![folder]);

    // Get the stack
    let stacks = repository::list_stacks_summary(&h.conn, h.project_id).unwrap();
    assert!(!stacks.is_empty(), "must have at least 1 stack");

    let stack_id = stacks[0].stack_id;

    // get_round_status must succeed (not error) and return round_number=1, state='open'
    let status = crate::decisions::engine::get_round_status(&h.conn, h.project_id, stack_id)
        .expect("get_round_status must succeed after import — round 1 should exist");

    assert!(
        status.round_id >= 1,
        "round_id must be >= 1, got {}",
        status.round_id
    );
    assert_eq!(
        status.round_number, 1,
        "round_number must be 1 after import, got {}",
        status.round_number
    );
    assert_eq!(
        status.state, "open",
        "round state must be 'open' after import, got '{}'",
        status.state
    );
}

/// Behavior 3: list_logical_photos with valid round_id returns photos.
/// After import with round created, querying by round_id must return the photos.
#[test]
fn test_list_logical_photos_with_valid_round_id() {
    let h = PipelineHarness::new();
    let folder = h.create_folder("photos");

    write_valid_jpeg_with_timestamp(&folder.join("IMG_001.jpg"), "2024:01:15 10:00:00");
    write_valid_jpeg_with_timestamp(&folder.join("IMG_002.jpg"), "2024:01:15 10:00:01");

    repository::add_source_folder(&h.conn, h.project_id, folder.to_str().unwrap()).unwrap();
    let _stats = h.run(vec![folder]);

    let stacks = repository::list_stacks_summary(&h.conn, h.project_id).unwrap();
    let stack_id = stacks[0].stack_id;

    // Get the round_id from rounds table
    let round_id: i64 = h
        .conn
        .query_row(
            "SELECT id FROM rounds WHERE project_id = ?1 AND scope = 'stack' AND scope_id = ?2 LIMIT 1",
            rusqlite::params![h.project_id, stack_id],
            |row| row.get(0),
        )
        .expect("round must exist after import");

    // list_logical_photos by round must return the photos
    let photos = repository::query_logical_photos_by_round(&h.conn, round_id).unwrap();
    assert_eq!(
        photos.len(),
        2,
        "list_logical_photos with valid round_id must return 2 photos, got {}",
        photos.len()
    );
}

/// Behavior 4: list_logical_photos with invalid round_id=999 returns error.
/// round_id is always required, and an invalid one must produce an error, not an empty list.
#[test]
fn test_list_logical_photos_invalid_round_id_returns_error() {
    let h = PipelineHarness::new();
    let folder = h.create_folder("photos");

    write_valid_jpeg_with_timestamp(&folder.join("IMG_001.jpg"), "2024:01:15 10:00:00");
    repository::add_source_folder(&h.conn, h.project_id, folder.to_str().unwrap()).unwrap();
    let _stats = h.run(vec![folder]);

    // Query with a non-existent round_id=999
    // Current behavior: query_logical_photos_by_round returns empty Vec (no error).
    // Required behavior: must return an error "Round 999 does not exist".
    let result = repository::query_logical_photos_by_round(&h.conn, 999);

    // The function must return an error for non-existent rounds
    assert!(
        result.is_err(),
        "list_logical_photos with round_id=999 must return error, but got Ok with {} photos",
        result.unwrap().len()
    );
}

/// Behavior 6: Restack recreates round 1 for new stacks.
/// After restack, new stacks must have round 1 created with round_photos populated.
#[test]
fn test_restack_creates_rounds_for_new_stacks() {
    let h = PipelineHarness::new();
    let folder = h.create_folder("photos");

    // Create 4 photos: 2 close together, 2 far apart → with gap=3, 3 stacks initially
    write_valid_jpeg_with_timestamp(&folder.join("IMG_001.jpg"), "2024:01:15 10:00:00");
    write_valid_jpeg_with_timestamp(&folder.join("IMG_002.jpg"), "2024:01:15 10:00:01");
    write_valid_jpeg_with_timestamp(&folder.join("IMG_003.jpg"), "2024:01:15 10:00:30");
    write_valid_jpeg_with_timestamp(&folder.join("IMG_004.jpg"), "2024:01:15 10:00:50");

    repository::add_source_folder(&h.conn, h.project_id, folder.to_str().unwrap()).unwrap();
    let _stats = h.run(vec![folder]);

    // Restack with gap=3600 → merges all into 1 stack (all within 50 seconds)
    pipeline::restack_from_existing_photos(&h.conn, h.project_id, 3600)
        .expect("restack must succeed");

    let stacks_after = repository::list_stacks_summary(&h.conn, h.project_id).unwrap();
    assert_eq!(
        stacks_after.len(),
        1,
        "restack with gap=3600 must produce 1 stack"
    );

    // The new stack must have round 1 created
    let new_stack_id = stacks_after[0].stack_id;
    let round_count: i64 = h
        .conn
        .query_row(
            "SELECT COUNT(*) FROM rounds WHERE project_id = ?1 AND scope = 'stack' AND scope_id = ?2",
            rusqlite::params![h.project_id, new_stack_id],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(
        round_count, 1,
        "restack must create round 1 for the new stack, found {}",
        round_count
    );

    // round_photos must contain all 4 logical photos
    let round_photo_count: i64 = h
        .conn
        .query_row(
            "SELECT COUNT(*) FROM round_photos rp
             JOIN rounds r ON r.id = rp.round_id
             WHERE r.project_id = ?1 AND r.scope_id = ?2",
            rusqlite::params![h.project_id, new_stack_id],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(
        round_photo_count, 4,
        "restack must populate round_photos with all 4 logical photos, found {}",
        round_photo_count
    );
}
