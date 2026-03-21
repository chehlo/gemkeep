# GemKeep UI Wireframes

Detailed ASCII wireframes for every screen in every state.
Keyboard shortcuts shown inline where they trigger transitions.

Sprint readiness markers:
- **[S7]** = "Good enough" for Sprint 7 (Minimum Viable Culling)
- **[S8]** = Sprint 8 (Comparison View & Stack Workflow)
- **[S9]** = Sprint 9 (Multi-Round Engine)
- **[S10]** = Sprint 10 (Multi-Round Engine)
- **[S11]** = Sprint 11 (GemStack — Final Curation)
- **[S12]** = Sprint 12 (Polish)

---

## 1. ProjectList

### 1.1 Empty State (First Launch)

```
┌──────────────────────────────────────────────────────────────────────┐
│                                                                      │
│   GemKeep                                                            │
│                                                                      │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │  Welcome to GemKeep                                     [S12] │  │
│  │                                                               │  │
│  │  A keyboard-first photo culling tool for photographers.       │  │
│  │                                                               │  │
│  │  How it works:                                                │  │
│  │  1. Create a project                                          │  │
│  │  2. Add your photo folders                                    │  │
│  │  3. Enter stacks and cull with Y/X keys                       │  │
│  │  4. Compare side-by-side to find your gems                    │  │
│  │                                                               │  │
│  │  Press ? at any time for keyboard shortcuts.                  │  │
│  │                                                     [Dismiss] │  │
│  └────────────────────────────────────────────────────────────────┘  │
│                                                                      │
│  + New Project                                                       │
│                                                                      │
│  No projects yet.                                                    │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

### 1.2 With Projects Listed

```
┌──────────────────────────────────────────────────────────────────────┐
│                                                                      │
│   GemKeep                                                            │
│                                                                      │
│  ┌── Resume ─────────────────────────────────────────────────────┐  │
│  │  Iceland 2024                                      [Open ->]  │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                                                                      │
│  + New Project                                                       │
│                                                                      │
│  Recent Projects                                                     │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │  Iceland 2024           iceland-2024 . Feb 25  [Open] [Delete]│  │
│  ├───────────────────────────────────────────────────────────────┤  │
│  │  Wedding Sep 2024       wedding-sep  . Sep 14  [Open] [Delete]│  │
│  ├───────────────────────────────────────────────────────────────┤  │
│  │  Bird Photography       bird-photo   . Jan 03  [Open] [Delete]│  │
│  └───────────────────────────────────────────────────────────────┘  │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

### 1.3 Create Project Form (expanded)

```
┌──────────────────────────────────────────────────────────────────────┐
│                                                                      │
│   GemKeep                                                            │
│                                                                      │
│  - New Project                                                       │
│  ┌───────────────────────────────────────┐                          │
│  │  Name                                 │                          │
│  │  ┌─────────────────────────────────┐  │                          │
│  │  │ Iceland 2024                    │  │                          │
│  │  └─────────────────────────────────┘  │                          │
│  │  Slug: iceland-2024                   │                          │
│  │                                       │                          │
│  │  [Create]                             │                          │
│  └───────────────────────────────────────┘                          │
│                                                                      │
│  Recent Projects                                                     │
│  ...                                                                 │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

**Keyboard:** Enter submits the form when name input is focused.

### 1.4 Delete Confirmation Modal

```
┌──────────────────────────────────────────────────────────────────────┐
│  (dimmed ProjectList behind)                                         │
│                                                                      │
│          ┌──────────────────────────────────────┐                   │
│          │  Delete project?                      │                   │
│          │                                       │                   │
│          │  iceland-2024 will be permanently     │                   │
│          │  deleted. This cannot be undone.       │                   │
│          │                                       │                   │
│          │              [Cancel]  [Delete]        │                   │
│          └──────────────────────────────────────┘                   │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

### 1.5 Behaviors

**Auto-open:** On app launch, if a last-opened project exists, the app
navigates directly to StackOverview (skipping ProjectList). The user only
sees ProjectList when pressing Esc from StackOverview, which sets
`skipAutoOpen` and populates the Resume card.

**Tab / Shift+Tab:** Browser-native Tab cycles focus between interactive
elements (Resume Open → button, + New Project, project row Open/Delete
buttons). Focus rings (`ring-2 ring-blue-500/30`) should be visible on
all focusable elements.

**"No projects yet":** When the project list is empty and no Resume card
is shown, display "No projects yet." below the + New Project button.

**? Help overlay** shows for this screen:
- `Enter` — Open project / submit create form
- `Esc` — Close overlay
- `?` — Toggle this help

**Future improvements [S-improvement]:**
- Arrow Up/Down to visually select project rows (highlighted row)
- Enter opens selected row; Delete requires separate confirmation
- `/` fuzzy search projects by name
- `N` shortcut to toggle New Project form
- `D` or `Del` to initiate delete on selected row (with confirmation)

---

## 2. StackOverview

### 2.1 Loading State

```
┌──────────────────────────────────────────────────────────────────────┐
│  <- Projects  /  Iceland 2024                                   Esc  │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  Loading...                                                          │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

### 2.2 Empty State (No Source Folders)

```
┌──────────────────────────────────────────────────────────────────────┐
│  <- Projects  /  Iceland 2024                                   Esc  │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  No source folders attached.                                         │
│                                                                      │
│  [+ Add Folder]                                                      │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

### 2.3 Importing (Scan Phase + Thumbnail Phase)

```
┌──────────────────────────────────────────────────────────────────────┐
│  <- Projects  /  Iceland 2024                                   Esc  │
├──────────────────────────────────────────────────────────────────────┤
│  SOURCE FOLDERS                                                      │
│  /home/user/Photos/Iceland                                           │
│                                                                      │
│  ── Indexing... ─────────────────────────────────────────────────     │
│  ████████████████████████░░░░░░░░░░░░░░░  2,341 / 3,500 files (67%) │
│  12 errors                                                           │
│                                                                      │
│  [Pause]  [Cancel]                                                   │
│                                                                      │
│  ── Generating thumbnails... ────────────────────────────────────    │
│  ████████████████░░░░░░░░░░░░░░░░░░░░░░░  1,100 / 2,341 (47%)      │
│                                                                      │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐                   │
│  │  [img]  │ │  [img]  │ │  [img]  │ │  [...]  │  <- stacks appear │
│  │         │ │         │ │         │ │         │     progressively  │
│  │ Stack #1│ │ Stack #2│ │ Stack #3│ │ Stack #4│                    │
│  │ 8 photos│ │ 3 photos│ │ 12 phot│ │ 1 photo │                    │
│  │ Feb 14  │ │ Feb 14  │ │ Feb 14  │ │ Feb 14  │                    │
│  └─────────┘ └─────────┘ └─────────┘ └─────────┘                   │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

### 2.4 Normal State (Indexed, Grid of Stacks) **[S7]**

The focused stack has a bright blue border. Arrow keys move focus.
Enter opens the focused stack in StackFocus.

```
┌──────────────────────────────────────────────────────────────────────┐
│  <- Projects  /  Iceland 2024                                   Esc  │
├──────────────────────────────────────────────────────────────────────┤
│  SOURCE FOLDERS                                                      │
│  /home/user/Photos/Iceland                                           │
│  [+ Add Folder]  [Re-index (r)]                                      │
│                                                                      │
│  Index complete.  Stacks: 387    Logical Photos: 2,341               │
│  142/387 stacks complete, 245 remaining                       [S10]  │
│  ─────────────────────────────────────────────────────────────────── │
│                                                                      │
│  ┌═══════════┐ ┌───────────┐ ┌───────────┐ ┌───────────┐           │
│  ║           ║ │           │ │           │ │           │           │
│  ║   [img]   ║ │   [img]   │ │   [img]   │ │   [img]   │           │
│  ║           ║ │           │ │           │ │           │           │
│  ║ Stack #1  ║ │ Stack #2  │ │ Stack #3  │ │ Stack #4  │           │
│  ║ 8 photos  ║ │ 3 photos  │ │ 12 photos │ │ 1 photo   │           │
│  ║ Feb 14    ║ │ Feb 14    │ │ Feb 14    │ │ Feb 14    │           │
│  ║ [3/8 ●●○]║ │ [undecided]│ │ [done ✓]  │ │ [1/1 ●]  │           │
│  └═══════════┘ └───────────┘ └───────────┘ └───────────┘           │
│       ▲ focused                                                      │
│                                                                      │
│  ┌───────────┐ ┌───────────┐ ┌───────────┐ ┌───────────┐           │
│  │           │ │           │ │           │ │           │           │
│  │   [img]   │ │   [img]   │ │   [img]   │ │   [img]   │           │
│  │           │ │           │ │           │ │           │           │
│  │ Stack #5  │ │ Stack #6  │ │ Stack #7  │ │ Stack #8  │           │
│  │ 6 photos  │ │ 2 photos  │ │ 15 photos │ │ 4 photos  │           │
│  │ Feb 15    │ │ Feb 15    │ │ Feb 15    │ │ Feb 15    │           │
│  │ [in prog] │ │ [undecided]│ │ [undecided]│ │ [done ✓]  │           │
│  └───────────┘ └───────────┘ └───────────┘ └───────────┘           │
│                                                                      │
│  Arrow keys: navigate  |  Enter: open stack  |  Ctrl+B: burst gap   │
│  F: GemStack  |  G: promote  |  ?: help                       [S12]  │
└──────────────────────────────────────────────────────────────────────┘
```

**Stack card progress badges [S8]:**
- `[undecided]` = no decisions yet (gray)
- `[in prog]` = some decisions made (yellow dot)
- `[3/8 ●●○]` = 3 of 8 decided, compact dots
- `[done ✓]` = all decided / finalized (green checkmark)
- `[promoted]` = survivors promoted to GemStack (gem icon or badge)

### 2.5 Behaviors

**Auto-start indexing:** When source folders exist but no stacks are
present (first open or after delete), indexing starts automatically
without user action.

**Auto-resume thumbnails:** When the project is re-opened and some
stacks have missing thumbnails, thumbnail generation resumes
automatically in the background.

**Remove folder (×):** Each source folder row shows a small × button
to remove it. Hidden during active indexing to prevent inconsistent state.

**Error log:** After indexing completes with errors, a collapsible
"Show N errors" section displays the error log.

**Sticky header area:** The source folders and summary section should
remain visible (sticky or scroll-bounded) so that the stack grid scrolls
independently beneath it. Arrow-key navigation in the grid should not
push the header off-screen.

**Selection for merge:** Shift+Arrow selects adjacent stacks. For
non-adjacent stacks, Ctrl+Click (or a toggle-select key) adds/removes
individual stacks from the selection. M merges all selected stacks.
Yellow ring (`ring-yellow-400`) indicates selected cards.

**? Help overlay** shows for this screen:
- `Arrow keys` / `hjkl` — Move focus
- `Enter` — Open stack
- `Home` / `End` — First / last stack
- `Shift+Arrow` — Multi-select adjacent stacks
- `M` — Merge selected stacks
- `Ctrl+Z` — Undo last merge
- `Ctrl+B` — Burst gap config
- `i` / `r` — Index / Re-index photos
- `Esc` — Back to ProjectList
- `?` — Toggle this help

**Future improvements [S-improvement]:**
- Ctrl+Click (or toggle key) to select non-adjacent stacks for merge
- hjkl Vim-style navigation (S7 spec, not yet implemented)
- Home/End jump to first/last stack (S7 spec, not yet implemented)
- Bottom shortcut hint bar [S12]

### 2.6 Burst Config Panel (Ctrl+B Overlay)

```
┌──────────────────────────────────────────────────────────────────────┐
│  <- Projects  /  Iceland 2024                                   Esc  │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  (dimmed grid behind)                                                │
│                                                                      │
│          ┌─────────────────────────────────────┐                    │
│          │  Burst gap                          │                    │
│          │                                     │                    │
│          │  Gap between bursts (seconds)       │                    │
│          │  ┌──────────────────────────────┐   │                    │
│          │  │ 3                            │   │                    │
│          │  └──────────────────────────────┘   │                    │
│          │                                     │                    │
│          │                [Cancel]  [Save]     │                    │
│          └─────────────────────────────────────┘                    │
│                                                                      │
│  (dimmed grid behind)                                                │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 3. StackFocus (Culling Mode)

### 3.1 Grid View with Decision Indicators **[S7]**

Thumbnail grid showing all photos in the stack. Each photo shows its
decision state via border color and badge. Camera metadata displayed
below each thumbnail. The focused photo has a bright blue selection ring.

```
┌──────────────────────────────────────────────────────────────────────┐
│  <- Back  /  Iceland 2024  >  Stack #1                          Esc  │
│  Round 1 of 1   |  5/12 decided . 3 kept . 2 elim . 7 remaining [S8]│
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌═══════════┐ ┌───────────┐ ┌───────────┐ ┌───────────┐           │
│  ║ ✓ KEPT    ║ │ ✗ ELIM    │ │           │ │ ✓ KEPT    │           │
│  ║ ┌───────┐ ║ │ ┌ ─ ─ ─ ┐ │ │ ┌───────┐ │ │ ┌───────┐ │           │
│  ║ │       │ ║ │ │ dimmed│ │ │ │       │ │ │ │       │ │           │
│  ║ │ [img] │ ║ │ │ [img] │ │ │ │ [img] │ │ │ │ [img] │ │           │
│  ║ │       │ ║ │ │       │ │ │ │       │ │ │ │       │ │           │
│  ║ └───────┘ ║ │ └ ─ ─ ─ ┘ │ │ └───────┘ │ │ └───────┘ │           │
│  ║ GREEN bdr ║ │  RED dim   │ │  no badge │ │ GREEN bdr │           │
│  ║───────────║ │───────────│ │───────────│ │───────────│           │
│  ║ 14:23:01  ║ │ 14:23:02  │ │ 14:23:02  │ │ 14:23:03  │           │
│  ║ f/2.8     ║ │ f/2.8     │ │ f/4.0     │ │ f/2.8     │           │
│  ║ 1/250s    ║ │ 1/250s    │ │ 1/125s    │ │ 1/500s    │           │
│  ║ ISO 400   ║ │ ISO 400   │ │ ISO 800   │ │ ISO 200   │           │
│  ║ 85mm      ║ │ 85mm      │ │ 85mm      │ │ 85mm      │           │
│  ║ RAW JPEG  ║ │ RAW JPEG  │ │ JPEG      │ │ RAW JPEG  │           │
│  └═══════════┘ └───────────┘ └───────────┘ └───────────┘           │
│     ▲ focused (blue ring)                                            │
│                                                                      │
│  ┌───────────┐ ┌───────────┐ ┌───────────┐ ┌───────────┐           │
│  │ ✗ ELIM    │ │           │ │           │ │ ✓ KEPT    │           │
│  │ ┌ ─ ─ ─ ┐ │ │ ┌───────┐ │ │ ┌───────┐ │ │ ┌───────┐ │           │
│  │ │ dimmed│ │ │ │       │ │ │ │       │ │ │ │       │ │           │
│  │ │ [img] │ │ │ │ [img] │ │ │ │ [img] │ │ │ │ [img] │ │           │
│  │ │       │ │ │ │       │ │ │ │       │ │ │ │       │ │           │
│  │ └ ─ ─ ─ ┘ │ │ └───────┘ │ │ └───────┘ │ │ └───────┘ │           │
│  │───────────│ │───────────│ │───────────│ │───────────│           │
│  │ 14:23:03  │ │ 14:23:04  │ │ 14:23:04  │ │ 14:23:05  │           │
│  │ f/2.8     │ │ f/5.6     │ │ f/2.8     │ │ f/2.8     │           │
│  │ 1/250s    │ │ 1/60s     │ │ 1/250s    │ │ 1/250s    │           │
│  │ ISO 400   │ │ ISO 1600  │ │ ISO 400   │ │ ISO 400   │           │
│  │ 85mm      │ │ 35mm      │ │ 85mm      │ │ 85mm      │           │
│  │ RAW JPEG  │ │ RAW       │ │ RAW JPEG  │ │ RAW JPEG  │           │
│  └───────────┘ └───────────┘ └───────────┘ └───────────┘           │
│                                                                      │
│  Arrows: navigate | Enter: single view | Y: keep | X: eliminate      │
│  C: compare | Ctrl+Enter: commit round                        [S12]  │
└──────────────────────────────────────────────────────────────────────┘
```

**Decision visual indicators [S7]:**
- **Kept:** Green left border + small green `✓ KEPT` badge at top-left corner of card
- **Eliminated:** Red-tinted dimmed image + small red `✗ ELIM` badge, 50% opacity on thumbnail
- **Undecided:** No badge, full opacity, neutral border

**Camera parameters below each thumbnail [S7]:**
- Capture time (HH:MM:SS)
- Aperture (f/X.X)
- Shutter speed (1/Xs)
- ISO
- Focal length (Xmm)
- Format badges: `RAW` `JPEG`

**Round indicator [S9]:**
Shows `Round 1 of N` in the header. Bracket keys `[` `]` navigate rounds.

### 3.2 Behaviors

**Decision visual components must be shared** across StackFocus and
SingleView via a common component (e.g. `DecisionIndicator.svelte`)
so that changing the style in one place updates all screens.

**scrollIntoView:** Arrow-key navigation must scroll the focused card
into view, matching the pattern used in StackOverview.

**? Help overlay** shows for this screen:
- `Arrow keys` / `hjkl` — Move focus in grid
- `Enter` / `E` — Open in single view
- `Tab` — Jump to next undecided
- `Shift+Tab` — Jump to previous undecided
- `Home` / `End` — First / last photo
- `Y` — Keep photo
- `X` — Eliminate photo
- `Ctrl+Enter` — Commit round
- `Esc` — Back to StackOverview
- `?` — Toggle this help

**Future improvements [S-improvement]:**
- hjkl Vim-style navigation (S7 spec, not yet implemented)
- Home/End first/last photo (S7 spec, not yet implemented)
- E key to open SingleView (S7 spec, not yet implemented)
- Camera params on grid cards (aperture, shutter, ISO, focal length)
  requires extending LogicalPhotoSummary IPC contract

### 3.3 Stack Complete State **[S8]**

```
┌──────────────────────────────────────────────────────────────────────┐
│  <- Back  /  Iceland 2024  >  Stack #1                          Esc  │
│  Round 1 of 1   |  12/12 decided . 3 kept . 9 eliminated            │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │  Stack complete!  3 survivors.                                │  │
│  │  Ctrl+Enter to commit round  |  Down arrow for next stack     │  │
│  └────────────────────────────────────────────────────────────────┘  │
│                                                                      │
│  (grid of photos with decision badges as above)                      │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 4. SingleView (Full-Screen Culling) **[S7]**

The most important screen for per-photo evaluation. Photo fills the
viewport. Minimal chrome. Camera parameters always visible.

### 4.1 Undecided Photo

```
┌──────────────────────────────────────────────────────────────────────┐
│                                                                      │
│                                                                      │
│                                                                      │
│                                                                      │
│                                                                      │
│                                                                      │
│                    ┌──────────────────────────┐                      │
│                    │                          │                      │
│                    │                          │                      │
│                    │                          │                      │
│                    │      FULL-SCREEN         │                      │
│                    │        PHOTO             │                      │
│                    │                          │                      │
│                    │                          │                      │
│                    │                          │                      │
│                    │                          │                      │
│                    └──────────────────────────┘                      │
│                                                                      │
│                                                            ┌───────┐│
│                                                            │ EXIF  ││
│                                                            │       ││
│                                                            │ f/2.8 ││
│                                                            │1/250s ││
│                                                            │ISO 400││
│                                                            │ 85mm  ││
│                                                            │ +0.7  ││
│                                                            │       ││
│                                                            │Canon  ││
│                                                            │EOS R5 ││
│                                                            │       ││
│                                                            │RAW+JPG││
│                                                            └───────┘│
│ ┌────────────────────────────────────────────────────────────────┐   │
│ │ Photo 5/12 . Stack: Iceland Sunset . Round 1 .  UNDECIDED     │   │
│ └────────────────────────────────────────────────────────────────┘   │
│  <-  ->: navigate | Y: keep | X: eliminate | U: undo | Esc: back    │
└──────────────────────────────────────────────────────────────────────┘
```

### 4.2 Photo Marked as KEPT (Visual Feedback) **[S7]**

When Y is pressed, a brief green flash fills the border, then settles
to a persistent thin green border on the photo edge.

```
┌──────────────────────────────────────────────────────────────────────┐
│ ╔════════════════════════════════════════════════════════════════════╗│
│ ║  GREEN BORDER (persistent after Y)                               ║│
│ ║                                                                  ║│
│ ║                                                                  ║│
│ ║                                                                  ║│
│ ║                  ┌──────────────────────────┐                    ║│
│ ║                  │                          │                    ║│
│ ║                  │                          │                    ║│
│ ║                  │      FULL-SCREEN         │                    ║│
│ ║                  │        PHOTO             │                    ║│
│ ║                  │                          │                    ║│
│ ║                  │                          │                    ║│
│ ║                  │                          │                    ║│
│ ║                  └──────────────────────────┘                    ║│
│ ║                                                                  ║│
│ ║                                                          ┌─────┐ ║│
│ ║                                                          │EXIF │ ║│
│ ║                                                          │f/2.8│ ║│
│ ║                                                          │...  │ ║│
│ ║                                                          └─────┘ ║│
│ ║ ┌──────────────────────────────────────────────────────────────┐ ║│
│ ║ │ Photo 5/12 . Stack: Iceland Sunset . Round 1 . ✓ KEPT       │ ║│
│ ║ └──────────────────────────────────────────────────────────────┘ ║│
│ ╚════════════════════════════════════════════════════════════════════╝│
│  <-  ->: navigate | Y: keep | X: eliminate | U: undo | Esc: back    │
└──────────────────────────────────────────────────────────────────────┘
```

### 4.3 Photo Marked as ELIMINATED (Visual Feedback) **[S7]**

When X is pressed, a brief red flash, then the photo dims to 50%
opacity with a persistent red border.

```
┌──────────────────────────────────────────────────────────────────────┐
│ ┌────────────────────────────────────────────────────────────────────┐
│ │  RED BORDER (persistent after X)                                  │
│ │                                                                   │
│ │                                                                   │
│ │                  ┌──────────────────────────┐                     │
│ │                  │░░░░░░░░░░░░░░░░░░░░░░░░░░│                     │
│ │                  │░░░░░░░░░░░░░░░░░░░░░░░░░░│                     │
│ │                  │░░░  DIMMED  PHOTO  ░░░░░░│                     │
│ │                  │░░░  (50% opacity)  ░░░░░░│                     │
│ │                  │░░░░░░░░░░░░░░░░░░░░░░░░░░│                     │
│ │                  │░░░░░░░░░░░░░░░░░░░░░░░░░░│                     │
│ │                  └──────────────────────────┘                     │
│ │                                                                   │
│ │                                                          ┌─────┐  │
│ │                                                          │EXIF │  │
│ │                                                          │f/2.8│  │
│ │                                                          │...  │  │
│ │                                                          └─────┘  │
│ │ ┌──────────────────────────────────────────────────────────────┐  │
│ │ │ Photo 5/12 . Stack: Iceland Sunset . Round 1 . ✗ ELIMINATED │  │
│ │ └──────────────────────────────────────────────────────────────┘  │
│ └────────────────────────────────────────────────────────────────────┘
│  <-  ->: navigate | Y: keep | X: eliminate | U: undo | Esc: back    │
└──────────────────────────────────────────────────────────────────────┘
```

### 4.4 Camera Parameters Overlay Detail **[S7]**

Semi-transparent panel, right edge, always visible. Shows core EXIF
fields that the hobbyist user studies to learn from their photos.

```
                                             ┌──────────────┐
                                             │  PARAMETERS  │
                                             │              │
                                             │  f/2.8       │  Aperture
                                             │  1/250s      │  Shutter speed
                                             │  ISO 400     │  ISO sensitivity
                                             │  85mm        │  Focal length
                                             │  +0.7 EV     │  Exposure comp
                                             │              │
                                             │  Canon EOS R5│  Camera body
                                             │  RF 85mm     │  Lens
                                             │  f/1.2L      │
                                             │              │
                                             │  RAW + JPEG  │  Format badges
                                             │  Feb 14      │  Capture date
                                             │  14:23:01    │  Capture time
                                             └──────────────┘
```

**Sprint 7 "good enough":** Monospace text, semi-transparent dark background.
No fancy styling. Just readable numbers that align vertically.

### 4.5 Behaviors

**Decision borders use shared component** with StackFocus — same
`DecisionIndicator.svelte` component renders the viewport-level border
in SingleView and the card-level indicator in StackFocus grid.

**Status bar format:** `Photo {n}/{total} . Stack: {name} . Round {n} . {STATUS}`

**Camera params panel:** Right-side floating overlay (not bottom bar).
Toggle with `I` key. Default: visible.

**? Help overlay** shows for this screen:
- `Left` / `Right` / `h` / `l` — Previous / next photo
- `Home` / `End` — First / last photo
- `Tab` — Jump to next undecided
- `Shift+Tab` — Jump to previous undecided
- `Y` — Keep photo
- `X` — Eliminate photo
- `I` — Toggle camera params
- `Ctrl+Enter` — Commit round
- `Esc` — Back to StackFocus
- `?` — Toggle this help

### 4.6 Round Committed State **[S9]**

After Ctrl+Enter, the status bar changes and Y/X are disabled.

```
│ ┌──────────────────────────────────────────────────────────────────┐│
│ │ Photo 5/12 . Round 1 COMMITTED . ✓ KEPT . (read-only)          ││
│ └──────────────────────────────────────────────────────────────────┘│
│  <-  ->: navigate | Esc: back | Round is committed (Y/X disabled)  │
```

---

## 5. Comparison View (Side-by-Side) **[S8]**

The PRIMARY decision-making view. Two photos displayed 50/50 with
camera parameters for both. This is where learning happens.

### 5.1 Normal Comparison

Enter from StackFocus by selecting two photos and pressing C, or by
pressing C on any focused photo (auto-pairs with next undecided).

```
┌──────────────────────────────────────────────────────────────────────┐
│  <- Back to Stack  /  Stack #1: Comparison                      Esc  │
│  5/12 decided . 3 kept . 2 elim . 7 remaining  |  Round 1    [S8]   │
├─────────────────────────────┬────────────────────────────────────────┤
│                             │                                        │
│        PHOTO  A             │          PHOTO  B                      │
│     (active - blue border)  │                                        │
│  ╔═════════════════════╗    │    ┌─────────────────────┐             │
│  ║                     ║    │    │                     │             │
│  ║                     ║    │    │                     │             │
│  ║                     ║    │    │                     │             │
│  ║     FULL PHOTO      ║    │    │     FULL PHOTO      │             │
│  ║                     ║    │    │                     │             │
│  ║                     ║    │    │                     │             │
│  ║                     ║    │    │                     │             │
│  ╚═════════════════════╝    │    └─────────────────────┘             │
│                             │                                        │
│  ┌───────────────────┐      │    ┌───────────────────┐               │
│  │ f/2.8             │      │    │ f/4.0             │               │
│  │ 1/250s            │      │    │ 1/125s            │               │
│  │ ISO 400           │      │    │ ISO 800           │               │
│  │ 85mm              │      │    │ 85mm              │               │
│  │ +0.7 EV           │      │    │ +0.0 EV           │               │
│  │ Canon EOS R5      │      │    │ Canon EOS R5      │               │
│  │ RAW + JPEG        │      │    │ RAW + JPEG        │               │
│  └───────────────────┘      │    └───────────────────┘               │
│                             │                                        │
│  Status: UNDECIDED          │    Status: UNDECIDED                   │
│  Photo 3 of 12              │    Photo 7 of 12                       │
│                             │                                        │
├─────────────────────────────┴────────────────────────────────────────┤
│  Tab: switch active side | Y: keep active | X: eliminate active      │
│  L: lock pair | <-/->: replace active photo | Esc: back to grid     │
└──────────────────────────────────────────────────────────────────────┘
```

### 5.2 After Eliminating Photo A (Auto-Fill) **[S8]**

Photo A was eliminated. It auto-fills with the next undecided photo.
Brief transition: old photo dims and slides out, new photo slides in.

```
┌──────────────────────────────────────────────────────────────────────┐
│  <- Back to Stack  /  Stack #1: Comparison                      Esc  │
│  6/12 decided . 3 kept . 3 elim . 6 remaining  |  Round 1           │
├─────────────────────────────┬────────────────────────────────────────┤
│                             │                                        │
│        PHOTO  A  (NEW)      │          PHOTO  B                      │
│     (active - blue border)  │                                        │
│  ╔═════════════════════╗    │    ┌─────────────────────┐             │
│  ║                     ║    │    │                     │             │
│  ║     NEW UNDECIDED   ║    │    │     SAME PHOTO      │             │
│  ║     PHOTO FILLED IN ║    │    │     AS BEFORE       │             │
│  ║                     ║    │    │                     │             │
│  ╚═════════════════════╝    │    └─────────────────────┘             │
│                             │                                        │
│  ┌───────────────────┐      │    ┌───────────────────┐               │
│  │ f/5.6             │      │    │ f/4.0             │               │
│  │ 1/60s             │      │    │ 1/125s            │               │
│  │ ISO 1600          │      │    │ ISO 800           │               │
│  │ 35mm              │      │    │ 85mm              │               │
│  │ +0.0 EV           │      │    │ +0.0 EV           │               │
│  └───────────────────┘      │    └───────────────────┘               │
│                             │                                        │
│  Status: UNDECIDED          │    Status: UNDECIDED                   │
│                             │                                        │
├─────────────────────────────┴────────────────────────────────────────┤
│  Tab: switch active side | Y: keep active | X: eliminate active      │
│  L: lock pair | <-/->: replace active photo | Esc: back to grid     │
└──────────────────────────────────────────────────────────────────────┘
```

### 5.3 Locked Comparison Layout **[S8]**

When L is pressed, auto-fill is suppressed. A lock icon appears.
The user can study both photos without interruption.

```
┌──────────────────────────────────────────────────────────────────────┐
│  <- Back to Stack  /  Stack #1: Comparison              LOCKED  Esc  │
│  5/12 decided . 3 kept . 2 elim . 7 remaining  |  Round 1           │
├─────────────────────────────┬────────────────────────────────────────┤
│                             │                                        │
│        PHOTO  A             │          PHOTO  B                      │
│                             │                                        │
│  ┌─────────────────────┐    │    ┌─────────────────────┐             │
│  │                     │    │    │                     │             │
│  │     PHOTO           │    │    │     PHOTO           │             │
│  │                     │    │    │                     │             │
│  └─────────────────────┘    │    └─────────────────────┘             │
│                             │                                        │
│  (camera params)            │    (camera params)                     │
│                             │                                        │
│  Status: ✓ KEPT             │    Status: UNDECIDED                   │
│                             │                                        │
├─────────────────────────────┴────────────────────────────────────────┤
│  LOCKED - auto-fill paused  |  L: unlock  |  Y/X: decide active     │
└──────────────────────────────────────────────────────────────────────┘
```

### 5.4 Comparison Finished (No More Undecided) **[S8]**

All photos in the stack have been decided. Comparison exits gracefully.

```
┌──────────────────────────────────────────────────────────────────────┐
│  <- Back to Stack  /  Stack #1: Comparison                      Esc  │
│  12/12 decided . 3 kept . 9 elim . 0 remaining  |  Round 1          │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │                                                                │  │
│  │   All photos decided!                                          │  │
│  │   3 survivors in this stack.                                   │  │
│  │                                                                │  │
│  │   Ctrl+Enter: commit round                                     │  │
│  │   Esc: back to stack grid                                      │  │
│  │   Down arrow: next undecided stack                             │  │
│  │                                                                │  │
│  └────────────────────────────────────────────────────────────────┘  │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 6. GemStack View **[S11]**

The GemStack is a special stack containing photos promoted from regular
stacks. It behaves identically to StackFocus — same round engine, same
Y/X decisions, same comparison view. Each photo shows its source stack
for provenance.

### 6.1 GemStack Grid

```
┌──────────────────────────────────────────────────────────────────────┐
│  <- Stack Overview  /  Iceland 2024: GemStack                   Esc  │
│  238 photos from 142 stacks  |  Round 1                       [S11]  │
│  42/238 decided . 30 kept . 12 elim . 196 remaining                  │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌═══════════┐ ┌───────────┐ ┌───────────┐ ┌───────────┐           │
│  ║ ✓ KEPT    ║ │           │ │           │ │           │           │
│  ║   [img]   ║ │   [img]   │ │   [img]   │ │   [img]   │           │
│  ║           ║ │           │ │           │ │           │           │
│  ║ f/2.8     ║ │ f/4.0     │ │ f/2.8     │ │ f/1.4     │           │
│  ║ 1/250s    ║ │ 1/125s    │ │ 1/500s    │ │ 15s       │           │
│  ║ ISO 400   ║ │ ISO 800   │ │ ISO 200   │ │ ISO 3200  │           │
│  ║ 85mm      ║ │ 85mm      │ │ 85mm      │ │ 14mm      │           │
│  ║ Stack #1  ║ │ Stack #1  │ │ Stack #1  │ │ Stack #3  │           │
│  └═══════════┘ └───────────┘ └───────────┘ └───────────┘           │
│     ▲ focused                                                        │
│                                                                      │
│  ┌───────────┐ ┌───────────┐                                       │
│  │   [img]   │ │   [img]   │                                       │
│  │ ...       │ │ ...       │                                       │
│  │ Stack #5  │ │ Stack #5  │                                       │
│  └───────────┘ └───────────┘                                       │
│                                                                      │
│  Arrows: navigate | Enter: single view | Y: keep | X: eliminate      │
│  C: compare | Ctrl+Enter: commit round | Esc: back                  │
└──────────────────────────────────────────────────────────────────────┘
```

### 6.2 GemStack Finalized

```
┌──────────────────────────────────────────────────────────────────────┐
│  <- Stack Overview  /  Iceland 2024: GemStack FINALIZED         Esc  │
│  48 gems from 142 stacks  |  FINALIZED                               │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌──────────────────────────────────────────────────────────────┐    │
│  │  GemStack finalized.  48 gems ready for export.             │    │
│  │  Press E to export  |  T to tag gems                        │    │
│  └──────────────────────────────────────────────────────────────┘    │
│                                                                      │
│  (grid of finalized gem photos, all with green badges + provenance)  │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 7. Keyboard Help Overlay **[S12]**

Pressing `?` shows a non-modal overlay. Dismiss with `?` or `Esc`.
Content adapts to the current screen.

```
┌──────────────────────────────────────────────────────────────────────┐
│                                                                      │
│  (current screen dimmed behind)                                      │
│                                                                      │
│     ┌──────────────────────────────────────────────────────────┐     │
│     │  KEYBOARD SHORTCUTS  (Stack Focus)           ? to close  │     │
│     │                                                          │     │
│     │  NAVIGATION                    DECISIONS                 │     │
│     │  Arrow keys   Move focus       Y   Keep photo            │     │
│     │  Enter        Single view      X   Eliminate photo       │     │
│     │  Esc          Back to stacks   U   Undo last decision    │     │
│     │  Home         First photo                                │     │
│     │  End          Last photo       ROUNDS                    │     │
│     │                                Ctrl+Enter  Commit round  │     │
│     │  VIEWS                         [  Previous round         │     │
│     │  C            Compare view     ]  Next round             │     │
│     │  E or Enter   Single view                                │     │
│     │                                OTHER                     │     │
│     │  SELECTION                     Ctrl+B  Burst config      │     │
│     │  Shift+Arrow  Multi-select     ?       This help         │     │
│     │  Tab          Next undecided   A       Auto-advance      │     │
│     │                                                          │     │
│     └──────────────────────────────────────────────────────────┘     │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 8. Screen Transitions (State Machine)

### 8.1 Full State Machine Diagram

```
                              ┌─────────────┐
                              │ ProjectList │
                              │             │
                              │ Create/Open │
                              └──────┬──────┘
                                     │ Enter (open project)
                                     │
                                     ▼
                     Esc  ┌─────────────────────┐
                  ┌───────│   StackOverview     │
                  │       │                     │
                  │       │ Grid of stacks      │
                  │       │ Ctrl+B: burst panel │
                  │       └──┬─────────────┬────┘
                  │          │             │
                  ▼          │ Enter       │ F
           ProjectList       │             │
                             ▼             ▼
                     ┌──────────────┐  ┌──────────────────┐
                Esc  │  StackFocus  │  │ GemStack     │
              ┌──────│              │  │                  │ [S10]
              │      │ Photo grid   │  │ Cross-stack gems │
              │      │ Y/X decide   │  │ Same Y/X/C keys  │
              │      └──┬────────┬──┘  └──────────────────┘
              │         │        │            ▲
              ▼         │        │            │ Esc
        StackOverview   │        │            │
                        │ Enter  │ C     GemStack
                        │        │       (if entered from
                        ▼        ▼        GemStack)
              ┌──────────┐  ┌───────────────┐
         Esc  │SingleView│  │ComparisonView │ [S8]
        ┌─────│          │  │               │
        │     │Full photo│  │ 50/50 split   │
        │     │Y/X decide│  │ Tab: switch   │
        │     │Camera info│  │ L: lock       │
        │     └──────────┘  │ Y/X on active │
        │                   └───────────────┘
        ▼                         │
   StackFocus                     │ Esc
   (or GemStack                   ▼
    if entered from          StackFocus
    GemStack context)        (or GemStack)
```

### 8.2 Transition Table

```
┌─────────────────┬───────────────┬───────────────────┬──────────────────┐
│ FROM            │ KEY           │ TO                │ STATE PRESERVED  │
├─────────────────┼───────────────┼───────────────────┼──────────────────┤
│ ProjectList     │ Enter/Click   │ StackOverview     │ project slug     │
│ StackOverview   │ Esc           │ ProjectList       │ resume project   │
│ StackOverview   │ Enter         │ StackFocus        │ focused index    │
│ StackOverview   │ F             │ GemStack      │ --           [S10]│
│ StackFocus      │ Esc           │ StackOverview     │ restore scroll   │
│ StackFocus      │ Enter         │ SingleView        │ photo index      │
│ StackFocus      │ C             │ ComparisonView    │ selected pair[S8]│
│ SingleView      │ Esc           │ StackFocus        │ photo index      │
│ SingleView      │ Left/Right    │ SingleView (nav)  │ within stack     │
│ ComparisonView  │ Esc           │ StackFocus        │ decision state   │
│ GemStack    │ Esc           │ StackOverview     │ --               │
│ GemStack    │ Enter         │ SingleView        │ photo index      │
│ GemStack    │ C             │ ComparisonView    │ selected pair    │
│ Any screen      │ ?             │ Help overlay      │ screen unchanged │
│ Any screen      │ Ctrl+B        │ Burst panel       │ screen unchanged │
└─────────────────┴───────────────┴───────────────────┴──────────────────┘
```

### 8.3 State Preservation Rules

1. **StackOverview -> StackFocus -> StackOverview:** Focus index saved on
   leave, restored on return. Scroll position restored after DOM render
   via `tick()`.

2. **StackFocus -> SingleView -> StackFocus:** Photo index preserved
   bidirectionally. Decisions made in SingleView are reflected
   immediately in StackFocus grid on return.

3. **StackFocus -> ComparisonView -> StackFocus:** Decision state (which
   photos are kept/eliminated) always in sync. Comparison auto-fill
   changes are reflected in the grid.

4. **GemStack context:** When entering SingleView or ComparisonView
   from GemStack, Esc returns to GemStack (not StackFocus).
   The navigation stack tracks the entry point.

5. **Decisions are never lost on transition.** Every Y/X is written to
   SQLite immediately (WAL mode). Screen transitions are cosmetic;
   state lives in the database.

---

## 9. Auto-Advance Indicator **[S8]**

When auto-advance is enabled (toggle with `A` key or Caps Lock),
a persistent indicator appears in the status bar.

### Off (default -- deliberate workflow):
```
│ Photo 5/12 . Stack: Iceland Sunset . Round 1 . UNDECIDED             │
```

### On:
```
│ Photo 5/12 . Stack: Iceland Sunset . Round 1 . UNDECIDED  [AUTO >>] │
```

When auto-advance is ON, pressing Y or X immediately moves to the next
undecided photo. The transition is instant (no animation delay).

---

## 10. Multi-Round UI Elements **[S9]**

### 10.1 Round Selector Bar (in StackFocus header)

```
│  Round: [1] [2] [3*]   |  5/8 decided . 3 kept . 2 elim . 3 remaining │
│         ▲               ▲                                               │
│     completed       current (editable)                                  │
│     (read-only)                                                         │
```

- Bracket keys `[` and `]` cycle between rounds
- Completed rounds show in gray, current round in blue
- Star `*` marks the current editable round
- `Ctrl+Enter` commits current round, `Ctrl+Shift+Enter` finalizes stack

### 10.2 Round History View (navigating to a past round)

```
┌──────────────────────────────────────────────────────────────────────┐
│  <- Back  /  Iceland 2024  >  Stack #1                          Esc  │
│  Viewing Round 1 (COMMITTED - read only)  |  [1*] [2] [3]           │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │  ROUND 1 SNAPSHOT (read-only)                                 │  │
│  │  Press ] to return to current round  |  R to restore a photo  │  │
│  └────────────────────────────────────────────────────────────────┘  │
│                                                                      │
│  (grid of photos showing Round 1 decisions, dimmed eliminated)       │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 11. Quick Preview in StackOverview **[S12]**

Press Space on a focused stack card to see a larger preview without
entering StackFocus. Dismiss on any key or click.

```
┌──────────────────────────────────────────────────────────────────────┐
│  <- Projects  /  Iceland 2024                                   Esc  │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  (dimmed grid behind)                                                │
│                                                                      │
│          ┌──────────────────────────────────────────┐               │
│          │                                          │               │
│          │                                          │               │
│          │                                          │               │
│          │          LARGE PREVIEW                   │               │
│          │          of Stack #1 thumbnail            │               │
│          │                                          │               │
│          │                                          │               │
│          │                                          │               │
│          │──────────────────────────────────────────│               │
│          │  Stack #1  |  8 photos  |  Feb 14 14:23  │               │
│          │  3/8 decided  |  2 kept  |  1 eliminated │               │
│          └──────────────────────────────────────────┘               │
│                                                                      │
│  Press any key to dismiss                                            │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 12. Responsive Layout Notes

All wireframes assume a minimum window size of 1280x720. The grid
column count adapts:

| Window width | StackOverview cols | StackFocus cols |
|---|---|---|
| < 1024px | 3 | 3 |
| 1024 - 1599px | 4 | 4 |
| >= 1600px | 5 or 6 | 5 or 6 |

SingleView and ComparisonView are always full-width. The camera
parameters panel collapses to a single row at narrow widths.

---

## 13. Color Palette Reference

| Element | Color | CSS |
|---|---|---|
| Kept border | Green | `border-green-500` |
| Kept badge | Green on dark | `bg-green-800 text-green-200` |
| Eliminated border | Red | `border-red-500` |
| Eliminated dimming | 50% opacity | `opacity-50` |
| Eliminated badge | Red on dark | `bg-red-800 text-red-200` |
| Undecided | No special color | Default gray border |
| Focused card | Blue ring | `ring-2 ring-blue-500/30 border-blue-500` |
| Active side (comparison) | Blue border | `border-blue-400` |
| Locked indicator | Yellow | `text-yellow-400` |
| Auto-advance ON | Cyan badge | `bg-cyan-800 text-cyan-200` |
| Round committed | Gray text | `text-gray-500` |
| Background | Dark gray | `bg-gray-950` |
