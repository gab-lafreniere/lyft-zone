export const ONBOARDING_DRAFT_VERSION = 1;
export const ONBOARDING_DRAFT_KEY_PREFIX = "lyft_zone_onboarding_draft_v1";

export function getOnboardingDraftStorageKey(userId) {
  return `${ONBOARDING_DRAFT_KEY_PREFIX}:${userId}`;
}

export function loadOnboardingRecovery(userId, storage = window.localStorage) {
  if (!userId || !storage) {
    return null;
  }

  try {
    const rawValue = storage.getItem(getOnboardingDraftStorageKey(userId));
    if (!rawValue) {
      return null;
    }

    const parsed = JSON.parse(rawValue);
    if (
      parsed?.version !== ONBOARDING_DRAFT_VERSION ||
      parsed?.userId !== userId ||
      !parsed?.draft ||
      typeof parsed.draft !== "object"
    ) {
      return null;
    }

    return parsed;
  } catch {
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

