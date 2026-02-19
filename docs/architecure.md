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
          └── logs/
              └── operation.log
  ```
- <project-slug>: lowercase, hyphen-separated, URL-safe identifier auto-generated from project name (editable, unique per user)

## 3. Layered Architecture

```
Electron Renderer (lightweight UI)
  ↓ IPC (async, non-blocking, via ipcRenderer/ipcMain)
Node.js Backend (project/state/round logic, SQLite, cache coord, logging)
  ↓ FFI / NAPI-RS / neon
Rust Native Module (image pipeline, thumbnail gen, RAW preview, parallel decode)
  ↓
File System + Disk Cache + In-Memory LRU Cache
```

## 4. Responsibilities by Layer

**Electron Renderer**  
- Display: Stack Overview grid, Stack Focus multi-grid (incl. comparison/2-up modes), Single View full-screen  
- Keyboard & mouse input (shortcuts, wheel zoom, drag pan, click fallback)  
- Zoom & pan state management in Single View (cursor-centered zoom, drag/keyboard pan, reset toggles)  
- Dynamic grid refresh in comparison mode (auto-fill next photo after eliminate)  
- Visual feedback (keep/eliminate states, loading indicators, comparison highlighting)  
- Never performs image decoding, heavy loops, or blocking work  

**Node.js Backend**  
- Project create/open/list/remember-last  
- Project slug generation, validation & uniqueness check  
- Import coordination & pair detection  
- Stack grouping, merge, split  
- Round resolution, restoration, snapshot views  
- Round commit / freeze logic (mark round as committed → immutable snapshot)  
- SQLite persistence (photos, pairs, stacks, rounds, decisions, merges, commit timestamps)  
- Operation logging (timestamped structural + decision + commit events)  
- Cache directory management & cleanup  
- Export orchestration (copy/hard-link, path list generation)  

**Rust Native Module** (performance-critical)  
- Thumbnail generation (300–500 px, prefer embedded JPEG)  
- RAW preview extraction (fast small render when requested)  
- JPEG / common RAW format decoding  
- Parallel processing (rayon) for batch thumbnail/preview generation  
- Future: perceptual hashing  
- Memory-efficient pipelines

## 5. Performance & Caching Strategy

**Core rule: Preload small. Lazy-load large.**

- Level 1 – Persistent Disk Cache  
  Small thumbnails (generated once, JPEG-based, ~100–300 KB each)  
- Level 2 – In-Memory LRU  
  200–500 MB configurable limit  
  Holds current + previous + next images  
- Level 3 – On-Demand Full Resolution  
  Full JPEG or RAW decode only at 100% zoom or explicit RAW toggle  
  Freed immediately after use  

**RAW+JPEG preference**  
- Default: embedded JPEG or out-of-camera JPEG for thumbnails & quick views  
- RAW decode → only on explicit request or deep zoom

## 6. Operating System & Platform Targets

**Development**  
- Linux  

**Target platforms**  
- Linux: Ubuntu 20.04+ / Fedora 34+ / Debian 11+ (GTK3)  
- macOS: 10.15+ (Intel + Apple Silicon)  
- Windows: 10 (1903)+ / 11 (x64)  

**Minimum recommended hardware**  
- CPU: 4+ cores  
- RAM: 8 GB min / 16 GB recommended  
- Storage: ~500 MB–2 GB free per project  

**Build dependencies**  
- Node.js 18+ LTS  
- Rust stable (1.70+)  
- Windows: Visual Studio Build Tools  
- macOS: Xcode Command Line Tools  
- Linux: build-essential, libgtk-3-dev  

**Packaging**  
- electron-builder → .deb/.rpm/AppImage (Linux), .dmg (macOS), .exe/MSI (Windows)

## 7. Key Data Model Elements (SQLite)

Main tables (simplified):  
- `photos` → file path, metadata, pair_id, format  
- `pairs` → pair_id, jpeg_path, raw_path, representative_path  
- `stacks` → stack_id, name, created_at, photo/pair list  
- `rounds` → round_id, scope (stack/session), parent_round_id, started_at, committed (boolean), committed_at (datetime nullable)  
- `decisions` → round_id, photo/pair_id, decision (keep/eliminate), timestamp  
- `merges` → merge_id, timestamp, before_stack_ids, after_stack_id  
- `projects` → metadata, slug, last_open, settings (cache size, etc.)

A round becomes immutable only after `committed = true`.

## 8. Inter-Process Communication (IPC)

**Mechanism**  
- Electron built-in `ipcRenderer` / `ipcMain` (promise-based invoke/handle)

**Best Practices**  
- Use TypeScript interfaces for every request and response type  
  (example: `interface GetStacksRequest { projectId: string }`, `interface GetStacksResponse { stacks: Stack[] }`)  
- Validate all payloads (Zod or similar) before processing  
- All calls are async / promise-based (no synchronous IPC)  
- Organize channels with namespaces (e.g. `project:open`, `round:commit`, `image:preload`)  
- Centralized error response shape: `{ success: boolean; data?: any; error?: string }`  
- Support batching where meaningful (e.g. preload multiple thumbnails in one call)  
- Security: context isolation enabled, preload script only exposes safe APIs  
- Performance: minimize round-trips, monitor latency in dev tools  
- Future-proof: well-typed API surface allows adding new features (cloud sync, ML grouping) without breaking existing channels

**Example flow**  
Renderer: `ipcRenderer.invoke('round:commit', { roundId: 5 })`  
→ Backend: validates, updates DB, returns `{ success: true }` or error

## 9. Identified Technical Complexity & Risks

**Highest**  
- Non-blocking image pipeline (thumbnails + preloading + RAW toggle)  
- Reliable pair detection & consistent handling across views/export  
- Memory pressure (thousands of photos + LRU cache)  
- IPC latency & reliability (Electron ↔ Node ↔ Rust)  

**Medium**  
- Fuzzy search (trigram/levenshtein on filename/date/metadata)  
- Export (pair-aware copy/hard-link, flattening options)  
- Round snapshot & manual commit logic  
- Zoom/pan state & smooth transitions in Single View  
- Dynamic grid refresh / auto-fill in comparison mode  

**Low**  
- SQLite schema & queries  
- Stack merge/split with single-level undo  
- Keyboard navigation & visual feedback

## 10. Locked Architectural Decisions

- Logical photo = single file or RAW+JPEG pair (one decision unit)  
- Prefer fast JPEG/embedded for quick views & thumbnails  
- Rounds are linear & become immutable only after manual commit  
- Restoration creates new decision — never rewrites history  
- Renderer owns zoom/pan/comparison UX (temporary state, no persistence)  
- Rust owns all heavy image & parallel work  
- Projects isolated with slug-based folders  
- Export is pair-aware and first-class  
- IPC uses typed, namespaced channels for extensibility  
- No AI/ML in core path (future extension point only)



