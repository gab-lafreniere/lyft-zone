const test = require('node:test');
const assert = require('node:assert/strict');

const {
  DOCTRINE_MODE_NONE,
  REPAIR_MODE_DISABLED,
  REPAIR_MODE_SINGLE,
  buildSmokePromptVariant,
  parseDoctrineModeArgument,
  parseRepairModeArgument,
  runSmoke,
} = require('../../scripts/smokeRealWeeklyPlanGenerationDebug');
const {
  createContext,
} = require('./weeklyPlanAiV4Fixtures');

class FakeOpenAI {
  constructor() {}
}

function selectProfile() {
  return {
    userId: 'user_v4',
    selectionMethod: 'test',
    context: createContext(),
  };
}

function createDebugPayload({
  stage,
  calculatedDurationMinutes,
  correctionRequired,
  repairTrigger = null,
  repairAttempted = false,
} = {}) {
  const workout = {
    workoutOrderIndex: 1,
    requestedDurationMinutes: 15,
    calculatedDurationMinutes,
    durationDifferenceMinutes: calculatedDurationMinutes - 15,
    durationUtilizationRatio: calculatedDurationMinutes / 15,
    durationAlignmentStatus: correctionRequired
      ? 'correction_required_under_target'
      : 'preferred',
    durationRequiresCorrection: correctionRequired,
  };

  return {
    stage,
    analytics: { workouts: [workout] },
    durationGate: {
      ok: !correctionRequired,
      correctionRequired,
      workouts: correctionRequired
        ? [{ ...workout, direction: 'INCREASE' }]
        : [],
    },
    repairAttempted,
    repairTrigger,
    repairProvider: repairAttempted
      ? {
          type: 'openai',
          model: 'repair-model',
          responseId: 'resp_repair',
          usage: {},
        }
      : null,
  };
}

async function runSnapshotSmoke(createDraft, argv = []) {
  return runSmoke({
    argv,
    env: { OPENAI_API_KEY: 'test-only' },
    OpenAIClient: FakeOpenAI,
    selectProfile: async () => selectProfile(),
    createDraft,
    repairProgram: async () => ({}),
    writeDebugArtifacts: async (payload) => ({
      jsonPath: `/tmp/${payload.stage}.json`,
      textPath: `/tmp/${payload.stage}.txt`,
    }),
    persistSmokeMetadata: async () => {},
  });
}

test('smoke defaults to doctrine none and repair disabled', () => {
  assert.equal(parseDoctrineModeArgument([]), DOCTRINE_MODE_NONE);
  assert.equal(parseRepairModeArgument([]), REPAIR_MODE_DISABLED);
});

test('smoke explicitly rejects doctrine full before any profile or OpenAI access', async () => {
  assert.throws(
    () => parseDoctrineModeArgument(['--doctrine-mode=full']),
    (error) => error.code === 'INVALID_DOCTRINE_MODE'
  );

  let selected = false;
  await assert.rejects(
    () =>
      runSmoke({
        argv: ['--doctrine-mode=full'],
        selectProfile: async () => {
          selected = true;
        },
      }),
    (error) => error.code === 'INVALID_DOCTRINE_MODE'
  );
  assert.equal(selected, false);
});

test('smoke none preserves the production V4 prompt unchanged', () => {
  const promptDescriptor = {
    promptVersion: 'ai-weekly-plan-builder-prompt-v2.4.0',
    systemMessage: 'System.',
    userMessage: 'Profile, duration guidance, rules, and pool.',
  };
  const result = buildSmokePromptVariant(
    promptDescriptor,
    DOCTRINE_MODE_NONE
  );

  assert.strictEqual(result.promptDescriptor, promptDescriptor);
  assert.equal(result.doctrineIncluded, false);
  assert.equal(result.doctrineCharactersRemoved, 0);
  assert.equal(result.inputCharacters, promptDescriptor.userMessage.length);
});

test('repair mode accepts only disabled or single', () => {
  assert.equal(
    parseRepairModeArgument(['--repair-mode=single']),
    REPAIR_MODE_SINGLE
  );
  assert.throws(
    () => parseRepairModeArgument(['--repair-mode=multiple']),
    (error) => error.code === 'INVALID_REPAIR_MODE'
  );
});

test('disabled mode enforces Generation 1, Review 1, Repair 0, persistence 0 real', async () => {
  const result = await runSmoke({
    argv: [],
    env: { OPENAI_API_KEY: 'test-only' },
    OpenAIClient: FakeOpenAI,
    selectProfile: async () => selectProfile(),
    createDraft: async (_payload, deps) => {
      await deps.generateWeeklyPlanAiOutput({
        promptDescriptor: {
          systemMessage: 'System.',
          userMessage: 'V4 input.',
        },
        schema: {},
      });
      await deps.runAIProgramReview({}, {});
      await assert.rejects(() => deps.runAIProgramRepair({}, {}));
      await deps.createWeeklyPlan({});
      return {};
    },
    generateOutput: async () => ({
      generatedAIOutput: {},
      generator: {
        model: 'generation-model',
        responseId: 'resp_generation',
        usage: {},
      },
    }),
    reviewProgram: async () => ({
      provider: {},
    }),
  });

  assert.deepEqual(result.openAICallCount, {
    generation: 1,
    review: 1,
    repair: 0,
  });
  assert.equal(result.realPersistenceCallCount, 0);
  assert.equal(result.fakePersistenceCallCount, 1);
  assert.equal(result.repairMode, 'disabled');
});

test('single mode permits at most one Repair and two Reviews with no real persistence', async () => {
  const result = await runSmoke({
    argv: ['--repair-mode=single'],
    env: { OPENAI_API_KEY: 'test-only' },
    OpenAIClient: FakeOpenAI,
    selectProfile: async () => selectProfile(),
    createDraft: async (_payload, deps) => {
      await deps.generateWeeklyPlanAiOutput({
        promptDescriptor: {
          systemMessage: 'System.',
          userMessage: 'V4 input.',
        },
        schema: {},
      });
      await deps.runAIProgramReview({}, {});
      await deps.runAIProgramRepair({}, {});
      await deps.runAIProgramReview({}, {});
      await assert.rejects(() => deps.runAIProgramRepair({}, {}));
      await deps.createWeeklyPlan({});
      return {};
    },
    generateOutput: async () => ({
      generatedAIOutput: {},
      generator: {
        model: 'generation-model',
        responseId: 'resp_generation',
        usage: {},
      },
    }),
    reviewProgram: async () => ({ provider: {} }),
    repairProgram: async () => ({}),
  });

  assert.deepEqual(result.openAICallCount, {
    generation: 1,
    review: 2,
    repair: 1,
  });
  assert.equal(result.repairCallCount, 1);
  assert.equal(result.realPersistenceCallCount, 0);
  assert.equal(result.repairMode, 'single');
});

test('smoke snapshots valid generation without Repair as identical initial and final', async () => {
  const result = await runSnapshotSmoke(async (_payload, deps) => {
    await deps.writeWeeklyPlanGenerationDebugArtifacts(
      createDebugPayload({
        stage: 'duration_gate_passed',
        calculatedDurationMinutes: 15,
        correctionRequired: false,
      }),
      {}
    );
    return {};
  });

  assert.equal(result.stage, 'duration_gate_passed');
  assert.deepEqual(result.initialBackendDurations, result.finalBackendDurations);
  assert.deepEqual(result.initialDurationGate, result.finalDurationGate);
  assert.equal(result.repairTrigger, null);
});

test('smoke snapshots invalid duration with Repair disabled', async () => {
  const result = await runSnapshotSmoke(async (_payload, deps) => {
    await deps.writeWeeklyPlanGenerationDebugArtifacts(
      createDebugPayload({
        stage: 'duration_correction_required',
        calculatedDurationMinutes: 3,
        correctionRequired: true,
      }),
      {}
    );
    const error = new Error('Duration correction required');
    error.code = 'AI_WEEKLY_PLAN_DURATION_CORRECTION_REQUIRED';
    throw error;
  });

  assert.equal(result.result, 'DURATION_CORRECTION_REQUIRED');
  assert.equal(result.initialBackendDurations[0].calculatedDurationMinutes, 3);
  assert.deepEqual(result.initialBackendDurations, result.finalBackendDurations);
  assert.equal(result.initialDurationGate.correctionRequired, true);
});

test('smoke preserves distinct initial and final DURATION Repair snapshots', async () => {
  const result = await runSnapshotSmoke(
    async (_payload, deps) => {
      await deps.writeWeeklyPlanGenerationDebugArtifacts(
        createDebugPayload({
          stage: 'duration_correction_required',
          calculatedDurationMinutes: 3,
          correctionRequired: true,
        }),
        {}
      );
      await deps.runAIProgramRepair({}, {});
      await deps.writeWeeklyPlanGenerationDebugArtifacts(
        createDebugPayload({
          stage: 'duration_repair_complete',
          calculatedDurationMinutes: 15,
          correctionRequired: false,
          repairTrigger: 'DURATION',
          repairAttempted: true,
        }),
        {}
      );
      return {};
    },
    ['--repair-mode=single']
  );

  assert.equal(result.initialBackendDurations[0].calculatedDurationMinutes, 3);
  assert.equal(result.finalBackendDurations[0].calculatedDurationMinutes, 15);
  assert.equal(result.initialDurationGate.correctionRequired, true);
  assert.equal(result.finalDurationGate.correctionRequired, false);
  assert.equal(result.repairTrigger, 'DURATION');
  assert.equal(result.repairCallCount, 1);
  assert.equal(result.stage, 'duration_repair_complete');
});

test('smoke keeps the failed repaired candidate as final without overwriting initial', async () => {
  const result = await runSnapshotSmoke(
    async (_payload, deps) => {
      await deps.writeWeeklyPlanGenerationDebugArtifacts(
        createDebugPayload({
          stage: 'duration_correction_required',
          calculatedDurationMinutes: 3,
          correctionRequired: true,
        }),
        {}
      );
      await deps.runAIProgramRepair({}, {});
      await deps.writeWeeklyPlanGenerationDebugArtifacts(
        createDebugPayload({
          stage: 'duration_repair_failed',
          calculatedDurationMinutes: 5,
          correctionRequired: true,
          repairTrigger: 'DURATION',
          repairAttempted: true,
        }),
        {}
      );
      throw new Error('Repair failed');
    },
    ['--repair-mode=single']
  );

  assert.equal(result.initialBackendDurations[0].calculatedDurationMinutes, 3);
  assert.equal(result.finalBackendDurations[0].calculatedDurationMinutes, 5);
  assert.equal(result.stage, 'duration_repair_failed');
});

test('smoke separates initial and final REVIEW Repair snapshots', async () => {
  const result = await runSnapshotSmoke(
    async (_payload, deps) => {
      await deps.writeWeeklyPlanGenerationDebugArtifacts(
        createDebugPayload({
          stage: 'review_repair_required',
          calculatedDurationMinutes: 14,
          correctionRequired: false,
        }),
        {}
      );
      await deps.runAIProgramRepair({}, {});
      await deps.writeWeeklyPlanGenerationDebugArtifacts(
        createDebugPayload({
          stage: 'final_review_complete',
          calculatedDurationMinutes: 15,
          correctionRequired: false,
          repairTrigger: 'REVIEW',
          repairAttempted: true,
        }),
        {}
      );
      return {};
    },
    ['--repair-mode=single']
  );

  assert.equal(result.initialBackendDurations[0].calculatedDurationMinutes, 14);
  assert.equal(result.finalBackendDurations[0].calculatedDurationMinutes, 15);
  assert.equal(result.repairTrigger, 'REVIEW');
  assert.equal(result.stage, 'final_review_complete');
});

test('smoke leaves duration snapshots null after failure before Analytics', async () => {
  const result = await runSnapshotSmoke(async (_payload, deps) => {
    await deps.writeWeeklyPlanGenerationDebugArtifacts(
      {
        stage: 'schema_validation_failed',
        analytics: null,
        durationGate: null,
      },
      {}
    );
    throw new Error('Schema failed');
  });

  assert.equal(result.initialBackendDurations, null);
  assert.equal(result.finalBackendDurations, null);
  assert.equal(result.initialDurationGate, null);
  assert.equal(result.finalDurationGate, null);
});

test('smoke never substitutes initial duration for a repaired candidate failing before Analytics', async () => {
  const result = await runSnapshotSmoke(
    async (_payload, deps) => {
      await deps.writeWeeklyPlanGenerationDebugArtifacts(
        createDebugPayload({
          stage: 'duration_correction_required',
          calculatedDurationMinutes: 3,
          correctionRequired: true,
        }),
        {}
      );
      await deps.runAIProgramRepair({}, {});
      await deps.writeWeeklyPlanGenerationDebugArtifacts(
        {
          stage: 'schema_validation_failed',
          analytics: null,
          durationGate: null,
          repairAttempted: true,
          repairTrigger: 'DURATION',
        },
        {}
      );
      throw new Error('Repaired schema failed');
    },
    ['--repair-mode=single']
  );

  assert.equal(result.initialBackendDurations[0].calculatedDurationMinutes, 3);
  assert.equal(result.finalBackendDurations, null);
  assert.equal(result.initialDurationGate.correctionRequired, true);
  assert.equal(result.finalDurationGate, null);
  assert.equal(result.repairTrigger, 'DURATION');
});
