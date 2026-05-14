const test = require('node:test');
const assert = require('node:assert/strict');

const {
  resolveMovementConstraints,
} = require('../../src/domain/programGeneration/movementConstraintResolver');

test('resolveMovementConstraints surfaces caution patterns for moderate pain', () => {
  const result = resolveMovementConstraints({
    movementConstraints: {
      painDescription: 'Bench press hurts my shoulder',
      affectedArea: 'shoulder',
      painSeverity: 'moderate',
      trainingRule: 'modify',
      aiDetectedPatterns: ['overhead_press'],
      confirmedPatterns: ['overhead_press'],
    },
  });

  assert.equal(result.painDescription, 'Bench press hurts my shoulder');
  assert.equal(result.affectedArea, 'shoulder');
  assert.deepEqual(result.blockedMovementPatterns, []);
  assert.deepEqual(result.cautionMovementPatterns, ['overhead_press']);
  assert.deepEqual(result.blockedJointStressTags, []);
  assert.deepEqual(result.cautionJointStressTags, []);
  assert.deepEqual(result.blockedExerciseIds, []);
});

test('resolveMovementConstraints does not promote detected patterns to hard blocks from rule or severity', () => {
  const result = resolveMovementConstraints({
    movementConstraints: {
      affectedArea: 'knee',
      painSeverity: 'high',
      trainingRule: 'avoid',
      aiDetectedPatterns: ['deep_knee_flexion'],
      confirmedPatterns: ['deep_knee_flexion'],
    },
  });

  assert.deepEqual(result.blockedMovementPatterns, []);
  assert.deepEqual(result.cautionMovementPatterns, ['deep_knee_flexion']);
});

test('resolveMovementConstraints preserves explicit blocked and caution arrays from the normalized profile', () => {
  const result = resolveMovementConstraints({
    movementConstraints: {
      affectedArea: 'shoulder',
      painSeverity: 'moderate',
      trainingRule: 'modify',
      aiDetectedPatterns: ['vertical_push'],
      confirmedPatterns: ['horizontal_push'],
      cautionMovementPatterns: ['scapular_plane_press'],
      blockedMovementPatterns: ['vertical_push'],
      cautionJointStressTags: ['shoulder_rotation'],
      blockedJointStressTags: ['shoulder_compression'],
      blockedExerciseIds: ['ex_barbell_press'],
    },
  });

  assert.deepEqual(result.cautionMovementPatterns, ['scapular_plane_press']);
  assert.deepEqual(result.blockedMovementPatterns, ['vertical_push']);
  assert.deepEqual(result.cautionJointStressTags, ['shoulder_rotation']);
  assert.deepEqual(result.blockedJointStressTags, ['shoulder_compression']);
  assert.deepEqual(result.blockedExerciseIds, ['ex_barbell_press']);
});
