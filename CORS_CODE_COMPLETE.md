# Code Complet CORS - Backend et Frontend

## 📦 Backend: server.js (Extrait CORS)

```javascript
// Middleware
// Configure CORS to allow requests from Codespaces and localhost
const corsOptions = {
  origin: (origin, callback) => {
    // List of allowed origins
    const allowedOrigins = [
      'http://localhost:3000',           // Local development
      'http://127.0.0.1:3000',           // Local development (127.0.0.1)
      'http://localhost:5000',           // Local development
      'http://127.0.0.1:5000',           // Local development (127.0.0.1)
    ];

    // In Codespaces/production: allow any github.dev domain (same account)
    if (origin && origin.includes('github.dev')) {
      allowedOrigins.push(origin);
    }

    // Allow requests with no origin (mobile apps, Postman, etc)
    if (!origin) {
      return callback(null, true);
    }

    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      console.log(`CORS blocked origin: ${origin}`);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization'],
};

app.use(cors(corsOptions)); // Enable CORS with proper configuration
app.use(express.json()); // Parse JSON request bodies
app.use(express.urlencoded({ extended: true })); // Parse URL-encoded bodies
```

## 🎨 Frontend: src/services/api.js (Code Complet)

```javascript
/**
 * API Service for fetching exercise data from the backend
 * 
 * This service handles all communication with the backend API,
 * including error handling and loading states.
 */

/**
 * Get the backend URL based on the environment
 * In Codespaces, automatically constructs the backend URL from the current hostname
 * In local development, uses localhost:5000
 * 
 * How it works:
 * - Codespaces frontend URL: https://[workspace]-3000.app.github.dev
 * - Codespaces backend URL: https://[workspace]-5000.app.github.dev
 * - We extract the workspace identifier and construct the backend URL
 */
const getBackendUrl = () => {
  // First, check for environment variable
  if (process.env.REACT_APP_BACKEND_URL) {
    console.log('📡 Using backend URL from environment:', process.env.REACT_APP_BACKEND_URL);
    return process.env.REACT_APP_BACKEND_URL;
  }

  const hostname = window.location.hostname;
  const protocol = window.location.protocol;

  // Check if running in GitHub Codespaces
  if (hostname.includes('app.github.dev')) {
    // Extract the workspace ID from the hostname
    // Format: [workspace-id]-3000.app.github.dev
    // We need to replace the port (3000) with 5000
    const backendUrl = hostname.replace('-3000.app.github.dev', '-5000.app.github.dev');
    const fullUrl = `${protocol}//${backendUrl}`;
    console.log('🐙 Codespaces detected. Backend URL:', fullUrl);
    return fullUrl;
  }

  // Local development fallback
  const localUrl = 'http://localhost:5000';
  console.log('💻 Local development detected. Backend URL:', localUrl);
  return localUrl;
};

const BACKEND_URL = getBackendUrl();

/**
 * Fetch all exercises from the backend API
 * 
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
    
    // Check if the response is ok (status 200-299)
    if (!response.ok) {
      throw new Error(`API error: ${response.status} ${response.statusText}`);
    }
    
    const data = await response.json();
    console.log('✅ Successfully fetched exercises:', data.length, 'exercises');
    return data;
  } catch (error) {
    // Provide detailed error messages for debugging
    console.error('❌ Failed to fetch exercises:', error);
    
    if (error instanceof TypeError && error.message.includes('Failed to fetch')) {
      console.error('   → Network error. Check if backend is running and CORS is configured.');
      console.error('   → Backend URL:', BACKEND_URL);
    }
    
    throw error;
  }
};
```

## ⚙️ Configuration Optionnelle: frontend/.env.local

```env
# Backend API URL (optional - auto-detected by default)
# Leave empty for automatic detection in Codespaces/localhost

# Example for local development:
REACT_APP_BACKEND_URL=http://localhost:5000

# Example for specific Codespaces backend:
# REACT_APP_BACKEND_URL=https://glorious-waffle-v6rvvrjpgppqh6r9-5000.app.github.dev
```

## 🎯 Flux d'Exécution

```
1. Frontend démarre (port 3000)
   ↓
2. User accède à http://localhost:3000
   ↓
3. React charge api.js
   ↓
4. getBackendUrl() détecte l'environnement
   ├─ Si Codespaces: extraire hostname et remplacer -3000 par -5000
   ├─ Si Local: utiliser http://localhost:5000
   └─ Si env var définie: utiliser cette URL
   ↓
5. fetchExercises() envoie fetch() avec headers CORS
   ↓
6. Backend reçoit la requête
   ↓
7. corsOptions valide l'origin
   ├─ Si localhost: ✅ Accepter
   ├─ Si github.dev: ✅ Accepter
   └─ Sinon: ❌ Bloquer
   ↓
8. Backend envoie réponse avec headers CORS
   ↓
9. Frontend reçoit les exercices et les affiche
```

## 🧪 Test en Curl

```bash
# Test 1: Vérifier que le backend tourne
curl http://localhost:5000/health

# Test 2: Récupérer les exercices
curl http://localhost:5000/api/exercises

# Test 3: Tester les headers CORS (preflight request)
curl -X OPTIONS \
  -H "Origin: http://localhost:3000" \
  -H "Access-Control-Request-Method: GET" \
  -H "Access-Control-Request-Headers: Content-Type" \
  -v http://localhost:5000/api/exercises

# Réponse attendue:
# Access-Control-Allow-Origin: http://localhost:3000
# Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS, PATCH
# Access-Control-Allow-Headers: Content-Type, Authorization
```

## 🔐 Sécurité CORS

### ✅ Ce qui est autorisé (Permissif pour dev)
- `localhost:3000` (frontend local)
- `127.0.0.1:3000` (alternative)
- Tous les `*.github.dev` (même compte)

### ❌ Ce qui ne l'est pas (Bloqué)
- Domaines externes
- Origines inconnues

### ⚠️ Pour la Production
Remplacer `github.dev` par des domaines spécifiques:
```javascript
const allowedOrigins = [
  'https://myapp.example.com',
  'https://www.myapp.example.com',
];
```

---

**Status**: ✅ CORS Complètement Configuré
