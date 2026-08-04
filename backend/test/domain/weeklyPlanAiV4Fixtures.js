const {
  WEEKLY_PLAN_EVALUATION_POLICY,
} = require('../../src/domain/programGeneration/weeklyPlanEvaluationPolicy');

const BODY_PARTS = [
  'abs',
  'back',
  'biceps',
  'calves',
  'chest',
  'glutes',
  'hamstrings',
  'quadriceps',
  'shoulders',
  'triceps',
];

function clone(value) {
  return structuredClone(value);
}

function createSetTemplate(index = 1, overrides = {}) {
  return {
    setIndex: index,
    setType: 'WORKING',
    targetReps: 10,
    minReps: null,
    maxReps: null,
    targetSeconds: null,
    targetRir: 2,
    tempo: '3010',
    restSeconds: 120,
    ...overrides,
  };
}

function createAiExercise(overrides = {}) {
  return {
    exerciseId: 'ex_bench',
    exerciseName: 'Bench Press',
    orderIndex: 1,
    bodyParts: ['chest'],
    muscleFocus: ['upper_chest'],
    defaultTempo: '3010',
    defaultRestSeconds: 120,
    defaultTargetRir: 2,
    setTemplates: [createSetTemplate()],
    cardioPrescription: null,
    notes: null,
    ...overrides,
  };
}

function createAiOutput(overrides = {}) {
  return {
    schemaVersion: 4,
    planName: 'Output V4 Plan',
    sessionsPerWeek: 1,
    strategySummary: 'The plan uses productive work for the available session.',
    splitType: 'full_body',
    workouts: [
      {
        name: 'Workout 1',
        orderIndex: 1,
        focus: 'Chest emphasis',
        blocks: [
          {
            orderIndex: 1,
            blockType: 'SINGLE',
            exercises: [createAiExercise()],
          },
        ],
      },
    ],
    muscleDistributionDebug: {
      rationale: 'The plan reports every area without direct working sets.',
      omittedBodyParts: BODY_PARTS.filter((area) => area !== 'chest').map(
        (area) => ({
          area,
          reasonCode: 'specialization_tradeoff',
          explanation: `${area} is omitted from this focused fixture.`,
        })
      ),
    },
    progressionModel: {
      type: 'double_progression',
      summary: 'Increase repetitions before load.',
    },
    cautionHandling: {
      summary: 'Respect every confirmed caution.',
    },
    notesPolicy: {
      summary: 'Use notes only for useful coaching context.',
    },
    ...overrides,
  };
}

function createContext(overrides = {}) {
  return {
    schemaVersion: 5,
    generationMode: 'weekly_plan_draft',
    coachInputs: null,
    userId: 'user_v4',
    createdAt: '2026-07-28T12:00:00.000Z',
    profileSchemaVersion: 4,
    primaryGoal: 'HYPERTROPHY',
    experience: 'INTERMEDIATE',
    demographics: null,
    availability: {
      sessionsPerWeek: 1,
      durationPerSession: 15,
    },
    evaluationPolicy: WEEKLY_PLAN_EVALUATION_POLICY,
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

function createNormalizedDocument({
  targetSeconds = null,
  targetReps = 10,
  setCount = 1,
  estimatedDurationMinutes = null,
} = {}) {
  const aiOutput = createAiOutput();
  aiOutput.workouts[0].blocks[0].exercises[0].setTemplates =
    Array.from({ length: setCount }, (_, index) =>
      createSetTemplate(index + 1, {
        targetReps: targetSeconds == null ? targetReps : null,
        targetSeconds,
      })
    );

  return {
    name: aiOutput.planName,
    sessionsPerWeek: 1,
    workouts: [
      {
        name: 'Workout 1',
        orderIndex: 1,
        estimatedDurationMinutes,
        notes: 'Chest emphasis',
        blocks: [
          {
            orderIndex: 1,
            blockType: 'SINGLE',
            label: null,
            roundCount: setCount,
            restStrategy: 'BETWEEN_SETS',
            restSeconds: 120,
            notes: null,
            exercises: [
              {
                ...createAiExercise({
                  setTemplates:
                    aiOutput.workouts[0].blocks[0].exercises[0].setTemplates,
                }),
                executionNotes: null,
                defaultTargetRpe: null,
                intensificationMethod: 'NONE',
              },
            ],
          },
        ],
      },
    ],
  };
}

function createPassReview() {
  return {
    enabled: true,
    review: {
      schemaVersion: 3,
      decision: 'PASS',
      requiresRepair: false,
      reviewSummary: 'The plan is coherent and ready to persist.',
      issues: [],
    },
    provider: {
      type: 'openai',
      model: 'test-model',
      responseId: 'resp_review',
      usage: {
        inputTokens: 10,
        outputTokens: 5,
        totalTokens: 15,
        reasoningTokens: 0,
      },
    },
    promptVersion: 'ai-program-review-prompt-v1.3.0',
    contractVersion: 3,
    outputSchemaVersion: 3,
    decision: 'PASS',
    requiresRepair: false,
    issueCount: 0,
    severityCounts: { INFO: 0, LOW: 0, MEDIUM: 0, HIGH: 0 },
    categoryCounts: {},
    repairIssues: [],
  };
}

module.exports = {
  BODY_PARTS,
  clone,
  createAiExercise,
  createAiOutput,
  createContext,
  createNormalizedDocument,
  createPassReview,
  createSetTemplate,
};
