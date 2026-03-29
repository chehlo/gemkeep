# Sprint Development Process — Diagram

```
PHASE 0: SPRINT PLANNING
  ┌─────────────────────────┐
  │ Analyze Sprint Spec     │ ← reads sprint-NN.md + sprint-plan.md
  │ + extract features      │
  │ + identify modules      │
  └───────────┬─────────────┘
              │
  ┌───────────▼─────────────┐
  │ Evaluate Spec Quality   │ ← scores 0-100 on 4 dimensions:
  │ + completeness (0-25)   │   completeness, testability,
  │ + testability (0-25)    │   architecture alignment,
  │ + arch alignment (0-25) │   implementability
  │ + implementability (25) │
  └───────────┬─────────────┘
              │
              ├── score >= 70 ──────────────┐
              │                              │
  ┌───────────▼─────────────┐               │
  │ ◆ BREAKPOINT            │ (score < 70)  │
  │   Spec Quality Review   │               │
  │   + gaps + missing      │               │
  └───────────┬─────────────┘               │
              │                              │
  ┌───────────▼─────────────┐               │
  │ Auto-Improve Spec       │ ← adds:       │
  │ + success criteria      │   - edge cases │
  │ + test layer tags       │   - arch refs  │
  │ + schema changes        │   - data model │
  └───────────┬─────────────┘               │
              │                              │
  ┌───────────▼─────────────┐               │
  │ Re-Analyze Sprint       │               │
  └───────────┬─────────────┘               │
              │◄────────────────────────────┘
  ┌───────────▼─────────────┐
  │ Scan Anti-Patterns      │ ← reads code-improvements.md
  │ + filter to touched     │   cross-references with modules
  │   modules only          │
  └───────────┬─────────────┘
              │
  ┌───────────▼─────────────┐
  │ Architecture Compliance │ ← checks sprint-plan.md invariants
  │ + per-project isolation │   - repository pattern
  │ + error handling        │   - no global state
  └───────────┬─────────────┘
              │
  ┌───────────▼─────────────┐
  │ ◆ BREAKPOINT            │ user reviews plan + quality score
  │   Sprint Plan Review    │ + anti-patterns + arch violations
  └───────────┬─────────────┘

PHASE 1: PRE-FLIGHT REFACTORING (if HIGH/BUG items in touched modules)
  ┌───────────▼─────────────┐
  │ For each HIGH/BUG item: │
  │   ┌───────────────────┐ │
  │   │ Refactor with TDD │ │ green baseline → refactor → green verify
  │   └───────────────────┘ │
  └───────────┬─────────────┘
              │
  ┌───────────▼─────────────┐
  │ Commit pre-flight       │
  │ + verify all tests pass │
  └───────────┬─────────────┘
              │
  ┌───────────▼─────────────┐
  │ ◆ BREAKPOINT            │
  │   Pre-flight Review     │
  └───────────┬─────────────┘

PHASE 2: FEATURE IMPLEMENTATION (per feature, sequential)
  ┌───────────▼──────────────────────────────────────────┐
  │ For each feature:                                     │
  │   ┌──────────────────┐                                │
  │   │ Spec Analysis    │ ← anti-pattern aware           │
  │   │ + arch warnings  │                                │
  │   └────────┬─────────┘                                │
  │   ┌────────▼─────────┐                                │
  │   │ ◆ BREAKPOINT     │ review spec + warnings         │
  │   └────────┬─────────┘                                │
  │   ┌────────▼─────────┐                                │
  │   │ Write RED Tests  │ ← REAL behavioral assertions   │
  │   │ NO assert!(false)│   NO artificial failures       │
  │   │ todo!() stubs OK │   tests MUST compile           │
  │   └────────┬─────────┘                                │
  │   ┌────────▼─────────┐                                │
  │   │ Run Tests (RED)  │ at least 1 REAL failure        │
  │   └────────┬─────────┘                                │
  │   ┌────────▼─────────┐                                │
  │   │ ◆ BREAKPOINT     │ RED review: verify R2/R3/R5    │
  │   │ Are failures     │ - real assertions? (R2)        │
  │   │ behavioral?      │ - immutable tests? (R3)        │
  │   └────────┬─────────┘ - behavioral? (R5)             │
  │   ┌────────▼─────────┐                                │
  │   │ Commit RED       │                                │
  │   └────────┬─────────┘                                │
  │   ┌────────▼─────────┐                                │
  │   │ GREEN Implement  │ ← DO NOT MODIFY TESTS          │
  │   │ + anti-pattern   │   anti-pattern checklist        │
  │   │   checklist      │   arch constraints              │
  │   └────────┬─────────┘                                │
  │   ┌────────▼─────────┐                                │
  │   │ Run Tests (GREEN)│ all must pass                  │
  │   └────────┬─────────┘                                │
  │   ┌────────▼─────────┐                                │
  │   │ Immutability     │ git diff check on test files   │
  │   │ Check            │                                │
  │   └────────┬─────────┘                                │
  │   ┌────────▼─────────┐                                │
  │   │ Post-GREEN Arch  │ ← check for introduced         │
  │   │ Check            │   anti-patterns in the diff    │
  │   └────────┬─────────┘                                │
  │   ┌────────▼─────────┐                                │
  │   │ Commit GREEN     │                                │
  │   └────────┬─────────┘                                │
  │   ┌────────▼─────────┐                                │
  │   │ ◆ BREAKPOINT     │ GREEN review + arch results    │
  │   └────────┬─────────┘                                │
  └───────────┬──────────────────────────────────────────┘

PHASE 3: SPRINT INTEGRATION
  ┌───────────▼─────────────┐
  │ Full Test Suite         │
  │ + clippy + fmt          │
  └───────────┬─────────────┘
              │
  ┌───────────▼─────────────┐
  │ Final Architecture Gate │ ← full compliance check
  │ + new anti-patterns?    │   against sprint-plan.md
  └───────────┬─────────────┘
              │
  ┌───────────▼─────────────┐
  │ ◆ BREAKPOINT            │ sprint summary + arch report
  │   Sprint Final Review   │
  └─────────────────────────┘
```

## Key Innovations vs behavioral-tdd.js

1. **Spec quality gate**: Sprint spec is scored 0-100 and auto-improved if below threshold
2. **Anti-pattern awareness**: Every agent reads `code-improvements.md` and actively avoids repeating known issues
3. **Pre-flight refactoring**: HIGH/BUG items in touched modules are fixed BEFORE new feature work
4. **Test quality enforcement**: RED tests checked for R2 (real assertions), R3 (immutability), R5 (behavioral)
5. **Post-GREEN architecture gate**: New code is checked for duplication, inline SQL, global state, etc.
6. **Architecture compliance**: Sprint-plan.md invariants are enforced as gates, not suggestions
7. **Sprint-level integration**: Final gate checks across ALL features, not just individual ones
