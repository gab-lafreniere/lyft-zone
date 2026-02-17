const BACKEND_URL =
  process.env.REACT_APP_BACKEND_URL ||
  'https://lyft-zone-backend.onrender.com';

  export const fetchExercises = async (limit = 200) => {
    const response = await fetch(`${BACKEND_URL}/api/exercises?limit=${limit}`);
  
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
