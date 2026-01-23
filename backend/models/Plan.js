// Plan Model
// Defines the TrainingPlan schema for the database
// Fields: id, userId, name, exercises (JSON), createdAt

const { DataTypes } = require('sequelize');
const { sequelize } = require('../db');

const Plan = sequelize.define('Plan', {
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
  exercises: {
    type: DataTypes.JSON,
    allowNull: false,
  },
  createdAt: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW,
  },
}, {
  tableName: 'plans',
  timestamps: false,
});

module.exports = Plan;
