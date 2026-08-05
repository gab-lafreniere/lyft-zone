function createContext(overrides = {}) {
  return {
    schemaVersion: 5,
    generationMode: 'weekly_plan_draft',
    coachInputs: null,
    userId: 'user_current_pipeline',
    createdAt: '2026-07-28T12:00:00.000Z',
    profileSchemaVersion: 4,
    primaryGoal: 'HYPERTROPHY',
    experience: 'INTERMEDIATE',
    demographics: null,
    availability: {
      sessionsPerWeek: 1,
      durationPerSession: 15,
    },
    evaluationPolicy: null,
    musclePriorityProfile: {
      primaryFocus: 'chest',
      secondaryFocuses: [],
      deprioritizedArea: null,
    },
    equipmentContext: {},
    movementConstraints: {},
    promptPhysicalConsiderations: [],
    cardioProfile: {
      cardioRole: 'none',
      preferredModalities: [],
    },
    physicalNotes: null,
    poolSummary: {},
    poolSnapshot: {
      availableExerciseCount: 1,
      allowedExerciseIds: ['ex_bench'],
      allowedTrainingTypes: ['strength'],
    },
    exercisePoolItems: [
      {
        exerciseId: 'ex_bench',
        name: 'Bench Press',
        trainingType: 'strength',
        bodyParts: ['chest'],
        muscleFocus: ['upper_chest'],
        targetMuscles: ['pectoralis_major'],
        secondaryMuscles: ['triceps'],
        equipmentCategory: 'free_weights',
        muscles: {
          primary: { pectoralis_major: 'high' },
          secondary: { triceps: 'medium' },
        },
      },
    ],
    ...overrides,
  };
}

module.exports = {
  createContext,
};
