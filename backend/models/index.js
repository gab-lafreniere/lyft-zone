// Models index: charge tous les modèles et définit les associations
// Évite les dépendances circulaires entre Program et TrainingSession

const Exercise = require('./Exercise');
const Program = require('./Program');
const TrainingSession = require('./TrainingSession');

Program.hasMany(TrainingSession, { foreignKey: 'programId' });
TrainingSession.belongsTo(Program, { foreignKey: 'programId' });

module.exports = {
  Exercise,
  Program,
  TrainingSession,
};
