# GemKeep Test Coverage Matrix

**Generated:** 2026-03-29
**Branch:** main (commit 3478632)

## Overall Summary

| Metric | Count |
|--------|-------|
| Total behaviors audited | 229 |
| Tested (all tech) | 121 |
| **Coverage (all behaviors)** | **52.8%** |
| **Coverage (excl. not-implemented)** | **62.1%** |
| Untested (implemented) | 74 |
| Not implemented | 34 |

### Technology Breakdown

| Technology | Behaviors using it |
|------------|-------------------|
| jsdom (Vitest) | 106 |
| Playwright E2E | 33 |
| vitest-browser-svelte | 12 |
| No test (none) | 109 |

### Status Legend

| Marker | Meaning |
|--------|---------|
| TESTED-VISUAL | Tested with correct visual technology (Playwright/vbs) |
| TESTED-DOM-ONLY | Tested with jsdom -- correct for DOM/logic assertions |
| TESTED-WRONG-TECH | Tested but wrong technology (jsdom for visual CSS) |
| UNTESTED | Implemented but no test exists |
| NOT-IMPLEMENTED | Specified in wireframe/keyboard-map but not coded |

---

## 1. ProjectList (Wireframe Section 1)

**Component:** `src/lib/components/screens/ProjectList.svelte`
**Unit tests:** `src/lib/components/screens/ProjectList.test.ts`
**E2E:** `tests/e2e/project-management.spec.ts`

| ID | Behavior | Wireframe | Impl? | Test | Current | Correct | Status |
|----|----------|-----------|-------|------|---------|---------|--------|
| PL-01 | App title 'GemKeep' heading displayed | S1.1, S1.2 | Yes | does NOT auto-navigate away (c... | jsdom | jsdom | TESTED-DOM-ONLY |
| PL-02 | Auto-open: navigates to StackOverview if last-opened | S1.5 | Yes | auto-opens last project if one... | jsdom | jsdom | TESTED-DOM-ONLY |
| PL-03 | Shows project list when no last project exists | S1.2 | Yes | shows project list when no las... | jsdom | jsdom | TESTED-DOM-ONLY |
| PL-04 | skipAutoOpen: does NOT auto-navigate when returning | S1.5 | Yes | does NOT auto-navigate away | jsdom | jsdom | TESTED-DOM-ONLY |
| PL-05 | skipAutoOpen: does NOT call get_last_project | S1.5 | Yes | does NOT call get_last_project... | jsdom | jsdom | TESTED-DOM-ONLY |
| PL-06 | Resume card shown with project name when returning | S1.2 | Yes | shows Resume card with correct... | jsdom | jsdom | TESTED-DOM-ONLY |
| PL-07 | Resume card 'Open ->' button opens project | S1.2 | Yes | opens project when Resume 'Ope... | jsdom | jsdom | TESTED-DOM-ONLY |
| PL-08 | Resume card visual styling (blue bg, border) | S1.2 | Yes | -- | none | vbs | UNTESTED |
| PL-09 | + New Project toggle shows/hides create form | S1.2, S1.3 | Yes | can create a project and navig... | playwright | jsdom | TESTED-DOM-ONLY |
| PL-10 | Create form: name input with placeholder | S1.3 | Yes | -- | none | jsdom | UNTESTED |
| PL-11 | Create form: slug preview (debounced 200ms) | S1.3 | Yes | -- | none | jsdom | UNTESTED |
| PL-12 | Create form: Create button disabled when empty | S1.3 | Yes | -- | none | jsdom | UNTESTED |
| PL-13 | Create form: button text 'Creating...' while submitting | -- | Yes | -- | none | jsdom | UNTESTED |
| PL-14 | Create form: Enter key submits the form | S1.3 | Yes | -- | none | jsdom | UNTESTED |
| PL-15 | Create form: success navigates to StackOverview | S1.3 | Yes | can create a project and navig... | playwright | playwright | TESTED-VISUAL |
| PL-16 | Create form: error displayed on failure | -- | Yes | -- | none | jsdom | UNTESTED |
| PL-17 | Project list: row shows name, slug, date | S1.2 | Yes | each project row shows its own... | jsdom | jsdom | TESTED-DOM-ONLY |
| PL-18 | Project list: Open button navigates to StackOverview | S1.2 | Yes | -- | none | jsdom | UNTESTED |
| PL-19 | Delete button opens confirmation modal | S1.2, S1.4 | Yes | -- | none | jsdom | UNTESTED |
| PL-20 | Delete modal: shows slug name and warning text | S1.4 | Yes | -- | none | jsdom | UNTESTED |
| PL-21 | Delete modal: Cancel button closes modal | S1.4 | Yes | -- | none | jsdom | UNTESTED |
| PL-22 | Delete modal: Delete calls deleteProject, refreshes | S1.4 | Yes | -- | none | jsdom | UNTESTED |
| PL-23 | Delete modal: dimmed background overlay (bg-black/70) | S1.4 | Yes | -- | none | vbs | UNTESTED |
| PL-24 | Multiple projects with same id=1 render correctly | -- | Yes | renders two projects both with... | jsdom | jsdom | TESTED-DOM-ONLY |
| PL-25 | Two projects both appear (E2E multi-project) | -- | Yes | two projects both appear in th... | playwright | playwright | TESTED-VISUAL |
| PL-26 | Esc from StackOverview returns to ProjectList (<2s) | S1.5 | Yes | Escape from Stack Overview ret... | playwright | playwright | TESTED-VISUAL |
| PL-27 | Error display: red error banner on API failures | -- | Yes | -- | none | jsdom | UNTESTED |
| PL-28 | 'No projects yet.' empty state text | S1.1, S1.5 | No | -- | none | jsdom | NOT-IMPLEMENTED |
| PL-29 | Welcome card with onboarding text (first launch) | S1.1 [S12] | No | -- | none | jsdom | NOT-IMPLEMENTED |
| PL-30 | Focus rings on all interactive elements | S1.5 | No | -- | none | vbs | NOT-IMPLEMENTED |
| PL-31 | Dark theme: bg-gray-950, text-gray-100 | S1.1, S1.2 | Yes | -- | none | vbs | UNTESTED |
| PL-32 | Project row hover highlight (hover:bg-gray-900) | -- | Yes | -- | none | vbs | UNTESTED |
| PL-33 | Create form visual layout (card, border, padding) | S1.3 | Yes | -- | none | vbs | UNTESTED |
| PL-34 | 'Recent Projects' heading when projects exist | S1.2 | Yes | -- | none | jsdom | UNTESTED |
| PL-35 | + New Project toggle icon changes +/- | S1.2, S1.3 | Yes | -- | none | jsdom | UNTESTED |
| PL-36 | E2E: project list screen visible on first load | S1.1 | Yes | shows project list screen on f... | playwright | playwright | TESTED-VISUAL |
| PL-37 | Create button disabled visual styling (opacity-40) | -- | Yes | -- | none | vbs | UNTESTED |
| PL-38 | Delete modal centered on screen with z-50 stacking | S1.4 | Yes | -- | none | vbs | UNTESTED |
| PL-39 | Keyboard: Enter opens focused project / submits form | -- | Yes | -- | none | jsdom | UNTESTED |
| PL-40 | Keyboard: Esc does nothing on ProjectList | -- | Yes | -- | none | jsdom | UNTESTED |

---

## 2. StackOverview (Wireframe Section 2)

**Component:** `src/lib/components/screens/StackOverview.svelte`
**Unit tests:** `src/lib/components/screens/StackOverview.test.ts`
**E2E:** `tests/e2e/import-flow.spec.ts`, `burst-gap-config.spec.ts`, `merge-flow.spec.ts`, `thumbnail-progressive.spec.ts`, `thumbnail-resume.spec.ts`

| ID | Behavior | Wireframe | Impl? | Test | Current | Correct | Status |
|----|----------|-----------|-------|------|---------|---------|--------|
| SO-01 | Loading spinner during initialLoading | S2.1 | Yes | -- | none | jsdom | UNTESTED |
| SO-02 | Topbar breadcrumb: '<- Projects / Name ... Esc' | S2.1-2.4 | Yes | -- | none | jsdom | UNTESTED |
| SO-03 | Empty state: 'No source folders attached.' | S2.2 | Yes | renders no-folders state when ... | jsdom | jsdom | TESTED-DOM-ONLY |
| SO-04 | Add Folder opens native directory picker | S2.2/S2.4 | Yes | after adding a folder, indexin... | jsdom | jsdom | TESTED-DOM-ONLY |
| SO-05 | Auto-start indexing when folders present, no stacks | S2.5 | Yes | calls start_indexing automatic... | jsdom+pw | jsdom | TESTED-DOM-ONLY |
| SO-06 | No auto-start when stacks already exist | S2.5 | Yes | does NOT auto-start when stack... | jsdom | jsdom | TESTED-DOM-ONLY |
| SO-07 | Source folder list with remove (x) buttons | S2.5 | Yes | renders progress bar and cance... | jsdom | jsdom | TESTED-DOM-ONLY |
| SO-08 | Remove buttons hidden during active indexing | S2.5 | Yes | renders progress bar and cance... | jsdom | jsdom | TESTED-DOM-ONLY |
| SO-09 | Indexing progress bar (EXIF phase) with file count | S2.3 | Yes | renders progress bar and cance... | jsdom+pw+vbs | pw (visual) | TESTED-VISUAL |
| SO-10 | Pause/Resume buttons during indexing | S2.3 | Yes | -- | none | jsdom | UNTESTED |
| SO-11 | Cancel button during indexing calls cancelIndexing | S2.3 | Yes | renders progress bar and cance... | jsdom | jsdom | TESTED-DOM-ONLY |
| SO-12 | Thumbnail progress: determinate bar (total > 0) | S2.3 | Yes | P1-06: renders determinate pro... | jsdom+pw+vbs | pw (visual) | TESTED-VISUAL |
| SO-13 | Thumbnail progress: spinner when total = 0 | S2.3 | Yes | P1-07: renders spinner when th... | jsdom+pw | jsdom | TESTED-DOM-ONLY |
| SO-14 | Thumbnail progress NOT a static full-width bar | S2.3 | Yes | P1-08: thumbnail progress indi... | jsdom+pw+vbs | pw | TESTED-VISUAL |
| SO-15 | State 4: 'Index complete.' + counts | S2.4 | Yes | renders stack grid after index... | jsdom+pw | jsdom | TESTED-DOM-ONLY |
| SO-16 | Stack card grid: 4-column layout | S2.4 | Yes | renders stack grid after index... | jsdom+vbs | pw (visual) | TESTED-VISUAL |
| SO-17 | Stack card shows thumbnail when path is set | S2.4 | Yes | renders img with src from getT... | jsdom | jsdom | TESTED-DOM-ONLY |
| SO-18 | Stack card shows placeholder when no thumbnail | S2.4 | Yes | renders placeholder icon for s... | jsdom | jsdom | TESTED-DOM-ONLY |
| SO-19 | Re-index button visible in state 4 | S2.4 | Yes | renders Re-index button in sta... | jsdom+pw | jsdom | TESTED-DOM-ONLY |
| SO-20 | Focused stack card has blue border ring | S2.4 | Yes | restores focused card index wh... | jsdom+vbs | pw (visual) | TESTED-VISUAL |
| SO-21 | Arrow Right moves focus right | keyboard-map | Yes | Arrow without Shift clears sel... | jsdom | jsdom | TESTED-DOM-ONLY |
| SO-22 | Arrow Left moves focus left (stops at first) | keyboard-map | Yes | -- | none | jsdom | UNTESTED |
| SO-23 | Arrow Down moves focus down (+4 cols) | keyboard-map | Yes | ArrowDown scrolls focused card... | jsdom | jsdom | TESTED-DOM-ONLY |
| SO-24 | Arrow Up moves focus up (-4 cols) | keyboard-map | Yes | -- | none | jsdom | UNTESTED |
| SO-25 | Enter opens focused stack (navigate to StackFocus) | keyboard-map | Yes | -- | none | jsdom | UNTESTED |
| SO-26 | Click on stack card navigates to StackFocus | S2.4 | Yes | -- | none | jsdom | UNTESTED |
| SO-27 | Esc navigates back to ProjectList | keyboard-map | Yes | -- | none | jsdom | UNTESTED |
| SO-28 | 'i' key triggers indexing | keyboard-map | Yes | i key triggers re-index when s... | jsdom | jsdom | TESTED-DOM-ONLY |
| SO-29 | 'r' key triggers re-index | keyboard-map | Yes | r key triggers re-index when s... | jsdom | jsdom | TESTED-DOM-ONLY |
| SO-30 | Ctrl+B opens burst gap config panel | keyboard-map, S2.6 | Yes | test_ctrl_b_opens_burst_gap_pa... | jsdom+pw | jsdom | TESTED-DOM-ONLY |
| SO-31 | Burst gap panel: dimmed backdrop overlay | S2.6 | Yes | -- | none | pw (visual) | UNTESTED |
| SO-32 | Burst gap panel: shows current value | S2.6 | Yes | test_ctrl_b_opens_panel_even_w... | jsdom+pw | jsdom | TESTED-DOM-ONLY |
| SO-33 | Burst gap panel: Save triggers set+restack+reload | S2.6 | Yes | test_save_burst_gap_calls_set_... | jsdom+pw | jsdom | TESTED-DOM-ONLY |
| SO-34 | Burst gap panel closes after save/restack | S2.6 | Yes | test_panel_closes_after_restac... | jsdom+pw | jsdom | TESTED-DOM-ONLY |
| SO-35 | Burst gap panel: Cancel closes without restack | S2.6 | Yes | test_cancel_closes_panel_witho... | jsdom+pw | jsdom | TESTED-DOM-ONLY |
| SO-36 | Burst gap panel: 'Recalculating stacks...' transient | S2.6 | Yes | -- | none | jsdom | UNTESTED |
| SO-37 | Error log: collapsible 'Show N errors' | S2.5 | Yes | -- | none | jsdom | UNTESTED |
| SO-38 | Error count inline during indexing | S2.3 | Yes | -- | none | jsdom | UNTESTED |
| SO-39 | Scroll position restore on return from StackFocus | keyboard-map | Yes | restores focused card index wh... | jsdom | jsdom+pw | TESTED-DOM-ONLY |
| SO-40 | Progressive thumbnail updates via 'thumbnail-ready' | S2.3 | Yes | C2: registers listen('thumbna... | jsdom+pw | jsdom | TESTED-DOM-ONLY |
| SO-41 | Unlisten on component destroy (cleanup) | -- | Yes | C3: calls unlisten when compon... | jsdom | jsdom | TESTED-DOM-ONLY |
| SO-42 | Auto-resume thumbnails on re-open | S2.5 | Yes | P2-07, TH-D1, TH-D2 | jsdom+pw | jsdom | TESTED-DOM-ONLY |
| SO-43 | No resume_thumbnails when all have thumbnails | S2.5 | Yes | P2-08, TH-D1 | jsdom+pw | jsdom | TESTED-DOM-ONLY |
| SO-44 | Shift+Arrow selects multiple stacks (yellow ring) | S2.5, keyboard-map | Yes | Shift+ArrowRight selects multi... | jsdom+pw+vbs | pw (visual) | TESTED-VISUAL |
| SO-45 | M key merges selected stacks (2+ required) | S2.5 | Yes | M key merges selected stacks | jsdom+pw | jsdom | TESTED-DOM-ONLY |
| SO-46 | M key with <2 selected does NOT call merge | S2.5 | Yes | M key with only 1 stack select... | jsdom | jsdom | TESTED-DOM-ONLY |
| SO-47 | Selection cleared after successful merge | S2.5 | Yes | selection cleared after succes... | jsdom | jsdom | TESTED-DOM-ONLY |
| SO-48 | After merge, focusedIndex moves to merged stack | S2.5 | Yes | After merge, focusedIndex move... | jsdom | jsdom | TESTED-DOM-ONLY |
| SO-49 | Ctrl+Z undoes last merge | keyboard-map | Yes | Ctrl+Z undoes last merge | jsdom+pw | jsdom | TESTED-DOM-ONLY |
| SO-50 | Arrow without Shift clears multi-selection | S2.5 | Yes | Arrow without Shift clears sel... | jsdom | jsdom | TESTED-DOM-ONLY |
| SO-51 | scrollIntoView called after arrow navigation | S2.5 | Yes | ArrowDown scrolls focused card... | jsdom | jsdom+pw | TESTED-DOM-ONLY |
| SO-52 | hjkl Vim-style navigation | keyboard-map (S7) | No | -- | none | jsdom | NOT-IMPLEMENTED |
| SO-53 | Home/End jump to first/last stack | keyboard-map | No | -- | none | jsdom | NOT-IMPLEMENTED |
| SO-54 | Sticky header area during grid scroll | S2.5 | No | -- | none | pw | NOT-IMPLEMENTED |
| SO-55 | Non-adjacent stack selection (Ctrl+Click) | S2.5 | No | -- | none | jsdom | NOT-IMPLEMENTED |
| SO-56 | Stack card finalized badge | S2.4 [S10D] | Yes | finalized stack shows checkmar... | jsdom | jsdom | TESTED-DOM-ONLY |
| SO-57 | ? Help overlay for StackOverview shortcuts | S2.5 [S12] | No | -- | none | jsdom | NOT-IMPLEMENTED |
| SO-58 | Stacks count + complete/remaining summary | S2.4 [S10] | No | -- | none | jsdom | NOT-IMPLEMENTED |
| SO-59 | Bottom shortcut hint bar | S2.4 [S12] | No | -- | none | jsdom | NOT-IMPLEMENTED |
| SO-60 | saveBurstGap does NOT call resume_thumbnails | -- | Yes | TH-D3, TH-D3b | jsdom+pw | jsdom | TESTED-DOM-ONLY |
| SO-61 | Date formatting on stack cards | S2.4 | Yes | -- | none | jsdom | UNTESTED |
| SO-62 | Photo count per stack card ('N photos') | S2.4 | Yes | -- | none | jsdom | UNTESTED |
| SO-63 | Shift+ArrowLeft multi-select (leftward) | S2.5 | Yes | -- | none | jsdom | UNTESTED |
| SO-64 | Shift+ArrowDown multi-select (downward) | S2.5 | Yes | -- | none | jsdom | UNTESTED |
| SO-65 | Shift+ArrowUp multi-select (upward) | S2.5 | Yes | -- | none | jsdom | UNTESTED |

---

## 3. StackFocus (Wireframe Section 3)

**Component:** `src/lib/components/screens/StackFocus.svelte`
**Unit tests:** `src/lib/components/screens/StackFocus.test.ts`, `StackFocus.restore.test.ts`, `StackFocus.finalize.test.ts`
**E2E:** `tests/e2e/culling-flow.spec.ts`, `visual-feedback.spec.ts`

| ID | Behavior | Wireframe | Impl? | Test | Current | Correct | Status |
|----|----------|-----------|-------|------|---------|---------|--------|
| SF-01 | Loading state shows 'Loading...' | implicit | Yes | renders loading state before d... | jsdom | jsdom | TESTED-DOM-ONLY |
| SF-02 | Photo grid renders with correct card count | S3.1 | Yes | renders photo grid after data ... | jsdom | jsdom | TESTED-DOM-ONLY |
| SF-03 | Thumbnail renders as img with asset:// URL | S3.1 | Yes | renders img with asset:// URL ... | jsdom | jsdom | TESTED-DOM-ONLY |
| SF-04 | Placeholder shown when thumbnail_path is null | S3.1 | Yes | renders placeholder when thumb... | jsdom | jsdom | TESTED-DOM-ONLY |
| SF-05 | Camera model shown on card | S3.1 | Yes | shows camera model when presen... | jsdom | jsdom | TESTED-DOM-ONLY |
| SF-06 | RAW/JPEG format badges shown | S3.1 | Yes | shows RAW badge when has_raw i... | jsdom | jsdom | TESTED-DOM-ONLY |
| SF-07 | Green badge on kept photos | S3.1 | Yes | displays green badge on kept p... | jsdom+vbs | vbs | TESTED-VISUAL |
| SF-08 | Red badge on eliminated photos | S3.1 | Yes | Eliminated photo shows red bad... | jsdom+vbs | vbs | TESTED-VISUAL |
| SF-09 | Eliminated photos dimmed to 50% opacity | S3.1 | Yes | dims eliminated photos with op... | jsdom+vbs | vbs | TESTED-VISUAL |
| SF-10 | Focused card has blue selection ring | S3.1 | Yes | Tab jumps to next undecided ph... | jsdom+vbs | vbs | TESTED-VISUAL |
| SF-11 | Arrow keys navigate focus (R/L/D+4/U-4) | keyboard-map | Yes | Shift+Tab jumps to previous un... | jsdom | jsdom | TESTED-DOM-ONLY |
| SF-12 | Enter opens SingleView with focused photoId | keyboard-map (S7) | Yes | Enter opens SingleView with co... | jsdom | jsdom | TESTED-DOM-ONLY |
| SF-13 | Escape navigates back to StackOverview | keyboard-map | Yes | Sprint 7-J4: Decisions persist... | pw | jsdom/pw | TESTED-DOM-ONLY |
| SF-14 | Y key marks photo as 'keep' via IPC | keyboard-map (S7) | Yes | Y key on focused photo calls m... | jsdom | jsdom | TESTED-DOM-ONLY |
| SF-15 | X key marks photo as 'eliminate' via IPC | keyboard-map (S7) | Yes | X key on focused photo calls m... | jsdom | jsdom | TESTED-DOM-ONLY |
| SF-16 | Ctrl+Enter commits current round | keyboard-map (S7) | Yes | Ctrl+Enter commits the round | jsdom | jsdom | TESTED-DOM-ONLY |
| SF-17 | Tab jumps to next undecided photo | keyboard-map (S7) | Yes | Tab jumps to next undecided ph... | jsdom | jsdom | TESTED-DOM-ONLY |
| SF-18 | Shift+Tab jumps to previous undecided | keyboard-map (S7) | Yes | Shift+Tab jumps to previous un... | jsdom | jsdom | TESTED-DOM-ONLY |
| SF-19 | Progress counter 'decided/total' in header | S3.1 | Yes | displays progress counter 'dec... | jsdom | jsdom | TESTED-DOM-ONLY |
| SF-20 | Round status: kept/eliminated/undecided counts | S3.1 | Yes | Progress counter shows full fo... | jsdom | jsdom | TESTED-DOM-ONLY |
| SF-21 | Breadcrumb: Back button, project name, Stack #N | S3.1 | Yes | -- | none | jsdom | UNTESTED |
| SF-22 | Back button navigates to StackOverview on click | S3.1 | Yes | -- | none | jsdom | UNTESTED |
| SF-23 | Card click sets focusedIndex | implicit | Yes | -- | none | jsdom | UNTESTED |
| SF-24 | Capture time formatted as 'Mon DD HH:MM:SS' | S3.1 | Yes | -- | none | jsdom | UNTESTED |
| SF-25 | Lens info shown on card when present | S3.1 | Yes | -- | none | jsdom | UNTESTED |
| SF-26 | Long camera_model/lens truncated to 18 chars | implicit | Yes | -- | none | jsdom | UNTESTED |
| SF-27 | Empty state: 'No photos in this stack.' | implicit | Yes | -- | none | jsdom | UNTESTED |
| SF-28 | Optimistic UI update after Y/X without re-fetch | implicit | Yes | -- | none | jsdom | UNTESTED |
| SF-29 | Green keep badge inside card (Playwright boundingBox) | S3.1 | Yes | Y key -- green badge must be p... | pw | pw | TESTED-VISUAL |
| SF-30 | 4-column grid layout for photo cards | S3.1 | Yes | -- | none | vbs/pw | UNTESTED |
| SF-31 | Camera params: aperture, shutter, ISO, focal length | S3.1 | No | -- | none | jsdom | NOT-IMPLEMENTED |
| SF-32 | Green left border on kept cards (not just badge) | S3.1 | No | -- | none | vbs | NOT-IMPLEMENTED |
| SF-33 | Red border on eliminated cards | S3.1 | No | -- | none | vbs | NOT-IMPLEMENTED |
| SF-34 | Text badge label: 'KEPT' / 'ELIM' on cards | S3.1 | No | -- | none | jsdom | NOT-IMPLEMENTED |
| SF-35 | hjkl Vim-style navigation | keyboard-map (S7) | No | -- | none | jsdom | NOT-IMPLEMENTED |
| SF-36 | Home key jumps to first photo | keyboard-map (S7) | No | -- | none | jsdom | NOT-IMPLEMENTED |
| SF-37 | End key jumps to last photo | keyboard-map (S7) | No | -- | none | jsdom | NOT-IMPLEMENTED |
| SF-38 | E key opens SingleView (alternative to Enter) | keyboard-map (S7) | No | -- | none | jsdom | NOT-IMPLEMENTED |
| SF-39 | scrollIntoView on arrow navigation | S3.2 | No | -- | none | pw | NOT-IMPLEMENTED |
| SF-40 | Decision visuals via shared DecisionIndicator.svelte | S3.2 | No | -- | none | jsdom | NOT-IMPLEMENTED |
| SF-41 | Decision re-decidable: Y/X overwrites decision | keyboard-map | Yes | -- | none | jsdom | UNTESTED |
| SF-42 | Error handling: getRoundDecisions/getRoundStatus fail | CLAUDE.md | Yes | -- | none | jsdom | UNTESTED |
| SF-43 | Error handling: makeDecision fails (Y/X key) | CLAUDE.md | Yes | -- | none | jsdom | UNTESTED |
| SF-44 | Keyboard listener cleanup on component destroy | implicit | Yes | -- | none | jsdom | UNTESTED |
| SF-45 | Full culling journey (E2E) | S3.1/S4.1 | Yes | Sprint 7-J3: Full culling flow... | pw | pw | TESTED-VISUAL |
| SF-46 | Decisions persist across navigation (E2E) | implicit | Yes | Sprint 7-J4: Decisions persist... | pw | pw | TESTED-VISUAL |
| SF-47 | No-op when photos empty for Y/X/Enter/arrows | implicit | Yes | -- | none | jsdom | UNTESTED |

---

## 4. SingleView (Wireframe Section 4)

**Component:** `src/lib/components/screens/SingleView.svelte`
**Unit tests:** `src/lib/components/screens/SingleView.test.ts`
**E2E:** `tests/e2e/culling-flow.spec.ts`

| ID | Behavior | Wireframe | Impl? | Test | Current | Correct | Status |
|----|----------|-----------|-------|------|---------|---------|--------|
| SV-01 | Loading state shown before data arrives | implicit | Yes | renders loading state before d... | jsdom | jsdom | TESTED-DOM-ONLY |
| SV-02 | Photo fills viewport (full-screen display) | S4.1 | Yes | renders photo image with asset... | jsdom+vbs | pw | TESTED-VISUAL |
| SV-03 | EXIF panel as right-side floating overlay | S4.1, S4.4 | No | -- | none | pw | NOT-IMPLEMENTED |
| SV-04 | Camera params: aperture, shutter, ISO, focal len | S4.4 | Yes | renders camera params: f/2.8, ... | jsdom | jsdom | TESTED-DOM-ONLY |
| SV-05 | Camera params show '--' when EXIF data is null | implicit | Yes | renders '--' placeholders when... | jsdom | jsdom | TESTED-DOM-ONLY |
| SV-06 | Camera model and lens shown | S4.4 | Yes | Camera params panel shows camer... | jsdom | jsdom | TESTED-DOM-ONLY |
| SV-07 | RAW and JPEG format badges shown | S4.4 | Yes | Camera params panel shows RAW a... | jsdom | jsdom | TESTED-DOM-ONLY |
| SV-08 | Capture date and time shown | S4.4 | Yes | Camera params panel shows captu... | jsdom | jsdom | TESTED-DOM-ONLY |
| SV-09 | Y key marks photo KEPT -- green border | S4.2 | Yes | Y key marks photo as keep | jsdom | jsdom | TESTED-DOM-ONLY |
| SV-10 | X key marks photo ELIMINATED -- red border + dim | S4.3 | Yes | X key shows red border AND dim... | jsdom+vbs | pw | TESTED-VISUAL |
| SV-11 | Green flash animation on Y key (200ms) | S4.2 | No | -- | none | pw | NOT-IMPLEMENTED |
| SV-12 | Red flash animation on X key (200ms) | S4.3 | No | -- | none | pw | NOT-IMPLEMENTED |
| SV-13 | ArrowRight/l navigates to next photo | S4.5, keyboard-map | Yes | Left/Right arrows navigate bet... | jsdom | jsdom | TESTED-DOM-ONLY |
| SV-14 | ArrowLeft/h navigates to previous photo | S4.5, keyboard-map | Yes | Left/Right arrows navigate bet... | jsdom | jsdom | TESTED-DOM-ONLY |
| SV-15 | Escape goes back to StackFocus | S4.5, keyboard-map | Yes | Escape goes back to stack-focu... | jsdom | jsdom | TESTED-DOM-ONLY |
| SV-16 | I key toggles camera params visibility | S4.5, keyboard-map | Yes | I key toggles camera params vi... | jsdom | jsdom | TESTED-DOM-ONLY |
| SV-17 | Ctrl+Enter commits the round | S4.5, keyboard-map | Yes | Ctrl+Enter commits the round | jsdom | jsdom | TESTED-DOM-ONLY |
| SV-18 | Y/X disabled when round is committed | S4.6 | Yes | Y key does NOT call makeDecisi... | jsdom | jsdom | TESTED-DOM-ONLY |
| SV-19 | Tab jumps to next undecided photo | S4.5, keyboard-map | Yes | Tab jumps to next undecided ph... | jsdom | jsdom | TESTED-DOM-ONLY |
| SV-20 | Shift+Tab jumps to previous undecided | S4.5, keyboard-map | Yes | Shift+Tab jumps to previous un... | jsdom | jsdom | TESTED-DOM-ONLY |
| SV-21 | Home key jumps to first photo | S4.5, keyboard-map | Yes | Home key jumps to first photo | jsdom | jsdom | TESTED-DOM-ONLY |
| SV-22 | End key jumps to last photo | S4.5, keyboard-map | Yes | End key jumps to last photo | jsdom | jsdom | TESTED-DOM-ONLY |
| SV-23 | Status bar shows photo position (Photo n/total) | S4.1, S4.5 | Yes | shows photo position and statu... | jsdom | jsdom | TESTED-DOM-ONLY |
| SV-24 | Status bar shows stack name | S4.1, S4.5 | No | -- | none | jsdom | NOT-IMPLEMENTED |
| SV-25 | Status bar shows round number | S4.1 | Yes | Status bar shows stack name an... | jsdom | jsdom | TESTED-DOM-ONLY |
| SV-26 | Status bar shows decision status text | S4.1-4.3 | Yes | shows photo position and statu... | jsdom | jsdom | TESTED-DOM-ONLY |
| SV-27 | Decision borders via shared DecisionIndicator | S4.5 | No | -- | none | jsdom | NOT-IMPLEMENTED |
| SV-28 | Hint bar shows keyboard shortcuts at bottom | S4.1 | No | -- | none | jsdom | NOT-IMPLEMENTED |
| SV-29 | Photo uses jpeg_path, thumbnail_path fallback | implicit | Yes | renders photo image with asset... | jsdom | jsdom | TESTED-DOM-ONLY |
| SV-30 | Exposure comp display format (+X.X EV) | S4.4 | Yes | Sprint 7-J3: Full culling flow | pw | jsdom | TESTED-DOM-ONLY |
| SV-31 | ArrowRight stops at last photo (no wrap) | keyboard-map | Yes | -- | none | jsdom | UNTESTED |
| SV-32 | ArrowLeft stops at first photo (no wrap) | keyboard-map | Yes | -- | none | jsdom | UNTESTED |
| SV-33 | h/l vim-style navigation aliases | keyboard-map | Yes | -- | none | jsdom | UNTESTED |
| SV-34 | Y key updates local decision state optimistically | implicit | Yes | Y key marks photo as keep | jsdom | jsdom | TESTED-DOM-ONLY |
| SV-35 | X key blocked when round is committed | S4.6 | Yes | -- | none | jsdom | UNTESTED |
| SV-36 | Decisions persist across navigation (E2E) | implicit | Yes | Sprint 7-J4: Decisions persist... | pw | pw | TESTED-VISUAL |
| SV-37 | Full culling journey E2E | S4.1-4.3 | Yes | Sprint 7-J3: Full culling flow... | pw | pw | TESTED-VISUAL |
| SV-38 | Camera params I-key toggle (E2E) | S4.5 | Yes | Sprint 7-J5: Camera parameters... | pw | pw | TESTED-VISUAL |
| SV-39 | Green border on kept photo (visual E2E) | S4.2 | Yes | Sprint 7-J4: Decisions persist... | pw | pw | TESTED-VISUAL |
| SV-40 | thumbnail_path fallback when jpeg_path is null | implicit | Yes | -- | none | jsdom | UNTESTED |

---

## 5. HelpOverlay (Wireframe Section 7)

**Component:** `src/lib/components/HelpOverlay.svelte`
**Unit tests:** `src/lib/components/HelpOverlay.test.ts`
**E2E:** none

| ID | Behavior | Wireframe | Impl? | Test | Current | Correct | Status |
|----|----------|-----------|-------|------|---------|---------|--------|
| HO-01 | Overlay hidden when visible=false | S7 | Yes | does not render when visible i... | jsdom | jsdom | TESTED-DOM-ONLY |
| HO-02 | Overlay visible -- KEYBOARD SHORTCUTS heading | S7 | Yes | renders overlay when visible i... | jsdom | jsdom | TESTED-DOM-ONLY |
| HO-03 | Full-screen dark backdrop (bg-black/70) | S7 | Yes | -- | none | vbs/pw | UNTESTED |
| HO-04 | Centered modal panel (rounded, shadow) | S7 | Yes | -- | none | vbs/pw | UNTESTED |
| HO-05 | Header shows screen-specific title in parens | S7 | Yes | shows Project List shortcuts o... | jsdom | jsdom | TESTED-DOM-ONLY |
| HO-06 | Header shows '? to close' hint | S7 | Yes | -- | none | jsdom | UNTESTED |
| HO-07 | Content is context-aware per screen | S7 | Yes | shows ... shortcuts on ... scr... | jsdom | jsdom | TESTED-DOM-ONLY |
| HO-08 | Two-column grid layout (grid-cols-2) | S7 | Yes | -- | none | vbs/pw | UNTESTED |
| HO-09 | Shortcut keys in styled <kbd> elements | S7 | Yes | -- | none | vbs/pw | UNTESTED |
| HO-10 | Clicking backdrop dismisses overlay | S7 | Yes | -- | none | jsdom | UNTESTED |
| HO-11 | Click inside panel does NOT dismiss | -- | Yes | -- | none | jsdom | UNTESTED |
| HO-12 | Escape key dismisses overlay | S7 | Yes | -- | none | jsdom | UNTESTED |
| HO-13 | ? key dismisses overlay | S7 | Yes | -- | none | jsdom | UNTESTED |
| HO-14 | ? key toggle from App.svelte global listener | S7 | Yes | -- | none | jsdom/pw | UNTESTED |
| HO-15 | ? key skipped when focus in input/textarea | -- | Yes | -- | none | jsdom | UNTESTED |
| HO-16 | ARIA attributes: role=dialog, aria-modal, label | -- | Yes | -- | none | jsdom | UNTESTED |
| HO-17 | ProjectList: correct shortcuts (Enter, Esc, ?) | keyboard-map | Yes | shows Project List shortcuts o... | jsdom | jsdom | TESTED-DOM-ONLY |
| HO-18 | StackOverview: Navigation group shortcuts | keyboard-map | Yes | shows Stack Overview shortcuts... | jsdom | jsdom | TESTED-DOM-ONLY |
| HO-19 | StackOverview: Shift+Arrow multi-select shortcut | keyboard-map | Yes | StackOverview shows Shift+Arro... | jsdom | jsdom | TESTED-DOM-ONLY |
| HO-20 | StackOverview: M (Merge), Ctrl+Z (Undo) | keyboard-map | Yes | shows Stack Overview shortcuts... | jsdom | jsdom | TESTED-DOM-ONLY |
| HO-21 | StackOverview: Ctrl+B (Burst gap), i/r (Re-index) | keyboard-map | Yes | shows Stack Overview shortcuts... | jsdom | jsdom | TESTED-DOM-ONLY |
| HO-22 | StackFocus: Navigation group shortcuts | keyboard-map, S7 | Yes | shows Stack Focus shortcuts on... | jsdom | jsdom | TESTED-DOM-ONLY |
| HO-23 | StackFocus: Y (Keep), X (Elim), Ctrl+Enter (Commit) | keyboard-map, S7 | Yes | shows Stack Focus shortcuts on... | jsdom | jsdom | TESTED-DOM-ONLY |
| HO-24 | SingleView: Navigation group shortcuts | keyboard-map | Yes | shows Single View shortcuts on... | jsdom | jsdom | TESTED-DOM-ONLY |
| HO-25 | SingleView: Y (Keep), X (Elim), Ctrl+Enter (Commit) | keyboard-map | Yes | shows Single View shortcuts on... | jsdom | jsdom | TESTED-DOM-ONLY |
| HO-26 | SingleView: I (Toggle camera params) | keyboard-map | Yes | shows Single View shortcuts on... | jsdom | jsdom | TESTED-DOM-ONLY |
| HO-27 | StackOverview overlay missing hjkl | keyboard-map (S7) | No | -- | none | jsdom | NOT-IMPLEMENTED |
| HO-28 | StackOverview overlay missing Home/End | keyboard-map | No | -- | none | jsdom | NOT-IMPLEMENTED |
| HO-29 | StackFocus overlay missing Home/End | keyboard-map (S7), S7 | No | -- | none | jsdom | NOT-IMPLEMENTED |
| HO-30 | StackFocus overlay missing E key | keyboard-map (S7), S7 | No | -- | none | jsdom | NOT-IMPLEMENTED |
| HO-31 | StackFocus overlay missing hjkl | keyboard-map (S7) | No | -- | none | jsdom | NOT-IMPLEMENTED |
| HO-32 | S7 wireframe VIEWS group (C, E/Enter) | S7 | No | -- | none | jsdom | NOT-IMPLEMENTED |
| HO-33 | S7 wireframe ROUNDS group (Ctrl+Enter, [, ]) | S7 | No | -- | none | jsdom | NOT-IMPLEMENTED |
| HO-34 | S7 wireframe OTHER group (Ctrl+B, ?, A) | S7 | No | -- | none | jsdom | NOT-IMPLEMENTED |
| HO-35 | Fallback to PROJECT_LIST for unknown screen kind | -- | Yes | -- | none | jsdom | UNTESTED |
| HO-36 | Fallback to 'GemKeep' title for unknown screen | -- | Yes | -- | none | jsdom | UNTESTED |
| HO-37 | Esc stopPropagation prevents screen navigation | -- | Yes | -- | none | jsdom/pw | UNTESTED |

---

## 6. Technology Migration Priorities

~~These 12 behaviors are tested with the **wrong technology** (jsdom for visual CSS assertions). They need migration to vitest-browser-svelte or Playwright for meaningful visual verification.~~

**Sprint 7 update:** All 12 TESTED-WRONG-TECH items have been migrated to vitest-browser-svelte (vbs). The table below is preserved for historical reference; all items now carry TESTED-VISUAL status in the main behavior tables above.

| Priority | ID | Screen | Behavior | Was | Correct | Migrated? |
|----------|-----|--------|----------|-----|---------|-----------|
| 1 | SF-07 | StackFocus | Green badge on kept photos | jsdom | vbs | Yes — vbs |
| 2 | SF-08 | StackFocus | Red badge on eliminated photos | jsdom | vbs | Yes — vbs |
| 3 | SF-09 | StackFocus | Eliminated photos dimmed to 50% opacity | jsdom | vbs | Yes — vbs |
| 4 | SF-10 | StackFocus | Focused card blue selection ring | jsdom | vbs | Yes — vbs |
| 5 | SV-02 | SingleView | Photo fills viewport (full-screen) | jsdom | pw | Yes — vbs |
| 6 | SV-10 | SingleView | X key -- red border + dim overlay | jsdom | pw | Yes — vbs |
| 7 | SO-09 | StackOverview | Indexing progress bar width | jsdom+pw | pw | Yes — vbs |
| 8 | SO-12 | StackOverview | Thumbnail determinate bar width | jsdom+pw | pw | Yes — vbs |
| 9 | SO-14 | StackOverview | Thumbnail progress not static full-width | jsdom+pw | pw | Yes — vbs |
| 10 | SO-16 | StackOverview | Stack card 4-column grid layout | jsdom | pw | Yes — vbs |
| 11 | SO-20 | StackOverview | Focused stack blue border ring | jsdom | pw | Yes — vbs |
| 12 | SO-44 | StackOverview | Shift+Arrow yellow selection ring | jsdom+pw | pw | Yes — vbs |

**Status:** 0 remaining TESTED-WRONG-TECH items. Migration complete as of Sprint 7.

---

## 7. Untested Behaviors

74 behaviors are implemented but have **no test coverage**. Grouped by priority.

### High Priority (core user workflows)

| ID | Screen | Behavior | Correct Tech |
|----|--------|----------|--------------|
| SO-25 | StackOverview | Enter opens focused stack (navigate to StackFocus) | jsdom |
| SO-27 | StackOverview | Esc navigates back to ProjectList | jsdom |
| SO-26 | StackOverview | Click on stack card navigates to StackFocus | jsdom |
| SF-22 | StackFocus | Back button navigates to StackOverview on click | jsdom |
| SF-28 | StackFocus | Optimistic UI update after Y/X without re-fetch | jsdom |
| SF-41 | StackFocus | Decision re-decidable: Y/X overwrites decision | jsdom |
| PL-18 | ProjectList | Open button navigates to StackOverview | jsdom |
| PL-19 | ProjectList | Delete button opens confirmation modal | jsdom |
| PL-22 | ProjectList | Delete: calls deleteProject, refreshes, clears Resume | jsdom |
| SV-35 | SingleView | X key blocked when round is committed | jsdom |

### Medium Priority (error handling and edge cases)

| ID | Screen | Behavior | Correct Tech |
|----|--------|----------|--------------|
| SF-42 | StackFocus | Error handling: getRoundDecisions/getRoundStatus fail | jsdom |
| SF-43 | StackFocus | Error handling: makeDecision fails (Y/X key) | jsdom |
| SF-47 | StackFocus | No-op when photos empty for Y/X/Enter/arrows | jsdom |
| PL-16 | ProjectList | Create form: error displayed on failure | jsdom |
| PL-27 | ProjectList | Error display: red error banner on API failures | jsdom |
| SO-37 | StackOverview | Error log: collapsible 'Show N errors' after indexing | jsdom |
| SO-38 | StackOverview | Error count inline during indexing | jsdom |
| SV-31 | SingleView | ArrowRight stops at last photo (no wrap) | jsdom |
| SV-32 | SingleView | ArrowLeft stops at first photo (no wrap) | jsdom |
| SV-40 | SingleView | thumbnail_path fallback when jpeg_path is null | jsdom |

### Medium Priority (form and interaction completeness)

| ID | Screen | Behavior | Correct Tech |
|----|--------|----------|--------------|
| PL-10 | ProjectList | Create form: name input with placeholder | jsdom |
| PL-11 | ProjectList | Create form: slug preview (debounced 200ms) | jsdom |
| PL-12 | ProjectList | Create form: Create disabled when empty | jsdom |
| PL-13 | ProjectList | Create form: 'Creating...' while submitting | jsdom |
| PL-14 | ProjectList | Create form: Enter key submits | jsdom |
| PL-20 | ProjectList | Delete modal: shows slug name and warning | jsdom |
| PL-21 | ProjectList | Delete modal: Cancel closes modal | jsdom |
| SO-10 | StackOverview | Pause/Resume buttons during indexing | jsdom |
| SO-36 | StackOverview | Burst gap: 'Recalculating stacks...' transient | jsdom |

### Medium Priority (navigation completeness)

| ID | Screen | Behavior | Correct Tech |
|----|--------|----------|--------------|
| SO-22 | StackOverview | Arrow Left boundary (stops at first) | jsdom |
| SO-24 | StackOverview | Arrow Up boundary (-4 cols) | jsdom |
| SO-63 | StackOverview | Shift+ArrowLeft multi-select (leftward) | jsdom |
| SO-64 | StackOverview | Shift+ArrowDown multi-select (downward) | jsdom |
| SO-65 | StackOverview | Shift+ArrowUp multi-select (upward) | jsdom |
| SV-33 | SingleView | h/l vim-style navigation aliases | jsdom |

### Low Priority (display details and defensive code)

| ID | Screen | Behavior | Correct Tech |
|----|--------|----------|--------------|
| SO-01 | StackOverview | Loading spinner during initialLoading | jsdom |
| SO-02 | StackOverview | Topbar breadcrumb rendering | jsdom |
| SO-61 | StackOverview | Date formatting on stack cards | jsdom |
| SO-62 | StackOverview | Photo count per stack card | jsdom |
| SF-21 | StackFocus | Breadcrumb header rendering | jsdom |
| SF-23 | StackFocus | Card click sets focusedIndex | jsdom |
| SF-24 | StackFocus | Capture time formatted as 'Mon DD HH:MM:SS' | jsdom |
| SF-25 | StackFocus | Lens info shown when present | jsdom |
| SF-26 | StackFocus | Long camera_model/lens truncated to 18 chars | jsdom |
| SF-27 | StackFocus | Empty state: 'No photos in this stack.' | jsdom |
| SF-44 | StackFocus | Keyboard listener cleanup on destroy | jsdom |
| PL-34 | ProjectList | 'Recent Projects' heading | jsdom |
| PL-35 | ProjectList | + New Project toggle icon +/- | jsdom |
| PL-39 | ProjectList | Enter opens focused project / submits form | jsdom |
| PL-40 | ProjectList | Esc does nothing on ProjectList | jsdom |
| HO-06 | HelpOverlay | '? to close' hint text | jsdom |
| HO-35 | HelpOverlay | Fallback to PROJECT_LIST for unknown screen | jsdom |
| HO-36 | HelpOverlay | Fallback to 'GemKeep' for unknown screen | jsdom |

### Low Priority (visual-only, need vitest-browser-svelte)

| ID | Screen | Behavior | Correct Tech |
|----|--------|----------|--------------|
| PL-08 | ProjectList | Resume card visual styling | vbs |
| PL-23 | ProjectList | Delete modal dimmed overlay | vbs |
| PL-31 | ProjectList | Dark theme colors | vbs |
| PL-32 | ProjectList | Project row hover highlight | vbs |
| PL-33 | ProjectList | Create form visual layout | vbs |
| PL-37 | ProjectList | Create button disabled styling | vbs |
| PL-38 | ProjectList | Delete modal centered with z-50 | vbs |
| SF-30 | StackFocus | 4-column grid layout | vbs/pw |
| SO-31 | StackOverview | Burst gap dimmed backdrop | pw |
| HO-03 | HelpOverlay | Full-screen dark backdrop | vbs/pw |
| HO-04 | HelpOverlay | Centered modal panel | vbs/pw |
| HO-08 | HelpOverlay | Two-column grid layout | vbs/pw |
| HO-09 | HelpOverlay | Styled <kbd> elements | vbs/pw |

### Low Priority (HelpOverlay interactions)

| ID | Screen | Behavior | Correct Tech |
|----|--------|----------|--------------|
| HO-10 | HelpOverlay | Clicking backdrop dismisses | jsdom |
| HO-11 | HelpOverlay | Click inside panel does NOT dismiss | jsdom |
| HO-12 | HelpOverlay | Escape dismisses overlay | jsdom |
| HO-13 | HelpOverlay | ? key dismisses overlay | jsdom |
| HO-14 | HelpOverlay | ? key toggle from App.svelte | jsdom/pw |
| HO-15 | HelpOverlay | ? skipped in input/textarea | jsdom |
| HO-16 | HelpOverlay | ARIA attributes | jsdom |
| HO-37 | HelpOverlay | Esc stopPropagation | jsdom/pw |

---

## 8. Cross-Screen Consistency Check

### Decision Indicators (keep/eliminate badges)

| Feature | StackFocus | SingleView | Consistent? |
|---------|-----------|------------|-------------|
| Green badge/border on KEPT | SF-07 (jsdom+vbs visual) | SV-09 (jsdom IPC check) + SV-39 (pw .border-green-500) | Partial -- different assertion strategies |
| Red badge/border on ELIMINATED | SF-08 (jsdom+vbs visual) | SV-10 (jsdom+vbs visual) | Yes -- both use vbs visual checks |
| Dimmed eliminated photos | SF-09 (jsdom+vbs visual) | SV-10 (jsdom+vbs visual) | Yes -- both use vbs visual checks |
| Shared DecisionIndicator component | SF-40 NOT-IMPLEMENTED | SV-27 NOT-IMPLEMENTED | Consistent (both missing) |
| Playwright visual badge test | SF-29 (boundingBox for green) | None for SingleView | No -- only StackFocus has visual test |

**Issue:** Decision indicator testing is inconsistent. StackFocus tests CSS classes, SingleView tests IPC calls. Neither screen has comprehensive visual testing for both keep and eliminate states. The shared `DecisionIndicator.svelte` component specified in the wireframe is not implemented in either screen.

### Focus Rings

| Feature | ProjectList | StackOverview | StackFocus | SingleView |
|---------|------------|---------------|------------|------------|
| Focus ring tested | PL-30 NOT-IMPL | SO-20 TESTED-VISUAL | SF-10 TESTED-VISUAL | N/A (single photo) |
| Visual verification | None | vbs (Sprint 7) | vbs (Sprint 7) | N/A |

**Issue:** Focus rings are now tested with vitest-browser-svelte for StackOverview and StackFocus (Sprint 7 uplift). ProjectList has no focus ring implementation at all.

### Format Badges (RAW/JPEG)

| Feature | StackFocus | SingleView | Consistent? |
|---------|-----------|------------|-------------|
| RAW badge text | SF-06 (jsdom) | SV-07 (jsdom) | Yes |
| JPEG badge text | SF-06 (jsdom) | SV-07 (jsdom) | Yes |
| Badge styling (green/blue pills) | Untested | Untested | Consistent (both untested) |

**Result:** Format badge text presence is consistently tested across both screens. Visual badge styling is untested in both.

---

## 9. Summary Statistics

| Screen | Total | Visual | DOM-Only | Wrong-Tech | Untested | Not-Impl | Coverage % |
|--------|-------|--------|----------|------------|----------|----------|------------|
| ProjectList | 40 | 4 | 10 | 0 | 23 | 3 | 35.0% |
| StackOverview | 65 | 6 | 35 | 0 | 17 | 7 | 63.1% |
| StackFocus | 47 | 7 | 16 | 0 | 14 | 10 | 48.9% |
| SingleView | 40 | 6 | 23 | 0 | 5 | 6 | 72.5% |
| HelpOverlay | 37 | 0 | 14 | 0 | 15 | 8 | 37.8% |
| **TOTAL** | **229** | **23** | **98** | **0** | **74** | **34** | **52.8%** |

Coverage excluding not-implemented behaviors: **62.1%** (121 tested / 195 implemented).

---

## 10. Test Counts

| Layer | Count | Runner |
|-------|-------|--------|
| Rust unit/integration tests | 452 (+ 23 ignored) | `cargo test` |
| Vitest component tests (jsdom) | 480 | `npm test` (jsdom) |
| vitest-browser-svelte tests | 32 | `npm run test:browser` (Chromium) |
| Playwright E2E tests | 29 | `npm run test:e2e` |
| **Total (running)** | **993** | |
| **Total (`cargo test` + `npm test`)** | **932** | |

> The "932" figure counts only the two main CI commands (`cargo test` = 452 passed, `npm test` = 480 passed). Adding browser (32) and E2E (29) brings the full suite to 993 runnable tests (1016 including 23 ignored Rust tests).

### Rust Test Files (475 `#[test]`, 452 run + 23 ignored)

| File | Tests | Notes |
|------|-------|-------|
| `src-tauri/src/import/test_fixtures.rs` | 112 | TestLibraryBuilder fixture generation |
| `src-tauri/src/decisions/engine.rs` | 60 | Decision engine: rounds, commit, restore, finalize, reopen, crash-recovery |
| `src-tauri/src/photos/repository.rs` | 43 | Photo CRUD and queries |
| `src-tauri/src/commands/ipc_tests.rs` | 39 | Tauri IPC command integration |
| `src-tauri/src/import/integration_tests.rs` | 34 | Import pipeline end-to-end |
| `src-tauri/src/import/thumbnails.rs` | 29 | Thumbnail generation (2 ignored perf tests) |
| `src-tauri/src/import/test_fixtures_validation.rs` | 21 | Fixture validation (all 21 ignored — slow) |
| `src-tauri/src/import/exif.rs` | 20 | EXIF extraction |
| `src-tauri/src/projects/slug.rs` | 16 | Slug generation |
| `src-tauri/src/projects/integration_tests.rs` | 15 | Project lifecycle |
| `src-tauri/src/import/orientation_tests.rs` | 13 | Orientation/rotation |
| `src-tauri/src/import/metadata_tests.rs` | 11 | Metadata parsing |
| `src-tauri/src/projects/manager.rs` | 11 | Project manager |
| `src-tauri/src/db/migrations.rs` | 10 | DB schema migrations |
| `src-tauri/src/import/pairs.rs` | 7 | RAW+JPEG pairing |
| `src-tauri/src/import/scanner.rs` | 7 | File scanner |
| `src-tauri/src/import/stacks.rs` | 7 | Stack grouping |
| `src-tauri/src/asset_scope_tests.rs` | 6 | Asset scope security |
| `src-tauri/src/projects/repository.rs` | 5 | Project repository |
| `src-tauri/src/state.rs` | 4 | App state management |
| `src-tauri/src/import/stacks_tests.rs` | 2 | Stack edge cases |
| `src-tauri/src/commands/import.rs` | 1 | Import command |
| `src-tauri/src/import/pipeline.rs` | 1 | Pipeline |
| `src-tauri/src/import/util.rs` | 1 | Import utilities |

### Frontend Test Files — jsdom (480 tests across 27 files)

| File | Tests | Notes |
|------|-------|-------|
| `src/lib/components/screens/StackOverview.test.ts` | 96 | Grid, indexing, merge, burst-gap, finalized badge |
| `src/lib/components/screens/StackFocus.test.ts` | 71 | Culling, navigation, decisions, rounds |
| `src/lib/components/screens/SingleView.test.ts` | 51 | Full-screen view, EXIF, decisions, rounds |
| `src/lib/components/screens/ProjectList.test.ts` | 31 | Project CRUD, auto-open, resume |
| `src/lib/components/HelpOverlay.test.ts` | 28 | Context-aware shortcut overlay |
| `src/lib/components/PhotoFrame.test.ts` | 28 | Shared photo frame component |
| `src/lib/components/screens/ComparisonView.test.ts` | 26 | Side-by-side comparison |
| `src/lib/utils/keyboard.test.ts` | 18 | Keyboard handler utilities |
| `src/lib/utils/display.test.ts` | 16 | Display formatting |
| `src/lib/components/PhotoFrame.ring-indicators.test.ts` | 11 | Ring/indicator variants |
| `src/lib/utils/decisions.test.ts` | 11 | Decision helper functions |
| `src/lib/components/screens/ScreenMigration.test.ts` | 10 | PhotoFrame migration integration |
| `src/lib/stores/navigation.test.ts` | 9 | Navigation store |
| `src/lib/components/PhotoFrame.absorbed-decision.test.ts` | 8 | Absorbed decision styling |
| `src/lib/components/PhotoFrame.cleanup.test.ts` | 8 | PhotoFrame cleanup/unmount |
| `src/lib/utils/photos.test.ts` | 8 | Photo utilities |
| `src/lib/utils/selection.test.ts` | 8 | Selection utilities |
| `src/lib/utils/filepath.test.ts` | 7 | Filepath utilities |
| `src/lib/components/screens/StackFocus.finalize.test.ts` | 7 | **Sprint 10D:** finalize/reopen stack |
| `src/lib/components/screens/StackFocus.restore.test.ts` | 5 | **Sprint 10D:** restore eliminated photos |
| `src/lib/components/PhotoFrame.layout-variants.test.ts` | 4 | Layout variant rendering |
| `src/lib/components/PhotoFrame.ring-inset.test.ts` | 4 | Ring inset positioning |
| `src/lib/utils/date.test.ts` | 4 | Date formatting |
| `src/lib/utils/errors.test.ts` | 4 | Error utilities |
| `src/lib/api/index.test.ts` | 3 | API layer |
| `src/lib/components/RoundTabBar.test.ts` | 3 | **Sprint 10D:** round tab bar |
| `src/lib/tauri-config.test.ts` | 1 | Tauri config |

### Frontend Test Files — vitest-browser-svelte (32 tests across 4 files)

| File | Tests | Notes |
|------|-------|-------|
| `src/lib/components/screens/StackOverview.browser.test.ts` | 10 | Visual: grid, focus ring, selection ring, progress bars |
| `src/lib/components/screens/StackFocus.browser.test.ts` | 9 | Visual: badges, dimming, focus ring |
| `src/lib/components/screens/SingleView.browser.test.ts` | 8 | Visual: full-screen, red border, dim overlay |
| `src/lib/components/screens/ComparisonView.browser.test.ts` | 5 | Visual: panel layout, focus ring |

### E2E Test Files — Playwright (29 tests across 9 files)

| File | Tests | E2E Coverage |
|------|-------|--------------|
| `tests/e2e/burst-gap-config.spec.ts` | 5 | Burst gap config panel |
| `tests/e2e/import-flow.spec.ts` | 5 | Import + indexing pipeline |
| `tests/e2e/project-management.spec.ts` | 4 | Project create, list, delete, navigate |
| `tests/e2e/thumbnail-resume.spec.ts` | 4 | Thumbnail resume on re-open |
| `tests/e2e/culling-flow.spec.ts` | 3 | Full culling journey, decisions persist |
| `tests/e2e/thumbnail-progressive.spec.ts` | 3 | Progressive thumbnail loading |
| `tests/e2e/merge-flow.spec.ts` | 2 | Stack merge + undo |
| `tests/e2e/orientation.spec.ts` | 2 | EXIF orientation handling |
| `tests/e2e/visual-feedback.spec.ts` | 1 | Visual decision feedback |

### E2E Coverage by Feature

| Feature | Has E2E? | Spec File |
|---------|----------|-----------|
| Project management (create/list/delete) | Yes | `project-management.spec.ts` |
| Import + indexing | Yes | `import-flow.spec.ts` |
| Thumbnail generation | Yes | `thumbnail-progressive.spec.ts`, `thumbnail-resume.spec.ts` |
| Culling (Y/X/commit) | Yes | `culling-flow.spec.ts` |
| Decision visual feedback | Yes | `visual-feedback.spec.ts` |
| Stack merge + undo | Yes | `merge-flow.spec.ts` |
| Burst gap config | Yes | `burst-gap-config.spec.ts` |
| EXIF orientation | Yes | `orientation.spec.ts` |
| Restore eliminated photos | No | -- |
| Finalize/reopen stack | No | -- |
| ComparisonView | No | -- |
| HelpOverlay | No | -- |
| Multi-round navigation | No | -- |

### Sprint 10D Test Additions

| Area | File | Tests | What was added |
|------|------|-------|----------------|
| Restore (frontend) | `StackFocus.restore.test.ts` | 5 | R key restore on eliminated, no-op on kept/undecided, disabled in historical round, badge update |
| Finalize (frontend) | `StackFocus.finalize.test.ts` | 7 | Ctrl+Shift+Enter finalize/reopen toggle, Y/X/U disabled when finalized, Reopen button, confirmation auto-dismiss |
| Finalized badge (frontend) | `StackOverview.test.ts` | 1 | Finalized stack shows checkmark badge (C5 section) |
| RoundTabBar (frontend) | `RoundTabBar.test.ts` | 3 | Tab rendering, active round marking, click handler |
| Restore (Rust) | `decisions/engine.rs` | 9 | restore_eliminated_photo: success, already-member noop, committed-round error, not-eliminated error, count updates, restore-then-eliminate, restore-then-undo, idempotent, lifecycle invariant |
| Finalize (Rust) | `decisions/engine.rs` | 5 | finalize_stack: auto-commits undecided, already-committed, no-rounds error, already-finalized, zero-survivors |
| Reopen (Rust) | `decisions/engine.rs` | 3 | reopen_stack: basic reopen, already-active noop, reopen-then-decide |
| Crash recovery (Rust) | `decisions/engine.rs` | 1 | SC#22: Round 2 decisions persist after reconnect |

**Note:** The behavior coverage matrix (sections 1-5) was authored during Sprint 7 and audits behaviors from wireframe sections S1-S7. Sprint 8-10 features (ComparisonView, PhotoFrame, RoundTabBar, restore, finalize) are tested but not yet audited as individual behavior rows in the matrix above. All 12 formerly wrong-tech behaviors have been migrated to vitest-browser-svelte and now carry TESTED-VISUAL status.
