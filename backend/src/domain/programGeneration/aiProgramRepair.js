const {
  repairWeeklyPlanAi,
} = require('../../../services/weeklyPlanAiRepairService');
const {
  buildProgramRepairContext,
} = require('./programRepairContextBuilder');
const {
  PROGRAM_REPAIR_PROMPT_VERSION,
  buildProgramRepairPrompt,
} = require('./prompts/programRepairPrompt');
const {
  AI_WEEKLY_PLAN_OUTPUT_CONTRACT_VERSION,
  AI_WEEKLY_PLAN_OUTPUT_SCHEMA_VERSION,
  buildWeeklyPlanAiJsonSchema,
} = require('./weeklyPlanAiSchema');

const MAX_PROGRAM_REPAIR_INPUT_CHARACTERS = 1000000;

class AIProgramRepairError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'AIProgramRepairError';
    this.code = code;
  }
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function assertPromptDescriptor(promptDescriptor) {
  if (
    !isObject(promptDescriptor) ||
    promptDescriptor.promptVersion !== PROGRAM_REPAIR_PROMPT_VERSION ||
    typeof promptDescriptor.systemMessage !== 'string' ||
    !promptDescriptor.systemMessage.trim() ||
    typeof promptDescriptor.userMessage !== 'string' ||
    !promptDescriptor.userMessage.trim()
  ) {
    throw new AIProgramRepairError(
      'AI_WEEKLY_PLAN_REPAIR_PROMPT_BUILD_FAILED',
      'AI weekly plan repair prompt could not be prepared'
    );
  }
}

function assertProviderResult(result) {
  if (
    !isObject(result) ||
    !isObject(result.repairedAIOutput)
  ) {
    throw new AIProgramRepairError(
      'AI_WEEKLY_PLAN_REPAIR_INVALID_PROVIDER_RESPONSE',
      'AI weekly plan repair provider returned an invalid response'
    );
  }
}

function normalizeTokenCount(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function projectRepairerMetadata(repairer) {
  if (
    !isObject(repairer) ||
    repairer.type !== 'openai' ||
    typeof repairer.model !== 'string' ||
    !repairer.model.trim() ||
    !isObject(repairer.usage)
  ) {
    throw new AIProgramRepairError(
      'AI_WEEKLY_PLAN_REPAIR_INVALID_PROVIDER_RESPONSE',
      'AI weekly plan repair provider returned an invalid response'
    );
  }

  return {
    type: 'openai',
    model: repairer.model.trim(),
    responseId:
      typeof repairer.responseId === 'string' && repairer.responseId.trim()
        ? repairer.responseId.trim()
        : null,
    usage: {
      inputTokens: normalizeTokenCount(repairer.usage.inputTokens),
      outputTokens: normalizeTokenCount(repairer.usage.outputTokens),
      totalTokens: normalizeTokenCount(repairer.usage.totalTokens),
      reasoningTokens: normalizeTokenCount(repairer.usage.reasoningTokens),
    },
  };
}

async function runAIProgramRepair(options = {}, deps = {}) {
  let repairContext;
  try {
    repairContext = (deps.buildProgramRepairContext || buildProgramRepairContext)({
      context: options.context,
      generatedAIOutput: options.generatedAIOutput,
      generatedPlanDocument: options.generatedPlanDocument,
      analytics: options.analytics,
      initialReview: options.initialReview,
    });
  } catch (_error) {
    throw new AIProgramRepairError(
      'AI_WEEKLY_PLAN_REPAIR_INPUT_INVALID',
      'AI weekly plan repair input is invalid'
    );
  }

  let promptDescriptor;
  try {
    promptDescriptor = (deps.buildProgramRepairPrompt || buildProgramRepairPrompt)({
      doctrine: options.doctrine,
      repairContext,
    });
    assertPromptDescriptor(promptDescriptor);
  } catch (error) {
    if (error instanceof AIProgramRepairError) {
      throw error;
    }

    throw new AIProgramRepairError(
      'AI_WEEKLY_PLAN_REPAIR_PROMPT_BUILD_FAILED',
      'AI weekly plan repair prompt could not be prepared'
    );
  }

  if (promptDescriptor.userMessage.length > MAX_PROGRAM_REPAIR_INPUT_CHARACTERS) {
    throw new AIProgramRepairError(
      'AI_WEEKLY_PLAN_REPAIR_INPUT_TOO_LARGE',
      'AI weekly plan repair input exceeds the allowed size'
    );
  }

  const schema = (deps.buildWeeklyPlanAiJsonSchema || buildWeeklyPlanAiJsonSchema)();
  const result = await (deps.repairWeeklyPlanAi || repairWeeklyPlanAi)(
    { promptDescriptor, schema },
    deps
  );

  assertProviderResult(result);
  const repairer = projectRepairerMetadata(result.repairer);

  return {
    repairedAIOutput: result.repairedAIOutput,
    repairer,
    attemptNumber: 1,
    promptVersion: promptDescriptor.promptVersion,
    contractVersion: AI_WEEKLY_PLAN_OUTPUT_CONTRACT_VERSION,
    outputSchemaVersion: AI_WEEKLY_PLAN_OUTPUT_SCHEMA_VERSION,
  };
}

module.exports = {
  AIProgramRepairError,
  MAX_PROGRAM_REPAIR_INPUT_CHARACTERS,
  runAIProgramRepair,
};
