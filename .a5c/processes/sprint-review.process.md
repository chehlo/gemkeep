# Sprint Review Process

## Purpose

Sequential retrospective review of already-committed sprint work. Each step completes (including fixes) before the next starts, because later steps depend on earlier ones.

## When to Use

- After completing one or more sprint phases with `gemkeep/task`
- Before merging a sprint branch to main
- When the sprint touched many modules and needs quality assurance

## Process Flow (Sequential)

### Step 0: Scope
Identify commits, touched files/modules, test counts.

### Step 1: Requirements Review
- Assess spec quality (5 dimensions × 20 pts = 100)
- **Breakpoint:** present findings, get user spec changes
- Apply spec fixes if needed → commit
- **Breakpoint:** confirm changes
- **Must complete before Step 2** — spec changes affect what code should exist

### Step 2: Architecture Review
- Anti-pattern scan (code-improvements.md)
- Architecture compliance (sprint-plan.md invariants)
- **Breakpoint:** present findings, get user fix guidance
- Apply fixes via TDD if needed → commit
- **Must complete before Step 3** — architecture fixes change what tests should verify

### Step 3: Test Review
- Full test suite baseline
- Coverage audit (testing-philosophy.md, 20 rules)
- Success criteria verification (MET/PARTIAL/UNMET)
- **Breakpoint:** present findings, get user fix guidance
- Apply test fixes via TDD if needed → commit

### Step 4: Final Gate
- Full test suite + user approval

## Why Sequential?

- Changing the **spec** (Step 1) invalidates architecture and test findings
- Fixing **architecture** (Step 2) changes what tests should verify
- **Tests** (Step 3) must audit against the corrected spec and code
- Running all gates in parallel produces stale findings that waste time

## Inputs

| Input | Type | Default | Description |
|-------|------|---------|-------------|
| sprintNumber | number | required | Sprint number being reviewed |
| phases | string[] | [] | Which phases to review |
| testCommand | string | `cargo test --manifest-path src-tauri/Cargo.toml` | Rust test runner |
| frontendTestCommand | string | `npm test` | Frontend test runner |
