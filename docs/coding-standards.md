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
    import { onMount } from 'svelte';

    // 2. Props
    export let projectId: number;

    // 3. State
    let photos: Photo[] = [];
    let loading = true;

    // 4. Reactive statements
    $: activePhotos = photos.filter(p => p.status === 'active');

    // 5. Functions
    async function loadPhotos() {
        photos = await invoke('get_photos', { projectId });
        loading = false;
    }

    // 6. Lifecycle
    onMount(loadPhotos);
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

### Styling
- Use Tailwind CSS utility classes
- Avoid custom CSS unless necessary
- Keep consistent spacing and color usage

### Keyboard Handling
- Use `svelte:window` for global shortcuts
- Prevent default browser behavior where needed
- Document all keyboard shortcuts

```svelte
<svelte:window on:keydown={handleKeydown} />

<script lang="ts">
function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'j' || e.key === 'ArrowDown') {
        e.preventDefault();
        navigateNext();
    }
}
</script>
```

## Code Duplication (DRY)

Extract when:
- Pattern repeated ≥3 times
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
