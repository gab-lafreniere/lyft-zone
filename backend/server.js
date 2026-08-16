// Main Server File
// Initializes Express app, connects to database, and sets up routes
// Purpose: Entry point for the backend server

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { testConnection, syncDatabase } = require('./db');

const healthRoutes = require('./routes/health');
const planRoutes = require('./routes/plans');
const exercisesRouter = require('./routes/exercisesPrisma');
const usersRouter = require('./routes/users');
const cyclesRouter = require('./routes/cycles');
const programsRouter = require('./routes/programs');
const homeRouter = require('./routes/home');
const scheduledSessionsRouter = require('./routes/scheduledSessions');
const weeklyPlansRouter = require('./routes/weeklyPlans');

const app = express();
const PORT = process.env.PORT || 5001; // en local, évite 5000

// Middleware
// Configure CORS to allow requests from Codespaces and localhost
// 1. Ajoutez votre URL Vercel dans cette liste (ou via .env)
const allowedOrigins = [
  'http://localhost:3000',
  'http://localhost:3001',
  'http://localhost:5000',
  'http://localhost:5001',
  'http://127.0.0.1:3000',
  process.env.FRONTEND_URL, // Ajoutez ceci pour Render
].filter(Boolean); // Retire les valeurs vides si FRONTEND_URL n'est pas défini

const corsOptions = {
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);

    // Vérification localhost ou URL spécifique
    const isAllowed = allowedOrigins.includes(origin);
    
    // Vérification Codespaces ou Vercel (wildcard)
    const isPreview = /\.github\.dev$/.test(origin) || /\.vercel\.app$/.test(origin);

    if (isAllowed || isPreview) {
      return callback(null, true);
    }

    console.log(`CORS blocked origin: ${origin}`);
    return callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization'],
};

// Builder saves send the whole plan document so the backend can diff it against the
// stored draft. A six-week, six-day cycle serializes to ~380 KB, which silently exceeded
// body-parser's 100 KB default and was rejected before routing. The limit is explicit so
// it cannot drift back to the default, and generous enough for longer cycles without
// being unbounded.
const REQUEST_BODY_LIMIT = '2mb';

app.use(cors(corsOptions));
app.use(express.json({ limit: REQUEST_BODY_LIMIT })); // Parse JSON request bodies
app.use(express.urlencoded({ extended: true, limit: REQUEST_BODY_LIMIT })); // Parse URL-encoded bodies

// body-parser rejects an oversized body before any route runs, so without this the
// default Express handler answers with HTML. Clients parse every failure as JSON, so an
// HTML body turned a precise 413 into an opaque SyntaxError with no status.
// Registered directly after the parsers: it sees their errors and leaves everything else
// to the existing per-controller handling.
app.use((error, req, res, next) => {
  if (!error) {
    return next();
  }

  const isPayloadTooLarge =
    error.type === 'entity.too.large' ||
    error.status === 413 ||
    error.statusCode === 413;

  if (!isPayloadTooLarge) {
    return next(error);
  }

  return res.status(413).json({
    error: {
      code: 'PAYLOAD_TOO_LARGE',
      message: 'Request body is too large.',
    },
  });
});

app.use('/health', healthRoutes);
app.use('/api/exercises', exercisesRouter);
app.use('/api/users', usersRouter);
app.use('/api/cycles', cyclesRouter);
app.use('/api/programs', programsRouter);
app.use('/api/home', homeRouter);
app.use('/api/scheduled-sessions', scheduledSessionsRouter);
app.use('/api/weekly-plans', weeklyPlansRouter);

// Other routes
app.use('/api/plans', planRoutes);

// health, root, error middleware... (inchangé)

const startServer = async () => {
  try {
    await testConnection();
    await syncDatabase();

    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
};

// Only boot when run directly, so tests can mount the real app without opening a port
// or touching the database.
if (require.main === module) {
  startServer();
}

module.exports = app;
module.exports.app = app;
module.exports.REQUEST_BODY_LIMIT = REQUEST_BODY_LIMIT;
