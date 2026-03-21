#!/bin/bash
set -euo pipefail

# Usage: ./add-camera.sh <LOCAL_NAME> <URL> [exifread_python]
# Example: ./add-camera.sh RAW_NIKON_D850.NEF "https://raw.pixls.us/data/Nikon/D850/Nikon-D850-14bit-lossless-compressed.NEF"
#
# What it does:
# 1. Downloads the file (if not already present)
# 2. Extracts EXIF ground truth via exifread (Python)
# 3. Generates a manifest entry JSON fragment
# 4. Adds the filename to .gitignore (if not already there)
# 5. Adds the URL to setup-fixtures.sh download section
#
# You then review the generated fragment and paste it into manifest.json.

cd "$(dirname "$0")"

if [ $# -lt 2 ]; then
  echo "Usage: $0 <LOCAL_FILENAME> <DOWNLOAD_URL> [python3_path]"
  echo "Example: $0 RAW_NIKON_D850.NEF 'https://raw.pixls.us/data/Nikon/D850/Nikon-D850-14bit-lossless-compressed.NEF'"
  exit 1
fi

LOCAL_NAME="$1"
URL="$2"
PYTHON="${3:-python3}"
FRAGMENT_FILE="${LOCAL_NAME%.???}.manifest-entry.json"

# --- 1. Download ---
if [ -f "$LOCAL_NAME" ]; then
  echo "SKIP download: $LOCAL_NAME already exists ($(du -h "$LOCAL_NAME" | cut -f1))"
else
  echo "Downloading $LOCAL_NAME..."
  curl -L -o "$LOCAL_NAME" "$URL"
  echo "Downloaded: $(du -h "$LOCAL_NAME" | cut -f1)"
fi

# --- 2. Verify it's a real file, not an error page ---
FILE_SIZE=$(stat -c%s "$LOCAL_NAME")
if [ "$FILE_SIZE" -lt 1000 ]; then
  echo "WARNING: File is only $FILE_SIZE bytes — may be an error page, not a RAW file."
  echo "Contents:"
  head -c 200 "$LOCAL_NAME"
  echo ""
  echo "Aborting. Check the URL and try again."
  rm -f "$LOCAL_NAME"
  exit 1
fi

# --- 3. Extract EXIF ground truth via exiftool ---
# exiftool is the industry standard and supports ALL RAW formats.
# No fallbacks needed — single tool covers everything.
EXIFTOOL="${EXIFTOOL:-exiftool}"
echo ""
echo "Extracting EXIF with exiftool..."

if ! command -v "$EXIFTOOL" &>/dev/null; then
  echo "ERROR: exiftool not found. Install it: sudo apt install libimage-exiftool-perl"
  echo "  Or set EXIFTOOL=/path/to/exiftool"
  exit 1
fi

EXIF_JSON=$($PYTHON -c "
import subprocess, json, sys

raw = subprocess.run(
    ['$EXIFTOOL', '-json', '-n',
     '-Make', '-Model', '-Orientation', '-DateTimeOriginal',
     '-FNumber', '-ExposureTime', '-FocalLength',
     '-ISO', '-ExposureCompensation', '-LensModel',
     '-ImageWidth', '-ImageHeight',
     '$LOCAL_NAME'],
    capture_output=True, text=True
)
if raw.returncode != 0:
    print(f'exiftool failed: {raw.stderr}', file=sys.stderr)
    sys.exit(1)

d = json.loads(raw.stdout)[0]

def num(key):
    v = d.get(key)
    if v is None: return None
    try: return float(v) if '.' in str(v) else int(v)
    except: return None

orient = num('Orientation')
aperture = num('FNumber')
iso = num('ISO')
focal = num('FocalLength')
exp_comp = num('ExposureCompensation')

# Format shutter speed: exiftool returns it as a string like '1/320' or as a float
et_raw = d.get('ExposureTime')
shutter = None
if et_raw is not None:
    if isinstance(et_raw, str) and '/' in et_raw:
        shutter = et_raw
    else:
        et_val = float(et_raw)
        if et_val > 0 and et_val < 1:
            shutter = f'1/{round(1/et_val)}'
        elif et_val >= 1:
            shutter = f'{et_val}s'

# Focal length: round to 2 decimal places
if focal is not None:
    focal = round(float(focal), 2)

width = num('ImageWidth')
height = num('ImageHeight')

# Display orientation
display = 'landscape'
if orient in [6, 8] and width and height:
    display = 'portrait' if width > height else 'landscape'
elif width and height:
    if width == height:
        display = 'square'
    elif width < height:
        display = 'portrait'

result = {
    'make': d.get('Make'),
    'camera_model': d.get('Model'),
    'orientation': orient,
    'capture_time': d.get('DateTimeOriginal'),
    'capture_time_present': d.get('DateTimeOriginal') is not None,
    'aperture': aperture,
    'iso': iso,
    'focal_length': focal,
    'shutter_speed': shutter,
    'exposure_comp': exp_comp,
    'lens': d.get('LensModel'),
    'image_width': width,
    'image_height': height,
    'display_orientation': display,
    'file_valid': True,
    'exif_parseable': True
}
print(json.dumps(result, indent=2))
" 2>&1)

if [ $? -ne 0 ]; then
  echo "ERROR: exiftool extraction failed."
  echo "$EXIF_JSON"
  exit 1
fi

echo "$EXIF_JSON"

# --- 4. Detect format from extension ---
EXT="${LOCAL_NAME##*.}"
EXT_LOWER=$(echo "$EXT" | tr '[:upper:]' '[:lower:]')

FORMAT_DIM="format:$EXT_LOWER"

# --- 5. Generate manifest entry fragment ---
MAKE=$(echo "$EXIF_JSON" | $PYTHON -c "import json,sys; d=json.load(sys.stdin); print(d.get('make','').strip() if d.get('make') else '')")
MODEL=$(echo "$EXIF_JSON" | $PYTHON -c "import json,sys; d=json.load(sys.stdin); print(d.get('camera_model','').strip() if d.get('camera_model') else '')")

# Build the ID from make + model
MAKE_SLUG=$(echo "$MAKE" | tr '[:upper:]' '[:lower:]' | tr ' ' '_')
MODEL_SLUG=$(echo "$MODEL" | tr '[:upper:]' '[:lower:]' | tr ' ' '_' | tr -d '()')

cat > "$FRAGMENT_FILE" <<FRAG_EOF
{
  "id": "r_${MAKE_SLUG}_${MODEL_SLUG}",
  "file": "$LOCAL_NAME",
  "category": "real-raw",
  "source": "$URL",
  "gitignored": true,
  "dimensions_covered": [
    "$FORMAT_DIM",
    "orientation:$(echo "$EXIF_JSON" | $PYTHON -c "import json,sys; print(json.load(sys.stdin).get('orientation',1))")",
    "time:valid",
    "meta:all",
    "thumb:standard",
    "integrity:valid",
    "pairing:raw_only"
  ],
  "test_layers": ["exif", "thumbnail", "pipeline"],
  "expected": $(echo "$EXIF_JSON" | $PYTHON -c "
import json, sys
d = json.load(sys.stdin)
d['thumbnail_expected_width'] = 256
d['thumbnail_expected_height'] = 256
print(json.dumps(d, indent=4))
")
}
FRAG_EOF

echo ""
echo "=== Manifest entry written to: $FRAGMENT_FILE ==="
echo ""

# --- 6. Add to .gitignore if not already there ---
if ! grep -qF "$LOCAL_NAME" .gitignore 2>/dev/null; then
  echo "$LOCAL_NAME" >> .gitignore
  echo "Added $LOCAL_NAME to .gitignore"
else
  echo "$LOCAL_NAME already in .gitignore"
fi

# --- 7. Add to setup-fixtures.sh download section ---
if ! grep -qF "$LOCAL_NAME" setup-fixtures.sh 2>/dev/null; then
  # Insert into the URLS associative array
  sed -i "/^declare -A URLS=(/a\\  [\"$LOCAL_NAME\"]=\"$URL\"" setup-fixtures.sh
  echo "Added $LOCAL_NAME to setup-fixtures.sh"
else
  echo "$LOCAL_NAME already in setup-fixtures.sh"
fi

echo ""
echo "=== Done! ==="
echo "Next steps:"
echo "  1. Review $FRAGMENT_FILE"
echo "  2. Add it to manifest.json fixtures array"
echo "  3. git add .gitignore setup-fixtures.sh manifest.json"
