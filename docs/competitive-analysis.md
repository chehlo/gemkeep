# Competitive Analysis: Keyboard-First Photo Culling Tools

*Research date: February 2026*
*Purpose: Inform GemKeep's UX design for keyboard-first, stack-based photo culling*

---

## 1. Tool-by-Tool Analysis

### 1.1 Photo Mechanic Plus

**Overview:** The industry gold standard for speed-focused photo culling, trusted by sports photographers, photojournalists, and wedding photographers. Photo Mechanic is purpose-built for one thing: getting through thousands of photos as fast as humanly possible.

**Core Speed Secret:** Photo Mechanic reads the embedded JPEG preview inside RAW files instead of rendering the RAW data. This means zero rendering delay -- images appear instantly regardless of file size or megapixel count. Photographers report flipping through ~30 images in 8 seconds with no lag.

**Key Workflow Patterns:**
- **Ingestion-first design:** Photos are copied from cards while you simultaneously start culling. No waiting for import to finish.
- **Color Class system (0-8):** Eight color classes with customizable names. Single-key assignment when "single key shortcuts" is enabled in Preferences > Accessibility. Number keys 0-8 map directly to color classes, or 0-5 for star ratings.
- **Star ratings (0-5):** Standard XMP-compatible star ratings. Default shortcuts are Ctrl+0 through Ctrl+5 (or single keys 0-5 when accessibility mode enabled).
- **Auto-advance on rating:** Once a color class or star rating is applied, Photo Mechanic automatically advances to the next photo. No extra keypress needed.
- **Embedded JPEG preview mode:** "Use embedded JPEG Preview for speed" setting ensures RAW files display the camera-generated JPEG instantly rather than rendering the RAW.
- **Contact sheet + Preview window:** Contact sheet (grid) for overview, double-click or Enter opens Preview window for full-size single-image view.
- **Multi-view comparison:** Compare up to 4 images side-by-side for sequence analysis.
- **Filtering by color class:** Cmd/Ctrl+F1 through F9 to filter by color class. F1 shows all.
- **Metadata templates (IPTC):** Bulk-apply captions, keywords, copyright during ingest -- reduces post-cull work.

**Navigation:**
- Arrow keys to move between photos in contact sheet and preview
- Space/Enter to open preview from contact sheet
- Home/End to jump to first/last photo

**What Makes It Fast:**
1. Embedded JPEG preview eliminates rendering wait
2. Single-key decisions (no modifier keys needed)
3. Auto-advance eliminates navigation keypress after decisions
4. Can cull during ingestion (no import-then-cull bottleneck)
5. Disk + memory cache maximized (configurable, e.g., 1024 MB each)
6. High DPI quality set to "Standard (fastest)" mode

---

### 1.2 FastRawViewer

**Overview:** The only dedicated tool designed specifically for RAW-accurate culling. Where Photo Mechanic shows embedded JPEGs, FastRawViewer actually renders RAW data -- but does so extremely quickly. Aimed at photographers who need to evaluate true RAW exposure before importing into Lightroom or Capture One.

**Core Speed Secret:** FastRawViewer renders RAW files as a RAW processor would (like ACR/Lightroom), but is optimized purely for viewing speed -- no catalog, no editing overhead. This gives accurate histograms and exposure evaluation that embedded JPEG previews cannot provide.

**Key Workflow Patterns:**
- **RAW-accurate histogram:** Shows all 3 channels with true clipping detection. Photographers can immediately see if a shot is truly overexposed vs. just having a hot JPEG preview.
- **Overexposure/underexposure visualization:** Dedicated overlays showing blown highlights and crushed shadows on the actual RAW data.
- **Focus peaking (Edges):** Highlights in-focus areas, critical for evaluating sharpness at a glance without zooming to 100%.
- **Details overlay:** Shows highly detailed areas vs. noisy areas.
- **XMP sidecar workflow:** Ratings and labels written to XMP files, which Lightroom/Capture One read on import. Cull decisions carry forward seamlessly.
- **Reject rating (-1):** Dedicated reject status (optional, Adobe Bridge compatible). Press Alt+Del to reject.
- **Move/Copy to folders:** Physical file operations during culling -- move rejects to `_rejected` folder, selections to `_selected` folder.
- **Grid + Single image toggle:** Press G to switch between grid overview and single image view.

**Default Keyboard Shortcuts:**
| Action | Windows | macOS |
|---|---|---|
| Next file | Ctrl+Right / Space | Cmd+Right / Space |
| Previous file | Ctrl+Left / Backspace | Cmd+Left / Backspace |
| First file | Ctrl+Shift+Left | Cmd+Shift+Left |
| Last file | Ctrl+Shift+Right | Cmd+Shift+Right |
| Rating 1-5 | Alt+1 through Alt+5 | Opt+1 through Opt+5 |
| No rating | Alt+0 | Opt+0 |
| Reject | Alt+Del | Opt+Backspace |
| Red label | Alt+6 | Opt+6 |
| Yellow label | Alt+7 | Opt+7 |
| Green label | Alt+8 | Opt+8 |
| Blue label | Alt+9 | Opt+9 |
| Move to folder | M | M |
| Copy to folder | C | C |
| Grid/Image toggle | G | G |
| Fit to window | Ctrl+0 | Cmd+0 |
| Actual size (1:1) | Ctrl+1 | Cmd+1 |

**What Makes It Unique:**
1. True RAW rendering (not embedded JPEG) -- accurate exposure evaluation
2. RAW histogram reveals true clipping that JPEG preview hides
3. Focus peaking without zooming to 100%
4. XMP sidecar output integrates with any RAW processor
5. No catalog overhead -- works directly on filesystem
6. All shortcuts fully customizable (Ctrl+K to configure)

**Limitation:** Requires modifier keys (Alt+) for ratings, making it slightly slower than Photo Mechanic's single-key approach. Navigation also requires Ctrl+Arrow rather than bare arrow keys.

---

### 1.3 Adobe Lightroom Classic

**Overview:** The mainstream reference tool for photo management and editing. While not purpose-built for culling speed, Lightroom's Library module provides the most widely-known culling workflow. Its keyboard shortcuts have become de facto industry standards.

**Core Workflow Pattern:** Import all photos into catalog first, then cull in Library module using flags, ratings, and color labels. The typical flow is: Import -> Flag (P/X) with auto-advance -> Filter flagged -> Rate (1-5) -> Export/Develop.

**Key Workflow Patterns:**
- **P/X/U Flagging:** The most recognized culling shortcut set in photography. P = Pick (white flag), X = Reject (black flag with X), U = Unflag (clear). Binary decision-making at its simplest.
- **Auto-advance via Caps Lock:** Toggle Caps Lock on and Lightroom automatically advances to the next photo after any flag/rating/label action. This is the "culling mode" toggle -- elegant because it repurposes an existing key.
- **Star ratings (1-5, 0):** Press number keys 1-5 to rate, 0 to clear. With Caps Lock on, auto-advances after rating.
- **Color labels (6-9):** Press 6 (Red), 7 (Yellow), 8 (Green), 9 (Blue). Used as secondary categorization alongside flags/stars.
- **Four view modes:** Grid (G), Loupe/single (E), Compare (C), Survey (N). Each serves a different phase of culling.
- **Survey view (N):** Select multiple photos, press N to see them all at once. Click X on any to dismiss. Excellent for picking the best from a burst.
- **Compare view (C):** Side-by-side comparison of two photos with synchronized zoom/pan.
- **Filter bar:** After flagging, use the filter bar to show only Picks, then rate those. Layered refinement.
- **AI Assisted Culling (2025):** New Early Access feature that auto-suggests picks for portraits/headshots. Indicates industry direction toward AI-assisted culling.

**Default Keyboard Shortcuts (Library Module):**
| Action | Shortcut |
|---|---|
| Pick flag | P |
| Reject flag | X |
| Unflag | U |
| Toggle auto-advance | Caps Lock |
| Rate 1-5 stars | 1, 2, 3, 4, 5 |
| Clear rating | 0 |
| Increase rating | ] |
| Decrease rating | [ |
| Red label | 6 |
| Yellow label | 7 |
| Green label | 8 |
| Blue label | 9 |
| Grid view | G |
| Loupe view | E |
| Compare view | C |
| Survey view | N |
| Next photo | Right arrow |
| Previous photo | Left arrow |
| Delete rejected | Ctrl/Cmd+Backspace |
| Select all flagged | Ctrl/Cmd+Alt+A |

**What Makes It Standard:**
1. Simple mental model: P = Pick, X = Reject (mnemonic shortcuts)
2. Caps Lock auto-advance is an industry-defining UX innovation
3. Layered workflow: flag first, filter, then rate -- progressive refinement
4. Survey view for burst selection is very powerful
5. Color labels as orthogonal categorization axis
6. Deeply integrated with editing (cull and edit in same app)

**Limitation:** Slow preview rendering compared to Photo Mechanic. 3-5 second delay per image when scrolling through RAW files, especially on first pass before Smart Previews are generated. This is why many wedding photographers cull in Photo Mechanic first, then import picks into Lightroom.

---

### 1.4 Capture One

**Overview:** Professional RAW processor favored by studio and fashion photographers. Known for superior color science and tethered shooting. Capture One's culling tools are more recent additions, with the dedicated Cull tool introduced in version 23.

**Core Workflow Pattern:** Session-based or catalog-based. Import photos, then use the Cull tool or manual rating/tagging to select keepers. The Cull tool provides a dedicated culling UI with Group Overview, Face Focus, and filtering.

**Key Workflow Patterns:**
- **Color tags with semantic meaning:** Green (+), Red (-), Yellow (*) as default shortcuts. Photographers often use Green = Keep, Red = Reject, Yellow = Maybe. Up to 8 color tags available.
- **Star ratings (0-5):** Number keys 0-5 for star ratings (same as Lightroom).
- **Select Next When:** Auto-advance feature found in Select > Select Next When > Star Rated / Color Tagged. Automatically moves to next image after assigning a rating or color tag.
- **Cull tool (v23+):** Dedicated toolbar button activates culling mode with Group Overview (shows similar shots grouped), Face Focus (auto-detects faces and shows crop), Star Rating panel, Color Tag panel, and Filters.
- **Group Overview:** Groups similar/sequential shots automatically. Resembles GemKeep's stack concept.
- **Face Focus:** During portrait culling, automatically crops to detected faces for quick expression evaluation.
- **Compare Variant:** Press Enter to set a "reference" image, then scroll through others to compare against it. Shift+Enter or Cmd+Enter to clear.
- **Sets:** Collections of images that work with Select Next When -- after tagging the last image in a set, auto-advances to the first image in the next set.

**Default Keyboard Shortcuts:**
| Action | Shortcut |
|---|---|
| Star rating 0-5 | 0, 1, 2, 3, 4, 5 |
| Green color tag | + |
| Red color tag | - |
| Yellow color tag | * |
| Compare Variant (assign) | Enter |
| Clear Compare Variant | Cmd/Ctrl+Enter or Shift+Enter |
| Move to trash | Cmd/Ctrl+Backspace |
| Undo | Cmd/Ctrl+Z |
| Select all | Cmd/Ctrl+A |

**What Makes It Professional:**
1. Group Overview anticipates stack-based culling (similar to GemKeep)
2. Face Focus is a unique innovation for portrait/wedding work
3. Sets + Select Next When creates a structured progression through groups
4. Session-based workflow keeps projects isolated (similar to GemKeep)
5. Color tags have strong semantic meaning (green/red is intuitive)
6. Superior color rendering gives more accurate culling decisions

**Limitation:** Heavier application with slower startup. Color tag shortcuts (+, -, *) require reaching for non-alpha keys. Keyboard shortcuts are less mnemonic than Lightroom's P/X system.

---

## 2. Common Patterns Across All Tools

Every successful photo culling tool shares these fundamental UX patterns:

### 2.1 Single-Key Decisions
All tools minimize the number of keystrokes per decision. The ideal is one keypress = one decision + auto-advance to next photo. Photo Mechanic achieves this with single-key color classes. Lightroom achieves it with P/X + Caps Lock. The cognitive load is: look at photo, press one key, photo changes. No confirmation dialogs, no multi-key combos.

### 2.2 Auto-Advance After Action
Every tool implements auto-advance (automatically moving to the next photo after a rating/flag/tag is applied):
- **Photo Mechanic:** Always on by default
- **Lightroom:** Toggle via Caps Lock
- **FastRawViewer:** Configurable, moves to next after move/copy operations
- **Capture One:** Select Next When (menu toggle)

This eliminates 50% of keystrokes in a culling session (no separate "next" press after each decision).

### 2.3 Binary First, Nuanced Later
All tools support a two-pass workflow:
1. **First pass:** Binary keep/reject (fastest possible, ~1-2 seconds per photo)
2. **Second pass:** Nuanced rating on survivors only (star ratings, color refinement)

This matches human decision-making: quick gut reaction first, careful evaluation second.

### 2.4 Visual Status Indicators
Every tool shows the current decision state prominently:
- Color overlays, borders, or badges on thumbnails
- Flag icons (Lightroom's white/black flags)
- Dimming or graying of rejected images
- Color-coded borders in grid view
- Badge/icon in corner of thumbnail

### 2.5 Grid + Single Image Views
All tools provide at minimum:
- **Grid/contact sheet:** Overview of many photos, see patterns and groups
- **Single/loupe view:** Full-size single image for detail evaluation
- **Quick toggle between them** (usually a single key: G, E, Space, Enter)

Advanced tools add:
- **Compare view:** Side-by-side of 2 photos (Lightroom C, Capture One Enter)
- **Survey view:** N photos at once for burst selection (Lightroom N)

### 2.6 Filter After Flag
All tools support filtering the view to show only certain states:
- Show only picks / only rejects / only unrated
- Show only specific star ratings or color labels
- This enables the two-pass workflow: flag everything, filter to picks, rate picks

### 2.7 XMP/Sidecar Compatibility
Rating and label data is stored in industry-standard XMP format, allowing decisions to transfer between tools. This is why Photo Mechanic -> Lightroom and FastRawViewer -> Lightroom workflows are viable.

### 2.8 Non-Destructive by Default
No tool deletes or modifies original files during culling. Decisions are metadata-only until explicit export/delete action.

### 2.9 Embedded JPEG for Speed
Photo Mechanic and FastRawViewer both leverage the JPEG preview embedded in RAW files for speed. Even Lightroom generates Smart Previews to avoid decoding RAW for every scroll. The fastest culling always avoids full RAW decode.

---

## 3. GemKeep Opportunities

### 3.1 Patterns GemKeep Should Adopt

**[HIGH PRIORITY] Single-key decisions with auto-advance**
GemKeep currently plans `y/k` for keep and `n/x` for eliminate (Sprint 6). This is good, but auto-advance must be the default behavior, not an option. After pressing `y` or `n`, the focus should immediately move to the next undecided photo within the stack.

*Rationale:* Every competitor implements this. It halves the keystrokes per photo. For 5000 photos, that is 5000 fewer keypresses.

**[HIGH PRIORITY] Caps Lock or toggle for auto-advance control**
Adopt Lightroom's Caps Lock convention or provide a visible toggle. Sometimes photographers want to linger on a photo (zoom, check focus) before deciding. Auto-advance should be the default "culling mode" but togglable.

*Rationale:* Lightroom's Caps Lock convention is so well-known that photographers will expect it.

**[HIGH PRIORITY] Instant visual feedback on decisions**
GemKeep plans "color / icon / dimming" (user story 5). Recommendation: use colored borders on thumbnails -- green border for keep, red border or dimming+strikethrough for eliminate. Do not use subtle indicators; they must be visible at grid-thumbnail size.

*Rationale:* All competitors use bold, obvious visual indicators. Subtle opacity changes are missed during fast culling.

**[HIGH PRIORITY] Embedded JPEG preview for speed**
GemKeep already uses embedded EXIF thumbnails for the thumbnail pipeline (Sprint 4, 7ms/photo). The same approach should extend to the Single View and Stack Focus preview: show embedded JPEG first, decode full resolution only on zoom or RAW toggle.

*Rationale:* This is Photo Mechanic's core advantage. GemKeep is already positioned to match this with the fast-path EXIF extraction.

**[MEDIUM PRIORITY] Survey/comparison view within stacks**
GemKeep's Stack Focus multi-photo grid already resembles Lightroom's Survey view. Enhance it with: select 2 photos for side-by-side compare (planned in Sprint 8, user story 6), synchronized zoom/pan between compared photos.

*Rationale:* Burst selection (GemKeep's primary use case) is where Survey view shines. All competitors provide this.

**[MEDIUM PRIORITY] Filter bar in Stack Overview**
After completing stack-level culling, provide filters in Stack Overview: "has finalist," "no finalist," "undecided," stack size, date range. This is planned in Sprint 5 (user story 11).

*Rationale:* Filtering is how photographers navigate 5000-photo sessions. Jump-to-next-undecided is especially critical.

**[MEDIUM PRIORITY] Progressive refinement (flag then rate)**
Consider adding a lightweight star rating (1-3 or 1-5) as a secondary signal on top of keep/eliminate. After the elimination rounds, photographers may want to rank their finalists for delivery priority.

*Rationale:* Every competitor supports both binary flags and nuanced ratings. GemKeep's round-based system handles the binary well, but finalist ranking is a gap.

**[LOW PRIORITY] XMP sidecar output**
When exporting finalists, write XMP sidecar files with ratings so that downstream tools (Lightroom, Capture One) can read GemKeep's decisions.

*Rationale:* Professional photographers rarely use only one tool. XMP interop reduces friction.

### 3.2 Patterns That Do NOT Fit GemKeep's Model

**Color class system (Photo Mechanic 0-8)**
Photo Mechanic's 8-class system is overkill for GemKeep's stack-first model. GemKeep's rounds-based refinement replaces the need for fine-grained labeling. Keep/eliminate is the atomic decision; rounds provide the nuance.

*Why skip:* Adding 8 categories would contradict GemKeep's "extremely simple" guiding principle. The round engine IS the multi-level classification system.

**Catalog/database import bottleneck (Lightroom)**
Lightroom requires full catalog import before culling can begin. GemKeep already avoids this with its scan-and-display approach (thumbnails appear progressively during indexing). Do not add a blocking import step.

**Face Focus (Capture One)**
While innovative, face detection requires ML models and significant implementation effort. Not aligned with GemKeep's Rust-native, minimal-dependency approach. Consider for v2+ if demand exists.

**AI-assisted culling (Lightroom 2025, Aftershoot)**
AI culling is a growing trend but requires cloud services or large local models. GemKeep's value proposition is manual control and speed, not automation. The round-based system gives photographers agency that AI tools remove.

### 3.3 GemKeep's Unique Advantage: Stack-First Model

No competitor groups photos into stacks as a first-class navigation concept the way GemKeep does:
- **Photo Mechanic:** Flat folder view. No grouping beyond manual tagging.
- **Lightroom:** Stacking exists but is manual and rarely used during culling.
- **FastRawViewer:** Flat folder view. No grouping.
- **Capture One:** Group Overview in Cull tool is the closest analog, but it is a viewing mode, not a structural feature.

GemKeep's time-proximity burst stacking means the photographer's first interaction is at the stack level ("this burst of 12 frames"), not the individual photo level. This matches the actual mental model of event/wedding photography: "I shot a burst of the first kiss -- which one is best?"

The round engine then provides structured refinement within each stack, replacing the ad-hoc "flip through and flag" workflow of other tools with a systematic, auditable narrowing process.

---

## 4. Keyboard Shortcut Comparison Table

### Decision Shortcuts

| Action | Photo Mechanic | Lightroom Classic | FastRawViewer | Capture One | GemKeep (Current) | GemKeep (Recommended) |
|---|---|---|---|---|---|---|
| Keep/Pick | 1-8 (color class) | P | Alt+1..5 (rating) | + (green tag) | y or k | y (mnemonic: yes) |
| Reject/Eliminate | 0 (no class) | X | Alt+Del | - (red tag) | n or x | x (mnemonic: cross out) |
| Clear/Unflag | 0 | U | Alt+0 | -- | -- | u (undo decision) |
| Star rating 1-5 | Ctrl+1..5 | 1, 2, 3, 4, 5 | Alt+1..5 | 1, 2, 3, 4, 5 | -- | 1-5 (finalist ranking) |

### Navigation Shortcuts

| Action | Photo Mechanic | Lightroom Classic | FastRawViewer | Capture One | GemKeep (Current) | GemKeep (Recommended) |
|---|---|---|---|---|---|---|
| Next photo | Right arrow | Right arrow | Ctrl+Right / Space | Right arrow | l or Right | Right arrow |
| Previous photo | Left arrow | Left arrow | Ctrl+Left / Backspace | Left arrow | h or Left | Left arrow |
| Next stack | -- | -- | -- | -- | j or Down | Down arrow |
| Previous stack | -- | -- | -- | -- | i or Up | Up arrow |
| First photo | Home | Home | Ctrl+Shift+Left | Home | -- | Home |
| Last photo | End | End | Ctrl+Shift+Right | End | -- | End |

### View Shortcuts

| Action | Photo Mechanic | Lightroom Classic | FastRawViewer | Capture One | GemKeep (Current) | GemKeep (Recommended) |
|---|---|---|---|---|---|---|
| Grid/Overview | Contact sheet | G | G | -- | Esc (back) | G or Esc |
| Single/Loupe view | Preview window | E | G (toggle) | -- | Enter | E or Enter |
| Compare (2-up) | Multi-view | C | -- | Enter (ref) | -- | C |
| Survey (N-up) | -- | N | -- | -- | Stack Focus | S or Enter on stack |
| Zoom 100% | -- | Z | Ctrl+1 | -- | -- | Z |
| Fit to screen | -- | Ctrl+Alt+0 | Ctrl+0 | -- | -- | 0 |

### Mode Shortcuts

| Action | Photo Mechanic | Lightroom Classic | FastRawViewer | Capture One | GemKeep (Recommended) |
|---|---|---|---|---|---|
| Auto-advance toggle | Always on | Caps Lock | -- | Select Next When | Caps Lock |
| Filter picks only | Ctrl+F1..F9 | Backslash \ + filter | Label filter | Filter panel | F (toggle filter) |
| RAW/JPEG toggle | -- | -- | Built-in | -- | R |
| Next undecided | -- | -- | -- | -- | Tab |
| Commit round | -- | -- | -- | -- | Ctrl+Enter |

---

## 5. Workflow Comparison: 5000-Photo Wedding Cull

### 5.1 Photo Mechanic Workflow (~90-120 minutes)

1. **Ingest (10 min):** Insert cards, Photo Mechanic copies files while you start reviewing.
2. **First pass -- Color Class (60-80 min):** Flip through every photo at ~1-2 sec/photo. Press 1 (purple/winner) for keepers, skip or press 0 for rejects. Auto-advance moves to next photo instantly. Embedded JPEG preview means zero rendering wait.
3. **Filter to keepers (instant):** Ctrl+F1 filters to only color class 1 photos.
4. **Second pass -- Star rating (20-30 min):** Review ~800-1200 keepers. Apply 1-5 stars for delivery priority.
5. **Export metadata:** Ratings written to XMP. Import into Lightroom for editing.

*Speed secret:* Embedded JPEG + single-key + auto-advance. The photographer never waits for rendering and never presses more than one key per photo.

### 5.2 FastRawViewer Workflow (~120-150 minutes)

1. **Open folder (instant):** No import step. Navigate to card/folder directly.
2. **First pass -- Move rejects (90-120 min):** Flip through photos. Check RAW histogram for exposure. Use focus peaking to verify sharpness. Press X to move rejects to `_rejected` folder.
3. **Second pass -- Rate keepers (30 min):** Alt+1 through Alt+5 on remaining photos. XMP sidecars written automatically.
4. **Import to Lightroom:** Import only the non-rejected folder. Ratings carry over via XMP.

*Speed secret:* Accurate RAW evaluation prevents importing bad photos that would waste time later. Modifier keys slow individual decisions but reduce rework.

### 5.3 Lightroom Classic Workflow (~150-250 minutes)

1. **Import (15-30 min):** Import all 5000 photos. Generate Standard Previews (or wait for 1:1 on demand).
2. **First pass -- Flag (90-150 min):** Enable Caps Lock (auto-advance). Flip through in Loupe view (E). Press P for picks, X for rejects. At 2-3 sec/photo (including rendering delays).
3. **Filter to picks:** Press \ to toggle filter bar. Select "Flagged" to show only picks.
4. **Second pass -- Survey bursts (30-45 min):** Select burst sequences, press N for Survey view. Dismiss weak shots by clicking X on thumbnail. Rate survivors with 1-5.
5. **Third pass -- Color label (15-30 min):** Apply color labels for editorial categories (6=hero shots, 7=details, etc.).
6. **Develop:** Begin editing directly in same application.

*Speed secret:* Integrated editing means no export/import step between culling and developing. But preview rendering is the bottleneck.

### 5.4 Capture One Workflow (~120-180 minutes)

1. **Import/Session (10-15 min):** Create session, import photos. Generate previews.
2. **Cull tool pass (80-120 min):** Open Cull tool from toolbar. Group Overview auto-groups similar shots. Enable "Select Next When: Color Tagged." Press + for green (keep), - for red (reject) on each photo. Face Focus helps evaluate portraits quickly.
3. **Filter to green tags (instant):** Filter panel shows only green-tagged images.
4. **Rating pass (30-45 min):** Apply 1-5 stars on keepers for delivery priority.
5. **Process/Export:** Superior RAW processing in same application.

*Speed secret:* Group Overview provides structure similar to GemKeep's stacks. Face Focus accelerates portrait decisions. Color tag semantics (green=go, red=stop) are intuitive.

### 5.5 GemKeep's Projected Workflow (~60-90 minutes)

1. **Create project + add source folders (1 min):** Project isolation. Folder scan begins immediately.
2. **Progressive thumbnail display (background):** Thumbnails appear in Stack Overview as they are generated (7ms/photo using embedded EXIF fast path). No blocking import step.
3. **Stack-level triage (15-20 min):** Stack Overview shows ~400-800 time-proximity burst stacks. Arrow keys to navigate between stacks. Glance at stack thumbnails -- some stacks are obvious keeps/skips at the stack level.
4. **Stack Focus -- Round 1 (40-50 min):** Enter a stack. See all photos in the burst. Press y to keep, x to eliminate. Auto-advance to next photo. After deciding all photos in the stack, only keepers survive Round 1. Auto-advance to next stack.
5. **Stack Focus -- Round 2 (10-15 min):** Re-enter stacks with multiple survivors. Narrow from ~3 keepers to ~1 finalist per stack. Round engine records decisions with full audit trail.
6. **Session-level refinement (5-10 min):** Switch to session scope. See all stack finalists across the entire shoot. Run one more round to select hero shots for delivery.
7. **Export:** Export finalists (both RAW + JPEG of pairs). JSON manifest for tooling integration.

**GemKeep's Unique Advantages:**
- **Stack-first navigation** eliminates scrolling through 5000 flat thumbnails. Photographers interact with ~500 stacks, not 5000 individual photos.
- **Round engine** replaces ad-hoc flag/rate/filter with a structured, auditable narrowing process. No accidental re-rating of already-decided photos.
- **RAW+JPEG pair awareness** means one decision covers both files. No risk of keeping the JPEG but forgetting the RAW (or vice versa).
- **No catalog overhead:** Project-scoped SQLite database. No global catalog to corrupt or slow down.
- **Embedded JPEG speed:** Same fast-path as Photo Mechanic for thumbnail and preview rendering.
- **Crash resilience:** Every decision auto-saved to SQLite. Resume exactly where you left off after any interruption.

**Projected time savings vs. competitors:**
- vs. Lightroom: 50-60% faster (no rendering delays, stack-first reduces cognitive load)
- vs. Photo Mechanic: Comparable speed, but with structured refinement instead of flat pass
- vs. FastRawViewer: Faster for culling (single-key vs. modifier+key), structured vs. flat
- vs. Capture One: Faster startup, lighter weight, purpose-built for culling

---

## Sources

- [Photo Mechanic Custom Keyboard Shortcuts](https://home.camerabits.com/speed-up-your-workflow-with-photo-mechanics-new-custom-keyboard-shortcuts-mac-only/)
- [Photo Mechanic + Lightroom Culling Workflow](https://www.trunghoangphotography.com/for-photographers/photo-mechanic-lightroom-workflow-culling-faster-with-photo-mechanic)
- [Aftershoot vs Photo Mechanic Comparison](https://aftershoot.com/blog/aftershoot-vs-photo-mechanic/)
- [FastRawViewer User Manual: Keyboard Shortcuts](https://www.fastrawviewer.com/usermanual17/keyboard-shortcuts)
- [FastRawViewer Culling Workflow (Rhett.cc)](https://rhett.cc/FastRawViewer/)
- [FastRawViewer RAW Advantages](https://www.fastrawviewer.com/blog/most-obvious-reasons-to-look-at-RAW)
- [Lightroom Classic Keyboard Shortcuts (Adobe)](https://helpx.adobe.com/lightroom-classic/help/keyboard-shortcuts.html)
- [Lightroom Shortcuts for Faster Culling (Fstoppers)](https://fstoppers.com/lightroom/keyboard-shortcuts-actually-speed-lightroom-classic-718346)
- [Lightroom Assisted Culling (Adobe)](https://helpx.adobe.com/lightroom-classic/help/assisted-culling.html)
- [Capture One Culling Images](https://support.captureone.com/hc/en-us/articles/7185822431645-Culling-images)
- [Capture One Keyboard Shortcuts (AlexOnRAW)](https://alexonraw.com/capture-one-keyboard-shortcuts/)
- [Capture One Auto-Advance Discussion](https://support.captureone.com/hc/en-us/community/posts/360012201457-Auto-Select-Advance-for-culling)
- [Best Photo Culling Software 2025](https://aftershoot.com/blog/best-culling-software/)
- [Photo Culling Software Comparison (Adventure Wedding Academy)](https://adventureweddingacademy.com/culling-software-for-photographers/)
