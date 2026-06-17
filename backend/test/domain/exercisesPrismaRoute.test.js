const assert = require('node:assert/strict');
const test = require('node:test');

const {
  _test: { buildExerciseListResponse },
} = require('../../routes/exercisesPrisma');

const exercises = [
  { exerciseId: 'exr_001_draft', name: 'Draft Row', status: 'draft' },
  { exerciseId: 'exr_002_approved', name: 'Approved Squat', status: 'approved' },
  { exerciseId: 'exr_003_archived', name: 'Archived Press', status: 'archived' },
  { exerciseId: 'exr_004_approved', name: 'Approved Hinge', status: 'approved' },
  { exerciseId: 'exr_005_approved', name: 'Approved Pull', status: 'approved' },
];

test('/api/exercises without status returns all statuses', () => {
  const result = buildExerciseListResponse(exercises, { limit: '10' });

  assert.equal(result.validationError, undefined);
  assert.equal(result.body.total, exercises.length);
  assert.deepEqual(
    result.body.items.map((exercise) => exercise.exerciseId),
    exercises.map((exercise) => exercise.exerciseId)
  );
});

test('/api/exercises?status=all returns all statuses explicitly', () => {
  const result = buildExerciseListResponse(exercises, { status: 'all', limit: '10' });

  assert.equal(result.validationError, undefined);
  assert.equal(result.body.total, exercises.length);
  assert.deepEqual(
    result.body.items.map((exercise) => exercise.exerciseId),
    exercises.map((exercise) => exercise.exerciseId)
  );
});

test('/api/exercises?status=approved returns only approved exercises before pagination', () => {
  const result = buildExerciseListResponse(exercises, {
    status: 'approved',
    limit: '2',
  });

  assert.equal(result.validationError, undefined);
  assert.equal(result.body.total, 3);
  assert.deepEqual(
    result.body.items.map((exercise) => exercise.exerciseId),
    ['exr_002_approved', 'exr_004_approved']
  );
  assert.equal(result.body.nextCursor, '2');
});

test('/api/exercises rejects invalid status', () => {
  const result = buildExerciseListResponse(exercises, { status: 'draft' });

  assert.equal(result.validationError.status, 400);
  assert.equal(result.validationError.body.success, false);
  assert.match(result.validationError.body.message, /status/i);
});
