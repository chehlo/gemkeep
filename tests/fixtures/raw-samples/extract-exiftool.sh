#!/bin/bash
set -euo pipefail
# Extract raw EXIF data from all real-raw fixtures using exiftool.
# Output: exiftool-raw-output.json (committed as source of truth)
#
# Usage: ./extract-exiftool.sh [exiftool_path]
# Then run: python3 normalize-exiftool.py  (to update manifest.json)

cd "$(dirname "$0")"
EXIFTOOL="${1:-exiftool}"

if ! command -v "$EXIFTOOL" &>/dev/null; then
  echo "ERROR: exiftool not found. Pass path as argument or install it."
  exit 1
fi

FILES=(
  RAW_CANON_EOS7D.CR2
  RAW_SONY_RX10.ARW
  RAW_NIKON_D850.NEF
  RAW_FUJIFILM_XT50.RAF
  RAW_PANASONIC_GH6.RW2
)

PRESENT=()
for f in "${FILES[@]}"; do
  if [ -f "$f" ]; then
    PRESENT+=("$f")
  else
    echo "SKIP: $f not found" >&2
  fi
done

if [ ${#PRESENT[@]} -eq 0 ]; then
  echo "ERROR: No fixture files found. Run setup-fixtures.sh first."
  exit 1
fi

# Extract numeric EXIF values (-n for numeric, -G1 for group names)
"$EXIFTOOL" -j -G1 -n \
  -Make -Model -Orientation -DateTimeOriginal \
  -FNumber -ExposureTime -FocalLength -ISO \
  -ExposureCompensation -LensModel \
  -ImageWidth -ImageHeight \
  "${PRESENT[@]}" > exiftool-raw-output.json 2>/dev/null

# Extract decoded lens ID separately (without -n so LensID is human-readable)
"$EXIFTOOL" -j -G1 \
  -Composite:LensID \
  "${PRESENT[@]}" > exiftool-lens-id.json 2>/dev/null

echo "Extracted ${#PRESENT[@]} files -> exiftool-raw-output.json + exiftool-lens-id.json"
echo "Next: python3 normalize-exiftool.py"
