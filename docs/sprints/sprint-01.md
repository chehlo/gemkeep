# Sprint 1 — Detailed Design: Skeleton

## Goal
Prove that all architectural layers compile, communicate, and navigate correctly. No business logic. Every screen exists as an empty shell. One real Tauri IPC round-trip works. DB schema is defined and migrates cleanly.

This sprint is the foundation all other sprints build on — getting it right matters more than getting it fast.

**User Stories covered:** none (infrastructure only)

---

## Directory Structure

```
gemkeep/
├── docs/
│   ├── architecture.md
│   ├── user_stories.md
│   ├── coding-standards.md
│   ├── testing-standards.md
│   └── sprints/
│       ├── sprint-plan.md       # High-level sprint overview
│       └── sprint-01.md         # This file
│
├── src/                         # Svelte frontend (Vite SPA, no SvelteKit router)
│   ├── lib/
│   │   ├── api/
│   │   │   └── index.ts         # Typed wrappers around invoke(); one function per Tauri command
│   │   ├── stores/
│   │   │   └── navigation.ts    # App-level navigation state store
│   │   └── components/
│   │       ├── screens/
│   │       │   ├── ProjectList.svelte
│   │       │   ├── StackOverview.svelte
│   │       │   ├── StackFocus.svelte
│   │       │   └── SingleView.svelte
│   │       └── layout/
│   │           └── AppShell.svelte   # Top-level shell, renders active screen
│   ├── app.css                  # Tailwind base import
│   ├── App.svelte               # Root: mounts AppShell, handles global keydown
│   └── main.ts                  # Vite entry point
│
├── src-tauri/
│   ├── src/
│   │   ├── main.rs              # Tauri builder, registers commands, sets up AppState
│   │   ├── state.rs             # AppState struct definition
│   │   ├── db/
│   │   │   ├── mod.rs           # DB module public interface
│   │   │   ├── connection.rs    # Open connection, WAL mode, busy timeout
│   │   │   └── migrations.rs    # run_migrations(); versioned schema
│   │   └── commands/
│   │       └── dev.rs           # ping() command (Sprint 1 only, removed in Sprint 2)
│   ├── Cargo.toml
│   └── tauri.conf.json
│
├── CLAUDE.md
├── package.json
├── vite.config.ts
└── tailwind.config.ts
```

---

## Main Concepts

### 1. Navigation State Machine (Frontend)
The app is a **single-page application** with no URL router. Navigation is a Svelte store holding the current screen and any contextual IDs needed to render it.

Screens and their required context:
- `project-list` — no context
- `stack-overview { projectSlug }` — which project is open
- `stack-focus { projectSlug, stackId }` — which stack is being reviewed
- `single-view { projectSlug, stackId, photoId }` — which photo is in focus

Transitions only flow in one direction (deeper) or back via `Escape` (shallower). The store is the single source of truth for "what is visible". No imperative routing.

### 2. AppState (Rust)
A single struct held in Tauri's managed state, shared across all command invocations via `tauri::State<'_, AppState>`. In Sprint 1 this holds a closed (None) DB connection. From Sprint 2 onward it holds the active project's connection.

The connection is wrapped in `Mutex<Option<Connection>>` — `None` when no project is open. Commands that require an open project check for `Some` and return a typed error if not. This pattern is established here so all future commands use it consistently.

### 3. Database Migrations
All schema is defined once, applied in order, and versioned using a `schema_version` table. `run_migrations()` is idempotent — safe to call on every app start.

The **full schema for all sprints** is defined in Sprint 1, even though most tables stay empty until later sprints. This avoids migration conflicts during development.

Tables: `schema_version`, `projects`, `photos`, `stacks`, `rounds`, `decisions`, `merges`.

### 4. Typed API Layer (Frontend)
All Tauri `invoke()` calls live in `src/lib/api/index.ts`. Each function is typed: correct command name, correct parameter shape, typed return value. No `invoke()` call appears outside this file. This keeps the IPC surface in one place and makes future refactoring safe.

### 5. Global Keyboard Handling
`App.svelte` attaches a single `keydown` handler via `<svelte:window>`. It reads the current navigation state and dispatches to screen-specific handlers. This pattern is established in Sprint 1 and followed by all future sprints — even though no keys do anything meaningful yet.

---

## Important Interfaces

### Navigation Store (`navigation.ts`)
- `navigate(to: Screen)` — transition to a new screen
- `back()` — go one level up (Escape behavior)
- `currentScreen` — readable Svelte state
- `Screen` — discriminated union type covering all screen variants with their required context fields

### AppState (`state.rs`)
- `db: Mutex<Option<Connection>>` — active project DB; `None` if no project is open
- Exposed to all Tauri commands via `State<'_, AppState>`
- Future sprints will add: in-memory LRU thumbnail cache, background job handles

### DB Module Public Interface (`db/mod.rs`)
- `open_connection(path: &Path) -> Result<Connection>` — opens SQLite file, sets WAL mode and busy timeout
- `run_migrations(conn: &Connection) -> Result<()>` — idempotent, applies all pending schema versions
- `schema_version(conn: &Connection) -> Result<u32>` — returns current migration version number

### Tauri Commands (Sprint 1 only)
- `ping() -> Result<String, String>` — returns `"pong"`, proves IPC layer works end-to-end
- Removed in Sprint 2

### Svelte API Wrapper (`api/index.ts`)
- `ping() -> Promise<string>` — typed wrapper over `invoke("ping")`
- Pattern: every future Tauri command gets exactly one typed function here; no raw `invoke` elsewhere

---

## Special Concerns

### Tauri 2.x API — Do Not Mix with 1.x
Tauri 2.x has breaking changes from 1.x:
- Import `invoke` from `@tauri-apps/api/core`, not `@tauri-apps/api/tauri`
- Managed state: `tauri::State<'_, T>` (with lifetime)
- Permissions in `tauri.conf.json` must explicitly allow each IPC command
- Plugin registration API changed

Use only Tauri 2.x documentation. Do not copy 1.x examples.

### Svelte 5 Runes
Svelte 5 uses runes (`$state`, `$derived`, `$effect`) instead of Svelte 4 reactive declarations (`let x = ...` + `$: ...`). All stores and components must use the Svelte 5 model from day one. Do not mix syntax.

### SQLite WAL Mode
Enable WAL (Write-Ahead Logging) on every connection opened. This is required for Sprint 4+ where background thumbnail generation and UI reads happen concurrently. Establishing it in `open_connection()` now costs nothing and prevents a hard-to-debug concurrency issue later.

### One DB File Per Project
Each project has its own `project.db` under `~/.gem-keep/projects/<slug>/`. `AppState.db` holds only the currently open project's connection. When switching projects, close the old connection and open the new one. Do not share a single global DB across projects.

### Full Schema Upfront
Define all tables in the Sprint 1 migration even though most are unused. SQL comments mark which sprint activates each table. This avoids schema migration conflicts when real data exists in the DB during later development.

### Test Risk: Silent No-ops
The primary risk in Sprint 1 is code that compiles but silently does nothing. Tests must be specific:
- Query `sqlite_master` to confirm each table was actually created
- Call `ping` from a real Tauri test context, not a mocked JS call
- Simulate screen transitions via the navigation store and assert the correct screen is rendered

---

## What Sprint 1 Does NOT Include
- Project creation, listing, or any project data
- Any photo, thumbnail, or image handling
- Any Tauri commands beyond `ping`
- Styling beyond a functional Tailwind layout
- SvelteKit — this is a plain Vite SPA

---

## Definition of Done
- `cargo tauri dev` launches without panic
- `cargo test` passes (schema migration test, ping test)
- All four screens reachable via navigation store (no dead ends, no crashes)
- `cargo fmt` and `cargo clippy` produce no warnings
