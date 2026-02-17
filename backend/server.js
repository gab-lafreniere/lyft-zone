// Main Server File
// Initializes Express app, connects to database, and sets up routes
// Purpose: Entry point for the backend server

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { testConnection, syncDatabase } = require('./db');

require('./models');

const planRoutes = require('./routes/plans');

const { loadExercisesSeed } = require("./src/exercises/exercisesStore");
const { createExercisesRouter } = require("./src/exercises/exercisesRoutes");

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

app.use(cors(corsOptions));
app.use(express.json()); // Parse JSON request bodies
app.use(express.urlencoded({ extended: true })); // Parse URL-encoded bodies

// Seed exercises router
const store = loadExercisesSeed();
app.use("/api/exercises", createExercisesRouter(store));

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

startServer();

module.exports = app;
