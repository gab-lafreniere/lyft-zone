# Solution CORS pour GitHub Codespaces

## Problème Résolu

Erreur CORS : `Access to fetch has been blocked by CORS policy: No 'Access-Control-Allow-Origin' header is present`

## Solution Implémentée

### 1. Backend (server.js) - Configuration CORS Appropriée

Le backend Express est maintenant configuré pour accepter les requêtes depuis:
- `localhost:3000` et `127.0.0.1:3000` (développement local)
- `localhost:5000` et `127.0.0.1:5000` (développement local)
- Tous les domaines `github.dev` (Codespaces)

```javascript
const corsOptions = {
  origin: (origin, callback) => {
    // Allow localhost and github.dev origins
    const allowedOrigins = [
      'http://localhost:3000',
      'http://127.0.0.1:3000',
      'http://localhost:5000',
      'http://127.0.0.1:5000',
    ];

    if (origin && origin.includes('github.dev')) {
      allowedOrigins.push(origin);
    }

    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization'],
};

app.use(cors(corsOptions));
```

### 2. Frontend (api.js) - Détection Automatique de l'URL

Le service API détecte automatiquement l'environnement:

```javascript
const getBackendUrl = () => {
  // Option 1: Variable d'environnement
  if (process.env.REACT_APP_BACKEND_URL) {
    return process.env.REACT_APP_BACKEND_URL;
  }

  const hostname = window.location.hostname;
  const protocol = window.location.protocol;

  // Option 2: Codespaces - Détection automatique
  // Frontend: [workspace]-3000.app.github.dev
  // Backend: [workspace]-5000.app.github.dev
  if (hostname.includes('app.github.dev')) {
    const backendUrl = hostname.replace('-3000.app.github.dev', '-5000.app.github.dev');
    return `${protocol}//${backendUrl}`;
  }

  // Option 3: Développement local
  return 'http://localhost:5000';
};
```

## Comment ça Fonctionne en Codespaces

### Frontend URL
```
https://glorious-waffle-v6rvvrjpgppqh6r9-3000.app.github.dev
```

### Backend URL (détecté automatiquement)
```
https://glorious-waffle-v6rvvrjpgppqh6r9-5000.app.github.dev
```

Le code remplace `-3000.app.github.dev` par `-5000.app.github.dev` automatiquement!

## Comment Utiliser

### 1. En Développement Local

```bash
# Terminal 1: Backend
cd backend
npm start
# Runs on http://localhost:5000

# Terminal 2: Frontend
cd frontend
npm start
# Runs on http://localhost:3000
```

**Pas de configuration nécessaire** - l'API détecte `localhost:5000` automatiquement.

### 2. En GitHub Codespaces

```bash
# Terminal 1: Backend
cd backend
npm start

# Terminal 2: Frontend
cd frontend
npm start
```

**Pas de configuration nécessaire** - l'API détecte le domaine Codespaces automatiquement.

### 3. Avec Variable d'Environnement

Si vous avez besoin d'une URL spécifique:

```bash
# Dans frontend/.env.local
REACT_APP_BACKEND_URL=https://your-backend-url:5000
```

## Fichiers Modifiés

### Backend: `/workspaces/lyft-zone/backend/server.js`
- ✅ Configuration CORS avec dynamique `origin`
- ✅ Support des domaines `github.dev`
- ✅ Support de `localhost`

### Frontend: `/workspaces/lyft-zone/frontend/src/services/api.js`
- ✅ Détection automatique de l'URL backend
- ✅ Support Codespaces et développement local
- ✅ Support variable d'environnement
- ✅ Logging amélioré pour debug

## Debugging

Si vous rencontrez toujours une erreur CORS, vérifiez:

1. **Backend running?**
   ```bash
   curl http://localhost:5000/health
   ```

2. **Vérifiez les logs du backend** pour voir quels origins sont autorisés

3. **Ouvrez la console du navigateur** (F12) pour voir les logs de détection d'URL:
   ```
   🐙 Codespaces detected. Backend URL: https://...
   🚀 Fetching exercises from: https://...
   ```

4. **Requête POST manuelle de test:**
   ```bash
   curl -X GET http://localhost:5000/api/exercises \
     -H "Content-Type: application/json"
   ```

## Format de Réponse du Backend

Attend une réponse JSON comme:
```json
[
  {
    "name": "Barbell Bench Press",
    "muscleGroup": "Chest",
    "equipment": "Barbell",
    "difficulty": "intermediate",
    "imageUrl": "https://...",
    "tempo": "2-1-2"
  }
]
```

## Notes de Sécurité

⚠️ **Production**: La configuration `origin: ...includes('github.dev')` accepte **tous** les domaines github.dev du même compte. Pour la production, listez les origines spécifiquement:

```javascript
const allowedOrigins = [
  'https://my-app.example.com',
  'https://api.example.com',
];
```

## Référence

- 📚 [MDN: CORS Documentation](https://developer.mozilla.org/en-US/docs/Web/HTTP/CORS)
- 🚀 [GitHub Codespaces Networking](https://docs.github.com/en/codespaces/developing-in-a-codespace/using-source-control-in-your-codespace)
- 📦 [npm cors Package](https://www.npmjs.com/package/cors)
