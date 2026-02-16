// Plan Controller (Phase 1)
// Refactor minimal : crée Program + TrainingSessions (exerciseSlots en JSON).
// Pas de logique IA ni génération automatique.

const { Program, TrainingSession } = require('../models');

// Créer un programme et ses séances
const createPlan = async (req, res) => {
  try {
    const { userId, name, durationWeeks, sessionsPerWeek, sessions } = req.body;

    if (!userId || !name || sessionsPerWeek == null) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: userId, name, sessionsPerWeek',
      });
    }

    if (!Array.isArray(sessions) || sessions.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'sessions must be a non-empty array',
      });
    }

    const program = await Program.create({
      userId,
      name,
      durationWeeks: durationWeeks ?? null,
      sessionsPerWeek,
    });

    const sessionRecords = await Promise.all(
      sessions.map((s) =>
        TrainingSession.create({
          programId: program.id,
          name: s.name || `Session ${s.orderIndex ?? 0}`,
          orderIndex: s.orderIndex ?? 0,
          exerciseSlots: Array.isArray(s.exerciseSlots) ? s.exerciseSlots : [],
        })
      )
    );

    const programWithSessions = await Program.findByPk(program.id, {
      include: [{ model: TrainingSession, as: 'TrainingSessions' }],
    });

    res.status(201).json({
      success: true,
      message: 'Plan created successfully',
      data: programWithSessions,
    });
  } catch (error) {
    console.error('Error creating plan:', error);
    res.status(500).json({
      success: false,
      message: 'Error creating plan',
      error: error.message,
    });
  }
};

// Récupérer tous les programmes d'un utilisateur (avec séances)
const getPlansByUserId = async (req, res) => {
  try {
    const { userId } = req.params;

    const programs = await Program.findAll({
      where: { userId },
      include: [{ model: TrainingSession, as: 'TrainingSessions' }],
      order: [
        ['createdAt', 'DESC'],
        [TrainingSession, 'orderIndex', 'ASC'],
      ],
    });

    res.status(200).json({
      success: true,
      count: programs.length,
      data: programs,
    });
  } catch (error) {
    console.error('Error fetching plans:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching plans',
      error: error.message,
    });
  }
};

module.exports = {
  createPlan,
  getPlansByUserId,
};
