const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');

const {
  buildTextualAIWeeklyPlanPromptForUser,
} = require('../../services/programGenerationTextPromptService');
const {
  buildProgramGenerationPrompt,
} = require('../../src/domain/programGeneration/prompts/programGenerationPrompt');
const {
  createContext,
} = require('../fixtures/programGeneration/currentProgramGenerationContext');

function createServiceContext() {
  return createContext({
    availability: {
      sessionsPerWeek: 3,
      durationPerSession: 60,
    },
    musclePriorityProfile: {
      primaryFocus: 'back',
      secondaryFocuses: ['biceps'],
      deprioritizedArea: 'quadriceps',
    },
    equipmentContext: {
      equipmentPreset: 'home_gym',
      availableEquipment: ['dumbbells', 'bench'],
      equipmentBias: 'free_weights',
    },
    movementConstraints: {
      blockedMovementPatterns: ['vertical_push'],
      blockedJointStressTags: ['deep_knee_flexion'],
    },
    promptPhysicalConsiderations: [
      {
        aiSummary: 'Private-safe summary.',
        confirmedSignals: [
          {
            type: 'movementPattern',
            value: 'horizontal_push',
            decision: 'caution',
          },
        ],
      },
    ],
    cardioProfile: {
      cardioRole: 'warm_up_only',
      preferredModalities: ['walking'],
    },
    poolSummary: {
      excludedExercises: 4,
    },
    exercisePoolItems: [
      ...createContext().exercisePoolItems,
      {
        exerciseId: 'ex_curl',
        name: 'Dumbbell Curl',
        trainingType: 'strength',
        bodyParts: ['biceps'],
        muscleFocus: ['biceps'],
        targetMuscles: ['biceps'],
        secondaryMuscles: [],
        equipmentCategory: 'free_weights',
      },
    ],
  });
}

test('text prompt service returns deterministic messages and exact character count', async () => {
  let contextCall;
  const result = await buildTextualAIWeeklyPlanPromptForUser(
    ' user_dynamic ',
    { poolOptions: { includeDrafts: false } },
    {
      buildProgramGenerationContext: async (...args) => {
        contextCall = args;
        return createServiceContext();
      },
      buildProgramGenerationPrompt,
    }
  );

  assert.equal(result.userId, 'user_dynamic');
  assert.equal(result.promptVersion, 'ai-weekly-plan-text-prompt-v1.4.0');
  assert.equal(result.sessionsPerWeek, 3);
  assert.equal(result.systemMessage.length > 0, true);
  assert.equal(result.userMessage.length > 0, true);
  assert.match(result.inputText, /^SYSTEM MESSAGE\n/);
  assert.match(result.inputText, /\n\nUSER MESSAGE\n/);
  assert.equal(result.inputText.includes(result.systemMessage), true);
  assert.equal(result.inputText.includes(result.userMessage), true);
  assert.equal(result.inputCharacters, result.inputText.length);
  assert.equal(result.openAICallPerformed, false);
  assert.equal(contextCall[0], 'user_dynamic');
  assert.equal(contextCall[1].includeEvaluationPolicy, false);
  assert.deepEqual(contextCall[1].poolOptions, { includeDrafts: false });
});

test('text prompt includes dynamic profile and pool but excludes outside exercises', async () => {
  const result = await buildTextualAIWeeklyPlanPromptForUser(
    'user_dynamic',
    {},
    {
      buildProgramGenerationContext: async () => createServiceContext(),
      buildProgramGenerationPrompt,
    }
  );

  [
    /train exactly 3 times per week/,
    /approximately 60 minutes/,
    /primary muscle priority is Back/,
    /Caution: Horizontal Push/,
    /brief, light cardio warm-up/,
    /ex_bench/,
    /ex_curl/,
  ].forEach((pattern) => assert.match(result.userMessage, pattern));
  assert.doesNotMatch(
    result.userMessage,
    /ATHLETE PROFILE AND COACHING INPUTS|trainingMetricsGuidance|APPLIED CONSTRAINTS/
  );
  assert.doesNotMatch(
    result.userMessage,
    /You are a bodybuilding coach responsible for creating training programs for the Lyft Zone application\.|MONITOR/i
  );
  assert.match(
    result.userMessage,
    /Treat CAUTION signals as reasons.*CAUTION signals are not blocked constraints\./s
  );
  assert.doesNotMatch(result.userMessage, /ex_outside_pool/);
});

test('text prompt service import graph excludes the legacy AI runtime', () => {
  const servicePath = require.resolve(
    '../../services/programGenerationTextPromptService'
  );
  const loaded = JSON.parse(
    execFileSync(
      process.execPath,
      [
        '-e',
        [
          `require(${JSON.stringify(servicePath)});`,
          'process.stdout.write(JSON.stringify(Object.keys(require.cache)));',
        ].join(''),
      ],
      { encoding: 'utf8' }
    )
  );
  const forbidden = [
    'openai',
    'aiRouter',
    'weeklyPlanAiGenerationService',
    'weeklyPlanAiSchema',
    'weeklyPlanAiValidation',
    'weeklyPlanAiNormalizer',
    'weeklyPlanAnalytics',
    'weeklyPlanBackendDuration',
    'aiProgramReview',
    'aiProgramRepair',
    'weeklyPlanGenerationAudit',
    'weeklyPlanAiPresentation',
    'weeklyPlanInitialGenerationDebugService',
    'weeklyPlanEvaluationPolicy',
    'bodybuildingDoctrineLoader',
  ];

  forbidden.forEach((fragment) => {
    assert.equal(
      loaded.some((filename) => filename.includes(fragment)),
      false,
      fragment
    );
  });
});
