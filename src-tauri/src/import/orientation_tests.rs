/// Orientation consistency tests — RED phase.
///
/// Layer 1 (Unit): apply_orientation_to_image pixel + dimension checks for all 8 EXIF orientations.
///   Uses a 6×4 image with a red marker pixel at (0,0) to detect both dimension swaps AND mirror flips.
/// Layer 2 (Integration): TestLibraryBuilder 5 cameras × 8 orientations, metadata + thumbnail.

#[cfg(test)]
mod tests {
    use crate::import::exif::extract_metadata;
    use crate::import::test_fixtures::{Camera, FileType, PhotoSpec, TestLibraryBuilder};
    use crate::import::thumbnails::{apply_orientation_to_image, generate_thumbnail};
    use crate::photos::model::PhotoFormat;
    use image::{GenericImage, GenericImageView, Rgba};
    use tempfile::TempDir;

    // ── Helpers ──────────────────────────────────────────────────────────────

    const RED: Rgba<u8> = Rgba([255, 0, 0, 255]);
    const BLACK: Rgba<u8> = Rgba([0, 0, 0, 255]);

    /// 6×4 black image with a red marker at (0,0).
    fn make_marked_image() -> image::DynamicImage {
        let mut img = image::DynamicImage::new_rgb8(6, 4);
        img.put_pixel(0, 0, RED);
        img
    }

    /// Build the standard 5-camera × 8-orientation test matrix (40 photos).
    fn build_orientation_matrix() -> crate::import::test_fixtures::TestProject {
        let cameras = [
            Camera::Canon,
            Camera::Sony,
            Camera::Nikon,
            Camera::Fuji,
            Camera::Panasonic,
        ];
        let mut builder = TestLibraryBuilder::new();
        for camera in &cameras {
            for orientation in 1..=8u16 {
                builder = builder.add_photo(PhotoSpec {
                    camera: *camera,
                    orientation,
                    file_type: FileType::Jpeg,
                    capture_time: None,
                    camera_params: None,
                });
            }
        }
        builder.build()
    }

    // ── Layer 1: Unit — apply_orientation pixel + dimension correctness ─────

    /// Orientation 1 (normal): 6×4 → 6×4, marker stays at (0,0).
    #[test]
    fn test_apply_orientation_1_no_change() {
        let result = apply_orientation_to_image(make_marked_image(), Some(1));
        assert_eq!((result.width(), result.height()), (6, 4));
        assert_eq!(result.get_pixel(0, 0), RED, "marker must stay at (0,0)");
    }

    /// Orientation 2 (flip horizontal): 6×4 → 6×4, marker moves (0,0)→(5,0).
    #[test]
    fn test_apply_orientation_2_flip_h() {
        let result = apply_orientation_to_image(make_marked_image(), Some(2));
        assert_eq!((result.width(), result.height()), (6, 4));
        assert_eq!(
            result.get_pixel(5, 0),
            RED,
            "marker must move to (5,0) after flip-H"
        );
        assert_eq!(
            result.get_pixel(0, 0),
            BLACK,
            "(0,0) must be black after flip-H"
        );
    }

    /// Orientation 3 (rotate 180): 6×4 → 6×4, marker moves (0,0)→(5,3).
    #[test]
    fn test_apply_orientation_3_rotate_180() {
        let result = apply_orientation_to_image(make_marked_image(), Some(3));
        assert_eq!((result.width(), result.height()), (6, 4));
        assert_eq!(
            result.get_pixel(5, 3),
            RED,
            "marker must move to (5,3) after rotate-180"
        );
    }

    /// Orientation 4 (flip vertical): 6×4 → 6×4, marker moves (0,0)→(0,3).
    #[test]
    fn test_apply_orientation_4_flip_v() {
        let result = apply_orientation_to_image(make_marked_image(), Some(4));
        assert_eq!((result.width(), result.height()), (6, 4));
        assert_eq!(
            result.get_pixel(0, 3),
            RED,
            "marker must move to (0,3) after flip-V"
        );
        assert_eq!(
            result.get_pixel(0, 0),
            BLACK,
            "(0,0) must be black after flip-V"
        );
    }

    /// Orientation 5 (transpose): 6×4 → 4×6, marker moves (0,0)→(0,0).
    #[test]
    fn test_apply_orientation_5_transpose() {
        let result = apply_orientation_to_image(make_marked_image(), Some(5));
        assert_eq!(
            (result.width(), result.height()),
            (4, 6),
            "orientation 5 (transpose) must swap dimensions to 4×6"
        );
    }

    /// Orientation 6 (rotate 90 CW): 6×4 → 4×6, marker moves (0,0)→(3,0).
    #[test]
    fn test_apply_orientation_6_rotate_90() {
        let result = apply_orientation_to_image(make_marked_image(), Some(6));
        assert_eq!(
            (result.width(), result.height()),
            (4, 6),
            "orientation 6 (rotate-90) must swap dimensions to 4×6"
        );
        assert_eq!(
            result.get_pixel(3, 0),
            RED,
            "marker must move to (3,0) after rotate-90CW"
        );
    }

    /// Orientation 7 (transverse): 6×4 → 4×6, marker moves (0,0)→(3,5).
    #[test]
    fn test_apply_orientation_7_transverse() {
        let result = apply_orientation_to_image(make_marked_image(), Some(7));
        assert_eq!(
            (result.width(), result.height()),
            (4, 6),
            "orientation 7 (transverse) must swap dimensions to 4×6"
        );
    }

    /// Orientation 8 (rotate 270 CW): 6×4 → 4×6, marker moves (0,0)→(0,5).
    #[test]
    fn test_apply_orientation_8_rotate_270() {
        let result = apply_orientation_to_image(make_marked_image(), Some(8));
        assert_eq!(
            (result.width(), result.height()),
            (4, 6),
            "orientation 8 (rotate-270) must swap dimensions to 4×6"
        );
        assert_eq!(
            result.get_pixel(0, 5),
            RED,
            "marker must move to (0,5) after rotate-270CW"
        );
    }

    /// None orientation: 6×4 → 6×4, marker stays at (0,0).
    #[test]
    fn test_apply_orientation_none_no_change() {
        let result = apply_orientation_to_image(make_marked_image(), None);
        assert_eq!((result.width(), result.height()), (6, 4));
        assert_eq!(result.get_pixel(0, 0), RED, "marker must stay at (0,0)");
    }

    // ── Layer 2: Integration — 5 cameras × 8 orientations ──────────────────

    /// 40 JPEG photos (5 cameras × 8 orientations) are all created.
    #[test]
    fn test_orientation_matrix_all_40_photos_created() {
        let project = build_orientation_matrix();
        assert_eq!(
            project.photos().len(),
            40,
            "5 cameras × 8 orientations must produce exactly 40 photos"
        );
    }

    /// All 40 photos round-trip orientation through extract_metadata().
    #[test]
    fn test_orientation_matrix_metadata_correctness() {
        let project = build_orientation_matrix();
        for photo in project.photos() {
            let exif = extract_metadata(&photo.path);
            assert_eq!(
                exif.orientation,
                Some(photo.spec.orientation),
                "extract_metadata orientation mismatch for {:?} orientation={}: got {:?}",
                photo.spec.camera,
                photo.spec.orientation,
                exif.orientation,
            );
        }
    }

    /// All 40 photos produce thumbnails without errors.
    #[test]
    fn test_orientation_matrix_thumbnail_generation() {
        let project = build_orientation_matrix();
        let cache_dir = TempDir::new().unwrap();
        for (i, photo) in project.photos().iter().enumerate() {
            let result = generate_thumbnail(
                &photo.path,
                &PhotoFormat::Jpeg,
                i as i64,
                cache_dir.path(),
                Some(photo.spec.orientation),
            );
            assert!(
                result.is_some(),
                "thumbnail generation must succeed for {:?} orientation={}",
                photo.spec.camera,
                photo.spec.orientation,
            );
        }
    }

    // ── Layer 2b: RAW thumbnail orientation ─────────────────────────────────

    /// Sony RAW with orientation=3 (rotate 180): generate two thumbnails —
    /// one with orientation=1 (normal) and one with orientation=3. The pixel
    /// content must differ, proving orientation was actually applied during
    /// RAW thumbnail generation. This catches the bug where
    /// generate_raw_thumbnail ignores orientation entirely.
    #[test]
    fn test_raw_thumbnail_orientation_sony_applied() {
        // Build two Sony RAW photos: one normal, one rotated 180°
        let project = TestLibraryBuilder::new()
            .add_photo(PhotoSpec {
                camera: Camera::Sony,
                orientation: 1,
                file_type: FileType::Raw,
                capture_time: None,
                camera_params: None,
            })
            .add_photo(PhotoSpec {
                camera: Camera::Sony,
                orientation: 3,
                file_type: FileType::Raw,
                capture_time: None,
                camera_params: None,
            })
            .build();

        let photo_normal = &project.photos()[0];
        let photo_rotated = &project.photos()[1];

        // Verify EXIF orientations were set correctly by the builder
        assert_eq!(extract_metadata(&photo_normal.path).orientation, Some(1));
        assert_eq!(extract_metadata(&photo_rotated.path).orientation, Some(3));

        // Generate thumbnails via the RAW code path
        let cache_dir = TempDir::new().unwrap();
        let thumb_normal = generate_thumbnail(
            &photo_normal.path,
            &PhotoFormat::Raw,
            1,
            cache_dir.path(),
            Some(1),
        )
        .expect("RAW thumbnail must succeed for orientation=1");

        let thumb_rotated = generate_thumbnail(
            &photo_rotated.path,
            &PhotoFormat::Raw,
            2,
            cache_dir.path(),
            Some(3),
        )
        .expect("RAW thumbnail must succeed for orientation=3");

        // Load both thumbnails and compare pixel content.
        // Orientation=3 is rotate-180, so the pixels must differ from orientation=1.
        let img_normal = image::open(&thumb_normal).unwrap();
        let img_rotated = image::open(&thumb_rotated).unwrap();

        // Compare corner pixels — rotate-180 maps (0,0) → (w-1,h-1)
        let (w, h) = (img_normal.width(), img_normal.height());
        let top_left_normal = img_normal.get_pixel(0, 0);
        let top_left_rotated = img_rotated.get_pixel(0, 0);

        // After rotate-180, the top-left of the normal image maps to
        // the bottom-right of the rotated image.
        // At minimum, the top-left pixels of both images must differ.
        assert_ne!(
            top_left_normal, top_left_rotated,
            "RAW thumbnails with orientation=1 vs orientation=3 must have different \
             top-left pixels, proving orientation was applied. Both are {:?}",
            top_left_normal,
        );
    }
}
