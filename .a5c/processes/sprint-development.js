/**
 * @process gemkeep/sprint-development
 * @description Sprint development process with architecture quality gates, anti-pattern prevention,
 *              and lessons-learned enforcement from code-improvements.md analysis.
 *              Delegates TDD cycle to behavioral-tdd.js for each feature.
 *
 * Inputs:
 *   sprintNumber   - Sprint number (e.g., 7, 8)
 *   sprintSpecPath - Path to sprint spec (e.g., docs/sprints/sprint-07.md)
 *   features       - Array of feature descriptions to implement in this sprint
 *   testCommand    - Test runner command (default: cargo test)
 *   improvementsPath - Path to code-improvements.md (default: docs/code-improvements.md)
 *   sprintPlanPath - Path to sprint-plan.md (default: docs/sprints/sprint-plan.md)
 *
 * @skill babysit
 * @agent tauri-rust-specialist specializations/desktop-development/agents/tauri-rust-specialist/AGENT.md
 * @agent architecture-pattern-advisor specializations/desktop-development/agents/architecture-pattern-advisor/AGENT.md
 * @agent desktop-test-architect specializations/desktop-development/agents/desktop-test-architect/AGENT.md
 */

import { defineTask } from '@a5c-ai/babysitter-sdk';
import {
  process as tddProcess,
  commitTask,
} from './behavioral-tdd.js';

export async function process(inputs, ctx) {
  const {
    sprintNumber,
    sprintSpecPath = `docs/sprints/sprint-${String(sprintNumber).padStart(2, '0')}.md`,
    features = [],
    testCommand = 'cargo test --manifest-path src-tauri/Cargo.toml',
    improvementsPath = 'docs/code-improvements.md',
    sprintPlanPath = 'docs/sprints/sprint-plan.md',
  } = inputs;

  // ════════════════════════════════════════════════════════════════════════
  // PHASE 0: SPRINT PLANNING & ARCHITECTURE ANALYSIS
  // ════════════════════════════════════════════════════════════════════════

  ctx.log('info', `Phase 0: Sprint ${sprintNumber} — planning & architecture analysis`);

  // 0.1: Analyze sprint spec and extract feature list + architecture constraints
  const sprintAnalysis = await ctx.task(analyzeSprintTask, {
    sprintNumber,
    sprintSpecPath,
    sprintPlanPath,
    features,
  });
  ctx.log('info', `Sprint analysis: ${sprintAnalysis.summary}`);

  // 0.2: Evaluate sprint spec quality — is the definition good enough to implement?
  const specQuality = await ctx.task(evaluateSpecQualityTask, {
    sprintNumber,
    sprintSpecPath,
    sprintPlanPath,
    sprintAnalysis,
  });
  ctx.log('info', `Spec quality: ${specQuality.summary}`);

  // 0.2b: If spec quality is low, refine it before proceeding
  if (specQuality.score < 70 || (specQuality.gaps || []).length > 0) {
    await ctx.breakpoint({
      tag: 'spec-quality-review',
      question: [
        `Sprint ${sprintNumber} Spec Quality Assessment`,
        '',
        `Quality score: ${specQuality.score}/100`,
        '',
        'Issues found:',
        ...(specQuality.gaps || []).map(g => `  - ${g}`),
        '',
        'Missing elements:',
        ...(specQuality.missingElements || []).map(m => `  - ${m}`),
        '',
        'Recommendations:',
        ...(specQuality.recommendations || []).map(r => `  - ${r}`),
        '',
        'Approve to auto-improve the spec, or reject to proceed as-is.',
      ].join('\n'),
      title: 'Spec Quality Review',
    });

    // Auto-improve the spec based on quality assessment
    const improvedSpec = await ctx.task(improveSprintSpecTask, {
      sprintNumber,
      sprintSpecPath,
      sprintPlanPath,
      specQuality,
      sprintAnalysis,
      improvementsPath,
    });
    ctx.log('info', `Spec improved: ${improvedSpec.summary}`);

    // Re-analyze with improved spec
    const reanalysis = await ctx.task(analyzeSprintTask, {
      sprintNumber,
      sprintSpecPath,
      sprintPlanPath,
      features,
    });
    Object.assign(sprintAnalysis, reanalysis);
    ctx.log('info', `Re-analysis after improvement: ${reanalysis.summary}`);
  }

  // 0.3: Scan codebase for anti-patterns from code-improvements.md
  const antiPatternScan = await ctx.task(scanAntiPatternsTask, {
    improvementsPath,
    sprintSpecPath,
    touchedModules: sprintAnalysis.touchedModules || [],
  });
  ctx.log('info', `Anti-pattern scan: ${antiPatternScan.summary}`);

  // 0.4: Architecture compliance check — sprint-plan.md invariants
  const archCheck = await ctx.task(architectureComplianceTask, {
    sprintPlanPath,
    sprintNumber,
    currentArchitecture: sprintAnalysis.currentArchitecture || {},
  });
  ctx.log('info', `Architecture check: ${archCheck.summary}`);

  // 0.5: Planning breakpoint — present findings before implementation
  await ctx.breakpoint({
    tag: 'sprint-plan-review',
    question: [
      `Sprint ${sprintNumber} Planning Review`,
      '',
      `Spec quality: ${specQuality.score}/100`,
      `Features to implement: ${(sprintAnalysis.features || features).length}`,
      `Touched modules: ${(sprintAnalysis.touchedModules || []).join(', ')}`,
      '',
      `Anti-patterns found in touched modules: ${antiPatternScan.relevantIssueCount || 0}`,
      antiPatternScan.relevantIssues
        ? antiPatternScan.relevantIssues
            .filter(i => i.action !== 'bundle')
            .map(i => `  - ${i.id} [${i.action}]: ${i.title}`)
            .join('\n')
        : '  (none)',
      '',
      `Bundling opportunities (cheap fixes in touched files): ${antiPatternScan.bundleCount || 0}`,
      antiPatternScan.relevantIssues
        ? antiPatternScan.relevantIssues
            .filter(i => i.action === 'bundle')
            .map(i => `  - ${i.id}: ${i.title} — ${i.bundleReason || ''}`)
            .join('\n') || '  (none)'
        : '  (none)',
      '',
      `Architecture violations: ${archCheck.violationCount || 0}`,
      archCheck.violations
        ? archCheck.violations.map(v => `  - ${v}`).join('\n')
        : '  (none)',
      '',
      'Approve to proceed with implementation.',
      '- Anti-pattern items: address BEFORE or DURING feature implementation.',
      '- Bundle items: fix while touching those files (cheap wins).',
    ].join('\n'),
    title: 'Sprint Planning Review',
  });

  // ════════════════════════════════════════════════════════════════════════
  // PHASE 1: PRE-FLIGHT REFACTORING (if anti-patterns in touched modules)
  // ════════════════════════════════════════════════════════════════════════

  const relevantIssues = antiPatternScan.relevantIssues || [];
  const highPriorityIssues = relevantIssues.filter(
    i => i.severity === 'HIGH' || i.category === 'BUG'
  );
  const bundleIssues = relevantIssues.filter(i => i.action === 'bundle');
  const preflightIssues = [...highPriorityIssues, ...bundleIssues];

  if (preflightIssues.length > 0) {
    ctx.log('info', `Phase 1: Pre-flight refactoring — ${highPriorityIssues.length} HIGH/BUG + ${bundleIssues.length} bundle items`);

    for (const issue of preflightIssues) {
      ctx.log('info', `Refactoring: ${issue.id} — ${issue.title}`);

      const refactorResult = await ctx.task(refactorWithTddTask, {
        issue,
        testCommand,
      });
      ctx.log('info', `Refactor ${issue.id}: ${refactorResult.summary}`);
    }

    // Commit pre-flight refactoring
    const preflightCommit = await ctx.task(commitTask, {
      message: `refactor: pre-sprint-${sprintNumber} cleanup (${preflightIssues.map(i => i.id).join(', ')})`,
      phase: 'PREFLIGHT',
    });
    ctx.log('info', `Pre-flight committed: ${preflightCommit.summary}`);

    // Verify all tests still pass after refactoring
    const preflightTests = await ctx.task(runFullTestSuiteTask, { testCommand });
    ctx.log('info', `Pre-flight tests: ${preflightTests.summary}`);

    await ctx.breakpoint({
      tag: 'preflight-review',
      question: [
        `Pre-flight refactoring complete.`,
        '',
        `Items addressed: ${preflightIssues.map(i => `${i.id} [${i.action}]`).join(', ')}`,
        `Tests: ${preflightTests.summary}`,
        '',
        'Approve to proceed to feature implementation.',
      ].join('\n'),
      title: 'Pre-flight Refactoring Review',
    });
  }

  // ════════════════════════════════════════════════════════════════════════
  // PHASE 2: FEATURE IMPLEMENTATION (behavioral TDD per feature)
  // ════════════════════════════════════════════════════════════════════════

  const featureList = sprintAnalysis.features || features;
  const featureResults = [];

  for (let i = 0; i < featureList.length; i++) {
    const feature = featureList[i];
    const featureName = typeof feature === 'string' ? feature : feature.name || feature.description;

    ctx.log('info', `Phase 2.${i + 1}: Feature "${featureName}" — analyze spec`);

    // 2.a: Extract behaviors for this feature (sprint-specific: includes anti-pattern awareness)
    const specAnalysis = await ctx.task(analyzeFeatureSpecTask, {
      feature: featureName,
      sprintSpecPath,
      sprintNumber,
      antiPatterns: relevantIssues,
      architectureConstraints: archCheck.constraints || [],
    });
    ctx.log('info', `Feature spec: ${specAnalysis.summary}`);

    // 2.b: Breakpoint — review spec extraction
    const specReview = await ctx.breakpoint({
      tag: `feature-${i + 1}-spec`,
      question: [
        `Feature ${i + 1}/${featureList.length}: "${featureName}"`,
        '',
        `Behaviors extracted: ${(specAnalysis.behaviors || []).length}`,
        `Test layers: ${(specAnalysis.testLayers || []).join(', ')}`,
        '',
        'Anti-pattern warnings for this feature:',
        (specAnalysis.antiPatternWarnings || ['(none)']).map(w => `  - ${w}`).join('\n'),
        '',
        'Architecture constraints:',
        (specAnalysis.architectureNotes || ['(none)']).map(n => `  - ${n}`).join('\n'),
        '',
        'Approve to proceed with behavioral TDD, or provide corrections.',
      ].join('\n'),
      title: `Feature Spec: ${featureName}`,
    });

    // 2.b2: If user provided corrections, re-analyze
    const specResponse = specReview?.response || specReview?.output || '';
    const specIsPlainApproval = !specResponse ||
      specResponse.toLowerCase().trim() === 'approve' ||
      specResponse.toLowerCase().trim() === 'approved';

    if (!specIsPlainApproval && specResponse.length > 10) {
      ctx.log('info', `Phase 2.${i + 1}: User provided corrections — re-analyzing`);
      const correctedSpec = await ctx.task(analyzeFeatureSpecTask, {
        feature: `${featureName}\n\nUSER CORRECTIONS:\n${specResponse}`,
        sprintSpecPath,
        sprintNumber,
        antiPatterns: relevantIssues,
        architectureConstraints: archCheck.constraints || [],
      });
      Object.assign(specAnalysis, correctedSpec);
      ctx.log('info', `Corrected spec: ${correctedSpec.summary}`);
    }

    // 2.c: Delegate to behavioral-tdd for RED -> GREEN -> quality gate
    ctx.log('info', `Phase 2.${i + 1}: Executing behavioral TDD for "${featureName}"`);
    const tddResult = await tddProcess({
      feature: featureName,
      behaviors: specAnalysis.behaviors || [],
      impactedTests: specAnalysis.impactedTests || [],
      testCommand,
      mode: 'new',
      phase: 'feature',
    }, ctx);

    // 2.d: Post-GREEN architecture check — verify no new anti-patterns
    const postGreenCheck = await ctx.task(postGreenArchCheckTask, {
      feature: featureName,
      improvementsPath,
      redCommitRef: tddResult.redCommit || 'HEAD~2',
    });
    ctx.log('info', `Post-GREEN arch check: ${postGreenCheck.summary}`);

    if (postGreenCheck.newIssues && postGreenCheck.newIssues.length > 0) {
      await ctx.breakpoint({
        tag: `feature-${i + 1}-arch-warning`,
        question: [
          `Architecture warning for "${featureName}"`,
          '',
          'New anti-patterns introduced:',
          ...postGreenCheck.newIssues.map(issue => `  - ${issue}`),
          '',
          'Approve to proceed to next feature, or reject to address these first.',
        ].join('\n'),
        title: `Architecture Warning: ${featureName}`,
      });
    }

    featureResults.push({
      feature: featureName,
      redCommit: tddResult.redCommit,
      greenCommit: tddResult.greenCommit,
      archIssues: postGreenCheck.newIssues || [],
    });
  }

  // ════════════════════════════════════════════════════════════════════════
  // PHASE 3: SPRINT INTEGRATION & FINAL QUALITY GATE
  // ════════════════════════════════════════════════════════════════════════

  ctx.log('info', 'Phase 3: Sprint integration & final quality gate');

  // 3.1: Full test suite
  const finalTests = await ctx.task(runFullTestSuiteTask, { testCommand });
  ctx.log('info', `Final tests: ${finalTests.summary}`);

  // 3.2: Full architecture compliance check (post-implementation)
  const finalArchCheck = await ctx.task(finalArchitectureGateTask, {
    sprintPlanPath,
    improvementsPath,
    sprintNumber,
    featureResults,
  });
  ctx.log('info', `Final arch check: ${finalArchCheck.summary}`);

  // 3.3: Update code-improvements.md with resolved items from this sprint
  const resolvedInSprint = preflightIssues.map(i => i.id);
  if (resolvedInSprint.length > 0) {
    const updateImprovements = await ctx.task(updateImprovementsDocTask, {
      improvementsPath,
      resolvedItems: resolvedInSprint,
      sprintNumber,
    });
    ctx.log('info', `Improvements doc updated: ${updateImprovements.summary}`);
  }

  // 3.4: Final breakpoint
  await ctx.breakpoint({
    tag: 'sprint-final',
    question: [
      `Sprint ${sprintNumber} Complete`,
      '',
      `Features implemented: ${featureResults.length}`,
      featureResults.map((f, i) => `  ${i + 1}. ${f.feature}`).join('\n'),
      '',
      resolvedInSprint.length > 0
        ? `Code improvements resolved: ${resolvedInSprint.join(', ')}`
        : 'No code improvements addressed.',
      '',
      `Tests: ${finalTests.summary}`,
      `Architecture: ${finalArchCheck.summary}`,
      '',
      finalArchCheck.newAntiPatterns && finalArchCheck.newAntiPatterns.length > 0
        ? `Anti-patterns to address in next sprint:\n${finalArchCheck.newAntiPatterns.map(p => `  - ${p}`).join('\n')}`
        : 'No new anti-patterns.',
      '',
      'Approve to enter user review cycle, or reject to finalize sprint as-is.',
    ].join('\n'),
    title: `Sprint ${sprintNumber} Final Review`,
  });

  // ════════════════════════════════════════════════════════════════════════
  // PHASE 4: USER REVIEW & IMPROVEMENT CYCLE
  // ════════════════════════════════════════════════════════════════════════
  // Loop: collect user feedback -> reflect & propose -> behavioral TDD -> repeat
  // Exits when user approves with no further feedback.

  let improvementRound = 0;
  const maxImprovementRounds = 5;
  const improvementResults = [];

  while (improvementRound < maxImprovementRounds) {
    improvementRound++;
    ctx.log('info', `Phase 4.${improvementRound}: User review & improvement cycle (round ${improvementRound})`);

    // 4.a: Collect user feedback via breakpoint
    const feedbackBp = await ctx.breakpoint({
      tag: `improvement-${improvementRound}-feedback`,
      question: [
        `Sprint ${sprintNumber} — Improvement Round ${improvementRound}`,
        '',
        'Please review the implemented features and provide feedback.',
        'Describe any issues, missing behaviors, inconsistencies, or improvements needed.',
        '',
        'Options:',
        '- Provide feedback text (free text describing what to fix/improve)',
        '- "No feedback — finalize sprint" (exits the improvement cycle)',
        '',
        'Your feedback will be analyzed, a proposal generated, and implemented via behavioral TDD.',
      ].join('\n'),
      title: `Improvement Round ${improvementRound}: Collect Feedback`,
    });

    // Check if user wants to exit the improvement cycle
    const feedbackText = feedbackBp?.response || feedbackBp?.output || '';
    if (!feedbackText ||
        feedbackText.toLowerCase().includes('no feedback') ||
        feedbackText.toLowerCase().includes('finalize sprint') ||
        feedbackText.toLowerCase().includes('no more')) {
      ctx.log('info', `Phase 4.${improvementRound}: No further feedback — exiting improvement cycle`);
      break;
    }

    // 4.b: Reflect on feedback and propose improvements
    const reflection = await ctx.task(reflectOnFeedbackTask, {
      feedback: feedbackText,
      sprintNumber,
      sprintSpecPath,
      featureResults,
      testCommand,
    });
    ctx.log('info', `Reflection: ${reflection.summary}`);

    // 4.c: Breakpoint — approve proposal before implementation
    await ctx.breakpoint({
      tag: `improvement-${improvementRound}-proposal`,
      question: [
        `Improvement Proposal (Round ${improvementRound})`,
        '',
        `User feedback: ${feedbackText}`,
        '',
        'Proposed changes:',
        ...(reflection.proposedChanges || []).map((c, j) => `  ${j + 1}. ${c}`),
        '',
        `Estimated scope: ${reflection.estimatedScope || 'unknown'}`,
        `Files affected: ${(reflection.filesAffected || []).join(', ')}`,
        '',
        'Shared utilities to create/update:',
        ...(reflection.sharedUtilities || ['(none)']).map(u => `  - ${u}`),
        '',
        'Approve to implement via behavioral TDD, or reject to skip this round.',
      ].join('\n'),
      title: `Improvement Proposal: Round ${improvementRound}`,
    });

    // 4.d: Implement each proposed change via behavioral TDD
    const changeList = reflection.proposedChanges || [];
    for (let c = 0; c < changeList.length; c++) {
      const changeName = changeList[c];
      ctx.log('info', `Phase 4.${improvementRound}.${c + 1}: Implementing "${changeName}" via behavioral TDD`);

      const changeBehaviors = reflection.behaviors?.[c]
        ? [reflection.behaviors[c]]
        : [];

      const changeResult = await tddProcess({
        feature: changeName,
        behaviors: changeBehaviors,
        testCommand,
        mode: 'new',
        phase: 'feature',
      }, ctx);

      ctx.log('info', `Improvement "${changeName}" complete: RED=${changeResult.redCommit}, GREEN=${changeResult.greenCommit}`);
      improvementResults.push({
        change: changeName,
        redCommit: changeResult.redCommit,
        greenCommit: changeResult.greenCommit,
      });
    }

    // 4.e: Quality gate after improvement round
    const roundTests = await ctx.task(runFullTestSuiteTask, { testCommand });
    ctx.log('info', `Improvement round ${improvementRound} quality gate: ${roundTests.summary}`);

    await ctx.breakpoint({
      tag: `improvement-${improvementRound}-complete`,
      question: [
        `Improvement Round ${improvementRound} Complete`,
        '',
        `Changes implemented: ${changeList.length}`,
        changeList.map((c, j) => `  ${j + 1}. ${c}`).join('\n'),
        '',
        `Quality gate: ${roundTests.summary}`,
        '',
        'Continue to next improvement round, or approve to finalize sprint.',
      ].join('\n'),
      title: `Improvement Round ${improvementRound} Complete`,
    });
  }

  // ════════════════════════════════════════════════════════════════════════
  // PHASE 5: CLEANUP — remove temporary docs, verify git clean
  // ════════════════════════════════════════════════════════════════════════

  ctx.log('info', 'Phase 5: Cleanup — verify git clean, remove temporary docs');
  const cleanup = await ctx.task(cleanupTask, {
    sprintNumber,
    sprintSpecPath,
  });
  ctx.log('info', `Cleanup: ${cleanup.summary}`);

  return {
    success: true,
    sprintNumber,
    featuresImplemented: featureResults.length,
    featureResults,
    improvementRounds: improvementRound,
    improvementResults,
    codeImprovementsResolved: resolvedInSprint,
    finalTests: finalTests.summary,
    architectureCompliance: finalArchCheck.summary,
  };
}

// ════════════════════════════════════════════════════════════════════════════
// TASK DEFINITIONS — sprint-specific tasks only
// (TDD tasks are imported from behavioral-tdd.js)
// ════════════════════════════════════════════════════════════════════════════

export const analyzeSprintTask = defineTask('analyze-sprint', (args, taskCtx) => ({
  kind: 'agent',
  title: `Analyze Sprint ${args.sprintNumber} spec`,
  agent: {
    name: 'general-purpose',
    prompt: {
      role: 'Sprint planning analyst for GemKeep (Tauri + Svelte + Rust)',
      task: [
        `Analyze Sprint ${args.sprintNumber} specification and the overall sprint plan.`,
        'Extract: feature list, touched modules, architecture constraints, success criteria.',
        'Cross-reference with sprint-plan.md for architectural invariants.',
        '',
        'Pay special attention to:',
        '- Per-project context isolation (P0 architectural invariant)',
        '- Modularity principle (Sprint 7+)',
        '- Repository pattern for DB access',
        '- Error handling standards (thiserror/anyhow)',
      ].join('\n'),
      context: { sprintNumber: args.sprintNumber, features: args.features },
      instructions: [
        `Read: ${args.sprintSpecPath}`,
        `Read: ${args.sprintPlanPath}`,
        'Read: docs/low-level-design.md for current architecture',
        'Extract feature list with priorities',
        'Identify which Rust modules and Svelte components will be touched',
        'List architecture constraints from sprint-plan.md that apply',
        'Return structured analysis',
      ],
      outputFormat: 'JSON with features (array of {name, priority, description}), touchedModules (array of string), currentArchitecture (object), architectureConstraints (array of string), successCriteria (array of string), summary (string)',
    },
    outputSchema: {
      type: 'object',
      required: ['features', 'summary'],
      properties: {
        features: { type: 'array' },
        touchedModules: { type: 'array', items: { type: 'string' } },
        currentArchitecture: { type: 'object' },
        architectureConstraints: { type: 'array', items: { type: 'string' } },
        successCriteria: { type: 'array', items: { type: 'string' } },
        summary: { type: 'string' },
      },
    },
  },
  io: {
    inputJsonPath: `tasks/${taskCtx.effectId}/input.json`,
    outputJsonPath: `tasks/${taskCtx.effectId}/result.json`,
  },
}));

export const evaluateSpecQualityTask = defineTask('evaluate-spec-quality', (args, taskCtx) => ({
  kind: 'agent',
  title: `Evaluate Sprint ${args.sprintNumber} spec quality`,
  agent: {
    name: 'general-purpose',
    prompt: {
      role: 'Sprint spec quality auditor for GemKeep',
      task: [
        `Evaluate the quality of Sprint ${args.sprintNumber} specification.`,
        'Score it 0-100 based on the following criteria:',
        '',
        'COMPLETENESS (0-25):',
        '- Does each feature have clear success criteria with observable outcomes?',
        '- Are edge cases mentioned (error paths, empty states, concurrent access)?',
        '- Does it specify which test layers each feature needs (unit/integration/E2E)?',
        '- Are deferred items explicitly listed (not silently omitted)?',
        '',
        'TESTABILITY (0-25):',
        '- Can each success criterion be verified with an automated test?',
        '- Are expected values specific enough for assertions (exact counts, specific states)?',
        '- Does it distinguish "must work" from "nice to have"?',
        '- Are input->output pairs clear enough to write BLACK-BOX tests?',
        '',
        'ARCHITECTURE ALIGNMENT (0-25):',
        '- Does it reference sprint-plan.md constraints (per-project isolation, modularity)?',
        '- Does it specify which modules/files will be touched?',
        '- Does it address known issues from code-improvements.md in affected modules?',
        '- Does it define the data model changes needed (schema, migrations)?',
        '',
        'IMPLEMENTABILITY (0-25):',
        '- Is the scope realistic for one sprint?',
        '- Are dependencies between features clear?',
        '- Is the implementation order specified or derivable?',
        '- Are "good enough" definitions actionable (not vague)?',
        '',
        'For each gap found, provide a specific recommendation for improvement.',
      ].join('\n'),
      context: {
        sprintNumber: args.sprintNumber,
        analysisFeatures: (args.sprintAnalysis?.features || []).length,
      },
      instructions: [
        `Read: ${args.sprintSpecPath}`,
        `Read: ${args.sprintPlanPath}`,
        'Score each of the 4 dimensions (0-25 each)',
        'List specific gaps (missing info, vague criteria, untestable requirements)',
        'List missing elements that a good sprint spec should have',
        'Provide actionable recommendations for each gap',
        'Return structured assessment',
      ],
      outputFormat: 'JSON with score (number 0-100), completenessScore (number), testabilityScore (number), architectureScore (number), implementabilityScore (number), gaps (array of string), missingElements (array of string), recommendations (array of string), summary (string)',
    },
    outputSchema: {
      type: 'object',
      required: ['score', 'gaps', 'summary'],
      properties: {
        score: { type: 'number' },
        completenessScore: { type: 'number' },
        testabilityScore: { type: 'number' },
        architectureScore: { type: 'number' },
        implementabilityScore: { type: 'number' },
        gaps: { type: 'array', items: { type: 'string' } },
        missingElements: { type: 'array', items: { type: 'string' } },
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

export const improveSprintSpecTask = defineTask('improve-sprint-spec', (args, taskCtx) => ({
  kind: 'agent',
  title: `Improve Sprint ${args.sprintNumber} spec`,
  agent: {
    name: 'general-purpose',
    prompt: {
      role: 'Sprint spec improver for GemKeep',
      task: [
        `Improve the Sprint ${args.sprintNumber} specification to address quality gaps.`,
        '',
        'Quality gaps to address:',
        ...(args.specQuality.gaps || []).map(g => `- ${g}`),
        '',
        'Missing elements to add:',
        ...(args.specQuality.missingElements || []).map(m => `- ${m}`),
        '',
        'Recommendations:',
        ...(args.specQuality.recommendations || []).map(r => `- ${r}`),
        '',
        'IMPROVEMENT RULES:',
        '1. Add specific success criteria where missing (with exact observable outcomes)',
        '2. Add edge case specifications (error paths, empty states)',
        '3. Add test layer annotations (which features need unit/integration/E2E)',
        '4. Reference architecture constraints from sprint-plan.md',
        '5. Cross-reference with code-improvements.md for affected modules',
        '6. Add data model/schema changes needed',
        '7. DO NOT remove or change existing valid content — only ADD',
        '8. Keep the same document structure and style',
      ].join('\n'),
      context: {
        sprintNumber: args.sprintNumber,
        currentScore: args.specQuality.score,
      },
      instructions: [
        `Read: ${args.sprintSpecPath}`,
        `Read: ${args.sprintPlanPath}`,
        `Read: ${args.improvementsPath}`,
        'Read: docs/low-level-design.md for current architecture',
        'Apply improvements to the sprint spec file',
        'Add missing success criteria, edge cases, test layer annotations',
        'Report what was added/changed',
      ],
      outputFormat: 'JSON with improvementsMade (array of string), sectionsAdded (array of string), summary (string)',
    },
    outputSchema: {
      type: 'object',
      required: ['improvementsMade', 'summary'],
      properties: {
        improvementsMade: { type: 'array', items: { type: 'string' } },
        sectionsAdded: { type: 'array', items: { type: 'string' } },
        summary: { type: 'string' },
      },
    },
  },
  io: {
    inputJsonPath: `tasks/${taskCtx.effectId}/input.json`,
    outputJsonPath: `tasks/${taskCtx.effectId}/result.json`,
  },
}));

export const scanAntiPatternsTask = defineTask('scan-anti-patterns', (args, taskCtx) => ({
  kind: 'agent',
  title: 'Scan for anti-patterns in touched modules',
  agent: {
    name: 'general-purpose',
    prompt: {
      role: 'Code quality analyst checking against known anti-patterns and identifying bundling opportunities',
      task: [
        'Read the code-improvements.md document and identify which UNRESOLVED issues are in modules',
        'that this sprint will touch. These must be addressed before or during implementation.',
        '',
        'IMPORTANT: Skip items marked with [RESOLVED]. Only report unresolved items.',
        '',
        'Categories to check (from code-improvements.md):',
        '- DUP-*: Code duplication (HIGH items must be fixed before adding more)',
        '- ABS-*: Abstraction issues (prevent new code from worsening them)',
        '- INC-*: Inconsistencies (new code must follow the correct pattern)',
        '- MIS-*: Missing abstractions (create them if the feature needs them)',
        '- DEAD-*: Dead code (remove if encountered)',
        '- BUG-*: Known bugs (fix before building on broken code)',
        '',
        'For each relevant issue, indicate severity and whether it blocks implementation.',
        '',
        'BUNDLING OPPORTUNITIES:',
        'Also identify TRIVIAL and SMALL unresolved items that touch files the sprint',
        'will modify anyway, even if they are not blocking. These are cheap to fix while',
        'the file is already open. Label these as action: "bundle" with a reason explaining',
        'why it is cheap to do now.',
      ].join('\n'),
      context: { touchedModules: args.touchedModules },
      instructions: [
        `Read: ${args.improvementsPath}`,
        `Read: ${args.sprintSpecPath}`,
        'Skip all items marked [RESOLVED]',
        'Cross-reference UNRESOLVED improvement items with touched modules',
        'Classify each as: must-fix-first, fix-during, bundle, or defer',
        'For "bundle" items, explain why they are cheap to do in this sprint',
        'Return structured list',
      ],
      outputFormat: 'JSON with relevantIssues (array of {id, title, severity, category, module, action: "must-fix-first"|"fix-during"|"bundle"|"defer", bundleReason?: string}), relevantIssueCount (number), bundleCount (number), summary (string)',
    },
    outputSchema: {
      type: 'object',
      required: ['relevantIssues', 'relevantIssueCount', 'summary'],
      properties: {
        relevantIssues: { type: 'array' },
        relevantIssueCount: { type: 'number' },
        bundleCount: { type: 'number' },
        summary: { type: 'string' },
      },
    },
  },
  io: {
    inputJsonPath: `tasks/${taskCtx.effectId}/input.json`,
    outputJsonPath: `tasks/${taskCtx.effectId}/result.json`,
  },
}));

export const architectureComplianceTask = defineTask('arch-compliance', (args, taskCtx) => ({
  kind: 'agent',
  title: 'Architecture compliance check',
  agent: {
    name: 'general-purpose',
    prompt: {
      role: 'Architecture auditor for GemKeep',
      task: [
        'Check current codebase against sprint-plan.md architectural invariants:',
        '',
        '1. Per-project context isolation: AppState uses HashMap<String, ProjectContext>',
        '   (not global Arc<AtomicBool> for indexing control)',
        '2. Repository pattern: All DB access through photos/repository.rs',
        '   (no inline SQL in commands/*.rs)',
        '3. Error handling: thiserror for domain errors, anyhow for propagation',
        '   (no unwrap() on fallible operations, no silent error swallowing)',
        '4. Modularity: Decision engine as standalone module, stack operations composable',
        '5. Commit format: feat|fix|refactor|test|docs|chore: <=50 chars',
        '6. No global state for project-specific data',
        '',
        'Report violations and their severity.',
      ].join('\n'),
      context: { sprintNumber: args.sprintNumber },
      instructions: [
        `Read: ${args.sprintPlanPath}`,
        'Read: src-tauri/src/state.rs',
        'Read: src-tauri/src/commands/mod.rs',
        'Read: src-tauri/src/photos/repository.rs (first 50 lines)',
        'Read: src-tauri/src/commands/decisions.rs (first 50 lines)',
        'Check each architectural invariant',
        'Report violations with file:line references',
      ],
      outputFormat: 'JSON with violations (array of string), violationCount (number), constraints (array of string), summary (string)',
    },
    outputSchema: {
      type: 'object',
      required: ['violations', 'violationCount', 'summary'],
      properties: {
        violations: { type: 'array', items: { type: 'string' } },
        violationCount: { type: 'number' },
        constraints: { type: 'array', items: { type: 'string' } },
        summary: { type: 'string' },
      },
    },
  },
  io: {
    inputJsonPath: `tasks/${taskCtx.effectId}/input.json`,
    outputJsonPath: `tasks/${taskCtx.effectId}/result.json`,
  },
}));

export const refactorWithTddTask = defineTask('refactor-tdd', (args, taskCtx) => ({
  kind: 'agent',
  title: `Refactor: ${args.issue.id} — ${args.issue.title}`,
  agent: {
    name: 'general-purpose',
    prompt: {
      role: 'Refactoring developer following TDD safety net',
      task: [
        `Refactor code to fix issue ${args.issue.id}: ${args.issue.title}`,
        '',
        'Process:',
        '1. Run existing tests to establish green baseline',
        '2. Apply the refactoring (no behavior changes)',
        '3. Run tests again — must still pass',
        '4. If the refactoring changes an API, update call sites',
        '',
        'This is a REFACTORING — behavior must not change.',
        'If tests break, the refactoring is wrong, not the tests.',
      ].join('\n'),
      context: {
        issue: args.issue,
        testCommand: args.testCommand,
      },
      instructions: [
        'Read the files referenced in the issue',
        'Apply the fix described in the issue',
        `Run: ${args.testCommand}`,
        'Run: cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings',
        'Run: cargo fmt --manifest-path src-tauri/Cargo.toml',
        'Report what changed',
      ],
      outputFormat: 'JSON with filesModified (array), testsPass (boolean), summary (string)',
    },
    outputSchema: {
      type: 'object',
      required: ['filesModified', 'testsPass', 'summary'],
    },
  },
  io: {
    inputJsonPath: `tasks/${taskCtx.effectId}/input.json`,
    outputJsonPath: `tasks/${taskCtx.effectId}/result.json`,
  },
}));

export const analyzeFeatureSpecTask = defineTask('analyze-feature-spec', (args, taskCtx) => ({
  kind: 'agent',
  title: `Analyze feature: ${args.feature}`,
  agent: {
    name: 'general-purpose',
    prompt: {
      role: 'Test architect for GemKeep',
      task: [
        'Read the sprint spec and extract testable behavioral requirements for this feature.',
        'Focus on OBSERVABLE BEHAVIORS — what the user/caller sees.',
        '',
        'ANTI-PATTERN AWARENESS:',
        'The following known issues exist in the codebase. Your spec analysis must warn',
        'if this feature risks repeating any of them:',
        '',
        ...(args.antiPatterns || []).map(p => `- ${p.id}: ${p.title}`),
        '',
        'ARCHITECTURE CONSTRAINTS (from sprint-plan.md):',
        ...(args.architectureConstraints || []).map(c => `- ${c}`),
        '',
        'For each behavior, describe trigger, expected outcome, and test layer.',
        'Flag anti-pattern risks as warnings.',
        '',
        'IMPACT ANALYSIS — CRITICAL:',
        '- Search for ALL existing tests that test the behavior being changed',
        '- List them in impactedTests with the reason they will break',
        '- These tests must be deleted or updated during GREEN phase',
      ].join('\n'),
      context: {
        feature: args.feature,
        sprintNumber: args.sprintNumber,
      },
      instructions: [
        `Read: ${args.sprintSpecPath}`,
        'Read: docs/testing-rules.md',
        'Extract behavioral requirements',
        'SEARCH existing test files for tests that assert behavior being changed',
        'Check each behavior against anti-pattern list',
        'Note architecture constraints that apply',
        'Return structured analysis with warnings and impacted tests',
      ],
      outputFormat: 'JSON with behaviors (array of {trigger, expectedOutcome, testLayer}), impactedTests (array of {file, testName, reason}), antiPatternWarnings (array of string), architectureNotes (array of string), testLayers (array of string), summary (string)',
    },
    outputSchema: {
      type: 'object',
      required: ['behaviors', 'summary'],
      properties: {
        behaviors: { type: 'array' },
        impactedTests: { type: 'array' },
        antiPatternWarnings: { type: 'array', items: { type: 'string' } },
        architectureNotes: { type: 'array', items: { type: 'string' } },
        testLayers: { type: 'array', items: { type: 'string' } },
        summary: { type: 'string' },
      },
    },
  },
  io: {
    inputJsonPath: `tasks/${taskCtx.effectId}/input.json`,
    outputJsonPath: `tasks/${taskCtx.effectId}/result.json`,
  },
}));

export const postGreenArchCheckTask = defineTask('post-green-arch-check', (args, taskCtx) => ({
  kind: 'agent',
  title: `Post-GREEN architecture check: ${args.feature}`,
  agent: {
    name: 'general-purpose',
    prompt: {
      role: 'Architecture auditor checking for newly introduced anti-patterns',
      task: [
        'Check the GREEN implementation for newly introduced anti-patterns.',
        '',
        'Compare the diff since RED commit against the code-improvements.md categories:',
        '1. DUPLICATION: Did the implementation copy-paste existing code?',
        '2. ABSTRACTION: Did it bypass the repository layer or add inline SQL?',
        '3. INCONSISTENCY: Does it follow existing error handling patterns?',
        '4. MISSING ABSTRACTION: Did it hardcode values that should be constants?',
        '5. GLOBAL STATE: Did it use global state for project-specific data?',
        '',
        'This is a GATE — new anti-patterns should be flagged for review.',
      ].join('\n'),
      context: { feature: args.feature, redCommitRef: args.redCommitRef },
      instructions: [
        `Run: git diff ${args.redCommitRef} HEAD -- "*.rs" "*.ts" "*.svelte"`,
        `Read: ${args.improvementsPath}`,
        'Check diff against each anti-pattern category',
        'Report new issues found',
      ],
      outputFormat: 'JSON with newIssues (array of string), passed (boolean), summary (string)',
    },
    outputSchema: {
      type: 'object',
      required: ['passed', 'summary'],
    },
  },
  io: {
    inputJsonPath: `tasks/${taskCtx.effectId}/input.json`,
    outputJsonPath: `tasks/${taskCtx.effectId}/result.json`,
  },
}));

export const runFullTestSuiteTask = defineTask('full-test-suite', (args, taskCtx) => ({
  kind: 'agent',
  title: 'Full test suite + quality checks',
  agent: {
    name: 'general-purpose',
    prompt: {
      role: 'Quality gate enforcer',
      task: 'Run the full test suite, clippy, and fmt check.',
      context: { testCommand: args.testCommand },
      instructions: [
        `Run: ${args.testCommand}`,
        'Run: cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings',
        'Run: cargo fmt --manifest-path src-tauri/Cargo.toml --check',
        'Report results',
      ],
      outputFormat: 'JSON with testsPass (boolean), clippyClean (boolean), fmtClean (boolean), testCount (number), summary (string)',
    },
    outputSchema: {
      type: 'object',
      required: ['testsPass', 'summary'],
    },
  },
  io: {
    inputJsonPath: `tasks/${taskCtx.effectId}/input.json`,
    outputJsonPath: `tasks/${taskCtx.effectId}/result.json`,
  },
}));

export const finalArchitectureGateTask = defineTask('final-arch-gate', (args, taskCtx) => ({
  kind: 'agent',
  title: 'Final architecture compliance gate',
  agent: {
    name: 'general-purpose',
    prompt: {
      role: 'Sprint completion auditor',
      task: [
        'Final architecture compliance check for the entire sprint.',
        '',
        'Check ALL sprint-plan.md invariants:',
        '1. Per-project context isolation',
        '2. Repository pattern (no inline SQL in commands)',
        '3. Error handling consistency (thiserror/anyhow)',
        '4. No new code duplication (compare against code-improvements.md)',
        '5. All success criteria from sprint spec are met',
        '',
        'Also check for NEW anti-patterns introduced during this sprint',
        'that should be added to code-improvements.md for future reference.',
      ].join('\n'),
      context: {
        sprintNumber: args.sprintNumber,
        featureResults: args.featureResults,
      },
      instructions: [
        `Read: ${args.sprintPlanPath}`,
        `Read: ${args.improvementsPath}`,
        'Scan commands/*.rs for inline SQL',
        'Scan for global state usage',
        'Check error handling patterns',
        'Report compliance and any new issues',
      ],
      outputFormat: 'JSON with compliant (boolean), newAntiPatterns (array of string), summary (string)',
    },
    outputSchema: {
      type: 'object',
      required: ['compliant', 'summary'],
    },
  },
  io: {
    inputJsonPath: `tasks/${taskCtx.effectId}/input.json`,
    outputJsonPath: `tasks/${taskCtx.effectId}/result.json`,
  },
}));

export const updateImprovementsDocTask = defineTask('update-improvements-doc', (args, taskCtx) => ({
  kind: 'agent',
  title: 'Update code-improvements.md with resolved items',
  agent: {
    name: 'general-purpose',
    prompt: {
      role: 'Documentation updater for code-improvements.md',
      task: [
        'Update code-improvements.md to mark items resolved during this sprint.',
        '',
        'For each resolved item ID, add "[RESOLVED - YYYY-MM-DD]" to its heading.',
        'Update the summary table counts (Resolved column).',
        'Add the items to the "Resolved Items" section with a brief description.',
        '',
        `Items to mark resolved: ${(args.resolvedItems || []).join(', ')}`,
        `Sprint: ${args.sprintNumber}`,
      ].join('\n'),
      context: {
        resolvedItems: args.resolvedItems,
        sprintNumber: args.sprintNumber,
      },
      instructions: [
        `Read: ${args.improvementsPath}`,
        'For each resolved item, add [RESOLVED - <today>] to its heading',
        'Update the summary table resolved/remaining counts',
        'Add to the Resolved Items section',
        `Write updated file to: ${args.improvementsPath}`,
        'Commit with: docs: update code-improvements resolved items',
      ],
      outputFormat: 'JSON with updatedCount (number), summary (string)',
    },
    outputSchema: {
      type: 'object',
      required: ['updatedCount', 'summary'],
    },
  },
  io: {
    inputJsonPath: `tasks/${taskCtx.effectId}/input.json`,
    outputJsonPath: `tasks/${taskCtx.effectId}/result.json`,
  },
}));

export const reflectOnFeedbackTask = defineTask('reflect-on-feedback', (args, taskCtx) => ({
  kind: 'agent',
  title: `Reflect on user feedback for Sprint ${args.sprintNumber}`,
  agent: {
    name: 'general-purpose',
    prompt: {
      role: 'Senior developer reflecting on user feedback for GemKeep (Tauri + Svelte + Rust)',
      task: [
        'Analyze the user feedback about the sprint implementation.',
        'Read the relevant source files to understand the current state.',
        'Propose specific, actionable changes to address the feedback.',
        '',
        'IMPORTANT PRINCIPLES:',
        '- Cross-screen consistency: shared behaviors must live in shared utilities.',
        '  If the same behavior exists in multiple screens, extract it to a shared module.',
        '- Each proposed change should be a single, testable behavioral unit.',
        '- Identify which files need modification and what shared utilities to create/update.',
        '- Propose changes in dependency order (shared utils first, then consumers).',
        '',
        'For each proposed change, describe:',
        '- The observable behavioral change (what the user will see differently)',
        '- The test approach (what to assert)',
        '- Files to modify',
        '- Dependencies on other proposed changes',
      ].join('\n'),
      context: {
        feedback: args.feedback,
        sprintNumber: args.sprintNumber,
        sprintSpecPath: args.sprintSpecPath,
        featureResults: args.featureResults,
        testCommand: args.testCommand,
      },
      instructions: [
        'Read the user feedback carefully',
        `Read the sprint spec: ${args.sprintSpecPath}`,
        'Read docs/testing-philosophy.md (especially Rule 16 and Rule 17)',
        'Read relevant source files mentioned in or implied by the feedback',
        'Read src/lib/stores/navigation.svelte.ts for navigation patterns',
        'Read src/lib/utils/ for existing shared utilities',
        'Propose changes as an ordered list, with shared utilities first',
        'Each change should be a discrete behavioral TDD unit',
        'Report affected files and estimated scope',
      ],
      outputFormat: 'JSON with proposedChanges (array of strings — ordered), behaviors (array of {trigger, expectedOutcome, testLayer}), filesAffected (array), sharedUtilities (array), estimatedScope (string: "small"/"medium"/"large"), summary (string)',
    },
    outputSchema: {
      type: 'object',
      required: ['proposedChanges', 'summary'],
      properties: {
        proposedChanges: { type: 'array', items: { type: 'string' } },
        behaviors: { type: 'array' },
        filesAffected: { type: 'array', items: { type: 'string' } },
        sharedUtilities: { type: 'array', items: { type: 'string' } },
        estimatedScope: { type: 'string' },
        summary: { type: 'string' },
      },
    },
  },
  io: {
    inputJsonPath: `tasks/${taskCtx.effectId}/input.json`,
    outputJsonPath: `tasks/${taskCtx.effectId}/result.json`,
  },
}));

export const cleanupTask = defineTask('cleanup', (args, taskCtx) => ({
  kind: 'agent',
  title: `Cleanup: Sprint ${args.sprintNumber}`,
  agent: {
    name: 'general-purpose',
    prompt: {
      role: 'Cleanup operator for GemKeep sprint',
      task: [
        'Post-sprint cleanup:',
        '1. Run `git status` — report any uncommitted changes (there should be none)',
        '2. Check docs/sprints/ for temporary spec/plan files from this sprint:',
        '   - Files like *-spec.md, *-plan.md, *-analysis.md that were created during execution',
        '   - If the sprint is complete, these are execution artifacts — delete them',
        '   - Do NOT delete sprint-NN.md files (permanent sprint specs)',
        '3. Report what was cleaned up',
      ].join('\n'),
      context: { sprintNumber: args.sprintNumber },
      instructions: [
        'Run: git status --short',
        'Run: ls docs/sprints/ | grep -v "sprint-[0-9]"',
        'Delete temporary execution docs',
        'Report results',
      ],
      outputFormat: 'JSON with filesDeleted (array), uncommittedFiles (array), summary (string)',
    },
    outputSchema: {
      type: 'object',
      required: ['summary'],
    },
  },
  io: {
    inputJsonPath: `tasks/${taskCtx.effectId}/input.json`,
    outputJsonPath: `tasks/${taskCtx.effectId}/result.json`,
  },
}));
