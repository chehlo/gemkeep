# GemKeep Sprint Plan

## Overview
Starting from a blank Tauri 2.x + Svelte 5 + Rust project. All business logic lives in Rust; frontend is thin display + input layer. Each sprint delivers a vertically complete, testable slice and references the user stories it covers. Sprints build strictly on prior ones.

---

## Sprint 1 — Skeleton: Full Stack Wired, No Functionality
Prove all architectural layers compile, communicate, and navigate. No business logic. Every screen exists as an empty shell. One real Tauri IPC round-trip works. Full DB schema defined and migrations run cleanly.

See `sprint-01.md` for detailed design.

---

## Sprint 2 — Project Management
**User Stories:** §1 (all)

Create, open, and list projects. Each project is fully isolated on disk with its own DB, cache directory, and log file. Slug generation (lowercase, hyphens, URL-safe, unique). Remember last opened project. Navigate into (empty) Stack Overview on open.

---

## Sprint 3 — Photo Import, Pair Detection & Stack Generation
**User Stories:** §2 (all), §3 (auto-generation only)

Recursive folder scan. EXIF metadata extraction (capture time, orientation, camera model, lens). RAW+JPEG pair detection by matching base filename. Stack auto-generation by time-proximity burst detection (configurable gap, default 3s). Graceful skipping of corrupt/unreadable files with logging. Returns `ImportStats`.

---

## Sprint 4 — Thumbnail Pipeline & Caching
**User Stories:** §4 (representative thumbnail per logical photo), §13 (thumbnails instant, smooth scroll)

Background thumbnail generation via `rayon`. Priority: embedded JPEG → sidecar JPEG → full JPEG decode → RAW embedded JPEG (never full RAW decode for thumbnails). Disk cache per project. In-memory LRU (200–500 MB). Tauri `thumbnail-ready` events for progressive grid updates.

---

## Sprint 5 — Stack Overview UI & Navigation
**User Stories:** §9 (Stack Overview mode), §11 (filters, jump to undecided)

Keyboard-navigable stack grid. Filters: date range, stack size, has-finalist, contains-RAW/JPEG. Jump to next/previous undecided stack. Mouse fallback for all keyboard actions. No modal dialogs.

---

## Sprint 6 — Culling Core: Stack Focus, Single View & Round Engine v1
**User Stories:** §4 (pair decisions), §5 (keep/eliminate, visual feedback, keyboard), §8 (Round 1: linear, manual commit, auto-save, finalize)

Round engine: decisions table as audit log, `current_status` as source of truth, crash-resilient auto-save, manual commit to freeze round. Stack Focus multi-photo grid. Single View full-screen. Keyboard decisions (`y/k` keep, `n/x` eliminate, `j/l/h/i` navigate). Visual feedback. Round progress indicator. `Ctrl+Enter` to commit.

---

## Sprint 7 — Multi-Round Engine & Session Scope
**User Stories:** §7 (session scope, finalist view), §8 (full: multi-round, overrides, restoration, round navigation)

Start Round N+1 from surviving photos of Round N. Decision override (later round, same photo → new entry, no history rewrite). Restoration (eliminated photo kept in later round → active again). Session scope: run same round engine across all stack finalists. Finalize session action.

---

## Sprint 8 — Stack Management & Comparison View
**User Stories:** §3 (merge, split, undo, audit log), §6 (comparison, auto-fill, lock)

Merge 2+ stacks → new stack with full audit trail. Single-level undo merge. Split photo from stack → new stack of 1. Comparison mode in Stack Focus: mark 2 photos side-by-side, eliminate one → next undecided auto-fills, lock layout option.

---

## Sprint 9 — Export, Search & Single View Polish
**User Stories:** §10 (zoom/pan), §11 (fuzzy search), §12 (export all options), §4 (RAW toggle)

Pair-aware export (both RAW+JPEG, or JPEG-only/RAW-only). Export JSON manifest. Non-destructive (originals untouched). Fuzzy search across filenames, dates, camera model. Zoom/pan in Single View (mouse wheel, keyboard, drag). RAW toggle on demand in Single View.

---

## Dependency Chain

```
S1 Skeleton
 └── S2 Project Management
      └── S3 Import + Pairs + Stacks
           └── S4 Thumbnail Pipeline
                └── S5 Stack Overview UI
                     └── S6 Culling Core (Round v1)
                          └── S7 Multi-Round + Session
                               ├── S8 Stack Management + Comparison
                               └── S9 Export + Search + Polish
```

---

## Cross-Sprint Standards

- `cargo fmt` + `cargo clippy --fix` before every commit
- All errors: `thiserror` (domain) / `anyhow` (propagation); Tauri commands return `Result<T, String>`
- `tracing` for all logging — no `println!`
- In-memory SQLite (`:memory:`) for all Rust unit/integration tests
- Negative test for every error path
- Commit format: `feat|fix|refactor|test|docs|chore: ≤50 chars`
