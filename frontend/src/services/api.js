const isLocalhost =
  typeof window !== 'undefined' &&
  (window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1');

const BACKEND_URL = isLocalhost
  ? 'http://localhost:5001'
  : process.env.REACT_APP_BACKEND_URL || 'https://lyft-zone-backend.onrender.com';

const USER_ID_STORAGE_KEY = 'lyft_zone_user_id';
const LOCAL_DEV_USER_ID =
  process.env.REACT_APP_LOCAL_DEV_USER_ID ||
  'cmndfy73q00092ojrnkoez3aj';

function shouldUseLocalDevUserId() {
  if (typeof window === 'undefined') {
    return false;
  }

  const host = window.location.hostname;
  return host === 'localhost' || host === '127.0.0.1';
}

function getLocalTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Toronto';
  } catch {
    return 'America/Toronto';
  }
}

async function readJsonResponse(response) {
  const json = await response.json();

  if (!response.ok) {
    throw new Error(
      json?.error?.message ||
        json?.message ||
        `API error ${response.status}`
    );
  }

  return json;
}

export async function ensureCurrentUserId() {
  if (typeof window === 'undefined') {
    return null;
  }

  if (shouldUseLocalDevUserId()) {
    window.localStorage.setItem(USER_ID_STORAGE_KEY, LOCAL_DEV_USER_ID);
    return LOCAL_DEV_USER_ID;
  }

  const existingUserId = window.localStorage.getItem(USER_ID_STORAGE_KEY);
  if (existingUserId) {
    return existingUserId;
  }

  const email = `lyft-zone-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 8)}@example.com`;

  const response = await fetch(`${BACKEND_URL}/api/users`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });

  const json = await readJsonResponse(response);
  const userId = json?.user?.id;

  if (!userId) {
    throw new Error('Unable to create a local user session');
  }

  window.localStorage.setItem(USER_ID_STORAGE_KEY, userId);
  return userId;
}

export const fetchExercises = async ({
  q = '',
  limit = 25,
  bodyParts = [],
  muscleFocus = [],
  equipmentCategory = [],
  trainingType = [],
  difficulty = [],
} = {}) => {
    const params = new URLSearchParams();
    params.set('limit', String(limit));
    if (q) {
      params.set('q', q);
    }
    if (bodyParts.length) {
      params.set('bodyParts', bodyParts.join(','));
    }
    if (muscleFocus.length) {
      params.set('muscleFocus', muscleFocus.join(','));
    }
    if (equipmentCategory.length) {
      params.set('equipmentCategory', equipmentCategory.join(','));
    }
    if (trainingType.length) {
      params.set('trainingType', trainingType.join(','));
    }
    if (difficulty.length) {
      params.set('difficulty', difficulty.join(','));
    }

    const response = await fetch(`${BACKEND_URL}/api/exercises?${params.toString()}`);
  
    if (!response.ok) {
      throw new Error(`API error ${response.status}`);
    }
  
    const json = await response.json();
  
    // Nouveau format seed: { items: [...], nextCursor, total }
    if (Array.isArray(json.items)) {
      return json.items;
    }
  
    // Ancien format DB: { success, data: [...] }
    if (Array.isArray(json.data)) {
      return json.data;
    }
  
    // Fallback: parfois l’API peut renvoyer directement un array
    if (Array.isArray(json)) {
      return json;
    }
  
    return [];
};
  

/**
 * Sauvegarde un programme (Phase 1 : Program + TrainingSessions).
 * Payload: { userId, name, durationWeeks, sessionsPerWeek, sessions }
 */
export const savePlan = async (programPayload) => {
  const response = await fetch(`${BACKEND_URL}/api/plans`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(programPayload),
  });

  const json = await response.json();
  if (!response.ok) {
    throw new Error(json.message || `API error ${response.status}`);
  }
  return json.data;
};

export async function createWeeklyPlanDraft(programPayload) {
  const userId = await ensureCurrentUserId();
  const response = await fetch(`${BACKEND_URL}/api/weekly-plans`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...programPayload,
      userId,
    }),
  });

  return readJsonResponse(response);
}

export async function getWeeklyPlans() {
  const userId = await ensureCurrentUserId();
  const response = await fetch(
    `${BACKEND_URL}/api/weekly-plans?${new URLSearchParams({ userId }).toString()}`
  );

  return readJsonResponse(response);
}

export async function getWeeklyPlanById(weeklyPlanParentId) {
  const userId = await ensureCurrentUserId();
  const response = await fetch(
    `${BACKEND_URL}/api/weekly-plans/${weeklyPlanParentId}?${new URLSearchParams({
      userId,
    }).toString()}`
  );

  return readJsonResponse(response);
}

export async function openOrCreateWeeklyPlanEditDraft(weeklyPlanParentId) {
  const userId = await ensureCurrentUserId();
  const response = await fetch(
    `${BACKEND_URL}/api/weekly-plans/${weeklyPlanParentId}/edit-draft`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId }),
    }
  );

  return readJsonResponse(response);
}

export async function updateWeeklyPlanDraft(
  weeklyPlanParentId,
  weeklyPlanVersionId,
  programPayload
) {
  const userId = await ensureCurrentUserId();
  const response = await fetch(
    `${BACKEND_URL}/api/weekly-plans/${weeklyPlanParentId}/drafts/${weeklyPlanVersionId}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...programPayload,
        userId,
      }),
    }
  );

  return readJsonResponse(response);
}

export async function publishWeeklyPlanDraft(weeklyPlanParentId) {
  const userId = await ensureCurrentUserId();
  const response = await fetch(
    `${BACKEND_URL}/api/weekly-plans/${weeklyPlanParentId}/publish`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId }),
    }
  );

  return readJsonResponse(response);
}

export async function bookmarkWeeklyPlan(weeklyPlanParentId) {
  const userId = await ensureCurrentUserId();
  const response = await fetch(
    `${BACKEND_URL}/api/weekly-plans/${weeklyPlanParentId}/bookmark`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId }),
    }
  );

  return readJsonResponse(response);
}

export async function unbookmarkWeeklyPlan(weeklyPlanParentId) {
  const userId = await ensureCurrentUserId();
  const response = await fetch(
    `${BACKEND_URL}/api/weekly-plans/${weeklyPlanParentId}/bookmark`,
    {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId }),
    }
  );

  return readJsonResponse(response);
}

export async function createCycleFromWeeklyPlan(payload) {
  const userId = await ensureCurrentUserId();
  const response = await fetch(`${BACKEND_URL}/api/cycles/from-weekly-plan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...payload,
      userId,
      timezone: payload.timezone || getLocalTimezone(),
    }),
  });

  return readJsonResponse(response);
}

export async function getProgramsOverview() {
  const userId = await ensureCurrentUserId();
  const response = await fetch(
    `${BACKEND_URL}/api/cycles/overview?${new URLSearchParams({
      userId,
      timezone: getLocalTimezone(),
    }).toString()}`
  );

  return readJsonResponse(response);
}

export async function getProgramOverviewV2() {
  const userId = await ensureCurrentUserId();
  const response = await fetch(
    `${BACKEND_URL}/api/cycles/program-overview-v2?${new URLSearchParams({
      userId,
      timezone: getLocalTimezone(),
    }).toString()}`
  );

  return readJsonResponse(response);
}

function normalizeCycleLibraryItem(item) {
  return {
    id: item?.cycleId || item?.id,
    name: item?.name || 'Untitled cycle',
    editorialStatus: item?.editorialStatus || 'draft',
    temporalStatus: item?.temporalStatus || 'upcoming',
    startDate: item?.startDate || null,
    endDate: item?.endDate || null,
    durationWeeks: item?.durationWeeks || 0,
    sessionsPerWeek: item?.summary?.sessionsPerWeek || 0,
    totalWeeklySets:
      typeof item?.summary?.totalSetsFirstWeek === 'number'
        ? item.summary.totalSetsFirstWeek
        : null,
  };
}

export async function getAllCycles() {
  const overview = await getProgramsOverview();
  const orderedItems = [
    overview?.currentProgram,
    ...(overview?.upcomingPrograms || []),
    ...(overview?.pastPrograms || []),
  ].filter(Boolean);

  const dedupedItems = Array.from(
    new Map(orderedItems.map((item) => [item.cycleId || item.id, item])).values()
  );

  return {
    timezone: overview?.timezone || getLocalTimezone(),
    items: dedupedItems.map(normalizeCycleLibraryItem),
  };
}

export async function getCycleDetails(cycleId) {
  const userId = await ensureCurrentUserId();
  const response = await fetch(
    `${BACKEND_URL}/api/cycles/${cycleId}?${new URLSearchParams({
      userId,
      timezone: getLocalTimezone(),
    }).toString()}`
  );

  return readJsonResponse(response);
}

export async function openOrCreateCycleEditDraft(cycleId, options = {}) {
  const userId = await ensureCurrentUserId();
  const response = await fetch(`${BACKEND_URL}/api/cycles/${cycleId}/edit-draft`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...options,
      userId,
      timezone: options.timezone || getLocalTimezone(),
    }),
  });

  return readJsonResponse(response);
}

export async function updateCycleDraft(cycleId, planId, payload) {
  const userId = await ensureCurrentUserId();
  const response = await fetch(`${BACKEND_URL}/api/cycles/${cycleId}/drafts/${planId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...payload,
      userId,
      timezone: payload.timezone || getLocalTimezone(),
    }),
  });

  return readJsonResponse(response);
}

export async function publishCycleDraft(cycleId, options = {}) {
  const userId = await ensureCurrentUserId();
  const response = await fetch(`${BACKEND_URL}/api/cycles/${cycleId}/publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...options,
      userId,
      timezone: options.timezone || getLocalTimezone(),
    }),
  });

  return readJsonResponse(response);
}

export async function rescheduleUpcomingCycle(cycleId, payload) {
  const userId = await ensureCurrentUserId();
  const response = await fetch(`${BACKEND_URL}/api/cycles/${cycleId}/reschedule`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...payload,
      userId,
      timezone: payload.timezone || getLocalTimezone(),
    }),
  });

  return readJsonResponse(response);
}

export async function deleteCycle(cycleId) {
  const userId = await ensureCurrentUserId();
  const response = await fetch(`${BACKEND_URL}/api/cycles/${cycleId}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId }),
  });

  return readJsonResponse(response);
}

export async function getHomeDashboard() {
  const userId = await ensureCurrentUserId();
  const response = await fetch(
    `${BACKEND_URL}/api/cycles/home-dashboard?${new URLSearchParams({
      userId,
      timezone: getLocalTimezone(),
    }).toString()}`
  );

  return readJsonResponse(response);
}
