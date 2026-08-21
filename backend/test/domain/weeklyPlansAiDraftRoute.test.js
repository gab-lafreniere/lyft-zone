const test = require('node:test');
const assert = require('node:assert/strict');

const orchestratorPath = require.resolve(
  '../../services/simpleWeeklyPlanAiOrchestrator'
);
const weeklyPlansServicePath = require.resolve('../../services/weeklyPlansService');
const presentationPath = require.resolve(
  '../../src/domain/simpleWeeklyPlanPipeline/resultPresentation'
);

const calls = {
  pipeline: [],
  create: [],
  presentation: [],
};
let pipelineResult;
let presentationError = null;

require.cache[orchestratorPath] = {
  id: orchestratorPath,
  filename: orchestratorPath,
  loaded: true,
  exports: {
    runSimpleWeeklyPlanAiPipeline: async (input) => {
      calls.pipeline.push(input);
      return pipelineResult;
    },
  },
};

require.cache[weeklyPlansServicePath] = {
  id: weeklyPlansServicePath,
  filename: weeklyPlansServicePath,
  loaded: true,
  exports: {
    createWeeklyPlan: async (...args) => {
      calls.create.push(args);
      return {
        weeklyPlanParentId: 'parent_ai_1',
        weeklyPlanVersionId: 'version_ai_1',
        status: 'PUBLISHED',
        source: 'ai',
        builderPayload: {
          programName: 'Published AI Plan',
        },
      };
    },
    deleteWeeklyPlan: async () => ({}),
    getWeeklyPlanDetails: async () => ({}),
    listVisibleWeeklyPlans: async () => [],
    openOrCreateEditDraft: async () => ({}),
    publishWeeklyPlanDraft: async () => ({}),
    setWeeklyPlanBookmark: async () => ({}),
    updateWeeklyPlanDraft: async () => ({}),
  },
};

const fallbackPresentation = {
  title: 'Published AI Plan',
  summary: null,
  weeklyStructure: [],
  musclePriorities: [],
  constraintNotes: [],
  progression: null,
  coachingNotes: [],
};

require.cache[presentationPath] = {
  id: presentationPath,
  filename: presentationPath,
  loaded: true,
  exports: {
    buildSimpleWeeklyPlanResultPresentation: (input) => {
      calls.presentation.push(input);
      if (presentationError) {
        throw presentationError;
      }
      return {
        ...fallbackPresentation,
        summary: 'A short public summary.',
      };
    },
    buildSimpleWeeklyPlanResultPresentationFallback: () => fallbackPresentation,
  },
};

const weeklyPlansRouter = require('../../routes/weeklyPlans');
const {
  beginGenerationProgress,
  clearGenerationProgressForTests,
} = require('../../services/weeklyPlanAiProgressRegistry');

function findRoute(path, method) {
  return weeklyPlansRouter.stack.find(
    (layer) => layer.route?.path === path && layer.route.methods?.[method]
  );
}

async function invokeAIDraftsRoute(reqOverrides = {}) {
  const route = findRoute('/ai-drafts', 'post');
  assert.ok(route);
  const req = {
    body: {
      userId: 'user_123',
    },
    ...reqOverrides,
  };
  const res = {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };

  await route.route.stack[0].handle(req, res);
  return res;
}

function createSuccessfulPipelineResult() {
  const metrics = {
    weekly: {
      totalExerciseCount: 12,
      totalSetCount: 36,
      averageDurationMinutes: 58,
      averageTUTMinutes: 19,
      muscleDistribution: [
        {
          key: 'chest',
          label: 'Chest',
          rawSets: 16,
          normalizedShare: 12.5,
          percentageOfWorkout: 44.5,
        },
      ],
    },
    workouts: [{ private: 'PRIVATE_WORKOUT_METRICS' }],
  };

  return {
    valid: true,
    output8: {
      valid: true,
      metrics,
    },
    completedDocument: {
      name: 'Published AI Plan',
      sessionsPerWeek: 1,
      workouts: [],
    },
    sourceWorkoutNames: ['Day 1 - Upper Focus'],
    boundPresentation: {
      title: 'Upper Focus Hypertrophy',
      summary: 'A short public summary.',
      progression: null,
      coachingNotes: [],
    },
    presentationContractEnabled: true,
    generatedPlanText: [
      'Summary',
      'A short public summary.',
      '1. Private exercise (exr_private): 3 sets of 10 reps.',
    ].join('\n'),
  };
}

test.beforeEach(() => {
  calls.pipeline.length = 0;
  calls.create.length = 0;
  calls.presentation.length = 0;
  pipelineResult = createSuccessfulPipelineResult();
  presentationError = null;
  clearGenerationProgressForTests();
});

test('POST /api/weekly-plans/ai-drafts runs once, persists published, and returns only the public contract', async () => {
  const res = await invokeAIDraftsRoute();

  assert.equal(res.statusCode, 201);
  assert.equal(calls.pipeline.length, 1);
  assert.deepEqual(calls.pipeline[0], { userId: 'user_123' });
  assert.equal(calls.create.length, 1);
  assert.deepEqual(calls.create[0], [
    {
      ...pipelineResult.completedDocument,
      userId: 'user_123',
      source: 'AI',
      generationContext: {
        schemaVersion: 1,
        presentation: {
          ...fallbackPresentation,
          summary: 'A short public summary.',
        },
        sourceWorkoutNames: ['Day 1 - Upper Focus'],
      },
    },
    { initialStatus: 'PUBLISHED' },
  ]);
  assert.equal(calls.presentation.length, 1);
  assert.deepEqual(calls.presentation[0], {
    generatedPlanText: pipelineResult.generatedPlanText,
    completedDocument: pipelineResult.completedDocument,
    boundPresentation: pipelineResult.boundPresentation,
    presentationContractEnabled: true,
  });
  assert.deepEqual(Object.keys(res.body).sort(), [
    'metrics',
    'name',
    'presentation',
    'source',
    'status',
    'weeklyPlanParentId',
    'weeklyPlanVersionId',
  ]);
  assert.deepEqual(res.body.metrics, {
    totalExercises: 12,
    strengthSets: 36,
    averageDurationMinutes: 58,
    averageTUTMinutes: 19,
    weeklyMuscleDistribution: [
      {
        key: 'chest',
        label: 'Chest',
        rawSets: 16,
        percentage: 44.5,
      },
    ],
  });
  assert.deepEqual(res.body.presentation, {
    ...fallbackPresentation,
    summary: 'A short public summary.',
  });
  assert.doesNotMatch(
    JSON.stringify(res.body),
    /exr_private|PRIVATE_WORKOUT_METRICS|generatedPlanText|completedDocument|output[1-8]|builderPayload|artifact|token|model|pool/i
  );
});

test('optional generationId enables progress without changing the POST response', async () => {
  const res = await invokeAIDraftsRoute({
    body: { userId: 'user_123', generationId: 'generation_123' },
  });

  assert.equal(res.statusCode, 201);
  assert.equal(typeof calls.pipeline[0].onProgress, 'function');
  assert.doesNotMatch(JSON.stringify(res.body), /generation_123/);

  const route = findRoute('/ai-drafts/:generationId/progress', 'get');
  const progressRes = {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
  await route.route.stack[0].handle(
    {
      params: { generationId: 'generation_123' },
      query: { userId: 'user_123' },
    },
    progressRes
  );
  assert.equal(progressRes.statusCode, 200);
  assert.deepEqual(progressRes.body, {
    generationId: 'generation_123',
    status: 'SUCCEEDED',
    stage: 'SAVING_PROGRAM',
    updatedAt: progressRes.body.updatedAt,
  });
});

test('progress GET hides missing and wrong-owner records', async () => {
  beginGenerationProgress({
    generationId: 'owned_generation',
    userId: 'owner',
  });
  const route = findRoute('/ai-drafts/:generationId/progress', 'get');

  for (const [generationId, userId] of [
    ['missing_generation', 'owner'],
    ['owned_generation', 'other'],
  ]) {
    const res = {
      statusCode: null,
      body: null,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(body) {
        this.body = body;
        return this;
      },
    };
    await route.route.stack[0].handle(
      { params: { generationId }, query: { userId } },
      res
    );
    assert.equal(res.statusCode, 404);
    assert.equal(res.body.error.code, 'AI_GENERATION_PROGRESS_NOT_FOUND');
  }
});

test('invalid or incomplete pipeline result never persists', async () => {
  for (const invalidResult of [
    { ...createSuccessfulPipelineResult(), valid: false },
    { ...createSuccessfulPipelineResult(), completedDocument: null },
    { ...createSuccessfulPipelineResult(), generatedPlanText: null },
    { ...createSuccessfulPipelineResult(), output8: undefined },
    {
      ...createSuccessfulPipelineResult(),
      output8: {
        ...createSuccessfulPipelineResult().output8,
        valid: false,
      },
    },
    {
      ...createSuccessfulPipelineResult(),
      output8: {
        ...createSuccessfulPipelineResult().output8,
        valid: undefined,
      },
    },
    {
      ...createSuccessfulPipelineResult(),
      output8: {
        valid: true,
        metrics: undefined,
      },
    },
  ]) {
    pipelineResult = invalidResult;
    const res = await invokeAIDraftsRoute();
    assert.equal(res.statusCode, 422);
  }

  assert.equal(calls.pipeline.length, 7);
  assert.equal(calls.create.length, 0);
  assert.equal(calls.presentation.length, 0);
});

test('presentation failure persists and returns the exact deterministic fallback', async () => {
  presentationError = new Error('private presentation failure');

  const res = await invokeAIDraftsRoute();

  assert.equal(res.statusCode, 201);
  assert.equal(calls.create.length, 1);
  assert.deepEqual(res.body.presentation, fallbackPresentation);
  assert.deepEqual(
    calls.create[0][0].generationContext,
    {
      schemaVersion: 1,
      presentation: fallbackPresentation,
      sourceWorkoutNames: ['Day 1 - Upper Focus'],
    }
  );
  assert.doesNotMatch(JSON.stringify(res.body), /private presentation failure/i);
});

test('missing userId is rejected before pipeline execution', async () => {
  const res = await invokeAIDraftsRoute({ body: {} });

  assert.equal(res.statusCode, 400);
  assert.equal(calls.pipeline.length, 0);
  assert.equal(calls.create.length, 0);
});
