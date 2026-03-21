# Sprint 8: Bug Fixes + RAW Preview — COMPLETE

**Branch:** sprint-7
**Completed:** 2026-03-12

## Bugs Fixed

### BUG-08: SingleView photo overflows viewport ✅
- **RED:** `65126e9` — browser test: image fits container (fillRatio >= 0.5)
- **GREEN:** `703024b` — `h-screen overflow-hidden` on root, `min-h-0` on flex container, `w-full h-full object-contain` on img
- **Root cause:** CSS flexbox `min-height: auto` default prevents flex items from shrinking below content size

### BUG-09: StackFocus header scrolls out of view ✅
- **RED:** `d9b3e84` — browser test: header top >= 0 after scrolling content
- **GREEN:** `df369f4` — `sticky top-0 z-10` on header, `overflow-y-auto min-h-0` on content
- **Also fixed:** StackOverview had same issue (`5404415`)

### BUG-10: RAW-only photos show as small square ✅
- **RED:** `6c138d5` — browser test: preview_path used over thumbnail_path; Rust tests for save_raw_preview
- **GREEN:** `acdce9a` — `save_raw_preview()` saves full-size embedded JPEG (~1620×1080) as `{id}_preview.jpg`, `get_photo_detail()` returns `preview_path`, SingleView fallback chain: jpeg_path → preview_path → thumbnail_path

## Quality Gate
- 370 Rust tests pass (5 new)
- 284 frontend tests pass (2 new browser tests)
- Clippy clean, fmt clean
- No RED tests modified during GREEN
