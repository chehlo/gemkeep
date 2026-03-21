/// Test fixture library: manifest-driven test utilities.
///
/// Loads `tests/fixtures/raw-samples/manifest.json` and provides:
/// - Typed manifest structs (Manifest, Fixture, Expected)
/// - `for_each_fixture(layer, f)` — iterate fixtures matching a test layer
/// - `assert_exif_matches(actual, expected)` — field-by-field ExifData comparison
/// - `create_test_project(ids)` — temp project with specific fixtures
/// - `create_random_test_project(n, seed)` — temp project with N random fixtures
use crate::db::run_migrations;
use crate::import::exif::ExifData;
use crate::photos::repository;
use rusqlite::Connection;
use serde::Deserialize;
use std::path::{Path, PathBuf};
use tempfile::TempDir;

// ---------------------------------------------------------------------------
// Manifest types
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct Manifest {
    #[serde(rename = "$schema_version")]
    pub schema_version: u32,
    pub ground_truth_tool: String,
    pub fixtures: Vec<Fixture>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Fixture {
    pub id: String,
    pub file: Option<String>,
    pub category: String,
    pub source: String,
    #[serde(default)]
    pub gitignored: bool,
    pub dimensions_covered: Vec<String>,
    pub test_layers: Vec<String>,
    pub expected: Expected,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Expected {
    pub make: Option<String>,
    pub camera_model: Option<String>,
    pub orientation: Option<u16>,
    pub capture_time: Option<String>,
    #[serde(default)]
    pub capture_time_present: bool,
    pub aperture: Option<f64>,
    pub iso: Option<u32>,
    pub focal_length: Option<f64>,
    pub shutter_speed: Option<String>,
    pub exposure_comp: Option<f64>,
    pub lens: Option<String>,
    pub image_width: Option<u32>,
    pub image_height: Option<u32>,
    pub thumbnail_expected_width: Option<u32>,
    pub thumbnail_expected_height: Option<u32>,
    pub display_orientation: Option<String>,
    #[serde(default)]
    pub file_valid: bool,
    #[serde(default)]
    pub exif_parseable: bool,
}

// ---------------------------------------------------------------------------
// Manifest loading
// ---------------------------------------------------------------------------

/// Path to the fixtures directory (tests/fixtures/raw-samples/).
fn fixtures_dir() -> PathBuf {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    manifest_dir
        .parent()
        .unwrap()
        .join("tests")
        .join("fixtures")
        .join("raw-samples")
}

/// Load and parse the manifest.
pub fn load_manifest() -> Manifest {
    let path = fixtures_dir().join("manifest.json");
    let content = std::fs::read_to_string(&path)
        .unwrap_or_else(|e| panic!("Cannot read manifest at {}: {}", path.display(), e));
    serde_json::from_str(&content)
        .unwrap_or_else(|e| panic!("Cannot parse manifest at {}: {}", path.display(), e))
}

/// Resolve absolute path to a fixture file. Returns None if the file field is
/// None (timing-only fixtures) or the file doesn't exist on disk (gitignored
/// RAW not yet downloaded).
pub fn resolve_fixture_path(fixture: &Fixture) -> Option<PathBuf> {
    let filename = fixture.file.as_ref()?;
    let path = fixtures_dir().join(filename);
    if path.exists() {
        Some(path)
    } else {
        None
    }
}

// ---------------------------------------------------------------------------
// Fixture iteration
// ---------------------------------------------------------------------------

/// Iterate all fixtures that belong to a given test layer, calling `f` for
/// each one that has a file present on disk. Skips timing-only and missing
/// fixtures with a log message.
pub fn for_each_fixture<F>(layer: &str, mut f: F)
where
    F: FnMut(&Fixture, &Path),
{
    let manifest = load_manifest();
    let mut tested = 0;
    let mut skipped = 0;

    for fixture in &manifest.fixtures {
        if !fixture.test_layers.contains(&layer.to_string()) {
            continue;
        }
        match resolve_fixture_path(fixture) {
            Some(path) => {
                f(fixture, &path);
                tested += 1;
            }
            None => {
                let name = fixture.file.as_deref().unwrap_or(&fixture.id);
                eprintln!(
                    "SKIP: {} ({})",
                    name,
                    if fixture.file.is_none() {
                        "timing-only"
                    } else {
                        "file not found — run setup-fixtures.sh"
                    }
                );
                skipped += 1;
            }
        }
    }
    eprintln!(
        "for_each_fixture(\"{}\"): tested={}, skipped={}",
        layer, tested, skipped
    );
}

// ---------------------------------------------------------------------------
// Assertion helpers
// ---------------------------------------------------------------------------

/// Field-by-field comparison of ExifData against manifest Expected values.
/// Collects all mismatches and panics with a detailed report.
pub fn assert_exif_matches(fixture_id: &str, actual: &ExifData, expected: &Expected) {
    let mut mismatches: Vec<String> = Vec::new();

    // camera_model (case-insensitive: rawler may normalize make case differently from exiftool)
    match (
        actual.camera_model.as_deref(),
        expected.camera_model.as_deref(),
    ) {
        (Some(a), Some(e)) if !a.eq_ignore_ascii_case(e) => {
            mismatches.push(format!(
                "camera_model: actual={:?}, expected={:?}",
                actual.camera_model, expected.camera_model
            ));
        }
        (None, Some(_)) | (Some(_), None) => {
            mismatches.push(format!(
                "camera_model: actual={:?}, expected={:?}",
                actual.camera_model, expected.camera_model
            ));
        }
        _ => {}
    }

    // lens (fuzzy: rawler may differ from exiftool in spacing and manufacturer prefix,
    // e.g. "EF 70-200mm" vs "EF70-200mm", "35mm F1.4 DG HSM" vs "Sigma 35mm F1.4 DG HSM")
    {
        let normalize_lens = |s: &str| s.replace(' ', "").to_lowercase();
        let lens_match = |a: &str, e: &str| {
            let na = normalize_lens(a);
            let ne = normalize_lens(e);
            na == ne || ne.contains(&na) || na.contains(&ne)
        };
        match (actual.lens.as_deref(), expected.lens.as_deref()) {
            (Some(a), Some(e)) if !lens_match(a, e) => {
                mismatches.push(format!(
                    "lens: actual={:?}, expected={:?}",
                    actual.lens, expected.lens
                ));
            }
            (None, Some(e)) => {
                // rawler has less lens coverage than exiftool's database — log, don't fail
                eprintln!(
                    "  INFO [{}]: lens not extracted by rawler (exiftool has {:?})",
                    fixture_id, e
                );
            }
            (Some(_), None) => {
                mismatches.push(format!("lens: actual={:?}, expected=None", actual.lens));
            }
            _ => {}
        }
    }

    // orientation
    if actual.orientation != expected.orientation {
        mismatches.push(format!(
            "orientation: actual={:?}, expected={:?}",
            actual.orientation, expected.orientation
        ));
    }

    // capture_time presence
    if actual.capture_time.is_some() != expected.capture_time_present {
        mismatches.push(format!(
            "capture_time_present: actual={}, expected={}",
            actual.capture_time.is_some(),
            expected.capture_time_present
        ));
    }

    // aperture (f64 comparison with tolerance)
    match (actual.aperture, expected.aperture) {
        (Some(a), Some(e)) if (a - e).abs() > 0.01 => {
            mismatches.push(format!("aperture: actual={}, expected={}", a, e));
        }
        (None, Some(e)) => {
            mismatches.push(format!("aperture: actual=None, expected={}", e));
        }
        (Some(a), None) => {
            mismatches.push(format!("aperture: actual={}, expected=None", a));
        }
        _ => {}
    }

    // iso
    if actual.iso != expected.iso {
        mismatches.push(format!(
            "iso: actual={:?}, expected={:?}",
            actual.iso, expected.iso
        ));
    }

    // focal_length (f64 tolerance)
    match (actual.focal_length, expected.focal_length) {
        (Some(a), Some(e)) if (a - e).abs() > 0.01 => {
            mismatches.push(format!("focal_length: actual={}, expected={}", a, e));
        }
        (None, Some(e)) => {
            mismatches.push(format!("focal_length: actual=None, expected={}", e));
        }
        (Some(a), None) => {
            mismatches.push(format!("focal_length: actual={}, expected=None", a));
        }
        _ => {}
    }

    // shutter_speed (string comparison)
    if actual.shutter_speed.as_deref() != expected.shutter_speed.as_deref() {
        mismatches.push(format!(
            "shutter_speed: actual={:?}, expected={:?}",
            actual.shutter_speed, expected.shutter_speed
        ));
    }

    // exposure_comp (f64 tolerance)
    match (actual.exposure_comp, expected.exposure_comp) {
        (Some(a), Some(e)) if (a - e).abs() > 0.01 => {
            mismatches.push(format!("exposure_comp: actual={}, expected={}", a, e));
        }
        (None, Some(e)) => {
            mismatches.push(format!("exposure_comp: actual=None, expected={}", e));
        }
        (Some(a), None) => {
            mismatches.push(format!("exposure_comp: actual={}, expected=None", a));
        }
        _ => {}
    }

    if !mismatches.is_empty() {
        panic!(
            "EXIF mismatch for fixture '{}' ({} fields):\n  {}",
            fixture_id,
            mismatches.len(),
            mismatches.join("\n  ")
        );
    }
}

// ---------------------------------------------------------------------------
// Test project creation
// ---------------------------------------------------------------------------

/// A temporary test project with fixtures copied in and DB initialized.
pub struct TestProject {
    pub dir: TempDir,
    pub conn: Connection,
    pub project_id: i64,
    pub slug: String,
    /// Which fixture IDs were copied into this project.
    pub fixture_ids: Vec<String>,
    /// Photos created by TestLibraryBuilder (empty for legacy create_test_project).
    photos: Vec<TestPhoto>,
    /// Stack IDs created by build_db_only() (empty for file-based builds).
    pub stack_ids: Vec<i64>,
    /// Logical photo IDs created by build_db_only() (empty for file-based builds).
    pub lp_ids: Vec<i64>,
    /// Per-stack logical photo IDs: Vec<(stack_id, Vec<lp_id>)>.
    pub stacks_with_lps: Vec<(i64, Vec<i64>)>,
}

impl TestProject {
    /// Path to the source folder inside the temp dir.
    pub fn source_dir(&self) -> PathBuf {
        self.dir.path().join("photos")
    }

    /// Path to the thumbnails cache dir.
    pub fn cache_dir(&self) -> PathBuf {
        self.dir.path().join("cache").join("thumbnails")
    }

    /// Returns the first stack ID (convenience for single-stack tests).
    pub fn stack_id(&self) -> i64 {
        self.stack_ids[0]
    }

    /// Returns all logical photo IDs created by build_db_only().
    pub fn lp_ids(&self) -> &[i64] {
        &self.lp_ids
    }
}

/// Create a test project with specific fixture files copied in.
/// Paired fixtures (same base name) are always copied together.
pub fn create_test_project(fixture_ids: &[&str]) -> TestProject {
    let manifest = load_manifest();

    // Collect requested fixtures
    let fixtures: Vec<&Fixture> = fixture_ids
        .iter()
        .map(|id| {
            manifest
                .fixtures
                .iter()
                .find(|f| f.id == *id)
                .unwrap_or_else(|| panic!("Fixture '{}' not found in manifest", id))
        })
        .collect();

    build_test_project(&fixtures)
}

/// Create a test project with N randomly selected fixtures (reproducible via seed).
/// Ensures at least one from each category that has files on disk.
pub fn create_random_test_project(n: usize, seed: u64) -> TestProject {
    let manifest = load_manifest();

    // Simple seeded PRNG (xorshift64)
    let mut rng_state = seed;
    let mut next_u64 = || -> u64 {
        rng_state ^= rng_state << 13;
        rng_state ^= rng_state >> 7;
        rng_state ^= rng_state << 17;
        rng_state
    };

    // Only fixtures with files on disk
    let available: Vec<&Fixture> = manifest
        .fixtures
        .iter()
        .filter(|f| resolve_fixture_path(f).is_some())
        .collect();

    if available.is_empty() {
        panic!("No fixture files found on disk — run setup-fixtures.sh");
    }

    let count = n.min(available.len());

    // Shuffle via Fisher-Yates
    let mut indices: Vec<usize> = (0..available.len()).collect();
    for i in (1..indices.len()).rev() {
        let j = (next_u64() as usize) % (i + 1);
        indices.swap(i, j);
    }

    let selected: Vec<&Fixture> = indices[..count].iter().map(|&i| available[i]).collect();

    eprintln!(
        "create_random_test_project(n={}, seed={}): selected {} fixtures: [{}]",
        n,
        seed,
        selected.len(),
        selected
            .iter()
            .map(|f| f.id.as_str())
            .collect::<Vec<_>>()
            .join(", ")
    );

    build_test_project(&selected)
}

fn build_test_project(fixtures: &[&Fixture]) -> TestProject {
    let tmp = TempDir::new().expect("cannot create temp dir");
    let source_dir = tmp.path().join("photos");
    let cache_dir = tmp.path().join("cache").join("thumbnails");
    std::fs::create_dir_all(&source_dir).unwrap();
    std::fs::create_dir_all(&cache_dir).unwrap();

    let mut fixture_ids = Vec::new();

    for fixture in fixtures {
        if let Some(src_path) = resolve_fixture_path(fixture) {
            let filename = fixture.file.as_ref().unwrap();
            let dest = source_dir.join(filename);
            std::fs::copy(&src_path, &dest).unwrap_or_else(|e| {
                panic!(
                    "Cannot copy fixture {} to {}: {}",
                    src_path.display(),
                    dest.display(),
                    e
                )
            });
            fixture_ids.push(fixture.id.clone());
        }
    }

    // Also copy paired files that share a base name with any selected fixture
    let manifest = load_manifest();
    let selected_bases: Vec<String> = fixtures
        .iter()
        .filter_map(|f| f.file.as_ref())
        .map(|name| {
            Path::new(name)
                .file_stem()
                .unwrap()
                .to_string_lossy()
                .to_string()
        })
        .collect();

    for other in &manifest.fixtures {
        if fixture_ids.contains(&other.id) {
            continue;
        }
        if let Some(ref name) = other.file {
            let base = Path::new(name)
                .file_stem()
                .unwrap()
                .to_string_lossy()
                .to_string();
            if selected_bases.contains(&base) {
                if let Some(src_path) = resolve_fixture_path(other) {
                    let dest = source_dir.join(name);
                    if !dest.exists() {
                        std::fs::copy(&src_path, &dest).ok();
                        fixture_ids.push(other.id.clone());
                    }
                }
            }
        }
    }

    // Initialize DB
    let conn = Connection::open_in_memory().unwrap();
    run_migrations(&conn).unwrap();
    conn.execute(
        "INSERT INTO projects (name, slug, created_at) VALUES ('Test', 'test', '2024-01-01T00:00:00Z')",
        [],
    )
    .unwrap();
    let project_id = conn.last_insert_rowid();

    // Register source folder
    repository::add_source_folder(&conn, project_id, source_dir.to_str().unwrap()).unwrap();

    TestProject {
        dir: tmp,
        conn,
        project_id,
        slug: "test".to_string(),
        fixture_ids,
        photos: Vec::new(),
        stack_ids: Vec::new(),
        lp_ids: Vec::new(),
        stacks_with_lps: Vec::new(),
    }
}

// ---------------------------------------------------------------------------
// Builder API types (stubs — not yet implemented)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Camera {
    Canon,
    Sony,
    Nikon,
    Fuji,
    Panasonic,
    Synthetic,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FileType {
    Jpeg,
    Raw,
    Both,
}

#[derive(Debug, Clone, Default)]
pub struct CameraParams {
    pub aperture: Option<f64>,
    pub shutter_speed: Option<String>,
    pub iso: Option<u32>,
    pub focal_length: Option<f64>,
    pub exposure_comp: Option<f64>,
    pub lens: Option<String>,
}

#[derive(Debug, Clone)]
pub struct PhotoSpec {
    pub camera: Camera,
    pub orientation: u16,
    pub file_type: FileType,
    pub capture_time: Option<String>,
    pub camera_params: Option<CameraParams>,
}

#[derive(Debug)]
pub struct TestPhoto {
    pub path: PathBuf,
    pub spec: PhotoSpec,
    pub expected: Expected,
}

pub struct TestLibraryBuilder {
    specs: Vec<PhotoSpec>,
    layout: Option<Vec<usize>>,
    burst_gap_secs: Option<u64>,
    project_name: Option<String>,
}

impl Camera {
    /// Returns (Make, Model) pair for this camera brand.
    fn make_model(&self) -> (&'static str, &'static str) {
        match self {
            Camera::Canon => ("Canon", "Canon TestBuilder"),
            Camera::Sony => ("SONY", "SONY TestBuilder"),
            Camera::Nikon => ("NIKON CORPORATION", "NIKON TestBuilder"),
            Camera::Fuji => ("FUJIFILM", "FUJIFILM TestBuilder"),
            Camera::Panasonic => ("Panasonic", "Panasonic TestBuilder"),
            Camera::Synthetic => ("SyntheticCam", "SyntheticCam TestBuilder"),
        }
    }

    /// Returns the RAW file extension for this camera brand.
    fn raw_extension(&self) -> &'static str {
        match self {
            Camera::Canon => "cr2",
            Camera::Sony => "arw",
            Camera::Nikon => "nef",
            Camera::Fuji => "raf",
            Camera::Panasonic => "rw2",
            Camera::Synthetic => "jpg", // Synthetic has no RAW
        }
    }

    /// Returns the fixture ID for the real RAW file in the manifest.
    fn raw_fixture_id(&self) -> Option<&'static str> {
        match self {
            Camera::Canon => Some("r1"),
            Camera::Sony => Some("r2"),
            Camera::Nikon => Some("r3"),
            Camera::Fuji => Some("r4"),
            Camera::Panasonic => Some("r5"),
            Camera::Synthetic => None,
        }
    }
}

impl TestLibraryBuilder {
    pub fn new() -> Self {
        Self {
            specs: Vec::new(),
            layout: None,
            burst_gap_secs: None,
            project_name: None,
        }
    }

    /// Set a custom project name and slug (default: "test-builder").
    pub fn with_project_name(mut self, name: &str) -> Self {
        self.project_name = Some(name.to_string());
        self
    }

    /// Set the gap in seconds between stacks when auto-generating timestamps.
    /// Default (None) uses 60 seconds.
    pub fn with_burst_gap(mut self, secs: u64) -> Self {
        self.burst_gap_secs = Some(secs);
        self
    }

    /// Set stack layout and auto-generate synthetic PhotoSpecs for each slot.
    /// E.g. `with_stack_layout(&[3, 2])` creates 5 photos across 2 stacks.
    pub fn with_stack_layout(mut self, layout: &[usize]) -> Self {
        self.layout = Some(layout.to_vec());
        // Auto-generate PhotoSpecs for each slot
        for &count in layout {
            for _ in 0..count {
                self.specs.push(PhotoSpec {
                    camera: Camera::Synthetic,
                    orientation: 1,
                    file_type: FileType::Jpeg,
                    capture_time: None,
                    camera_params: None,
                });
            }
        }
        self
    }

    /// Set stack layout without generating specs (use with manually added photos).
    /// E.g. add 5 photos then `with_layout(&[3, 2])` to partition them.
    pub fn with_layout(mut self, layout: &[usize]) -> Self {
        self.layout = Some(layout.to_vec());
        self
    }

    pub fn add_photo(mut self, spec: PhotoSpec) -> Self {
        self.specs.push(spec);
        self
    }

    /// Build a test project with DB rows only (no files on disk).
    /// Creates project, stacks, logical_photos, and photos rows with synthetic paths.
    /// Returns TestProject with populated stack_ids and lp_ids.
    pub fn build_db_only(mut self) -> TestProject {
        use rusqlite::params;

        // Auto-generate capture_times for specs that don't have one, using layout info
        if let Some(ref layout) = self.layout {
            let burst_gap = self.burst_gap_secs.unwrap_or(60);
            let base =
                chrono::NaiveDateTime::parse_from_str(DEFAULT_CAPTURE_TIME, "%Y:%m:%d %H:%M:%S")
                    .unwrap();
            let mut current_time = base;
            let mut spec_idx = 0;
            for (stack_i, &count) in layout.iter().enumerate() {
                if stack_i > 0 {
                    // Add burst gap between stacks
                    current_time += chrono::Duration::seconds(burst_gap as i64);
                }
                for photo_j in 0..count {
                    if photo_j > 0 {
                        // 1 second between photos within a stack
                        current_time += chrono::Duration::seconds(1);
                    }
                    if self.specs[spec_idx].capture_time.is_none() {
                        self.specs[spec_idx].capture_time =
                            Some(current_time.format("%Y:%m:%d %H:%M:%S").to_string());
                    }
                    spec_idx += 1;
                }
            }
        }

        let tmp = TempDir::new().expect("cannot create temp dir");

        // Create in-memory DB with migrations
        let conn = Connection::open_in_memory().unwrap();
        run_migrations(&conn).unwrap();

        // INSERT project
        let slug = self.project_name.as_deref().unwrap_or("test-builder");
        conn.execute(
            "INSERT INTO projects (name, slug, created_at) VALUES (?1, ?2, '2024-01-01T00:00:00Z')",
            rusqlite::params![slug, slug],
        )
        .unwrap();
        let project_id = conn.last_insert_rowid();

        let now = chrono::Utc::now().to_rfc3339();

        // Determine stack groupings: either from layout or single stack with all specs
        let spec_groups: Vec<&[PhotoSpec]> = if let Some(ref layout) = self.layout {
            let total: usize = layout.iter().sum();
            assert_eq!(
                total,
                self.specs.len(),
                "layout sum ({}) != specs count ({})",
                total,
                self.specs.len()
            );
            let mut groups = Vec::new();
            let mut offset = 0;
            for &count in layout {
                groups.push(&self.specs[offset..offset + count]);
                offset += count;
            }
            groups
        } else {
            vec![&self.specs[..]]
        };

        let mut stacks_with_lps: Vec<(i64, Vec<i64>)> = Vec::new();
        let mut file_counter: usize = 0;

        for group in &spec_groups {
            // INSERT stack
            conn.execute(
                "INSERT INTO stacks (project_id, created_at) VALUES (?1, ?2)",
                params![project_id, now],
            )
            .unwrap();
            let stack_id = conn.last_insert_rowid();
            let mut group_lp_ids = Vec::new();

            for spec in *group {
                let capture_time = spec.capture_time.as_deref().unwrap_or(DEFAULT_CAPTURE_TIME);
                let (_make, model) = spec.camera.make_model();
                let camera_model = build_camera_model(_make, model);
                let camera_model_ref = if camera_model.is_empty() {
                    None
                } else {
                    Some(camera_model.as_str())
                };
                let cp = spec.camera_params.as_ref();

                match spec.file_type {
                    FileType::Jpeg => {
                        file_counter += 1;
                        let path = format!("/test/builder_{:04}.jpg", file_counter);
                        let photo_id = repository::insert_photo(
                            &conn,
                            &path,
                            "jpeg",
                            Some(capture_time),
                            Some(spec.orientation),
                            camera_model_ref,
                            cp.and_then(|p| p.lens.as_deref()),
                            cp.and_then(|p| p.aperture),
                            cp.and_then(|p| p.shutter_speed.as_deref()),
                            cp.and_then(|p| p.iso),
                            cp.and_then(|p| p.focal_length),
                            cp.and_then(|p| p.exposure_comp),
                        )
                        .unwrap();

                        conn.execute(
                            "INSERT INTO logical_photos (project_id, representative_photo_id, stack_id) VALUES (?1, ?2, ?3)",
                            params![project_id, photo_id, stack_id],
                        )
                        .unwrap();
                        let lp_id = conn.last_insert_rowid();

                        conn.execute(
                            "UPDATE photos SET logical_photo_id = ?1 WHERE id = ?2",
                            params![lp_id, photo_id],
                        )
                        .unwrap();

                        group_lp_ids.push(lp_id);
                    }
                    FileType::Raw => {
                        file_counter += 1;
                        let ext = spec.camera.raw_extension();
                        let path = format!("/test/builder_{:04}.{}", file_counter, ext);
                        let photo_id = repository::insert_photo(
                            &conn,
                            &path,
                            "raw",
                            Some(capture_time),
                            Some(spec.orientation),
                            camera_model_ref,
                            cp.and_then(|p| p.lens.as_deref()),
                            cp.and_then(|p| p.aperture),
                            cp.and_then(|p| p.shutter_speed.as_deref()),
                            cp.and_then(|p| p.iso),
                            cp.and_then(|p| p.focal_length),
                            cp.and_then(|p| p.exposure_comp),
                        )
                        .unwrap();

                        conn.execute(
                            "INSERT INTO logical_photos (project_id, representative_photo_id, stack_id) VALUES (?1, ?2, ?3)",
                            params![project_id, photo_id, stack_id],
                        )
                        .unwrap();
                        let lp_id = conn.last_insert_rowid();

                        conn.execute(
                            "UPDATE photos SET logical_photo_id = ?1 WHERE id = ?2",
                            params![lp_id, photo_id],
                        )
                        .unwrap();

                        group_lp_ids.push(lp_id);
                    }
                    FileType::Both => {
                        file_counter += 1;
                        // JPEG photo
                        let jpeg_path = format!("/test/builder_{:04}.jpg", file_counter);
                        let jpeg_photo_id = repository::insert_photo(
                            &conn,
                            &jpeg_path,
                            "jpeg",
                            Some(capture_time),
                            Some(spec.orientation),
                            camera_model_ref,
                            cp.and_then(|p| p.lens.as_deref()),
                            cp.and_then(|p| p.aperture),
                            cp.and_then(|p| p.shutter_speed.as_deref()),
                            cp.and_then(|p| p.iso),
                            cp.and_then(|p| p.focal_length),
                            cp.and_then(|p| p.exposure_comp),
                        )
                        .unwrap();

                        // RAW photo
                        let ext = spec.camera.raw_extension();
                        let raw_path = format!("/test/builder_{:04}.{}", file_counter, ext);
                        let raw_photo_id = repository::insert_photo(
                            &conn,
                            &raw_path,
                            "raw",
                            Some(capture_time),
                            Some(spec.orientation),
                            camera_model_ref,
                            cp.and_then(|p| p.lens.as_deref()),
                            cp.and_then(|p| p.aperture),
                            cp.and_then(|p| p.shutter_speed.as_deref()),
                            cp.and_then(|p| p.iso),
                            cp.and_then(|p| p.focal_length),
                            cp.and_then(|p| p.exposure_comp),
                        )
                        .unwrap();

                        // Logical photo with representative = jpeg
                        conn.execute(
                            "INSERT INTO logical_photos (project_id, representative_photo_id, stack_id) VALUES (?1, ?2, ?3)",
                            params![project_id, jpeg_photo_id, stack_id],
                        )
                        .unwrap();
                        let lp_id = conn.last_insert_rowid();

                        // Back-patch both photos
                        conn.execute(
                            "UPDATE photos SET logical_photo_id = ?1 WHERE id = ?2",
                            params![lp_id, jpeg_photo_id],
                        )
                        .unwrap();
                        conn.execute(
                            "UPDATE photos SET logical_photo_id = ?1 WHERE id = ?2",
                            params![lp_id, raw_photo_id],
                        )
                        .unwrap();

                        group_lp_ids.push(lp_id);
                    }
                }
            }

            stacks_with_lps.push((stack_id, group_lp_ids));
        }

        // Derive flat stack_ids and lp_ids from stacks_with_lps
        let stack_ids: Vec<i64> = stacks_with_lps.iter().map(|(sid, _)| *sid).collect();
        let lp_ids: Vec<i64> = stacks_with_lps
            .iter()
            .flat_map(|(_, lps)| lps.iter().copied())
            .collect();

        TestProject {
            dir: tmp,
            conn,
            project_id,
            slug: slug.to_string(),
            fixture_ids: Vec::new(),
            photos: Vec::new(),
            stack_ids,
            lp_ids,
            stacks_with_lps,
        }
    }

    pub fn build(self) -> TestProject {
        let tmp = TempDir::new().expect("cannot create temp dir");
        let source_dir = tmp.path().join("photos");
        let cache_dir = tmp.path().join("cache").join("thumbnails");
        std::fs::create_dir_all(&source_dir).unwrap();
        std::fs::create_dir_all(&cache_dir).unwrap();

        let manifest = load_manifest();
        let mut photos = Vec::new();
        let mut file_counter: usize = 0;

        for spec in &self.specs {
            match spec.file_type {
                FileType::Jpeg => {
                    file_counter += 1;
                    let photo = create_jpeg_photo(&source_dir, spec, file_counter);
                    photos.push(photo);
                }
                FileType::Raw => {
                    file_counter += 1;
                    let photo = create_raw_photo(&source_dir, spec, file_counter, &manifest);
                    photos.push(photo);
                }
                FileType::Both => {
                    file_counter += 1;
                    let jpeg = create_jpeg_photo(&source_dir, spec, file_counter);
                    let raw = create_raw_photo(&source_dir, spec, file_counter, &manifest);
                    photos.push(jpeg);
                    photos.push(raw);
                }
            }
        }

        // Initialize DB
        let conn = Connection::open_in_memory().unwrap();
        run_migrations(&conn).unwrap();
        let slug = self.project_name.as_deref().unwrap_or("test-builder");
        conn.execute(
            "INSERT INTO projects (name, slug, created_at) VALUES (?1, ?2, '2024-01-01T00:00:00Z')",
            rusqlite::params![slug, slug],
        )
        .unwrap();
        let project_id = conn.last_insert_rowid();
        repository::add_source_folder(&conn, project_id, source_dir.to_str().unwrap()).unwrap();

        TestProject {
            dir: tmp,
            conn,
            project_id,
            slug: slug.to_string(),
            fixture_ids: Vec::new(),
            photos,
            stack_ids: Vec::new(),
            lp_ids: Vec::new(),
            stacks_with_lps: Vec::new(),
        }
    }
}

/// Delegate to the canonical format_camera_model in exif.rs.
fn build_camera_model(make: &str, model: &str) -> String {
    crate::import::exif::format_camera_model(make, model).unwrap_or_default()
}

const DEFAULT_CAPTURE_TIME: &str = "2024:06:15 12:00:00";

/// Create a JPEG file with EXIF metadata matching the spec.
fn create_jpeg_photo(source_dir: &Path, spec: &PhotoSpec, counter: usize) -> TestPhoto {
    let (make, model) = spec.camera.make_model();
    let filename = format!("builder_{:04}.jpg", counter);
    let path = source_dir.join(&filename);

    let capture_time = spec.capture_time.as_deref().unwrap_or(DEFAULT_CAPTURE_TIME);

    // Create a tiny JPEG with EXIF
    let jpeg_bytes = build_jpeg_with_exif(make, model, spec.orientation, capture_time);
    std::fs::write(&path, jpeg_bytes).unwrap();

    let camera_model = build_camera_model(make, model);

    TestPhoto {
        path,
        spec: spec.clone(),
        expected: Expected {
            make: Some(make.to_string()),
            camera_model: Some(camera_model),
            orientation: Some(spec.orientation),
            capture_time: Some(capture_time.to_string()),
            capture_time_present: true,
            aperture: None,
            iso: None,
            focal_length: None,
            shutter_speed: None,
            exposure_comp: None,
            lens: None,
            image_width: Some(4),
            image_height: Some(4),
            thumbnail_expected_width: None,
            thumbnail_expected_height: None,
            display_orientation: None,
            file_valid: true,
            exif_parseable: true,
        },
    }
}

/// Patch the EXIF orientation tag in a RAW file using rexiv2 (libexiv2).
/// Falls back to direct TIFF IFD patching for RAF (Fuji) which libexiv2 cannot write.
fn patch_raw_orientation(path: &Path, orientation: u16) {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .map(|s| s.to_lowercase())
        .unwrap_or_default();

    if ext == "raf" || ext == "rw2" {
        patch_raw_orientation_tiff(path, orientation);
        return;
    }

    let meta = rexiv2::Metadata::new_from_path(path)
        .unwrap_or_else(|e| panic!("patch_raw_orientation: cannot open {:?}: {}", path, e));
    let orient = match orientation {
        1 => rexiv2::Orientation::Normal,
        2 => rexiv2::Orientation::HorizontalFlip,
        3 => rexiv2::Orientation::Rotate180,
        4 => rexiv2::Orientation::VerticalFlip,
        5 => rexiv2::Orientation::Rotate90HorizontalFlip,
        6 => rexiv2::Orientation::Rotate90,
        7 => rexiv2::Orientation::Rotate90VerticalFlip,
        8 => rexiv2::Orientation::Rotate270,
        _ => panic!("patch_raw_orientation: invalid orientation {}", orientation),
    };
    meta.set_orientation(orient);
    meta.save_to_file(path)
        .unwrap_or_else(|e| panic!("patch_raw_orientation: cannot save {:?}: {}", path, e));
}

/// Patch the EXIF DateTimeOriginal tag in a RAW file using rexiv2 (libexiv2).
/// Only works for formats rexiv2 can write (ARW, CR2, NEF).
/// RAF and RW2 are skipped (rexiv2 cannot write them).
fn patch_raw_capture_time(path: &Path, capture_time: &str) {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .map(|s| s.to_lowercase())
        .unwrap_or_default();

    // rexiv2 cannot write RAF or RW2 — skip silently
    if ext == "raf" || ext == "rw2" {
        return;
    }

    let meta = rexiv2::Metadata::new_from_path(path)
        .unwrap_or_else(|e| panic!("patch_raw_capture_time: cannot open {:?}: {}", path, e));
    meta.set_tag_string("Exif.Photo.DateTimeOriginal", capture_time)
        .unwrap_or_else(|e| {
            panic!(
                "patch_raw_capture_time: cannot set DateTimeOriginal on {:?}: {}",
                path, e
            )
        });
    meta.save_to_file(path)
        .unwrap_or_else(|e| panic!("patch_raw_capture_time: cannot save {:?}: {}", path, e));
}

/// Direct TIFF IFD0 orientation patch for formats libexiv2 cannot write (RAF).
/// Finds the TIFF header, walks IFD0 entries, and overwrites tag 0x0112.
fn patch_raw_orientation_tiff(path: &Path, orientation: u16) {
    let mut data = std::fs::read(path)
        .unwrap_or_else(|e| panic!("patch_raw_orientation_tiff: cannot read {:?}: {}", path, e));

    // Find TIFF header: standard (II 0x2a) or Panasonic RW2 (II 0x55)
    let tiff_offset = data
        .windows(4)
        .position(|w| w == b"II\x2a\x00" || w == b"MM\x00\x2a" || w == b"II\x55\x00")
        .unwrap_or_else(|| panic!("patch_raw_orientation_tiff: no TIFF header in {:?}", path));

    let is_le = &data[tiff_offset..tiff_offset + 2] == b"II";
    let read_u16 = |d: &[u8], off: usize| -> u16 {
        if is_le {
            u16::from_le_bytes([d[off], d[off + 1]])
        } else {
            u16::from_be_bytes([d[off], d[off + 1]])
        }
    };
    let read_u32 = |d: &[u8], off: usize| -> u32 {
        if is_le {
            u32::from_le_bytes([d[off], d[off + 1], d[off + 2], d[off + 3]])
        } else {
            u32::from_be_bytes([d[off], d[off + 1], d[off + 2], d[off + 3]])
        }
    };

    let ifd0_offset = read_u32(&data, tiff_offset + 4) as usize + tiff_offset;
    let entry_count = read_u16(&data, ifd0_offset) as usize;

    for i in 0..entry_count {
        let entry_offset = ifd0_offset + 2 + i * 12;
        let tag = read_u16(&data, entry_offset);
        if tag == 0x0112 {
            let value_offset = entry_offset + 8;
            let bytes = if is_le {
                orientation.to_le_bytes()
            } else {
                orientation.to_be_bytes()
            };
            data[value_offset] = bytes[0];
            data[value_offset + 1] = bytes[1];
            std::fs::write(path, &data).unwrap_or_else(|e| {
                panic!("patch_raw_orientation_tiff: cannot write {:?}: {}", path, e)
            });
            return;
        }
    }

    panic!(
        "patch_raw_orientation_tiff: orientation tag not found in IFD0 of {:?}",
        path
    );
}

/// Create a RAW file by copying from the manifest fixture.
fn create_raw_photo(
    source_dir: &Path,
    spec: &PhotoSpec,
    counter: usize,
    manifest: &Manifest,
) -> TestPhoto {
    let ext = spec.camera.raw_extension();
    let filename = format!("builder_{:04}.{}", counter, ext);
    let path = source_dir.join(&filename);

    // Try to copy real RAW fixture
    if let Some(fixture_id) = spec.camera.raw_fixture_id() {
        let fixture = manifest
            .fixtures
            .iter()
            .find(|f| f.id == fixture_id)
            .unwrap_or_else(|| panic!("RAW fixture {} not found in manifest", fixture_id));

        if let Some(src_path) = resolve_fixture_path(fixture) {
            std::fs::copy(&src_path, &path).unwrap_or_else(|e| {
                panic!(
                    "Cannot copy RAW fixture {} to {}: {}",
                    src_path.display(),
                    path.display(),
                    e
                )
            });

            // Patch orientation in the copied file to match spec
            patch_raw_orientation(&path, spec.orientation);

            // Patch capture_time if custom value provided
            if let Some(ref custom_time) = spec.capture_time {
                patch_raw_capture_time(&path, custom_time);
            }

            let (make, _model) = spec.camera.make_model();
            // Use manifest expected but override orientation and capture_time from spec
            let capture_time = if spec.capture_time.is_some() {
                spec.capture_time.clone()
            } else {
                fixture.expected.capture_time.clone()
            };
            return TestPhoto {
                path,
                spec: spec.clone(),
                expected: Expected {
                    make: Some(make.to_string()),
                    camera_model: fixture.expected.camera_model.clone(),
                    orientation: Some(spec.orientation),
                    capture_time,
                    capture_time_present: true,
                    aperture: fixture.expected.aperture,
                    iso: fixture.expected.iso,
                    focal_length: fixture.expected.focal_length,
                    shutter_speed: fixture.expected.shutter_speed.clone(),
                    exposure_comp: fixture.expected.exposure_comp,
                    lens: fixture.expected.lens.clone(),
                    image_width: fixture.expected.image_width,
                    image_height: fixture.expected.image_height,
                    thumbnail_expected_width: fixture.expected.thumbnail_expected_width,
                    thumbnail_expected_height: fixture.expected.thumbnail_expected_height,
                    display_orientation: fixture.expected.display_orientation.clone(),
                    file_valid: true,
                    exif_parseable: true,
                },
            };
        }
    }

    // Fallback: create a JPEG with EXIF as "RAW" (for synthetic or missing fixtures)
    let (make, model) = spec.camera.make_model();
    let capture_time = spec.capture_time.as_deref().unwrap_or(DEFAULT_CAPTURE_TIME);
    let jpeg_bytes = build_jpeg_with_exif(make, model, spec.orientation, capture_time);
    std::fs::write(&path, jpeg_bytes).unwrap();

    let camera_model = build_camera_model(make, model);

    TestPhoto {
        path,
        spec: spec.clone(),
        expected: Expected {
            make: Some(make.to_string()),
            camera_model: Some(camera_model),
            orientation: Some(spec.orientation),
            capture_time: Some(capture_time.to_string()),
            capture_time_present: true,
            aperture: None,
            iso: None,
            focal_length: None,
            shutter_speed: None,
            exposure_comp: None,
            lens: None,
            image_width: Some(4),
            image_height: Some(4),
            thumbnail_expected_width: None,
            thumbnail_expected_height: None,
            display_orientation: None,
            file_valid: true,
            exif_parseable: true,
        },
    }
}

/// Build a minimal JPEG with EXIF APP1 segment containing Make, Model,
/// Orientation, and DateTimeOriginal tags.
fn build_jpeg_with_exif(make: &str, model: &str, orientation: u16, capture_time: &str) -> Vec<u8> {
    use image::codecs::jpeg::JpegEncoder;
    use image::ColorType;

    // 1. Create a tiny 4x4 gray JPEG body
    let pixels = vec![128u8; 4 * 4 * 3]; // 4x4 RGB
    let mut jpeg_body = Vec::new();
    {
        let mut encoder = JpegEncoder::new_with_quality(&mut jpeg_body, 90);
        encoder
            .encode(&pixels, 4, 4, ColorType::Rgb8.into())
            .unwrap();
    }

    // 2. Build EXIF APP1 segment
    let exif_segment = build_exif_app1(make, model, orientation, capture_time);

    // 3. Splice EXIF after SOI (first 2 bytes FF D8)
    let mut result = Vec::with_capacity(2 + exif_segment.len() + jpeg_body.len() - 2);
    result.extend_from_slice(&jpeg_body[..2]); // FF D8 (SOI)
    result.extend_from_slice(&exif_segment);
    result.extend_from_slice(&jpeg_body[2..]); // rest of JPEG
    result
}

/// Build an EXIF APP1 segment with IFD0 tags.
/// Returns bytes: FF E1 <len> "Exif\0\0" <TIFF header> <IFD0>
fn build_exif_app1(make: &str, model: &str, orientation: u16, capture_time: &str) -> Vec<u8> {
    let datetime_str = format!("{}\0", capture_time);
    let datetime = datetime_str.as_bytes();

    // Pad make and model to include NUL terminator
    let make_bytes = [make.as_bytes(), &[0]].concat();
    let model_bytes = [model.as_bytes(), &[0]].concat();

    // IFD0 will have 4 entries: Make(0x010F), Model(0x0110), Orientation(0x0112),
    // plus ExifIFD pointer(0x8769) → sub-IFD with DateTimeOriginal(0x9003)
    let ifd0_entry_count: u16 = 4;
    // Sub-IFD (ExifIFD) will have 1 entry: DateTimeOriginal
    let exif_ifd_entry_count: u16 = 1;

    // Layout within TIFF data (offsets from TIFF header start):
    // 0..8: TIFF header (II, 42, offset-to-IFD0=8)
    // 8..10: IFD0 entry count
    // 10..10+4*12=58: IFD0 entries (4 entries × 12 bytes)
    // 58..62: next IFD offset (0 = none)
    // 62..: data area for strings, then ExifIFD

    let ifd0_start: u32 = 8;
    let ifd0_entries_start = ifd0_start + 2;
    let ifd0_end = ifd0_entries_start + (ifd0_entry_count as u32) * 12 + 4; // +4 for next IFD ptr
    let data_start = ifd0_end;

    // Data offsets
    let make_offset = data_start;
    let model_offset = make_offset + make_bytes.len() as u32;
    let exif_ifd_offset = model_offset + model_bytes.len() as u32;

    // ExifIFD layout
    let exif_ifd_entries_start = exif_ifd_offset + 2;
    let exif_ifd_end = exif_ifd_entries_start + (exif_ifd_entry_count as u32) * 12 + 4;
    let datetime_offset = exif_ifd_end;

    let tiff_data_len = datetime_offset + datetime.len() as u32;

    // Build TIFF data
    let mut tiff = Vec::with_capacity(tiff_data_len as usize);

    // TIFF header: little-endian
    tiff.extend_from_slice(b"II");
    tiff.extend_from_slice(&42u16.to_le_bytes());
    tiff.extend_from_slice(&ifd0_start.to_le_bytes());

    // IFD0 entry count
    tiff.extend_from_slice(&ifd0_entry_count.to_le_bytes());

    // IFD0 entries (each 12 bytes: tag, type, count, value/offset)
    // Entry 1: Make (0x010F, ASCII=2)
    write_ifd_entry(&mut tiff, 0x010F, 2, make_bytes.len() as u32, make_offset);
    // Entry 2: Model (0x0110, ASCII=2)
    write_ifd_entry(&mut tiff, 0x0110, 2, model_bytes.len() as u32, model_offset);
    // Entry 3: Orientation (0x0112, SHORT=3, count=1, value inline)
    write_ifd_entry_short(&mut tiff, 0x0112, orientation);
    // Entry 4: ExifIFD pointer (0x8769, LONG=4, count=1, value=offset)
    write_ifd_entry(&mut tiff, 0x8769, 4, 1, exif_ifd_offset);

    // Next IFD offset = 0 (no more IFDs)
    tiff.extend_from_slice(&0u32.to_le_bytes());

    // Data area: Make string
    tiff.extend_from_slice(&make_bytes);
    // Data area: Model string
    tiff.extend_from_slice(&model_bytes);

    // ExifIFD
    tiff.extend_from_slice(&exif_ifd_entry_count.to_le_bytes());
    // DateTimeOriginal (0x9003, ASCII=2)
    write_ifd_entry(&mut tiff, 0x9003, 2, datetime.len() as u32, datetime_offset);
    // Next IFD offset = 0
    tiff.extend_from_slice(&0u32.to_le_bytes());
    // DateTime string data
    tiff.extend_from_slice(datetime);

    // Build APP1 segment: FF E1 <length> "Exif\0\0" <tiff_data>
    let exif_header = b"Exif\0\0";
    let app1_payload_len = exif_header.len() + tiff.len();
    let app1_len = (app1_payload_len + 2) as u16; // +2 for the length field itself

    let mut segment = Vec::with_capacity(2 + 2 + app1_payload_len);
    segment.push(0xFF);
    segment.push(0xE1);
    segment.extend_from_slice(&app1_len.to_be_bytes());
    segment.extend_from_slice(exif_header);
    segment.extend_from_slice(&tiff);

    segment
}

/// Write a 12-byte IFD entry (tag, type, count, value-as-offset).
fn write_ifd_entry(buf: &mut Vec<u8>, tag: u16, dtype: u16, count: u32, value_offset: u32) {
    buf.extend_from_slice(&tag.to_le_bytes());
    buf.extend_from_slice(&dtype.to_le_bytes());
    buf.extend_from_slice(&count.to_le_bytes());
    buf.extend_from_slice(&value_offset.to_le_bytes());
}

/// Write a 12-byte IFD entry for a SHORT value (inline, count=1).
fn write_ifd_entry_short(buf: &mut Vec<u8>, tag: u16, value: u16) {
    buf.extend_from_slice(&tag.to_le_bytes());
    buf.extend_from_slice(&3u16.to_le_bytes()); // SHORT type
    buf.extend_from_slice(&1u32.to_le_bytes()); // count
                                                // Value inline: 2 bytes of value + 2 bytes padding
    buf.extend_from_slice(&value.to_le_bytes());
    buf.extend_from_slice(&0u16.to_le_bytes());
}

impl TestProject {
    pub fn photos(&self) -> &[TestPhoto] {
        &self.photos
    }
}

// ---------------------------------------------------------------------------
// Unit tests for the library itself
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_load_manifest_parses_successfully() {
        let manifest = load_manifest();
        assert!(manifest.schema_version >= 2);
        assert!(!manifest.fixtures.is_empty());
    }

    #[test]
    fn test_manifest_has_expected_fixture_count() {
        let manifest = load_manifest();
        // 22 original + 3 new cameras = 25
        assert!(
            manifest.fixtures.len() >= 22,
            "Expected at least 22 fixtures, got {}",
            manifest.fixtures.len()
        );
    }

    #[test]
    fn test_all_fixtures_have_required_fields() {
        let manifest = load_manifest();
        for f in &manifest.fixtures {
            assert!(!f.id.is_empty(), "Fixture has empty id");
            assert!(
                !f.category.is_empty(),
                "Fixture {} has empty category",
                f.id
            );
            assert!(
                !f.test_layers.is_empty(),
                "Fixture {} has no test_layers",
                f.id
            );
        }
    }

    #[test]
    fn test_fixture_ids_are_unique() {
        let manifest = load_manifest();
        let mut ids: Vec<&str> = manifest.fixtures.iter().map(|f| f.id.as_str()).collect();
        ids.sort();
        let before = ids.len();
        ids.dedup();
        assert_eq!(ids.len(), before, "Duplicate fixture IDs found");
    }

    #[test]
    fn test_resolve_path_synthetic_fixtures_exist() {
        let manifest = load_manifest();
        for f in &manifest.fixtures {
            if f.category == "synthetic-jpeg" || f.category == "synthetic-corrupt" {
                let path = resolve_fixture_path(f);
                assert!(
                    path.is_some(),
                    "Synthetic fixture {} should exist on disk",
                    f.id
                );
            }
        }
    }

    #[test]
    fn test_resolve_path_timing_only_returns_none() {
        let manifest = load_manifest();
        for f in &manifest.fixtures {
            if f.category == "timing-only" {
                assert!(
                    resolve_fixture_path(f).is_none(),
                    "Timing-only fixture {} should return None",
                    f.id
                );
            }
        }
    }

    #[test]
    fn test_for_each_fixture_exif_layer_runs() {
        let mut count = 0;
        for_each_fixture("exif", |_fixture, path| {
            assert!(path.exists());
            count += 1;
        });
        // At minimum, all synthetic fixtures with exif layer should be tested
        assert!(
            count >= 10,
            "Expected at least 10 exif-layer fixtures, got {}",
            count
        );
    }

    #[test]
    fn test_for_each_fixture_unknown_layer_runs_zero() {
        let mut count = 0;
        for_each_fixture("nonexistent_layer", |_, _| {
            count += 1;
        });
        assert_eq!(count, 0);
    }

    #[test]
    fn test_assert_exif_matches_passes_on_exact_match() {
        let actual = ExifData {
            camera_model: Some("Canon EOS 7D".to_string()),
            orientation: Some(1),
            capture_time: Some(chrono::Utc::now()),
            aperture: Some(2.8),
            iso: Some(100),
            focal_length: Some(200.0),
            shutter_speed: Some("1/320".to_string()),
            exposure_comp: Some(0.0),
            lens: None,
        };
        let expected = Expected {
            make: Some("Canon".to_string()),
            camera_model: Some("Canon EOS 7D".to_string()),
            orientation: Some(1),
            capture_time: Some("2009:10:09 14:18:45".to_string()),
            capture_time_present: true,
            aperture: Some(2.8),
            iso: Some(100),
            focal_length: Some(200.0),
            shutter_speed: Some("1/320".to_string()),
            exposure_comp: Some(0.0),
            lens: None,
            image_width: Some(5184),
            image_height: Some(3456),
            thumbnail_expected_width: Some(256),
            thumbnail_expected_height: Some(256),
            display_orientation: Some("landscape".to_string()),
            file_valid: true,
            exif_parseable: true,
        };
        // Should not panic
        assert_exif_matches("test", &actual, &expected);
    }

    #[test]
    #[should_panic(expected = "EXIF mismatch")]
    fn test_assert_exif_matches_fails_on_mismatch() {
        let actual = ExifData {
            camera_model: Some("Wrong Model".to_string()),
            orientation: Some(1),
            ..ExifData::default()
        };
        let expected = Expected {
            make: None,
            camera_model: Some("Canon EOS 7D".to_string()),
            orientation: Some(1),
            capture_time: None,
            capture_time_present: false,
            aperture: None,
            iso: None,
            focal_length: None,
            shutter_speed: None,
            exposure_comp: None,
            lens: None,
            image_width: None,
            image_height: None,
            thumbnail_expected_width: None,
            thumbnail_expected_height: None,
            display_orientation: None,
            file_valid: false,
            exif_parseable: false,
        };
        assert_exif_matches("test", &actual, &expected);
    }

    #[test]
    fn test_create_test_project_with_explicit_fixtures() {
        let project = create_test_project(&["s1", "s3"]);
        assert_eq!(project.fixture_ids.len(), 2);
        assert!(project.source_dir().join("orient_1_landscape.jpg").exists());
        assert!(project.source_dir().join("orient_6_landscape.jpg").exists());
    }

    #[test]
    fn test_create_test_project_pairs_copied_together() {
        let project = create_test_project(&["s11"]);
        // s11 is pair_IMG_0001.jpg, s12 (pair_IMG_0001.cr2) should be auto-included
        assert!(project.source_dir().join("pair_IMG_0001.jpg").exists());
        assert!(project.source_dir().join("pair_IMG_0001.cr2").exists());
        assert!(project.fixture_ids.contains(&"s12".to_string()));
    }

    #[test]
    fn test_create_random_project_deterministic() {
        let p1 = create_random_test_project(5, 42);
        let p2 = create_random_test_project(5, 42);
        assert_eq!(
            p1.fixture_ids, p2.fixture_ids,
            "Same seed should produce same fixtures"
        );
    }

    #[test]
    fn test_create_random_project_different_seeds_differ() {
        let p1 = create_random_test_project(5, 42);
        let p2 = create_random_test_project(5, 99);
        // Very unlikely to be identical with different seeds
        assert_ne!(
            p1.fixture_ids, p2.fixture_ids,
            "Different seeds should produce different fixtures"
        );
    }

    #[test]
    fn test_create_random_project_respects_count() {
        let project = create_random_test_project(3, 123);
        assert_eq!(
            project.fixture_ids.len(),
            3,
            "Expected exactly 3 fixtures (before pair expansion)"
        );
    }

    #[test]
    fn test_project_has_initialized_db() {
        let project = create_test_project(&["s1"]);
        let count: i64 = project
            .conn
            .query_row("SELECT COUNT(*) FROM projects", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn test_project_has_source_folder_registered() {
        let project = create_test_project(&["s1"]);
        let folder: String = project
            .conn
            .query_row(
                "SELECT path FROM source_folders WHERE project_id = ?1",
                [project.project_id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(folder, project.source_dir().to_str().unwrap());
    }

    #[test]
    #[should_panic(expected = "not found in manifest")]
    fn test_create_test_project_panics_on_unknown_id() {
        create_test_project(&["nonexistent_fixture_id"]);
    }

    #[test]
    fn test_orientation_diversity_in_manifest() {
        let manifest = load_manifest();
        let orientations: Vec<Option<u16>> = manifest
            .fixtures
            .iter()
            .map(|f| f.expected.orientation)
            .collect();
        assert!(orientations.contains(&Some(1)), "Missing orientation=1");
        assert!(orientations.contains(&Some(3)), "Missing orientation=3");
        assert!(orientations.contains(&Some(6)), "Missing orientation=6");
        assert!(orientations.contains(&Some(8)), "Missing orientation=8");
        assert!(orientations.contains(&None), "Missing orientation=None");
    }

    // -----------------------------------------------------------------------
    // RED-phase tests for TestLibraryBuilder API (types do not exist yet)
    // -----------------------------------------------------------------------

    #[test]
    fn test_builder_canon_jpeg_creates_file() {
        let project = TestLibraryBuilder::new()
            .add_photo(PhotoSpec {
                camera: Camera::Canon,
                orientation: 6,
                file_type: FileType::Jpeg,
                capture_time: None,
                camera_params: None,
            })
            .build();
        let photo = &project.photos()[0];
        assert!(photo.path.exists(), "Canon JPEG file should exist on disk");
        assert!(
            photo.path.extension().unwrap().eq_ignore_ascii_case("jpg")
                || photo.path.extension().unwrap().eq_ignore_ascii_case("jpeg"),
            "File should have .jpg extension"
        );
    }

    #[test]
    fn test_builder_sony_raw_creates_arw() {
        let project = TestLibraryBuilder::new()
            .add_photo(PhotoSpec {
                camera: Camera::Sony,
                orientation: 1,
                file_type: FileType::Raw,
                capture_time: None,
                camera_params: None,
            })
            .build();
        let photo = &project.photos()[0];
        assert!(photo.path.exists(), "Sony RAW file should exist on disk");
        assert_eq!(
            photo.path.extension().unwrap().to_ascii_lowercase(),
            "arw",
            "Sony RAW should be .arw"
        );
    }

    #[test]
    fn test_builder_canon_raw_creates_cr2() {
        let project = TestLibraryBuilder::new()
            .add_photo(PhotoSpec {
                camera: Camera::Canon,
                orientation: 1,
                file_type: FileType::Raw,
                capture_time: None,
                camera_params: None,
            })
            .build();
        let photo = &project.photos()[0];
        assert!(photo.path.exists(), "Canon RAW file should exist on disk");
        assert_eq!(
            photo.path.extension().unwrap().to_ascii_lowercase(),
            "cr2",
            "Canon RAW should be .cr2"
        );
    }

    #[test]
    fn test_builder_nikon_raw_creates_nef() {
        let project = TestLibraryBuilder::new()
            .add_photo(PhotoSpec {
                camera: Camera::Nikon,
                orientation: 1,
                file_type: FileType::Raw,
                capture_time: None,
                camera_params: None,
            })
            .build();
        let photo = &project.photos()[0];
        assert!(photo.path.exists(), "Nikon RAW file should exist on disk");
        assert_eq!(
            photo.path.extension().unwrap().to_ascii_lowercase(),
            "nef",
            "Nikon RAW should be .nef"
        );
    }

    #[test]
    fn test_builder_both_creates_two_files() {
        let project = TestLibraryBuilder::new()
            .add_photo(PhotoSpec {
                camera: Camera::Canon,
                orientation: 1,
                file_type: FileType::Both,
                capture_time: None,
                camera_params: None,
            })
            .build();
        let photos = project.photos();
        // FileType::Both produces exactly 2 files: one RAW + one JPEG
        assert_eq!(
            photos.len(),
            2,
            "FileType::Both should create exactly 2 photos, got {}",
            photos.len()
        );
        let raw_count = photos
            .iter()
            .filter(|p| {
                let ext = p.path.extension().unwrap().to_ascii_lowercase();
                ext == "cr2" || ext == "arw" || ext == "nef" || ext == "raf" || ext == "rw2"
            })
            .count();
        let jpeg_count = photos
            .iter()
            .filter(|p| {
                let ext = p.path.extension().unwrap().to_ascii_lowercase();
                ext == "jpg" || ext == "jpeg"
            })
            .count();
        assert_eq!(
            raw_count, 1,
            "FileType::Both should include exactly 1 RAW file"
        );
        assert_eq!(
            jpeg_count, 1,
            "FileType::Both should include exactly 1 JPEG file"
        );
    }

    #[test]
    fn test_builder_expected_fields_match_spec() {
        let project = TestLibraryBuilder::new()
            .add_photo(PhotoSpec {
                camera: Camera::Canon,
                orientation: 6,
                file_type: FileType::Jpeg,
                capture_time: None,
                camera_params: None,
            })
            .build();
        let photo = &project.photos()[0];
        assert!(
            photo
                .expected
                .camera_model
                .as_ref()
                .unwrap()
                .to_lowercase()
                .contains("canon"),
            "Expected camera_model should contain 'canon'"
        );
        assert_eq!(
            photo.expected.orientation,
            Some(6),
            "Expected orientation should match spec"
        );
    }

    #[test]
    fn test_builder_spec_preserved() {
        let spec = PhotoSpec {
            camera: Camera::Canon,
            orientation: 6,
            file_type: FileType::Jpeg,
            capture_time: None,
            camera_params: None,
        };
        let project = TestLibraryBuilder::new().add_photo(spec).build();
        let photo = &project.photos()[0];
        assert_eq!(photo.spec.camera, Camera::Canon);
        assert_eq!(photo.spec.orientation, 6);
        assert_eq!(photo.spec.file_type, FileType::Jpeg);
    }

    #[test]
    fn test_builder_synthetic_always_available() {
        let project = TestLibraryBuilder::new()
            .add_photo(PhotoSpec {
                camera: Camera::Synthetic,
                orientation: 1,
                file_type: FileType::Jpeg,
                capture_time: None,
                camera_params: None,
            })
            .build();
        let photo = &project.photos()[0];
        assert!(
            photo.path.exists(),
            "Synthetic camera files should always be available (not gitignored)"
        );
        assert!(
            photo.expected.make.is_some(),
            "Synthetic should have expected.make"
        );
    }

    #[test]
    fn test_builder_all_four_orientations() {
        let project = TestLibraryBuilder::new()
            .add_photo(PhotoSpec {
                camera: Camera::Canon,
                orientation: 1,
                file_type: FileType::Jpeg,
                capture_time: None,
                camera_params: None,
            })
            .add_photo(PhotoSpec {
                camera: Camera::Canon,
                orientation: 3,
                file_type: FileType::Jpeg,
                capture_time: None,
                camera_params: None,
            })
            .add_photo(PhotoSpec {
                camera: Camera::Canon,
                orientation: 6,
                file_type: FileType::Jpeg,
                capture_time: None,
                camera_params: None,
            })
            .add_photo(PhotoSpec {
                camera: Camera::Canon,
                orientation: 8,
                file_type: FileType::Jpeg,
                capture_time: None,
                camera_params: None,
            })
            .build();
        let photos = project.photos();
        assert_eq!(photos.len(), 4, "Should have 4 photos for 4 orientations");
        for (i, orient) in [1u16, 3, 6, 8].iter().enumerate() {
            assert_eq!(
                photos[i].expected.orientation,
                Some(*orient),
                "Photo {} should have orientation {}",
                i,
                orient
            );
        }
    }

    #[test]
    fn test_builder_mixed_batch() {
        let mut builder = TestLibraryBuilder::new();
        for _ in 0..3 {
            builder = builder.add_photo(PhotoSpec {
                camera: Camera::Canon,
                orientation: 6,
                file_type: FileType::Jpeg,
                capture_time: None,
                camera_params: None,
            });
        }
        for _ in 0..2 {
            builder = builder.add_photo(PhotoSpec {
                camera: Camera::Sony,
                orientation: 1,
                file_type: FileType::Jpeg,
                capture_time: None,
                camera_params: None,
            });
        }
        let project = builder.build();
        let photos = project.photos();
        assert_eq!(photos.len(), 5, "Mixed batch should have 5 photos");
        for photo in photos {
            assert!(photo.path.exists(), "All photo files should exist");
            let ext = photo.path.extension().unwrap().to_ascii_lowercase();
            assert!(ext == "jpg" || ext == "jpeg", "All should be JPEG files");
        }
    }

    #[test]
    fn test_builder_db_initialization() {
        let project = TestLibraryBuilder::new().build();
        let count: i64 = project
            .conn
            .query_row("SELECT COUNT(*) FROM projects", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 1, "Builder should create a project row in DB");
        let folder_count: i64 = project
            .conn
            .query_row("SELECT COUNT(*) FROM source_folders", [], |r| r.get(0))
            .unwrap();
        assert_eq!(
            folder_count, 1,
            "Builder should register a source folder in DB"
        );
    }

    #[test]
    fn test_builder_empty_produces_empty_photos() {
        let project = TestLibraryBuilder::new().build();
        assert!(
            project.photos().is_empty(),
            "No add_photo calls should produce empty photos()"
        );
        assert!(
            project.source_dir().exists(),
            "Source dir should still exist even with no photos"
        );
    }

    #[test]
    fn test_builder_extract_metadata_round_trip() {
        use crate::import::exif::extract_metadata;

        let project = TestLibraryBuilder::new()
            .add_photo(PhotoSpec {
                camera: Camera::Canon,
                orientation: 6,
                file_type: FileType::Both,
                capture_time: None,
                camera_params: None,
            })
            .build();
        let jpeg_photo = project
            .photos()
            .iter()
            .find(|p| {
                let ext = p.path.extension().unwrap().to_ascii_lowercase();
                ext == "jpg" || ext == "jpeg"
            })
            .expect("FileType::Both should include a JPEG");

        let actual = extract_metadata(&jpeg_photo.path);
        assert_eq!(
            actual.orientation, jpeg_photo.expected.orientation,
            "extract_metadata orientation should match expected"
        );
        if let Some(ref expected_model) = jpeg_photo.expected.camera_model {
            assert!(
                actual
                    .camera_model
                    .as_ref()
                    .unwrap()
                    .to_lowercase()
                    .contains(&expected_model.to_lowercase()),
                "extract_metadata camera_model should match expected"
            );
        }
    }

    #[test]
    fn test_builder_unique_paths() {
        let project = TestLibraryBuilder::new()
            .add_photo(PhotoSpec {
                camera: Camera::Canon,
                orientation: 6,
                file_type: FileType::Jpeg,
                capture_time: None,
                camera_params: None,
            })
            .add_photo(PhotoSpec {
                camera: Camera::Canon,
                orientation: 6,
                file_type: FileType::Jpeg,
                capture_time: None,
                camera_params: None,
            })
            .add_photo(PhotoSpec {
                camera: Camera::Canon,
                orientation: 6,
                file_type: FileType::Jpeg,
                capture_time: None,
                camera_params: None,
            })
            .build();
        let photos = project.photos();
        assert_eq!(photos.len(), 3);
        let mut paths: Vec<&PathBuf> = photos.iter().map(|p| &p.path).collect();
        paths.sort();
        paths.dedup();
        assert_eq!(paths.len(), 3, "All photos should have unique file paths");
    }

    #[test]
    fn test_builder_both_shares_stem() {
        let project = TestLibraryBuilder::new()
            .add_photo(PhotoSpec {
                camera: Camera::Canon,
                orientation: 1,
                file_type: FileType::Both,
                capture_time: None,
                camera_params: None,
            })
            .build();
        let photos = project.photos();
        assert_eq!(
            photos.len(),
            2,
            "FileType::Both should produce exactly 2 files"
        );
        let stems: Vec<String> = photos
            .iter()
            .map(|p| p.path.file_stem().unwrap().to_string_lossy().to_string())
            .collect();
        let first = &stems[0];
        for stem in &stems {
            assert_eq!(
                stem, first,
                "All files from FileType::Both should share the same stem"
            );
        }
    }

    #[test]
    fn test_builder_fuji_raw_creates_raf() {
        let project = TestLibraryBuilder::new()
            .add_photo(PhotoSpec {
                camera: Camera::Fuji,
                orientation: 1,
                file_type: FileType::Raw,
                capture_time: None,
                camera_params: None,
            })
            .build();
        let photo = &project.photos()[0];
        assert!(photo.path.exists(), "Fuji RAW file should exist on disk");
        assert_eq!(
            photo.path.extension().unwrap().to_ascii_lowercase(),
            "raf",
            "Fuji RAW should be .raf"
        );
        assert!(
            photo
                .expected
                .make
                .as_ref()
                .unwrap()
                .to_uppercase()
                .contains("FUJIFILM"),
            "Fuji expected.make should contain FUJIFILM"
        );
    }

    #[test]
    fn test_builder_panasonic_raw_creates_rw2() {
        let project = TestLibraryBuilder::new()
            .add_photo(PhotoSpec {
                camera: Camera::Panasonic,
                orientation: 1,
                file_type: FileType::Raw,
                capture_time: None,
                camera_params: None,
            })
            .build();
        let photo = &project.photos()[0];
        assert!(
            photo.path.exists(),
            "Panasonic RAW file should exist on disk"
        );
        assert_eq!(
            photo.path.extension().unwrap().to_ascii_lowercase(),
            "rw2",
            "Panasonic RAW should be .rw2"
        );
        assert!(
            photo
                .expected
                .make
                .as_ref()
                .unwrap()
                .to_lowercase()
                .contains("panasonic"),
            "Panasonic expected.make should contain Panasonic"
        );
    }

    // -----------------------------------------------------------------------
    // Fixture validation: extract_metadata() on created files must match expected
    // -----------------------------------------------------------------------

    #[test]
    fn test_builder_canon_jpeg_fixture_matches_metadata() {
        use crate::import::exif::extract_metadata;
        let project = TestLibraryBuilder::new()
            .add_photo(PhotoSpec {
                camera: Camera::Canon,
                orientation: 6,
                file_type: FileType::Jpeg,
                capture_time: None,
                camera_params: None,
            })
            .build();
        let photo = &project.photos()[0];
        let actual = extract_metadata(&photo.path);
        assert_exif_matches("builder-canon-jpeg", &actual, &photo.expected);
    }

    #[test]
    fn test_builder_sony_jpeg_fixture_matches_metadata() {
        use crate::import::exif::extract_metadata;
        let project = TestLibraryBuilder::new()
            .add_photo(PhotoSpec {
                camera: Camera::Sony,
                orientation: 1,
                file_type: FileType::Jpeg,
                capture_time: None,
                camera_params: None,
            })
            .build();
        let photo = &project.photos()[0];
        let actual = extract_metadata(&photo.path);
        assert_exif_matches("builder-sony-jpeg", &actual, &photo.expected);
    }

    #[test]
    fn test_builder_nikon_jpeg_fixture_matches_metadata() {
        use crate::import::exif::extract_metadata;
        let project = TestLibraryBuilder::new()
            .add_photo(PhotoSpec {
                camera: Camera::Nikon,
                orientation: 1,
                file_type: FileType::Jpeg,
                capture_time: None,
                camera_params: None,
            })
            .build();
        let photo = &project.photos()[0];
        let actual = extract_metadata(&photo.path);
        assert_exif_matches("builder-nikon-jpeg", &actual, &photo.expected);
    }

    #[test]
    fn test_builder_synthetic_fixture_matches_metadata() {
        use crate::import::exif::extract_metadata;
        let project = TestLibraryBuilder::new()
            .add_photo(PhotoSpec {
                camera: Camera::Synthetic,
                orientation: 1,
                file_type: FileType::Jpeg,
                capture_time: None,
                camera_params: None,
            })
            .build();
        let photo = &project.photos()[0];
        let actual = extract_metadata(&photo.path);
        assert_exif_matches("builder-synthetic-jpeg", &actual, &photo.expected);
    }

    #[test]
    fn test_builder_canon_raw_fixture_matches_metadata() {
        use crate::import::exif::extract_metadata;
        let project = TestLibraryBuilder::new()
            .add_photo(PhotoSpec {
                camera: Camera::Canon,
                orientation: 1,
                file_type: FileType::Raw,
                capture_time: None,
                camera_params: None,
            })
            .build();
        let photo = &project.photos()[0];
        let actual = extract_metadata(&photo.path);
        assert_exif_matches("builder-canon-raw", &actual, &photo.expected);
    }

    #[test]
    fn test_builder_sony_raw_fixture_matches_metadata() {
        use crate::import::exif::extract_metadata;
        let project = TestLibraryBuilder::new()
            .add_photo(PhotoSpec {
                camera: Camera::Sony,
                orientation: 1,
                file_type: FileType::Raw,
                capture_time: None,
                camera_params: None,
            })
            .build();
        let photo = &project.photos()[0];
        let actual = extract_metadata(&photo.path);
        assert_exif_matches("builder-sony-raw", &actual, &photo.expected);
    }

    #[test]
    fn test_builder_all_orientations_fixture_matches_metadata() {
        use crate::import::exif::extract_metadata;
        let project = TestLibraryBuilder::new()
            .add_photo(PhotoSpec {
                camera: Camera::Canon,
                orientation: 1,
                file_type: FileType::Jpeg,
                capture_time: None,
                camera_params: None,
            })
            .add_photo(PhotoSpec {
                camera: Camera::Canon,
                orientation: 3,
                file_type: FileType::Jpeg,
                capture_time: None,
                camera_params: None,
            })
            .add_photo(PhotoSpec {
                camera: Camera::Canon,
                orientation: 6,
                file_type: FileType::Jpeg,
                capture_time: None,
                camera_params: None,
            })
            .add_photo(PhotoSpec {
                camera: Camera::Canon,
                orientation: 8,
                file_type: FileType::Jpeg,
                capture_time: None,
                camera_params: None,
            })
            .build();
        for photo in project.photos() {
            let actual = extract_metadata(&photo.path);
            let label = format!("builder-canon-orient-{}", photo.spec.orientation);
            assert_exif_matches(&label, &actual, &photo.expected);
        }
    }

    // -----------------------------------------------------------------------
    // Additional coverage: non-Canon cameras with Jpeg and Both
    // -----------------------------------------------------------------------

    #[test]
    fn test_builder_sony_jpeg_creates_file() {
        let project = TestLibraryBuilder::new()
            .add_photo(PhotoSpec {
                camera: Camera::Sony,
                orientation: 1,
                file_type: FileType::Jpeg,
                capture_time: None,
                camera_params: None,
            })
            .build();
        let photos = project.photos();
        assert_eq!(photos.len(), 1);
        let photo = &photos[0];
        assert!(photo.path.exists(), "Sony JPEG file should exist on disk");
        assert!(
            photo.path.extension().unwrap().eq_ignore_ascii_case("jpg")
                || photo.path.extension().unwrap().eq_ignore_ascii_case("jpeg"),
            "File should have .jpg extension"
        );
        assert!(
            photo
                .expected
                .make
                .as_ref()
                .unwrap()
                .to_lowercase()
                .contains("sony"),
            "Sony expected.make should contain Sony"
        );
    }

    #[test]
    fn test_builder_nikon_jpeg_creates_file() {
        let project = TestLibraryBuilder::new()
            .add_photo(PhotoSpec {
                camera: Camera::Nikon,
                orientation: 1,
                file_type: FileType::Jpeg,
                capture_time: None,
                camera_params: None,
            })
            .build();
        let photos = project.photos();
        assert_eq!(photos.len(), 1);
        let photo = &photos[0];
        assert!(photo.path.exists(), "Nikon JPEG file should exist on disk");
        assert!(
            photo.path.extension().unwrap().eq_ignore_ascii_case("jpg")
                || photo.path.extension().unwrap().eq_ignore_ascii_case("jpeg"),
            "File should have .jpg extension"
        );
        assert!(
            photo
                .expected
                .make
                .as_ref()
                .unwrap()
                .to_lowercase()
                .contains("nikon"),
            "Nikon expected.make should contain Nikon"
        );
    }

    #[test]
    fn test_builder_fuji_jpeg_creates_file() {
        let project = TestLibraryBuilder::new()
            .add_photo(PhotoSpec {
                camera: Camera::Fuji,
                orientation: 1,
                file_type: FileType::Jpeg,
                capture_time: None,
                camera_params: None,
            })
            .build();
        let photos = project.photos();
        assert_eq!(photos.len(), 1);
        let photo = &photos[0];
        assert!(photo.path.exists(), "Fuji JPEG file should exist on disk");
        assert!(
            photo.path.extension().unwrap().eq_ignore_ascii_case("jpg")
                || photo.path.extension().unwrap().eq_ignore_ascii_case("jpeg"),
            "File should have .jpg extension"
        );
        assert!(
            photo
                .expected
                .make
                .as_ref()
                .unwrap()
                .to_uppercase()
                .contains("FUJIFILM"),
            "Fuji expected.make should contain FUJIFILM"
        );
    }

    #[test]
    fn test_builder_panasonic_jpeg_creates_file() {
        let project = TestLibraryBuilder::new()
            .add_photo(PhotoSpec {
                camera: Camera::Panasonic,
                orientation: 1,
                file_type: FileType::Jpeg,
                capture_time: None,
                camera_params: None,
            })
            .build();
        let photos = project.photos();
        assert_eq!(photos.len(), 1);
        let photo = &photos[0];
        assert!(
            photo.path.exists(),
            "Panasonic JPEG file should exist on disk"
        );
        assert!(
            photo.path.extension().unwrap().eq_ignore_ascii_case("jpg")
                || photo.path.extension().unwrap().eq_ignore_ascii_case("jpeg"),
            "File should have .jpg extension"
        );
        assert!(
            photo
                .expected
                .make
                .as_ref()
                .unwrap()
                .to_lowercase()
                .contains("panasonic"),
            "Panasonic expected.make should contain Panasonic"
        );
    }

    // -----------------------------------------------------------------------
    // FileType::Both for non-Canon cameras
    // -----------------------------------------------------------------------

    #[test]
    fn test_builder_sony_both_creates_pair() {
        let project = TestLibraryBuilder::new()
            .add_photo(PhotoSpec {
                camera: Camera::Sony,
                orientation: 1,
                file_type: FileType::Both,
                capture_time: None,
                camera_params: None,
            })
            .build();
        let photos = project.photos();
        assert_eq!(photos.len(), 2, "Sony Both should create exactly 2 photos");
        let exts: Vec<String> = photos
            .iter()
            .map(|p| p.path.extension().unwrap().to_string_lossy().to_lowercase())
            .collect();
        assert!(
            exts.contains(&"arw".to_string()),
            "Sony Both should include .arw"
        );
        assert!(
            exts.contains(&"jpg".to_string()) || exts.contains(&"jpeg".to_string()),
            "Sony Both should include .jpg"
        );
    }

    #[test]
    fn test_builder_nikon_both_creates_pair() {
        let project = TestLibraryBuilder::new()
            .add_photo(PhotoSpec {
                camera: Camera::Nikon,
                orientation: 1,
                file_type: FileType::Both,
                capture_time: None,
                camera_params: None,
            })
            .build();
        let photos = project.photos();
        assert_eq!(photos.len(), 2, "Nikon Both should create exactly 2 photos");
        let exts: Vec<String> = photos
            .iter()
            .map(|p| p.path.extension().unwrap().to_string_lossy().to_lowercase())
            .collect();
        assert!(
            exts.contains(&"nef".to_string()),
            "Nikon Both should include .nef"
        );
        assert!(
            exts.contains(&"jpg".to_string()) || exts.contains(&"jpeg".to_string()),
            "Nikon Both should include .jpg"
        );
    }

    // -----------------------------------------------------------------------
    // Orientation x Camera cross-product (non-Canon cameras)
    // -----------------------------------------------------------------------

    #[test]
    fn test_builder_sony_orientation_6() {
        let project = TestLibraryBuilder::new()
            .add_photo(PhotoSpec {
                camera: Camera::Sony,
                orientation: 6,
                file_type: FileType::Jpeg,
                capture_time: None,
                camera_params: None,
            })
            .build();
        let photos = project.photos();
        assert_eq!(photos.len(), 1);
        assert_eq!(photos[0].expected.orientation, Some(6));
        assert_eq!(photos[0].spec.orientation, 6);
    }

    #[test]
    fn test_builder_nikon_orientation_8() {
        let project = TestLibraryBuilder::new()
            .add_photo(PhotoSpec {
                camera: Camera::Nikon,
                orientation: 8,
                file_type: FileType::Jpeg,
                capture_time: None,
                camera_params: None,
            })
            .build();
        let photos = project.photos();
        assert_eq!(photos.len(), 1);
        assert_eq!(photos[0].expected.orientation, Some(8));
        assert_eq!(photos[0].spec.orientation, 8);
    }

    #[test]
    fn test_builder_fuji_orientation_3() {
        let project = TestLibraryBuilder::new()
            .add_photo(PhotoSpec {
                camera: Camera::Fuji,
                orientation: 3,
                file_type: FileType::Jpeg,
                capture_time: None,
                camera_params: None,
            })
            .build();
        let photos = project.photos();
        assert_eq!(photos.len(), 1);
        assert_eq!(photos[0].expected.orientation, Some(3));
        assert_eq!(photos[0].spec.orientation, 3);
    }

    // -----------------------------------------------------------------------
    // Exact count: Jpeg produces exactly 1, Raw produces exactly 1
    // -----------------------------------------------------------------------

    #[test]
    fn test_builder_jpeg_produces_exactly_one() {
        let project = TestLibraryBuilder::new()
            .add_photo(PhotoSpec {
                camera: Camera::Canon,
                orientation: 1,
                file_type: FileType::Jpeg,
                capture_time: None,
                camera_params: None,
            })
            .build();
        assert_eq!(
            project.photos().len(),
            1,
            "FileType::Jpeg should produce exactly 1 photo"
        );
    }

    #[test]
    fn test_builder_raw_produces_exactly_one() {
        let project = TestLibraryBuilder::new()
            .add_photo(PhotoSpec {
                camera: Camera::Canon,
                orientation: 1,
                file_type: FileType::Raw,
                capture_time: None,
                camera_params: None,
            })
            .build();
        assert_eq!(
            project.photos().len(),
            1,
            "FileType::Raw should produce exactly 1 photo"
        );
    }

    // -----------------------------------------------------------------------
    // All files inside source_dir
    // -----------------------------------------------------------------------

    #[test]
    fn test_builder_all_files_inside_source_dir() {
        let project = TestLibraryBuilder::new()
            .add_photo(PhotoSpec {
                camera: Camera::Canon,
                orientation: 1,
                file_type: FileType::Jpeg,
                capture_time: None,
                camera_params: None,
            })
            .add_photo(PhotoSpec {
                camera: Camera::Sony,
                orientation: 6,
                file_type: FileType::Raw,
                capture_time: None,
                camera_params: None,
            })
            .add_photo(PhotoSpec {
                camera: Camera::Nikon,
                orientation: 8,
                file_type: FileType::Both,
                capture_time: None,
                camera_params: None,
            })
            .build();
        let source = project.source_dir();
        // Both produces 2 + Jpeg 1 + Raw 1 = 4 photos
        assert_eq!(project.photos().len(), 4);
        for photo in project.photos() {
            assert!(
                photo.path.starts_with(&source),
                "Photo path {:?} should be inside source_dir {:?}",
                photo.path,
                source
            );
        }
    }

    // -----------------------------------------------------------------------
    // Orientation on RAW files
    // -----------------------------------------------------------------------

    #[test]
    fn test_builder_raw_orientation_preserved() {
        let project = TestLibraryBuilder::new()
            .add_photo(PhotoSpec {
                camera: Camera::Sony,
                orientation: 6,
                file_type: FileType::Raw,
                capture_time: None,
                camera_params: None,
            })
            .build();
        let photos = project.photos();
        assert_eq!(photos.len(), 1);
        assert_eq!(photos[0].expected.orientation, Some(6));
        assert_eq!(photos[0].spec.orientation, 6);
    }

    // -----------------------------------------------------------------------
    // Multiple Both specs produce correct total
    // -----------------------------------------------------------------------

    #[test]
    fn test_builder_multiple_both_exact_count() {
        let project = TestLibraryBuilder::new()
            .add_photo(PhotoSpec {
                camera: Camera::Canon,
                orientation: 1,
                file_type: FileType::Both,
                capture_time: None,
                camera_params: None,
            })
            .add_photo(PhotoSpec {
                camera: Camera::Sony,
                orientation: 6,
                file_type: FileType::Both,
                capture_time: None,
                camera_params: None,
            })
            .build();
        // Each Both produces exactly 2 → total 4
        assert_eq!(
            project.photos().len(),
            4,
            "2 Both specs should produce exactly 4 photos"
        );
    }

    // -----------------------------------------------------------------------
    // Mixed file types exact count
    // -----------------------------------------------------------------------

    #[test]
    fn test_builder_mixed_types_exact_count() {
        let project = TestLibraryBuilder::new()
            .add_photo(PhotoSpec {
                camera: Camera::Canon,
                orientation: 1,
                file_type: FileType::Jpeg,
                capture_time: None,
                camera_params: None,
            })
            .add_photo(PhotoSpec {
                camera: Camera::Canon,
                orientation: 1,
                file_type: FileType::Raw,
                capture_time: None,
                camera_params: None,
            })
            .add_photo(PhotoSpec {
                camera: Camera::Canon,
                orientation: 1,
                file_type: FileType::Both,
                capture_time: None,
                camera_params: None,
            })
            .build();
        // Jpeg=1 + Raw=1 + Both=2 → total 4
        assert_eq!(
            project.photos().len(),
            4,
            "Jpeg(1) + Raw(1) + Both(2) = exactly 4 photos"
        );
    }

    // -----------------------------------------------------------------------
    // Fixture metadata validation: every camera JPEG must have matching EXIF
    // -----------------------------------------------------------------------

    #[test]
    fn test_builder_fuji_jpeg_fixture_matches_metadata() {
        use crate::import::exif::extract_metadata;
        let project = TestLibraryBuilder::new()
            .add_photo(PhotoSpec {
                camera: Camera::Fuji,
                orientation: 1,
                file_type: FileType::Jpeg,
                capture_time: None,
                camera_params: None,
            })
            .build();
        let photo = &project.photos()[0];
        let actual = extract_metadata(&photo.path);
        assert_exif_matches("builder-fuji-jpeg", &actual, &photo.expected);
    }

    #[test]
    fn test_builder_panasonic_jpeg_fixture_matches_metadata() {
        use crate::import::exif::extract_metadata;
        let project = TestLibraryBuilder::new()
            .add_photo(PhotoSpec {
                camera: Camera::Panasonic,
                orientation: 1,
                file_type: FileType::Jpeg,
                capture_time: None,
                camera_params: None,
            })
            .build();
        let photo = &project.photos()[0];
        let actual = extract_metadata(&photo.path);
        assert_exif_matches("builder-panasonic-jpeg", &actual, &photo.expected);
    }

    // -----------------------------------------------------------------------
    // Non-trivial orientations: metadata validation across cameras
    // -----------------------------------------------------------------------

    #[test]
    fn test_builder_canon_orient6_fixture_matches_metadata() {
        use crate::import::exif::extract_metadata;
        let project = TestLibraryBuilder::new()
            .add_photo(PhotoSpec {
                camera: Camera::Canon,
                orientation: 6,
                file_type: FileType::Jpeg,
                capture_time: None,
                camera_params: None,
            })
            .build();
        let photo = &project.photos()[0];
        let actual = extract_metadata(&photo.path);
        assert_exif_matches("builder-canon-orient6", &actual, &photo.expected);
    }

    #[test]
    fn test_builder_sony_orient8_fixture_matches_metadata() {
        use crate::import::exif::extract_metadata;
        let project = TestLibraryBuilder::new()
            .add_photo(PhotoSpec {
                camera: Camera::Sony,
                orientation: 8,
                file_type: FileType::Jpeg,
                capture_time: None,
                camera_params: None,
            })
            .build();
        let photo = &project.photos()[0];
        let actual = extract_metadata(&photo.path);
        assert_exif_matches("builder-sony-orient8", &actual, &photo.expected);
    }

    #[test]
    fn test_builder_nikon_orient3_fixture_matches_metadata() {
        use crate::import::exif::extract_metadata;
        let project = TestLibraryBuilder::new()
            .add_photo(PhotoSpec {
                camera: Camera::Nikon,
                orientation: 3,
                file_type: FileType::Jpeg,
                capture_time: None,
                camera_params: None,
            })
            .build();
        let photo = &project.photos()[0];
        let actual = extract_metadata(&photo.path);
        assert_exif_matches("builder-nikon-orient3", &actual, &photo.expected);
    }

    // -----------------------------------------------------------------------
    // FileType::Both — both JPEG and RAW files must have matching metadata
    // -----------------------------------------------------------------------

    #[test]
    fn test_builder_both_jpeg_side_matches_metadata() {
        use crate::import::exif::extract_metadata;
        let project = TestLibraryBuilder::new()
            .add_photo(PhotoSpec {
                camera: Camera::Canon,
                orientation: 6,
                file_type: FileType::Both,
                capture_time: None,
                camera_params: None,
            })
            .build();
        let jpeg_photo = project
            .photos()
            .iter()
            .find(|p| {
                let ext = p.path.extension().unwrap().to_string_lossy().to_lowercase();
                ext == "jpg" || ext == "jpeg"
            })
            .expect("FileType::Both should include a JPEG");
        let actual = extract_metadata(&jpeg_photo.path);
        assert_exif_matches("builder-both-jpeg-side", &actual, &jpeg_photo.expected);
    }

    // -----------------------------------------------------------------------
    // Every created file must have capture_time_present = true in expected
    // -----------------------------------------------------------------------

    #[test]
    fn test_builder_all_photos_have_capture_time() {
        use crate::import::exif::extract_metadata;
        let project = TestLibraryBuilder::new()
            .add_photo(PhotoSpec {
                camera: Camera::Canon,
                orientation: 1,
                file_type: FileType::Jpeg,
                capture_time: None,
                camera_params: None,
            })
            .add_photo(PhotoSpec {
                camera: Camera::Sony,
                orientation: 6,
                file_type: FileType::Jpeg,
                capture_time: None,
                camera_params: None,
            })
            .add_photo(PhotoSpec {
                camera: Camera::Synthetic,
                orientation: 3,
                file_type: FileType::Jpeg,
                capture_time: None,
                camera_params: None,
            })
            .build();
        for photo in project.photos() {
            assert!(
                photo.expected.capture_time_present,
                "Every created photo should have capture_time_present=true in expected"
            );
            let actual = extract_metadata(&photo.path);
            assert!(
                actual.capture_time.is_some(),
                "extract_metadata on {:?} should return capture_time",
                photo.path
            );
        }
    }

    // -----------------------------------------------------------------------
    // Expected.make must be set for all cameras
    // -----------------------------------------------------------------------

    #[test]
    fn test_builder_every_camera_has_make() {
        let cameras = [
            Camera::Canon,
            Camera::Sony,
            Camera::Nikon,
            Camera::Fuji,
            Camera::Panasonic,
            Camera::Synthetic,
        ];
        for camera in &cameras {
            let project = TestLibraryBuilder::new()
                .add_photo(PhotoSpec {
                    camera: *camera,
                    orientation: 1,
                    file_type: FileType::Jpeg,
                    capture_time: None,
                    camera_params: None,
                })
                .build();
            let photo = &project.photos()[0];
            assert!(
                photo.expected.make.is_some(),
                "Camera {:?} should have expected.make set",
                camera
            );
            assert!(
                photo.expected.camera_model.is_some(),
                "Camera {:?} should have expected.camera_model set",
                camera
            );
        }
    }

    // -----------------------------------------------------------------------
    // B2: FileType::Both for missing cameras (Fuji, Panasonic)
    // -----------------------------------------------------------------------

    #[test]
    fn test_builder_fuji_both_creates_pair() {
        let project = TestLibraryBuilder::new()
            .add_photo(PhotoSpec {
                camera: Camera::Fuji,
                orientation: 1,
                file_type: FileType::Both,
                capture_time: None,
                camera_params: None,
            })
            .build();
        let photos = project.photos();
        assert_eq!(photos.len(), 2, "Fuji Both should create exactly 2 photos");
        let exts: Vec<String> = photos
            .iter()
            .map(|p| p.path.extension().unwrap().to_string_lossy().to_lowercase())
            .collect();
        assert!(
            exts.contains(&"raf".to_string()),
            "Fuji Both should include .raf, got {:?}",
            exts
        );
        assert!(
            exts.contains(&"jpg".to_string()) || exts.contains(&"jpeg".to_string()),
            "Fuji Both should include .jpg, got {:?}",
            exts
        );
        for photo in photos {
            assert!(
                photo.path.exists(),
                "Fuji Both file {:?} should exist",
                photo.path
            );
        }
    }

    #[test]
    fn test_builder_panasonic_both_creates_pair() {
        let project = TestLibraryBuilder::new()
            .add_photo(PhotoSpec {
                camera: Camera::Panasonic,
                orientation: 1,
                file_type: FileType::Both,
                capture_time: None,
                camera_params: None,
            })
            .build();
        let photos = project.photos();
        assert_eq!(
            photos.len(),
            2,
            "Panasonic Both should create exactly 2 photos"
        );
        let exts: Vec<String> = photos
            .iter()
            .map(|p| p.path.extension().unwrap().to_string_lossy().to_lowercase())
            .collect();
        assert!(
            exts.contains(&"rw2".to_string()),
            "Panasonic Both should include .rw2, got {:?}",
            exts
        );
        assert!(
            exts.contains(&"jpg".to_string()) || exts.contains(&"jpeg".to_string()),
            "Panasonic Both should include .jpg, got {:?}",
            exts
        );
        for photo in photos {
            assert!(
                photo.path.exists(),
                "Panasonic Both file {:?} should exist",
                photo.path
            );
        }
    }

    // -----------------------------------------------------------------------
    // B6: Synthetic + Raw edge case
    // -----------------------------------------------------------------------

    #[test]
    fn test_builder_synthetic_raw_creates_file() {
        let project = TestLibraryBuilder::new()
            .add_photo(PhotoSpec {
                camera: Camera::Synthetic,
                orientation: 1,
                file_type: FileType::Raw,
                capture_time: None,
                camera_params: None,
            })
            .build();
        let photos = project.photos();
        assert_eq!(
            photos.len(),
            1,
            "Synthetic Raw should create exactly 1 photo"
        );
        let photo = &photos[0];
        assert!(
            photo.path.exists(),
            "Synthetic Raw file should exist on disk (fallback to JPEG-with-EXIF)"
        );
        assert!(
            photo
                .expected
                .make
                .as_ref()
                .unwrap()
                .to_lowercase()
                .contains("synthetic"),
            "Synthetic Raw expected.make should contain 'synthetic', got {:?}",
            photo.expected.make
        );
    }

    // -----------------------------------------------------------------------
    // B7: RAW fallback path verification
    // When a RAW fixture doesn't exist, create_raw_photo falls back to
    // JPEG-with-EXIF. We test this by using Camera::Synthetic (no fixture).
    // -----------------------------------------------------------------------

    #[test]
    fn test_builder_raw_fallback_file_exists_and_metadata_works() {
        use crate::import::exif::extract_metadata;

        let project = TestLibraryBuilder::new()
            .add_photo(PhotoSpec {
                camera: Camera::Synthetic,
                orientation: 6,
                file_type: FileType::Raw,
                capture_time: None,
                camera_params: None,
            })
            .build();
        let photo = &project.photos()[0];
        assert!(
            photo.path.exists(),
            "Fallback RAW file should exist on disk"
        );
        // expected fields should be populated
        assert!(
            photo.expected.make.is_some(),
            "Fallback should have expected.make"
        );
        assert!(
            photo.expected.camera_model.is_some(),
            "Fallback should have expected.camera_model"
        );
        assert_eq!(
            photo.expected.orientation,
            Some(6),
            "Fallback expected.orientation should match spec"
        );
        // extract_metadata should work on the fallback file
        let actual = extract_metadata(&photo.path);
        assert_exif_matches("builder-raw-fallback", &actual, &photo.expected);
    }

    // -----------------------------------------------------------------------
    // B8: RAW metadata round-trip for remaining cameras
    // -----------------------------------------------------------------------

    #[test]
    fn test_builder_nikon_raw_fixture_matches_metadata() {
        use crate::import::exif::extract_metadata;
        let project = TestLibraryBuilder::new()
            .add_photo(PhotoSpec {
                camera: Camera::Nikon,
                orientation: 1,
                file_type: FileType::Raw,
                capture_time: None,
                camera_params: None,
            })
            .build();
        let photo = &project.photos()[0];
        let actual = extract_metadata(&photo.path);
        assert!(
            actual.camera_model.is_some(),
            "Nikon RAW extract_metadata should return camera_model"
        );
        assert_exif_matches("builder-nikon-raw", &actual, &photo.expected);
    }

    #[test]
    fn test_builder_fuji_raw_fixture_matches_metadata() {
        use crate::import::exif::extract_metadata;
        let project = TestLibraryBuilder::new()
            .add_photo(PhotoSpec {
                camera: Camera::Fuji,
                orientation: 1,
                file_type: FileType::Raw,
                capture_time: None,
                camera_params: None,
            })
            .build();
        let photo = &project.photos()[0];
        let actual = extract_metadata(&photo.path);
        assert!(
            actual.camera_model.is_some(),
            "Fuji RAW extract_metadata should return camera_model"
        );
        assert_exif_matches("builder-fuji-raw", &actual, &photo.expected);
    }

    #[test]
    fn test_builder_panasonic_raw_fixture_matches_metadata() {
        use crate::import::exif::extract_metadata;
        let project = TestLibraryBuilder::new()
            .add_photo(PhotoSpec {
                camera: Camera::Panasonic,
                orientation: 1,
                file_type: FileType::Raw,
                capture_time: None,
                camera_params: None,
            })
            .build();
        let photo = &project.photos()[0];
        let actual = extract_metadata(&photo.path);
        assert!(
            actual.camera_model.is_some(),
            "Panasonic RAW extract_metadata should return camera_model"
        );
        assert_exif_matches("builder-panasonic-raw", &actual, &photo.expected);
    }

    // -----------------------------------------------------------------------
    // B9: Mixed format batch with metadata verification
    // -----------------------------------------------------------------------

    #[test]
    fn test_builder_mixed_format_batch_metadata() {
        use crate::import::exif::extract_metadata;
        let project = TestLibraryBuilder::new()
            .add_photo(PhotoSpec {
                camera: Camera::Canon,
                orientation: 1,
                file_type: FileType::Jpeg,
                capture_time: None,
                camera_params: None,
            })
            .add_photo(PhotoSpec {
                camera: Camera::Sony,
                orientation: 6,
                file_type: FileType::Raw,
                capture_time: None,
                camera_params: None,
            })
            .add_photo(PhotoSpec {
                camera: Camera::Nikon,
                orientation: 8,
                file_type: FileType::Both,
                capture_time: None,
                camera_params: None,
            })
            .build();
        // Jpeg(1) + Raw(1) + Both(2) = 4 photos
        assert_eq!(
            project.photos().len(),
            4,
            "Mixed batch should have 4 photos"
        );
        for photo in project.photos() {
            assert!(photo.path.exists(), "Photo {:?} should exist", photo.path);
            assert!(
                photo.expected.make.is_some(),
                "Photo {:?} should have expected.make",
                photo.path
            );
            assert!(
                photo.expected.camera_model.is_some(),
                "Photo {:?} should have expected.camera_model",
                photo.path
            );
            let actual = extract_metadata(&photo.path);
            let label = format!(
                "mixed-batch-{}",
                photo.path.file_name().unwrap().to_string_lossy()
            );
            assert_exif_matches(&label, &actual, &photo.expected);
        }
    }

    // -----------------------------------------------------------------------
    // B10: FileType::Both RAW-side metadata
    // -----------------------------------------------------------------------

    #[test]
    fn test_builder_both_raw_side_matches_metadata() {
        use crate::import::exif::extract_metadata;
        let project = TestLibraryBuilder::new()
            .add_photo(PhotoSpec {
                camera: Camera::Canon,
                orientation: 1,
                file_type: FileType::Both,
                capture_time: None,
                camera_params: None,
            })
            .build();
        let raw_photo = project
            .photos()
            .iter()
            .find(|p| {
                let ext = p.path.extension().unwrap().to_string_lossy().to_lowercase();
                ext == "cr2" || ext == "arw" || ext == "nef" || ext == "raf" || ext == "rw2"
            })
            .expect("FileType::Both should include a RAW file");
        let actual = extract_metadata(&raw_photo.path);
        assert!(
            actual.camera_model.is_some(),
            "RAW side of Both should have camera_model from extract_metadata"
        );
        assert_exif_matches("builder-both-raw-side", &actual, &raw_photo.expected);
    }

    /// Helper: extract RAW file from Both pair and verify metadata round-trip.
    fn assert_both_raw_side_metadata(camera: Camera, raw_ext: &str) {
        use crate::import::exif::extract_metadata;
        let project = TestLibraryBuilder::new()
            .add_photo(PhotoSpec {
                camera,
                orientation: 1,
                file_type: FileType::Both,
                capture_time: None,
                camera_params: None,
            })
            .build();
        let raw_photo = project
            .photos()
            .iter()
            .find(|p| p.path.extension().unwrap().to_string_lossy().to_lowercase() == raw_ext)
            .unwrap_or_else(|| panic!("{:?} Both should include a .{} file", camera, raw_ext));
        let actual = extract_metadata(&raw_photo.path);
        assert!(
            actual.camera_model.is_some(),
            "{:?} Both RAW side should have camera_model",
            camera
        );
        let label = format!("both-raw-{:?}", camera);
        assert_exif_matches(&label, &actual, &raw_photo.expected);
    }

    #[test]
    fn test_builder_sony_both_raw_side_matches_metadata() {
        assert_both_raw_side_metadata(Camera::Sony, "arw");
    }

    #[test]
    fn test_builder_nikon_both_raw_side_matches_metadata() {
        assert_both_raw_side_metadata(Camera::Nikon, "nef");
    }

    #[test]
    fn test_builder_fuji_both_raw_side_matches_metadata() {
        assert_both_raw_side_metadata(Camera::Fuji, "raf");
    }

    #[test]
    fn test_builder_panasonic_both_raw_side_matches_metadata() {
        assert_both_raw_side_metadata(Camera::Panasonic, "rw2");
    }

    // -----------------------------------------------------------------------
    // BUG TEST: RAW file must have spec.orientation in its EXIF
    // When the builder creates a RAW with orientation=6, the produced file
    // must have orientation=6 in its EXIF — just like a real camera would.
    // Currently create_raw_photo copies a fixture with orientation=1 and
    // does NOT modify the EXIF, so extract_metadata returns 1 instead of 6.
    // This test should FAIL until the builder is fixed.
    // -----------------------------------------------------------------------

    #[test]
    fn test_builder_raw_orientation_in_exif_matches_spec() {
        use crate::import::exif::extract_metadata;

        // Ask builder to create Canon RAW with orientation=6
        let project = TestLibraryBuilder::new()
            .add_photo(PhotoSpec {
                camera: Camera::Canon,
                orientation: 6,
                file_type: FileType::Raw,
                capture_time: None,
                camera_params: None,
            })
            .build();
        let photo = &project.photos()[0];

        // extract_metadata must return orientation=6 (the spec value)
        // Just like a real camera would write orientation=6 to the RAW file
        let actual = extract_metadata(&photo.path);
        assert_eq!(
            actual.orientation,
            Some(6),
            "Builder RAW file should have orientation=6 in EXIF (matching spec), \
             but extract_metadata returned {:?}. The builder must produce files \
             with the requested orientation, just like real cameras do.",
            actual.orientation
        );
        // expected.orientation must also match
        assert_eq!(
            photo.expected.orientation,
            Some(6),
            "expected.orientation should match spec orientation"
        );
    }

    /// All 5 cameras: RAW with orientation=8 must have orientation=8 in EXIF.
    #[test]
    fn test_builder_all_cameras_raw_orientation_round_trip() {
        use crate::import::exif::extract_metadata;

        let cameras = [
            Camera::Canon,
            Camera::Sony,
            Camera::Nikon,
            Camera::Fuji,
            Camera::Panasonic,
        ];
        for camera in &cameras {
            let project = TestLibraryBuilder::new()
                .add_photo(PhotoSpec {
                    camera: *camera,
                    orientation: 8,
                    file_type: FileType::Raw,
                    capture_time: None,
                    camera_params: None,
                })
                .build();
            let photo = &project.photos()[0];
            let actual = extract_metadata(&photo.path);
            assert_eq!(
                actual.orientation,
                Some(8),
                "Builder {:?} RAW with spec orientation=8: extract_metadata returned {:?}, expected Some(8)",
                camera,
                actual.orientation
            );
        }
    }

    // -----------------------------------------------------------------------
    // GAP-01: Per-photo configurable capture_time
    // -----------------------------------------------------------------------

    #[test]
    fn test_photospec_capture_time_none_uses_default() {
        let project = TestLibraryBuilder::new()
            .add_photo(PhotoSpec {
                camera: Camera::Synthetic,
                orientation: 1,
                file_type: FileType::Jpeg,
                capture_time: None,
                camera_params: None,
            })
            .build();
        let photo = &project.photos()[0];
        assert_eq!(
            photo.expected.capture_time,
            Some("2024:06:15 12:00:00".to_string()),
            "PhotoSpec with capture_time: None should use default timestamp"
        );
        // Also verify the EXIF in the file matches
        let actual = crate::import::exif::extract_metadata(&photo.path);
        assert!(
            actual.capture_time.is_some(),
            "EXIF capture_time should be present"
        );
        let ct = actual.capture_time.unwrap();
        assert_eq!(
            ct.format("%Y:%m:%d %H:%M:%S").to_string(),
            "2024:06:15 12:00:00",
            "EXIF DateTimeOriginal should be the default timestamp"
        );
    }

    #[test]
    fn test_photospec_capture_time_custom_produces_exif() {
        let custom_time = "2025:01:01 09:30:00";
        let project = TestLibraryBuilder::new()
            .add_photo(PhotoSpec {
                camera: Camera::Synthetic,
                orientation: 1,
                file_type: FileType::Jpeg,
                capture_time: Some(custom_time.to_string()),
                camera_params: None,
            })
            .build();
        let photo = &project.photos()[0];
        assert_eq!(
            photo.expected.capture_time,
            Some(custom_time.to_string()),
            "PhotoSpec with custom capture_time should reflect it in expected"
        );
        // Verify the EXIF in the file matches
        let actual = crate::import::exif::extract_metadata(&photo.path);
        assert!(
            actual.capture_time.is_some(),
            "EXIF capture_time should be present for custom timestamp"
        );
        let ct = actual.capture_time.unwrap();
        assert_eq!(
            ct.format("%Y:%m:%d %H:%M:%S").to_string(),
            custom_time,
            "EXIF DateTimeOriginal should match the custom timestamp"
        );
    }

    #[test]
    fn test_photospec_capture_time_custom_late_night_utc() {
        // Use late-night UTC to verify timezone handling doesn't mangle the value
        let custom_time = "2025:03:15 23:30:00";
        let project = TestLibraryBuilder::new()
            .add_photo(PhotoSpec {
                camera: Camera::Synthetic,
                orientation: 1,
                file_type: FileType::Jpeg,
                capture_time: Some(custom_time.to_string()),
                camera_params: None,
            })
            .build();
        let photo = &project.photos()[0];
        let actual = crate::import::exif::extract_metadata(&photo.path);
        let ct = actual.capture_time.unwrap();
        assert_eq!(
            ct.format("%Y:%m:%d %H:%M:%S").to_string(),
            custom_time,
            "Late-night UTC capture_time should survive EXIF round-trip"
        );
    }

    // -----------------------------------------------------------------------
    // GAP-02: RED-phase tests for build_db_only()
    // -----------------------------------------------------------------------

    #[test]
    fn test_build_db_only_creates_project_row() {
        let project = TestLibraryBuilder::new()
            .add_photo(PhotoSpec {
                camera: Camera::Synthetic,
                orientation: 1,
                file_type: FileType::Jpeg,
                capture_time: None,
                camera_params: None,
            })
            .add_photo(PhotoSpec {
                camera: Camera::Synthetic,
                orientation: 1,
                file_type: FileType::Jpeg,
                capture_time: None,
                camera_params: None,
            })
            .add_photo(PhotoSpec {
                camera: Camera::Synthetic,
                orientation: 1,
                file_type: FileType::Jpeg,
                capture_time: None,
                camera_params: None,
            })
            .build_db_only();

        let count: i64 = project
            .conn
            .query_row("SELECT COUNT(*) FROM projects", [], |r| r.get(0))
            .unwrap();
        assert_eq!(
            count, 1,
            "build_db_only should create exactly 1 project row"
        );
    }

    #[test]
    fn test_build_db_only_creates_stack_with_all_photos() {
        let project = TestLibraryBuilder::new()
            .add_photo(PhotoSpec {
                camera: Camera::Synthetic,
                orientation: 1,
                file_type: FileType::Jpeg,
                capture_time: None,
                camera_params: None,
            })
            .add_photo(PhotoSpec {
                camera: Camera::Synthetic,
                orientation: 1,
                file_type: FileType::Jpeg,
                capture_time: None,
                camera_params: None,
            })
            .add_photo(PhotoSpec {
                camera: Camera::Synthetic,
                orientation: 1,
                file_type: FileType::Jpeg,
                capture_time: None,
                camera_params: None,
            })
            .build_db_only();

        // Exactly 1 stack
        let stack_count: i64 = project
            .conn
            .query_row("SELECT COUNT(*) FROM stacks", [], |r| r.get(0))
            .unwrap();
        assert_eq!(
            stack_count, 1,
            "build_db_only should create exactly 1 stack"
        );

        // Stack has 3 logical photos
        let lp_count: i64 = project
            .conn
            .query_row(
                "SELECT COUNT(*) FROM logical_photos WHERE stack_id = ?1",
                [project.stack_id()],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(lp_count, 3, "Stack should contain 3 logical_photos");
    }

    #[test]
    fn test_build_db_only_lp_ids_match_db() {
        let project = TestLibraryBuilder::new()
            .add_photo(PhotoSpec {
                camera: Camera::Synthetic,
                orientation: 1,
                file_type: FileType::Jpeg,
                capture_time: None,
                camera_params: None,
            })
            .add_photo(PhotoSpec {
                camera: Camera::Synthetic,
                orientation: 1,
                file_type: FileType::Jpeg,
                capture_time: None,
                camera_params: None,
            })
            .build_db_only();

        // Returned lp_ids should match what's in the DB
        let mut db_lp_ids: Vec<i64> = Vec::new();
        let mut stmt = project
            .conn
            .prepare("SELECT id FROM logical_photos ORDER BY id")
            .unwrap();
        let rows = stmt.query_map([], |r| r.get(0)).unwrap();
        for row in rows {
            db_lp_ids.push(row.unwrap());
        }

        let mut returned_ids = project.lp_ids().to_vec();
        returned_ids.sort();
        assert_eq!(
            returned_ids, db_lp_ids,
            "Returned lp_ids should match DB logical_photos"
        );
    }

    #[test]
    fn test_build_db_only_photos_have_synthetic_paths() {
        let project = TestLibraryBuilder::new()
            .add_photo(PhotoSpec {
                camera: Camera::Synthetic,
                orientation: 1,
                file_type: FileType::Jpeg,
                capture_time: None,
                camera_params: None,
            })
            .build_db_only();

        let mut stmt = project.conn.prepare("SELECT path FROM photos").unwrap();
        let paths: Vec<String> = stmt
            .query_map([], |r| r.get(0))
            .unwrap()
            .map(|r| r.unwrap())
            .collect();

        assert!(!paths.is_empty(), "Should have at least one photo row");
        for path in &paths {
            assert!(
                path.starts_with("/test/"),
                "Photo path '{}' should start with '/test/'",
                path
            );
        }
    }

    #[test]
    fn test_build_db_only_captures_time_from_spec() {
        let custom_time = "2025:12:25 23:30:00";
        let project = TestLibraryBuilder::new()
            .add_photo(PhotoSpec {
                camera: Camera::Synthetic,
                orientation: 1,
                file_type: FileType::Jpeg,
                capture_time: Some(custom_time.to_string()),
                camera_params: None,
            })
            .build_db_only();

        let db_time: String = project
            .conn
            .query_row("SELECT capture_time FROM photos LIMIT 1", [], |r| r.get(0))
            .unwrap();
        assert_eq!(
            db_time, custom_time,
            "DB capture_time should match spec capture_time"
        );
    }

    #[test]
    fn test_build_db_only_both_creates_raw_jpeg_pair() {
        let project = TestLibraryBuilder::new()
            .add_photo(PhotoSpec {
                camera: Camera::Canon,
                orientation: 1,
                file_type: FileType::Both,
                capture_time: None,
                camera_params: None,
            })
            .build_db_only();

        // FileType::Both should create 2 photo rows for 1 logical_photo
        let photo_count: i64 = project
            .conn
            .query_row("SELECT COUNT(*) FROM photos", [], |r| r.get(0))
            .unwrap();
        assert_eq!(
            photo_count, 2,
            "FileType::Both should create 2 photo rows (RAW + JPEG)"
        );

        let lp_count: i64 = project
            .conn
            .query_row("SELECT COUNT(*) FROM logical_photos", [], |r| r.get(0))
            .unwrap();
        assert_eq!(
            lp_count, 1,
            "FileType::Both should create 1 logical_photo for the pair"
        );
    }

    #[test]
    fn test_build_db_only_no_files_on_disk() {
        let project = TestLibraryBuilder::new()
            .add_photo(PhotoSpec {
                camera: Camera::Synthetic,
                orientation: 1,
                file_type: FileType::Jpeg,
                capture_time: None,
                camera_params: None,
            })
            .add_photo(PhotoSpec {
                camera: Camera::Canon,
                orientation: 6,
                file_type: FileType::Both,
                capture_time: None,
                camera_params: None,
            })
            .build_db_only();

        // The source dir should either not exist or be empty
        let source = project.source_dir();
        if source.exists() {
            let entries: Vec<_> = std::fs::read_dir(&source).unwrap().collect();
            assert_eq!(
                entries.len(),
                0,
                "build_db_only should not create any files on disk"
            );
        }
        // If source dir doesn't exist at all, that's also fine
    }

    // -----------------------------------------------------------------------
    // GAP-03: Stack layout control in TestLibraryBuilder
    // -----------------------------------------------------------------------

    #[test]
    fn test_with_stack_layout_creates_correct_stack_count() {
        let project = TestLibraryBuilder::new()
            .with_stack_layout(&[3, 2])
            .build_db_only();

        assert_eq!(
            project.stack_ids.len(),
            2,
            "with_stack_layout(&[3, 2]) should create 2 stacks"
        );
    }

    #[test]
    fn test_with_stack_layout_distributes_lps_per_stack() {
        let project = TestLibraryBuilder::new()
            .with_stack_layout(&[3, 2])
            .build_db_only();

        assert_eq!(
            project.stacks_with_lps.len(),
            2,
            "stacks_with_lps should have 2 entries"
        );
        assert_eq!(
            project.stacks_with_lps[0].1.len(),
            3,
            "first stack should have 3 logical photos"
        );
        assert_eq!(
            project.stacks_with_lps[1].1.len(),
            2,
            "second stack should have 2 logical photos"
        );
    }

    #[test]
    fn test_with_stack_layout_total_lps() {
        let project = TestLibraryBuilder::new()
            .with_stack_layout(&[3, 2])
            .build_db_only();

        assert_eq!(
            project.lp_ids.len(),
            5,
            "total logical photos should be sum of layout (3+2=5)"
        );
    }

    #[test]
    fn test_with_layout_validates_spec_count() {
        // Add 5 photos manually, then apply layout [3, 2]
        let project = TestLibraryBuilder::new()
            .add_photo(PhotoSpec {
                camera: Camera::Canon,
                orientation: 1,
                file_type: FileType::Jpeg,
                capture_time: None,
                camera_params: None,
            })
            .add_photo(PhotoSpec {
                camera: Camera::Canon,
                orientation: 1,
                file_type: FileType::Jpeg,
                capture_time: None,
                camera_params: None,
            })
            .add_photo(PhotoSpec {
                camera: Camera::Canon,
                orientation: 1,
                file_type: FileType::Jpeg,
                capture_time: None,
                camera_params: None,
            })
            .add_photo(PhotoSpec {
                camera: Camera::Sony,
                orientation: 1,
                file_type: FileType::Jpeg,
                capture_time: None,
                camera_params: None,
            })
            .add_photo(PhotoSpec {
                camera: Camera::Sony,
                orientation: 1,
                file_type: FileType::Jpeg,
                capture_time: None,
                camera_params: None,
            })
            .with_layout(&[3, 2])
            .build_db_only();

        // Should have 5 total lp_ids (validation happens at build time, not at with_layout)
        assert_eq!(project.lp_ids.len(), 5);
    }

    #[test]
    fn test_with_layout_custom_specs_partitioned() {
        // 3 Canon + 2 Sony, partitioned into [3, 2]
        let project = TestLibraryBuilder::new()
            .add_photo(PhotoSpec {
                camera: Camera::Canon,
                orientation: 1,
                file_type: FileType::Jpeg,
                capture_time: None,
                camera_params: None,
            })
            .add_photo(PhotoSpec {
                camera: Camera::Canon,
                orientation: 1,
                file_type: FileType::Jpeg,
                capture_time: None,
                camera_params: None,
            })
            .add_photo(PhotoSpec {
                camera: Camera::Canon,
                orientation: 1,
                file_type: FileType::Jpeg,
                capture_time: None,
                camera_params: None,
            })
            .add_photo(PhotoSpec {
                camera: Camera::Sony,
                orientation: 1,
                file_type: FileType::Jpeg,
                capture_time: None,
                camera_params: None,
            })
            .add_photo(PhotoSpec {
                camera: Camera::Sony,
                orientation: 1,
                file_type: FileType::Jpeg,
                capture_time: None,
                camera_params: None,
            })
            .with_layout(&[3, 2])
            .build_db_only();

        assert_eq!(
            project.stacks_with_lps.len(),
            2,
            "should have 2 stacks from layout [3, 2]"
        );
        assert_eq!(
            project.stacks_with_lps[0].1.len(),
            3,
            "first stack should have 3 lps (Canon photos)"
        );
        assert_eq!(
            project.stacks_with_lps[1].1.len(),
            2,
            "second stack should have 2 lps (Sony photos)"
        );
    }

    #[test]
    fn test_stacks_with_lps_matches_flat_ids() {
        let project = TestLibraryBuilder::new()
            .with_stack_layout(&[3, 2])
            .build_db_only();

        // Flatten stacks_with_lps lp vecs and compare to lp_ids
        let flat_from_stacks: Vec<i64> = project
            .stacks_with_lps
            .iter()
            .flat_map(|(_, lps)| lps.iter().copied())
            .collect();

        assert_eq!(
            flat_from_stacks, project.lp_ids,
            "flat lp_ids from stacks_with_lps should match lp_ids"
        );
    }

    // ── GAP-03: Burst timestamp tests ─────────────────────────────────────

    #[test]
    fn test_with_stack_layout_generates_timestamps_within_stack() {
        // WHY: Photos in the same stack should have tight timestamps (1 second apart)
        // so burst-grouping logic treats them as one burst.
        let project = TestLibraryBuilder::new()
            .with_stack_layout(&[3])
            .build_db_only();

        let times: Vec<String> = project
            .lp_ids
            .iter()
            .map(|lp_id| {
                project
                    .conn
                    .query_row(
                        "SELECT p.capture_time FROM photos p
                         JOIN logical_photos lp ON lp.representative_photo_id = p.id
                         WHERE lp.id = ?1",
                        rusqlite::params![lp_id],
                        |row| row.get::<_, String>(0),
                    )
                    .unwrap()
            })
            .collect();

        assert_eq!(times.len(), 3);
        // Parse and check 1-second gaps within the stack
        let parsed: Vec<chrono::NaiveDateTime> = times
            .iter()
            .map(|t| {
                chrono::NaiveDateTime::parse_from_str(t, "%Y:%m:%d %H:%M:%S")
                    .unwrap_or_else(|e| panic!("Failed to parse '{}': {}", t, e))
            })
            .collect();
        assert_eq!(
            (parsed[1] - parsed[0]).num_seconds(),
            1,
            "photos within stack should be 1 second apart"
        );
        assert_eq!(
            (parsed[2] - parsed[1]).num_seconds(),
            1,
            "photos within stack should be 1 second apart"
        );
    }

    #[test]
    fn test_with_stack_layout_generates_gap_between_stacks() {
        // WHY: First photo of stack 2 should be 60+ seconds after last photo of stack 1,
        // ensuring burst-grouping logic places them in separate stacks.
        let project = TestLibraryBuilder::new()
            .with_stack_layout(&[2, 2])
            .build_db_only();

        let times: Vec<String> = project
            .lp_ids
            .iter()
            .map(|lp_id| {
                project
                    .conn
                    .query_row(
                        "SELECT p.capture_time FROM photos p
                         JOIN logical_photos lp ON lp.representative_photo_id = p.id
                         WHERE lp.id = ?1",
                        rusqlite::params![lp_id],
                        |row| row.get::<_, String>(0),
                    )
                    .unwrap()
            })
            .collect();

        assert_eq!(times.len(), 4);
        let parsed: Vec<chrono::NaiveDateTime> = times
            .iter()
            .map(|t| {
                chrono::NaiveDateTime::parse_from_str(t, "%Y:%m:%d %H:%M:%S")
                    .unwrap_or_else(|e| panic!("Failed to parse '{}': {}", t, e))
            })
            .collect();

        // Within stack 1: 1 second apart
        assert_eq!((parsed[1] - parsed[0]).num_seconds(), 1);
        // Between stack 1 last and stack 2 first: >= 60 seconds
        let gap = (parsed[2] - parsed[1]).num_seconds();
        assert_eq!(gap, 60, "gap between stacks should be 60 seconds (default)");
        // Within stack 2: 1 second apart
        assert_eq!((parsed[3] - parsed[2]).num_seconds(), 1);
    }

    #[test]
    fn test_with_burst_gap_custom_gap() {
        // WHY: with_burst_gap(10) should produce a 10-second gap between stacks
        // instead of the default 60.
        let project = TestLibraryBuilder::new()
            .with_stack_layout(&[2, 2])
            .with_burst_gap(10)
            .build_db_only();

        let times: Vec<String> = project
            .lp_ids
            .iter()
            .map(|lp_id| {
                project
                    .conn
                    .query_row(
                        "SELECT p.capture_time FROM photos p
                         JOIN logical_photos lp ON lp.representative_photo_id = p.id
                         WHERE lp.id = ?1",
                        rusqlite::params![lp_id],
                        |row| row.get::<_, String>(0),
                    )
                    .unwrap()
            })
            .collect();

        let parsed: Vec<chrono::NaiveDateTime> = times
            .iter()
            .map(|t| {
                chrono::NaiveDateTime::parse_from_str(t, "%Y:%m:%d %H:%M:%S")
                    .unwrap_or_else(|e| panic!("Failed to parse '{}': {}", t, e))
            })
            .collect();

        // Between stack 1 last and stack 2 first: exactly 10 seconds
        let gap = (parsed[2] - parsed[1]).num_seconds();
        assert_eq!(gap, 10, "gap between stacks should be 10 seconds (custom)");
    }

    // ── GAP-04: Camera parameter support in PhotoSpec ────────────────────

    #[test]
    fn test_camera_params_default_all_none() {
        // WHY: CameraParams::default() must produce all-None fields so partial
        // initialization with struct update syntax works: CameraParams { iso: Some(100), ..Default::default() }
        let params = CameraParams::default();
        assert_eq!(params.aperture, None);
        assert_eq!(params.shutter_speed, None);
        assert_eq!(params.iso, None);
        assert_eq!(params.focal_length, None);
        assert_eq!(params.exposure_comp, None);
        assert_eq!(params.lens, None);
    }

    #[test]
    fn test_photo_spec_camera_params_none_by_default() {
        // WHY: Existing code passes camera_params: None. Verify that None means
        // no camera params in DB (all columns NULL).
        let project = TestLibraryBuilder::new()
            .add_photo(PhotoSpec {
                camera: Camera::Canon,
                orientation: 1,
                file_type: FileType::Jpeg,
                capture_time: None,
                camera_params: None,
            })
            .build_db_only();

        // All camera param columns should be NULL
        let row: (Option<f64>, Option<String>, Option<u32>, Option<f64>, Option<f64>, Option<String>) = project
            .conn
            .query_row(
                "SELECT aperture, shutter_speed, iso, focal_length, exposure_comp, lens FROM photos WHERE id = (SELECT representative_photo_id FROM logical_photos WHERE id = ?1)",
                rusqlite::params![project.lp_ids[0]],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?, row.get(5)?)),
            )
            .unwrap();
        assert_eq!(
            row,
            (None, None, None, None, None, None),
            "camera_params: None should produce all NULL columns"
        );
    }

    #[test]
    fn test_photo_spec_camera_params_full() {
        // WHY: When camera_params is set with all fields, those values must appear
        // in the DB photos row via build_db_only().
        let project = TestLibraryBuilder::new()
            .add_photo(PhotoSpec {
                camera: Camera::Canon,
                orientation: 1,
                file_type: FileType::Jpeg,
                capture_time: None,
                camera_params: Some(CameraParams {
                    aperture: Some(2.8),
                    shutter_speed: Some("1/250".to_string()),
                    iso: Some(400),
                    focal_length: Some(50.0),
                    exposure_comp: Some(-0.3),
                    lens: Some("EF 50mm f/1.4 USM".to_string()),
                }),
            })
            .build_db_only();

        let (aperture, shutter, iso, focal, exp_comp, lens): (Option<f64>, Option<String>, Option<u32>, Option<f64>, Option<f64>, Option<String>) = project
            .conn
            .query_row(
                "SELECT aperture, shutter_speed, iso, focal_length, exposure_comp, lens FROM photos WHERE id = (SELECT representative_photo_id FROM logical_photos WHERE id = ?1)",
                rusqlite::params![project.lp_ids[0]],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?, row.get(5)?)),
            )
            .unwrap();

        assert_eq!(aperture, Some(2.8));
        assert_eq!(shutter, Some("1/250".to_string()));
        assert_eq!(iso, Some(400));
        assert_eq!(focal, Some(50.0));
        assert_eq!(exp_comp, Some(-0.3));
        assert_eq!(lens, Some("EF 50mm f/1.4 USM".to_string()));
    }

    #[test]
    fn test_photo_spec_camera_params_partial() {
        // WHY: CameraParams with only some fields set should write those fields
        // and leave the rest NULL.
        let project = TestLibraryBuilder::new()
            .add_photo(PhotoSpec {
                camera: Camera::Sony,
                orientation: 1,
                file_type: FileType::Jpeg,
                capture_time: None,
                camera_params: Some(CameraParams {
                    iso: Some(100),
                    aperture: Some(5.6),
                    ..CameraParams::default()
                }),
            })
            .build_db_only();

        let (aperture, shutter, iso, focal, exp_comp, lens): (Option<f64>, Option<String>, Option<u32>, Option<f64>, Option<f64>, Option<String>) = project
            .conn
            .query_row(
                "SELECT aperture, shutter_speed, iso, focal_length, exposure_comp, lens FROM photos WHERE id = (SELECT representative_photo_id FROM logical_photos WHERE id = ?1)",
                rusqlite::params![project.lp_ids[0]],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?, row.get(5)?)),
            )
            .unwrap();

        assert_eq!(aperture, Some(5.6));
        assert_eq!(shutter, None);
        assert_eq!(iso, Some(100));
        assert_eq!(focal, None);
        assert_eq!(exp_comp, None);
        assert_eq!(lens, None);
    }

    #[test]
    fn test_camera_params_camera_model_from_camera_enum() {
        // WHY: camera_model in DB should come from Camera enum, not from CameraParams.
        // Verify that setting camera_params doesn't affect camera_model derivation.
        let project = TestLibraryBuilder::new()
            .add_photo(PhotoSpec {
                camera: Camera::Sony,
                orientation: 1,
                file_type: FileType::Jpeg,
                capture_time: None,
                camera_params: Some(CameraParams {
                    iso: Some(200),
                    ..CameraParams::default()
                }),
            })
            .build_db_only();

        let camera_model: Option<String> = project
            .conn
            .query_row(
                "SELECT camera_model FROM photos WHERE id = (SELECT representative_photo_id FROM logical_photos WHERE id = ?1)",
                rusqlite::params![project.lp_ids[0]],
                |row| row.get(0),
            )
            .unwrap();

        assert!(
            camera_model
                .as_ref()
                .unwrap()
                .to_lowercase()
                .contains("sony"),
            "camera_model should derive from Camera::Sony, got {:?}",
            camera_model,
        );
    }

    #[test]
    fn test_build_db_only_timestamps_in_correct_format() {
        // WHY: EXIF timestamps use "YYYY:MM:DD HH:MM:SS" format.
        // Verify all generated timestamps parse with that exact format
        // and round-trip back to the same string.
        let project = TestLibraryBuilder::new()
            .with_stack_layout(&[2, 3])
            .build_db_only();

        for lp_id in &project.lp_ids {
            let time: String = project
                .conn
                .query_row(
                    "SELECT p.capture_time FROM photos p
                     JOIN logical_photos lp ON lp.representative_photo_id = p.id
                     WHERE lp.id = ?1",
                    rusqlite::params![lp_id],
                    |row| row.get::<_, String>(0),
                )
                .unwrap();
            // Must parse as "YYYY:MM:DD HH:MM:SS"
            let parsed = chrono::NaiveDateTime::parse_from_str(&time, "%Y:%m:%d %H:%M:%S")
                .unwrap_or_else(|e| {
                    panic!(
                        "timestamp '{}' does not match YYYY:MM:DD HH:MM:SS format: {}",
                        time, e
                    )
                });
            // Round-trip: formatting back should produce the original string
            let roundtrip = parsed.format("%Y:%m:%d %H:%M:%S").to_string();
            assert_eq!(
                time, roundtrip,
                "timestamp should round-trip through EXIF format"
            );
        }
    }

    // ── Phase 1 coverage gap tests ──────────────────────────────────────

    #[test]
    fn test_build_db_only_filetype_both_creates_two_photos_one_lp() {
        // WHY: FileType::Both in build_db_only() should create 2 photo rows
        // (JPEG + RAW) but only 1 logical_photo. This branch was uncovered.
        let project = TestLibraryBuilder::new()
            .add_photo(PhotoSpec {
                camera: Camera::Canon,
                orientation: 1,
                file_type: FileType::Both,
                capture_time: None,
                camera_params: None,
            })
            .build_db_only();

        assert_eq!(
            project.lp_ids.len(),
            1,
            "FileType::Both should create 1 logical_photo"
        );

        let photo_count: i64 = project
            .conn
            .query_row("SELECT COUNT(*) FROM photos", [], |r| r.get(0))
            .unwrap();
        assert_eq!(
            photo_count, 2,
            "FileType::Both should create 2 photo rows (JPEG + RAW)"
        );

        // Both photos should reference the same logical_photo
        let lp_count: i64 = project
            .conn
            .query_row(
                "SELECT COUNT(*) FROM photos WHERE logical_photo_id = ?1",
                rusqlite::params![project.lp_ids[0]],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(
            lp_count, 2,
            "Both photos should reference the same logical_photo"
        );
    }

    #[test]
    fn test_cache_dir_exists() {
        // WHY: cache_dir() was uncovered. Verify it returns a valid path.
        let project = TestLibraryBuilder::new()
            .add_photo(PhotoSpec {
                camera: Camera::Synthetic,
                orientation: 1,
                file_type: FileType::Jpeg,
                capture_time: None,
                camera_params: None,
            })
            .build();
        let cache = project.cache_dir();
        assert!(cache.exists(), "cache_dir should exist after build()");
        assert!(
            cache.to_str().unwrap().contains("thumbnails"),
            "cache_dir should be under thumbnails/"
        );
    }

    // ── GAP-05: Multi-project support (with_project_name) ─────────────────

    #[test]
    fn test_with_project_name_db_only_custom_slug() {
        // WHY: with_project_name("alpha") should produce project slug "alpha"
        // instead of default "test-builder".
        let project = TestLibraryBuilder::new()
            .with_project_name("alpha")
            .add_photo(PhotoSpec {
                camera: Camera::Synthetic,
                orientation: 1,
                file_type: FileType::Jpeg,
                capture_time: None,
                camera_params: None,
            })
            .build_db_only();

        assert_eq!(project.slug, "alpha");
        let db_name: String = project
            .conn
            .query_row(
                "SELECT name FROM projects WHERE slug = ?1",
                rusqlite::params!["alpha"],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(db_name, "alpha");
    }

    #[test]
    fn test_with_project_name_build_custom_slug() {
        // WHY: with_project_name should also work for file-based build().
        let project = TestLibraryBuilder::new()
            .with_project_name("beta")
            .add_photo(PhotoSpec {
                camera: Camera::Synthetic,
                orientation: 1,
                file_type: FileType::Jpeg,
                capture_time: None,
                camera_params: None,
            })
            .build();

        assert_eq!(project.slug, "beta");
        let db_slug: String = project
            .conn
            .query_row(
                "SELECT slug FROM projects WHERE id = ?1",
                [project.project_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(db_slug, "beta");
    }

    #[test]
    fn test_default_project_name_unchanged() {
        // WHY: Without with_project_name(), slug must remain "test-builder"
        // to preserve backward compatibility.
        let project = TestLibraryBuilder::new()
            .add_photo(PhotoSpec {
                camera: Camera::Synthetic,
                orientation: 1,
                file_type: FileType::Jpeg,
                capture_time: None,
                camera_params: None,
            })
            .build_db_only();

        assert_eq!(project.slug, "test-builder");
    }

    #[test]
    fn test_two_builders_different_names_isolated() {
        // WHY: Two builders with different project names create fully isolated
        // test projects — separate TempDirs, separate DBs, separate project IDs.
        // This is the pattern for multi-project boundary testing.
        let project_a = TestLibraryBuilder::new()
            .with_project_name("venice")
            .add_photo(PhotoSpec {
                camera: Camera::Canon,
                orientation: 1,
                file_type: FileType::Jpeg,
                capture_time: None,
                camera_params: None,
            })
            .build_db_only();

        let project_b = TestLibraryBuilder::new()
            .with_project_name("tokyo")
            .add_photo(PhotoSpec {
                camera: Camera::Sony,
                orientation: 1,
                file_type: FileType::Jpeg,
                capture_time: None,
                camera_params: None,
            })
            .build_db_only();

        assert_eq!(project_a.slug, "venice");
        assert_eq!(project_b.slug, "tokyo");
        // Different DBs — each has exactly 1 project
        let count_a: i64 = project_a
            .conn
            .query_row("SELECT COUNT(*) FROM projects", [], |r| r.get(0))
            .unwrap();
        let count_b: i64 = project_b
            .conn
            .query_row("SELECT COUNT(*) FROM projects", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count_a, 1);
        assert_eq!(count_b, 1);
    }
}
