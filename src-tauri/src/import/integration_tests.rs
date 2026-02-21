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

fn write_minimal_jpeg(path: &std::path::Path) {
    // Minimal valid JPEG (just SOI + EOI markers)
    std::fs::write(path, [0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0xFF, 0xD9]).unwrap();
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
    );

    let stacks = repository::list_stacks_summary(&conn, project_id).unwrap();
    assert!(!stacks.is_empty());
    assert_eq!(stats.errors, 0);
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
