const test = require('node:test');
const assert = require('node:assert/strict');

const {
  ACTIONS,
  FAILURE_POLICY,
  OWNERS,
  RECOVERY_BUDGETS,
  RECOVERY_LEVELS,
  classifyFailures,
  decideRecoveryAction,
} = require('../../../src/domain/simpleWeeklyPlanPipeline/pipelineRecoveryPolicy');
const {
  BINDER_DIRECTIVE_BY_CODE,
  BINDER_RETRY_DIRECTIVES,
  CREATOR_REPAIR_VIOLATIONS,
  buildBinderRetryDirective,
  buildCreatorRepairRequest,
  buildCreatorRepairViolation,
} = require('../../../src/domain/simpleWeeklyPlanPipeline/retryDirectives');

const ALL_VERIFICATION_CODES = [
  'BOUND_PLAN_SCHEMA_INVALID',
  'BOUND_PLAN_SPAN_NOT_IN_SOURCE',
  'BOUND_PLAN_EXERCISE_OUTSIDE_POOL',
  'BOUND_PLAN_EXERCISE_TYPE_MISMATCH',
  'BOUND_PLAN_BLOCK_ARITY_INVALID',
  'BOUND_PLAN_SUPERSET_LANE_COUNT_UNSUPPORTED',
  'BOUND_PLAN_SETS_INVALID',
  'BOUND_PLAN_WORKOUT_COUNT_MISMATCH',
  'BOUND_PLAN_REST_SCOPE_INVALID',
  'BOUND_PLAN_SUPERSET_SET_COUNT_UNEQUAL',
  'BOUND_PLAN_EXERCISE_OCCURRENCE_MISSING',
  'BOUND_PLAN_EXERCISE_OCCURRENCE_SURPLUS',
];

function initialState(overrides = {}) {
  return {
    recoveryLevel: RECOVERY_LEVELS.FULL,
    creatorAttempt: 1,
    binderAttemptForPlan: 1,
    binderAttemptsTotal: 1,
    creatorRepairUsed: false,
    previousConstraintsForPlan: null,
    ...overrides,
  };
}

function failure(code) {
  return { code, path: '$', message: code };
}

// Drives the policy exactly as the orchestrator will, so budget arithmetic and
// termination are proven against the real decision function.
function simulate(failures, level = RECOVERY_LEVELS.FULL, maxSteps = 50) {
  const state = initialState({ recoveryLevel: level });
  const calls = { creator: 1, binder: 1 };
  const trail = [];

  for (let step = 0; step < maxSteps; step += 1) {
    const decision = decideRecoveryAction({ failures, state });
    trail.push(decision.action);

    if (
      decision.action === ACTIONS.FAIL_CLOSED ||
      decision.action === ACTIONS.PROCEED
    ) {
      return { calls, trail, decision };
    }
    if (decision.action === ACTIONS.RETRY_BINDER) {
      state.previousConstraintsForPlan = decision.classification.constraints;
      state.binderAttemptForPlan += 1;
      state.binderAttemptsTotal += 1;
      calls.binder += 1;
      continue;
    }
    state.creatorRepairUsed = true;
    state.creatorAttempt += 1;
    state.binderAttemptForPlan = 1;
    state.binderAttemptsTotal += 1;
    state.previousConstraintsForPlan = null;
    calls.creator += 1;
    calls.binder += 1;
  }

  throw new Error('recovery policy did not terminate');
}

// ------------------------------------------------------------------- matrix shape

test('every verification code maps to exactly one owner', () => {
  ALL_VERIFICATION_CODES.forEach((code) => {
    const classification = classifyFailures([failure(code)]);
    assert.equal(classification.codes.length, 1, code);
    assert.ok(
      classification.owner === OWNERS.BINDER ||
      classification.owner === OWNERS.CREATOR_CANDIDATE,
      `${code} must have exactly one owner`
    );
    assert.equal(
      classification.binderCodes.length + classification.creatorCodes.length,
      1,
      `${code} must not be owned twice`
    );
  });
});

test('exactly three constraints are creator-repair eligible', () => {
  const constraints = Object.values(FAILURE_POLICY)
    .map((policy) => policy.constraint)
    .filter(Boolean);

  assert.deepEqual(
    [...new Set(constraints)].sort(),
    ['POOL_ONLY_EXERCISES', 'SUPERSET_EQUAL_SETS', 'WORKOUT_COUNT']
  );
  assert.deepEqual(
    Object.keys(CREATOR_REPAIR_VIOLATIONS).sort(),
    ['POOL_ONLY_EXERCISES', 'SUPERSET_EQUAL_SETS', 'WORKOUT_COUNT']
  );
});

test('an unknown code defaults to binder ownership, never to a creator repair', () => {
  const classification = classifyFailures([failure('SOME_FUTURE_CODE')]);
  assert.equal(classification.owner, OWNERS.BINDER);
  assert.deepEqual(classification.constraints, []);
});

test('a bind carrying any binder defect is treated as a bad bind', () => {
  const classification = classifyFailures([
    failure('BOUND_PLAN_WORKOUT_COUNT_MISMATCH'),
    failure('BOUND_PLAN_SPAN_NOT_IN_SOURCE'),
  ]);
  assert.equal(classification.owner, OWNERS.BINDER);
});

// ------------------------------------------------------------------- escalation

test('no failures means proceed', () => {
  const decision = decideRecoveryAction({ failures: [], state: initialState() });
  assert.equal(decision.action, ACTIONS.PROCEED);
});

test('a creator constraint is never repaired on the first bind alone', () => {
  const decision = decideRecoveryAction({
    failures: [failure('BOUND_PLAN_WORKOUT_COUNT_MISMATCH')],
    state: initialState(),
  });
  assert.equal(decision.action, ACTIONS.RETRY_BINDER);
  assert.equal(decision.reason, 'CREATOR_CONSTRAINT_UNCONFIRMED');
});

test('a reproduced creator constraint makes a repair eligible', () => {
  const decision = decideRecoveryAction({
    failures: [failure('BOUND_PLAN_WORKOUT_COUNT_MISMATCH')],
    state: initialState({
      binderAttemptForPlan: 2,
      binderAttemptsTotal: 2,
      previousConstraintsForPlan: ['WORKOUT_COUNT'],
    }),
  });
  assert.equal(decision.action, ACTIONS.REPAIR_CREATOR);
  assert.equal(decision.reason, 'CREATOR_CONSTRAINT_REPRODUCED');
  assert.equal(decision.constraint, 'WORKOUT_COUNT');
});

test('a different constraint on the second bind is not agreement', () => {
  const decision = decideRecoveryAction({
    failures: [failure('BOUND_PLAN_SUPERSET_SET_COUNT_UNEQUAL')],
    state: initialState({
      binderAttemptForPlan: 2,
      binderAttemptsTotal: 2,
      previousConstraintsForPlan: ['WORKOUT_COUNT'],
    }),
  });
  assert.equal(decision.action, ACTIONS.FAIL_CLOSED);
  assert.equal(decision.reason, 'CREATOR_CONSTRAINT_UNCONFIRMED_NO_BUDGET');
});

test('a binder defect never escalates to a creator repair', () => {
  const { calls, decision } = simulate([failure('BOUND_PLAN_SPAN_NOT_IN_SOURCE')]);
  assert.equal(decision.action, ACTIONS.FAIL_CLOSED);
  assert.equal(calls.creator, 1, 'Call #1 must not be re-run for a binder fault');
  assert.equal(calls.binder, 2);
});

// --------------------------------------------------------------------- budgets

test('a persistent creator constraint consumes exactly 2 creator and 4 binder attempts', () => {
  const { calls, trail, decision } = simulate([
    failure('BOUND_PLAN_WORKOUT_COUNT_MISMATCH'),
  ]);

  assert.deepEqual(trail, [
    ACTIONS.RETRY_BINDER,
    ACTIONS.REPAIR_CREATOR,
    ACTIONS.RETRY_BINDER,
    ACTIONS.FAIL_CLOSED,
  ]);
  assert.equal(calls.creator, RECOVERY_BUDGETS.maxCreatorAttempts);
  assert.equal(calls.binder, RECOVERY_BUDGETS.maxBinderAttemptsTotal);
  assert.equal(decision.code, 'CREATOR_WORKOUT_COUNT_UNSATISFIED');
});

test('a repaired plan still receives a full binder allowance of its own', () => {
  const { trail } = simulate([failure('BOUND_PLAN_WORKOUT_COUNT_MISMATCH')]);
  const repairIndex = trail.indexOf(ACTIONS.REPAIR_CREATOR);

  assert.ok(repairIndex >= 0);
  assert.equal(
    trail[repairIndex + 1],
    ACTIONS.RETRY_BINDER,
    'the repaired plan must not be discarded on its first defective bind'
  );
});

test('each creator constraint reaches its own terminal code', () => {
  const expected = {
    BOUND_PLAN_WORKOUT_COUNT_MISMATCH: 'CREATOR_WORKOUT_COUNT_UNSATISFIED',
    BOUND_PLAN_SUPERSET_SET_COUNT_UNEQUAL: 'CREATOR_SUPERSET_SET_COUNT_UNEQUAL',
    BOUND_PLAN_EXERCISE_OUTSIDE_POOL: 'CREATOR_EXERCISE_OUTSIDE_POOL',
  };

  Object.entries(expected).forEach(([code, terminalCode]) => {
    assert.equal(simulate([failure(code)]).decision.code, terminalCode, code);
  });
});

test('the policy terminates for every single-code failure at every level', () => {
  Object.values(RECOVERY_LEVELS).forEach((level) => {
    ALL_VERIFICATION_CODES.forEach((code) => {
      const { calls } = simulate([failure(code)], level);
      assert.ok(
        calls.creator <= RECOVERY_BUDGETS.maxCreatorAttempts,
        `${level}/${code} exceeded the creator budget`
      );
      assert.ok(
        calls.binder <= RECOVERY_BUDGETS.maxBinderAttemptsTotal,
        `${level}/${code} exceeded the binder budget`
      );
    });
  });
});

// ------------------------------------------------------------- recovery levels

test('OFF fails closed immediately and never retries anything', () => {
  ALL_VERIFICATION_CODES.forEach((code) => {
    const { calls, trail } = simulate([failure(code)], RECOVERY_LEVELS.OFF);
    assert.deepEqual(trail, [ACTIONS.FAIL_CLOSED], code);
    assert.equal(calls.creator, 1);
    assert.equal(calls.binder, 1);
  });
});

test('BINDER_ONLY retries the binder but never repairs the creator', () => {
  const { calls, trail } = simulate(
    [failure('BOUND_PLAN_WORKOUT_COUNT_MISMATCH')],
    RECOVERY_LEVELS.BINDER_ONLY
  );
  assert.equal(trail.includes(ACTIONS.REPAIR_CREATOR), false);
  assert.equal(calls.creator, 1);
  assert.equal(calls.binder, 2);
});

// ------------------------------------------ occurrence integrity (H-1 / H-2 / M-6)

const OMISSION = "BOUND_PLAN_EXERCISE_OCCURRENCE_MISSING";
const SURPLUS = "BOUND_PLAN_EXERCISE_OCCURRENCE_SURPLUS";

[OMISSION, SURPLUS].forEach((code) => {
  test(`${code} is binder-owned and retried first`, () => {
    const decision = decideRecoveryAction({
      failures: [failure(code)],
      state: initialState(),
    });

    assert.equal(decision.classification.owner, OWNERS.BINDER);
    assert.equal(decision.action, ACTIONS.RETRY_BINDER);
    assert.equal(decision.reason, "BINDER_DEFECT");
  });

  test(`${code} fails closed once the binder budget is spent`, () => {
    const { calls, trail, decision } = simulate([failure(code)]);

    assert.deepEqual(trail, [ACTIONS.RETRY_BINDER, ACTIONS.FAIL_CLOSED]);
    assert.equal(decision.code, code);
    assert.equal(calls.creator, 1, "the coach is never blamed for a binding fault");
    assert.equal(calls.binder, 2);
  });

  test(`${code} never escalates to creator repair at any level`, () => {
    Object.values(RECOVERY_LEVELS).forEach((level) => {
      const { trail, calls } = simulate([failure(code)], level);
      assert.equal(trail.includes(ACTIONS.REPAIR_CREATOR), false, level);
      assert.equal(calls.creator, 1, level);
    });
  });

  test(`${code} is never silently accepted with RECOVERY=OFF (M-6)`, () => {
    const decision = decideRecoveryAction({
      failures: [failure(code)],
      state: initialState({ recoveryLevel: RECOVERY_LEVELS.OFF }),
    });

    assert.equal(decision.action, ACTIONS.FAIL_CLOSED);
    assert.equal(decision.code, code);
  });
});

test("an integrity violation is never accepted just because budget was spent elsewhere (M-6)", () => {
  // Bind #1 failed for an unrelated binder defect and consumed the retry; bind #2 then
  // shows an integrity violation with no budget left. It must fail, never proceed.
  const decision = decideRecoveryAction({
    failures: [failure(OMISSION)],
    state: initialState({ binderAttemptForPlan: 2, binderAttemptsTotal: 2 }),
  });

  assert.equal(decision.action, ACTIONS.FAIL_CLOSED);
  assert.equal(decision.code, OMISSION);
});

test("a clean bind with no failures still proceeds", () => {
  const decision = decideRecoveryAction({ failures: [], state: initialState() });
  assert.equal(decision.action, ACTIONS.PROCEED);
});

// ------------------------------------------------------------------ directives

test('binder directives never reveal the expected workout count', () => {
  const everyDirective = Object.values(BINDER_RETRY_DIRECTIVES).join(' ');
  assert.equal(/\d/.test(everyDirective), false, 'no digits may appear');
  assert.equal(/sessionsPerWeek/i.test(everyDirective), false);

  const assembled = buildBinderRetryDirective(ALL_VERIFICATION_CODES);
  assert.equal(/\d/.test(assembled), false);
  assert.equal(/sessionsPerWeek/i.test(assembled), false);
  assert.match(assembled, /Bind only what the SOURCE PLAN contains/);
});

test('every verification code selects a known binder directive', () => {
  ALL_VERIFICATION_CODES.forEach((code) => {
    const key = BINDER_DIRECTIVE_BY_CODE[code];
    assert.ok(key, `${code} must map to a directive`);
    assert.ok(BINDER_RETRY_DIRECTIVES[key], `${key} must exist`);
  });
  assert.match(buildBinderRetryDirective([]), /BINDING CORRECTION/);
});

test('the creator violation describes the failure without prescribing a fix', () => {
  const violation = buildCreatorRepairViolation('WORKOUT_COUNT', {
    received: 3,
    expected: 4,
  });

  assert.equal(
    violation,
    'Workout count expected 4, produced 3. Revise the complete plan to satisfy the original requirements.'
  );
  [/\badd\b/i, /\bchest\b/i, /\bbiceps\b/i, /\bsplit\b/i].forEach((pattern) => {
    assert.equal(pattern.test(violation), false, `must not prescribe: ${pattern}`);
  });
});

test('the superset violation reports the mismatch and leaves the fix to the coach', () => {
  const violation = buildCreatorRepairViolation('SUPERSET_EQUAL_SETS', {
    location: 'workout 1, block 3',
    received: '3 and 2',
  });

  assert.match(violation, /different set counts \(3 and 2\)/);
  [/use 3/i, /use 4/i, /change .* to/i].forEach((pattern) => {
    assert.equal(pattern.test(violation), false);
  });
});

test('the repair request carries the original prompt, one violation and the previous plan', () => {
  const request = buildCreatorRepairRequest({
    systemMessage: 'ORIGINAL SYSTEM',
    userMessage: 'ORIGINAL USER INSTRUCTIONS',
    previousPlanText: '# Day 1\n- exr_x',
    constraint: 'WORKOUT_COUNT',
    facts: { received: 3, expected: 4 },
  });

  assert.equal(request.systemMessage, 'ORIGINAL SYSTEM');
  assert.match(request.userMessage, /^ORIGINAL USER INSTRUCTIONS/);
  assert.match(request.userMessage, /PREVIOUS PLAN\n# Day 1\n- exr_x$/);
  assert.equal(
    (request.userMessage.match(/Workout count expected/g) || []).length,
    1,
    'exactly one backend-controlled failure description'
  );
  assert.match(request.userMessage, /Revise the complete weekly plan/);
  assert.match(request.userMessage, /Preserve the valid coaching decisions/);
  assert.match(request.userMessage, /Re-check every instruction in this request/);
  assert.match(request.userMessage, /Never return a patch, a diff, a fragment/);
});

test('a repair request without a previous plan is refused', () => {
  assert.throws(() => buildCreatorRepairRequest({
    systemMessage: 's',
    userMessage: 'u',
    previousPlanText: '   ',
    constraint: 'WORKOUT_COUNT',
    facts: { received: 3, expected: 4 },
  }), /previous plan is required/);
});

test('an unknown constraint cannot produce a directive', () => {
  assert.throws(
    () => buildCreatorRepairViolation('SOMETHING_ELSE', {}),
    /Unknown creator repair constraint/
  );
});
