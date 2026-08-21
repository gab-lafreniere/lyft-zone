export const ONBOARDING_DRAFT_VERSION = 1;
export const ONBOARDING_DRAFT_KEY_PREFIX = "lyft_zone_onboarding_draft_v1";
export const ONBOARDING_GENERATION_RECOVERY_TTL_MS = 10 * 60 * 1000;

const GENERATION_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const RECOVERABLE_GENERATION_PHASES = new Set([
  "checking",
  "confirmation",
  "generating",
  "converting",
  "completing",
]);

export function getOnboardingDraftStorageKey(userId) {
  return `${ONBOARDING_DRAFT_KEY_PREFIX}:${userId}`;
}

export function loadOnboardingRecovery(
  userId,
  storage = window.localStorage,
  now = Date.now()
) {
  if (!userId || !storage) {
    return null;
  }

  try {
    const rawValue = storage.getItem(getOnboardingDraftStorageKey(userId));
    if (!rawValue) {
      return null;
    }

    const parsed = JSON.parse(rawValue);
    const invalidBaseRecord =
      parsed?.version !== ONBOARDING_DRAFT_VERSION ||
      parsed?.userId !== userId ||
      !parsed?.draft ||
      typeof parsed.draft !== "object";
    if (invalidBaseRecord) {
      storage.removeItem(getOnboardingDraftStorageKey(userId));
      return null;
    }

    if (parsed.generation != null) {
      const generation = parsed.generation;
      const startedAt = Date.parse(generation.startedAt);
      const invalidGeneration =
        !GENERATION_ID_PATTERN.test(String(generation.generationId || "")) ||
        !Array.isArray(generation.trainingDays) ||
        generation.trainingDays.length === 0 ||
        generation.trainingDays.some((day) => typeof day !== "string" || !day) ||
        !RECOVERABLE_GENERATION_PHASES.has(generation.phase) ||
        !Number.isFinite(startedAt) ||
        startedAt > now ||
        now - startedAt > ONBOARDING_GENERATION_RECOVERY_TTL_MS;
      if (invalidGeneration) {
        storage.removeItem(getOnboardingDraftStorageKey(userId));
        return null;
      }
    }

    return parsed;
  } catch {
    storage.removeItem(getOnboardingDraftStorageKey(userId));
    return null;
  }
}

export function saveOnboardingRecovery(
  userId,
  recovery,
  storage = window.localStorage
) {
  if (!userId || !storage) {
    return;
  }

  storage.setItem(
    getOnboardingDraftStorageKey(userId),
    JSON.stringify({
      ...recovery,
      version: ONBOARDING_DRAFT_VERSION,
      userId,
      savedAt: new Date().toISOString(),
    })
  );
}

export function clearOnboardingRecovery(userId, storage = window.localStorage) {
  if (!userId || !storage) {
    return;
  }

  storage.removeItem(getOnboardingDraftStorageKey(userId));
}
