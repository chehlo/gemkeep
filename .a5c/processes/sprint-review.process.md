# Sprint Review Process

## Purpose

Retrospective quality review of already-committed sprint work. Catches issues that the `gemkeep/task` process (lightweight TDD) misses: anti-pattern creep, architecture drift, test coverage gaps, and unmet success criteria.

Use after sprint phases are committed but before moving to the next phase or final merge.

## When to Use

- After completing one or more sprint phases with `gemkeep/task`
- Before merging a sprint branch to main
- When the sprint touched many modules (>5 files) and needs quality assurance
- As a periodic check during long sprints (S10+)

## Process Overview

### Phase 1: Scope
Identify what was committed: git commits, touched files, touched modules, test counts.

### Phase 2: Spec Quality (Retrospective)
Score the sprint spec on 5 dimensions (20 pts each, 100 total):
1. **Goal Clarity** — Is the WHY clear? Do features form a coherent unit?
2. **Completeness** — Success criteria, edge cases, test layers specified?
3. **Testability** — Can criteria be verified automatically?
4. **Architecture Alignment** — References sprint-plan.md, specifies modules?
5. **Implementability** — Realistic scope, clear dependencies?

Retrospective twist: also checks if implementation drifted from spec intent.

### Phase 3: Quality Gates
Reuses gates from `sprint-development.js`:
- **Anti-pattern scan** — code-improvements.md cross-reference
- **Architecture compliance** — sprint-plan.md invariants
- **Test coverage audit** — testing-philosophy.md (all 20 rules)
- **Full test suite run** — cargo test + npm test + clippy + fmt

### Phase 4: Success Criteria Verification
For each numbered criterion in the sprint spec:
- Find implementing code
- Find verifying test
- Mark: MET / PARTIAL / UNMET

### Phase 5: Issue Collection (Breakpoint)
Presents all findings to user. Categories: SPEC, ANTIPATTERN, ARCH, COVERAGE, CRITERIA.

### Phase 6: Fix Cycle (iterative)
For each issue:
1. Plan fix with behavioral contract
2. Breakpoint: review fix plan
3. Implement via behavioral TDD (delegates to `behavioral-tdd.js`)
4. Re-verify quality gates
5. Loop until clean or user says "enough"

### Phase 7: Final Gate
Full test suite + final approval.

## Inputs

| Input | Type | Default | Description |
|-------|------|---------|-------------|
| sprintNumber | number | required | Sprint number being reviewed |
| sprintSpecPath | string | auto | Path to sprint spec |
| phases | string[] | [] | Which phases to review (e.g., ["A", "B", "C"]) |
| commitRange | string | auto | Git commit range |
| testCommand | string | `cargo test --manifest-path src-tauri/Cargo.toml` | Rust test runner |
| frontendTestCommand | string | `npm test` | Frontend test runner |
| improvementsPath | string | `docs/code-improvements.md` | Anti-pattern reference |
| sprintPlanPath | string | `docs/sprints/sprint-plan.md` | Architecture invariants |

## Relationship to Other Processes

- **Imports from `sprint-development.js`:** `scanAntiPatternsTask`, `architectureComplianceTask`, `runFullTestSuiteTask`
- **Delegates fixes to `behavioral-tdd.js`:** same RED → GREEN → quality gate cycle
- **Complements `gemkeep/task`:** task does lightweight TDD, review adds the quality gates task skips

## Usage

```bash
babysitter run:create \
  --process-id gemkeep/sprint-review \
  --entry .a5c/processes/sprint-review.js#process \
  --inputs inputs.json \
  --prompt "Review Sprint 10 Phases A, B, C" \
  --harness claude-code \
  --session-id "$SESSION_ID" \
  --plugin-root "$PLUGIN_ROOT" \
  --json
```

inputs.json:
```json
{
  "sprintNumber": 10,
  "phases": ["A", "B", "C"]
}
```
