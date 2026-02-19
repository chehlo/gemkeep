# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

GemKeep is a keyboard-first photo culling tool for photographers handling large RAW+JPEG shoots (5000+ photos). Built with Tauri (desktop framework), Svelte (frontend), and Rust (backend + image processing).

## Build & Test Commands

```bash
# Rust backend
cargo test                    # Run all tests
cargo test test_name          # Run specific test
cargo fmt                     # Format code
cargo clippy --fix            # Lint and auto-fix
cargo bench                   # Run benchmarks

# Frontend
npm run dev                   # Development server
npm run build                 # Production build
npm test                      # Frontend tests (if any)

# Full app
cargo tauri dev               # Run app in development
cargo tauri build             # Build distributable

# E2E tests
npm run test:e2e
```

## Architecture

```
┌─────────────────────────────────────┐
│  Svelte Frontend                    │  UI, keyboard handling, display
├─────────────────────────────────────┤
│  Tauri IPC (invoke/commands)        │  Async, typed
├─────────────────────────────────────┤
│  Rust Backend                       │  All logic, SQLite, image processing
└─────────────────────────────────────┘
```

**Key concept:** Logical photo = single file OR RAW+JPEG pair (one decision unit)

### Technology Stack
- **Desktop:** Tauri 2.x
- **Frontend:** Svelte 5 + Tailwind CSS
- **Backend:** Rust (single language for all backend)
- **Database:** SQLite (rusqlite)
- **RAW processing:** rsraw (LibRaw wrapper)
- **Parallelism:** rayon

## Code Standards

### Rust
- Run `cargo fmt` and `cargo clippy --fix` before commit
- Use `thiserror` for domain errors, `anyhow` for propagation
- Use `tracing` for logging (never `println!`)
- Prefer `&str`/`&[u8]` over owned types when possible
- All Tauri commands return `Result<T, String>`

### Svelte
- Use TypeScript
- Tailwind for styling
- Keep logic minimal - heavy work belongs in Rust

### Error Handling
- Never crash on bad input
- Log detailed error, return user-friendly message
- Continue processing remaining items in batch operations

## Testing

- **Unit tests:** `cargo test` - 90% coverage on business logic
- **Negative tests:** Test all error paths, corrupt files, edge cases
- **Performance:** Establish baselines after implementation
- **E2E:** 3-5 critical journeys only

## Commit Format

```
<type>: <≤50 chars description>
```
Types: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`
