#!/usr/bin/env python3
"""Normalize raw exiftool JSON output into manifest expected values.

Source of truth: exiftool-raw-output.json (exiftool -j -G1 -n)
Output: updates manifest.json expected values for real-raw fixtures.

=== Architecture ===

  1. exiftool-raw-output.json = verbatim exiftool output (committed, never edited by hand)
  2. This script = adaptation layer that normalizes exiftool output to match rawler behavior
  3. manifest.json expected values = normalized output consumed by tests

=== Library dispatch (extract_metadata in exif.rs) ===

  - JPEG → kamadak-exif (standard TIFF/EXIF reader)
  - ALL RAW (CR2, CR3, NEF, ARW, RAF, RW2) → rawler

rawler is the single library for ALL RAW formats because:
  - It handles both TIFF-based (CR2/NEF/ARW) and custom containers (RAF/RW2)
  - It reads MakerNotes, providing lens info for Canon/Nikon that kamadak-exif misses

=== Adaptation: exiftool → rawler behavior ===

Since rawler is the Rust extraction library and exiftool is the ground truth data source,
this script must produce values matching what our Rust code returns.

Key differences this layer accounts for:

  camera_model:
    - Displayed as "Make Model" (e.g. "Canon EOS 7D", "SONY DSC-RX10")
    - Avoids duplication: if model already starts with make's first word, don't prepend
      (Canon: "Canon EOS 7D" already has it; Nikon: "NIKON D850" already has "NIKON")

  lens:
    - exiftool may have LensModel in ExifIFD (standard) or MakerNotes (Canon:, etc.)
    - Composite:LensID (decoded without -n) provides human-readable lens name from
      vendor-specific databases
    - Fallback chain: ExifIFD:LensModel → MakerNotes:LensModel → Composite:LensID

  ImageWidth/Height:
    - NOT part of our Rust ExifData struct
    - Used only for display_orientation in manifest
    - Source varies by format — see DIMENSION_RULES
"""
import json
import os
import sys

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
RAW_OUTPUT = os.path.join(SCRIPT_DIR, "exiftool-raw-output.json")
LENS_ID_OUTPUT = os.path.join(SCRIPT_DIR, "exiftool-lens-id.json")
MANIFEST = os.path.join(SCRIPT_DIR, "manifest.json")

# Map from fixture filename to manifest fixture id
FIXTURE_MAP = {
    "RAW_CANON_EOS7D.CR2": "r1",
    "RAW_SONY_RX10.ARW": "r2",
    "RAW_NIKON_D850.NEF": "r3",
    "RAW_FUJIFILM_XT50.RAF": "r4",
    "RAW_PANASONIC_GH6.RW2": "r5",
}

# --- Tag resolution rules for exiftool base values ---
# Note: make case may differ between exiftool and rawler (e.g. "SONY" vs "Sony").
# Tests use case-insensitive comparison for camera_model to handle this.

DIMENSION_RULES = {
    ".cr2": [("IFD0:ImageWidth", "IFD0:ImageHeight")],
    ".arw": [("SubIFD:ImageWidth", "SubIFD:ImageHeight")],
    ".nef": [("SubIFD1:ImageWidth", "SubIFD1:ImageHeight"),
             ("SubIFD:ImageWidth", "SubIFD:ImageHeight")],
    ".raf": [("File:ImageWidth", "File:ImageHeight")],
    ".rw2": [("Composite:ImageWidth", "Composite:ImageHeight")],
}


def resolve_tag(data, candidates):
    """Return first non-None value from candidate keys."""
    for key in candidates:
        if key in data:
            return data[key]
    return None


def resolve_dimensions(data, ext):
    """Resolve image dimensions using format-specific rules."""
    rules = DIMENSION_RULES.get(ext.lower(), [])
    for w_key, h_key in rules:
        w = data.get(w_key)
        h = data.get(h_key)
        if w is not None and h is not None:
            return int(w), int(h)
    return None, None


def format_shutter_speed(et_val):
    """Convert numeric ExposureTime to human-readable string."""
    if et_val is None:
        return None
    et = float(et_val)
    if et <= 0:
        return None
    if et < 1:
        return f"1/{round(1 / et)}"
    return f"{et}s"


def compute_display_orientation(orient, width, height):
    """Determine display orientation from EXIF orientation + dimensions."""
    if width is None or height is None:
        return None
    if orient in (6, 8):
        return "portrait" if width > height else "landscape"
    if width == height:
        return "square"
    if width < height:
        return "portrait"
    return "landscape"


def normalize_entry(data, lens_id_data=None):
    """Convert one exiftool -G1 -n record to manifest expected values."""
    source_file = data["SourceFile"]
    ext = os.path.splitext(source_file)[1]

    make = resolve_tag(data, ("IFD0:Make",))
    raw_model = resolve_tag(data, ("IFD0:Model",))

    # camera_model = "Make Model", avoiding duplication when model already contains make.
    # Check if model starts with the first word of make (handles "NIKON CORPORATION" / "NIKON D850").
    if make and raw_model:
        make_first = make.strip().split()[0].upper()
        if raw_model.strip().upper().startswith(make_first):
            model = raw_model.strip()
        else:
            model = f"{make.strip()} {raw_model.strip()}"
    else:
        model = raw_model

    orient = resolve_tag(data, ("IFD0:Orientation",))
    if orient is not None:
        orient = int(orient)

    dt = resolve_tag(data, ("ExifIFD:DateTimeOriginal",))

    fnumber = resolve_tag(data, ("ExifIFD:FNumber",))
    if fnumber is not None:
        fnumber = round(float(fnumber), 2)
        if fnumber == int(fnumber):
            fnumber = float(int(fnumber))

    iso = resolve_tag(data, ("ExifIFD:ISO", "IFD0:ISO"))
    if iso is not None:
        iso = int(iso)

    focal = resolve_tag(data, ("ExifIFD:FocalLength",))
    if focal is not None:
        focal = round(float(focal), 2)
        if focal == int(focal):
            focal = float(int(focal))

    et_val = resolve_tag(data, ("ExifIFD:ExposureTime",))
    shutter = format_shutter_speed(et_val)

    exp_comp = resolve_tag(data, ("ExifIFD:ExposureCompensation",))
    if exp_comp is not None:
        exp_comp = round(float(exp_comp), 2)
        if exp_comp == int(exp_comp):
            exp_comp = float(int(exp_comp))

    # Lens: try standard ExifIFD:LensModel first, then MakerNotes LensModel,
    # then Composite:LensID (decoded by exiftool from vendor-specific lens databases).
    lens = resolve_tag(data, ("ExifIFD:LensModel",))
    if lens is None:
        # Check MakerNotes LensModel (e.g. Canon:LensModel)
        for key in data:
            if key.endswith(":LensModel") and key != "ExifIFD:LensModel":
                lens = data[key]
                break
    if lens is None and lens_id_data:
        # Composite:LensID is decoded by exiftool into human-readable lens name
        lens = lens_id_data.get("Composite:LensID")

    width, height = resolve_dimensions(data, ext)
    display = compute_display_orientation(orient, width, height)

    return {
        "make": make,
        "camera_model": model,
        "orientation": orient,
        "capture_time": dt,
        "capture_time_present": dt is not None,
        "aperture": fnumber,
        "iso": iso,
        "focal_length": focal,
        "shutter_speed": shutter,
        "exposure_comp": exp_comp,
        "lens": lens,
        "image_width": width,
        "image_height": height,
        "thumbnail_expected_width": 256,
        "thumbnail_expected_height": 256,
        "display_orientation": display,
        "file_valid": True,
        "exif_parseable": True,
    }


def main():
    with open(RAW_OUTPUT) as f:
        raw_data = json.load(f)

    with open(MANIFEST) as f:
        manifest = json.load(f)

    # Load lens ID data (decoded without -n flag)
    lens_id_lookup = {}
    if os.path.exists(LENS_ID_OUTPUT):
        with open(LENS_ID_OUTPUT) as f:
            lens_id_data = json.load(f)
        for entry in lens_id_data:
            lens_id_lookup[entry["SourceFile"]] = entry

    # Build lookup: filename -> normalized expected
    normalized = {}
    for entry in raw_data:
        source = entry["SourceFile"]
        normalized[source] = normalize_entry(entry, lens_id_lookup.get(source))

    # Update manifest fixtures (preserve existing key order)
    updated = 0
    for fixture in manifest["fixtures"]:
        if fixture.get("category") != "real-raw":
            continue
        fname = fixture.get("file")
        if fname not in normalized:
            print(f"SKIP: {fname} not in exiftool output", file=sys.stderr)
            continue
        new_vals = normalized[fname]
        existing = fixture["expected"]
        # Update values in-place preserving key order, then add any new keys
        for key in list(existing.keys()):
            if key in new_vals:
                existing[key] = new_vals[key]
        for key in new_vals:
            if key not in existing:
                existing[key] = new_vals[key]
        fixture_id = FIXTURE_MAP.get(fname, fixture.get("id", "?"))
        print(f"Updated {fixture_id} ({fname})")
        updated += 1

    # Update ground truth tool version
    manifest["ground_truth_tool"] = "exiftool 13.52 + rawler (normalize-exiftool.py)"

    with open(MANIFEST, "w") as f:
        json.dump(manifest, f, indent=2)
        f.write("\n")

    print(f"Done. {updated} fixtures updated.")


if __name__ == "__main__":
    main()
