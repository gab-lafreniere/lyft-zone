const AI_MODELS = {
  SMALL_TASK: process.env.OPENAI_MODEL_SMALL_TASK || 'gpt-4.1-mini',
  PROGRAM_GENERATION: process.env.OPENAI_MODEL_PROGRAM_GENERATION || 'gpt-5.4-mini',
  VALIDATION: process.env.OPENAI_MODEL_VALIDATION || 'gpt-4.1-mini',
  FALLBACK: process.env.OPENAI_MODEL_FALLBACK || 'gpt-4.1-mini',
};

module.exports = {
  AI_MODELS,
};
