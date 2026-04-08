/// Stack #158 thumbnail-composition tests (RED).
///
/// Reproduces the production bug where Canon EOS 80D JPEGs (EXIF
/// orientation=6) produced thumbnails that were CROPPED regions of the
/// embedded EXIF preview rather than downscaled compositions of the full
/// main image. The fast-path thumbnailer reuses the embedded EXIF IFD1
/// thumbnail whenever its short side >= 200px — but the embedded preview
/// is sometimes a different composition than the main image, so the
/// resulting thumbnail loses content at the edges.
///
/// Fixture: tests/fixtures/raw-samples/stack158_composition.jpg
///   - 1800×1200 main image (landscape sensor), EXIF orientation=6
///   - 4 ~5%-size corner markers on the main image (one unique color
///     per display corner after rotation)
///   - embedded IFD1 thumbnail is a center-40% CROP of the main image
///     (gray only, no corner markers) stored at 400×300 (short side
///     >= 200 triggers the fast path)
///
/// Expected: the generated 256×256 thumbnail, decoded, must contain
/// ALL 4 corner-marker colors at the display corners — proving the
/// thumbnail was composed from the full main image, not from the
/// embedded preview crop.
#[cfg(test)]
mod tests {
    use crate::import::thumbnails::generate_thumbnail;
    use crate::photos::model::PhotoFormat;
    use image::GenericImageView;
    use std::path::PathBuf;
    use tempfile::TempDir;

    fn fixtures_dir() -> PathBuf {
        let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        manifest_dir
            .parent()
            .unwrap()
            .join("tests")
            .join("fixtures")
            .join("raw-samples")
    }

    /// Scan an NxN region around (cx, cy) and return true if any pixel
    /// matches the expected RGB within the given per-channel tolerance.
    fn region_contains_color(
        img: &image::RgbaImage,
        cx: u32,
        cy: u32,
        half_size: u32,
        expected: [u8; 3],
        tolerance: u8,
    ) -> bool {
        let (w, h) = (img.width(), img.height());
        let x0 = cx.saturating_sub(half_size);
        let y0 = cy.saturating_sub(half_size);
        let x1 = (cx + half_size).min(w - 1);
        let y1 = (cy + half_size).min(h - 1);
        for y in y0..=y1 {
            for x in x0..=x1 {
                let p = img.get_pixel(x, y);
                let dr = (p[0] as i16 - expected[0] as i16).unsigned_abs() as u8;
                let dg = (p[1] as i16 - expected[1] as i16).unsigned_abs() as u8;
                let db = (p[2] as i16 - expected[2] as i16).unsigned_abs() as u8;
                if dr <= tolerance && dg <= tolerance && db <= tolerance {
                    return true;
                }
            }
        }
        false
    }

    /// Stack #158: the generated thumbnail for an EXIF-orientation=6 JPEG
    /// must preserve the FULL composition of the main image (all 4
    /// display-corner markers present), not a cropped region of the
    /// embedded EXIF preview.
    #[test]
    fn test_thumbnail_preserves_full_composition_for_rotated_jpeg() {
        let fixture = fixtures_dir().join("exif-embedded-crop-orientation6.jpg");
        assert!(fixture.exists(), "fixture must exist at {:?}", fixture,);

        let cache_dir = TempDir::new().unwrap();
        let thumb_path =
            generate_thumbnail(&fixture, &PhotoFormat::Jpeg, 158, cache_dir.path(), Some(6))
                .expect("thumbnail generation must succeed");

        let thumb = image::open(&thumb_path).unwrap().to_rgba8();
        let (w, h) = (thumb.width(), thumb.height());

        // Thumbnails are normalized to a square cache size (256×256) so
        // we can't assert portrait vs landscape from dimensions. The
        // real test is the corner-marker presence below — that's what
        // distinguishes a full-composition downscale from an embedded-
        // preview crop.
        let _ = (w, h);

        // Sample ~5% in from each display corner. Use a generous search
        // window (10% of the smaller dimension) and loose tolerance to
        // absorb JPEG compression artefacts at corner edges.
        let half = (w.min(h) / 10).max(4);
        let tol = 32;

        let inset_x = w / 20;
        let inset_y = h / 20;

        let tl_present =
            region_contains_color(&thumb, inset_x, inset_y, half, [0xFF, 0x00, 0xFF], tol);
        let tr_present = region_contains_color(
            &thumb,
            w - 1 - inset_x,
            inset_y,
            half,
            [0x00, 0xFF, 0xFF],
            tol,
        );
        let bl_present = region_contains_color(
            &thumb,
            inset_x,
            h - 1 - inset_y,
            half,
            [0xFF, 0xFF, 0x00],
            tol,
        );
        let br_present = region_contains_color(
            &thumb,
            w - 1 - inset_x,
            h - 1 - inset_y,
            half,
            [0xFF, 0xA5, 0x00],
            tol,
        );

        assert!(
            tl_present,
            "display top-left marker (magenta #FF00FF) missing — thumbnail appears to be a crop of the embedded EXIF preview, not a downscale of the full main image",
        );
        assert!(
            tr_present,
            "display top-right marker (cyan #00FFFF) missing — thumbnail composition bug",
        );
        assert!(
            bl_present,
            "display bottom-left marker (yellow #FFFF00) missing — thumbnail composition bug",
        );
        assert!(
            br_present,
            "display bottom-right marker (orange #FFA500) missing — thumbnail composition bug",
        );
    }
}
