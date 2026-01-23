// Exercise Model
// Defines the Exercise schema for the database
// Fields: id, name, muscleGroup, equipment, difficulty, imageUrl, tempo

const { DataTypes } = require('sequelize');
const { sequelize } = require('../db');

const Exercise = sequelize.define('Exercise', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  name: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true,
  },
  muscleGroup: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  equipment: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  difficulty: {
    type: DataTypes.STRING,
    allowNull: false,
    defaultValue: 'intermediate',
  },
  imageUrl: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  tempo: {
    type: DataTypes.STRING,
    allowNull: true,
  },
}, {
  tableName: 'exercises',
  timestamps: false,
});

module.exports = Exercise;
