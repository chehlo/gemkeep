/**
 * @process gemkeep/sprint-review
 * @description Sequential retrospective review of already-committed sprint work.
 *              Each review step completes (including fixes) before the next starts.
 *              Step 1: Requirements — spec quality + gap fixes
 *              Step 2: Architecture — anti-patterns + compliance fixes
 *              Step 3: Tests — coverage audit + success criteria + test fixes
 *              Step 4: Final gate
 *
 * Inputs:
 *   sprintNumber     - Sprint number being reviewed
 *   sprintSpecPath   - Path to sprint spec (default: auto from sprintNumber)
 *   phases           - Which phases to review (e.g., ["A", "B", "C"])
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
    testCommand = 'cargo test --manifest-path src-tauri/Cargo.toml',
    frontendTestCommand = 'npm test',
    improvementsPath = 'docs/code-improvements.md',
    sprintPlanPath = 'docs/sprints/sprint-plan.md',
  } = inputs;

  const phaseLabel = phases.length > 0 ? ` (Phases ${phases.join(', ')})` : '';

  // ════════════════════════════════════════════════════════════════════════
  // STEP 0: SCOPE — identify what was committed
  // ════════════════════════════════════════════════════════════════════════

  ctx.log('info', `Step 0: Scope — Sprint ${sprintNumber}${phaseLabel}`);

  const scope = await ctx.task(reviewScopeTask, {
    sprintNumber,
    sprintSpecPath,
    phases,
  });
  ctx.log('info', `Scope: ${scope.summary}`);

  // ════════════════════════════════════════════════════════════════════════
  // STEP 1: REQUIREMENTS REVIEW
  // Assess spec quality → present findings → fix spec → commit
  // Must complete before architecture review (spec changes affect what code should exist)
  // ════════════════════════════════════════════════════════════════════════

  ctx.log('info', 'Step 1: Requirements review');

  const specQuality = await ctx.task(retrospectiveSpecQualityTask, {
    sprintNumber,
    sprintSpecPath,
    sprintPlanPath,
    phases,
    scope,
  });
  ctx.log('info', `Spec quality: ${specQuality.summary}`);

  // Present findings + get user decision on spec changes
  const specReview = await ctx.breakpoint({
    tag: 'requirements-review',
    question: [
      `Step 1: Requirements Review — Sprint ${sprintNumber}${phaseLabel}`,
      '',
      `Spec quality: ${specQuality.score}/100`,
      `  Goal clarity: ${specQuality.goalClarityScore || '?'}/20`,
      `  Completeness: ${specQuality.completenessScore || '?'}/20`,
      `  Testability: ${specQuality.testabilityScore || '?'}/20`,
      `  Architecture: ${specQuality.architectureScore || '?'}/20`,
      `  Implementability: ${specQuality.implementabilityScore || '?'}/20`,
      '',
      'Gaps found:',
      ...(specQuality.gaps || []).map(g => `  - ${g}`),
      '',
      'Spec vs reality drift:',
      ...(specQuality.specVsRealityDrift || []).map(d => `  - ${d}`),
      '',
      'Recommendations:',
      ...(specQuality.recommendations || []).map(r => `  - ${r}`),
      '',
      'Review the findings. Provide spec changes to apply, or "No changes needed".',
      'The spec MUST be correct before we review architecture and tests.',
    ].join('\n'),
    title: 'Requirements Review',
  });

  // If user provided spec changes, apply them
  const specResponse = specReview?.response || specReview?.output || '';
  const noSpecChanges = !specResponse ||
    specResponse.toLowerCase().includes('no change') ||
    specResponse.toLowerCase().trim() === 'approve' ||
    specResponse.toLowerCase().trim() === 'approved';

  if (!noSpecChanges) {
    ctx.log('info', 'Step 1b: Applying spec changes');

    const specFix = await ctx.task(applySpecChangesTask, {
      sprintNumber,
      sprintSpecPath,
      userFeedback: specResponse,
      specQuality,
    });
    ctx.log('info', `Spec changes applied: ${specFix.summary}`);

    // Commit spec changes
    const specCommit = await ctx.task(commitChangesTask, {
      message: `docs: Sprint ${sprintNumber} spec refinement from review`,
      phase: 'SPEC-FIX',
    });
    ctx.log('info', `Spec committed: ${specCommit.summary}`);

    // Confirm spec changes with user
    await ctx.breakpoint({
      tag: 'spec-changes-review',
      question: [
        'Spec changes applied and committed.',
        '',
        `Changes: ${specFix.summary}`,
        '',
        'Approve to proceed to architecture review.',
      ].join('\n'),
      title: 'Spec Changes Applied',
    });
  }

  // ════════════════════════════════════════════════════════════════════════
  // STEP 2: ARCHITECTURE REVIEW
  // Anti-pattern scan + compliance check → present → fix → commit
  // Depends on Step 1 (correct spec determines what code should exist)
  // ════════════════════════════════════════════════════════════════════════

  ctx.log('info', 'Step 2: Architecture review');

  const antiPatternScan = await ctx.task(scanAntiPatternsTask, {
    improvementsPath,
    sprintSpecPath,
    touchedModules: scope.touchedModules || [],
  });
  ctx.log('info', `Anti-pattern scan: ${antiPatternScan.summary}`);

  const archCheck = await ctx.task(architectureComplianceTask, {
    sprintPlanPath,
    sprintNumber,
    currentArchitecture: {},
  });
  ctx.log('info', `Architecture check: ${archCheck.summary}`);

  const archIssues = [];
  for (const issue of (antiPatternScan.relevantIssues || [])) {
    if (issue.action !== 'defer') {
      archIssues.push(`ANTIPATTERN: ${issue.id} [${issue.severity}] — ${issue.title}`);
    }
  }
  for (const v of (archCheck.violations || [])) {
    archIssues.push(`ARCH: ${v}`);
  }

  const archReview = await ctx.breakpoint({
    tag: 'architecture-review',
    question: [
      `Step 2: Architecture Review — Sprint ${sprintNumber}${phaseLabel}`,
      '',
      `Anti-patterns: ${antiPatternScan.relevantIssueCount || 0} issues`,
      `Architecture violations: ${archCheck.violationCount || 0}`,
      '',
      archIssues.length > 0
        ? archIssues.map((issue, i) => `  ${i + 1}. ${issue}`).join('\n')
        : '  No issues found.',
      '',
      archIssues.length > 0
        ? 'Provide fix instructions (which issues to fix now, which to defer), or "No fixes needed".'
        : 'Approve to proceed to test review.',
    ].join('\n'),
    title: 'Architecture Review',
  });

  // If user wants arch fixes, implement them
  const archResponse = archReview?.response || archReview?.output || '';
  const noArchFixes = !archResponse ||
    archResponse.toLowerCase().includes('no fix') ||
    archResponse.toLowerCase().includes('no change') ||
    archResponse.toLowerCase().trim() === 'approve' ||
    archResponse.toLowerCase().trim() === 'approved';

  if (!noArchFixes && archIssues.length > 0) {
    ctx.log('info', 'Step 2b: Applying architecture fixes');

    const archFixPlan = await ctx.task(planArchFixesTask, {
      issues: archIssues,
      userGuidance: archResponse,
      sprintNumber,
      sprintSpecPath,
      testCommand,
    });
    ctx.log('info', `Arch fix plan: ${archFixPlan.summary}`);

    for (const fix of (archFixPlan.fixes || [])) {
      ctx.log('info', `Fixing: ${fix.description}`);
      const fixResult = await tddProcess({
        feature: fix.description,
        behaviors: fix.behaviors || [],
        impactedTests: fix.impactedTests || [],
        testCommand,
        mode: 'new',
        phase: 'feature',
      }, ctx);
      ctx.log('info', `Fix complete: ${fixResult.greenCommit || 'done'}`);
    }

    await ctx.breakpoint({
      tag: 'arch-fixes-review',
      question: [
        'Architecture fixes applied.',
        '',
        `Fixes: ${(archFixPlan.fixes || []).map(f => f.description).join('; ')}`,
        '',
        'Approve to proceed to test review.',
      ].join('\n'),
      title: 'Architecture Fixes Applied',
    });
  }

  // ════════════════════════════════════════════════════════════════════════
  // STEP 3: TEST REVIEW
  // Coverage audit + success criteria verification → present → fix → commit
  // Depends on Step 1 (correct spec) and Step 2 (correct architecture)
  // ════════════════════════════════════════════════════════════════════════

  ctx.log('info', 'Step 3: Test review');

  // Run full test suite first to establish baseline
  const testRun = await ctx.task(runFullTestSuiteTask, { testCommand });
  ctx.log('info', `Test suite: ${testRun.summary}`);

  const coverageAudit = await ctx.task(testCoverageAuditTask, {
    sprintNumber,
    sprintSpecPath,
    phases,
    scope,
    testCommand,
    frontendTestCommand,
  });
  ctx.log('info', `Test coverage audit: ${coverageAudit.summary}`);

  const criteriaCheck = await ctx.task(successCriteriaVerificationTask, {
    sprintNumber,
    sprintSpecPath,
    phases,
    scope,
  });
  ctx.log('info', `Success criteria: ${criteriaCheck.summary}`);

  const testIssues = [];
  for (const gap of (coverageAudit.gaps || [])) {
    testIssues.push(`COVERAGE: ${gap}`);
  }
  for (const fail of (criteriaCheck.failures || [])) {
    testIssues.push(`CRITERIA: ${fail}`);
  }

  const testReview = await ctx.breakpoint({
    tag: 'test-review',
    question: [
      `Step 3: Test Review — Sprint ${sprintNumber}${phaseLabel}`,
      '',
      `Tests: ${testRun.summary}`,
      `Coverage gaps: ${(coverageAudit.gaps || []).length}`,
      `Success criteria: ${criteriaCheck.metCount || 0}/${criteriaCheck.totalCount || 0} met`,
      '',
      testIssues.length > 0
        ? testIssues.map((issue, i) => `  ${i + 1}. ${issue}`).join('\n')
        : '  No issues found.',
      '',
      testIssues.length > 0
        ? 'Provide fix instructions (which gaps to fill, which to defer), or "No fixes needed".'
        : 'Approve to finalize.',
    ].join('\n'),
    title: 'Test Review',
  });

  // If user wants test fixes, implement them
  const testResponse = testReview?.response || testReview?.output || '';
  const noTestFixes = !testResponse ||
    testResponse.toLowerCase().includes('no fix') ||
    testResponse.toLowerCase().includes('no change') ||
    testResponse.toLowerCase().trim() === 'approve' ||
    testResponse.toLowerCase().trim() === 'approved';

  if (!noTestFixes && testIssues.length > 0) {
    ctx.log('info', 'Step 3b: Applying test fixes');

    const testFixPlan = await ctx.task(planTestFixesTask, {
      issues: testIssues,
      userGuidance: testResponse,
      sprintNumber,
      sprintSpecPath,
      testCommand,
      frontendTestCommand,
    });
    ctx.log('info', `Test fix plan: ${testFixPlan.summary}`);

    for (const fix of (testFixPlan.fixes || [])) {
      ctx.log('info', `Fixing: ${fix.description}`);
      const fixResult = await tddProcess({
        feature: fix.description,
        behaviors: fix.behaviors || [],
        impactedTests: fix.impactedTests || [],
        testCommand,
        mode: 'new',
        phase: 'feature',
      }, ctx);
      ctx.log('info', `Fix complete: ${fixResult.greenCommit || 'done'}`);
    }

    await ctx.breakpoint({
      tag: 'test-fixes-review',
      question: [
        'Test fixes applied.',
        '',
        `Fixes: ${(testFixPlan.fixes || []).map(f => f.description).join('; ')}`,
        '',
        'Approve to finalize.',
      ].join('\n'),
      title: 'Test Fixes Applied',
    });
  }

  // ════════════════════════════════════════════════════════════════════════
  // STEP 4: FINAL GATE
  // ════════════════════════════════════════════════════════════════════════

  ctx.log('info', 'Step 4: Final quality gate');

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
    finalTests: finalTests.summary,
  };
}

// ════════════════════════════════════════════════════════════════════════════
// TASK DEFINITIONS
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
        args.phases.length > 0 ? `Reviewing phases: ${args.phases.join(', ')}` : 'Reviewing entire sprint.',
        '',
        '1. Read the sprint spec to understand what was supposed to be built',
        '2. Use git log to find all commits for this sprint',
        '3. Identify which files and modules were touched',
        '4. Count tests added vs modified',
      ].join('\n'),
      context: { sprintNumber: args.sprintNumber, phases: args.phases },
      instructions: [
        `Read: ${args.sprintSpecPath}`,
        'Run: git log --oneline --since="2 weeks ago"',
        'Categorize touched files by module',
        'Return structured scope',
      ],
      outputFormat: 'JSON with commits (array of {hash, message}), touchedFiles (array), touchedModules (array of string), newTestCount (number), summary (string)',
    },
    outputSchema: { type: 'object', required: ['touchedModules', 'summary'] },
  },
  io: { inputJsonPath: `tasks/${taskCtx.effectId}/input.json`, outputJsonPath: `tasks/${taskCtx.effectId}/result.json` },
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
        'Score 0-100 across 5 dimensions (20 points each):',
        '',
        'GOAL CLARITY (0-20): WHY stated? Coherent unit? Clear done definition?',
        'COMPLETENESS (0-20): Success criteria? Edge cases? Test layers?',
        'TESTABILITY (0-20): Automatable? Specific values? RETRO: Do tests cover criteria?',
        'ARCHITECTURE ALIGNMENT (0-20): References constraints? Specifies modules?',
        'IMPLEMENTABILITY (0-20): Realistic scope? Clear dependencies?',
        '',
        'For each dimension, add RETROSPECTIVE check: did implementation match spec?',
        'List gaps, spec-vs-reality drift, and actionable recommendations.',
      ].join('\n'),
      context: { sprintNumber: args.sprintNumber, phases: args.phases, touchedModules: (args.scope?.touchedModules || []) },
      instructions: [
        `Read: ${args.sprintSpecPath}`,
        `Read: ${args.sprintPlanPath}`,
        'Compare spec intent vs actual committed code',
        'Return structured assessment',
      ],
      outputFormat: 'JSON with score, goalClarityScore, completenessScore, testabilityScore, architectureScore, implementabilityScore (all numbers), gaps (array), specVsRealityDrift (array), recommendations (array), summary (string)',
    },
    outputSchema: { type: 'object', required: ['score', 'summary'] },
  },
  io: { inputJsonPath: `tasks/${taskCtx.effectId}/input.json`, outputJsonPath: `tasks/${taskCtx.effectId}/result.json` },
}));

export const applySpecChangesTask = defineTask('apply-spec-changes', (args, taskCtx) => ({
  kind: 'agent',
  title: `Apply spec changes: Sprint ${args.sprintNumber}`,
  agent: {
    name: 'general-purpose',
    prompt: {
      role: 'Sprint spec editor for GemKeep',
      task: [
        `Apply the user's requested changes to Sprint ${args.sprintNumber} spec.`,
        '',
        'User feedback:',
        args.userFeedback,
        '',
        'Quality assessment gaps:',
        ...(args.specQuality.gaps || []).map(g => `- ${g}`),
        '',
        'RULES:',
        '1. Edit the sprint spec file directly',
        '2. Update success criteria numbers if criteria are removed/added',
        '3. Update the status table if phase scope changes',
        '4. Keep existing valid content — only change what the user requested',
        '5. Update edge cases table if affected',
      ].join('\n'),
      context: { sprintNumber: args.sprintNumber },
      instructions: [
        `Read: ${args.sprintSpecPath}`,
        'Apply requested changes',
        'Report what was changed',
      ],
      outputFormat: 'JSON with changesApplied (array of string), summary (string)',
    },
    outputSchema: { type: 'object', required: ['summary'] },
  },
  io: { inputJsonPath: `tasks/${taskCtx.effectId}/input.json`, outputJsonPath: `tasks/${taskCtx.effectId}/result.json` },
}));

export const commitChangesTask = defineTask('commit-changes', (args, taskCtx) => ({
  kind: 'agent',
  title: `Commit: ${args.phase}`,
  agent: {
    name: 'general-purpose',
    prompt: {
      role: 'Git operator',
      task: 'Stage changed files and create a git commit.',
      context: { message: args.message, phase: args.phase },
      instructions: [
        'Run git status to see changed files',
        'Stage relevant files (use -f for .gitignore overrides if needed)',
        `Commit with message: "${args.message}"`,
        'Return the commit hash',
      ],
      outputFormat: 'JSON with commitHash (string), filesCommitted (array), summary (string)',
    },
    outputSchema: { type: 'object', required: ['summary'] },
  },
  io: { inputJsonPath: `tasks/${taskCtx.effectId}/input.json`, outputJsonPath: `tasks/${taskCtx.effectId}/result.json` },
}));

export const planArchFixesTask = defineTask('plan-arch-fixes', (args, taskCtx) => ({
  kind: 'agent',
  title: 'Plan architecture fixes',
  agent: {
    name: 'general-purpose',
    prompt: {
      role: 'Fix planner for architecture issues',
      task: [
        'Plan fixes for architecture issues found during review.',
        '',
        'User guidance on what to fix:',
        args.userGuidance,
        '',
        'Issues:',
        ...(args.issues || []).map((issue, i) => `${i + 1}. ${issue}`),
        '',
        'For each fix: describe approach, extract behavioral contract, estimate scope.',
        'Respect user guidance on which to fix vs defer.',
      ].join('\n'),
      context: { sprintNumber: args.sprintNumber },
      instructions: [
        `Read: ${args.sprintSpecPath}`,
        'Read relevant source files',
        'Plan minimal fixes with behavioral contracts',
      ],
      outputFormat: 'JSON with fixes (array of {description, approach, scope, behaviors: [{trigger, expectedOutcome, testLayer}], impactedTests: []}), deferred (array), summary (string)',
    },
    outputSchema: { type: 'object', required: ['fixes', 'summary'] },
  },
  io: { inputJsonPath: `tasks/${taskCtx.effectId}/input.json`, outputJsonPath: `tasks/${taskCtx.effectId}/result.json` },
}));

export const planTestFixesTask = defineTask('plan-test-fixes', (args, taskCtx) => ({
  kind: 'agent',
  title: 'Plan test fixes',
  agent: {
    name: 'general-purpose',
    prompt: {
      role: 'Fix planner for test coverage issues',
      task: [
        'Plan fixes for test coverage gaps found during review.',
        '',
        'User guidance:',
        args.userGuidance,
        '',
        'Issues:',
        ...(args.issues || []).map((issue, i) => `${i + 1}. ${issue}`),
        '',
        'For each fix: describe what test to add, which layer, behavioral contract.',
        'Respect user guidance on which to fix vs defer.',
      ].join('\n'),
      context: { sprintNumber: args.sprintNumber },
      instructions: [
        `Read: ${args.sprintSpecPath}`,
        'Read docs/testing-philosophy.md',
        'Plan test additions with behavioral contracts',
      ],
      outputFormat: 'JSON with fixes (array of {description, approach, scope, behaviors: [{trigger, expectedOutcome, testLayer}], impactedTests: []}), deferred (array), summary (string)',
    },
    outputSchema: { type: 'object', required: ['fixes', 'summary'] },
  },
  io: { inputJsonPath: `tasks/${taskCtx.effectId}/input.json`, outputJsonPath: `tasks/${taskCtx.effectId}/result.json` },
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
        'Read docs/testing-philosophy.md IN FULL. Then audit:',
        '1. RULE COMPLIANCE per testing-philosophy.md rule',
        '2. COVERAGE GAPS — success criteria without tests',
        '3. LAYER CORRECTNESS — visual in browser, DOM in jsdom, DB in Rust',
        '4. TEST QUALITY — no artificial failures, honest names, no coincidental passes',
        '5. TEST INFRASTRUCTURE — Rule 16 compliance',
      ].join('\n'),
      context: { sprintNumber: args.sprintNumber, phases: args.phases, touchedModules: (args.scope?.touchedModules || []) },
      instructions: [
        'Read: docs/testing-philosophy.md',
        `Read: ${args.sprintSpecPath}`,
        'Search for sprint test functions',
        'Cross-reference criteria with tests',
      ],
      outputFormat: 'JSON with gaps (array of string), violations (array), layerIssues (array), qualityIssues (array), coveredCriteria (number), totalCriteria (number), summary (string)',
    },
    outputSchema: { type: 'object', required: ['gaps', 'summary'] },
  },
  io: { inputJsonPath: `tasks/${taskCtx.effectId}/input.json`, outputJsonPath: `tasks/${taskCtx.effectId}/result.json` },
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
        'For each criterion: find implementing code + verifying test.',
        'Mark: MET (code + test), PARTIAL (code but no test), UNMET (missing).',
        'Read actual source code, not just test names.',
      ].join('\n'),
      context: { sprintNumber: args.sprintNumber, phases: args.phases },
      instructions: [
        `Read: ${args.sprintSpecPath}`,
        'For each criterion, search codebase for implementation + test',
        'Return structured verification',
      ],
      outputFormat: 'JSON with criteria (array of {number, description, status, evidence, test}), metCount (number), partialCount (number), unmetCount (number), totalCount (number), failures (array), summary (string)',
    },
    outputSchema: { type: 'object', required: ['criteria', 'metCount', 'totalCount', 'summary'] },
  },
  io: { inputJsonPath: `tasks/${taskCtx.effectId}/input.json`, outputJsonPath: `tasks/${taskCtx.effectId}/result.json` },
}));
