// Exercise Model (Phase 1)
// Base d'exercices : champs canoniques Phase 1 + compatibilité existante (muscleGroup, equipment, tempo)

const { DataTypes } = require('sequelize');
const { sequelize } = require('../db');

const equipmentToLoadType = (equipment) => {
  if (!equipment) return null;
  const e = equipment.toLowerCase();
  if (e === 'bodyweight') return 'bodyweight';
  if (e === 'machine' || e === 'cable machine') return 'machine';
  return 'free';
};

const Exercise = sequelize.define('Exercise', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  externalId: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  name: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true,
  },
  primaryMuscleGroup: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  muscleGroup: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  secondaryMuscleGroups: {
    type: DataTypes.JSON,
    allowNull: true,
    defaultValue: [],
  },
  exerciseType: {
    type: DataTypes.STRING,
    allowNull: true,
    defaultValue: 'compound',
  },
  tensionProfile: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  loadType: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  equipment: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  systemicFatigueLevel: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  recommendedTempo: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  tempo: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  substituteExerciseIds: {
    type: DataTypes.JSON,
    allowNull: true,
    defaultValue: [],
  },
  difficulty: {
    type: DataTypes.STRING,
    allowNull: true,
    defaultValue: 'intermediate',
  },
  imageUrl: {
    type: DataTypes.STRING,
    allowNull: true,
  },
}, {
  tableName: 'exercises',
  timestamps: false,
});

Exercise.equipmentToLoadType = equipmentToLoadType;
module.exports = Exercise;
