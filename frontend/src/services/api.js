const BACKEND_URL =
  process.env.REACT_APP_BACKEND_URL ||
  'https://lyft-zone-backend.onrender.com';

export const fetchExercises = async () => {
  const response = await fetch(`${BACKEND_URL}/api/exercises`);

  if (!response.ok) {
    throw new Error(`API error ${response.status}`);
  }

  const json = await response.json();
  return json.data;
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
