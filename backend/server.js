// Main Server File
// Initializes Express app, connects to database, and sets up routes
// Purpose: Entry point for the backend server

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { sequelize, testConnection, syncDatabase } = require('./db');
const { populateExercisesFromJSON } = require('./controllers/exerciseController');

// Import routes
const exerciseRoutes = require('./routes/exercises');
const planRoutes = require('./routes/plans');

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
// Configure CORS to allow requests from Codespaces and localhost
// 1. Ajoutez votre URL Vercel dans cette liste (ou via .env)
const allowedOrigins = [
  'http://localhost:3000',
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

// Routes
app.use('/api/exercises', exerciseRoutes);
app.use('/api/plans', planRoutes);

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Backend server is running',
    timestamp: new Date().toISOString(),
  });
});

// Root endpoint
app.get('/', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Lyft Zone Backend API',
    endpoints: {
      health: 'GET /health',
      exercises: 'GET /api/exercises',
      exerciseById: 'GET /api/exercises/:id',
      createPlan: 'POST /api/plans',
      getPlansByUser: 'GET /api/plans/:userId',
    },
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({
    success: false,
    message: 'Internal server error',
    error: err.message,
  });
});

// Initialize database and start server
const startServer = async () => {
  try {
    // Test database connection
    await testConnection();

    // Sync database models
    await syncDatabase();

    // Populate exercises from JSON if database is empty
    await populateExercisesFromJSON();

    // Start Express server
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
      console.log(`✓ API documentation: http://localhost:${PORT}`);
      console.log(`✓ Health check: http://localhost:${PORT}/health\n`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
};

startServer();

module.exports = app;
