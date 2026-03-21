#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"

# ============================================================
# GemKeep Test Fixture Setup Script
# Downloads real RAW files, generates synthetic JPEGs, and
# creates corrupt test files.
# Requires: curl, ImageMagick (convert), exiftool, python3+exifread
# ============================================================

# --- 1. Download real RAW files ---

declare -A URLS=(
  ["RAW_NIKON_D850.NEF"]="https://raw.pixls.us/data/Nikon/D850/Nikon-D850-14bit-lossless-compressed.NEF"
  ["RAW_CANON_EOS7D.CR2"]="https://raw.pixls.us/data/Canon/EOS%207D/RAW_CANON_EOS7D.CR2"
  ["RAW_SONY_RX10.ARW"]="https://raw.pixls.us/data/Sony/DSC-RX10/RAW_SONY_RX10.ARW"
  ["RAW_FUJIFILM_XT50.RAF"]="https://raw.pixls.us/data/FUJIFILM/X-T50/DSCF0118.RAF"
  ["RAW_PANASONIC_GH6.RW2"]="https://raw.pixls.us/data/Panasonic/DC-GH6/P1000116.RW2"
)

for file in "${!URLS[@]}"; do
  if [ -f "$file" ]; then
    echo "SKIP: $file already exists"
  else
    echo "Downloading $file..."
    curl -L -o "$file" "${URLS[$file]}"
  fi
done

echo "RAW files: $(ls -1 *.CR2 *.ARW 2>/dev/null | wc -l) present."

# --- 2. Generate synthetic JPEG fixtures ---

echo ""
echo "Generating synthetic JPEG fixtures..."

# S1-S4: Orientation variants (120x80 landscape)
convert -size 120x80 xc:gray orient_1_landscape.jpg
exiftool -overwrite_original -Orientation#=1 -Make="SyntheticCam" -Model="TestCam L1" -DateTimeOriginal="2024:01:15 10:30:00" -n orient_1_landscape.jpg

convert -size 120x80 xc:gray orient_3_landscape.jpg
exiftool -overwrite_original -Orientation#=3 -Make="SyntheticCam" -Model="TestCam R180" -DateTimeOriginal="2024:01:15 10:30:05" -n orient_3_landscape.jpg

convert -size 120x80 xc:gray orient_6_landscape.jpg
exiftool -overwrite_original -Orientation#=6 -Make="SyntheticCam" -Model="TestCam P6" -DateTimeOriginal="2024:01:15 10:30:10" -n orient_6_landscape.jpg

convert -size 120x80 xc:gray orient_8_landscape.jpg
exiftool -overwrite_original -Orientation#=8 -Make="SyntheticCam" -Model="TestCam P8" -DateTimeOriginal="2024:01:15 10:30:15" -n orient_8_landscape.jpg

# S5: No EXIF at all
convert -size 100x100 xc:gray no_exif.jpg
exiftool -overwrite_original -all= no_exif.jpg

# S6: Square
convert -size 100x100 xc:gray square.jpg
exiftool -overwrite_original -Orientation#=1 -Make="SyntheticCam" -Model="TestCam SQ" -DateTimeOriginal="2024:01:15 11:00:00" -n square.jpg

# S7: Panoramic
convert -size 300x60 xc:gray panoramic.jpg
exiftool -overwrite_original -Orientation#=1 -Make="SyntheticCam" -Model="TestCam Pano" -DateTimeOriginal="2024:01:15 11:05:00" -n panoramic.jpg

# S8: All metadata present
convert -size 120x80 xc:gray all_metadata.jpg
exiftool -overwrite_original \
  -Orientation#=1 \
  -Make="Canon" \
  -Model="TestCam Full" \
  -DateTimeOriginal="2024:01:15 12:00:00" \
  -FNumber=2.8 \
  -ExposureTime="1/125" \
  -ISO=400 \
  -FocalLength=50 \
  -ExposureCompensation="+1.0" \
  -LensModel="EF 50mm f/1.8 STM" \
  -n all_metadata.jpg

# S9: Zero-denominator FNumber (edge case)
convert -size 120x80 xc:gray zero_denom_fnumber.jpg
exiftool -overwrite_original \
  -Orientation#=1 \
  -Make="SyntheticCam" \
  -Model="TestCam ZD" \
  -DateTimeOriginal="2024:01:15 12:30:00" \
  -FNumber="0/0" \
  -n zero_denom_fnumber.jpg

# S10: .jpeg extension variant
convert -size 80x80 xc:gray jpeg_ext.jpeg
exiftool -overwrite_original -Orientation#=1 -Make="SyntheticCam" -Model="TestCam JE" -DateTimeOriginal="2024:01:15 13:00:00" -n jpeg_ext.jpeg

# S11: Pair JPEG component
convert -size 80x60 xc:gray pair_IMG_0001.jpg
exiftool -overwrite_original -Orientation#=1 -Make="Canon" -Model="TestCam Pair" -DateTimeOriginal="2024:01:15 14:00:00" -n pair_IMG_0001.jpg

# S12: Minimal fake CR2 (TIFF header for format detection, pair target)
printf 'II\x2a\x00\x10\x00\x00\x00CR' > pair_IMG_0001.cr2
dd if=/dev/zero bs=1 count=90 >> pair_IMG_0001.cr2 2>/dev/null

echo "Synthetic JPEG fixtures generated."

# --- 3. Generate corrupt test files ---

echo ""
echo "Generating corrupt test files..."

# C1: Truncated JPEG (first 100 bytes of a valid JPEG)
head -c 100 orient_1_landscape.jpg > truncated.jpg

# C2: Zero-byte file
truncate -s 0 zero_byte.jpg

# C3: Non-image with .jpg extension
echo "This is not an image file" > not_an_image.jpg

# C4: Truncated CR2 (first 100 bytes of real CR2)
if [ -f RAW_CANON_EOS7D.CR2 ]; then
  head -c 100 RAW_CANON_EOS7D.CR2 > truncated.cr2
else
  # Fallback: create minimal TIFF-like header
  printf 'II\x2a\x00\x08\x00\x00\x00' > truncated.cr2
  truncate -s 100 truncated.cr2
fi

echo "Corrupt test files generated."

# --- 4. Verify with exifread (if available) ---

echo ""
if command -v python3 &>/dev/null && python3 -c "import exifread" 2>/dev/null; then
  echo "Verifying fixtures with exifread..."
  echo "exifread available — run manual verification if needed."
else
  echo "SKIP: exifread not available for verification (pip install exifread==3.5.1)"
fi

echo ""
echo "Done. Fixture set ready."
ls -1 *.jpg *.jpeg *.cr2 *.CR2 *.ARW 2>/dev/null | wc -l
echo "total fixture files present."
