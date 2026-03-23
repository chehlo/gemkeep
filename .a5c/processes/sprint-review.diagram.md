# Sprint Review Process — Flow Diagram

```
┌──────────────────────────────────────────────────────────┐
│  PHASE 1: SCOPE                                          │
│  ├─ Read sprint spec                                     │
│  ├─ Git log → identify commits                           │
│  └─ Identify touched files/modules, count tests          │
└──────────────────────┬───────────────────────────────────┘
                       │
┌──────────────────────▼───────────────────────────────────┐
│  PHASE 2: SPEC QUALITY (Retrospective)                   │
│  ├─ Goal Clarity    (0-20)  Was the WHY clear?           │
│  ├─ Completeness    (0-20)  Success criteria present?    │
│  ├─ Testability     (0-20)  Can criteria be automated?   │
│  ├─ Architecture    (0-20)  References constraints?      │
│  ├─ Implementability(0-20)  Realistic scope?             │
│  └─ Spec vs Reality drift check                          │
└──────────────────────┬───────────────────────────────────┘
                       │
┌──────────────────────▼───────────────────────────────────┐
│  PHASE 3: QUALITY GATES (parallel)                       │
│  ├─ Anti-pattern scan (code-improvements.md)             │
│  ├─ Architecture compliance (sprint-plan.md)             │
│  ├─ Test coverage audit (testing-philosophy.md 20 rules) │
│  └─ Full test suite (cargo test + npm test + clippy)     │
└──────────────────────┬───────────────────────────────────┘
                       │
┌──────────────────────▼───────────────────────────────────┐
│  PHASE 4: SUCCESS CRITERIA VERIFICATION                  │
│  ├─ For each criterion: find code + find test            │
│  └─ Mark: MET / PARTIAL / UNMET                          │
└──────────────────────┬───────────────────────────────────┘
                       │
┌──────────────────────▼───────────────────────────────────┐
│  PHASE 5: ISSUE COLLECTION  ◄── BREAKPOINT               │
│  ├─ Aggregate: SPEC + ANTIPATTERN + ARCH + COVERAGE +   │
│  │             CRITERIA issues                           │
│  └─ Present findings to user                             │
└──────────────────────┬───────────────────────────────────┘
                       │
              ┌────────▼────────┐
              │ Issues found?   │
              └───┬─────────┬───┘
                  │ YES     │ NO
        ┌─────────▼───┐     │
        │  PHASE 6:   │     │
        │  FIX CYCLE  │     │
        │  (loop)     │     │
        │  ┌────────┐ │     │
        │  │Plan fix│ │     │
        │  │  (BP)  │ │     │
        │  ├────────┤ │     │
        │  │TDD fix │ │     │
        │  ├────────┤ │     │
        │  │Re-check│ │     │
        │  │  (BP)  │ │     │
        │  └───┬────┘ │     │
        │      │clean?│     │
        │      └──────┘     │
        └─────────┬─────────┘
                  │
┌─────────────────▼────────────────────────────────────────┐
│  PHASE 7: FINAL GATE  ◄── BREAKPOINT                    │
│  ├─ Full test suite                                      │
│  └─ User approval                                        │
└──────────────────────────────────────────────────────────┘
```
