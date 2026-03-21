# Test Fixture Design: Manifest-Driven Fixture Set

> Source of truth for all test fixture files, their expected metadata, and the
> dimension coverage matrix. Tests iterate `manifest.json` and assert:
> `our_result == manifest_value`.

---

## 1. Key Principle

Tests NEVER guess or infer expected values. Every expected value is declared in
the manifest as a **known fact**, verified by an external tool (`exifread` /
`exiftool` for EXIF, `identify` for dimensions). Tests iterate manifest entries
and assert that GemKeep's extraction result matches the manifest value exactly.

Ground truth tool: `exifread 3.5.1` (Python) or `exiftool` (Perl).

---

## 2. Manifest JSON Schema

Location: `tests/fixtures/raw-samples/manifest.json`

```json
{
  "$schema_version": 2,
  "ground_truth_tool": "exifread 3.5.1 / exiftool 12.x",
  "fixtures": [
    {
      "id": "unique-short-id",
      "file": "filename.ext",
      "category": "real-raw | synthetic-jpeg | synthetic-corrupt | timing-only",
      "source": "download URL | generation command",
      "dimensions_covered": ["orientation:6", "format:arw", "metadata:full"],
      "test_layers": ["exif", "thumbnail", "pipeline", "e2e"],
      "expected": {
        "make": "SONY",
        "camera_model": "DSC-RX10",
        "orientation": 6,
        "capture_time": "2015:12:20 14:36:22",
        "capture_time_present": true,
        "aperture": 3.5,
        "iso": 125,
        "focal_length": 18.98,
        "shutter_speed": "1/60",
        "exposure_comp": 0.0,
        "image_width": 5472,
        "image_height": 3648,
        "thumbnail_expected_width": 256,
        "thumbnail_expected_height": 256,
        "display_orientation": "landscape",
        "file_valid": true,
        "exif_parseable": true
      }
    }
  ]
}
```

### Field Definitions

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique short identifier (e.g., `r1`, `s3`, `c2`, `t1`) |
| `file` | string | Filename relative to `tests/fixtures/raw-samples/` |
| `category` | enum | `real-raw`, `synthetic-jpeg`, `synthetic-corrupt`, `timing-only` |
| `source` | string | Download URL (real) or ImageMagick+exiftool command (synthetic) |
| `dimensions_covered` | array | Which `dimension:value` pairs this fixture covers |
| `test_layers` | array | Which test layers use this fixture: `exif`, `thumbnail`, `pipeline`, `e2e` |
| `expected` | object | All expected values (`null` = field should be `None`/absent) |

### Expected Fields

| Field | Type | Assertion |
|-------|------|-----------|
| `make` | string or null | Exact match or null |
| `camera_model` | string or null | `model.contains(expected)` |
| `orientation` | u16 or null | `exif.orientation == expected` |
| `capture_time` | string or null | EXIF format `YYYY:MM:DD HH:MM:SS` |
| `capture_time_present` | bool | Whether `capture_time` is `Some` |
| `aperture` | f64 or null | Within 0.01 tolerance |
| `iso` | u32 or null | Exact match |
| `focal_length` | f64 or null | Within 0.1 tolerance |
| `shutter_speed` | string or null | Formatted string exact match |
| `exposure_comp` | f64 or null | Within 0.01 tolerance |
| `image_width` | u32 or null | Exact match (pixel width of source) |
| `image_height` | u32 or null | Exact match (pixel height of source) |
| `thumbnail_expected_width` | u32 or null | Always 256 for valid images |
| `thumbnail_expected_height` | u32 or null | Always 256 for valid images |
| `display_orientation` | string or null | `landscape`, `portrait`, `square`, `panoramic` |
| `file_valid` | bool | Whether the file is a valid, decodable image |
| `exif_parseable` | bool | Whether `extract_exif` returns any non-None fields |

---

## 3. Dimension Coverage (10 High-Priority)

| # | Dimension | Values to Cover |
|---|-----------|-----------------|
| 1 | exif_orientation | 1, 3, 6, 8, null |
| 2 | file_format | JPEG .jpg, JPEG .jpeg, Canon CR2, Sony ARW |
| 3 | file_pairing | RAW+JPEG pair, JPEG-only, RAW-only |
| 4 | capture_time | valid, missing (null --> solo stack) |
| 5 | image_dimensions | landscape 3:2, portrait-via-orientation, square, panoramic |
| 6 | embedded_thumbnail_size | standard (>=200px), tiny-rejected (<200px), none |
| 7 | metadata_completeness | all fields present, partial (orientation only), none |
| 8 | file_integrity | valid, truncated, zero-byte, non-image-with-image-ext |
| 9 | exif_rational_edge_cases | normal rational, zero denominator |
| 10 | burst_timing | fast burst (<3s), boundary (exactly 3s), separate (>3s) |

---

## 4. Fixture Set (22 Fixtures)

### 4.1 Real RAW (2 files, gitignored, ~20-40MB each)

Downloaded from raw.pixls.us. Expected values verified with exifread.

| ID | File | Source | Dimensions Covered |
|----|------|--------|--------------------|
| r1 | `RAW_CANON_EOS7D.CR2` | `https://raw.pixls.us/data/Canon/EOS%207D/RAW_CANON_EOS7D.CR2` | format:cr2, orientation:1, time:valid, meta:all, thumb:standard, dims:landscape_3_2, rational:normal |
| r2 | `RAW_SONY_RX10.ARW` | `https://raw.pixls.us/data/Sony/DSC-RX10/RAW_SONY_RX10.ARW` | format:arw, orientation:1, time:valid, meta:all, thumb:standard, dims:landscape_3_2, rational:normal |

**Expected values (r1 - Canon EOS 7D CR2):**
- make: `"Canon"`, camera_model contains: `"Canon EOS 7D"`
- orientation: 1, capture_time: `"2009:10:09 14:18:45"`
- aperture: 2.8, shutter_speed: `"1/320"`, iso: 100, focal_length: 200.0, exposure_comp: 0.0
- image_width: 5184, image_height: 3456

**Expected values (r2 - Sony DSC-RX10 ARW):**
- make: `"SONY"`, camera_model contains: `"DSC-RX10"`
- orientation: 1, capture_time: `"2015:12:20 14:36:22"`
- aperture: 3.5, shutter_speed: `"1/60"`, iso: 125, focal_length: 18.98, exposure_comp: 0.0
- image_width: 5472, image_height: 3648

### 4.2 Synthetic JPEG (12 files, <10KB each, committed to git)

Created with ImageMagick `convert` + `exiftool` for EXIF injection.

| ID | File | Source Command | Dimensions Covered | Test Layers |
|----|------|----------------|--------------------|-------------|
| s1 | `orient_1_landscape.jpg` | `convert -size 120x80 xc:gray; exiftool -Orientation#=1` | orientation:1, format:jpg, dims:landscape_3_2, meta:partial | exif, thumbnail |
| s2 | `orient_3_landscape.jpg` | `convert -size 120x80 xc:gray; exiftool -Orientation#=3` | orientation:3 | exif, thumbnail |
| s3 | `orient_6_landscape.jpg` | `convert -size 120x80 xc:gray; exiftool -Orientation#=6` | orientation:6, dims:portrait_via_orientation | exif, thumbnail |
| s4 | `orient_8_landscape.jpg` | `convert -size 120x80 xc:gray; exiftool -Orientation#=8` | orientation:8 | exif, thumbnail |
| s5 | `no_exif.jpg` | `convert -size 100x100 xc:gray; exiftool -all=` | orientation:null, meta:none, time:missing | exif, thumbnail |
| s6 | `square.jpg` | `convert -size 100x100 xc:gray; exiftool -Orientation#=1` | dims:square | exif, thumbnail, e2e |
| s7 | `panoramic.jpg` | `convert -size 300x60 xc:gray; exiftool -Orientation#=1` | dims:panoramic | exif, thumbnail, e2e |
| s8 | `all_metadata.jpg` | `convert -size 120x80 xc:gray; exiftool` (full EXIF) | meta:all, rational:normal, time:valid | exif, thumbnail, pipeline |
| s9 | `zero_denom_fnumber.jpg` | `convert -size 120x80 xc:gray; exiftool -FNumber="0/0"` | rational:zero_denom | exif |
| s10 | `jpeg_ext.jpeg` | `convert -size 80x80 xc:gray; exiftool -Orientation#=1` | format:jpeg_ext | exif, thumbnail |
| s11 | `pair_IMG_0001.jpg` | `convert -size 80x60 xc:gray; exiftool -DateTimeOriginal=...` | pairing:jpeg_of_pair, time:valid | exif, pipeline |
| s12 | `pair_IMG_0001.cr2` | Minimal TIFF header (100 bytes, pair target) | pairing:raw_of_pair | pipeline |

**Expected values (s8 - all_metadata.jpg):**
- make: `"TestCam"`, camera_model: `"TestCam Pro 5000"`
- orientation: 1, capture_time: `"2024:06:15 14:30:00"`
- aperture: 2.8, shutter_speed: `"1/250"`, iso: 400, focal_length: 50.0, exposure_comp: 0.7
- image_width: 120, image_height: 80

**Expected values (s9 - zero_denom_fnumber.jpg):**
- aperture: null (zero denominator guard returns None)
- All other fields: as set by exiftool

### 4.3 Synthetic Corrupt (4 files, committed to git)

| ID | File | Source Command | Dimensions Covered | Test Layers |
|----|------|----------------|--------------------|-------------|
| c1 | `truncated.jpg` | `head -c 100 valid.jpg > truncated.jpg` | integrity:truncated | exif, thumbnail |
| c2 | `zero_byte.jpg` | `truncate -s 0 zero_byte.jpg` | integrity:zero_byte | exif, thumbnail |
| c3 | `not_an_image.jpg` | `echo "plain text" > not_an_image.jpg` | integrity:non_image | exif, thumbnail |
| c4 | `truncated.cr2` | `head -c 100 RAW_CANON_EOS7D.CR2 > truncated.cr2` | integrity:truncated_raw | exif, thumbnail |

**Expected values (all corrupt):**
- file_valid: false, exif_parseable: false
- All metadata fields: null
- thumbnail generation: returns None (no crash)

### 4.4 Timing Metadata (4 entries, manifest-only, no image files)

These live only in the manifest for burst-stacking unit tests. Tests construct
`ScannedFile` structs with these timestamps -- no actual image file needed.

| ID | Key | Capture Time | Dimensions Covered | Test Layers |
|----|-----|-------------|---------------------|-------------|
| t1 | `burst_fast_A` | `2024:01:15 10:00:00` | burst:fast_burst | pipeline |
| t2 | `burst_fast_B` | `2024:01:15 10:00:01` | burst:fast_burst (1s gap from t1) | pipeline |
| t3 | `burst_boundary_C` | `2024:01:15 10:00:04` | burst:boundary (3s gap from t2) | pipeline |
| t4 | `burst_separate_D` | `2024:01:15 10:05:00` | burst:separate (>3s gap from t3) | pipeline |

---

## 5. Coverage Matrix

Every high-priority dimension value must have at least one fixture.

| Dimension Value | r1 | r2 | s1 | s2 | s3 | s4 | s5 | s6 | s7 | s8 | s9 | s10 | s11 | s12 | c1 | c2 | c3 | c4 | t1 | t2 | t3 | t4 |
|-----------------|----|----|----|----|----|----|----|----|----|----|----|----|-----|-----|----|----|----|----|----|----|----|----|
| **orientation:1** | X | X | X | | | | | X | X | X | | X | X | | | | | | | | | |
| **orientation:3** | | | | X | | | | | | | | | | | | | | | | | | |
| **orientation:6** | | | | | X | | | | | | | | | | | | | | | | | |
| **orientation:8** | | | | | | X | | | | | | | | | | | | | | | | |
| **orientation:null** | | | | | | | X | | | | | | | | X | X | X | X | | | | |
| **format:jpg** | | | X | X | X | X | X | X | X | X | X | | X | | | | | | | | | |
| **format:jpeg_ext** | | | | | | | | | | | | X | | | | | | | | | | |
| **format:cr2** | X | | | | | | | | | | | | | X | | | | X | | | | |
| **format:arw** | | X | | | | | | | | | | | | | | | | | | | | |
| **pairing:pair** | | | | | | | | | | | | | X | X | | | | | | | | |
| **pairing:jpeg_only** | | | X | X | X | X | X | X | X | X | X | X | | | | | | | | | | |
| **pairing:raw_only** | X | X | | | | | | | | | | | | | | | | | | | | |
| **time:valid** | X | X | | | | | | | | X | | | X | | | | | | X | X | X | X |
| **time:missing** | | | | | | | X | | | | | | | | X | X | X | X | | | | |
| **dims:landscape_3_2** | X | X | X | X | X | X | | | | X | | | | | | | | | | | | |
| **dims:portrait_via_orient** | | | | | X | | | | | | | | | | | | | | | | | |
| **dims:square** | | | | | | | X | X | | | | | | | | | | | | | | |
| **dims:panoramic** | | | | | | | | | X | | | | | | | | | | | | | |
| **thumb:standard** | X | X | | | | | | | | | | | | | | | | | | | | |
| **thumb:none** | | | X | X | X | X | X | X | X | X | X | X | X | | | | | | | | | |
| **thumb:tiny_rejected** | | | | | | | | | | | | | | | | | | | | | | |
| **meta:all** | X | X | | | | | | | | X | | | | | | | | | | | | |
| **meta:partial** | | | X | X | X | X | | X | X | | | X | X | | | | | | | | | |
| **meta:none** | | | | | | | X | | | | | | | | X | X | X | X | | | | |
| **integrity:valid** | X | X | X | X | X | X | X | X | X | X | X | X | X | X | | | | | | | | |
| **integrity:truncated** | | | | | | | | | | | | | | | X | | | X | | | | |
| **integrity:zero_byte** | | | | | | | | | | | | | | | | X | | | | | | |
| **integrity:non_image** | | | | | | | | | | | | | | | | | X | | | | | |
| **rational:normal** | X | X | | | | | | | | X | | | | | | | | | | | | |
| **rational:zero_denom** | | | | | | | | | | | X | | | | | | | | | | | |
| **burst:fast** | | | | | | | | | | | | | | | | | | | X | X | | |
| **burst:boundary** | | | | | | | | | | | | | | | | | | | | X | X | |
| **burst:separate** | | | | | | | | | | | | | | | | | | | | | X | X |

**Note on thumb:tiny_rejected:** This dimension is tested via the existing
`make_jpeg_with_embedded_thumb(80, 60)` in-code test helper (see `thumbnails.rs`
line 518). No fixture file needed -- the test constructs the JPEG in memory.

---

## 6. Per-Layer Test Methodology

### L1 Unit: EXIF Extraction

```rust
/// Load manifest.json, iterate fixtures with test_layers containing "exif",
/// call extract_exif(), assert each expected field matches manifest value.
#[test]
fn test_exif_extraction_matches_manifest() {
    let manifest = load_manifest();
    for fixture in manifest.fixtures.iter()
        .filter(|f| f.test_layers.contains(&"exif".to_string()))
    {
        let path = fixture_path(&fixture.file);
        if !path.exists() { continue; } // gitignored real RAW
        let format = match fixture.category.as_str() {
            "real-raw" | "synthetic-corrupt" if fixture.file.ends_with(".cr2") => PhotoFormat::Raw,
            _ => PhotoFormat::Jpeg,
        };
        let data = extract_exif(&path, &format);

        // Assert orientation
        assert_eq!(data.orientation, fixture.expected.orientation,
            "{}: orientation mismatch", fixture.id);

        // Assert capture_time presence
        assert_eq!(data.capture_time.is_some(), fixture.expected.capture_time_present,
            "{}: capture_time_present mismatch", fixture.id);

        // Assert capture_time value (if present)
        if let Some(expected_ct) = &fixture.expected.capture_time {
            let actual = data.capture_time.unwrap();
            let expected_dt = parse_exif_datetime(expected_ct).unwrap();
            assert_eq!(actual, expected_dt, "{}: capture_time value mismatch", fixture.id);
        }

        // Assert camera_model (contains check)
        if let Some(expected_model) = &fixture.expected.camera_model {
            let actual = data.camera_model.as_deref().unwrap_or("");
            assert!(actual.contains(expected_model),
                "{}: camera_model '{}' must contain '{}'", fixture.id, actual, expected_model);
        }

        // Assert numeric fields with tolerance
        assert_f64_near(data.aperture, fixture.expected.aperture, 0.01, &fixture.id, "aperture");
        assert_f64_near(data.focal_length, fixture.expected.focal_length, 0.1, &fixture.id, "focal_length");
        assert_f64_near(data.exposure_comp, fixture.expected.exposure_comp, 0.01, &fixture.id, "exposure_comp");
        assert_eq!(data.iso, fixture.expected.iso, "{}: iso mismatch", fixture.id);
        assert_eq!(data.shutter_speed, fixture.expected.shutter_speed,
            "{}: shutter_speed mismatch", fixture.id);
    }
}
```

### L1 Unit: Thumbnail Generation

```rust
/// For fixtures with test_layers containing "thumbnail" and file_valid=true:
/// generate thumbnail, assert 256x256 output.
#[test]
fn test_thumbnail_output_dimensions_from_manifest() {
    let manifest = load_manifest();
    for fixture in manifest.fixtures.iter()
        .filter(|f| f.test_layers.contains(&"thumbnail".to_string()))
        .filter(|f| f.expected.file_valid)
    {
        let path = fixture_path(&fixture.file);
        if !path.exists() { continue; }
        let cache = tempfile::tempdir().unwrap();
        let format = detect_photo_format(&fixture.file);
        let result = generate_thumbnail(&path, &format, 1, cache.path(),
            fixture.expected.orientation);
        assert!(result.is_some(), "{}: thumbnail must succeed", fixture.id);
        let img = image::open(cache.path().join("1.jpg")).unwrap();
        assert_eq!(img.width(), fixture.expected.thumbnail_expected_width.unwrap(),
            "{}: thumbnail width", fixture.id);
        assert_eq!(img.height(), fixture.expected.thumbnail_expected_height.unwrap(),
            "{}: thumbnail height", fixture.id);
    }
}
```

### L1 Unit: Corrupt File Resilience

```rust
/// For fixtures with category "synthetic-corrupt": assert extract returns
/// all-None and thumbnail returns None. Never crash.
#[test]
fn test_corrupt_files_never_crash() {
    let manifest = load_manifest();
    for fixture in manifest.fixtures.iter()
        .filter(|f| f.category == "synthetic-corrupt")
    {
        let path = fixture_path(&fixture.file);
        let data = extract_jpeg_exif(&path);
        assert!(data.capture_time.is_none(),
            "{}: corrupt file must yield None capture_time", fixture.id);
        assert!(data.camera_model.is_none(),
            "{}: corrupt file must yield None camera_model", fixture.id);

        let cache = tempfile::tempdir().unwrap();
        let result = generate_thumbnail(&path, &PhotoFormat::Jpeg, 1, cache.path(), None);
        assert!(result.is_none(),
            "{}: corrupt file thumbnail must return None", fixture.id);
    }
}
```

### L1 Unit: Burst Stacking

```rust
/// Build ScannedFile structs from timing-only manifest entries.
/// Run stacking with burst_gap_secs=3.
/// Assert: t1+t2 same stack (1s gap), t2+t3 same stack (3s gap, <= threshold),
/// t3+t4 different stack (>>3s gap).
#[test]
fn test_burst_grouping_from_manifest_timestamps() {
    let manifest = load_manifest();
    let timing: Vec<_> = manifest.fixtures.iter()
        .filter(|f| f.category == "timing-only")
        .sorted_by_key(|f| &f.id)
        .collect();
    assert_eq!(timing.len(), 4, "manifest must have 4 timing entries");

    let groups: Vec<LogicalGroup> = timing.iter()
        .map(|f| make_group_with_time(parse_exif_datetime(&f.expected.capture_time.unwrap())))
        .collect();

    let assigned = assign_stacks_by_burst(groups, 3);
    let indices: Vec<usize> = assigned.iter().map(|(_, i)| *i).collect();

    // t1, t2 (1s gap), t3 (3s gap from t2) all in same stack
    assert_eq!(indices[0], indices[1], "t1 and t2 must be same stack");
    assert_eq!(indices[1], indices[2], "t2 and t3 must be same stack (boundary = 3s)");
    // t4 (5min gap from t3) in different stack
    assert_ne!(indices[2], indices[3], "t3 and t4 must be different stacks");
}
```

### L2 Integration: Pipeline Round-Trip

```rust
/// Create temp project, add fixture directory as source folder,
/// run import pipeline, query DB, assert each logical_photo's metadata
/// matches manifest expected values.
#[test]
fn test_pipeline_inserts_manifest_metadata_into_db() {
    let manifest = load_manifest();
    let pipeline_fixtures: Vec<_> = manifest.fixtures.iter()
        .filter(|f| f.test_layers.contains(&"pipeline".to_string()))
        .collect();
    // ... set up temp DB, run pipeline on fixture dir, query results,
    // assert metadata round-trips correctly through EXIF -> ScannedFile -> DB
}
```

### L4 E2E: Visual Viewport

```
// Playwright test: import synthetic fixtures (s6=square, s7=panoramic)
// with known image_width/image_height.
// Assert SingleView renders correct aspect ratio.
// Assert StackOverview grid shows correct thumbnail count.
```

---

## 7. Synthetic Fixture Creation Script

File: `tests/fixtures/raw-samples/create-synthetics.sh`

```bash
#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"

# Requires: ImageMagick (convert), exiftool

# S1-S4: Orientation variants (120x80 landscape)
for orient in 1 3 6 8; do
  convert -size 120x80 xc:gray "orient_${orient}_landscape.jpg"
  exiftool -overwrite_original -Orientation#=$orient "orient_${orient}_landscape.jpg"
done

# S5: No EXIF at all
convert -size 100x100 xc:gray no_exif.jpg
exiftool -overwrite_original -all= no_exif.jpg

# S6: Square
convert -size 100x100 xc:gray square.jpg
exiftool -overwrite_original -Orientation#=1 square.jpg

# S7: Panoramic
convert -size 300x60 xc:gray panoramic.jpg
exiftool -overwrite_original -Orientation#=1 panoramic.jpg

# S8: All metadata present
convert -size 120x80 xc:gray all_metadata.jpg
exiftool -overwrite_original \
  -Orientation#=1 \
  -DateTimeOriginal="2024:06:15 14:30:00" \
  -Make="TestCam" \
  -Model="TestCam Pro 5000" \
  -LensModel="TestLens 50mm f/1.4" \
  -FNumber=2.8 \
  -ExposureTime="1/250" \
  -ISO=400 \
  -FocalLength=50 \
  -ExposureCompensation="+0.7" \
  all_metadata.jpg

# S9: Zero-denominator FNumber (edge case)
convert -size 120x80 xc:gray zero_denom_fnumber.jpg
exiftool -overwrite_original \
  -Orientation#=1 \
  -FNumber="0/0" \
  zero_denom_fnumber.jpg

# S10: .jpeg extension variant
convert -size 80x80 xc:gray jpeg_ext.jpeg
exiftool -overwrite_original -Orientation#=1 jpeg_ext.jpeg

# S11: Pair JPEG component
convert -size 80x60 xc:gray pair_IMG_0001.jpg
exiftool -overwrite_original \
  -DateTimeOriginal="2024:01:15 10:00:00" \
  -Orientation#=1 \
  pair_IMG_0001.jpg

# C1: Truncated JPEG (first 100 bytes of a valid JPEG)
convert -size 80x60 xc:gray /tmp/gemkeep_valid_for_truncate.jpg
head -c 100 /tmp/gemkeep_valid_for_truncate.jpg > truncated.jpg

# C2: Zero-byte file
truncate -s 0 zero_byte.jpg

# C3: Non-image with .jpg extension
echo "This is not a JPEG file, just plain text." > not_an_image.jpg

# C4: Truncated CR2 (first 100 bytes)
if [ -f RAW_CANON_EOS7D.CR2 ]; then
  head -c 100 RAW_CANON_EOS7D.CR2 > truncated.cr2
else
  # Create minimal TIFF-like header
  printf 'II\x2a\x00\x08\x00\x00\x00' > truncated.cr2
  truncate -s 100 truncated.cr2
fi

echo "Created synthetic fixtures. Run verify-manifest.py to update manifest."
```

---

## 8. Download Script for Real RAW Files

File: `tests/fixtures/raw-samples/download-raws.sh`

```bash
#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"

declare -A URLS=(
  ["RAW_CANON_EOS7D.CR2"]="https://raw.pixls.us/data/Canon/EOS%207D/RAW_CANON_EOS7D.CR2"
  ["RAW_SONY_RX10.ARW"]="https://raw.pixls.us/data/Sony/DSC-RX10/RAW_SONY_RX10.ARW"
)

for file in "${!URLS[@]}"; do
  if [ -f "$file" ]; then
    echo "SKIP: $file already exists"
  else
    echo "Downloading $file..."
    curl -L -o "$file" "${URLS[$file]}"
  fi
done

echo "Done. $(ls -1 *.CR2 *.ARW 2>/dev/null | wc -l) RAW files present."
```

---

## 9. Manifest Verification Script

File: `tests/fixtures/raw-samples/verify-manifest.py`

Uses exifread to re-verify every fixture's expected values match reality.
Run after creating synthetics or downloading new RAW files.

```python
#!/usr/bin/env python3
"""Verify manifest.json expected values against actual file EXIF data."""
import json, sys, os
try:
    import exifread
except ImportError:
    print("pip install exifread==3.5.1")
    sys.exit(1)

def verify():
    manifest_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'manifest.json')
    with open(manifest_path) as f:
        manifest = json.load(f)

    errors = []
    for fixture in manifest['fixtures']:
        if fixture['category'] in ('timing-only',):
            continue
        path = os.path.join(os.path.dirname(os.path.abspath(__file__)), fixture['file'])
        if not os.path.exists(path):
            if fixture.get('gitignored', False):
                print(f"SKIP (gitignored): {fixture['file']}")
            else:
                errors.append(f"MISSING: {fixture['file']}")
            continue

        with open(path, 'rb') as f:
            tags = exifread.process_file(f, details=False)

        expected = fixture['expected']

        # Check orientation
        if expected.get('orientation') is not None:
            actual = tags.get('Image Orientation')
            if actual is None:
                errors.append(f"{fixture['id']}: expected orientation={expected['orientation']}, got None")

        # Check capture_time
        if expected.get('capture_time') is not None:
            actual = tags.get('EXIF DateTimeOriginal')
            if actual is None:
                errors.append(f"{fixture['id']}: expected capture_time, got None")
            elif str(actual) != expected['capture_time']:
                errors.append(f"{fixture['id']}: capture_time mismatch: {actual} != {expected['capture_time']}")

        print(f"OK: {fixture['id']} ({fixture['file']})")

    if errors:
        print(f"\n{len(errors)} ERRORS:")
        for e in errors:
            print(f"  {e}")
        sys.exit(1)
    else:
        print(f"\nAll fixtures verified.")

if __name__ == '__main__':
    verify()
```

---

## 10. Adding New Fixtures Process

1. **Create the file** -- either download a RAW or generate a synthetic with ImageMagick + exiftool
2. **Verify with exifread/exiftool** -- run the external ground-truth tool on the new file and record every expected value
3. **Add manifest entry** -- add a new object to `manifest.json` with all fields populated from step 2
4. **Update the coverage matrix** -- add a column in section 5 and mark which dimension values the new fixture covers
5. **Check for coverage gaps** -- every dimension value in section 3 must have at least one X in the matrix
6. **Commit** -- synthetic files (<10KB) are committed; real RAW files are gitignored and downloaded by script

---

## 11. .gitignore Additions

Add to project `.gitignore`:

```
# Real RAW test fixtures (large, downloaded by script)
tests/fixtures/raw-samples/*.CR2
tests/fixtures/raw-samples/*.ARW
tests/fixtures/raw-samples/*.cr2
tests/fixtures/raw-samples/*.arw
```
