/**
 * @process gemkeep/task
 * @description Lightweight process for small features and bug fixes.
 *              Step 1: Understand — explore codebase, produce behavioral contract
 *              Step 2: Refine — iterative spec refinement until user explicitly approves
 *              Step 3: Execute — behavioral TDD (RED -> GREEN -> quality gate)
 *              Step 4: Cleanup — remove temporary docs, verify git clean
 *
 *              Use instead of sprint-development for work that doesn't need
 *              architecture scanning, spec quality scoring, or pre-flight refactoring.
 *
 * Inputs:
 *   description   - What to build or fix (free text)
 *   testCommand   - Test runner command (default: cargo test)
 *   phase         - "feature" (default) or "bugfix" (adds root-cause regression)
 *   bugDescription - (bugfix phase only) Description of the escaped bug
 *   startAt       - Skip to a step: "understand" (default), "tdd" (skip to RED/GREEN)
 */

import { defineTask } from '@a5c-ai/babysitter-sdk';
import { process as tddProcess } from './behavioral-tdd.js';

export async function process(inputs, ctx) {
  const {
    description,
    testCommand = 'cargo test --manifest-path src-tauri/Cargo.toml',
    phase = 'feature',
    bugDescription = '',
    startAt = 'understand',
  } = inputs;

  let analysis = null;

  // ════════════════════════════════════════════════════════════════════════
  // STEP 1+2: UNDERSTAND & REFINE — iterative until user says "Approve"
  // ════════════════════════════════════════════════════════════════════════

  if (startAt === 'understand') {
    ctx.log('info', 'Step 1: Understand the request and explore relevant code');

    let currentDescription = description;
    let refinementRound = 0;
    const maxRefinements = 5;

    while (refinementRound < maxRefinements) {
      refinementRound++;
      ctx.log('info', `Step 2: Spec refinement round ${refinementRound}`);

      // Analyze (or re-analyze with corrections)
      analysis = await ctx.task(understandTask, {
        description: currentDescription,
        phase,
      });
      ctx.log('info', `Analysis: ${analysis.summary}`);

      // Present plan for review
      const behaviorsList = (analysis.behaviors || [])
        .map((b, i) => `  ${i + 1}. [${b.testLayer}] ${b.trigger} -> ${b.expectedOutcome}`)
        .join('\n');

      const impactedList = (analysis.impactedTests || [])
        .map((t, i) => `  ${i + 1}. ${t.file}: "${t.testName}" — ${t.reason}`)
        .join('\n');

      const review = await ctx.breakpoint({
        tag: `plan-review-${refinementRound}`,
        question: [
          `Task: ${description}`,
          refinementRound > 1 ? `(Refinement round ${refinementRound})` : '',
          '',
          'Proposed approach:',
          analysis.approach || '(see agent output)',
          '',
          'Files to modify:',
          ...(analysis.filesToModify || []).map(f => `  - ${f}`),
          '',
          'Behavioral contract (what tests will verify):',
          behaviorsList || '  (none)',
          '',
          impactedList ? `Existing tests that will need updating:\n${impactedList}` : '',
          '',
          analysis.risks && analysis.risks.length > 0
            ? ['Risks / open questions:', ...analysis.risks.map(r => `  - ${r}`)].join('\n')
            : '',
          '',
          'Reply "Approve" to proceed to TDD, or provide corrections for another round.',
        ].filter(Boolean).join('\n'),
        title: `Spec Review (round ${refinementRound})`,
      });

      // Check if user approved or provided corrections
      const response = review?.response || review?.output || '';
      const approved = !response ||
        response.toLowerCase().trim() === 'approve' ||
        response.toLowerCase().trim() === 'approved';

      if (approved) {
        ctx.log('info', 'Spec approved — proceeding to TDD');
        break;
      }

      // User provided corrections — merge and loop
      ctx.log('info', `User corrections: ${response.substring(0, 100)}...`);
      currentDescription = `${description}\n\nACCUMULATED CORRECTIONS (round ${refinementRound}):\n${response}`;
    }

    if (!analysis) {
      ctx.log('error', 'No analysis produced — cannot proceed');
      return { success: false };
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // STEP 3: EXECUTE — delegate to behavioral-tdd
  // ════════════════════════════════════════════════════════════════════════

  // If startAt='tdd', behaviors must be provided in inputs
  const behaviors = analysis?.behaviors || inputs.behaviors || [];
  const impactedTests = analysis?.impactedTests || inputs.impactedTests || [];

  ctx.log('info', 'Step 3: Execute via behavioral TDD');
  const result = await tddProcess({
    feature: description,
    behaviors,
    impactedTests,
    testCommand,
    mode: 'new',
    phase,
    bugDescription,
  }, ctx);

  // ════════════════════════════════════════════════════════════════════════
  // STEP 4: CLEANUP — remove temporary docs, verify git clean
  // ════════════════════════════════════════════════════════════════════════

  ctx.log('info', 'Step 4: Cleanup');
  const cleanup = await ctx.task(cleanupTask, { description });
  ctx.log('info', `Cleanup: ${cleanup.summary}`);

  return result;
}

// ════════════════════════════════════════════════════════════════════════════
// TASK DEFINITIONS
// ════════════════════════════════════════════════════════════════════════════

export const understandTask = defineTask('understand-task', (args, taskCtx) => ({
  kind: 'agent',
  title: `Understand: ${args.description}`.substring(0, 80),
  agent: {
    name: 'general-purpose',
    prompt: {
      role: 'Senior developer analyzing a task for GemKeep (Tauri + Svelte + Rust)',
      task: [
        'Analyze the task description and explore the relevant codebase to produce a concrete plan.',
        '',
        'Your job:',
        '1. Understand WHAT the user wants (feature or bugfix)',
        '2. Find the relevant code — read the files that will need changes',
        '3. Determine HOW to implement it (approach)',
        '4. Extract BEHAVIORAL CONTRACT — what observable behaviors should tests verify',
        '5. Identify EXISTING TESTS that may need updating (tests that assert behavior being changed)',
        '6. Identify risks or ambiguities that need user input',
        '',
        'BEHAVIORAL CONTRACT RULES:',
        '- Each behavior = one testable input->output pair',
        '- Describe the TRIGGER (user action, API call, function invocation)',
        '- Describe the EXPECTED OUTCOME (return value, DB state, UI state, file created)',
        '- Assign the TEST LAYER (rust-unit, rust-integration, frontend-jsdom, frontend-browser, e2e)',
        '- Test BEHAVIOR not implementation',
        '',
        'IMPACT ANALYSIS — CRITICAL:',
        '- Search for ALL existing tests that test the behavior being changed',
        '- List them in impactedTests with the reason they will break',
        '- A behavior change with 0 impacted tests is suspicious — verify nothing exists',
        '',
        'APPROACH:',
        '- Be specific: name the files, functions, and structs that need changes',
        '- Prefer minimal changes — smallest diff that achieves the goal',
        '- Follow existing patterns in the codebase',
        '',
        'If the description contains USER CORRECTIONS or ACCUMULATED CORRECTIONS,',
        'those override any conflicting assumptions. Pay close attention to them.',
        '',
        args.phase === 'bugfix'
          ? 'BUG INVESTIGATION: Identify root cause. Behavioral contract covers correct behavior.\n'
          : '',
      ].filter(Boolean).join('\n'),
      context: {
        description: args.description,
        phase: args.phase,
      },
      instructions: [
        'Read the task description carefully — especially any USER CORRECTIONS section',
        'Search the codebase for relevant files (use grep/glob)',
        'Read the relevant source files to understand current state',
        'Read docs/coding-standards.md if touching Svelte code',
        'Read docs/testing-philosophy.md to understand test layer selection',
        'SEARCH existing test files for tests that assert behavior being changed',
        'Extract behavioral contract as input->output pairs',
        'List impacted existing tests',
        'Identify risks or ambiguities',
        'Return structured analysis',
      ],
      outputFormat: 'JSON with approach (string), filesToModify (array), behaviors (array of {trigger, expectedOutcome, testLayer}), impactedTests (array of {file, testName, reason}), risks (array of strings), summary (string)',
    },
    outputSchema: {
      type: 'object',
      required: ['approach', 'behaviors', 'summary'],
      properties: {
        approach: { type: 'string' },
        filesToModify: { type: 'array', items: { type: 'string' } },
        behaviors: { type: 'array' },
        impactedTests: { type: 'array' },
        risks: { type: 'array', items: { type: 'string' } },
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
  title: 'Cleanup: verify git clean, remove temporary docs',
  agent: {
    name: 'general-purpose',
    prompt: {
      role: 'Cleanup operator for GemKeep',
      task: [
        'Post-task cleanup:',
        '1. Run `git status` — report any uncommitted changes',
        '2. Check docs/sprints/ for temporary spec files (*-spec.md, *-plan.md)',
        '   - Delete temporary execution docs (NOT sprint-NN.md files)',
        '3. Report what was cleaned up',
      ].join('\n'),
      context: { description: args.description },
      instructions: [
        'Run: git status --short',
        'Delete temporary spec/plan files from docs/sprints/',
        'Report cleanup results',
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
