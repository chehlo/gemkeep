# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

GemKeep is a keyboard-first photo culling tool for photographers handling large RAW+JPEG shoots (5000+ photos). Built with Tauri (desktop framework), Svelte (frontend), and Rust (backend + image processing).

## Build & Test Commands

```bash
# Preferred: use justfile targets (consistent across platforms)
just test-all                 # Full regression: lint → rust → frontend → e2e → gates
just lint                     # Clippy + fmt check
just lint-fix                 # Auto-fix lint + format
just test-rust [filter]       # Rust tests (optionally filter by name)
just test-frontend [filter]   # All frontend tests (jsdom + browser)
just test-e2e [filter]        # Playwright E2E tests
just dev                      # Start development server
just build                    # Production build

# Direct commands (when needed)
cargo test                    # Run all Rust tests
cargo test test_name          # Run specific test
cargo fmt                     # Format code
cargo clippy --fix            # Lint and auto-fix
npm run dev                   # Frontend dev server only
npm run test:e2e              # E2E tests
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
- Use TypeScript strictly — no `any` types
- Tailwind for styling — no inline `style` attributes
- Keep logic minimal — heavy work belongs in Rust
- **Read `docs/coding-standards.md` (Svelte/Frontend section) before writing any Svelte code** — 19 rules covering component size, keyboard handling, state management, templates, shared utilities, API patterns

### Error Handling
- Never crash on bad input
- Log detailed error, return user-friendly message
- Continue processing remaining items in batch operations

## Development Processes (mandatory)

All feature and bugfix work MUST go through babysitter. Pick the right process:

### Small features & bug fixes — `gemkeep/task`

```
/babysitter:call
```
Process: `.a5c/processes/task.js` (process-id: `gemkeep/task`)

**Workflow:**
1. **Understand** — explore codebase, produce approach + behavioral contract
2. **Clarify** — breakpoint: user approves or corrects the plan
3. **TDD** — delegates to `behavioral-tdd` (RED → GREEN → quality gate)

### Sprint development — `gemkeep/sprint-development`

Process: `.a5c/processes/sprint-development.js` (process-id: `gemkeep/sprint-development`)

For multi-feature sprints with architecture gates, anti-pattern scanning, spec quality scoring, and user review cycles. Delegates TDD cycle to `behavioral-tdd` per feature.

### TDD engine — `gemkeep/behavioral-tdd`

Process: `.a5c/processes/behavioral-tdd.js` (process-id: `gemkeep/behavioral-tdd`)

Pure TDD engine used by both processes above. Not called directly — callers provide `behaviors` (array of {trigger, expectedOutcome, testLayer}).

**TDD workflow:**
1. **RED** — write black-box behavioral tests with stubs (must compile, fail at runtime)
2. **Commit RED** — git record proving tests exist before implementation
3. **GREEN** — implement minimum production code (test files are immutable)
4. **Commit GREEN** — with automated test immutability check
5. **Final quality gate** — full test suite + clippy + fmt

**Key rules:**
- Tests must compile (add `todo!()` stubs for missing API, not compile errors)
- RED tests are immutable — zero modifications during GREEN
- `expected` metadata must match actual file content (use `extract_metadata()` + `assert_exif_matches()`)
- Use exact assertions (`==`), never approximate (`>=`, `>`)
- Every breakpoint requires explicit user approval

Do NOT implement features or fixes outside these processes unless explicitly asked to skip it.

## Testing

- **Read `docs/testing-philosophy.md` before writing any tests** — 16 rules earned by real bugs
- **Unit tests:** `cargo test` - 90% coverage on business logic
- **Negative tests:** Test all error paths, corrupt files, edge cases
- **Performance:** Establish baselines after implementation
- **E2E:** 3-5 critical journeys only
- **Use existing test infrastructure (Rule 16):** `TestLibraryBuilder`/`TestProject` for Rust photo tests, shared fixtures/helpers/factories from `src/test/` for frontend. No ad-hoc setup when helpers exist. Exceptions require explicit user approval.
- **Green baseline required:** Every sprint starts with ALL tests passing. Failures must be fixed or explicitly approved — never silently skipped as "pre-existing."

## Commit Format

```
<type>: <≤50 chars description>
```
Types: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`
