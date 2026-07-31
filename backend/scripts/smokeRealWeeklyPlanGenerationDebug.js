#!/usr/bin/env node

require('dotenv').config();

const fs = require('node:fs/promises');
const OpenAI = require('openai');
const { getPrisma } = require('../lib/prisma');
const {
  createAIWeeklyPlanDraft,
} = require('../services/programGenerationService');
const {
  generateWeeklyPlanAiOutput,
} = require('../services/weeklyPlanAiGenerationService');
const {
  writeWeeklyPlanGenerationDebugArtifacts,
} = require('../services/weeklyPlanInitialGenerationDebugService');
const {
  runAIProgramReview,
} = require('../src/domain/programGeneration/aiProgramReview');
const {
  runAIProgramRepair,
} = require('../src/domain/programGeneration/aiProgramRepair');
const {
  parseUserIdArgument,
  selectRealProfile,
} = require('./previewRealWeeklyPlanGenerationPrompt');

const DOCTRINE_MODE_ARGUMENT_PREFIX = '--doctrine-mode=';
const DOCTRINE_MODE_FULL = 'full';
const DOCTRINE_MODE_NONE = 'none';
const REPAIR_MODE_ARGUMENT_PREFIX = '--repair-mode=';
const REPAIR_MODE_DISABLED = 'disabled';
const REPAIR_MODE_SINGLE = 'single';

class RealGenerationSmokeError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'RealGenerationSmokeError';
    this.code = code;
  }
}

function invalidDoctrineMode(message) {
  return new RealGenerationSmokeError(
    'INVALID_DOCTRINE_MODE',
    message
  );
}

function parseDoctrineModeArgument(argv = []) {
  const matches = argv.filter(
    (argument) =>
      argument === '--doctrine-mode' ||
      argument.startsWith(DOCTRINE_MODE_ARGUMENT_PREFIX)
  );

  if (matches.length > 1) {
    throw invalidDoctrineMode(
      'Only one --doctrine-mode argument may be provided'
    );
  }

  if (matches.length === 0) {
    return DOCTRINE_MODE_NONE;
  }

  const argument = matches[0];
  const mode = argument.startsWith(DOCTRINE_MODE_ARGUMENT_PREFIX)
    ? argument.slice(DOCTRINE_MODE_ARGUMENT_PREFIX.length).trim()
    : '';

  if (mode !== DOCTRINE_MODE_NONE) {
    throw invalidDoctrineMode(
      'Weekly Plan Output V4 supports only --doctrine-mode=none'
    );
  }

  return mode;
}

function parseRepairModeArgument(argv = []) {
  const matches = argv.filter(
    (argument) =>
      argument === '--repair-mode' ||
      argument.startsWith(REPAIR_MODE_ARGUMENT_PREFIX)
  );
  if (matches.length > 1) {
    throw new RealGenerationSmokeError(
      'INVALID_REPAIR_MODE',
      'Only one --repair-mode argument may be provided'
    );
  }
  if (matches.length === 0) {
    return REPAIR_MODE_DISABLED;
  }

  const mode = matches[0].startsWith(REPAIR_MODE_ARGUMENT_PREFIX)
    ? matches[0].slice(REPAIR_MODE_ARGUMENT_PREFIX.length).trim()
    : '';
  if (![REPAIR_MODE_DISABLED, REPAIR_MODE_SINGLE].includes(mode)) {
    throw new RealGenerationSmokeError(
      'INVALID_REPAIR_MODE',
      '--repair-mode must be exactly "disabled" or "single"'
    );
  }
  return mode;
}

function buildSmokePromptVariant(promptDescriptor, doctrineMode) {
  if (
    !promptDescriptor ||
    typeof promptDescriptor !== 'object' ||
    typeof promptDescriptor.systemMessage !== 'string' ||
    typeof promptDescriptor.userMessage !== 'string'
  ) {
    throw new RealGenerationSmokeError(
      'INVALID_SMOKE_PROMPT',
      'The production generation prompt is unavailable'
    );
  }

  if (doctrineMode !== DOCTRINE_MODE_NONE) {
    throw invalidDoctrineMode(
      'Weekly Plan Output V4 supports only --doctrine-mode=none'
    );
  }

  return {
    promptDescriptor,
    doctrineMode,
    doctrineIncluded: false,
    inputCharacters: promptDescriptor.userMessage.length,
    doctrineCharactersRemoved: 0,
  };
}

function buildSmokeEnvironment(
  env = process.env,
  repairMode = REPAIR_MODE_DISABLED
) {
  return {
    ...env,
    ENABLE_AI_WEEKLY_PLAN_BUILDER: 'true',
    ENABLE_AI_WEEKLY_PLAN_REVIEW: 'true',
    ENABLE_AI_WEEKLY_PLAN_REPAIR:
      repairMode === REPAIR_MODE_SINGLE ? 'true' : 'false',
    ENABLE_AI_WEEKLY_PLAN_DEBUG_ARTIFACTS: 'true',
    NODE_ENV: 'development',
  };
}

function copyUsage(usage) {
  return {
    inputTokens: usage?.inputTokens ?? null,
    outputTokens: usage?.outputTokens ?? null,
    totalTokens: usage?.totalTokens ?? null,
    reasoningTokens: usage?.reasoningTokens ?? null,
  };
}

function summarizeProvider(provider) {
  if (!provider || typeof provider !== 'object') {
    return null;
  }

  return {
    model: provider.model ?? null,
    responseId: provider.responseId ?? null,
    usage: copyUsage(provider.usage),
  };
}

function summarizeBackendDurations(analytics) {
  if (!Array.isArray(analytics?.workouts)) {
    return null;
  }

  return analytics.workouts.map((workout) => ({
    workoutOrderIndex: workout.workoutOrderIndex ?? null,
    requestedDurationMinutes: workout.requestedDurationMinutes ?? null,
    calculatedDurationMinutes: workout.calculatedDurationMinutes ?? null,
    durationDifferenceMinutes: workout.durationDifferenceMinutes ?? null,
    durationUtilizationRatio: workout.durationUtilizationRatio ?? null,
    durationAlignmentStatus: workout.durationAlignmentStatus ?? null,
    durationRequiresCorrection:
      workout.durationRequiresCorrection === true,
  }));
}

function summarizeDurationGate(durationGate) {
  if (!durationGate || typeof durationGate !== 'object') {
    return null;
  }

  return {
    ok: durationGate.ok === true,
    correctionRequired: durationGate.correctionRequired === true,
    workouts: Array.isArray(durationGate.workouts)
      ? durationGate.workouts
      : [],
  };
}

function buildSmokeMetadata(promptVariant, provider) {
  const providerSummary = summarizeProvider(provider);

  return {
    doctrineMode: promptVariant?.doctrineMode ?? null,
    doctrineIncluded: promptVariant?.doctrineIncluded === true,
    inputCharacters: promptVariant?.inputCharacters ?? null,
    doctrineCharactersRemoved:
      promptVariant?.doctrineCharactersRemoved ?? null,
    model: providerSummary?.model ?? null,
    responseId: providerSummary?.responseId ?? null,
    usage: providerSummary?.usage ?? copyUsage(null),
  };
}

async function persistSmokeMetadataInDebugArtifacts(
  artifact,
  metadata,
  fsImpl = fs
) {
  if (!artifact || typeof artifact !== 'object') {
    return artifact;
  }

  if (typeof artifact.jsonPath === 'string' && artifact.jsonPath) {
    const serialized = await fsImpl.readFile(artifact.jsonPath, 'utf8');
    const parsed = JSON.parse(serialized);
    await fsImpl.writeFile(
      artifact.jsonPath,
      `${JSON.stringify(
        {
          ...parsed,
          smokeMetadata: metadata,
        },
        null,
        2
      )}\n`,
      'utf8'
    );
  }

  if (typeof artifact.textPath === 'string' && artifact.textPath) {
    await fsImpl.appendFile(
      artifact.textPath,
      [
        '',
        'SMOKE METADATA',
        `- Doctrine mode: ${metadata.doctrineMode}`,
        `- Doctrine included: ${metadata.doctrineIncluded}`,
        `- Input characters: ${metadata.inputCharacters}`,
        `- Doctrine characters removed: ${metadata.doctrineCharactersRemoved}`,
        `- Model: ${metadata.model ?? 'not available'}`,
        `- Response ID: ${metadata.responseId ?? 'not available'}`,
        `- Usage: ${JSON.stringify(metadata.usage)}`,
        '',
      ].join('\n'),
      'utf8'
    );
  }

  return artifact;
}

function summarizeGeneratedOutput(output) {
  if (!output || typeof output !== 'object') {
    return null;
  }

  return {
    planName: output.planName ?? null,
    splitType: output.splitType ?? null,
    sessionsPerWeek: output.sessionsPerWeek ?? null,
    strategySummary: output.strategySummary ?? null,
    progression: output.progressionModel?.summary ?? null,
    cautionHandling: output.cautionHandling?.summary ?? null,
    workoutCount: Array.isArray(output.workouts) ? output.workouts.length : 0,
    workouts: (output.workouts || []).map((workout) => ({
      orderIndex: workout.orderIndex ?? null,
      name: workout.name ?? null,
      focus: workout.focus ?? null,
      blocks: (workout.blocks || []).map((block) => ({
        orderIndex: block.orderIndex ?? null,
        blockType: block.blockType ?? null,
        exercises: (block.exercises || []).map((exercise) => ({
          orderIndex: exercise.orderIndex ?? null,
          exerciseId: exercise.exerciseId ?? null,
          exerciseName: exercise.exerciseName ?? null,
          setCount: Array.isArray(exercise.setTemplates)
            ? exercise.setTemplates.length
            : 0,
        })),
      })),
    })),
  };
}

function summarizeProfile(selected) {
  const context = selected.context;
  return {
    selectionMethod: selected.selectionMethod,
    primaryGoal: context.primaryGoal ?? null,
    experience: context.experience ?? null,
    sessionsPerWeek: context.availability?.sessionsPerWeek ?? null,
    durationPerSession: context.availability?.durationPerSession ?? null,
    primaryPriority: context.musclePriorityProfile?.primaryFocus ?? null,
    secondaryPriorities:
      context.musclePriorityProfile?.secondaryFocuses || [],
    deprioritizedArea:
      context.musclePriorityProfile?.deprioritizedArea ?? null,
    cardioRole: context.cardioProfile?.cardioRole ?? null,
    eligibleExerciseCount:
      context.poolSnapshot?.availableExerciseCount ?? null,
  };
}

function resolveResultStatus(error) {
  if (!error) {
    return 'REVIEW_PASS';
  }

  const code = error.code;
  if (code === 'AI_WEEKLY_PLAN_SCHEMA_VALIDATION_FAILED') {
    return 'SCHEMA_VALIDATION_FAILED';
  }
  if (
    [
      'AI_WEEKLY_PLAN_INVALID_OUTPUT',
      'AI_WEEKLY_PLAN_UNSUPPORTED_BLOCK_TYPE',
      'AI_WEEKLY_PLAN_INVALID_CARDIO_BLOCK',
      'AI_WEEKLY_PLAN_NOTES_POLICY_VIOLATION',
    ].includes(code)
  ) {
    return 'SEMANTIC_VALIDATION_FAILED';
  }
  if (code === 'AI_WEEKLY_PLAN_NORMALIZATION_FAILED') {
    return 'NORMALIZATION_FAILED';
  }
  if (code === 'AI_WEEKLY_PLAN_POOL_VIOLATION') {
    return 'POOL_VALIDATION_FAILED';
  }
  if (
    error.details?.stage === 'business_rules' ||
    String(code || '').includes('BUSINESS_RULE')
  ) {
    return 'BUSINESS_RULES_FAILED';
  }
  if (code === 'AI_WEEKLY_PLAN_ANALYTICS_FAILED') {
    return 'ANALYTICS_FAILED';
  }
  if (code === 'AI_WEEKLY_PLAN_DURATION_CORRECTION_REQUIRED') {
    return 'DURATION_CORRECTION_REQUIRED';
  }
  if (code === 'AI_WEEKLY_PLAN_DURATION_REPAIR_FAILED') {
    return 'DURATION_REPAIR_FAILED';
  }
  if (code === 'AI_WEEKLY_PLAN_REPAIR_BUDGET_EXHAUSTED') {
    return 'REPAIR_BUDGET_EXHAUSTED';
  }
  if (code === 'AI_WEEKLY_PLAN_REPAIR_DURATION_INVALID') {
    return 'REPAIR_DURATION_INVALID';
  }
  if (code === 'AI_WEEKLY_PLAN_REVIEW_REQUIRES_REPAIR') {
    return 'REVIEW_REPAIR_REQUIRED';
  }
  if (code === 'AI_WEEKLY_PLAN_REVIEW_FAILED') {
    return 'REVIEW_FAIL';
  }
  return 'SMOKE_FAILED';
}

function summarizeError(error) {
  if (!error) {
    return null;
  }

  return {
    code: error.code || error.name || 'SMOKE_FAILED',
    message: error.message || 'Weekly plan smoke failed',
    stage: error.details?.stage ?? null,
    issues: Array.isArray(error.details?.issues)
      ? error.details.issues
      : [],
  };
}

async function runSmoke({
  argv = process.argv.slice(2),
  prisma = getPrisma(),
  env = buildSmokeEnvironment(),
  OpenAIClient = OpenAI,
  selectProfile = selectRealProfile,
  createDraft = createAIWeeklyPlanDraft,
  generateOutput = generateWeeklyPlanAiOutput,
  reviewProgram = runAIProgramReview,
  repairProgram = runAIProgramRepair,
  writeDebugArtifacts = writeWeeklyPlanGenerationDebugArtifacts,
  persistSmokeMetadata = persistSmokeMetadataInDebugArtifacts,
} = {}) {
  const doctrineMode = parseDoctrineModeArgument(argv);
  const repairMode = parseRepairModeArgument(argv);
  env = buildSmokeEnvironment(env, repairMode);
  const explicitUserId = parseUserIdArgument(argv);
  const selected = await selectProfile({
    prisma,
    explicitUserId,
  });
  const openaiClient = new OpenAIClient({
    apiKey: env.OPENAI_API_KEY,
    maxRetries: 0,
  });
  const openAICallCount = {
    generation: 0,
    review: 0,
    repair: 0,
  };
  let repairCallCount = 0;
  let fakePersistenceCallCount = 0;
  const realPersistenceCallCount = 0;
  let latestDebugPayload = null;
  let latestArtifact = null;
  let latestGenerationProvider = null;
  let promptVariant = null;
  let caughtError = null;
  let initialBackendDurations = null;
  let finalBackendDurations = null;
  let initialDurationGate = null;
  let finalDurationGate = null;
  let repairTrigger = null;

  try {
    await createDraft(
      { userId: selected.userId },
      {
        env,
        openaiClient,
        prisma,
        buildProgramGenerationContext: async () => selected.context,
        generateWeeklyPlanAiOutput: async (input) => {
          if (openAICallCount.generation >= 1) {
            throw new RealGenerationSmokeError(
              'SMOKE_GENERATION_CALL_LIMIT_EXCEEDED',
              'The generation debug smoke permits exactly one Generation call'
            );
          }
          promptVariant = buildSmokePromptVariant(
            input.promptDescriptor,
            doctrineMode
          );
          openAICallCount.generation += 1;
          const result = await generateOutput({
            ...input,
            promptDescriptor: promptVariant.promptDescriptor,
          }, {
            env,
            openaiClient,
          });
          latestGenerationProvider = result?.generator ?? null;
          return result;
        },
        runAIProgramReview: async (input, deps) => {
          const maximumReviewCalls =
            repairMode === REPAIR_MODE_SINGLE ? 2 : 1;
          if (openAICallCount.review >= maximumReviewCalls) {
            throw new RealGenerationSmokeError(
              'SMOKE_REVIEW_CALL_LIMIT_EXCEEDED',
              'The generation debug smoke permits at most one Review call'
            );
          }
          openAICallCount.review += 1;
          return reviewProgram(input, {
            ...deps,
            env,
            openaiClient,
          });
        },
        runAIProgramRepair: async (input, deps) => {
          if (
            repairMode !== REPAIR_MODE_SINGLE ||
            openAICallCount.repair >= 1
          ) {
            throw new RealGenerationSmokeError(
              'SMOKE_REPAIR_CALL_LIMIT_EXCEEDED',
              'The generation debug smoke permits at most one Repair call in single mode'
            );
          }
          repairCallCount += 1;
          openAICallCount.repair += 1;
          return repairProgram(input, {
            ...deps,
            env,
            openaiClient,
          });
        },
        writeWeeklyPlanGenerationDebugArtifacts: async (payload, options) => {
          latestDebugPayload = payload;
          const backendDurations = summarizeBackendDurations(
            payload?.analytics
          );
          const durationGate = summarizeDurationGate(
            payload?.durationGate
          );
          if (backendDurations) {
            initialBackendDurations ??= backendDurations;
            finalBackendDurations = backendDurations;
          } else if (payload?.repairAttempted === true) {
            finalBackendDurations = null;
          }
          if (durationGate) {
            initialDurationGate ??= durationGate;
            finalDurationGate = durationGate;
          } else if (payload?.repairAttempted === true) {
            finalDurationGate = null;
          }
          if (['DURATION', 'REVIEW'].includes(payload?.repairTrigger)) {
            repairTrigger = payload.repairTrigger;
          }
          latestArtifact = await writeDebugArtifacts(
            payload,
            options
          );
          await persistSmokeMetadata(
            latestArtifact,
            buildSmokeMetadata(
              promptVariant,
              payload?.generationProvider || latestGenerationProvider
            )
          );
          return latestArtifact;
        },
        createWeeklyPlan: async () => {
          fakePersistenceCallCount += 1;
          return {
            source: 'ai',
            status: 'SMOKE_ONLY_NOT_PERSISTED',
          };
        },
      }
    );
  } catch (error) {
    caughtError = error;
  }

  const generationProvider = summarizeProvider(
    latestDebugPayload?.generationProvider || latestGenerationProvider
  );
  const reviewProvider = summarizeProvider(
    latestDebugPayload?.initialReview?.provider
  );

  return {
    result: resolveResultStatus(caughtError),
    profile: summarizeProfile(selected),
    generatedOutputSummary: summarizeGeneratedOutput(
      latestDebugPayload?.generatedAIOutput
    ),
    error: summarizeError(caughtError),
    jsonPath:
      caughtError?.details?.debugArtifact?.jsonPath ||
      latestArtifact?.jsonPath ||
      null,
    textPath:
      caughtError?.details?.debugArtifact?.textPath ||
      latestArtifact?.textPath ||
      null,
    generation: generationProvider,
    review: reviewProvider,
    smokeMetadata: buildSmokeMetadata(
      promptVariant,
      latestDebugPayload?.generationProvider || latestGenerationProvider
    ),
    repairMode,
    stage: latestDebugPayload?.stage ?? null,
    initialBackendDurations,
    finalBackendDurations,
    initialDurationGate,
    finalDurationGate,
    repairTrigger,
    repairCallCount,
    realPersistenceCallCount,
    fakePersistenceCallCount,
    openAICallCount,
  };
}

async function main() {
  const prisma = getPrisma();

  try {
    const result = await runSmoke({ prisma });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(
      `${JSON.stringify(
        {
          result: 'SMOKE_FAILED',
          error: summarizeError(error),
          repairCallCount: 0,
          realPersistenceCallCount: 0,
          fakePersistenceCallCount: 0,
          openAICallCount: {
            generation: 0,
            review: 0,
            repair: 0,
          },
        },
        null,
        2
      )}\n`
    );
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  DOCTRINE_MODE_FULL,
  DOCTRINE_MODE_NONE,
  REPAIR_MODE_DISABLED,
  REPAIR_MODE_SINGLE,
  RealGenerationSmokeError,
  buildSmokeMetadata,
  buildSmokePromptVariant,
  buildSmokeEnvironment,
  parseDoctrineModeArgument,
  parseRepairModeArgument,
  persistSmokeMetadataInDebugArtifacts,
  resolveResultStatus,
  runSmoke,
  summarizeGeneratedOutput,
};
