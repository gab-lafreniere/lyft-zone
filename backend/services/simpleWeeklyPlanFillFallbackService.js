const {
  buildWeeklyPlanFillFallbackRequest,
} = require('../src/domain/simpleWeeklyPlanPipeline/fillFallback');

async function resolveWeeklyPlanFillFallback({
  provider,
  geometryHash,
  unresolved,
  model,
  timeoutMs,
  maxOutputTokens,
}) {
  const request = buildWeeklyPlanFillFallbackRequest({
    geometryHash,
    unresolved,
  });
  let result;
  try {
    result = await provider.generate({
      stage: 'CALL_3_FILL_FALLBACK',
      model,
      systemMessage: request.systemMessage,
      userMessage: request.userMessage,
      schema: request.schema,
      formatName: request.formatName,
      timeoutMs,
      maxOutputTokens,
    });
  } catch (error) {
    error.fillFallbackRequest = request;
    throw error;
  }
  return { request, result };
}

module.exports = {
  resolveWeeklyPlanFillFallback,
};
