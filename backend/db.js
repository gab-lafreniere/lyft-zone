// Database Configuration
// Configures Sequelize ORM with SQLite database
// Purpose: Initialize database connection and sync models

const { Sequelize } = require('sequelize');
const path = require('path');

// Create Sequelize instance connected to SQLite database
const sequelize = new Sequelize({
  dialect: 'sqlite',
  storage: path.join(__dirname, 'database.sqlite'),
  logging: false, // Set to console.log to see SQL queries
});

// Test the database connection
const testConnection = async () => {
  try {
    await sequelize.authenticate();
    console.log('✓ Database connection established successfully');
  } catch (error) {
    console.error('✗ Unable to connect to the database:', error);
  }
};

// Sync all models with database
const syncDatabase = async () => {
  try {
    await sequelize.sync({ alter: true });
    console.log('✓ Database synchronized');
  } catch (error) {
    console.error('✗ Database sync failed:', error);
  }
};

module.exports = {
  sequelize,
  testConnection,
  syncDatabase,
};
