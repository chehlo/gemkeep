# Sprint Development Process

## Purpose

A sprint development process for GemKeep that prevents the kinds of code quality issues discovered in the `docs/code-improvements.md` analysis. Builds on `behavioral-tdd.js` by adding architecture quality gates and anti-pattern awareness at every phase.

## When to Use

- Starting a new sprint (S7-S12)
- Implementing multiple features within a sprint
- Any sprint that touches modules with known code-improvements items

## Process Overview

### Phase 0: Sprint Planning & Architecture Analysis
1. **Analyze sprint spec** — extract features, identify touched modules, cross-reference with sprint-plan.md invariants
2. **Evaluate spec quality** — score 0-100 across 5 dimensions (20 pts each):
   - Goal Clarity — Is the WHY stated? Do features form a coherent unit?
   - Completeness — Success criteria, edge cases, test layers specified?
   - Testability — Can criteria be verified with automated tests?
   - Architecture Alignment — References sprint-plan.md, specifies modules?
   - Implementability — Realistic scope, clear dependencies?
   If score < 70 or gaps found: breakpoint to review, then auto-improve spec
3. **Scan anti-patterns** — check code-improvements.md for issues in touched modules
4. **Architecture compliance** — verify current state against sprint-plan.md invariants (per-project isolation, repository pattern, error handling)
5. **Breakpoint** — user reviews plan, spec quality, anti-patterns, and architecture status

### Phase 1: Pre-flight Refactoring (conditional)
Only if HIGH severity or BUG items exist in modules that will be touched:
1. Fix each item with a TDD safety net (green → refactor → green)
2. Commit pre-flight changes
3. **Breakpoint** — user reviews refactoring results

### Phase 2: Feature Implementation (per feature)
For each feature, a full TDD cycle with additional gates:
1. **Spec analysis** with anti-pattern warnings and architecture notes
2. **Breakpoint** — review extracted behaviors
3. **Write RED tests** — includes tests that would catch known bugs if reintroduced
4. **Run tests** — verify RED failures
5. **Breakpoint** — RED review
6. **Commit RED**
7. **GREEN implementation** — agent receives anti-pattern checklist and architecture constraints
8. **Run tests** — verify GREEN
9. **Test immutability check** — git diff verification
10. **Post-GREEN architecture check** — NEW: scan diff for newly introduced anti-patterns
11. **Commit GREEN**
12. **Breakpoint** — GREEN review with architecture check results

### Phase 3: Sprint Integration
1. Full test suite + clippy + fmt
2. Final architecture compliance gate (full codebase check)
3. **Breakpoint** — sprint summary with anti-pattern report

## Inputs

| Input | Type | Default | Description |
|-------|------|---------|-------------|
| sprintNumber | number | required | Sprint number (7, 8, etc.) |
| sprintSpecPath | string | auto | Path to sprint spec document |
| features | string[] | [] | Feature descriptions (overridden by spec analysis) |
| testCommand | string | `cargo test --manifest-path src-tauri/Cargo.toml` | Test runner |
| improvementsPath | string | `docs/code-improvements.md` | Anti-pattern reference |
| sprintPlanPath | string | `docs/sprints/sprint-plan.md` | Architecture invariants |

## Anti-Pattern Categories Checked

From `docs/code-improvements.md`:
- **DUP-***: Code duplication — agent checks if similar logic exists before writing new
- **ABS-***: Abstraction issues — agent uses repository pattern, avoids inline SQL
- **INC-***: Inconsistencies — agent follows existing error handling patterns
- **MIS-***: Missing abstractions — agent creates constants, helpers as needed
- **DEAD-***: Dead code — agent removes if encountered
- **BUG-***: Known bugs — tests are written to catch if reintroduced

## Architecture Invariants Enforced

From `docs/sprints/sprint-plan.md`:
1. Per-project context isolation (HashMap<String, ProjectContext>)
2. Repository pattern for all DB access
3. thiserror/anyhow error handling
4. Modularity (standalone modules, composable functions)
5. No global state for project-specific data

## Usage

```bash
babysitter run:create \
  --process-id gemkeep/sprint-development \
  --entry .a5c/processes/sprint-development.js#process \
  --inputs inputs.json \
  --prompt "Sprint 8 development" \
  --harness claude-code \
  --session-id "$SESSION_ID" \
  --plugin-root "$PLUGIN_ROOT" \
  --json
```

inputs.json:
```json
{
  "sprintNumber": 8,
  "features": [
    "Side-by-side comparison view",
    "Auto-fill on eliminate",
    "Stack decision progress indicator"
  ]
}
```

## Companion Process

Use `gemkeep/refactoring-sprint` for dedicated cleanup sprints that work through code-improvements.md items systematically.
