const test = require('node:test');
const assert = require('node:assert/strict');

const { AI_MODELS } = require('../../src/ai/aiModels');
const { getModelForTask } = require('../../src/ai/aiRouter');

test('getModelForTask maps movement_analysis to SMALL_TASK', () => {
  assert.equal(getModelForTask('movement_analysis'), AI_MODELS.SMALL_TASK);
});

test('getModelForTask keeps unknown tasks on SMALL_TASK', () => {
  assert.equal(getModelForTask('unknown_task'), AI_MODELS.SMALL_TASK);
});
