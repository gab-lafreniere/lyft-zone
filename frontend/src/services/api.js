const BACKEND_URL =
  process.env.REACT_APP_BACKEND_URL ||
  'https://lyft-zone-backend.onrender.com';

const USER_ID_STORAGE_KEY = 'lyft_zone_user_id';

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
