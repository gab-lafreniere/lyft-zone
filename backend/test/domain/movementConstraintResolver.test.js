const test = require('node:test');
const assert = require('node:assert/strict');

const {
  resolveMovementConstraints,
} = require('../../src/domain/programGeneration/movementConstraintResolver');

function resolveWithIssue(issueOverrides = {}, movementOverrides = {}) {
  return resolveMovementConstraints({
    movementConstraints: {
      painIssues: [
        {
          id: 'issue_shoulder',
          description: 'Shoulder irritation',
          affectedArea: 'shoulder',
          painSeverity: 'moderate',
          trainingRule: 'modify',
          analysisStatus: 'analyzed',
          detectedSignals: [],
          confirmedSignals: [],
          ...issueOverrides,
        },
      ],
      manualBlockedExerciseIds: [],
      ...movementOverrides,
    },
  });
}

test('resolveMovementConstraints does not derive from detected signals alone', () => {
  const result = resolveWithIssue({
    detectedSignals: [{ type: 'movementPattern', value: 'vertical_push' }],
    confirmedSignals: [],
  });

  assert.deepEqual(result.cautionMovementPatterns, []);
  assert.deepEqual(result.blockedMovementPatterns, []);
  assert.deepEqual(result.cautionJointStressTags, []);
  assert.deepEqual(result.blockedJointStressTags, []);
});

test('resolveMovementConstraints ignores draft and needs_reanalysis issues', () => {
  const draftResult = resolveWithIssue({
    analysisStatus: 'draft',
    confirmedSignals: [{ type: 'movementPattern', value: 'vertical_push', decision: 'blocked' }],
  });
  const staleResult = resolveWithIssue({
    analysisStatus: 'needs_reanalysis',
    confirmedSignals: [{ type: 'jointStressTag', value: 'deep_knee_flexion', decision: 'blocked' }],
  });

  assert.deepEqual(draftResult.blockedMovementPatterns, []);
  assert.deepEqual(staleResult.blockedJointStressTags, []);
});

test('resolveMovementConstraints derives constraints from analyzed confirmed signals', () => {
  const result = resolveWithIssue({
    confirmedSignals: [
      { type: 'movementPattern', value: 'vertical_push', decision: 'caution' },
      { type: 'movementPattern', value: 'hip_hinge', decision: 'blocked' },
      { type: 'jointStressTag', value: 'deep_knee_flexion', decision: 'caution' },
      { type: 'jointStressTag', value: 'spinal_loading', decision: 'blocked' },
    ],
  });

  assert.deepEqual(result.cautionMovementPatterns, ['vertical_push']);
  assert.deepEqual(result.blockedMovementPatterns, ['hip_hinge']);
  assert.deepEqual(result.cautionJointStressTags, ['deep_knee_flexion']);
  assert.deepEqual(result.blockedJointStressTags, ['spinal_loading']);
});

test('resolveMovementConstraints aggregates multiple issues and manual blocks', () => {
  const result = resolveMovementConstraints({
    movementConstraints: {
      painIssues: [
        {
          id: 'issue_shoulder',
          description: 'Shoulder irritation',
          affectedArea: 'shoulder',
          painSeverity: 'moderate',
          trainingRule: 'modify',
          analysisStatus: 'analyzed',
          detectedSignals: [],
          confirmedSignals: [
            { type: 'movementPattern', value: 'vertical_push', decision: 'blocked' },
            { type: 'jointStressTag', value: 'overhead_shoulder_position', decision: 'caution' },
          ],
        },
        {
          id: 'issue_knee',
          description: 'Knee discomfort',
          affectedArea: 'knee',
          painSeverity: 'high',
          trainingRule: 'avoid',
          analysisStatus: 'analyzed',
          detectedSignals: [],
          confirmedSignals: [
            { type: 'movementPattern', value: 'vertical_push', decision: 'blocked' },
            { type: 'jointStressTag', value: 'deep_knee_flexion', decision: 'blocked' },
          ],
        },
      ],
      manualBlockedExerciseIds: ['ex_deadlift', 'ex_deadlift', 'ex_upright_row'],
    },
  });

  assert.deepEqual(result.blockedMovementPatterns, ['vertical_push']);
  assert.deepEqual(result.cautionJointStressTags, ['overhead_shoulder_position']);
  assert.deepEqual(result.blockedJointStressTags, ['deep_knee_flexion']);
  assert.deepEqual(result.manualBlockedExerciseIds, ['ex_deadlift', 'ex_upright_row']);
  assert.deepEqual(result.blockedExerciseIds, ['ex_deadlift', 'ex_upright_row']);
  assert.deepEqual(result.debug, {
    manualBlockedExerciseCount: 2,
    ruleDerivedBlockedExerciseCount: null,
  });
});

test('resolveMovementConstraints preserves legacy explicit advanced arrays as fallback', () => {
  const result = resolveMovementConstraints({
    movementConstraints: {
      aiDetectedPatterns: ['vertical_push'],
      confirmedPatterns: ['horizontal_push'],
      cautionMovementPatterns: ['hip_hinge'],
      blockedMovementPatterns: ['vertical_push'],
      cautionJointStressTags: ['overhead_shoulder_position'],
      blockedJointStressTags: ['spinal_loading'],
      blockedExerciseIds: ['ex_barbell_press'],
    },
  });

  assert.deepEqual(result.painIssues, []);
  assert.deepEqual(result.cautionMovementPatterns, ['hip_hinge']);
  assert.deepEqual(result.blockedMovementPatterns, ['vertical_push']);
  assert.deepEqual(result.cautionJointStressTags, ['overhead_shoulder_position']);
  assert.deepEqual(result.blockedJointStressTags, ['spinal_loading']);
  assert.deepEqual(result.manualBlockedExerciseIds, ['ex_barbell_press']);
  assert.deepEqual(result.blockedExerciseIds, ['ex_barbell_press']);
});

test('resolveMovementConstraints does not promote legacy detected or confirmed patterns', () => {
  const result = resolveMovementConstraints({
    movementConstraints: {
      aiDetectedPatterns: ['vertical_push'],
      confirmedPatterns: ['horizontal_push'],
    },
  });

  assert.deepEqual(result.cautionMovementPatterns, []);
  assert.deepEqual(result.blockedMovementPatterns, []);
});
