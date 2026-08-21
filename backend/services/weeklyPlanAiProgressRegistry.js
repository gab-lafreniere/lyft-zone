/**
 * Best-effort, single-instance AI generation registry.
 *
 * Records live in an in-process Map for 10 minutes. They do not survive a
 * process restart or Render redeploy, and they are not shared between backend
 * instances. If Render scales beyond one instance, generation idempotency is
 * only best-effort. The durable future direction is a transactional
 * Neon/Postgres uniqueness claim (for example, an ai_generation_attempts table
 * or a unique persisted generationId); that is deliberately not implemented
 * here.
 */
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

function recordKey({ generationId, userId }) {
  return `${String(userId).length}:${userId}:${generationId}`;
}

function toIsoString(now) {
  return new Date(now).toISOString();
}

function pruneExpired(now = Date.now()) {
  records.forEach((record, key) => {
    if (record.expiresAt <= now) {
      records.delete(key);
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

function createRunningRecord({ generationId, userId }, now) {
  return {
    generationId,
    userId,
    status: 'RUNNING',
    stage: 'PROFILE_SETUP',
    result: null,
    updatedAt: toIsoString(now),
    expiresAt: now + PROGRESS_TTL_MS,
  };
}

function beginGenerationProgress(identity, now = Date.now()) {
  pruneExpired(now);
  const key = recordKey(identity);
  const existing = records.get(key);
  if (existing) {
    return toPublicRecord(existing);
  }
  const record = createRunningRecord(identity, now);
  records.set(key, record);
  return toPublicRecord(record);
}

/**
 * Synchronously claims pipeline ownership before any asynchronous work starts.
 * FAILED records are reset for a legitimate retry; RUNNING and successful
 * memoized records are never mutated by a duplicate request.
 */
function claimGenerationProgress(identity, now = Date.now()) {
  pruneExpired(now);
  const key = recordKey(identity);
  const existing = records.get(key);

  if (existing?.status === 'RUNNING') {
    return { outcome: 'RUNNING', progress: toPublicRecord(existing), result: null };
  }
  if (existing?.status === 'SUCCEEDED' && existing.result) {
    return {
      outcome: 'SUCCEEDED',
      progress: toPublicRecord(existing),
      result: existing.result,
    };
  }

  const record = createRunningRecord(identity, now);
  records.set(key, record);
  return { outcome: 'CLAIMED', progress: toPublicRecord(record), result: null };
}

function updateRecord(identity, updater, now = Date.now()) {
  pruneExpired(now);
  const key = recordKey(identity);
  const current = records.get(key);
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
  records.set(key, record);
  return toPublicRecord(record);
}

function advanceGenerationProgress(identity, stage, now = Date.now()) {
  return updateRecord(
    identity,
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

function finishGenerationProgress(identity, result, now = Date.now()) {
  return updateRecord(
    identity,
    () => ({ status: 'SUCCEEDED', stage: 'SAVING_PROGRAM', result }),
    now
  );
}

function failGenerationProgress(identity, now = Date.now()) {
  return updateRecord(identity, () => ({ status: 'FAILED', result: null }), now);
}

function readGenerationProgress(identity, now = Date.now()) {
  pruneExpired(now);
  return toPublicRecord(records.get(recordKey(identity)));
}

function clearGenerationProgressForTests() {
  records.clear();
}

module.exports = {
  PROGRESS_TTL_MS,
  WEEKLY_PLAN_AI_STAGES,
  advanceGenerationProgress,
  beginGenerationProgress,
  claimGenerationProgress,
  clearGenerationProgressForTests,
  failGenerationProgress,
  finishGenerationProgress,
  readGenerationProgress,
};
