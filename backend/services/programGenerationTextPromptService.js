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
  const context = await contextBuilder(
    userId.trim(),
    {
      ...options,
      includeEvaluationPolicy: false,
    },
    deps
  );
  const { promptVersion, systemMessage, userMessage } = promptBuilder({
    context,
  });
  const inputText = buildInputText(systemMessage, userMessage);

  return {
    userId: userId.trim(),
    promptVersion,
    sessionsPerWeek: context.availability.sessionsPerWeek,
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
