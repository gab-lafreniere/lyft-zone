const {
  ExercisePoolServiceError,
} = require('./exercisePoolService');
const {
  buildProgramGenerationContext,
} = require('../src/domain/programGeneration/programGenerationContextBuilder');
const {
  buildProgramGenerationPrompt,
} = require('../src/domain/programGeneration/prompts/programGenerationPrompt');

function buildInputText(systemMessage, userMessage) {
  return [
    'SYSTEM MESSAGE',
    systemMessage,
    '',
    'USER MESSAGE',
    userMessage,
  ].join('\n');
}

async function buildTextualAIWeeklyPlanPromptForUser(
  userId,
  options = {},
  deps = {}
) {
  if (typeof userId !== 'string' || !userId.trim()) {
    throw new ExercisePoolServiceError(
      'VALIDATION_ERROR',
      'userId is required'
    );
  }

  const contextBuilder =
    deps.buildProgramGenerationContext || buildProgramGenerationContext;
  const promptBuilder =
    deps.buildProgramGenerationPrompt || buildProgramGenerationPrompt;
  const {
    presentationContractEnabled = true,
    ...contextOptions
  } = options;
  const context = await contextBuilder(
    userId.trim(),
    {
      ...contextOptions,
      includeEvaluationPolicy: false,
    },
    deps
  );
  const { promptVersion, systemMessage, userMessage } = promptBuilder({
    context,
    presentationContractEnabled,
  });
  const inputText = buildInputText(systemMessage, userMessage);

  return {
    userId: userId.trim(),
    promptVersion,
    sessionsPerWeek: context.availability.sessionsPerWeek,
    durationPerSession: context.availability.durationPerSession,
    systemMessage,
    userMessage,
    inputText,
    inputCharacters: inputText.length,
    openAICallPerformed: false,
  };
}

module.exports = {
  buildInputText,
  buildTextualAIWeeklyPlanPromptForUser,
};
