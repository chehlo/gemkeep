# Manual Test Plan — Sprint 7

> Run with `cargo tauri dev`. Test on a real photo folder (RAW+JPEG recommended).
> Expected: dark UI (near-black `bg-gray-950`), all text white/gray.

---

## 1. ProjectList Screen

**How to reach:** Launch app. If it auto-opens a project, press `Esc` from StackOverview.

### 1.1 First Launch (no projects)

| Step | Action | Expected |
|------|--------|----------|
| 1 | Launch app fresh (no prior data) | See "GemKeep" title (white, large). No resume card. Empty project list. |
| 2 | See `+ New Project` button | Blue text, clickable |

### 1.2 Create Project

| Step | Action | Expected |
|------|--------|----------|
| 1 | Click `+ New Project` | Inline form appears: name input + Create button. Button text changes to `- New Project`. |
| 2 | Type "Venice 2026" in name field | After ~200ms debounce, slug preview appears below: `Slug: venice-2026` (gray, monospace) |
| 3 | Click Create (or press Enter) | Navigates to StackOverview. Breadcrumb shows "Projects / Venice 2026" |
| 4 | Press Esc to go back to ProjectList | Resume card appears: blue-tinted, shows "Venice 2026" with "Open -->" button |

### 1.3 Recent Projects List

| Step | Action | Expected |
|------|--------|----------|
| 1 | Create 2+ projects, return to ProjectList | "Recent Projects" section visible. Each row: name (white), slug + date (gray monospace), Open button (blue), Delete button (red) |
| 2 | Click Delete on a project | Confirmation modal: dark overlay, "Delete project?" title, slug name, Cancel + Delete buttons |
| 3 | Click Cancel | Modal closes, project still in list |
| 4 | Click Delete (confirm) | Project removed from list |

### 1.4 Auto-Open Behavior

| Step | Action | Expected |
|------|--------|----------|
| 1 | Open a project, quit app, relaunch | App auto-opens the last project (goes straight to StackOverview, you never see ProjectList) |
| 2 | Press Esc from StackOverview | Returns to ProjectList with Resume card showing the project |

### 1.5 Error Handling

| Step | Action | Expected |
|------|--------|----------|
| 1 | Try to create a project with the same name as existing | Red error banner appears at top (bg-red, red text) |

---

## 2. StackOverview Screen

**How to reach:** Open or create a project from ProjectList.

### 2.1 Initial State (No Folders)

| Step | Action | Expected |
|------|--------|----------|
| 1 | Open a fresh project | See "No source folders attached." text + blue `+ Add Folder` button |
| 2 | Breadcrumb shows `<- Projects / {ProjectName}` | Back button at left, "Esc" hint at right edge |

### 2.2 Add Folder & Index

| Step | Action | Expected |
|------|--------|----------|
| 1 | Click `+ Add Folder` | Native folder picker dialog opens |
| 2 | Select a folder with photos | Folder path appears in list. Indexing starts automatically. |
| 3 | **EXIF indexing phase** | "Indexing..." label + blue progress bar filling left to right + "{processed} / {total} files" count. Pause + Cancel buttons visible. |
| 4 | Watch progress bar | Bar should fill smoothly (transition animation). Percentage should increase from 0% to ~100%. **Never exceed 100%.** |
| 5 | **Thumbnail generation phase** | Label changes to "Generating thumbnails..." + "{done} / {total} thumbnails ({pct}%)" count |
| 6 | If total=0 initially | Spinning blue circle (indeterminate) instead of progress bar, with "N files indexed" text |
| 7 | Watch for errors | If errors > 0: red error count shown. After indexing: "Show N error(s)" expandable link in red. |

### 2.3 Stack Grid

| Step | Action | Expected |
|------|--------|----------|
| 1 | After indexing completes | Summary line: "Index complete. Stacks: {N} Logical Photos: {N}". Grid of stack cards in 4-column layout. |
| 2 | Each stack card shows | Thumbnail image (256px square, fills cell), "Stack #N", "{N} photo(s)", date or "(no EXIF)" |
| 3 | **Visual:** First card has blue border | `border-blue-500` with subtle blue glow ring (`ring-blue-500/30`) — this is the focus indicator |
| 4 | Cards without focus | Gray border (`border-gray-800`), hover shows lighter border |

### 2.4 Keyboard Navigation

| Step | Action | Expected |
|------|--------|----------|
| 1 | Press `→` (ArrowRight) | Blue focus ring moves to the next card |
| 2 | Press `←` (ArrowLeft) | Focus moves to previous card |
| 3 | Press `↓` (ArrowDown) | Focus jumps down one row (4 cards) |
| 4 | Press `↑` (ArrowUp) | Focus jumps up one row |
| 5 | Press `Enter` on a focused card | Navigates to StackFocus for that stack |
| 6 | Press `Esc` from StackFocus | Returns to StackOverview. **The previously focused card is restored and scrolled into view.** |
| 7 | Click a stack card | Navigates directly to StackFocus (click = immediate navigation, unlike StackFocus where click only focuses) |

### 2.5 Multi-Select & Merge

| Step | Action | Expected |
|------|--------|----------|
| 1 | Press `Shift+→` | Current card gets **yellow ring** (`ring-yellow-400 border-yellow-400`). Next card also gets yellow ring. Focus moves right. |
| 2 | Press `Shift+→` again | Third card added to selection (yellow ring). All three have yellow rings. |
| 3 | Press `→` (without Shift) | **Yellow selection clears.** Only the new focused card has blue ring. |
| 4 | Select 2+ cards with Shift+Arrow | Press `M` key. Cards merge into one. Grid reloads with fewer stacks. |
| 5 | Press `Ctrl+Z` | Last merge is undone. Original stacks reappear. |
| 6 | Select only 1 card, press `M` | Nothing happens (merge requires 2+) |

### 2.6 Burst Gap Config

| Step | Action | Expected |
|------|--------|----------|
| 1 | Press `Ctrl+B` | Modal overlay: "Burst gap" title, number input (default: 3 seconds), Cancel + Save buttons |
| 2 | Change value to 10, click Save | "Recalculating stacks..." text appears. Stacks re-group. Grid reloads with different stack count. |
| 3 | Press Esc or Cancel | Modal closes without changes |

### 2.7 Re-Index

| Step | Action | Expected |
|------|--------|----------|
| 1 | Press `r` | Indexing restarts from scratch. Progress bar appears. Previous stacks/thumbnails are cleared. |
| 2 | Press `i` (when folders exist, no stacks) | Starts indexing (same as re-index but only works when no stacks yet) |

### 2.8 Thumbnail Progressive Loading

| Step | Action | Expected |
|------|--------|----------|
| 1 | During thumbnail generation | Stack cards that had no thumbnail gradually show thumbnails appearing. Cards update without full page reload. |
| 2 | **Visual:** Placeholder before thumbnail | Camera emoji shown in the thumbnail area |
| 3 | **Visual:** After thumbnail arrives | Real photograph fills the card's image area |

### 2.9 Error Feedback

| Step | Action | Expected |
|------|--------|----------|
| 1 | If merge fails (edge case) | Red error toast at top: "Failed to merge stacks. Please try again." Auto-clears after 5 seconds. |
| 2 | If undo fails | Same red toast pattern |
| 3 | If indexing start fails | Same red toast: "Failed to start indexing. Please try again." |

---

## 3. StackFocus Screen (Culling Grid)

**How to reach:** Press `Enter` on a stack in StackOverview, or click a stack card.

### 3.1 Initial Layout

| Step | Action | Expected |
|------|--------|----------|
| 1 | Enter a stack with photos | Breadcrumb: `<- Back / {ProjectName} > Stack #{N}`. "Esc" hint at right. |
| 2 | Photo grid | 4-column grid of photo cards. First card has blue focus ring. |
| 3 | Each card shows | Thumbnail, capture time (e.g., "Feb 14 14:23:01"), camera model, lens, RAW/JPEG badges |
| 4 | **RAW badge** | Small green pill: green background (`bg-green-800`), green text (`text-green-200`), says "RAW" |
| 5 | **JPEG badge** | Small blue pill: blue background (`bg-blue-800`), blue text (`text-blue-200`), says "JPEG" |

### 3.2 Decision Making (Y/X Keys)

| Step | Action | Expected |
|------|--------|----------|
| 1 | Press `Y` on focused photo | **Green badge appears** on card: small green circle (top-right corner). Photo stays full opacity. |
| 2 | Press `X` on a different photo | **Red badge appears** on card: small red circle (top-right corner). **Photo dims to 50% opacity.** |
| 3 | Press `Y` on an already-eliminated photo | Decision changes: red badge becomes green, opacity returns to 100%. Decisions are re-decidable. |
| 4 | **Decision counter** in header | Shows "{decidedCount}/{total} decided" text |
| 5 | **Round status** in header | Shows "N kept . N eliminated . N undecided . Round 1" |

### 3.3 Tab Navigation (Jump to Undecided)

| Step | Action | Expected |
|------|--------|----------|
| 1 | Decide on first 3 photos (Y or X) | Focus stays where you last pressed Y/X |
| 2 | Press `Tab` | Focus jumps forward to the **next undecided** photo (skips decided ones). Wraps around circularly. |
| 3 | Press `Shift+Tab` | Focus jumps backward to the **previous undecided** photo. Wraps around. |
| 4 | Decide on ALL photos, press `Tab` | Focus wraps around since all are decided (no undecided to skip to) |

### 3.4 Arrow Navigation

| Step | Action | Expected |
|------|--------|----------|
| 1 | `→/←/↓/↑` | Move focus through the 4-column grid. Same behavior as StackOverview. |
| 2 | Blue ring moves | Only one card has blue focus ring at a time |

### 3.5 Enter → SingleView

| Step | Action | Expected |
|------|--------|----------|
| 1 | Press `Enter` on a focused photo | Navigates to SingleView showing that photo full-screen |
| 2 | Note: **Clicking** a photo card | Only changes focus (does NOT navigate). Must press Enter to go to SingleView. |

### 3.6 Commit Round

| Step | Action | Expected |
|------|--------|----------|
| 1 | Make some Y/X decisions | Header updates with counts |
| 2 | Press `Ctrl+Enter` | Round commits. **After commit: Y and X keys are silently ignored.** No visible "locked" indicator (decisions just stop working). |
| 3 | Try pressing Y or X after commit | Nothing happens (decisions are locked) |

### 3.7 Back to StackOverview

| Step | Action | Expected |
|------|--------|----------|
| 1 | Press `Esc` | Returns to StackOverview. Focus is restored to the stack card you came from. |

### 3.8 Error Feedback

| Step | Action | Expected |
|------|--------|----------|
| 1 | If commitRound fails | Red error toast: "Failed to commit round. Please try again." Auto-clears after 3 seconds. |

---

## 4. SingleView Screen (Full-Screen Culling)

**How to reach:** Press `Enter` on a focused photo in StackFocus.

### 4.1 Initial Layout

| Step | Action | Expected |
|------|--------|----------|
| 1 | Enter SingleView | **Black background** (distinct from other screens' dark gray). Photo fills the viewport (`object-contain` — maintains aspect ratio). |
| 2 | **Thumbnail or JPEG displayed** | Shows thumbnail if available, falls back to JPEG path, falls back to "No preview available" text |
| 3 | **Camera params panel** (default: visible) | Below the photo area: aperture (f/2.8), shutter speed (1/250s), ISO (ISO 400), focal length (85mm), exposure comp (+0.7 EV), camera model, lens, RAW/JPEG badges, capture date/time |
| 4 | Missing EXIF values | Show `--` placeholder |
| 5 | **Status bar** at bottom | "Photo {N}/{total}" + decision status: "KEPT", "ELIMINATED", or "UNDECIDED" + round info if available |

### 4.2 Decision Visual Feedback

| Step | Action | Expected |
|------|--------|----------|
| 1 | Press `Y` (keep) | **Green border appears:** 4px solid green border (`border-green-500`) frames the entire photo. Status bar shows "KEPT". |
| 2 | Press `X` (eliminate) | **Red border + dim:** 4px solid red border (`border-red-500`) frames the photo AND a 50% black overlay (`bg-black/50`) dims the image. Status bar shows "ELIMINATED". |
| 3 | Press `Y` again on an eliminated photo | Red border + dim removed, green border appears instead. Decision is re-decidable. |
| 4 | **Undecided photo** | No border overlay. Full brightness. Status bar shows "UNDECIDED". |

### 4.3 Photo Navigation

| Step | Action | Expected |
|------|--------|----------|
| 1 | Press `→` (ArrowRight) or `l` | Moves to next photo. Photo reloads with new image and EXIF data. Status bar updates "Photo {N+1}/{total}". |
| 2 | Press `←` (ArrowLeft) or `h` | Moves to previous photo |
| 3 | Press `Home` | Jumps to first photo in the stack |
| 4 | Press `End` | Jumps to last photo in the stack |
| 5 | Press `Tab` | Jumps to next undecided photo (wraps circularly) |
| 6 | Press `Shift+Tab` | Jumps to previous undecided photo |
| 7 | At first photo, press `←` | Nothing happens (stays at first) |
| 8 | At last photo, press `→` | Nothing happens (stays at last) |

### 4.4 Toggle Camera Params

| Step | Action | Expected |
|------|--------|----------|
| 1 | Press `I` | Camera params panel hides. Photo has more viewport space. |
| 2 | Press `I` again | Camera params panel reappears |

### 4.5 Commit Round

| Step | Action | Expected |
|------|--------|----------|
| 1 | Press `Ctrl+Enter` | Round commits. Y/X keys silently stop working. Status bar shows round info. |

### 4.6 Back to StackFocus

| Step | Action | Expected |
|------|--------|----------|
| 1 | Press `Esc` | Returns to StackFocus. Focus is on the photo you were viewing. |

### 4.7 Error Feedback

| Step | Action | Expected |
|------|--------|----------|
| 1 | If decision save fails | Red error toast: "Failed to save decision. Please try again." Auto-clears after 3 seconds. |
| 2 | If commit round fails | Red error toast: "Failed to commit round. Please try again." |

---

## 5. Help Overlay

### 5.1 Open/Close

| Step | Action | Expected |
|------|--------|----------|
| 1 | Press `?` on any screen | Dark overlay (70% black) appears. Centered panel shows "KEYBOARD SHORTCUTS" title with screen name. "? to close" hint visible. |
| 2 | Press `?` again | Overlay closes |
| 3 | Press `Esc` | Overlay closes (does NOT also navigate back — Esc is trapped) |
| 4 | Click the dark backdrop | Overlay closes |
| 5 | Click inside the shortcut panel | Overlay stays open (click does not propagate to backdrop) |

### 5.2 Context-Aware Content

| Screen | Expected shortcut groups |
|--------|-------------------------|
| **ProjectList** | NAVIGATION: Enter (Open project), Esc, ? |
| **StackOverview** | NAVIGATION (Arrow, Enter, Esc, ?), SELECTION (Shift+Arrow), STACK ACTIONS (M merge, Ctrl+Z undo), OTHER (Ctrl+B burst gap, i/r re-index) |
| **StackFocus** | NAVIGATION (Arrows, Enter, Tab/Shift+Tab undecided, Esc, ?), DECISIONS (Y keep, X eliminate, Ctrl+Enter commit) |
| **SingleView** | NAVIGATION (Left/Right, Home/End, Tab/Shift+Tab, Esc, ?), DECISIONS (Y, X, Ctrl+Enter), DISPLAY (I toggle params) |

### 5.3 Keyboard Shortcut Display

| Step | Action | Expected |
|------|--------|----------|
| 1 | Each shortcut row | Key in a `<kbd>` element (monospace, dark gray background, rounded) + plain text description |
| 2 | ARIA | Overlay has `role="dialog"`, `aria-modal="true"`, `aria-label="Keyboard shortcuts"` |

---

## 6. Cross-Screen Journeys

### 6.1 Full Culling Workflow

| Step | Action | Expected |
|------|--------|----------|
| 1 | Create project | Navigate to StackOverview |
| 2 | Add folder | Indexing starts, progress bar fills |
| 3 | Wait for stacks to appear | Grid populates. Thumbnails load progressively. |
| 4 | Arrow to a stack, press Enter | StackFocus: 4-column photo grid with EXIF metadata |
| 5 | Press Y on photo 1 | Green badge appears on card |
| 6 | Press X on photo 2 | Red badge, card dims to 50% |
| 7 | Press Tab | Focus jumps to photo 3 (next undecided) |
| 8 | Press Enter | SingleView: photo fills screen, black background |
| 9 | Press Y | Green 4px border appears around photo |
| 10 | Press → | Next photo loads |
| 11 | Press X | Red border + 50% dim overlay on photo |
| 12 | Press Esc | Back to StackFocus. Badges match decisions made in SingleView. |
| 13 | Press Ctrl+Enter | Round committed. Y/X disabled. |
| 14 | Press Esc | Back to StackOverview. |
| 15 | Press Esc | Back to ProjectList. Resume card visible. |

### 6.2 Scroll Restore (Double Round-Trip)

| Step | Action | Expected |
|------|--------|----------|
| 1 | Navigate to stack card #15 in StackOverview (arrow down) | Card 15 is focused, may require scrolling |
| 2 | Press Enter → StackFocus | StackFocus opens |
| 3 | Press Esc → back to StackOverview | **Card 15 is focused AND scrolled into view** |
| 4 | Navigate to card #3, press Enter → Esc | **Card 3 is now focused and visible** (not card 15 — second trip proves active restore, not cached) |

### 6.3 Decision Persistence Across Navigation

| Step | Action | Expected |
|------|--------|----------|
| 1 | In StackFocus, press Y on photo 1, X on photo 2 | Green and red badges visible |
| 2 | Press Enter on photo 1 → SingleView | SingleView shows green border (KEPT) |
| 3 | Press Esc → back to StackFocus | Badges still present. Decision counter still correct. |
| 4 | Navigate to different stack, come back | Decisions are persisted in DB — they survive navigation. |

### 6.4 Reindex After Data Exists

| Step | Action | Expected |
|------|--------|----------|
| 1 | Complete indexing, see stacks | Stack grid visible |
| 2 | Press `r` to re-index | Stacks clear. Indexing restarts. Progress bar appears. |
| 3 | After re-index completes | New stacks appear. Thumbnails regenerate. |
| 4 | **CPU usage** | Should settle down after thumbnail generation completes. Not continuously busy. |

---

## 7. Visual Indicator Reference (What Colors to Look For)

| Indicator | Where | Visual |
|-----------|-------|--------|
| **Focus ring** | StackOverview + StackFocus card grids | Blue border + subtle blue glow |
| **Multi-select ring** | StackOverview only | Yellow border + yellow ring |
| **Keep badge** (grid) | StackFocus card top-right | Small green circle |
| **Eliminate badge** (grid) | StackFocus card top-right | Small red circle |
| **Eliminated dimming** (grid) | StackFocus card | Card at 50% opacity |
| **Keep overlay** (single) | SingleView photo | 4px solid green border framing the photo |
| **Eliminate overlay** (single) | SingleView photo | 4px solid red border + 50% black dim overlay |
| **RAW badge** | StackFocus + SingleView | Green pill: "RAW" |
| **JPEG badge** | StackFocus + SingleView | Blue pill: "JPEG" |
| **Progress bar** | StackOverview during indexing | Blue bar filling on gray track, rounded |
| **Spinner** | StackOverview (thumbnail total=0) | Small blue spinning circle |
| **Error toast** | Any screen | Red banner, auto-clears (3-5 seconds) |
| **Help overlay** | Any screen (press ?) | Dark backdrop + centered white-on-dark panel |
| **Delete modal** | ProjectList | Dark backdrop + centered modal |
| **Burst gap modal** | StackOverview (Ctrl+B) | Dark backdrop + centered modal with number input |

---

## 8. Known Limitations (Not Yet Implemented — Future Sprints)

These features are specified in wireframes for **future sprints**:

- Comparison View (split-screen A/B culling) — Sprint 8
- Undo decision (`U` key) — Sprint 8
- Auto-advance (`A` key) — Sprint 8
- Compare mode (`C` key) — Sprint 8
- Multi-round UI (round selector `[1] [2] [3*]`, round history) — Sprint 9
- Session Finalist View — Sprint 10
- Stack decision progress badges on StackOverview cards — Sprint 8+
- Decision flash animations (200ms green/red pulse) — cosmetic, deferred
- Welcome card on first launch — Sprint 12
- Bottom hint bars on all screens — Sprint 12
- Search/filter (`/` key) — Sprint 12
- Zoom controls (`0`, `1`, `+`, `-`) — Sprint 12

---

## 9. Spec vs Code Gaps (Specified for S7 or Earlier but Missing/Different)

> These are features that the wireframes or sprint docs say should work NOW but the code
> either doesn't implement, implements differently, or has a bug. Organized by severity.

### 9.1 Bugs (Incorrect Behavior)

| ID | Screen | Gap | Spec says | Code does |
|----|--------|-----|-----------|-----------|
| **B1** | SingleView | Image shows thumbnail, not JPEG | Sprint-07 §10.3: "Display source is the JPEG file path. For RAW-only, use thumbnail as fallback." JPEG first, thumbnail fallback. | Code tries `thumbnail_path` FIRST (line 220). Every photo with a thumbnail shows low-res 256px image. **Intentional trade-off:** original JPEG paths are outside `assetProtocol.scope` (`$HOME/.gem-keep/**`). Serving full-res JPEGs requires adding source folders to the asset scope — currently not done. |
| **B2** | StackFocus | Round status stale after Y/X | Sprint-07 §11.3: "Updated on every decision via getRoundStatus()". Header should show live kept/eliminated/undecided counts. | `roundStatus` is loaded once on mount (line ~50). After Y/X decisions, `decidedCount` updates from local `decisions` array but `roundStatus.kept`, `roundStatus.eliminated`, `roundStatus.undecided` in the header are **never refreshed**. Numbers are stale after first decision. |
| **B3** | StackFocus + SingleView | Round status stale after Ctrl+Enter commit | After commit, Y/X should be blocked and UI should show committed state. | `commitRound()` is called but `roundStatus` is never re-fetched afterward. The `state === 'committed'` guard on Y/X won't activate (state is still `'open'` locally). **Decisions can still be attempted after commit** until you leave the screen. |
| **B4** | StackOverview | Esc navigates away with burst panel open | Esc should close the burst panel overlay first, then navigate on second Esc. | `handleKey` (line 216): `if (e.key === 'Escape') { back(); return }` runs unconditionally without checking `showBurstPanel`. Pressing Esc while burst panel is open navigates to ProjectList instead of closing the panel. |

### 9.2 Major Visual Mismatches (Looks Different from Wireframe)

| ID | Screen | Gap | Spec says | Code does |
|----|--------|-----|-----------|-----------|
| **V1** | StackFocus | Grid cards show wrong metadata | Wireframe §3.1 shows per-card: capture time, **f/2.8, 1/250s, ISO 400, 85mm**, RAW/JPEG | Code shows capture time, **camera_model, lens**, RAW/JPEG. Exposure data (aperture, shutter, ISO, focal_length) is not in the `LogicalPhotoSummary` type — requires API change. |
| **V2** | StackFocus | Decision badges wrong style | Sprint-07 §11.1: `w-5 h-5` (20px) circles with "Y" or "X" text inside. Wireframe: "✓ KEPT" text badge at top-left, green left border on kept cards. | Code: `w-3 h-3` (12px) empty circles at top-right. No text. No green left border on kept cards. |
| **V3** | SingleView | Camera params in wrong position | Wireframe §4.4 + Sprint-07 §10.4: "Semi-transparent panel, right edge, always visible." Vertical floating overlay. | Code: full-width opaque bottom bar (`bg-gray-900`, horizontal layout). Not floating, not transparent, not right-edge. |
| **V4** | SingleView | Status text not color-coded | Sprint-07 §10.5: "KEPT (green text)", "ELIMINATED (red text)". | Status bar uses `text-gray-400` for all states. No green/red coloring. |
| **V5** | SingleView | Missing "(read-only)" after commit | Sprint-07 §10.5: "When committed: append '(read-only)'" | Status bar never shows "(read-only)" text. Combined with bug B3, there's no visible committed indicator at all. |

### 9.3 Missing Keyboard Shortcuts (Specified for S7)

| ID | Screen | Key | Spec reference | Status |
|----|--------|-----|----------------|--------|
| **K1** | StackOverview | `h/j/k/l` | keyboard-map line 74, Sprint-07 §12.4 | Not wired up |
| **K2** | StackFocus | `h/j/k/l` | keyboard-map line 100, Sprint-07 §11.7 | Not wired up |
| **K3** | StackOverview | `Home/End` | keyboard-map lines 306-307 | Not wired up |
| **K4** | StackFocus | `Home/End` | keyboard-map lines 115-116 | Not wired up |
| **K5** | StackFocus | `E` | keyboard-map line 101: "Enter or E" | Only Enter works, E not handled |
| **K6** | Global | `Ctrl+B` | keyboard-map line 46: "Available from any screen" | Only works in StackOverview, not StackFocus/SingleView |

### 9.4 Missing UI Elements

| ID | Screen | Gap | Spec says | Code does |
|----|--------|-----|-----------|-----------|
| **U1** | ProjectList | No empty state text | Wireframe §1.5: "No projects yet." when list is empty | Nothing renders below New Project button when no projects exist |
| **U2** | StackFocus | No scrollIntoView on arrow nav | Wireframe §3.2: "Arrow-key navigation must scroll the focused card into view" | `focusedIndex` updates but no `scrollIntoView()` call. Cards scroll off-screen on long grids. Works correctly in StackOverview but missing in StackFocus. |
| **U3** | StackFocus | No green left border on kept cards | Wireframe §3.1: "Kept: Green left border" | No border-left styling. Only small dot badge. |
| **U4** | StackOverview | No Ctrl+Click for non-adjacent selection | Wireframe §2.5: "Ctrl+Click adds/removes individual stacks" | Only Shift+Arrow works (adjacent selection). No Ctrl+Click or toggle-select key. |
| **U5** | HelpOverlay | Missing shortcut entries | Wireframe §2.5 shows Home/End and hjkl in help | Help overlay doesn't list Home/End or hjkl for any screen |
| **U6** | Architecture | No shared components | Sprint-07 §2: DecisionBadge.svelte, CameraParams.svelte, StatusBar.svelte | All implemented inline. Style changes require editing multiple files. |

### 9.5 Behavioral Inconsistency

| ID | Screen | Gap | Description |
|----|--------|-----|-------------|
| **I1** | StackFocus vs StackOverview | Click behavior differs | StackOverview: clicking a card navigates to StackFocus. StackFocus: clicking a card only changes focus (must press Enter to navigate to SingleView). Inconsistent interaction pattern. |
| **I2** | SingleView | h/l keys undocumented | `h` and `l` work as Left/Right navigation but are NOT listed in the HelpOverlay for SingleView. |

### 9.6 Summary Table

| Severity | Count | IDs |
|----------|-------|-----|
| **Bugs** | 4 | B1, B2, B3, B4 |
| **Visual mismatches** | 5 | V1, V2, V3, V4, V5 |
| **Missing keys** | 6 | K1-K6 |
| **Missing UI** | 6 | U1-U6 |
| **Inconsistencies** | 2 | I1, I2 |
| **Total** | 23 | |

### 9.7 Recommended Fix Priority

**Fix immediately (blocks usable culling workflow):**
1. B2 + B3 — Refresh `roundStatus` after Y/X decisions and after Ctrl+Enter commit
2. B4 — Check `showBurstPanel` before Esc navigates in StackOverview
3. V4 + V5 — Color-code status text + show "(read-only)" after commit

**Fix soon (visual correctness):**
4. V2 — Enlarge decision badges, add text, match wireframe position
5. V3 — Move camera params to right-edge floating overlay
6. U2 — Add scrollIntoView to StackFocus arrow navigation
7. K1 + K2 — Wire up hjkl in StackOverview + StackFocus

**Fix before sprint close:**
8. K3 + K4 + K5 — Home/End + E key
9. V1 — Expose aperture/shutter/ISO/focal in LogicalPhotoSummary (API change)
10. U1 — "No projects yet." empty state text
11. U5 — Update HelpOverlay entries

**Defer (design decisions needed):**
12. B1 — Full-res JPEG display (requires asset protocol scope change to include source folders)
13. U4 — Ctrl+Click non-adjacent selection
14. U6 — Shared component extraction
15. I1 — Click-to-navigate vs click-to-focus consistency

---

*Generated from implemented code analysis on sprint-7 branch, 2026-03-02.*
