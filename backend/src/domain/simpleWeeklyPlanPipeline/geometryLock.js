const { createHash } = require('node:crypto');

function stableJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function buildGeometryProjection(document = {}) {
  const workouts = Array.isArray(document.workouts) ? document.workouts : [];

  return {
    sessionsPerWeek: document.sessionsPerWeek,
    workouts: workouts.map((workout, workoutPosition) => ({
      position: workoutPosition,
      orderIndex: workout.orderIndex,
      name: workout.name,
      blocks: (Array.isArray(workout.blocks) ? workout.blocks : []).map(
        (block, blockPosition) => ({
          position: blockPosition,
          orderIndex: block.orderIndex,
          blockType: block.blockType,
          roundCount: block.roundCount,
          exercises: (Array.isArray(block.exercises)
            ? block.exercises
            : []).map((exercise, exercisePosition) => ({
              position: exercisePosition,
              orderIndex: exercise.orderIndex,
              sets: (Array.isArray(exercise.setTemplates)
                ? exercise.setTemplates
                : []).map((setTemplate, setPosition) => ({
                  position: setPosition,
                  setIndex: setTemplate.setIndex,
                })),
            })),
        })
      ),
    })),
  };
}

function computeGeometryHash(document) {
  const canonical = stableJson(buildGeometryProjection(document));
  return `sha256:${createHash('sha256').update(canonical).digest('hex')}`;
}

function validateGeometryLock(document, expectedHash) {
  const receivedHash = computeGeometryHash(document);
  const valid = receivedHash === expectedHash;

  return {
    valid,
    expectedHash,
    receivedHash,
    errors: valid
      ? []
      : [
        {
          path: '$',
          code: 'GEOMETRY_HASH_MISMATCH',
          message: 'Completed document geometry does not match the skeleton',
          received: receivedHash,
          expected: expectedHash,
        },
      ],
  };
}

module.exports = {
  buildGeometryProjection,
  computeGeometryHash,
  stableJson,
  validateGeometryLock,
};
