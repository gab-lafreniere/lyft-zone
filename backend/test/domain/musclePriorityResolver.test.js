const test = require('node:test');
const assert = require('node:assert/strict');

const {
  resolveMusclePriorityProfile,
} = require('../../src/domain/programGeneration/musclePriorityResolver');

test('resolveMusclePriorityProfile returns the expected weights and per-area overrides', () => {
  const result = resolveMusclePriorityProfile({
    musclePriorities: {
      primaryFocus: 'upper_chest',
      secondaryFocuses: ['lats', 'rear_delts'],
      deprioritizedArea: 'quadriceps',
    },
  });

  assert.equal(result.weights.primary, 1);
  assert.equal(result.weights.secondary, 0.65);
  assert.equal(result.weights.deprioritized, 0.35);
  assert.equal(result.perAreaWeights.upper_chest, 1);
  assert.equal(result.perAreaWeights.lats, 0.65);
  assert.equal(result.perAreaWeights.rear_delts, 0.65);
  assert.equal(result.perAreaWeights.quadriceps, 0.35);
  assert.equal(result.parentAreas.primaryFocus, 'chest');
});
