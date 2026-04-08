# GemKeep — project command runner
# Usage: just --list

# ── Dev & Build ──────────────────────────────────────────────────────────

# Start development server (Tauri + Vite hot-reload)
dev:
    cargo tauri dev

# Production build
build:
    cargo tauri build

# Frontend dev server only (no Tauri shell)
dev-web:
    npm run dev

# ── Full regression ──────────────────────────────────────────────────────

# Run all test layers (lint → rust → frontend → e2e → gates)
test-all: lint test-rust test-frontend test-e2e test-gates
    @echo ""
    @echo "✅ Full regression passed"

# ── Rust ─────────────────────────────────────────────────────────────────

# Rust clippy + fmt check
lint:
    @echo "── Rust clippy ──"
    cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings
    @echo "── Rust fmt ──"
    cargo fmt --manifest-path src-tauri/Cargo.toml --check

# Auto-fix Rust lint + format
lint-fix:
    cargo clippy --manifest-path src-tauri/Cargo.toml --fix --allow-dirty
    cargo fmt --manifest-path src-tauri/Cargo.toml

# Rust tests (optionally filter by module/test name)
test-rust filter="":
    cargo test --manifest-path src-tauri/Cargo.toml {{ filter }}

# ── Frontend ─────────────────────────────────────────────────────────────

# All frontend tests — jsdom + browser (optionally filter by filename)
test-frontend filter="":
    npx vitest run --reporter=dot {{ filter }}

# jsdom tests only
test-jsdom filter="":
    npx vitest run --reporter=dot --project jsdom {{ filter }}

# Browser (pixel-verified) tests only
test-browser filter="":
    npx vitest run --reporter=dot --project browser {{ filter }}

# ── E2E ──────────────────────────────────────────────────────────────────

# Playwright E2E tests (optionally filter by spec name)
test-e2e filter="":
    npx playwright test {{ if filter != "" { "--grep " + filter } else { "" } }}

# ── Gates ────────────────────────────────────────────────────────────────

# Rule 24 grep gates — no color literals or visual expect() in test files
test-gates:
    @echo "── Rule 24 gates ──"
    @bash -c '! grep -rn -E "rgb\(|#[0-9a-fA-F]{6}|(green|red|blue|yellow)-[0-9]" src/ --include="*.test.ts" | grep -v "pixel-verifier.browser.test.ts" || (echo "❌ Gate 1 FAILED" && exit 1)'
    @bash -c '! grep -rn -E "expect\(getComputedStyle|expect\(.*\.(borderColor|outlineColor|backgroundColor|boxShadow)|expect\(.*\.className\)\.toContain\(" src/ --include="*.browser.test.ts" || (echo "❌ Gate 2 FAILED" && exit 1)'
    @echo "Gates passed"
