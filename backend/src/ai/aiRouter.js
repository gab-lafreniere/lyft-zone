const { AI_MODELS } = require('./aiModels');

function getModelForTask(task) {
  switch (task) {
    case 'program_generation':
      return AI_MODELS.PROGRAM_GENERATION;
    case 'program_repair':
      return AI_MODELS.PROGRAM_REPAIR;
    case 'program_review':
      return AI_MODELS.PROGRAM_REVIEW;
    case 'movement_analysis':
    case 'program_validation':
    case 'coach_chat':
    case 'simple_classification':
    default:
      return AI_MODELS.SMALL_TASK;
  }
}

module.exports = {
  getModelForTask,
};
