/**
 * @process gemkeep/behavioral-tdd
 * @description Pure TDD engine: RED -> GREEN -> quality gate.
 *              No spec analysis — callers provide behaviors directly.
 *              Used by task.js (small features/bugfixes) and sprint-development.js (sprints).
 *
 * Inputs:
 *   feature       - Feature description or bug to fix
 *   behaviors     - Array of {trigger, expectedOutcome, testLayer} — the behavioral contract
 *   testCommand   - Test runner command (e.g., "cargo test --manifest-path src-tauri/Cargo.toml")
 *   mode          - "new" (default) or "existing" (testing already-implemented feature)
 *   phase         - "feature" (default) or "bugfix" (adds Phase 2 root-cause regression)
 *   bugDescription - (bugfix phase only) Description of the escaped bug
 *
 * Mode "existing": For adding behavioral tests to already-implemented code.
 *   - RED phase: some or all tests may pass immediately (code exists).
 *     At least SOME failures expected (otherwise tests may be trivial).
 *     All-pass is acceptable but flagged for review.
 *   - GREEN phase: skipped if all tests pass, runs only for failing tests.
 *   - Test immutability still enforced during GREEN.
 */

import { defineTask } from '@a5c-ai/babysitter-sdk';

export async function process(inputs, ctx) {
  const {
    feature,
    behaviors = [],
    impactedTests = [],  // existing tests that assert OLD behavior — must be updated during GREEN
    testCommand = 'cargo test --manifest-path src-tauri/Cargo.toml',
    mode = 'new',
    phase = 'feature',
    bugDescription = '',
  } = inputs;

  const isExisting = mode === 'existing';

  // ════════════════════════════════════════════════════════════════════════
  // PHASE 0: TEST COVERAGE COMPLIANCE — verify behaviors have correct test layers
  // ════════════════════════════════════════════════════════════════════════

  ctx.log('info', 'Phase 0: Test coverage compliance check (testing-philosophy.md)');
  const compliance = await ctx.task(testCoverageComplianceTask, {
    feature,
    behaviors,
  });
  ctx.log('info', `Compliance: ${compliance.summary}`);

  // Always present compliance results to user — this is a mandatory gate
  const violationLines = (compliance.violations || []).length > 0
    ? ['', 'VIOLATIONS (must fix):', ...compliance.violations.map((v, i) => `  ${i + 1}. ${v}`)]
    : ['', 'No violations.'];

  const missingLines = (compliance.missingTests || []).length > 0
    ? ['', 'MISSING TESTS (will be added):', ...compliance.missingTests.map((t, i) => `  ${i + 1}. [${t.testLayer}] ${t.description} — ${t.reason}`)]
    : [];

  const skippedLines = (compliance.skippedRules || []).length > 0
    ? ['', 'RULES NOT APPLICABLE (skipped with reason):', ...compliance.skippedRules.map((r, i) => `  ${i + 1}. ${r}`)]
    : [];

  await ctx.breakpoint({
    tag: 'compliance-review',
    question: [
      'TEST COVERAGE COMPLIANCE (docs/testing-philosophy.md)',
      '',
      `Feature: ${feature}`,
      `Behaviors reviewed: ${(behaviors || []).length}`,
      `Enriched to: ${(compliance.enrichedBehaviors || []).length} (with corrected layers + additions)`,
      ...violationLines,
      ...missingLines,
      ...skippedLines,
      '',
      compliance.summary,
      '',
      'Approve to proceed to RED tests with the enriched behavioral contract.',
    ].join('\n'),
    title: 'Test Coverage Compliance',
  });

  // Merge compliance requirements into behaviors for the test writer
  const enrichedBehaviors = compliance.enrichedBehaviors || behaviors;

  // ════════════════════════════════════════════════════════════════════════
  // PHASE 1: RED — write and verify failing tests
  // ════════════════════════════════════════════════════════════════════════

  // Step 1: Write behavioral tests (RED)
  ctx.log('info', 'Phase 1.1: Write black-box behavioral tests (RED)');
  const redTests = await ctx.task(writeBlackBoxTestsTask, {
    feature,
    behaviors: enrichedBehaviors,
    testCommand,
  });
  ctx.log('info', `RED tests written: ${redTests.summary}`);

  // Step 2: Validate test environment matches test names (Rules 14/17/18/20)
  ctx.log('info', 'Phase 1.2: Validate test environment vs test names');
  const envCheck = await ctx.task(validateTestEnvironmentTask, {
    testFiles: redTests.testFiles || [],
  });
  ctx.log('info', `Environment check: ${envCheck.summary}`);

  // Step 3: Run tests — check RED status
  ctx.log('info', `Phase 1.3: Run tests — ${isExisting ? 'check RED status (existing code)' : 'verify RED failures'}`);
  const redRun = await ctx.task(runTestsTask, {
    testCommand,
    expectExit: isExisting ? 'any' : 'nonzero',
    phase: 'RED',
    isExisting,
  });
  ctx.log('info', `RED run: ${redRun.summary}`);

  // Step 4: Breakpoint — show user the RED tests before committing
  const allTestsPass = redRun.exitCode === 0 && redRun.failCount === 0;
  const envWarning = envCheck.violations && envCheck.violations.length > 0
    ? [
        '',
        'WARNING — ENVIRONMENT MISMATCHES (Rules 14/17/18):',
        ...envCheck.violations.map((v, i) => `  ${i + 1}. ${v}`),
        '',
        'These tests claim visual outcomes but run in jsdom (no layout engine).',
        'Options: move to .browser.test.ts, or rename to describe what they actually check.',
      ]
    : ['', 'All test names match their environment (Rules 14/17/18 OK)'];

  await ctx.breakpoint({
    tag: 'red-review',
    question: [
      isExisting
        ? (allTestsPass
            ? 'RED tests written — ALL PASS (existing implementation covers them).'
            : `RED tests written — some pass, some fail (existing code partially covers them).`)
        : 'RED tests written and verified failing.',
      '',
      `Test files: ${redTests.testFiles || 'see agent output'}`,
      `Pass: ${redRun.passCount || '?'} | Fail: ${redRun.failCount || '?'}`,
      ...envWarning,
      '',
      'Review the tests. They must:',
      '- Test BEHAVIOR, not root cause (R5)',
      '- Use real assertions against production code, not assert!(false) (R2)',
      '- Be the exact tests that will pass after GREEN — no modifications allowed (R3)',
      '- Visual assertions (border, color, opacity, ring) must use browser tests (R14/R18)',
      '- Browser tests must assert computed styles, not class names (R18)',
      '',
      allTestsPass && isExisting
        ? 'All tests pass — GREEN phase will be skipped. Approve to commit tests.'
        : 'Approve to commit RED and proceed to GREEN.',
    ].join('\n'),
    title: 'RED Test Review',
  });

  // Step 5: Commit RED tests
  ctx.log('info', 'Phase 1.4: Commit RED tests');
  const redCommit = await ctx.task(commitTask, {
    message: `test(RED): ${feature}`,
    phase: 'RED',
  });
  ctx.log('info', `RED committed: ${redCommit.summary}`);

  // ════════════════════════════════════════════════════════════════════════
  // PHASE 2: GREEN — implement production code
  // ════════════════════════════════════════════════════════════════════════

  let greenCommit = null;
  if (allTestsPass && isExisting) {
    ctx.log('info', 'Phase 2: GREEN skipped — all tests pass against existing code');
  } else {
    // Step 6: Implement (GREEN) — production code + update impacted old tests
    ctx.log('info', 'Phase 2.1: GREEN — implement production code');
    const greenImpl = await ctx.task(greenImplementTask, {
      feature,
      behaviors,
      impactedTests,
      redTests,
      testCommand,
    });
    ctx.log('info', `GREEN implementation: ${greenImpl.summary}`);

    // Step 7: Run tests — verify they pass
    ctx.log('info', 'Phase 2.2: Run tests — verify GREEN');
    const greenRun = await ctx.task(runTestsTask, {
      testCommand,
      expectExit: 'zero',
      phase: 'GREEN',
    });
    ctx.log('info', `GREEN run: ${greenRun.summary}`);

    // Step 8: AUTOMATED ENFORCEMENT — git diff check on test files
    ctx.log('info', 'Phase 2.3: Verify test immutability (git diff check)');
    const diffCheck = await ctx.task(testImmutabilityCheckTask, {
      redCommitRef: redCommit.commitHash || 'HEAD~1',
    });
    ctx.log('info', `Immutability check: ${diffCheck.summary}`);

    // Step 8b: STALE TEST DETECTION — find old tests that contradict new behaviors
    ctx.log('info', 'Phase 2.4: Stale test detection');
    const staleCheck = await ctx.task(staleTestDetectionTask, {
      behaviors,
      impactedTests,
      feature,
    });
    ctx.log('info', `Stale test check: ${staleCheck.summary}`);

    if (staleCheck.staleTests && staleCheck.staleTests.length > 0) {
      await ctx.breakpoint({
        tag: 'stale-tests',
        question: [
          'STALE TESTS DETECTED — old tests that may assert REMOVED behavior:',
          '',
          ...staleCheck.staleTests.map((t, i) => `  ${i + 1}. ${t.file}: "${t.testName}" — ${t.reason}`),
          '',
          'These tests pass but may be testing behavior that was just changed.',
          'Review and delete/update them, or approve if they are still valid.',
        ].join('\n'),
        title: 'Stale Test Warning',
      });
    }

    // Step 9: Commit GREEN
    ctx.log('info', 'Phase 2.4: Commit GREEN');
    greenCommit = await ctx.task(commitTask, {
      message: `feat: ${feature}`,
      phase: 'GREEN',
    });
    ctx.log('info', `GREEN committed: ${greenCommit.summary}`);

    // Step 10: GREEN review breakpoint
    await ctx.breakpoint({
      tag: 'green-review',
      question: [
        'GREEN phase complete.',
        '',
        `Implementation: ${greenImpl.summary}`,
        `Tests: ${greenRun.summary}`,
        `Test immutability: ${diffCheck.summary}`,
        '',
        phase === 'bugfix'
          ? 'Approve to proceed to Phase 3 (root-cause regression test).'
          : 'Approve to finalize.',
      ].join('\n'),
      title: 'GREEN Review',
    });
  }

  // ════════════════════════════════════════════════════════════════════════
  // PHASE 3: ROOT-CAUSE REGRESSION (only for bugfix phase)
  // ════════════════════════════════════════════════════════════════════════

  if (phase === 'bugfix' && bugDescription) {
    ctx.log('info', 'Phase 3: Root-cause regression test for escaped bug');

    // Step 3.1: Investigate root cause
    const rootCause = await ctx.task(investigateRootCauseTask, {
      bugDescription,
      feature,
    });
    ctx.log('info', `Root cause: ${rootCause.summary}`);

    // Step 3.2: Write targeted regression test
    const regressionTest = await ctx.task(writeRegressionTestTask, {
      bugDescription,
      rootCause,
      testCommand,
    });
    ctx.log('info', `Regression test: ${regressionTest.summary}`);

    // Step 3.3: Verify regression test passes (bug is already fixed by GREEN)
    const regressionRun = await ctx.task(runTestsTask, {
      testCommand,
      expectExit: 'zero',
      phase: 'REGRESSION',
    });
    ctx.log('info', `Regression run: ${regressionRun.summary}`);

    // Step 3.4: Commit regression test
    const regressionCommit = await ctx.task(commitTask, {
      message: `test: regression test for ${bugDescription}`,
      phase: 'REGRESSION',
    });
    ctx.log('info', `Regression committed: ${regressionCommit.summary}`);
  }

  // ════════════════════════════════════════════════════════════════════════
  // FINAL QUALITY GATE
  // ════════════════════════════════════════════════════════════════════════

  ctx.log('info', 'Final quality gate: full test suite + clippy');
  const finalGate = await ctx.task(finalQualityGateTask, { testCommand });
  ctx.log('info', `Final gate: ${finalGate.summary}`);

  await ctx.breakpoint({
    tag: 'final-review',
    question: [
      `TDD complete for: ${feature}`,
      '',
      `Phase: ${phase}`,
      `Final gate: ${finalGate.summary}`,
      '',
      'Approve to finalize.',
    ].join('\n'),
    title: 'Final Review',
  });

  return {
    success: true,
    feature,
    phase,
    mode,
    redCommit: redCommit.commitHash,
    greenCommit: greenCommit?.commitHash || null,
  };
}

// ════════════════════════════════════════════════════════════════════════════
// TASK DEFINITIONS — exported for reuse by task.js and sprint-development.js
// ════════════════════════════════════════════════════════════════════════════

export const testCoverageComplianceTask = defineTask('test-coverage-compliance', (args, taskCtx) => ({
  kind: 'agent',
  title: 'Test coverage compliance check (testing-philosophy.md)',
  agent: {
    name: 'general-purpose',
    prompt: {
      role: 'Test architect enforcing GemKeep testing philosophy',
      task: [
        'Read docs/testing-philosophy.md IN FULL — all sections, all 20 rules, the testing pyramid,',
        'the integration seam testing section, and the pre-sprint-done checklist.',
        '',
        'Then review the proposed behavioral contract for this feature.',
        'For each behavior, determine which rules from the document are RELEVANT',
        'and check whether the assigned test layer and approach comply.',
        '',
        'Do NOT apply a fixed checklist — read the document and use your judgment',
        'about which rules matter for THIS specific feature and THESE specific behaviors.',
        '',
        'For each behavior:',
        '1. List which rules from testing-philosophy.md are relevant',
        '2. Check if the assigned testLayer is correct for those rules',
        '3. Check if the test approach would actually catch the bug it claims to test',
        '4. Flag if a mock-only test is proposed where a real integration test is needed',
        '',
        'Also check for MISSING coverage:',
        '- Are there behaviors that SHOULD be tested but are not in the list?',
        '- Does the feature need tests at layers not represented?',
        '- Would these tests actually catch real bugs, or just verify mocks?',
        '',
        'For rules you reviewed and determined NOT APPLICABLE to this feature,',
        'list them in skippedRules with a brief reason WHY they do not apply.',
        'This gives the user visibility into what was considered and dismissed.',
        '',
        'Return enrichedBehaviors: same array but with corrected testLayer values',
        'and any additional behaviors/tests needed for proper coverage.',
      ].join('\n'),
      context: {
        feature: args.feature,
        behaviors: args.behaviors,
      },
      instructions: [
        'Read docs/testing-philosophy.md — the ENTIRE document, not just the rules section',
        'Read the testing pyramid (Section 3) to understand layer responsibilities',
        'Read the integration seam testing section carefully',
        'Read the pre-sprint-done checklist (Section 9) for coverage expectations',
        'For each behavior, identify relevant rules and check compliance',
        'Use judgment — not every rule applies to every behavior',
        'Return enrichedBehaviors with corrected layers + additional tests',
      ],
      outputFormat: 'JSON with violations (array of strings — rule violated + why), enrichedBehaviors (array of behaviors with corrected testLayer), missingTests (array of {description, testLayer, reason}), skippedRules (array of strings — "Rule N: not applicable because..."), summary (string)',
    },
    outputSchema: {
      type: 'object',
      required: ['enrichedBehaviors', 'summary'],
      properties: {
        violations: { type: 'array', items: { type: 'string' } },
        enrichedBehaviors: { type: 'array' },
        missingTests: { type: 'array' },
        skippedRules: { type: 'array', items: { type: 'string' } },
        summary: { type: 'string' },
      },
    },
  },
  io: {
    inputJsonPath: `tasks/${taskCtx.effectId}/input.json`,
    outputJsonPath: `tasks/${taskCtx.effectId}/result.json`,
  },
}));

export const writeBlackBoxTestsTask = defineTask('write-blackbox-tests', (args, taskCtx) => ({
  kind: 'agent',
  title: `Write black-box behavioral tests for: ${args.feature}`,
  agent: {
    name: 'general-purpose',
    prompt: {
      role: 'Test developer following strict behavioral TDD',
      task: [
        'Write tests for the specified behaviors. These are black-box tests.',
        '',
        'CRITICAL RULES (from docs/testing-rules.md):',
        '',
        'R2: Every test must call REAL production code and assert on REAL output.',
        '    NEVER use assert!(false), panic!("RED"), or any artificial failure.',
        '    The test must fail because the BEHAVIOR is wrong, not because you forced it.',
        '',
        'R3: These tests are IMMUTABLE. Once written, they will NOT be changed.',
        '    The exact same test that fails now must pass after production code is fixed.',
        '    Write them carefully — you get one shot.',
        '',
        'R5: Test BEHAVIOR, not root cause.',
        '    GOOD: "thumbnail counter == 0 after reindex" (catches all causes)',
        '    BAD:  "cache directory not deleted" (catches only one cause)',
        '',
        'R6: Test actual output — read back produced artifacts, query DB, check return values.',
        '',
        'STUBS RULE: Tests MUST compile. If the tests reference types, structs, enums,',
        '    or methods that do not exist yet, add STUB definitions (with todo!() bodies)',
        '    so that the code compiles but tests fail at RUNTIME, not at compile time.',
        '    Compile errors are NOT a valid RED state — runtime failures (panics, assertion',
        '    failures, todo!() panics) ARE valid RED states. The stubs become the API',
        '    contract that GREEN phase must implement.',
        '',
        'R14/R18: VISUAL ASSERTIONS REQUIRE BROWSER, NOT JSDOM.',
        '    If a test name mentions a visual outcome (border, color, ring, opacity,',
        '    dim, badge color, green/red/blue, visible indicator), it MUST go in a',
        '    .browser.test.ts file (vitest-browser-svelte with real Chromium).',
        '    jsdom has NO layout engine — it cannot verify computed styles, positioning,',
        '    or Tailwind class compilation.',
        '',
        '    ALLOWED in jsdom (.test.ts):',
        '    - DOM presence (element exists, text content, attribute values)',
        '    - Class toggling logic (class added/removed in response to props)',
        '    - IPC call verification (invoke was called with correct args)',
        '    - Navigation state changes',
        '',
        '    MUST use browser (.browser.test.ts):',
        '    - Any test whose name mentions: border, color, ring, opacity, dim, badge,',
        '      green, red, blue, yellow, visible, indicator, spinner, animation',
        '    - Use getComputedStyle() or style-agnostic helpers (assertVisuallyKept, etc.)',
        '    - NEVER use className.contains() in browser tests (Rule 18)',
        '',
        'R17: Visual assertion helpers must be style-agnostic.',
        '    Use existing helpers from src/test/decision-visual-helpers.ts:',
        '    assertVisuallyKept(), assertVisuallyEliminated(), assertVisuallyDimmed(),',
        '    assertVisuallyUndecided(), assertNotDimmed()',
        '',
        'TEST NAME HONESTY:',
        '    The test name MUST accurately describe what the test actually verifies.',
        '    If a jsdom test checks classList, name it "keep status applies decision-keep class"',
        '    NOT "shows green border for keep status". The name is a promise to the reader.',
        '',
        'LAYERED OBSERVABILITY:',
        '- Rust unit tests: call functions, assert return values and struct fields',
        '- Rust integration: call pipeline/IPC, assert DB state, file state, counters',
        '- Frontend jsdom: simulate user actions, assert DOM presence and IPC calls',
        '- Frontend browser: simulate user actions, assert computed styles and visual outcomes',
        '- E2E: simulate full user journeys, assert visible UI state',
        '',
        'Each test should be a black-box test at its layer boundary.',
        'Do not inspect internal state that is not observable at your layer.',
        '',
        'TEST INFRASTRUCTURE RULE:',
        'All tests that work with photos MUST use TestProject/TestLibraryBuilder',
        '(from crate::import::test_fixtures) instead of raw Connection::open_in_memory().',
        'TestLibraryBuilder::new().add_photo(PhotoSpec { camera, orientation, file_type }).build()',
        'creates a TestProject with conn, project_id, and real photo files on disk.',
        'Use project.conn for DB access, project.project_id for scoping.',
        'Only exception: pure DB-operation tests (like merge/split) that dont involve',
        'photo files may use existing helpers like setup_merge_test_db.',
        '',
        'DUPLICATION PREVENTION:',
        'Check if similar test helpers already exist before creating new ones.',
        'Reuse existing test infrastructure.',
      ].join('\n'),
      context: {
        feature: args.feature,
        behaviors: args.behaviors || [],
        testCommand: args.testCommand,
      },
      instructions: [
        'Read docs/testing-philosophy.md FIRST — understand ALL 20 rules and the testing pyramid',
        'Each behavior has a testLayer — RESPECT IT. Do NOT write jsdom tests for browser-layer behaviors.',
        'If testLayer is "rust-integration", write a test that calls REAL backend functions (not mocks)',
        'If testLayer is "frontend-browser", write in a .browser.test.ts file using vitest-browser-svelte',
        'If testLayer is "frontend-jsdom", jsdom is OK but only for non-visual assertions (IPC calls, DOM presence)',
        'Read the relevant source files to understand the current API/function signatures',
        'Write tests that call existing (or expected) public APIs',
        'Each test asserts one behavior from the provided behaviors list',
        'Use real production code paths — no mocks of the system under test',
        'If tests reference types/methods that do not exist yet, ADD STUB definitions with todo!() bodies',
        'Verify compilation passes: cargo test --manifest-path src-tauri/Cargo.toml --no-run',
        'Run the tests to verify they FAIL at RUNTIME with todo!() panics or assertion failures',
        'Report which test files were created/modified and the failure messages',
      ],
      outputFormat: 'JSON with testFiles (array of file paths), failureMessages (array), allFailuresAreBehavioral (boolean), summary (string)',
    },
    outputSchema: {
      type: 'object',
      required: ['testFiles', 'summary'],
      properties: {
        testFiles: { type: 'array', items: { type: 'string' } },
        failureMessages: { type: 'array', items: { type: 'string' } },
        allFailuresAreBehavioral: { type: 'boolean' },
        summary: { type: 'string' },
      },
    },
  },
  io: {
    inputJsonPath: `tasks/${taskCtx.effectId}/input.json`,
    outputJsonPath: `tasks/${taskCtx.effectId}/result.json`,
  },
}));

export const runTestsTask = defineTask('run-tests', (args, taskCtx) => ({
  kind: 'agent',
  title: `Run tests (${args.phase})`,
  agent: {
    name: 'general-purpose',
    prompt: {
      role: 'Test runner',
      task: [
        `Run the test suite and report results. Phase: ${args.phase}.`,
        `Expected exit: ${args.expectExit}.`,
        args.isExisting ? `Mode: EXISTING — testing already-implemented code.` : '',
        '',
        args.expectExit === 'any'
          ? [
            'Mode is "existing" — code is already implemented.',
            'Some or all tests may pass immediately. This is EXPECTED.',
            'Report exactly which new tests pass and which fail.',
            'If ALL pass: flag for review but this is acceptable.',
            'If SOME fail: these need GREEN implementation.',
          ].join('\n  ')
          : [
            `If expectExit is "nonzero" and all tests pass, this is a PROBLEM:`,
            '  The RED phase requires at least one test to fail.',
            '  If all tests pass, either the feature is already implemented',
            '  or the tests are not testing the right thing.',
            '  Report this clearly.',
          ].join('\n'),
        '',
        'If expectExit is "zero" and tests fail, report the failures.',
      ].filter(Boolean).join('\n'),
      context: {
        testCommand: args.testCommand,
        phase: args.phase,
        expectExit: args.expectExit,
      },
      instructions: [
        `Run: ${args.testCommand}`,
        'Capture exit code, pass/fail counts, and failure messages',
        'Also run clippy: cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings',
        `Verify exit code matches expectation: ${args.expectExit}`,
        'Report results',
      ],
      outputFormat: 'JSON with exitCode (number), passCount (number), failCount (number), failureMessages (array), clippyClean (boolean), summary (string)',
    },
    outputSchema: {
      type: 'object',
      required: ['exitCode', 'summary'],
      properties: {
        exitCode: { type: 'number' },
        passCount: { type: 'number' },
        failCount: { type: 'number' },
        failureMessages: { type: 'array', items: { type: 'string' } },
        clippyClean: { type: 'boolean' },
        summary: { type: 'string' },
      },
    },
  },
  io: {
    inputJsonPath: `tasks/${taskCtx.effectId}/input.json`,
    outputJsonPath: `tasks/${taskCtx.effectId}/result.json`,
  },
}));

export const commitTask = defineTask('git-commit', (args, taskCtx) => ({
  kind: 'agent',
  title: `Commit: ${args.phase}`,
  agent: {
    name: 'general-purpose',
    prompt: {
      role: 'Git operator',
      task: [
        `Create a git commit for the ${args.phase} phase.`,
        '',
        'Stage only the relevant files (test files for RED, production files for GREEN).',
        'Use the provided commit message.',
        'Return the commit hash.',
      ].join('\n'),
      context: {
        message: args.message,
        phase: args.phase,
      },
      instructions: [
        'Run git status to see changed files',
        `Stage appropriate files for ${args.phase} phase`,
        `Commit with message: "${args.message}"`,
        'Return the commit hash from git log -1 --format=%H',
      ],
      outputFormat: 'JSON with commitHash (string), filesCommitted (array), summary (string)',
    },
    outputSchema: {
      type: 'object',
      required: ['commitHash', 'summary'],
      properties: {
        commitHash: { type: 'string' },
        filesCommitted: { type: 'array', items: { type: 'string' } },
        summary: { type: 'string' },
      },
    },
  },
  io: {
    inputJsonPath: `tasks/${taskCtx.effectId}/input.json`,
    outputJsonPath: `tasks/${taskCtx.effectId}/result.json`,
  },
}));

export const greenImplementTask = defineTask('green-implement', (args, taskCtx) => ({
  kind: 'agent',
  title: `GREEN: Implement ${args.feature}`,
  agent: {
    name: 'general-purpose',
    prompt: {
      role: 'Production code developer following strict TDD GREEN rules',
      task: [
        `Implement the minimum production code to make all RED tests pass.`,
        '',
        'CRITICAL RULES:',
        '',
        '1. DO NOT MODIFY ANY TEST FILE. Test files are immutable after RED commit.',
        '   If a test seems wrong, STOP and report it — do not fix the test.',
        '',
        '2. Write the MINIMUM code to make tests pass. No gold plating.',
        '',
        '3. Read docs/testing-rules.md — understand why test immutability matters.',
        '',
        '4. After implementing, run the test command to verify all tests pass.',
        '',
        '5. Run cargo clippy and cargo fmt.',
        '',
        '6. If implementing frontend code that needs visual verification,',
        '   remember: browser tests assert computed styles (getComputedStyle),',
        '   NOT class names (Rule 18). Use style-agnostic helpers from',
        '   src/test/decision-visual-helpers.ts when available (Rule 17).',
        '',
        'If you cannot make a test pass without modifying it, report exactly why',
        'and what the test expects vs what you can provide. The user will decide.',
      ].join('\n'),
      context: {
        feature: args.feature,
        behaviors: args.behaviors || [],
        impactedTests: args.impactedTests || [],
        testFiles: args.redTests?.testFiles || [],
        testCommand: args.testCommand,
      },
      instructions: [
        'Read docs/testing-rules.md',
        'Read the RED test files to understand what they expect',
        'Read relevant production code',
        'Implement the minimum changes to make tests pass',
        'DO NOT touch RED test files (newly written in this cycle)',
        'BUT DO delete/update IMPACTED OLD TESTS listed in impactedTests — these assert OLD behavior that is being changed',
        'If impactedTests lists tests that will fail after your changes, delete or update them',
        `Run: ${args.testCommand}`,
        'Run: cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings',
        'Run: cargo fmt --manifest-path src-tauri/Cargo.toml',
        'Report what files were changed and what old tests were deleted/updated',
      ],
      outputFormat: 'JSON with filesModified (array), testsPass (boolean), summary (string)',
    },
    outputSchema: {
      type: 'object',
      required: ['filesModified', 'testsPass', 'summary'],
      properties: {
        filesModified: { type: 'array', items: { type: 'string' } },
        testsPass: { type: 'boolean' },
        summary: { type: 'string' },
      },
    },
  },
  io: {
    inputJsonPath: `tasks/${taskCtx.effectId}/input.json`,
    outputJsonPath: `tasks/${taskCtx.effectId}/result.json`,
  },
}));

export const testImmutabilityCheckTask = defineTask('test-immutability-check', (args, taskCtx) => ({
  kind: 'agent',
  title: 'Verify test files unchanged since RED commit',
  agent: {
    name: 'general-purpose',
    prompt: {
      role: 'Git auditor enforcing test immutability (Rule R3)',
      task: [
        'Check that NO test files were modified between the RED commit and now.',
        '',
        'Run: git diff <RED_COMMIT> HEAD -- "**/*test*" "**/*spec*" "**/*_tests*"',
        '',
        'If any test file shows changes:',
        '  - This is a VIOLATION of Rule R3 (RED tests are immutable)',
        '  - Report exactly which files changed and what changed',
        '  - Set passed=false',
        '',
        'If no test files changed: set passed=true',
      ].join('\n'),
      context: {
        redCommitRef: args.redCommitRef,
      },
      instructions: [
        `Run: git diff ${args.redCommitRef} HEAD -- "**/*test*" "**/*spec*" "**/*_tests*"`,
        'Parse the diff output',
        'Report any test file modifications',
        'If modifications found, this is a failure — tests were changed during GREEN',
      ],
      outputFormat: 'JSON with passed (boolean), modifiedTestFiles (array), diffSummary (string), summary (string)',
    },
    outputSchema: {
      type: 'object',
      required: ['passed', 'summary'],
      properties: {
        passed: { type: 'boolean' },
        modifiedTestFiles: { type: 'array', items: { type: 'string' } },
        diffSummary: { type: 'string' },
        summary: { type: 'string' },
      },
    },
  },
  io: {
    inputJsonPath: `tasks/${taskCtx.effectId}/input.json`,
    outputJsonPath: `tasks/${taskCtx.effectId}/result.json`,
  },
}));

export const staleTestDetectionTask = defineTask('stale-test-detection', (args, taskCtx) => ({
  kind: 'agent',
  title: 'Detect stale tests that contradict new behaviors',
  agent: {
    name: 'general-purpose',
    prompt: {
      role: 'Test auditor searching for stale tests after behavior changes',
      task: [
        'Search for existing tests that may assert REMOVED or CHANGED behavior.',
        '',
        'NEW BEHAVIORS (just implemented):',
        ...(args.behaviors || []).map((b, i) => `  ${i + 1}. ${b.trigger} -> ${b.expectedOutcome}`),
        '',
        'KNOWN IMPACTED TESTS (from analysis phase):',
        ...(args.impactedTests || []).map(t => `  - ${t.file}: "${t.testName}" — ${t.reason}`),
        '',
        'YOUR JOB:',
        '1. Check if the known impacted tests were actually deleted/updated during GREEN',
        '2. Search for OTHER tests that might assert the OLD behavior but were NOT listed',
        '   - Grep test files for keywords from the old behavior',
        '   - Look for tests that pass but test something that was just changed',
        '3. A test that passes by COINCIDENCE (mock data matches both old and new behavior)',
        '   is the most dangerous — it gives false confidence',
        '',
        'Return staleTests array with any tests that should be reviewed.',
      ].join('\n'),
      context: {
        feature: args.feature,
        behaviors: args.behaviors || [],
        impactedTests: args.impactedTests || [],
      },
      instructions: [
        'Check if impacted tests from analysis were handled (deleted/updated)',
        'Search test files for keywords related to the changed behavior',
        'Look for tests asserting the OPPOSITE of the new behaviors',
        'Return any suspicious tests for review',
      ],
      outputFormat: 'JSON with staleTests (array of {file, testName, reason}), summary (string)',
    },
    outputSchema: {
      type: 'object',
      required: ['staleTests', 'summary'],
      properties: {
        staleTests: { type: 'array' },
        summary: { type: 'string' },
      },
    },
  },
  io: {
    inputJsonPath: `tasks/${taskCtx.effectId}/input.json`,
    outputJsonPath: `tasks/${taskCtx.effectId}/result.json`,
  },
}));

export const validateTestEnvironmentTask = defineTask('validate-test-environment', (args, taskCtx) => ({
  kind: 'agent',
  title: 'Validate test names match assertions (Rules 14/17/18/20)',
  agent: {
    name: 'general-purpose',
    prompt: {
      role: 'Test honesty auditor enforcing Rules 14, 17, 18, and 20',
      task: [
        'Check that every new or modified test FULLY verifies EVERYTHING its name promises.',
        'Check ALL FOUR categories of mismatch — not just visual ones.',
        '',
        'CATEGORY A: Visual claims in wrong environment (Rules 14/18)',
        'If a test name mentions a visual outcome (border, color, ring, opacity,',
        'dim, visible indicator), it MUST be in a .browser.test.ts file.',
        'jsdom tests may only check class names — and the name must say "class".',
        '',
        'CATEGORY B: Name promises data/payload, assertion only checks action',
        'If name says "navigates to X WITH correct Y" — code must assert Y, not just kind.',
        'If name says "with selected photos" — code must verify which photos were passed.',
        'If name says "for the focused photo" — code must verify WHICH photo.',
        '',
        'CATEGORY C: Name promises "X and Y", assertion only checks one part',
        'If name says "eliminates AND auto-fills" — both must be asserted.',
        'If name says "shows stack name AND round number" — both must be checked.',
        '',
        'CATEGORY D: Name promises scope, test is too narrow',
        'If name says "shows error" — must assert error element or text exists.',
        'If name says "each card" — must check all cards, not just one.',
        '',
        'For each test file provided:',
        '1. Read the file',
        '2. For each it()/test() block, parse the name for promises',
        '3. Read the assertion code to check if EVERY promise is verified',
        '4. Flag any gap as a violation with the category (A/B/C/D)',
        '',
        'Return violations as an array of human-readable strings.',
      ].join('\n'),
      context: {
        testFiles: args.testFiles,
      },
      instructions: [
        'Read each test file listed in testFiles',
        'Read docs/testing-philosophy.md Rules 14, 17, 18, 20 for full context',
        'For each test: parse the name, read the assertions, check all 4 categories',
        'Return violations list with category labels and summary',
        'If no test files are provided or none are frontend test files, return empty violations',
      ],
      outputFormat: 'JSON with violations (array of strings), checkedFiles (number), summary (string)',
    },
    outputSchema: {
      type: 'object',
      required: ['violations', 'summary'],
      properties: {
        violations: { type: 'array', items: { type: 'string' } },
        checkedFiles: { type: 'number' },
        summary: { type: 'string' },
      },
    },
  },
  io: {
    inputJsonPath: `tasks/${taskCtx.effectId}/input.json`,
    outputJsonPath: `tasks/${taskCtx.effectId}/result.json`,
  },
}));

export const investigateRootCauseTask = defineTask('investigate-root-cause', (args, taskCtx) => ({
  kind: 'agent',
  title: `Investigate root cause: ${args.bugDescription}`,
  agent: {
    name: 'general-purpose',
    prompt: {
      role: 'Root cause analyst (Phase 2 only — after behavior tests already pass)',
      task: [
        'Investigate the root cause of an escaped bug.',
        'This is Phase 2 — the behavioral tests from Phase 1 already pass,',
        'but this specific bug was found during manual testing or user report.',
        '',
        'Your job: identify WHY the bug escaped Phase 1 tests and write a',
        'targeted regression test for this specific root cause.',
      ].join('\n'),
      context: {
        bugDescription: args.bugDescription,
        feature: args.feature,
      },
      instructions: [
        'Read relevant source code',
        'Identify the exact root cause',
        'Explain why Phase 1 behavioral tests did not catch it',
        'Describe the targeted test that would prevent this regression',
      ],
      outputFormat: 'JSON with rootCause (string), whyEscaped (string), testDescription (string), summary (string)',
    },
    outputSchema: {
      type: 'object',
      required: ['rootCause', 'summary'],
      properties: {
        rootCause: { type: 'string' },
        whyEscaped: { type: 'string' },
        testDescription: { type: 'string' },
        summary: { type: 'string' },
      },
    },
  },
  io: {
    inputJsonPath: `tasks/${taskCtx.effectId}/input.json`,
    outputJsonPath: `tasks/${taskCtx.effectId}/result.json`,
  },
}));

export const writeRegressionTestTask = defineTask('write-regression-test', (args, taskCtx) => ({
  kind: 'agent',
  title: `Regression test: ${args.bugDescription}`,
  agent: {
    name: 'general-purpose',
    prompt: {
      role: 'Regression test developer (Phase 2)',
      task: [
        'Write a targeted regression test for a known root cause.',
        'Unlike Phase 1 tests, this test IS allowed to target a specific mechanism',
        'because we KNOW the bug and want to prevent THIS regression.',
        '',
        'The test must pass (the bug is already fixed by Phase 1 GREEN).',
      ].join('\n'),
      context: {
        bugDescription: args.bugDescription,
        rootCause: args.rootCause,
        testCommand: args.testCommand,
      },
      instructions: [
        'Read docs/testing-rules.md',
        'Write the regression test targeting the specific root cause',
        `Run: ${args.testCommand} to verify it passes`,
        'Report results',
      ],
      outputFormat: 'JSON with testFile (string), testName (string), summary (string)',
    },
    outputSchema: {
      type: 'object',
      required: ['summary'],
      properties: {
        testFile: { type: 'string' },
        testName: { type: 'string' },
        summary: { type: 'string' },
      },
    },
  },
  io: {
    inputJsonPath: `tasks/${taskCtx.effectId}/input.json`,
    outputJsonPath: `tasks/${taskCtx.effectId}/result.json`,
  },
}));

export const finalQualityGateTask = defineTask('final-quality-gate', (args, taskCtx) => ({
  kind: 'agent',
  title: 'Final quality gate',
  agent: {
    name: 'general-purpose',
    prompt: {
      role: 'Quality gate enforcer',
      task: 'Run the full test suite, clippy, and fmt check. Report pass/fail.',
      context: { testCommand: args.testCommand },
      instructions: [
        `Run: ${args.testCommand}`,
        'Run: cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings',
        'Run: cargo fmt --manifest-path src-tauri/Cargo.toml --check',
        'Report all results with exit codes',
      ],
      outputFormat: 'JSON with testsPass (boolean), clippyClean (boolean), fmtClean (boolean), testCount (number), summary (string)',
    },
    outputSchema: {
      type: 'object',
      required: ['testsPass', 'summary'],
      properties: {
        testsPass: { type: 'boolean' },
        clippyClean: { type: 'boolean' },
        fmtClean: { type: 'boolean' },
        testCount: { type: 'number' },
        summary: { type: 'string' },
      },
    },
  },
  io: {
    inputJsonPath: `tasks/${taskCtx.effectId}/input.json`,
    outputJsonPath: `tasks/${taskCtx.effectId}/result.json`,
  },
}));
