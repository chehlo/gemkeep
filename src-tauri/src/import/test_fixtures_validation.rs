/// Thorough validation tests for TestLibraryBuilder.
///
/// These tests are `#[ignore]` — they are expensive (real RAW fixtures, all cameras)
/// and should only run when test_fixtures.rs is modified.
///
/// Run with: cargo test --manifest-path src-tauri/Cargo.toml -- --ignored test_fixtures_validation
///
/// Coverage scope:
/// - capture_time across all cameras × all formats (JPEG, RAW, Both)
/// - camera_params in build_db_only() across all cameras
/// - Orientation × camera × format matrix
/// - Parameter interaction: capture_time + camera_params + orientation together
///
/// Known limitations (documented and tested):
/// - camera_params are NOT written to EXIF in build() (disk files) — DB-only feature.
///   Reason: build_jpeg_with_exif() only writes Make, Model, Orientation, DateTimeOriginal.
///   This is intentional — camera_params exist for DB-level testing of culling/filtering.
/// - capture_time patching for RAW uses rexiv2; Fuji RAF and Panasonic RW2 CANNOT be
///   patched because rexiv2/libexiv2 cannot write these formats. Custom capture_time is
///   silently skipped for RAF/RW2 — the fixture's original capture_time is preserved.
///   Tests document this: test_capture_time_raf_rw2_ignores_custom.

#[cfg(test)]
mod tests {
    use crate::import::exif::extract_metadata;
    use crate::import::test_fixtures::{
        Camera, CameraParams, FileType, PhotoSpec, TestLibraryBuilder,
    };

    // ── Helpers ──────────────────────────────────────────────────────────────

    const ALL_CAMERAS: [Camera; 5] = [
        Camera::Canon,
        Camera::Sony,
        Camera::Nikon,
        Camera::Fuji,
        Camera::Panasonic,
    ];

    /// Cameras whose RAW files can have capture_time patched via rexiv2.
    const PATCHABLE_RAW_CAMERAS: [Camera; 3] = [Camera::Canon, Camera::Sony, Camera::Nikon];

    /// Cameras whose RAW files cannot have capture_time patched (rexiv2 limitation).
    const UNPATCHABLE_RAW_CAMERAS: [Camera; 2] = [Camera::Fuji, Camera::Panasonic];

    const ALL_FILE_TYPES: [FileType; 3] = [FileType::Jpeg, FileType::Raw, FileType::Both];

    const REPRESENTATIVE_ORIENTATIONS: [u16; 4] = [1, 3, 6, 8];

    const CUSTOM_TIME: &str = "2025:07:04 23:45:00";
    const DEFAULT_TIME: &str = "2024:06:15 12:00:00";

    // ── Parameterized test infrastructure ────────────────────────────────────

    /// Run an assertion for every camera × file_type combination.
    /// The closure receives (camera, file_type) and should panic on failure.
    fn for_each_camera_format(f: impl Fn(Camera, FileType)) {
        for camera in ALL_CAMERAS {
            for file_type in ALL_FILE_TYPES {
                f(camera, file_type);
            }
        }
    }

    /// Run an assertion for every camera × orientation combination (JPEG only).
    fn for_each_camera_orientation(f: impl Fn(Camera, u16)) {
        for camera in ALL_CAMERAS {
            for &orientation in &REPRESENTATIVE_ORIENTATIONS {
                f(camera, orientation);
            }
        }
    }

    // ── capture_time × camera × JPEG ─────────────────────────────────────────

    /// All 5 cameras produce JPEG files with correct custom capture_time in EXIF.
    #[test]
    #[ignore]
    fn test_capture_time_all_cameras_jpeg_custom() {
        for camera in &ALL_CAMERAS {
            let project = TestLibraryBuilder::new()
                .add_photo(PhotoSpec {
                    camera: *camera,
                    orientation: 1,
                    file_type: FileType::Jpeg,
                    capture_time: Some(CUSTOM_TIME.to_string()),
                    camera_params: None,
                })
                .build();
            let photo = &project.photos()[0];
            let actual = extract_metadata(&photo.path);
            let ct = actual
                .capture_time
                .unwrap_or_else(|| panic!("{:?} JPEG: capture_time missing in EXIF", camera));
            assert_eq!(
                ct.format("%Y:%m:%d %H:%M:%S").to_string(),
                CUSTOM_TIME,
                "{:?} JPEG: custom capture_time must round-trip through EXIF",
                camera
            );
        }
    }

    /// All 5 cameras produce JPEG files with default capture_time when None.
    #[test]
    #[ignore]
    fn test_capture_time_all_cameras_jpeg_default() {
        for camera in &ALL_CAMERAS {
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
            let actual = extract_metadata(&photo.path);
            let ct = actual
                .capture_time
                .unwrap_or_else(|| panic!("{:?} JPEG: capture_time missing in EXIF", camera));
            assert_eq!(
                ct.format("%Y:%m:%d %H:%M:%S").to_string(),
                DEFAULT_TIME,
                "{:?} JPEG: default capture_time must be {}",
                camera,
                DEFAULT_TIME
            );
        }
    }

    // ── capture_time × camera × RAW (patchable formats only) ─────────────────

    /// Canon/Sony/Nikon RAW files with custom capture_time have it in EXIF.
    #[test]
    #[ignore]
    fn test_capture_time_patchable_raw_cameras_custom() {
        for camera in &PATCHABLE_RAW_CAMERAS {
            let project = TestLibraryBuilder::new()
                .add_photo(PhotoSpec {
                    camera: *camera,
                    orientation: 1,
                    file_type: FileType::Raw,
                    capture_time: Some(CUSTOM_TIME.to_string()),
                    camera_params: None,
                })
                .build();
            let photo = &project.photos()[0];
            let actual = extract_metadata(&photo.path);
            let ct = actual
                .capture_time
                .unwrap_or_else(|| panic!("{:?} RAW: capture_time missing in EXIF", camera));
            assert_eq!(
                ct.format("%Y:%m:%d %H:%M:%S").to_string(),
                CUSTOM_TIME,
                "{:?} RAW: custom capture_time must be patched into EXIF",
                camera
            );
        }
    }

    /// Canon/Sony/Nikon RAW files without custom capture_time keep fixture's original.
    #[test]
    #[ignore]
    fn test_capture_time_patchable_raw_cameras_default_uses_fixture() {
        for camera in &PATCHABLE_RAW_CAMERAS {
            let project = TestLibraryBuilder::new()
                .add_photo(PhotoSpec {
                    camera: *camera,
                    orientation: 1,
                    file_type: FileType::Raw,
                    capture_time: None,
                    camera_params: None,
                })
                .build();
            let photo = &project.photos()[0];
            // Expected capture_time comes from the fixture, not DEFAULT_TIME
            assert!(
                photo.expected.capture_time.is_some(),
                "{:?} RAW: expected capture_time must be present (from fixture)",
                camera
            );
            let actual = extract_metadata(&photo.path);
            assert!(
                actual.capture_time.is_some(),
                "{:?} RAW: EXIF capture_time must be present",
                camera
            );
        }
    }

    // ── capture_time × camera × Both ─────────────────────────────────────────

    /// FileType::Both with custom capture_time: JPEG side has it in EXIF.
    #[test]
    #[ignore]
    fn test_capture_time_both_jpeg_side_custom() {
        for camera in &ALL_CAMERAS {
            let project = TestLibraryBuilder::new()
                .add_photo(PhotoSpec {
                    camera: *camera,
                    orientation: 1,
                    file_type: FileType::Both,
                    capture_time: Some(CUSTOM_TIME.to_string()),
                    camera_params: None,
                })
                .build();
            // Find the JPEG photo (first one for Both)
            let jpeg_photo = project
                .photos()
                .iter()
                .find(|p| {
                    p.path
                        .extension()
                        .map(|e| e.to_str().unwrap().to_lowercase())
                        == Some("jpg".to_string())
                })
                .unwrap_or_else(|| panic!("{:?} Both: no JPEG photo found", camera));
            let actual = extract_metadata(&jpeg_photo.path);
            let ct = actual
                .capture_time
                .unwrap_or_else(|| panic!("{:?} Both/JPEG: capture_time missing in EXIF", camera));
            assert_eq!(
                ct.format("%Y:%m:%d %H:%M:%S").to_string(),
                CUSTOM_TIME,
                "{:?} Both/JPEG: custom capture_time must round-trip",
                camera
            );
        }
    }

    // ── camera_params × build_db_only() ──────────────────────────────────────

    /// All 5 cameras with full camera_params in build_db_only() write to DB.
    #[test]
    #[ignore]
    fn test_camera_params_all_cameras_db_only() {
        let full_params = CameraParams {
            aperture: Some(2.8),
            shutter_speed: Some("1/500".to_string()),
            iso: Some(200),
            focal_length: Some(50.0),
            exposure_comp: Some(-1.0),
            lens: Some("Test Lens 50mm".to_string()),
        };

        for camera in &ALL_CAMERAS {
            let project = TestLibraryBuilder::new()
                .add_photo(PhotoSpec {
                    camera: *camera,
                    orientation: 1,
                    file_type: FileType::Jpeg,
                    capture_time: None,
                    camera_params: Some(full_params.clone()),
                })
                .build_db_only();

            let row: (
                Option<f64>,
                Option<String>,
                Option<u32>,
                Option<f64>,
                Option<f64>,
                Option<String>,
            ) = project
                .conn
                .query_row(
                    "SELECT aperture, shutter_speed, iso, focal_length, exposure_comp, lens FROM photos LIMIT 1",
                    [],
                    |r| {
                        Ok((
                            r.get(0).unwrap(),
                            r.get(1).unwrap(),
                            r.get(2).unwrap(),
                            r.get(3).unwrap(),
                            r.get(4).unwrap(),
                            r.get(5).unwrap(),
                        ))
                    },
                )
                .unwrap();

            assert_eq!(row.0, Some(2.8), "{:?}: aperture must be 2.8 in DB", camera);
            assert_eq!(
                row.1,
                Some("1/500".to_string()),
                "{:?}: shutter_speed must be 1/500",
                camera
            );
            assert_eq!(row.2, Some(200), "{:?}: iso must be 200", camera);
            assert_eq!(row.3, Some(50.0), "{:?}: focal_length must be 50.0", camera);
            assert_eq!(
                row.4,
                Some(-1.0),
                "{:?}: exposure_comp must be -1.0",
                camera
            );
            assert_eq!(
                row.5,
                Some("Test Lens 50mm".to_string()),
                "{:?}: lens must match",
                camera
            );
        }
    }

    /// camera_params: None produces NULL columns for all 5 cameras.
    #[test]
    #[ignore]
    fn test_camera_params_none_all_cameras_db_only() {
        for camera in &ALL_CAMERAS {
            let project = TestLibraryBuilder::new()
                .add_photo(PhotoSpec {
                    camera: *camera,
                    orientation: 1,
                    file_type: FileType::Jpeg,
                    capture_time: None,
                    camera_params: None,
                })
                .build_db_only();

            let nulls: i64 = project
                .conn
                .query_row(
                    "SELECT (CASE WHEN aperture IS NULL THEN 1 ELSE 0 END) +
                            (CASE WHEN shutter_speed IS NULL THEN 1 ELSE 0 END) +
                            (CASE WHEN iso IS NULL THEN 1 ELSE 0 END) +
                            (CASE WHEN focal_length IS NULL THEN 1 ELSE 0 END) +
                            (CASE WHEN exposure_comp IS NULL THEN 1 ELSE 0 END) +
                            (CASE WHEN lens IS NULL THEN 1 ELSE 0 END)
                     FROM photos LIMIT 1",
                    [],
                    |r| r.get(0),
                )
                .unwrap();
            assert_eq!(
                nulls, 6,
                "{:?}: all 6 camera_params columns must be NULL when None",
                camera
            );
        }
    }

    // ── camera_params × file_type ────────────────────────────────────────────

    /// RAW and Both file types in build_db_only() also write camera_params.
    #[test]
    #[ignore]
    fn test_camera_params_raw_and_both_db_only() {
        let params = CameraParams {
            aperture: Some(5.6),
            iso: Some(800),
            ..Default::default()
        };

        // RAW
        let project = TestLibraryBuilder::new()
            .add_photo(PhotoSpec {
                camera: Camera::Canon,
                orientation: 1,
                file_type: FileType::Raw,
                capture_time: None,
                camera_params: Some(params.clone()),
            })
            .build_db_only();

        let aperture: Option<f64> = project
            .conn
            .query_row("SELECT aperture FROM photos LIMIT 1", [], |r| r.get(0))
            .unwrap();
        assert_eq!(aperture, Some(5.6), "RAW: aperture must be in DB");

        // Both — should be on BOTH photo rows
        let project = TestLibraryBuilder::new()
            .add_photo(PhotoSpec {
                camera: Camera::Sony,
                orientation: 1,
                file_type: FileType::Both,
                capture_time: None,
                camera_params: Some(params.clone()),
            })
            .build_db_only();

        let count: i64 = project
            .conn
            .query_row(
                "SELECT COUNT(*) FROM photos WHERE aperture = 5.6",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(
            count, 2,
            "Both: aperture must be on BOTH photo rows (JPEG + RAW)"
        );
    }

    // ── Orientation × camera × format matrix ─────────────────────────────────

    /// All cameras produce JPEG files with correct orientation in EXIF.
    #[test]
    #[ignore]
    fn test_orientation_all_cameras_jpeg() {
        for camera in &ALL_CAMERAS {
            for orientation in [1u16, 3, 6, 8] {
                let project = TestLibraryBuilder::new()
                    .add_photo(PhotoSpec {
                        camera: *camera,
                        orientation,
                        file_type: FileType::Jpeg,
                        capture_time: None,
                        camera_params: None,
                    })
                    .build();
                let photo = &project.photos()[0];
                let actual = extract_metadata(&photo.path);
                assert_eq!(
                    actual.orientation,
                    Some(orientation),
                    "{:?} JPEG orientation={}: EXIF mismatch",
                    camera,
                    orientation
                );
            }
        }
    }

    /// Patchable RAW cameras produce files with correct orientation in EXIF.
    #[test]
    #[ignore]
    fn test_orientation_patchable_raw_cameras() {
        for camera in &PATCHABLE_RAW_CAMERAS {
            for orientation in [1u16, 3, 6, 8] {
                let project = TestLibraryBuilder::new()
                    .add_photo(PhotoSpec {
                        camera: *camera,
                        orientation,
                        file_type: FileType::Raw,
                        capture_time: None,
                        camera_params: None,
                    })
                    .build();
                let photo = &project.photos()[0];
                let actual = extract_metadata(&photo.path);
                assert_eq!(
                    actual.orientation,
                    Some(orientation),
                    "{:?} RAW orientation={}: EXIF mismatch",
                    camera,
                    orientation
                );
            }
        }
    }

    // ── Combined parameter interaction ───────────────────────────────────────

    /// All parameters together: custom capture_time + camera_params + orientation in db_only.
    #[test]
    #[ignore]
    fn test_all_params_combined_db_only() {
        let params = CameraParams {
            aperture: Some(1.4),
            shutter_speed: Some("1/8000".to_string()),
            iso: Some(100),
            focal_length: Some(35.0),
            exposure_comp: Some(0.7),
            lens: Some("Sigma 35mm F1.4 Art".to_string()),
        };

        for camera in &ALL_CAMERAS {
            let project = TestLibraryBuilder::new()
                .add_photo(PhotoSpec {
                    camera: *camera,
                    orientation: 6,
                    file_type: FileType::Jpeg,
                    capture_time: Some(CUSTOM_TIME.to_string()),
                    camera_params: Some(params.clone()),
                })
                .build_db_only();

            // Verify all columns in one query
            let (ct, orient, ap, iso, lens): (String, u16, f64, u32, String) = project
                .conn
                .query_row(
                    "SELECT capture_time, orientation, aperture, iso, lens FROM photos LIMIT 1",
                    [],
                    |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
                )
                .unwrap();

            assert_eq!(ct, CUSTOM_TIME, "{:?}: capture_time mismatch", camera);
            assert_eq!(orient, 6, "{:?}: orientation mismatch", camera);
            assert_eq!(ap, 1.4, "{:?}: aperture mismatch", camera);
            assert_eq!(iso, 100, "{:?}: iso mismatch", camera);
            assert_eq!(lens, "Sigma 35mm F1.4 Art", "{:?}: lens mismatch", camera);
        }
    }

    /// All parameters together in build() for JPEG: capture_time and orientation in EXIF.
    #[test]
    #[ignore]
    fn test_all_params_combined_build_jpeg() {
        let params = CameraParams {
            aperture: Some(4.0),
            iso: Some(3200),
            ..Default::default()
        };

        for camera in &ALL_CAMERAS {
            let project = TestLibraryBuilder::new()
                .add_photo(PhotoSpec {
                    camera: *camera,
                    orientation: 3,
                    file_type: FileType::Jpeg,
                    capture_time: Some(CUSTOM_TIME.to_string()),
                    camera_params: Some(params.clone()),
                })
                .build();

            let photo = &project.photos()[0];
            let actual = extract_metadata(&photo.path);

            // capture_time and orientation are in EXIF
            let ct = actual.capture_time.unwrap();
            assert_eq!(
                ct.format("%Y:%m:%d %H:%M:%S").to_string(),
                CUSTOM_TIME,
                "{:?}: capture_time in EXIF",
                camera
            );
            assert_eq!(
                actual.orientation,
                Some(3),
                "{:?}: orientation in EXIF",
                camera
            );

            // camera_params are NOT in EXIF for synthesized JPEGs (known limitation)
            // This assertion documents the limitation
            assert_eq!(
                actual.aperture, None,
                "{:?}: camera_params are not written to EXIF (known limitation)",
                camera
            );
        }
    }

    // ── capture_time × stack layout in build_db_only ─────────────────────────

    /// Stack layout with mixed cameras and custom capture_time.
    #[test]
    #[ignore]
    fn test_capture_time_stack_layout_mixed_cameras() {
        // 3 Canon + 2 Sony with custom capture_time, partitioned [3, 2]
        let project = TestLibraryBuilder::new()
            .add_photo(PhotoSpec {
                camera: Camera::Canon,
                orientation: 1,
                file_type: FileType::Jpeg,
                capture_time: Some("2025:01:10 12:00:00".to_string()),
                camera_params: None,
            })
            .add_photo(PhotoSpec {
                camera: Camera::Canon,
                orientation: 1,
                file_type: FileType::Jpeg,
                capture_time: Some("2025:01:10 12:00:01".to_string()),
                camera_params: None,
            })
            .add_photo(PhotoSpec {
                camera: Camera::Canon,
                orientation: 1,
                file_type: FileType::Jpeg,
                capture_time: Some("2025:01:10 12:00:02".to_string()),
                camera_params: None,
            })
            .add_photo(PhotoSpec {
                camera: Camera::Sony,
                orientation: 1,
                file_type: FileType::Jpeg,
                capture_time: Some("2025:01:10 13:00:00".to_string()),
                camera_params: None,
            })
            .add_photo(PhotoSpec {
                camera: Camera::Sony,
                orientation: 1,
                file_type: FileType::Jpeg,
                capture_time: Some("2025:01:10 13:00:01".to_string()),
                camera_params: None,
            })
            .with_layout(&[3, 2])
            .build_db_only();

        // Verify custom times are used (not auto-generated)
        let mut stmt = project
            .conn
            .prepare("SELECT capture_time FROM photos ORDER BY id")
            .unwrap();
        let times: Vec<String> = stmt
            .query_map([], |r| r.get(0))
            .unwrap()
            .map(|r| r.unwrap())
            .collect();
        assert_eq!(times.len(), 5);
        assert_eq!(times[0], "2025:01:10 12:00:00");
        assert_eq!(times[3], "2025:01:10 13:00:00", "Sony photos in stack 2");
    }

    // ── camera_model correctness across cameras ──────────────────────────────

    /// Each camera produces a non-empty camera_model string in DB.
    #[test]
    #[ignore]
    fn test_camera_model_all_cameras_db_only() {
        for camera in &ALL_CAMERAS {
            let project = TestLibraryBuilder::new()
                .add_photo(PhotoSpec {
                    camera: *camera,
                    orientation: 1,
                    file_type: FileType::Jpeg,
                    capture_time: None,
                    camera_params: None,
                })
                .build_db_only();

            let model: Option<String> = project
                .conn
                .query_row("SELECT camera_model FROM photos LIMIT 1", [], |r| r.get(0))
                .unwrap();

            assert!(
                model.is_some() && !model.as_ref().unwrap().is_empty(),
                "{:?}: camera_model in DB must be non-empty",
                camera
            );
        }
    }

    // ── Known limitation: RAF/RW2 capture_time ───────────────────────────────

    /// Fuji/Panasonic RAW with custom capture_time: the custom value is silently
    /// ignored because rexiv2 cannot write RAF/RW2 files. The fixture's original
    /// capture_time is preserved instead. This test documents the limitation.
    #[test]
    #[ignore]
    fn test_capture_time_raf_rw2_ignores_custom() {
        for camera in &UNPATCHABLE_RAW_CAMERAS {
            let project_default = TestLibraryBuilder::new()
                .add_photo(PhotoSpec {
                    camera: *camera,
                    orientation: 1,
                    file_type: FileType::Raw,
                    capture_time: None,
                    camera_params: None,
                })
                .build();

            let project_custom = TestLibraryBuilder::new()
                .add_photo(PhotoSpec {
                    camera: *camera,
                    orientation: 1,
                    file_type: FileType::Raw,
                    capture_time: Some(CUSTOM_TIME.to_string()),
                    camera_params: None,
                })
                .build();

            let exif_default = extract_metadata(&project_default.photos()[0].path);
            let exif_custom = extract_metadata(&project_custom.photos()[0].path);

            // Both should have the same capture_time (fixture's original)
            // because the custom value cannot be patched into RAF/RW2
            assert_eq!(
                exif_default.capture_time, exif_custom.capture_time,
                "{:?} RAW: custom capture_time must be ignored (rexiv2 cannot write {:?}). \
                 Both should have the fixture's original capture_time.",
                camera, camera
            );
        }
    }

    // ── Fuji/Panasonic RAW orientation matrix ────────────────────────────────

    /// Fuji RAW (RAF) with orientations 1, 3, 6, 8 — TIFF binary patching.
    #[test]
    #[ignore]
    fn test_orientation_fuji_raw_all() {
        for &orientation in &REPRESENTATIVE_ORIENTATIONS {
            let project = TestLibraryBuilder::new()
                .add_photo(PhotoSpec {
                    camera: Camera::Fuji,
                    orientation,
                    file_type: FileType::Raw,
                    capture_time: None,
                    camera_params: None,
                })
                .build();
            let actual = extract_metadata(&project.photos()[0].path);
            assert_eq!(
                actual.orientation,
                Some(orientation),
                "Fuji RAW orientation={}: EXIF mismatch",
                orientation
            );
        }
    }

    /// Panasonic RAW (RW2) with orientations 1, 3, 6, 8 — TIFF binary patching.
    #[test]
    #[ignore]
    fn test_orientation_panasonic_raw_all() {
        for &orientation in &REPRESENTATIVE_ORIENTATIONS {
            let project = TestLibraryBuilder::new()
                .add_photo(PhotoSpec {
                    camera: Camera::Panasonic,
                    orientation,
                    file_type: FileType::Raw,
                    capture_time: None,
                    camera_params: None,
                })
                .build();
            let actual = extract_metadata(&project.photos()[0].path);
            assert_eq!(
                actual.orientation,
                Some(orientation),
                "Panasonic RAW orientation={}: EXIF mismatch",
                orientation
            );
        }
    }

    // ── Parameterized: every camera × format produces valid file ─────────────

    /// Every camera × file_type combination produces at least one file in build().
    #[test]
    #[ignore]
    fn test_every_camera_format_creates_file() {
        for_each_camera_format(|camera, file_type| {
            let project = TestLibraryBuilder::new()
                .add_photo(PhotoSpec {
                    camera,
                    orientation: 1,
                    file_type,
                    capture_time: None,
                    camera_params: None,
                })
                .build();
            let photos = project.photos();
            assert!(
                !photos.is_empty(),
                "{:?}/{:?}: must produce at least one photo",
                camera,
                file_type
            );
            for photo in photos {
                assert!(
                    photo.path.exists(),
                    "{:?}/{:?}: file {} must exist",
                    camera,
                    file_type,
                    photo.path.display()
                );
            }
        });
    }

    /// Every camera × file_type in build_db_only() creates correct photo count.
    #[test]
    #[ignore]
    fn test_every_camera_format_db_only_photo_count() {
        for_each_camera_format(|camera, file_type| {
            let project = TestLibraryBuilder::new()
                .add_photo(PhotoSpec {
                    camera,
                    orientation: 1,
                    file_type,
                    capture_time: None,
                    camera_params: None,
                })
                .build_db_only();

            let photo_count: i64 = project
                .conn
                .query_row("SELECT COUNT(*) FROM photos", [], |r| r.get(0))
                .unwrap();
            let lp_count: i64 = project
                .conn
                .query_row("SELECT COUNT(*) FROM logical_photos", [], |r| r.get(0))
                .unwrap();

            let expected_photos = if matches!(file_type, FileType::Both) {
                2
            } else {
                1
            };
            assert_eq!(
                photo_count, expected_photos,
                "{:?}/{:?}: expected {} photo rows, got {}",
                camera, file_type, expected_photos, photo_count
            );
            assert_eq!(
                lp_count, 1,
                "{:?}/{:?}: expected 1 logical_photo",
                camera, file_type
            );
        });
    }

    /// Every camera × format has parseable EXIF with make and orientation.
    #[test]
    #[ignore]
    fn test_every_camera_format_exif_basics() {
        for_each_camera_format(|camera, file_type| {
            let project = TestLibraryBuilder::new()
                .add_photo(PhotoSpec {
                    camera,
                    orientation: 1,
                    file_type,
                    capture_time: None,
                    camera_params: None,
                })
                .build();
            // Check first photo (JPEG side for Both)
            let photo = &project.photos()[0];
            let actual = extract_metadata(&photo.path);
            assert!(
                actual.camera_model.is_some(),
                "{:?}/{:?}: camera_model must be present in EXIF",
                camera,
                file_type
            );
            assert_eq!(
                actual.orientation,
                Some(1),
                "{:?}/{:?}: orientation must be 1",
                camera,
                file_type
            );
        });
    }

    // ── Parameterized: every camera × orientation in JPEG ────────────────────

    /// All 5 cameras × 4 orientations produce correct EXIF orientation in JPEG.
    #[test]
    #[ignore]
    fn test_every_camera_orientation_jpeg() {
        for_each_camera_orientation(|camera, orientation| {
            let project = TestLibraryBuilder::new()
                .add_photo(PhotoSpec {
                    camera,
                    orientation,
                    file_type: FileType::Jpeg,
                    capture_time: None,
                    camera_params: None,
                })
                .build();
            let actual = extract_metadata(&project.photos()[0].path);
            assert_eq!(
                actual.orientation,
                Some(orientation),
                "{:?} JPEG orientation={}: mismatch",
                camera,
                orientation
            );
        });
    }
}
