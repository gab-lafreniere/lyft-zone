const PROGRESS_TTL_MS = 10 * 60 * 1000;

const WEEKLY_PLAN_AI_STAGES = Object.freeze([
  'PROFILE_SETUP',
  'DESIGNING_PROGRAM',
  'EXTRACTING_STRUCTURE',
  'BUILDING_PROGRAM',
  'VALIDATING_PROGRAM',
  'SAVING_PROGRAM',
]);

const STAGE_INDEX = new Map(
  WEEKLY_PLAN_AI_STAGES.map((stage, index) => [stage, index])
);
const records = new Map();

function toIsoString(now) {
  return new Date(now).toISOString();
}

function pruneExpired(now = Date.now()) {
  records.forEach((record, generationId) => {
    if (record.expiresAt <= now) {
      records.delete(generationId);
    }
  });
}

function toPublicRecord(record) {
  if (!record) {
    return null;
  }
  return {
    generationId: record.generationId,
    status: record.status,
    stage: record.stage,
    updatedAt: record.updatedAt,
  };
}

function beginGenerationProgress({ generationId, userId }, now = Date.now()) {
  pruneExpired(now);
  const existing = records.get(generationId);
  if (existing) {
    return existing.userId === userId ? toPublicRecord(existing) : null;
  }
  const record = {
    generationId,
    userId,
    status: 'RUNNING',
    stage: 'PROFILE_SETUP',
    updatedAt: toIsoString(now),
    expiresAt: now + PROGRESS_TTL_MS,
  };
  records.set(generationId, record);
  return toPublicRecord(record);
}

function updateRecord(generationId, updater, now = Date.now()) {
  pruneExpired(now);
  const current = records.get(generationId);
  if (!current || current.status !== 'RUNNING') {
    return null;
  }
  const next = updater(current);
  if (!next) {
    return toPublicRecord(current);
  }
  const record = {
    ...current,
    ...next,
    updatedAt: toIsoString(now),
    expiresAt: now + PROGRESS_TTL_MS,
  };
  records.set(generationId, record);
  return toPublicRecord(record);
}

function advanceGenerationProgress(generationId, stage, now = Date.now()) {
  return updateRecord(
    generationId,
    (current) => {
      const currentIndex = STAGE_INDEX.get(current.stage);
      const nextIndex = STAGE_INDEX.get(stage);
      if (nextIndex == null || nextIndex < currentIndex) {
        return null;
      }
      return { stage };
    },
    now
  );
}

function finishGenerationProgress(generationId, now = Date.now()) {
  return updateRecord(
    generationId,
    () => ({ status: 'SUCCEEDED', stage: 'SAVING_PROGRAM' }),
    now
  );
}

function failGenerationProgress(generationId, now = Date.now()) {
  return updateRecord(generationId, () => ({ status: 'FAILED' }), now);
}

function readGenerationProgress({ generationId, userId }, now = Date.now()) {
  pruneExpired(now);
  const record = records.get(generationId);
  if (!record || record.userId !== userId) {
    return null;
  }
  return toPublicRecord(record);
}

function clearGenerationProgressForTests() {
  records.clear();
}

module.exports = {
  PROGRESS_TTL_MS,
  WEEKLY_PLAN_AI_STAGES,
  advanceGenerationProgress,
  beginGenerationProgress,
  clearGenerationProgressForTests,
  failGenerationProgress,
  finishGenerationProgress,
  readGenerationProgress,
};
