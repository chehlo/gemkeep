/**
 * @process gemkeep/sprint-review
 * @description Retrospective review process for already-committed sprint work.
 *              Assesses spec quality (including goal clarity), test coverage against
 *              testing-philosophy.md, anti-pattern scan, architecture compliance,
 *              success criteria verification, and iterative fix cycle.
 *
 *              Use after sprint phases are committed but before moving to next phase
 *              or before final sprint merge.
 *
 * Inputs:
 *   sprintNumber     - Sprint number being reviewed
 *   sprintSpecPath   - Path to sprint spec (default: auto from sprintNumber)
 *   phases           - Which phases to review (e.g., ["A", "B", "C"])
 *   commitRange      - Git range to review (default: auto-detect from sprint commits)
 *   testCommand      - Rust test command (default: cargo test)
 *   frontendTestCommand - Frontend test command (default: npm test)
 *   improvementsPath - Path to code-improvements.md
 *   sprintPlanPath   - Path to sprint-plan.md
 */

import { defineTask } from '@a5c-ai/babysitter-sdk';
import {
  scanAntiPatternsTask,
  architectureComplianceTask,
  runFullTestSuiteTask,
} from './sprint-development.js';
import { process as tddProcess } from './behavioral-tdd.js';

export async function process(inputs, ctx) {
  const {
    sprintNumber,
    sprintSpecPath = `docs/sprints/sprint-${String(sprintNumber).padStart(2, '0')}.md`,
    phases = [],
    commitRange = '',
    testCommand = 'cargo test --manifest-path src-tauri/Cargo.toml',
    frontendTestCommand = 'npm test',
    improvementsPath = 'docs/code-improvements.md',
    sprintPlanPath = 'docs/sprints/sprint-plan.md',
  } = inputs;

  const phaseLabel = phases.length > 0 ? ` (Phases ${phases.join(', ')})` : '';

  // ════════════════════════════════════════════════════════════════════════
  // PHASE 1: SCOPE — identify what was committed and what to review
  // ════════════════════════════════════════════════════════════════════════

  ctx.log('info', `Phase 1: Scope — Sprint ${sprintNumber}${phaseLabel}`);

  const scope = await ctx.task(reviewScopeTask, {
    sprintNumber,
    sprintSpecPath,
    phases,
    commitRange,
  });
  ctx.log('info', `Scope: ${scope.summary}`);

  // ════════════════════════════════════════════════════════════════════════
  // PHASE 2: SPEC QUALITY — is the goal clear, is the spec well-defined?
  // ════════════════════════════════════════════════════════════════════════

  ctx.log('info', 'Phase 2: Spec quality assessment (retrospective)');

  const specQuality = await ctx.task(retrospectiveSpecQualityTask, {
    sprintNumber,
    sprintSpecPath,
    sprintPlanPath,
    phases,
    scope,
  });
  ctx.log('info', `Spec quality: ${specQuality.summary}`);

  // ════════════════════════════════════════════════════════════════════════
  // PHASE 3: QUALITY GATES — anti-patterns, architecture, test coverage
  // ════════════════════════════════════════════════════════════════════════

  ctx.log('info', 'Phase 3: Quality gates');

  // 3.1: Anti-pattern scan on touched modules
  const antiPatternScan = await ctx.task(scanAntiPatternsTask, {
    improvementsPath,
    sprintSpecPath,
    touchedModules: scope.touchedModules || [],
  });
  ctx.log('info', `Anti-pattern scan: ${antiPatternScan.summary}`);

  // 3.2: Architecture compliance
  const archCheck = await ctx.task(architectureComplianceTask, {
    sprintPlanPath,
    sprintNumber,
    currentArchitecture: {},
  });
  ctx.log('info', `Architecture check: ${archCheck.summary}`);

  // 3.3: Test coverage audit against testing-philosophy.md
  const coverageAudit = await ctx.task(testCoverageAuditTask, {
    sprintNumber,
    sprintSpecPath,
    phases,
    scope,
    testCommand,
    frontendTestCommand,
  });
  ctx.log('info', `Test coverage audit: ${coverageAudit.summary}`);

  // 3.4: Full test suite run
  const testRun = await ctx.task(runFullTestSuiteTask, { testCommand });
  ctx.log('info', `Test suite: ${testRun.summary}`);

  // ════════════════════════════════════════════════════════════════════════
  // PHASE 4: SUCCESS CRITERIA VERIFICATION
  // ════════════════════════════════════════════════════════════════════════

  ctx.log('info', 'Phase 4: Success criteria verification');

  const criteriaCheck = await ctx.task(successCriteriaVerificationTask, {
    sprintNumber,
    sprintSpecPath,
    phases,
    scope,
  });
  ctx.log('info', `Success criteria: ${criteriaCheck.summary}`);

  // ════════════════════════════════════════════════════════════════════════
  // PHASE 5: ISSUE COLLECTION — present all findings
  // ════════════════════════════════════════════════════════════════════════

  ctx.log('info', 'Phase 5: Issue collection');

  const allIssues = [];

  // Spec quality issues
  if (specQuality.score < 80) {
    allIssues.push(`SPEC: Score ${specQuality.score}/100 — ${(specQuality.gaps || []).join('; ')}`);
  }

  // Anti-pattern issues
  for (const issue of (antiPatternScan.relevantIssues || [])) {
    if (issue.action !== 'defer') {
      allIssues.push(`ANTIPATTERN: ${issue.id} [${issue.severity}] — ${issue.title}`);
    }
  }

  // Architecture violations
  for (const v of (archCheck.violations || [])) {
    allIssues.push(`ARCH: ${v}`);
  }

  // Test coverage gaps
  for (const gap of (coverageAudit.gaps || [])) {
    allIssues.push(`COVERAGE: ${gap}`);
  }

  // Success criteria failures
  for (const fail of (criteriaCheck.failures || [])) {
    allIssues.push(`CRITERIA: ${fail}`);
  }

  await ctx.breakpoint({
    tag: 'review-findings',
    question: [
      `Sprint ${sprintNumber}${phaseLabel} — Review Findings`,
      '',
      `Spec quality: ${specQuality.score}/100`,
      `  Goal clarity: ${specQuality.goalClarityScore || '?'}/20`,
      `  Completeness: ${specQuality.completenessScore || '?'}/20`,
      `  Testability: ${specQuality.testabilityScore || '?'}/20`,
      `  Architecture: ${specQuality.architectureScore || '?'}/20`,
      `  Implementability: ${specQuality.implementabilityScore || '?'}/20`,
      '',
      `Anti-patterns: ${antiPatternScan.relevantIssueCount || 0} issues`,
      `Architecture violations: ${archCheck.violationCount || 0}`,
      `Test coverage gaps: ${(coverageAudit.gaps || []).length}`,
      `Success criteria: ${criteriaCheck.metCount || 0}/${criteriaCheck.totalCount || 0} met`,
      '',
      `Total issues found: ${allIssues.length}`,
      '',
      allIssues.length > 0
        ? allIssues.map((issue, i) => `  ${i + 1}. ${issue}`).join('\n')
        : '  No issues found.',
      '',
      allIssues.length > 0
        ? 'Approve to enter fix cycle, or provide prioritization guidance.'
        : 'Approve to finalize review (no issues to fix).',
    ].join('\n'),
    title: 'Review Findings',
  });

  // ════════════════════════════════════════════════════════════════════════
  // PHASE 6: FIX CYCLE — iterative fix + re-verify
  // ════════════════════════════════════════════════════════════════════════

  if (allIssues.length > 0) {
    let fixRound = 0;
    const maxFixRounds = 5;

    while (fixRound < maxFixRounds) {
      fixRound++;
      ctx.log('info', `Phase 6.${fixRound}: Fix cycle round ${fixRound}`);

      // 6.a: Plan fixes for current issues
      const fixPlan = await ctx.task(planFixesTask, {
        issues: allIssues,
        sprintNumber,
        sprintSpecPath,
        testCommand,
        frontendTestCommand,
      });
      ctx.log('info', `Fix plan: ${fixPlan.summary}`);

      // 6.b: Review fix plan
      await ctx.breakpoint({
        tag: `fix-plan-${fixRound}`,
        question: [
          `Fix Plan (Round ${fixRound})`,
          '',
          `Issues to address: ${(fixPlan.fixes || []).length}`,
          ...(fixPlan.fixes || []).map((f, i) => `  ${i + 1}. ${f.description} — ${f.approach}`),
          '',
          `Deferred: ${(fixPlan.deferred || []).length}`,
          ...(fixPlan.deferred || []).map(d => `  - ${d}`),
          '',
          'Approve to implement fixes, or provide corrections.',
        ].join('\n'),
        title: `Fix Plan: Round ${fixRound}`,
      });

      // 6.c: Implement each fix via behavioral TDD
      for (const fix of (fixPlan.fixes || [])) {
        ctx.log('info', `Fixing: ${fix.description}`);

        const fixResult = await tddProcess({
          feature: fix.description,
          behaviors: fix.behaviors || [],
          impactedTests: fix.impactedTests || [],
          testCommand,
          mode: 'new',
          phase: 'feature',
        }, ctx);

        ctx.log('info', `Fix complete: RED=${fixResult.redCommit}, GREEN=${fixResult.greenCommit}`);
      }

      // 6.d: Re-verify — run all quality gates again
      const reTestRun = await ctx.task(runFullTestSuiteTask, { testCommand });
      ctx.log('info', `Re-verify tests: ${reTestRun.summary}`);

      const reCriteriaCheck = await ctx.task(successCriteriaVerificationTask, {
        sprintNumber,
        sprintSpecPath,
        phases,
        scope,
      });
      ctx.log('info', `Re-verify criteria: ${reCriteriaCheck.summary}`);

      // 6.e: Check if issues remain
      const remainingIssues = (reCriteriaCheck.failures || []).length;

      await ctx.breakpoint({
        tag: `fix-round-${fixRound}-complete`,
        question: [
          `Fix Round ${fixRound} Complete`,
          '',
          `Tests: ${reTestRun.summary}`,
          `Success criteria: ${reCriteriaCheck.metCount || 0}/${reCriteriaCheck.totalCount || 0} met`,
          `Remaining failures: ${remainingIssues}`,
          '',
          remainingIssues > 0
            ? 'Approve to continue fixing, or "No more fixes" to finalize.'
            : 'All issues resolved. Approve to finalize review.',
        ].join('\n'),
        title: `Fix Round ${fixRound} Complete`,
      });

      // Check if user wants to stop
      if (remainingIssues === 0) break;
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // PHASE 7: FINAL GATE
  // ════════════════════════════════════════════════════════════════════════

  ctx.log('info', 'Phase 7: Final quality gate');

  const finalTests = await ctx.task(runFullTestSuiteTask, { testCommand });
  ctx.log('info', `Final tests: ${finalTests.summary}`);

  await ctx.breakpoint({
    tag: 'review-final',
    question: [
      `Sprint ${sprintNumber}${phaseLabel} — Review Complete`,
      '',
      `Final tests: ${finalTests.summary}`,
      `Spec quality: ${specQuality.score}/100`,
      '',
      'Approve to finalize review.',
    ].join('\n'),
    title: 'Review Complete',
  });

  return {
    success: true,
    sprintNumber,
    phases,
    specQuality: specQuality.score,
    issuesFound: allIssues.length,
    finalTests: finalTests.summary,
  };
}

// ════════════════════════════════════════════════════════════════════════════
// TASK DEFINITIONS — review-specific tasks
// ════════════════════════════════════════════════════════════════════════════

export const reviewScopeTask = defineTask('review-scope', (args, taskCtx) => ({
  kind: 'agent',
  title: `Scope Sprint ${args.sprintNumber} review`,
  agent: {
    name: 'general-purpose',
    prompt: {
      role: 'Sprint review analyst for GemKeep (Tauri + Svelte + Rust)',
      task: [
        `Identify the scope of Sprint ${args.sprintNumber} review.`,
        args.phases.length > 0
          ? `Reviewing phases: ${args.phases.join(', ')}`
          : 'Reviewing entire sprint.',
        '',
        'Your job:',
        '1. Read the sprint spec to understand what was supposed to be built',
        '2. Use git log to find all commits for this sprint',
        '3. Identify which files were touched',
        '4. Identify which Rust modules and Svelte components were modified',
        '5. Count tests added vs tests modified',
        '',
        'If commitRange is provided, use it. Otherwise scan git log for commits',
        'mentioning "Sprint N" or "sprint-N" or "S10" etc.',
      ].join('\n'),
      context: {
        sprintNumber: args.sprintNumber,
        phases: args.phases,
        commitRange: args.commitRange,
      },
      instructions: [
        `Read: ${args.sprintSpecPath}`,
        'Run: git log --oneline --since="2 weeks ago" to find sprint commits',
        'Run: git diff --stat <first_commit>..HEAD to identify touched files',
        'Categorize touched files by module (decisions, photos, commands, frontend)',
        'Count new test functions added',
        'Return structured scope',
      ],
      outputFormat: 'JSON with commits (array of {hash, message}), touchedFiles (array), touchedModules (array of string), newTestCount (number), modifiedTestCount (number), summary (string)',
    },
    outputSchema: {
      type: 'object',
      required: ['touchedModules', 'summary'],
      properties: {
        commits: { type: 'array' },
        touchedFiles: { type: 'array', items: { type: 'string' } },
        touchedModules: { type: 'array', items: { type: 'string' } },
        newTestCount: { type: 'number' },
        modifiedTestCount: { type: 'number' },
        summary: { type: 'string' },
      },
    },
  },
  io: {
    inputJsonPath: `tasks/${taskCtx.effectId}/input.json`,
    outputJsonPath: `tasks/${taskCtx.effectId}/result.json`,
  },
}));

export const retrospectiveSpecQualityTask = defineTask('retro-spec-quality', (args, taskCtx) => ({
  kind: 'agent',
  title: `Retrospective spec quality: Sprint ${args.sprintNumber}`,
  agent: {
    name: 'general-purpose',
    prompt: {
      role: 'Sprint spec quality auditor (retrospective review)',
      task: [
        `Evaluate Sprint ${args.sprintNumber} specification quality RETROSPECTIVELY.`,
        'This is a review of already-committed work. Score the spec on how well it guided implementation.',
        '',
        'Score 0-100 across 5 dimensions (20 points each):',
        '',
        'GOAL CLARITY (0-20):',
        '- Is the WHY stated? What user problem does this sprint solve?',
        '- Can someone unfamiliar with the codebase understand what the sprint achieves?',
        '- Do the features form a coherent unit or unrelated changes bundled together?',
        '- Is there a clear "done" definition from the user perspective?',
        '- RETROSPECTIVE: Did the implementation match the stated goal, or did it drift?',
        '',
        'COMPLETENESS (0-20):',
        '- Does each feature have clear success criteria with observable outcomes?',
        '- Are edge cases mentioned (error paths, empty states)?',
        '- Does it specify test layers per feature?',
        '- RETROSPECTIVE: Were features implemented that are NOT in the spec? Were spec features missed?',
        '',
        'TESTABILITY (0-20):',
        '- Can each success criterion be verified with an automated test?',
        '- Are expected values specific enough for assertions?',
        '- RETROSPECTIVE: Do the actual tests cover the success criteria, or are there gaps?',
        '',
        'ARCHITECTURE ALIGNMENT (0-20):',
        '- Does it reference sprint-plan.md constraints?',
        '- Does it specify modules/files to touch?',
        '- RETROSPECTIVE: Did the implementation follow the specified architecture, or deviate?',
        '',
        'IMPLEMENTABILITY (0-20):',
        '- Is scope realistic? Are dependencies clear?',
        '- RETROSPECTIVE: Were there surprises during implementation the spec should have anticipated?',
      ].join('\n'),
      context: {
        sprintNumber: args.sprintNumber,
        phases: args.phases,
        touchedModules: (args.scope?.touchedModules || []),
      },
      instructions: [
        `Read: ${args.sprintSpecPath}`,
        `Read: ${args.sprintPlanPath}`,
        'Read the actual committed code (git diff or key files) to compare spec vs reality',
        'Score each dimension with retrospective awareness',
        'List gaps between spec and implementation',
        'Return structured assessment',
      ],
      outputFormat: 'JSON with score (number 0-100), goalClarityScore (number 0-20), completenessScore (number 0-20), testabilityScore (number 0-20), architectureScore (number 0-20), implementabilityScore (number 0-20), gaps (array of string), specVsRealityDrift (array of string), recommendations (array of string), summary (string)',
    },
    outputSchema: {
      type: 'object',
      required: ['score', 'summary'],
      properties: {
        score: { type: 'number' },
        goalClarityScore: { type: 'number' },
        completenessScore: { type: 'number' },
        testabilityScore: { type: 'number' },
        architectureScore: { type: 'number' },
        implementabilityScore: { type: 'number' },
        gaps: { type: 'array', items: { type: 'string' } },
        specVsRealityDrift: { type: 'array', items: { type: 'string' } },
        recommendations: { type: 'array', items: { type: 'string' } },
        summary: { type: 'string' },
      },
    },
  },
  io: {
    inputJsonPath: `tasks/${taskCtx.effectId}/input.json`,
    outputJsonPath: `tasks/${taskCtx.effectId}/result.json`,
  },
}));

export const testCoverageAuditTask = defineTask('test-coverage-audit', (args, taskCtx) => ({
  kind: 'agent',
  title: `Test coverage audit: Sprint ${args.sprintNumber}`,
  agent: {
    name: 'general-purpose',
    prompt: {
      role: 'Test coverage auditor enforcing docs/testing-philosophy.md',
      task: [
        `Audit test coverage for Sprint ${args.sprintNumber} against testing-philosophy.md.`,
        '',
        'Read docs/testing-philosophy.md IN FULL — all 20 rules, the testing pyramid,',
        'integration seam testing, and the pre-sprint-done checklist.',
        '',
        'Then audit the ACTUAL tests written for this sprint:',
        '',
        '1. RULE COMPLIANCE: For each rule in testing-philosophy.md, check if the sprint',
        '   tests comply. Flag violations with rule number and specific test.',
        '',
        '2. COVERAGE GAPS: For each success criterion in the sprint spec, check if there',
        '   is at least one test that verifies it. List criteria without tests.',
        '',
        '3. LAYER CORRECTNESS: Check that tests are in the right layer:',
        '   - Visual assertions (colors, borders) must be in .browser.test.ts',
        '   - DOM presence checks can be in .test.ts (jsdom)',
        '   - DB operations must be tested in Rust (not mocked in frontend)',
        '   - E2E journeys in Playwright',
        '',
        '4. TEST QUALITY: Check for:',
        '   - assert!(false) or artificial failures (Rule 2 violation)',
        '   - Tests that pass by coincidence (mock matches both old+new behavior)',
        '   - Test names that promise more than assertions verify (Rule 20)',
        '   - Missing negative tests (error paths, edge cases)',
        '',
        '5. TEST INFRASTRUCTURE: Check Rule 16 compliance:',
        '   - Are TestProject/TestLibraryBuilder used for photo tests?',
        '   - Are shared fixtures/helpers reused (not duplicated)?',
      ].join('\n'),
      context: {
        sprintNumber: args.sprintNumber,
        phases: args.phases,
        touchedModules: (args.scope?.touchedModules || []),
        newTestCount: args.scope?.newTestCount || 0,
      },
      instructions: [
        'Read: docs/testing-philosophy.md — the ENTIRE document',
        `Read: ${args.sprintSpecPath} — extract success criteria`,
        'Search for new test functions in sprint commits (grep for test_s10 or describe blocks)',
        'Read the actual test files to audit assertions',
        'Cross-reference success criteria with actual test coverage',
        'Check each applicable rule from testing-philosophy.md',
        'Return gaps and violations',
      ],
      outputFormat: 'JSON with gaps (array of string — uncovered success criteria or missing test layers), violations (array of {rule, test, description}), layerIssues (array of string), qualityIssues (array of string), coveredCriteria (number), totalCriteria (number), summary (string)',
    },
    outputSchema: {
      type: 'object',
      required: ['gaps', 'summary'],
      properties: {
        gaps: { type: 'array', items: { type: 'string' } },
        violations: { type: 'array' },
        layerIssues: { type: 'array', items: { type: 'string' } },
        qualityIssues: { type: 'array', items: { type: 'string' } },
        coveredCriteria: { type: 'number' },
        totalCriteria: { type: 'number' },
        summary: { type: 'string' },
      },
    },
  },
  io: {
    inputJsonPath: `tasks/${taskCtx.effectId}/input.json`,
    outputJsonPath: `tasks/${taskCtx.effectId}/result.json`,
  },
}));

export const successCriteriaVerificationTask = defineTask('verify-criteria', (args, taskCtx) => ({
  kind: 'agent',
  title: `Verify success criteria: Sprint ${args.sprintNumber}`,
  agent: {
    name: 'general-purpose',
    prompt: {
      role: 'Success criteria verifier for GemKeep',
      task: [
        `Verify each success criterion from Sprint ${args.sprintNumber} spec is actually met.`,
        '',
        'For each criterion in the sprint spec "Success criteria" section:',
        '1. Read the criterion',
        '2. Find the code that implements it (search for relevant functions/components)',
        '3. Find the test that verifies it',
        '4. Determine: MET (code exists + test exists), PARTIAL (code exists, no test),',
        '   or UNMET (code missing or incorrect)',
        '',
        'Be thorough — read actual source code, not just test names.',
        'A criterion is UNMET if the behavior described does not actually work.',
      ].join('\n'),
      context: {
        sprintNumber: args.sprintNumber,
        phases: args.phases,
      },
      instructions: [
        `Read: ${args.sprintSpecPath} — extract all numbered success criteria`,
        'For each criterion, search the codebase for the implementing code',
        'For each criterion, search test files for the verifying test',
        'Report MET/PARTIAL/UNMET for each with evidence',
        'Return structured verification',
      ],
      outputFormat: 'JSON with criteria (array of {number, description, status: "met"|"partial"|"unmet", evidence, test}), metCount (number), partialCount (number), unmetCount (number), totalCount (number), failures (array of string — unmet/partial descriptions), summary (string)',
    },
    outputSchema: {
      type: 'object',
      required: ['criteria', 'metCount', 'totalCount', 'summary'],
      properties: {
        criteria: { type: 'array' },
        metCount: { type: 'number' },
        partialCount: { type: 'number' },
        unmetCount: { type: 'number' },
        totalCount: { type: 'number' },
        failures: { type: 'array', items: { type: 'string' } },
        summary: { type: 'string' },
      },
    },
  },
  io: {
    inputJsonPath: `tasks/${taskCtx.effectId}/input.json`,
    outputJsonPath: `tasks/${taskCtx.effectId}/result.json`,
  },
}));

export const planFixesTask = defineTask('plan-fixes', (args, taskCtx) => ({
  kind: 'agent',
  title: 'Plan fixes for review issues',
  agent: {
    name: 'general-purpose',
    prompt: {
      role: 'Fix planner for GemKeep sprint review',
      task: [
        'Plan fixes for the issues found during sprint review.',
        '',
        'For each issue:',
        '1. Determine if it needs a code fix, a test addition, or a doc update',
        '2. Estimate scope (trivial / small / medium)',
        '3. Extract behavioral contract if code fix needed',
        '4. Determine if it can be bundled with other fixes',
        '',
        'Prioritize: CRITERIA failures > COVERAGE gaps > ARCH violations > ANTIPATTERNS',
        'Defer items that are low-impact or would require significant refactoring.',
      ].join('\n'),
      context: {
        issues: args.issues,
        sprintNumber: args.sprintNumber,
      },
      instructions: [
        `Read: ${args.sprintSpecPath}`,
        'Read relevant source files for each issue',
        'Plan minimal fixes with behavioral contracts',
        'Return structured fix plan',
      ],
      outputFormat: 'JSON with fixes (array of {description, approach, scope, behaviors: [{trigger, expectedOutcome, testLayer}], impactedTests: []}), deferred (array of string), summary (string)',
    },
    outputSchema: {
      type: 'object',
      required: ['fixes', 'summary'],
      properties: {
        fixes: { type: 'array' },
        deferred: { type: 'array', items: { type: 'string' } },
        summary: { type: 'string' },
      },
    },
  },
  io: {
    inputJsonPath: `tasks/${taskCtx.effectId}/input.json`,
    outputJsonPath: `tasks/${taskCtx.effectId}/result.json`,
  },
}));
