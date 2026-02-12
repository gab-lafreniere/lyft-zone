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
