# GemKeep Photo Culling Tool -- Architectural Summary

Goal: Extremely fast, keyboard-first discovery and keeping of the best photos from large RAW+JPEG shoots, with clean structure, traceability, and cross-platform support.

## 1. Core Product Model

- Everything is a logical photo
  - Single file (JPEG or RAW-only)
  - RAW + JPEG pair (detected during import → treated as one unit)
- Every logical photo belongs to exactly one stack
  - Single-photo stack = size 1
- Stacks
  - Auto-generated on import (time proximity / burst detection)
  - User can merge stacks, split (remove photo/pair → new stack of 1)
- Rounds
  - Strictly linear: Round 1 → Round 2 → …
  - Immutable snapshots only after manual commit/freeze
  - Later rounds override earlier decisions via new entries (no history rewrite)
  - Restoration = new keep decision in a later round
- Two working scopes (same round engine & UX)
  - Stack Scope: refinement inside one stack
  - Session Scope: refinement across all stack finalists

## 2. Project Layer (Top-Level Isolation)

- One project = one logical photo job
- Fully isolated:
  - SQLite database (`project.db`)
  - Thumbnail + preview cache directory
  - Operation log (`logs/operation.log`)
- Directory structure:
  ```
  ~/.gem-keep/
  └── projects/
      └── <project-slug>/
          ├── project.db
          ├── cache/
          │   └── thumbnails/
          └── logs/
              └── operation.log
  ```
- <project-slug>: lowercase, hyphen-separated, URL-safe identifier auto-generated from project name (editable, unique per user)

## 3. Layered Architecture

```
┌─────────────────────────────────────────────────────────┐
│  Svelte Frontend                                        │
│  - Display (grids, single view, comparison)             │
│  - Keyboard/mouse input                                 │
│  - Zoom/pan state (temporary, not persisted)            │
│  - Visual feedback                                      │
│  - Never performs heavy computation                     │
├─────────────────────────────────────────────────────────┤
│  Tauri IPC (async commands)                             │
├─────────────────────────────────────────────────────────┤
│  Rust Backend                                           │
│  - All business logic                                   │
│  - SQLite persistence                                   │
│  - Image processing & caching                           │
│  - Background thumbnail generation                      │
├─────────────────────────────────────────────────────────┤
│  File System + Disk Cache + In-Memory LRU               │
└─────────────────────────────────────────────────────────┘
```

## 4. Technology Stack

| Layer | Technology | Rationale |
|-------|------------|-----------|
| Desktop Framework | Tauri 2.x | Lightweight (~3MB), single backend language |
| Frontend | Svelte 5 + Tailwind CSS | Minimal boilerplate, fast, easy to learn |
| Backend | Rust | Performance, memory safety, single language |
| Database | SQLite (rusqlite) | Embedded, reliable, no server |
| RAW Processing | rsraw (LibRaw wrapper) | 400+ cameras, Sony ARW + Canon CR2/CR3 |
| Image Processing | image crate | JPEG decode/encode, resize |
| Parallelism | rayon | Data-parallel thumbnail generation |

## 5. Performance & Caching Strategy

**Core rule: Preload small. Lazy-load large.**

- **Thumbnails**: Generated in background after import, cached to disk, progressive UI updates
- **In-Memory LRU**: 200-500 MB for current view + neighbor prefetch
- **Full Resolution**: On-demand only (100% zoom or explicit RAW toggle)
- **RAW+JPEG preference**: Always use JPEG/embedded for speed, decode RAW only on request

## 6. Platform Targets

**Development:** Linux

**Target platforms (priority):**
1. Windows 10/11
2. macOS 12+ (Intel + Apple Silicon)
3. Linux (secondary - works due to dev environment)

**Minimum hardware:** 4+ cores, 8GB RAM, 500MB-2GB storage per project

## 7. Data Model (High-Level)

- **photos**: path, format, pair linkage, stack membership, current status, metadata
- **stacks**: grouping container, created from burst detection
- **rounds**: linear progression, scope (stack or session), commit state
- **decisions**: audit log of keep/eliminate actions per round
- **merges**: stack merge history for undo
- **projects**: metadata, settings, source folders

Key: `current_status` field is source of truth; `decisions` table is history/audit.

## 8. Locked Architectural Decisions

- Logical photo = single file or RAW+JPEG pair (one decision unit)
- Prefer fast JPEG/embedded for quick views & thumbnails
- Rounds are linear & become immutable only after manual commit
- Restoration creates new decision — never rewrites history
- Frontend owns zoom/pan/comparison UX (temporary state, no persistence)
- Rust owns all backend logic and image processing
- Tauri for desktop framework
- Svelte for frontend
- LibRaw for RAW processing
- Projects isolated with slug-based folders
- Export is pair-aware and first-class
- Background thumbnail generation with progressive UI
- No AI/ML in core path (future extension point only)

## 9. Technical Risks

**Highest**
- Background thumbnail pipeline (non-blocking, progressive updates)
- Memory pressure with 5000+ photos

**Medium**
- Stack detection tuning (time threshold)
- Zoom/pan transitions
- Cross-platform webview CSS differences

**Low**
- SQLite queries
- Pair detection (same filename, different extension)
- Keyboard navigation
