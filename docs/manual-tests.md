# Manual Tests

These tests CANNOT be automated because they require the real Tauri binary
and the WebKitWebView runtime. Run them after any change to the Tauri config,
capabilities, or thumbnail URL generation.

---

## MT-01: Asset Protocol — Thumbnail Images Load

**Trigger:** Any change to:
- `src-tauri/tauri.conf.json` (assetProtocol.scope)
- `src-tauri/capabilities/*.json`
- `src/lib/api/index.ts` (getThumbnailUrl)
- `src-tauri/src/commands/import.rs` (list_stacks thumbnail_path format)

**Setup:**
1. Have a project with at least one source folder containing JPEG photos
2. The project must have been indexed at least once (thumbnails in cache/)

**Steps:**
1. Run: `cargo tauri dev`
2. Open the project in the app → navigate to Stack Overview
3. Wait for thumbnails to generate (or use a pre-indexed project)
4. Open Tauri DevTools:
   - Right-click on the app window → "Inspect Element"
   - OR launch with: `WEBKIT_INSPECTOR_SERVER=127.0.0.1:8080 cargo tauri dev`
5. Go to **Network** tab
6. Refresh/re-navigate to trigger thumbnail loading
7. Filter by `asset://`

**Expected:**
- All `asset://localhost/...` requests return **200 OK**
- No requests show **403 Forbidden** or **ERR_UNKNOWN_URL_SCHEME**
- Thumbnail images are VISIBLE in the stack grid (not placeholder icons)

**Failure signature:**
```
ERROR tauri::protocol::asset: asset protocol not configured to allow the path ...
```
If you see this, check `src-tauri/tauri.conf.json` assetProtocol.scope.
Valid scope entries must start with `/` or a Tauri path variable like `$HOME`.
Use `/**` to allow all absolute paths (safest option).

---

## MT-02: Indexing Progress Bar Is Not Misleading

**Trigger:** Any change to StackOverview.svelte progress display

**Steps:**
1. Open a project with source folders
2. Press `r` to re-index
3. Watch the progress bar

**Expected:**
- During EXIF scan: shows "Indexing…" with a bar that advances from 0% to 100%
- During thumbnail generation: shows "Generating thumbnails…" with an animation
  that is clearly NOT a static 100% bar (it should spin or pulse without being w-full)
- NEVER shows a static full-width blue bar that looks like "complete"

---

## MT-03: SQLite Database State

**After an index run, verify DB contents:**
```bash
DB=~/.gem-keep/projects/{slug}/project.db
sqlite3 $DB ".tables"
# Expected: decisions logical_photos migrations photos rounds source_folders stacks

sqlite3 $DB "SELECT COUNT(*) FROM photos"
sqlite3 $DB "SELECT COUNT(*) FROM stacks"
sqlite3 $DB "SELECT COUNT(*) FROM logical_photos"
sqlite3 $DB "SELECT path, format, capture_time FROM photos LIMIT 5"
```

---

## MT-04: Thumbnail Dimensions

**Verify thumbnail files are correct size:**
```bash
ls ~/.gem-keep/projects/{slug}/cache/thumbnails/ | head -5

# If ImageMagick is installed:
identify ~/.gem-keep/projects/{slug}/cache/thumbnails/1.jpg
# Expected: 1.jpg JPEG 256x256 ...

# Pure bash alternative:
python3 -c "
from PIL import Image
img = Image.open('$HOME/.gem-keep/projects/{slug}/cache/thumbnails/1.jpg')
print(img.size)  # Should be (256, 256)
"
```
