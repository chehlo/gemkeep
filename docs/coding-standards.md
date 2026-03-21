# GemKeep Coding Standards

## Code Quality

### Comments
- Avoid obvious comments
- Comment only non-trivial logic, complex algorithms, or important invariants
- In Rust: Prefer `///` doc comments for public APIs; explain `unsafe` blocks thoroughly (minimize unsafe usage)

### Formatting
- No trailing whitespace
- Max 1 blank line between logical sections
- Svelte/JS/TS/JSON: 2-space indentation, Prettier enforced
- Rust: `cargo fmt` defaults (4 spaces), run before commit
- Line length: Aim <100 chars (120 max), break long lines sensibly

### Solution Quality
- Prefer correct and maintainable code over quick hacks
- All heavy work in Rust backend, never in frontend
- Prioritize memory safety and predictable performance
- Label temporary workarounds with TODO + owner + timeframe
- Explain architectural trade-offs in commit messages or nearby comments

## Parameters & Fallbacks

### No optional parameters by default
- **Parameters are required unless there is a concrete, documented reason for optionality.**
- Optional parameters with silent fallbacks hide bugs — the caller forgets to pass the value, the function silently returns wrong data, and tests pass because mocks don't check parameters.
- If a parameter is truly optional, document WHY in a comment at the declaration site.
- Prefer failing loudly (return error / panic) over silently degrading with a fallback.
- Example of what NOT to do: `list_logical_photos(slug, stack_id, round_id: Option<i64>)` where `None` falls back to returning all photos — this hides the bug where the caller never passes `round_id`.

### No silent fallbacks
- If a function receives unexpected input, return an error — don't substitute a default.
- We are a local desktop app with no network dependencies. If the DB fails, it's a critical error. Don't degrade gracefully — surface the error to the user.
- Fallback values are allowed only for user-facing display (e.g., "(no date)" for missing EXIF), never for data queries.

## Error Handling

### Rust Backend
- Use `thiserror` for domain-specific errors
- Use `anyhow` for quick propagation in application code
- Return `Result<T, String>` for Tauri commands (error message shown to user)
- Log context-rich errors with `tracing` before converting to user-facing message

```rust
use thiserror::Error;

#[derive(Error, Debug)]
pub enum ImportError {
    #[error("Cannot read folder: {path}")]
    FolderNotReadable { path: String },
    #[error("No supported images found")]
    NoImagesFound,
    #[error("Database error: {0}")]
    Database(#[from] rusqlite::Error),
}

#[tauri::command]
fn import_folder(path: String) -> Result<ImportResult, String> {
    import_folder_impl(&path).map_err(|e| {
        tracing::error!("Import failed: {e:?}");
        e.to_string()
    })
}
```

### Frontend (Svelte)
- Handle errors from Tauri commands gracefully
- Show user-friendly error messages
- Log detailed errors to console in development only

```typescript
try {
    const result = await invoke('import_folder', { path });
} catch (error) {
    // error is the String from Rust Result::Err
    showErrorToast(error as string);
}
```

## Logging

### Rule: No console/println in production code
- Rust: Structured logging via `tracing` crate
- Frontend: Avoid console.log; use only for development debugging

```rust
use tracing::{error, info, warn, debug};

info!(project_id = %id, photo_count = count, "Import completed");
error!(path = %path, error = %e, "Failed to read EXIF data");
warn!(threshold_ms = 2000, actual_gap_ms = gap, "Large gap between photos");
debug!(photo_id = id, "Generating thumbnail");
```

### Log Levels
- **error**: Failures needing attention
- **warn**: Degraded state or unusual conditions
- **info**: Key operations (project create, import, round commit, export)
- **debug**: Detailed diagnostics (enabled only when needed)

## Rust-Specific Guidelines

### Before Every Commit
```bash
cargo fmt
cargo clippy --fix --allow-dirty
cargo test
```

### Code Style
- Prefer safe code; `unsafe` only if justified + documented
- Prefer `&str` and `&[u8]` over owned `String` and `Vec<u8>` when possible
- Use `rayon` for parallel processing (thumbnail generation)
- Avoid `.unwrap()` and `.expect()` in library code; use `?` operator
- Use `#[must_use]` for functions whose return value shouldn't be ignored

### Tauri Commands
- All commands are `async` or offload heavy work to background threads
- Return `Result<T, String>` for proper error handling
- Use serde for serialization: derive `Serialize`, `Deserialize`

```rust
#[tauri::command]
async fn get_photos(project_id: i64, state: State<'_, AppState>) -> Result<Vec<Photo>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.get_photos(project_id).map_err(|e| e.to_string())
}
```

### Common Crates
- `rusqlite` - SQLite database
- `rsraw` - RAW image processing (LibRaw wrapper)
- `image` - JPEG/PNG processing
- `rayon` - Parallel iteration
- `tracing` - Structured logging
- `thiserror` / `anyhow` - Error handling
- `serde` / `serde_json` - Serialization
- `tokio` - Async runtime (used by Tauri)

## Svelte/Frontend Guidelines

### Component Structure
```svelte
<script lang="ts">
    // 1. Imports
    import { invoke } from '@tauri-apps/api/core';

    // 2. Props (Svelte 5 runes)
    let { projectId }: { projectId: number } = $props();

    // 3. State
    let photos: Photo[] = $state([]);
    let loading = $state(true);

    // 4. Derived values
    const activePhotos = $derived(photos.filter(p => p.status === 'active'));

    // 5. Functions
    async function loadPhotos() {
        photos = await invoke('get_photos', { projectId });
        loading = false;
    }

    // 6. Side effects
    $effect(() => {
        loadPhotos();
    });
</script>

<!-- Template -->
<div class="grid">
    {#each activePhotos as photo (photo.id)}
        <PhotoCard {photo} />
    {/each}
</div>

<style>
    /* Component-scoped styles (prefer Tailwind classes instead) */
</style>
```

Use Svelte 5 runes exclusively: `$state`, `$derived`, `$props`, `$effect`. Do not use Svelte 4 patterns (`export let`, `$:` reactive statements).

### Component Extraction
- Shared UI components live in `src/lib/components/`
- Screen-level components live in `src/lib/components/screens/`
- Extract into a shared component when the same markup appears in 2 or more screens
- Example: `DecisionIndicator.svelte` renders keep/eliminate border overlays; used in both StackOverview cards and SingleView

### Shared Constants
- Visual constants (CSS class names, selectors) live in `src/lib/constants/`
- Tests import CSS selectors from constants; never hardcode class strings in test files
- Changing a style means editing 1-2 files (the constant + the component), not every test
- Example: `src/lib/constants/decisions.ts` exports `DECISION_CLASSES`, `DECISION_BORDERS`, `DECISION_SELECTORS`

### Shared Utilities
- Reusable pure functions live in `src/lib/utils/`
- Prefer pure functions with no side effects; state mutation only when Svelte reactivity requires it
- Any function used in 2+ screens MUST be extracted to `src/lib/utils/` — no copy-paste between screens
- Grid navigation, decision handling, keyboard routing, scroll-into-view, file overlay toggle — all shared
- `src/lib/utils/decisions.ts` must route through `src/lib/api/index.ts` — never raw `invoke()`
- Example: `src/lib/utils/photos.ts` exports `updateDecisionState`, `formatCaptureTime`, `truncate`

### Test Helpers
- Shared test helper functions live in `src/test/`
- Helpers derive DOM selectors from constants (never hardcode CSS class strings)
- If a class name changes, only the constant and the helper need updating — not individual test files
- Example: `src/test/decision-helpers.ts` wraps `DECISION_SELECTORS` into `queryKeepIndicator()`, `queryEliminateIndicator()`, etc.

### Styling
- Use Tailwind CSS utility classes
- Avoid custom CSS unless necessary
- Keep consistent spacing and color usage

### Keyboard Handling
- Use `mapVimKey(e)` from `src/lib/utils/keyboard.ts` for hjkl-to-Arrow mapping — never inline the mapping
- Use `gridNavigate(key, index, count, cols)` from `src/lib/utils/keyboard.ts` for grid arrow/Home/End navigation — never reimplement clamping logic
- Prefer a declarative key-binding pattern over `if`/`return` chains:

```ts
// Good: declarative key map
const bindings: KeyBinding[] = [
  { key: 'Enter', ctrl: true, action: commitRound },
  { key: 'y', action: () => decide('keep') },
  { key: 'x', action: () => decide('reject') },
];
const handleKey = createKeyHandler(bindings);

// Bad: 200-line if/return chain
function handleKey(e: KeyboardEvent) {
  if (e.ctrlKey && e.key === 'Enter') { ... return }
  if (e.key === 'y') { ... return }
  // ... 30 more cases
}
```

### Component Size Limits
- Max ~200 lines `<script>`, ~150 lines template. Extract sub-components when exceeded.
- No function longer than ~50 lines. Split into helpers or utilities.
- Inline `onclick` only for one-liners. Extract a named function for anything with conditional logic.

### State Management
- Use `SelectionState` from `src/lib/utils/selection.ts` for all multi-select — never raw `Set<number>` with manual reactivity hacks
- Use `createTimedError()` for all timed error display — every screen follows the same pattern
- Use `findNextUndecided()` from `src/lib/utils/decisions.ts` for Tab/Shift+Tab navigation — never reimplement the scan loop
- Use `handleDecisionKey()` from `src/lib/utils/decisions.ts` for Y/X/U handlers — pass screen-specific callbacks for post-decision behavior

### Template Conventions
- Max 3 levels of nesting in templates. Use `{#snippet}` or extract a component to flatten deeper structures.
- Extract components for template sections exceeding ~50 lines (e.g., `StackCard`, `ScreenHeader`, `ErrorBanner`)

### API Call Patterns
- `onMount` with `try/catch/finally` for loading state. All IPC errors go through `showActionError`.
- All `invoke()` calls centralized in `src/lib/api/index.ts` — screens never call `invoke()` directly.
- `onDestroy` must clean up `removeEventListener('keydown', ...)` and `cleanupErrorTimer()`.

## Code Duplication (DRY)

Extract when:
- Pattern repeated ≥3 times (Rust logic, query builders, parsers)
- UI component or markup repeated in ≥2 screens
- Common query builders, parsers, UI patterns

Do not extract when:
- Abstraction harms readability
- Helper requires excessive parameters
- Duplication is coincidental

## TODO Comments

- Do not commit incomplete features
- Acceptable: `// TODO(yourname): Optimize batch size after profiling (Q2 2026)`
- Unacceptable: `// TODO: fix this`
- Prefer feature flags for deferred work
- Review and clean stale TODOs monthly

## Commit Messages

Format: `<type>: <≤50 chars description>`

Types:
- **feat**: New feature
- **fix**: Bug fix
- **refactor**: Code restructure
- **test**: Add/update tests
- **docs**: Documentation
- **chore**: Maintenance

Examples:
```
feat: add project slug generation and validation
fix: handle corrupt JPEG in thumbnail pipeline
refactor: extract stack detection into separate module
```

## File Organization

- Keep files focused: split when >400 LOC (aim <350)
- One module = one responsibility
- Group related functionality in directories

## General Rules

- TDD where practical: write failing test first for logic
- Enforce formatting via pre-commit hooks
- All errors handled explicitly
- Documentation updated alongside code changes
