const test = require('node:test');
const assert = require('node:assert/strict');

const {
  PROGRAM_REPAIR_CONTEXT_SCHEMA_VERSION,
  ProgramRepairContextError,
  buildProgramRepairContext,
} = require('../../src/domain/programGeneration/programRepairContextBuilder');
const {
  calculateWeeklyPlanAnalytics,
} = require('../../src/domain/programGeneration/weeklyPlanAnalytics');
const {
  clone,
  createAiOutput,
  createContext,
  createNormalizedDocument,
} = require('./weeklyPlanAiV4Fixtures');

function createDurationFixture(targetSeconds = 1) {
  const context = createContext();
  const generatedAIOutput = createAiOutput();
  generatedAIOutput.workouts[0].blocks[0].exercises[0].setTemplates[0] = {
    ...generatedAIOutput.workouts[0].blocks[0].exercises[0].setTemplates[0],
    targetReps: null,
    targetSeconds,
  };
  const generatedPlanDocument = createNormalizedDocument({ targetSeconds });
  const analytics = calculateWeeklyPlanAnalytics({
    generatedAIOutput,
    generatedPlanDocument,
    context,
  });
  return { context, generatedAIOutput, generatedPlanDocument, analytics };
}

function createRepairRequiredReview() {
  const review = {
    schemaVersion: 3,
    decision: 'REPAIR_REQUIRED',
    requiresRepair: true,
    reviewSummary: 'Exercise order requires one qualitative repair.',
    issues: [
      {
        issueIndex: 1,
        category: 'EXERCISE_ORDER_SUPERSET',
        severity: 'HIGH',
        path: '/plan/workouts/0/blocks/0',
        message: 'The exercise order is not coherent.',
        repairability: 'REPAIRABLE',
        suggestedAction: 'Reorder the useful exercises.',
      },
    ],
  };
  return {
    enabled: true,
    review,
    decision: 'REPAIR_REQUIRED',
    requiresRepair: true,
    contractVersion: 3,
    outputSchemaVersion: 3,
  };
}

test('Repair Context V4 builds a DURATION trigger without Initial Review', () => {
  const fixture = createDurationFixture();
  const result = buildProgramRepairContext({
    ...fixture,
    trigger: 'DURATION',
  });

  assert.equal(PROGRAM_REPAIR_CONTEXT_SCHEMA_VERSION, 4);
  assert.deepEqual(result.repairControl, {
    maxAttempts: 1,
    attemptNumber: 1,
    outputMode: 'full_replacement',
    trigger: 'DURATION',
  });
  assert.equal(result.repairBrief.review, null);
  assert.equal(result.repairBrief.duration.status, 'CORRECTION_REQUIRED');
  assert.equal(result.repairBrief.duration.workouts[0].direction, 'INCREASE');
  assert.deepEqual(
    result.repairBrief.duration.workouts[0].acceptableDurationMinutes,
    { minimum: 13, maximum: 15 }
  );
  assert.equal(
    JSON.stringify(result).includes('repairDesignTargetMinutes'),
    false
  );
  assert.equal(JSON.stringify(result).includes('203'), false);
});

test('Repair Context V4 derives DECREASE and surplus for over-target duration', () => {
  const fixture = createDurationFixture(1200);
  const result = buildProgramRepairContext({
    ...fixture,
    trigger: 'DURATION',
  });
  const duration = result.repairBrief.duration.workouts[0];

  assert.equal(duration.direction, 'DECREASE');
  assert.equal(duration.minimumMinutesToAcceptableRange > 0, true);
});

test('DURATION Repair Context allowlists mandatory debug-contract issues', () => {
  const fixture = createDurationFixture();
  const result = buildProgramRepairContext({
    ...fixture,
    trigger: 'DURATION',
    debugContractValidation: {
      ok: false,
      issues: [
        {
          code: 'FALSE_OMISSION_DECLARATION',
          path: 'muscleDistributionDebug.omittedBodyParts',
          message: 'A directly trained area cannot be declared omitted.',
          actual: 'chest',
          privateField: 'must not be projected',
        },
      ],
    },
  });

  assert.deepEqual(result.repairBrief.debugContract, {
    requiresCorrection: true,
    issues: [
      {
        code: 'FALSE_OMISSION_DECLARATION',
        path: 'muscleDistributionDebug.omittedBodyParts',
        message: 'A directly trained area cannot be declared omitted.',
      },
    ],
  });
});

test('Repair Context V4 builds REVIEW trigger only from duration-valid Analytics', () => {
  const fixture = createDurationFixture(120);
  const result = buildProgramRepairContext({
    ...fixture,
    trigger: 'REVIEW',
    initialReview: createRepairRequiredReview(),
  });

  assert.equal(result.repairControl.trigger, 'REVIEW');
  assert.equal(result.repairBrief.duration.status, 'ACCEPTABLE');
  assert.equal(result.repairBrief.review.decision, 'REPAIR_REQUIRED');
  assert.equal(result.repairBrief.mandatoryIssues.length, 1);
});

test('DURATION rejects valid duration and REVIEW rejects invalid duration or missing review', () => {
  const valid = createDurationFixture(120);
  const invalid = createDurationFixture(1);

  assert.throws(
    () => buildProgramRepairContext({ ...valid, trigger: 'DURATION' }),
    ProgramRepairContextError
  );
  assert.throws(
    () =>
      buildProgramRepairContext({
        ...invalid,
        trigger: 'REVIEW',
        initialReview: createRepairRequiredReview(),
      }),
    ProgramRepairContextError
  );
  assert.throws(
    () => buildProgramRepairContext({ ...valid, trigger: 'REVIEW' }),
    ProgramRepairContextError
  );
});

test('Repair Context is deterministic, immutable, and does not mutate inputs', () => {
  const fixture = createDurationFixture();
  const before = clone(fixture);
  const first = buildProgramRepairContext({
    ...fixture,
    trigger: 'DURATION',
  });
  const second = buildProgramRepairContext({
    ...fixture,
    trigger: 'DURATION',
  });

  assert.deepEqual(first, second);
  assert.equal(Object.isFrozen(first), true);
  assert.deepEqual(fixture, before);
});

test('Repair Context fail-closes invalid context, Output V4, and Analytics identities', () => {
  const fixture = createDurationFixture();

  assert.throws(
    () =>
      buildProgramRepairContext({
        ...fixture,
        context: { ...fixture.context, schemaVersion: 3 },
        trigger: 'DURATION',
      }),
    ProgramRepairContextError
  );
  assert.throws(
    () =>
      buildProgramRepairContext({
        ...fixture,
        generatedAIOutput: {
          ...fixture.generatedAIOutput,
          schemaVersion: 3,
        },
        trigger: 'DURATION',
      }),
    ProgramRepairContextError
  );
  assert.throws(
    () =>
      buildProgramRepairContext({
        ...fixture,
        analytics: {
          ...fixture.analytics,
          schemaVersion: 2,
        },
        trigger: 'DURATION',
      }),
    ProgramRepairContextError
  );
});

test('REVIEW Repair orders mandatory and recommended issues by issueIndex', () => {
  const fixture = createDurationFixture(120);
  const initialReview = createRepairRequiredReview();
  initialReview.review.issues = [
    {
      ...initialReview.review.issues[0],
      issueIndex: 3,
      severity: 'MEDIUM',
      message: 'A secondary recommendation can improve exercise order.',
    },
    {
      ...initialReview.review.issues[0],
      issueIndex: 2,
      message: 'The second mandatory correction must be applied.',
    },
    {
      ...initialReview.review.issues[0],
      issueIndex: 1,
      message: 'The first mandatory correction must be applied.',
    },
  ];

  const result = buildProgramRepairContext({
    ...fixture,
    trigger: 'REVIEW',
    initialReview,
  });

  assert.deepEqual(
    result.repairBrief.mandatoryIssues.map((issue) => issue.issueIndex),
    [1, 2]
  );
  assert.deepEqual(
    result.repairBrief.recommendedIssues.map((issue) => issue.issueIndex),
    [3]
  );
});
