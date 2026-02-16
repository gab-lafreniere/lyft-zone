// TrainingSession Model (Phase 1)
// Type de séance (template) dans un programme. exerciseSlots stocké en JSON.
// Champs: id, programId, name, orderIndex, exerciseSlots

const { DataTypes } = require('sequelize');
const { sequelize } = require('../db');

const TrainingSession = sequelize.define('TrainingSession', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  programId: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: { model: 'programs', key: 'id' },
    onDelete: 'CASCADE',
  },
  name: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  orderIndex: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  exerciseSlots: {
    type: DataTypes.JSON,
    allowNull: false,
    defaultValue: [],
    // Chaque slot: { exerciseId, orderIndex, sets, repsTarget, intensityMode, intensityValue, tempo? }
  },
}, {
  tableName: 'training_sessions',
  timestamps: false,
});

module.exports = TrainingSession;
