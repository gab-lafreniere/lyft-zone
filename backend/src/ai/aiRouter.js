const { AI_MODELS } = require('./aiModels');

function getModelForTask(task) {
  switch (task) {
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
