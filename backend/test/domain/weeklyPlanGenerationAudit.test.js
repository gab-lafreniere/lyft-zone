const test = require('node:test');
const assert = require('node:assert/strict');

const {
  GENERATION_CONTEXT_SCHEMA_VERSION,
  buildWeeklyPlanGenerationContext,
} = require('../../src/domain/programGeneration/weeklyPlanGenerationAudit');

test('buildWeeklyPlanGenerationContext persists compact doctrine and prompt metadata only', () => {
  const generationContext = buildWeeklyPlanGenerationContext({
    context: {
      generationMode: 'weekly_plan_draft',
      createdAt: '2026-06-01T12:00:00.000Z',
      profileSchemaVersion: 2,
      primaryGoal: 'HYPERTROPHY',
      experience: 'intermediate',
      availability: { sessionsPerWeek: 4, durationPerSession: 60 },
      equipmentContext: {},
      movementConstraints: {},
      cardioProfile: {},
      physicalNotes: 'PRIVATE_PROFILE_NOTE_SENTINEL',
      coachInputs: {
        doctrineId: 'bodybuilding_runtime_classic',
        doctrineVersion: 'bodybuilding-hypertrophy-runtime-classic-v1.0.0',
        derivedFromDoctrineVersion: 'bodybuilding-hypertrophy-v1.0.0',
        promptVersion: 'ai-weekly-plan-builder-prompt-v1.0.1',
      },
      doctrineContent: 'FULL_DOCTRINE_CONTENT_SENTINEL',
      systemMessage: 'SYSTEM_MESSAGE_SENTINEL',
      userMessage: 'USER_MESSAGE_SENTINEL',
      poolSnapshot: {
        checksum: 'checksum',
      },
    },
    generatedPlanDocument: {
      strategySummary: 'Static hypertrophy plan.',
    },
    validation: {
      ok: true,
      issues: [],
      uniqueExerciseIds: ['ex_db_bench'],
    },
    generator: {
      type: 'mock',
      model: null,
      rawResponse: 'RAW_PROVIDER_RESPONSE_SENTINEL',
      requestId: 'req_http_private_123',
    },
  });

  assert.equal(GENERATION_CONTEXT_SCHEMA_VERSION, 3);
  assert.equal(generationContext.schemaVersion, 3);
  assert.equal(generationContext.doctrineId, 'bodybuilding_runtime_classic');
  assert.equal(
    generationContext.doctrineVersion,
    'bodybuilding-hypertrophy-runtime-classic-v1.0.0'
  );
  assert.equal(
    generationContext.derivedFromDoctrineVersion,
    'bodybuilding-hypertrophy-v1.0.0'
  );
  assert.equal(
    generationContext.promptVersion,
    'ai-weekly-plan-builder-prompt-v1.0.1'
  );
  assert.equal(generationContext.profileSnapshotSummary.hasPhysicalNotes, true);
  assert.deepEqual(generationContext.generator, {
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

  const serialized = JSON.stringify(generationContext);
  assert.doesNotMatch(serialized, /FULL_DOCTRINE_CONTENT_SENTINEL/);
  assert.doesNotMatch(serialized, /SYSTEM_MESSAGE_SENTINEL/);
  assert.doesNotMatch(serialized, /USER_MESSAGE_SENTINEL/);
  assert.doesNotMatch(serialized, /PRIVATE_PROFILE_NOTE_SENTINEL/);
  assert.doesNotMatch(serialized, /RAW_PROVIDER_RESPONSE_SENTINEL/);
  assert.doesNotMatch(serialized, /req_http_private_123/);
  assert.equal(generationContext.systemMessage, undefined);
  assert.equal(generationContext.userMessage, undefined);
});

test('buildWeeklyPlanGenerationContext persists allowlisted OpenAI metadata in V3', () => {
  const generationContext = buildWeeklyPlanGenerationContext({
    context: {
      generationMode: 'weekly_plan_draft',
      createdAt: '2026-06-01T12:00:00.000Z',
      coachInputs: {},
      poolSnapshot: { checksum: 'checksum' },
    },
    generatedAIOutput: {
      schemaVersion: 1,
      strategySummary: 'Provider strategy summary.',
    },
    validation: {
      schemaValidation: { ok: true, issues: [] },
      semanticValidation: { ok: true, issues: [], summary: {} },
      poolValidation: { ok: true, issues: [], uniqueExerciseIds: [] },
    },
    generator: {
      type: 'openai',
      model: 'gpt-program-model',
      responseId: 'resp_audit_123',
      usage: {
        inputTokens: 1200,
        outputTokens: 800,
        totalTokens: 2000,
        reasoningTokens: 250,
        rawUsage: 'RAW_USAGE_SENTINEL',
      },
      rawResponse: 'RAW_RESPONSE_SENTINEL',
      outputText: 'RAW_OUTPUT_TEXT_SENTINEL',
      requestId: 'req_http_private_456',
    },
  });

  assert.equal(generationContext.schemaVersion, 3);
  assert.deepEqual(generationContext.generator, {
    type: 'openai',
    model: 'gpt-program-model',
    responseId: 'resp_audit_123',
    usage: {
      inputTokens: 1200,
      outputTokens: 800,
      totalTokens: 2000,
      reasoningTokens: 250,
    },
  });

  const serialized = JSON.stringify(generationContext);
  assert.doesNotMatch(serialized, /RAW_USAGE_SENTINEL/);
  assert.doesNotMatch(serialized, /RAW_RESPONSE_SENTINEL/);
  assert.doesNotMatch(serialized, /RAW_OUTPUT_TEXT_SENTINEL/);
  assert.doesNotMatch(serialized, /req_http_private_456/);
});

test('buildWeeklyPlanGenerationContext normalizes absent OpenAI metadata to null', () => {
  const generationContext = buildWeeklyPlanGenerationContext({
    context: {},
    generatedPlanDocument: {},
    validation: { ok: true, issues: [] },
    generator: {
      type: 'openai',
      model: ' ',
      responseId: '',
      usage: {
        inputTokens: -1,
        outputTokens: 1.5,
        totalTokens: '20',
      },
    },
  });

  assert.deepEqual(generationContext.generator, {
    type: 'openai',
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
