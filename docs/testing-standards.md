# GemKeep Testing Standards

## Testing Philosophy

- Prefer Test-Driven Development (TDD) for business logic, image processing paths, and round decisions
- Follow the test pyramid: many unit tests → fewer integration → minimal E2E
- Goal: 85-95% coverage on critical paths (pair detection, round logic, export, thumbnail generation)
- Fail fast: catch issues at the earliest layer possible
- Realistic test data: use real-world photo metadata, corrupt files, edge cases

## Development & Testing Workflow

1. Develop and test on Linux first
2. Run full test suite before committing
3. CI runs tests on Linux
4. Manual verification on Windows/macOS for releases

## Test Types & Tools

### 1. Unit Tests (Rust)

**Scope:** Isolated functions, pure logic, small modules

**Tool:** Built-in `cargo test`

**Targets:**
- Round decision logic & restoration rules
- Pair matching heuristics
- Stack detection (time-based grouping)
- Metadata parsers
- Path/slug generation

**Coverage goal:** 90%+ on business logic

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_stack_detection_groups_burst_photos() {
        let photos = vec![
            photo_with_time("2024-01-01 10:00:00"),
            photo_with_time("2024-01-01 10:00:01"),  // 1 sec gap
            photo_with_time("2024-01-01 10:00:02"),  // 1 sec gap
            photo_with_time("2024-01-01 10:05:00"),  // 5 min gap - new stack
        ];

        let stacks = detect_stacks(&photos, Duration::seconds(2));

        assert_eq!(stacks.len(), 2);
        assert_eq!(stacks[0].photos.len(), 3);
        assert_eq!(stacks[1].photos.len(), 1);
    }

    #[test]
    fn test_pair_detection_matches_same_basename() {
        let photos = vec![
            Photo { path: "IMG_001.ARW".into(), format: Format::Raw, .. },
            Photo { path: "IMG_001.JPG".into(), format: Format::Jpeg, .. },
            Photo { path: "IMG_002.ARW".into(), format: Format::Raw, .. },
        ];

        let pairs = detect_pairs(&photos);

        assert_eq!(pairs.len(), 1);
        assert_eq!(pairs[0].raw_path, "IMG_001.ARW");
        assert_eq!(pairs[0].jpeg_path, "IMG_001.JPG");
    }
}
```

### 2. Integration Tests (Rust)

**Scope:** Database operations, multi-module workflows, Tauri command handlers

**Tool:** `cargo test` with test fixtures

**Targets:**
- Full import → stack detection → save to DB cycle
- Round commit → query → restore cycle
- Export path resolution with pairs
- Thumbnail generation pipeline

```rust
#[test]
fn test_import_creates_stacks_and_pairs() {
    let db = create_test_db();  // in-memory SQLite
    let test_folder = setup_test_photos();  // temp directory with test images

    let result = import_folder(&db, test_folder.path());

    assert!(result.is_ok());
    let stats = result.unwrap();
    assert!(stats.photo_count > 0);
    assert!(stats.stack_count > 0);

    // Verify database state
    let photos = db.get_all_photos().unwrap();
    assert!(!photos.is_empty());
}
```

### 3. Frontend Tests (Optional)

**Scope:** Complex UI logic, state management

**Tool:** Vitest + @testing-library/svelte (if needed)

**Targets:**
- Keyboard navigation logic
- Grid selection state
- Filter/sort logic

Note: Keep frontend logic minimal. Most logic should be in Rust backend.

### 4. End-to-End Tests

**Scope:** Critical user journeys only

**Tool:** Playwright with Tauri driver or WebDriver

**Targets:**
- Create project → import folder → view grid → make decisions → export
- 3-5 key journeys maximum

```typescript
test('basic culling workflow', async ({ page }) => {
    // Create project
    await page.click('[data-testid="new-project"]');
    await page.fill('[data-testid="project-name"]', 'Test Project');
    await page.click('[data-testid="create"]');

    // Import photos
    await page.click('[data-testid="import"]');
    // ... select folder via file dialog mock

    // Verify grid shows photos
    await expect(page.locator('[data-testid="photo-card"]')).toHaveCount.greaterThan(0);

    // Make decisions with keyboard
    await page.keyboard.press('y');  // keep
    await page.keyboard.press('j');  // next
    await page.keyboard.press('n');  // eliminate

    // Export
    await page.click('[data-testid="export"]');
    // ... verify export completed
});
```

**Coverage:** 3-5 key journeys maximum. E2E tests are slow and brittle.

### 5. Performance Tests

**Scope:** Verify acceptable performance under realistic load

**Tool:** `cargo bench` with Criterion, custom timing in tests

**Targets:**
- Import 5000 photos: measure total time, memory peak
- Thumbnail generation: throughput (images/second)
- Grid scrolling with 1000+ thumbnails loaded
- Database query response times

**Guidelines:**
- Establish baseline metrics early, track regressions
- Run on consistent hardware (CI runner or dedicated machine)
- Test with realistic data sizes (not just 10 photos)
- Set acceptable thresholds (e.g., "import 1000 photos < 30 seconds")
- Performance tests run separately from unit tests (slower, optional in CI)

```rust
use criterion::{criterion_group, criterion_main, Criterion};

fn bench_thumbnail_generation(c: &mut Criterion) {
    let test_images = load_test_images();  // 100 real images

    c.bench_function("generate_thumbnails_100", |b| {
        b.iter(|| {
            generate_thumbnails_batch(&test_images, 400)
        })
    });
}

criterion_group!(benches, bench_thumbnail_generation);
criterion_main!(benches);
```

**Key metrics to track:**
- Import time per 1000 photos
- Thumbnail generation throughput
- Memory usage at peak load
- UI responsiveness (frame time) during scroll

### 6. Negative Tests (Error Handling & Edge Cases)

**Scope:** Verify graceful handling of invalid input, corruption, and edge cases

**Guidelines:**
- Every error path should have at least one test
- Test boundaries: empty input, maximum sizes, off-by-one
- Test corruption: truncated files, invalid headers, zero-byte files
- Test concurrency issues where applicable
- Verify error messages are user-friendly

**Categories:**

**File System Errors:**
- Folder doesn't exist
- No read permission
- Folder is empty
- Folder contains no supported images
- File deleted during import
- Disk full during thumbnail generation

**Image Errors:**
- Corrupt JPEG (truncated, invalid header)
- Corrupt RAW file
- Zero-byte file
- Unsupported format with supported extension
- Very large image (memory limits)
- Image with no EXIF data

**Database Errors:**
- Database locked
- Database corrupted
- Disk full during write

**User Input Errors:**
- Invalid project name (special characters)
- Duplicate project slug
- Export to non-writable directory

```rust
#[test]
fn test_import_handles_corrupt_jpeg_gracefully() {
    let db = create_test_db();
    let folder = setup_folder_with_corrupt_image();

    let result = import_folder(&db, folder.path());

    // Import succeeds, corrupt file is skipped with warning
    assert!(result.is_ok());
    let stats = result.unwrap();
    assert_eq!(stats.skipped_count, 1);
    assert!(stats.warnings.iter().any(|w| w.contains("corrupt")));
}

#[test]
fn test_import_empty_folder_returns_clear_error() {
    let db = create_test_db();
    let empty_folder = tempfile::tempdir().unwrap();

    let result = import_folder(&db, empty_folder.path());

    assert!(result.is_err());
    let error = result.unwrap_err();
    assert!(error.contains("No supported images found"));
}

#[test]
fn test_thumbnail_generation_skips_unreadable_files() {
    let photos = vec![
        valid_photo(),
        photo_with_no_read_permission(),
        valid_photo(),
    ];

    let results = generate_thumbnails(&photos);

    assert_eq!(results.success_count, 2);
    assert_eq!(results.failed_count, 1);
}
```

**Error behavior requirements:**
- Never crash on bad input
- Log detailed error for debugging
- Return user-friendly message
- Continue processing remaining items when possible (batch operations)
- Clean up partial state on failure

## Test Infrastructure

### Database
- Use in-memory SQLite (`:memory:`) for all Rust tests
- Fast, isolated, no cleanup needed
- Initialize schema from migration code

```rust
fn create_test_db() -> Database {
    let conn = Connection::open_in_memory().unwrap();
    run_migrations(&conn).unwrap();
    Database::new(conn)
}
```

### Test Data Helpers

```rust
// Factory functions for test data
fn test_photo(name: &str) -> Photo {
    Photo {
        id: 0,
        path: format!("/test/{name}"),
        format: Format::Jpeg,
        capture_time: Utc::now(),
        ..Default::default()
    }
}

fn test_raw_jpeg_pair(basename: &str) -> (Photo, Photo) {
    (
        test_photo(&format!("{basename}.ARW")).with_format(Format::Raw),
        test_photo(&format!("{basename}.JPG")).with_format(Format::Jpeg),
    )
}
```

### Test Images
- Keep a small set of real test images in `tests/fixtures/`
- Include: valid JPEG, valid RAW (ARW, CR2), corrupt JPEG, zero-byte file
- Do NOT commit large files; use small crops or synthetic images

### Mocking
- Mock file system with temp directories (`tempfile` crate)
- For image processing tests, use real small images when possible
- Mock external services if any (none currently)

## Execution & Automation

### Commands

```bash
# Run all Rust tests
cargo test

# Run specific test
cargo test test_stack_detection

# Run tests with output
cargo test -- --nocapture

# Run only negative/error tests
cargo test test_error
cargo test test_corrupt
cargo test test_invalid

# Run with coverage (requires cargo-tarpaulin)
cargo tarpaulin --out Html

# Run benchmarks (requires Criterion setup)
cargo bench

# Run specific benchmark
cargo bench --bench thumbnails

# Frontend tests (if any)
npm test

# E2E tests
npm run test:e2e
```

### Pre-commit Hooks
- `cargo fmt --check` - formatting
- `cargo clippy` - lints
- `cargo test` - unit tests on changed modules

### CI (GitHub Actions)
- Runs on push/PR
- Linux runner (Ubuntu latest)
- Full test suite: `cargo test`
- Clippy warnings as errors
- Coverage report upload (optional)

## Critical Test Focus Areas

**Functional:**
1. Stack detection - time-based grouping accuracy
2. Pair detection - RAW+JPEG matching
3. Round commit - immutability after commit
4. Restoration - correct status updates
5. Export - pair-aware, correct file copying
6. Crash resilience - decisions survive restart

**Negative/Edge Cases:**
7. Corrupt image handling - skip gracefully, don't crash
8. Empty/missing folders - clear error messages
9. Permission errors - handled without crash
10. Large files - memory limits respected

**Performance:**
11. Import 5000 photos - acceptable time and memory
12. Thumbnail batch generation - parallelism works
13. UI scroll - smooth with 1000+ items

## Test Quality Rules

- Fix flaky tests immediately
- Delete obsolete tests when code changes
- Keep test suite fast (<30 seconds for unit tests)
- Each test should test one thing
- Test names describe the scenario: `test_<what>_<condition>_<expected>`

## Coverage Targets

| Area | Target |
|------|--------|
| Business logic (rounds, stacks, decisions) | 90%+ |
| Import/export | 85%+ |
| Image processing | 80%+ |
| Database queries | 80%+ |
| Error paths (negative tests) | 80%+ |
| Frontend components | Optional |
| UI glue code | Ignore |

## Performance Baselines

### Reference Hardware

**Development Machine (baseline):**
- CPU: AMD Ryzen 5 5625U (6 cores / 12 threads, 4.4 GHz boost)
- RAM: 16 GB
- Storage: SSD (assumed)
- Performance Class: **Mid-range laptop (2022)**

### Target Metrics (TBD after implementation)

Targets will be established after initial implementation by measuring actual performance. The table below shows the format and expected order of magnitude:

| Operation | Target | Notes |
|-----------|--------|-------|
| Import 1000 photos (scan + DB) | TBD | Mostly I/O bound |
| Import 5000 photos (scan + DB) | TBD | Should scale ~linearly |
| Thumbnail generation (single, JPEG) | TBD | CPU bound |
| Thumbnail generation (single, RAW) | TBD | CPU bound, LibRaw decode |
| Thumbnail batch 100 images (parallel) | TBD | Should utilize all cores |
| Grid load 1000 cached thumbnails | TBD | I/O + render |
| Decision save (keep/eliminate) | TBD | Should be <100ms (feels instant) |
| Memory usage (1000 photos, grid view) | TBD | Thumbnails in memory |
| Memory peak (5000 photos imported) | TBD | Should stay < 2 GB |

### Scaling Guidelines

Performance scales with hardware. Use these factors to adjust expectations:

| Hardware Class | CPU Benchmark* | Scale Factor | Example |
|---------------|----------------|--------------|---------|
| Low-end laptop | <5000 | 2.0x slower | Intel i3, older AMD |
| **Mid-range laptop (reference)** | 5000-10000 | **1.0x** | Ryzen 5 5625U |
| High-end laptop | 10000-15000 | 0.7x faster | Ryzen 7, Intel i7 |
| Desktop workstation | 15000-25000 | 0.4x faster | Ryzen 9, Intel i9 |
| High-end workstation | >25000 | 0.3x faster | Threadripper, Xeon |

*Approximate multi-core Geekbench 5 score range

**Scaling rules:**
- I/O operations (import scan, thumbnail load): scale with SSD speed, less with CPU
- CPU operations (thumbnail generation, RAW decode): scale linearly with core count × clock speed
- Memory operations: scale with RAM speed, but usually not bottleneck
- Parallelizable operations: benefit from more cores (rayon will auto-scale)

### Minimum Acceptable Performance

Regardless of hardware, these UX thresholds must be met:

| Operation | Maximum Acceptable |
|-----------|-------------------|
| Photo navigation (j/k keys) | < 100 ms (feels instant) |
| Keep/eliminate decision | < 200 ms (feels instant) |
| Thumbnail display (cached) | < 500 ms |
| UI response to any action | < 1 second |

If these are not met on reference hardware, it's a bug.
