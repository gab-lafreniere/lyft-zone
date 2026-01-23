/**
 * API Service for fetching exercise data from the backend
 * 
 * Handles communication with backend API, CORS-safe, with proper error handling
 */

/**
 * Get the backend URL based on the environment
 * In Codespaces, constructs backend URL automatically from current hostname
 * In local development, defaults to localhost:5000
 */
const getBackendUrl = () => {
  if (process.env.REACT_APP_BACKEND_URL) {
    console.log('📡 Using backend URL from environment:', process.env.REACT_APP_BACKEND_URL);
    return process.env.REACT_APP_BACKEND_URL;
  }

  const hostname = window.location.hostname;
  const protocol = window.location.protocol;

  // Codespaces detection: remplace n’importe quel port frontend (-3000, -3001...) par -5000 pour le backend
  if (hostname.endsWith('.app.github.dev')) {
    const backendHost = hostname.replace(/-\d+\.app\.github\.dev$/, '-5000.app.github.dev');
    const fullUrl = `${protocol}//${backendHost}`;
    console.log('🐙 Codespaces detected. Backend URL:', fullUrl);
    return fullUrl;
  }

  // Local fallback
  const localUrl = 'http://localhost:5000';
  console.log('💻 Local development detected. Backend URL:', localUrl);
  return localUrl;
};


const BACKEND_URL = getBackendUrl();

/**
 * Fetch all exercises from the backend API
 * @returns {Promise<Array>} Array of exercise objects
 * @throws {Error} If the fetch fails or API returns an error
 */
export const fetchExercises = async () => {
  try {
    const url = `${BACKEND_URL}/api/exercises`;
    console.log('🚀 Fetching exercises from:', url);

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    // Check if response is OK (200-299)
    if (!response.ok) {
      throw new Error(`API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    console.log('✅ Successfully fetched exercises:', data.length, 'exercises');
    return data;
  } catch (error) {
    console.error('❌ Failed to fetch exercises:', error);

    if (error instanceof TypeError && error.message.includes('Failed to fetch')) {
      console.error('   → Network error. Check if backend is running and CORS is configured.');
      console.error('   → Backend URL:', BACKEND_URL);
    }

    throw error;
  }
};
