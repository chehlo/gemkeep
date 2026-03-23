# Sprint Review Process — Flow Diagram

```
┌──────────────────────────────────────────────────────────┐
│  STEP 0: SCOPE                                           │
│  ├─ Git log → commits, touched files/modules             │
│  └─ Count new/modified tests                             │
└──────────────────────┬───────────────────────────────────┘
                       │
┌──────────────────────▼───────────────────────────────────┐
│  STEP 1: REQUIREMENTS REVIEW                             │
│  ├─ Spec quality scoring (5 × 20 = 100)                 │
│  ├─ ◄── BREAKPOINT: present gaps, get user changes       │
│  ├─ Apply spec fixes → commit                            │
│  └─ ◄── BREAKPOINT: confirm changes                     │
│                                                          │
│  ⚠ Must complete before Step 2                           │
│    (spec changes affect what code should exist)          │
└──────────────────────┬───────────────────────────────────┘
                       │
┌──────────────────────▼───────────────────────────────────┐
│  STEP 2: ARCHITECTURE REVIEW                             │
│  ├─ Anti-pattern scan (code-improvements.md)             │
│  ├─ Architecture compliance (sprint-plan.md)             │
│  ├─ ◄── BREAKPOINT: present issues, get fix guidance     │
│  ├─ TDD fix cycle → commit                               │
│  └─ ◄── BREAKPOINT: confirm fixes                       │
│                                                          │
│  ⚠ Must complete before Step 3                           │
│    (architecture fixes change what tests should verify)  │
└──────────────────────┬───────────────────────────────────┘
                       │
┌──────────────────────▼───────────────────────────────────┐
│  STEP 3: TEST REVIEW                                     │
│  ├─ Full test suite baseline                             │
│  ├─ Coverage audit (testing-philosophy.md)               │
│  ├─ Success criteria verification (MET/PARTIAL/UNMET)    │
│  ├─ ◄── BREAKPOINT: present gaps, get fix guidance       │
│  ├─ TDD fix cycle → commit                               │
│  └─ ◄── BREAKPOINT: confirm fixes                       │
└──────────────────────┬───────────────────────────────────┘
                       │
┌──────────────────────▼───────────────────────────────────┐
│  STEP 4: FINAL GATE  ◄── BREAKPOINT                     │
│  ├─ Full test suite                                      │
│  └─ User approval                                        │
└──────────────────────────────────────────────────────────┘
```
