const test = require('node:test');
const assert = require('node:assert/strict');

const {
  GENERATION_CONTEXT_SCHEMA_VERSION,
  buildAIRepairAuditMetadata,
  buildAIReviewAuditMetadata,
  buildGeneratorAuditMetadata,
  buildWeeklyPlanGenerationContext,
} = require('../../src/domain/programGeneration/weeklyPlanGenerationAudit');
const {
  calculateWeeklyPlanAnalytics,
} = require('../../src/domain/programGeneration/weeklyPlanAnalytics');
const {
  applyBackendCalculatedDurationsToPlanDocument,
  evaluateWeeklyPlanDurationGate,
} = require('../../src/domain/programGeneration/weeklyPlanBackendDuration');
const {
  clone,
  createAiOutput,
  createContext,
  createNormalizedDocument,
  createPassReview,
} = require('./weeklyPlanAiV4Fixtures');

function createAuditFixture() {
  const context = createContext({
    coachInputs: {
      doctrineId: null,
      doctrineVersion: null,
      derivedFromDoctrineVersion: null,
      promptVersion: 'ai-weekly-plan-builder-prompt-v2.4.0',
    },
  });
  const generatedAIOutput = createAiOutput();
  generatedAIOutput.workouts[0].blocks[0].exercises[0].setTemplates[0] = {
    ...generatedAIOutput.workouts[0].blocks[0].exercises[0].setTemplates[0],
    targetReps: null,
    targetSeconds: 120,
  };
  const initialDocument = createNormalizedDocument({ targetSeconds: 120 });
  const analytics = calculateWeeklyPlanAnalytics({
    generatedAIOutput,
    generatedPlanDocument: initialDocument,
    context,
  });
  const generatedPlanDocument =
    applyBackendCalculatedDurationsToPlanDocument(
      initialDocument,
      analytics
    );
  const durationGate = evaluateWeeklyPlanDurationGate(analytics);
  return {
    context,
    generatedAIOutput,
    generatedPlanDocument,
    validation: {
      schemaValidation: { ok: true, issues: [] },
      semanticValidation: {
        ok: true,
        issues: [],
        summary: { notesPolicy: {} },
      },
      poolValidation: {
        ok: true,
        issues: [],
        uniqueExerciseIds: ['ex_bench'],
      },
    },
    businessRulesValidation: { ok: true, issueCount: 0 },
    analytics,
    initialDurationGate: durationGate,
    finalDurationGate: durationGate,
    generator: {
      type: 'openai',
      model: 'generation-model',
      responseId: 'resp_generation',
      usage: {
        inputTokens: 10,
        outputTokens: 10,
        totalTokens: 20,
        reasoningTokens: 0,
      },
    },
  };
}

function createRepairMetadata(trigger, initialReviewSummary = null) {
  return {
    enabled: true,
    outcome: 'PASSED',
    trigger,
    attempts: 1,
    maxAttempts: 1,
    promptVersion: 'ai-weekly-plan-repair-prompt-v1.3.0',
    contractVersion: 4,
    outputSchemaVersion: 4,
    initialReviewSummary,
    provider: {
      type: 'openai',
      model: 'repair-model',
      responseId: 'resp_repair',
      usage: {
        inputTokens: 10,
        outputTokens: 10,
        totalTokens: 20,
        reasoningTokens: 0,
      },
    },
  };
}

test('Generation Context V9 records backend-only V4 versions and doctrine none', () => {
  const result = buildWeeklyPlanGenerationContext({
    ...createAuditFixture(),
    aiReview: { enabled: false, reviewAttempts: 0 },
    aiRepair: {
      enabled: false,
      outcome: 'BYPASSED',
      trigger: null,
      attempts: 0,
      maxAttempts: 1,
      promptVersion: null,
      contractVersion: 4,
      outputSchemaVersion: 4,
      initialReviewSummary: null,
      provider: null,
    },
  });

  assert.equal(GENERATION_CONTEXT_SCHEMA_VERSION, 9);
  assert.equal(result.schemaVersion, 9);
  assert.equal(result.aiContractVersion, 4);
  assert.equal(result.aiOutputSchemaVersion, 4);
  assert.equal(result.validationSummary.analytics.schemaVersion, 3);
  assert.equal(result.doctrineMode, 'none');
  assert.equal(result.doctrineId, null);
  assert.equal(result.doctrineVersion, null);
  assert.equal(result.derivedFromDoctrineVersion, null);
  assert.equal(result.durationGate.final.ok, true);
});

test('DURATION repair metadata allows null Initial Review and one final Review', () => {
  const aiReview = {
    ...createPassReview(),
    reviewAttempts: 1,
  };
  const result = buildWeeklyPlanGenerationContext({
    ...createAuditFixture(),
    aiReview,
    aiRepair: createRepairMetadata('DURATION'),
  });

  assert.equal(result.aiRepair.trigger, 'DURATION');
  assert.equal(result.aiRepair.initialReviewSummary, null);
  assert.equal(result.aiReview.reviewAttempts, 1);
  assert.equal(result.repairAttempts, 1);
});

test('REVIEW repair metadata requires Initial Review and two Reviews', () => {
  const aiReview = {
    ...createPassReview(),
    reviewAttempts: 2,
  };
  const initialReviewSummary = {
    decision: 'REPAIR_REQUIRED',
    issueCount: 1,
    severityCounts: { INFO: 0, LOW: 0, MEDIUM: 0, HIGH: 1 },
    categoryCounts: { EXERCISE_REDUNDANCY: 1 },
  };
  const result = buildWeeklyPlanGenerationContext({
    ...createAuditFixture(),
    aiReview,
    aiRepair: createRepairMetadata('REVIEW', initialReviewSummary),
  });

  assert.equal(result.aiRepair.trigger, 'REVIEW');
  assert.deepEqual(result.aiRepair.initialReviewSummary, initialReviewSummary);
  assert.equal(result.aiReview.reviewAttempts, 2);
});

test('repair metadata rejects attempts above one and inconsistent triggers', () => {
  const duration = createRepairMetadata('DURATION');
  duration.attempts = 2;
  assert.throws(() => buildAIRepairAuditMetadata(duration));

  const review = createRepairMetadata('REVIEW');
  assert.throws(() => buildAIRepairAuditMetadata(review));
});

test('audit construction is deterministic and does not mutate inputs', () => {
  const input = {
    ...createAuditFixture(),
    aiReview: { enabled: false, reviewAttempts: 0 },
    aiRepair: {
      enabled: false,
      outcome: 'BYPASSED',
      trigger: null,
      attempts: 0,
      maxAttempts: 1,
      promptVersion: null,
      contractVersion: 4,
      outputSchemaVersion: 4,
      initialReviewSummary: null,
      provider: null,
    },
  };
  const before = clone(input);
  assert.deepEqual(
    buildWeeklyPlanGenerationContext(input),
    buildWeeklyPlanGenerationContext(input)
  );
  assert.deepEqual(input, before);
});

test('generator audit metadata normalizes absent provider fields to null', () => {
  assert.deepEqual(buildGeneratorAuditMetadata({ type: 'mock' }), {
    type: 'mock',
    model: null,
    responseId: null,
    usage: {
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
      reasoningTokens: null,
    },
  });
});

test('Review audit keeps only allowlisted PASS counts and provider metadata', () => {
  const result = buildAIReviewAuditMetadata({
    ...createPassReview(),
    reviewAttempts: 1,
    privateValue: 'must not persist',
  });

  assert.equal(result.enabled, true);
  assert.equal(result.decision, 'PASS');
  assert.equal(result.reviewAttempts, 1);
  assert.equal(Object.hasOwn(result, 'review'), false);
  assert.equal(Object.hasOwn(result, 'privateValue'), false);
});

test('BYPASSED and NOT_REQUIRED repair metadata remain exact and fail closed', () => {
  const bypassed = {
    enabled: true,
    outcome: 'BYPASSED',
    trigger: null,
    attempts: 0,
    maxAttempts: 1,
    promptVersion: null,
    contractVersion: 4,
    outputSchemaVersion: 4,
    initialReviewSummary: null,
    provider: null,
  };
  assert.deepEqual(buildAIRepairAuditMetadata(bypassed), bypassed);

  const notRequired = {
    ...bypassed,
    outcome: 'NOT_REQUIRED',
    initialReviewSummary: {
      decision: 'PASS',
      issueCount: 0,
      severityCounts: { INFO: 0, LOW: 0, MEDIUM: 0, HIGH: 0 },
      categoryCounts: {},
    },
  };
  assert.deepEqual(
    buildAIRepairAuditMetadata(notRequired),
    notRequired
  );

  assert.throws(() =>
    buildAIRepairAuditMetadata({ ...bypassed, attempts: 1 })
  );
  assert.throws(() =>
    buildAIRepairAuditMetadata({
      ...notRequired,
      provider: { type: 'openai' },
    })
  );
});

test('Generation Context rejects mismatched Evaluation Policy identity', () => {
  const fixture = createAuditFixture();
  fixture.context = {
    ...fixture.context,
    evaluationPolicy: {
      ...fixture.context.evaluationPolicy,
      id: 'wrong-policy',
    },
  };

  assert.throws(() =>
    buildWeeklyPlanGenerationContext({
      ...fixture,
      aiReview: { enabled: false, reviewAttempts: 0 },
      aiRepair: {
        enabled: false,
        outcome: 'BYPASSED',
        trigger: null,
        attempts: 0,
        maxAttempts: 1,
        promptVersion: null,
        contractVersion: 4,
        outputSchemaVersion: 4,
        initialReviewSummary: null,
        provider: null,
      },
    })
  );
});

test('reviewAttempts remains limited to the coherent zero, one, or two paths', () => {
  assert.throws(() =>
    buildAIReviewAuditMetadata({
      ...createPassReview(),
      reviewAttempts: 3,
    })
  );

  const reviewRepair = createRepairMetadata('REVIEW', {
    decision: 'REPAIR_REQUIRED',
    issueCount: 1,
    severityCounts: { INFO: 0, LOW: 0, MEDIUM: 0, HIGH: 1 },
    categoryCounts: { EXERCISE_REDUNDANCY: 1 },
  });
  assert.doesNotThrow(() =>
    buildWeeklyPlanGenerationContext({
      ...createAuditFixture(),
      aiReview: { ...createPassReview(), reviewAttempts: 2 },
      aiRepair: reviewRepair,
    })
  );
});
