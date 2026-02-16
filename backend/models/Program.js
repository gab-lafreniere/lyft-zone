// Program Model (Phase 1)
// Template hebdomadaire : N types de séances répétées chaque semaine.
// Champs: id, userId, name, durationWeeks, sessionsPerWeek, createdAt

const { DataTypes } = require('sequelize');
const { sequelize } = require('../db');

const Program = sequelize.define('Program', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  userId: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  name: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  durationWeeks: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  sessionsPerWeek: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  createdAt: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW,
  },
}, {
  tableName: 'programs',
  timestamps: false,
});

module.exports = Program;
