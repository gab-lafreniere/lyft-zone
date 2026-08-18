import {
  mapCycleBuilderPayload,
  mapMultiWeekDraftToApi,
} from "../multiWeek/mappers";

// The diff module only needs ApiError for identity-conflict branches. Mock
// that leaf dependency so CRA/Jest can load the production diff functions
// without evaluating the backend Prisma client, which uses Node package
// imports that this browser-oriented test runner does not resolve.
jest.mock("../../../../backend/services/usersService", () => ({
  ApiError: class ApiError extends Error {
    constructor(status, code, message, details) {
      super(message);
      this.status = status;
      this.code = code;
      this.details = details;
    }
  },
}));

const {
  toCycleBuilderWorkout,
} = require("../../../../backend/services/draftBuilderPersistence");
const {
  diffWorkoutList,
  normalizeWorkoutForPersistence,
} = require("../../../../backend/services/draftDocumentDiff");

const DAYS = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"];

function createSet(workoutId, lane, setIndex) {
  return {
    id: `${workoutId}_${lane}_set_${setIndex}`,
    setIndex,
    setType: setIndex === 1 ? "TOP_SET" : setIndex === 2 ? "BACKOFF" : "WORKING",
    targetReps: null,
    minReps: setIndex === 3 ? 6 : 8,
    maxReps: setIndex === 3 ? 10 : 12,
    targetSeconds: setIndex === 4 ? 45 : null,
    targetRir: null,
    targetRpe: setIndex === 1 ? 8.5 : 8,
    tempo: null,
    restSeconds: null,
    notes: setIndex === 1 ? `${lane} persisted set note` : null,
  };
}

function createExercise(workoutId, lane, orderIndex, setCount) {
  return {
    id: `${workoutId}_${lane}_row`,
    exerciseId: `library_${lane}`,
    exerciseName: lane === "single" ? "Incline Press" : `Superset ${lane.toUpperCase()}`,
    bodyParts: lane === "single" ? ["chest"] : ["back"],
    muscleFocus: lane === "single" ? ["upper_chest"] : ["lats"],
    orderIndex,
    executionNotes: `${lane} execution backing`,
    defaultTempo: null,
    defaultRestSeconds: null,
    defaultTargetRir: null,
    defaultTargetRpe: 8.5,
    intensificationMethod: lane === "single" ? "DROP_SET" : "NONE",
    cardioPrescription: null,
    notes: `${lane} row backing`,
    setTemplates: Array.from({ length: setCount }, (_, index) =>
      createSet(workoutId, lane, index + 1)
    ),
  };
}

function createWorkout(weekNumber, workoutNumber) {
  const workoutId = `week_${weekNumber}_workout_${workoutNumber}`;
  const cardioPrescription = {
    durationMinutes: 24,
    heartRateTargetMode: "zone",
    heartRateTargetValue: 2,
    machineSettings: [
      { key: "incline", value: "7" },
      { key: "speed", value: "4.5" },
      { key: "stride", value: "long" },
    ],
    notes: "steady effort",
    vendorExtension: { source: "import" },
  };
  const cardioExercise = {
    id: `${workoutId}_cardio_row`,
    exerciseId: "library_treadmill",
    exerciseName: "Treadmill",
    bodyParts: [],
    muscleFocus: [],
    orderIndex: 1,
    executionNotes: null,
    defaultTempo: null,
    defaultRestSeconds: null,
    defaultTargetRir: null,
    defaultTargetRpe: null,
    intensificationMethod: "NONE",
    cardioPrescription,
    notes: "cardio row backing",
    setTemplates: [],
  };

  return {
    id: workoutId,
    name: `Week ${weekNumber} Workout ${workoutNumber}`,
    orderIndex: workoutNumber,
    scheduledDay: DAYS[workoutNumber - 1],
    estimatedDurationMinutes: 67,
    notes: "persisted workout note",
    blocks: [
      {
        id: `${workoutId}_single_block`,
        orderIndex: 1,
        blockType: "SINGLE",
        label: "Primary",
        roundCount: null,
        restStrategy: "AFTER_EXERCISE",
        restSeconds: null,
        notes: "single block backing",
        exercises: [createExercise(workoutId, "single", 1, 9)],
      },
      {
        id: `${workoutId}_superset_block`,
        orderIndex: 2,
        blockType: "SUPERSET",
        label: "A/B",
        roundCount: null,
        restStrategy: "AFTER_ROUND",
        restSeconds: null,
        notes: "superset block backing",
        exercises: [
          createExercise(workoutId, "a", 1, 8),
          createExercise(workoutId, "b", 2, 8),
        ],
      },
      {
        id: `${workoutId}_cardio_block`,
        orderIndex: 3,
        blockType: "CARDIO",
        label: "Conditioning",
        roundCount: null,
        restStrategy: "NONE",
        restSeconds: null,
        notes: "cardio block backing",
        exercises: [cardioExercise],
      },
      {
        id: `${workoutId}_opaque_block`,
        orderIndex: 4,
        blockType: "GIANT_SET",
        label: "Legacy opaque block",
        roundCount: 3,
        restStrategy: "AFTER_ROUND",
        restSeconds: 120,
        notes: "opaque backing",
        exercises: [],
      },
    ],
  };
}

function createPersistedFixture() {
  return Array.from({ length: 6 }, (_, weekOffset) => ({
    id: `week_${weekOffset + 1}`,
    weekNumber: weekOffset + 1,
    orderIndex: weekOffset + 1,
    label: `Week ${weekOffset + 1}`,
    notes: "persisted week note",
    workouts: Array.from({ length: 6 }, (_, workoutOffset) =>
      createWorkout(weekOffset + 1, workoutOffset + 1)
    ),
  }));
}

function projectThroughProductionBuilder(persistedWeeks) {
  return mapCycleBuilderPayload({
    cycleId: "cycle_1",
    planId: "plan_1",
    status: "DRAFT",
    temporalStatus: "upcoming",
    timezone: "America/Toronto",
    builderPayload: {
      programName: "Large fidelity fixture",
      sessionsPerWeek: 6,
      programLength: 6,
      selectedWeek: 1,
      weeks: persistedWeeks.map((week) => ({
        ...week,
        workouts: week.workouts.map(toCycleBuilderWorkout),
      })),
    },
  }).programDraft;
}

function normalizeMappedWeeks(programDraft) {
  return mapMultiWeekDraftToApi(programDraft).weeks.map((week) => ({
    ...week,
    workouts: week.workouts.map((workout, index) =>
      normalizeWorkoutForPersistence(workout, index + 1, { includeIds: true })
    ),
  }));
}

function countChangedWorkouts(persistedWeeks, incomingWeeks) {
  return persistedWeeks.reduce((count, week, index) => {
    const diff = diffWorkoutList(
      week.workouts,
      incomingWeeks[index].workouts,
      `week ${week.weekNumber}`
    );
    return count + diff.workoutUpdates.filter(
      (entry) => entry.scalarChanged || entry.blockChanged
    ).length;
  }, 0);
}

function getChangedWorkoutIds(persistedWeeks, incomingWeeks) {
  return persistedWeeks.flatMap((week, index) =>
    diffWorkoutList(
      week.workouts,
      incomingWeeks[index].workouts,
      `week ${week.weekNumber}`
    ).workoutUpdates
      .filter((entry) => entry.scalarChanged || entry.blockChanged)
      .map((entry) => entry.existingWorkout.id)
  );
}

function countSets(weeks) {
  return weeks.reduce(
    (weekTotal, week) => weekTotal + week.workouts.reduce(
      (workoutTotal, workout) => workoutTotal + workout.blocks.reduce(
        (blockTotal, block) => blockTotal + block.exercises.reduce(
          (exerciseTotal, exercise) => exerciseTotal + exercise.setTemplates.length,
          0
        ),
        0
      ),
      0
    ),
    0
  );
}

test("real builder projection and mapper preserve a 6-week 900-set fixture", () => {
  const persistedWeeks = createPersistedFixture();
  expect(persistedWeeks).toHaveLength(6);
  expect(persistedWeeks.flatMap((week) => week.workouts)).toHaveLength(36);
  expect(countSets(persistedWeeks)).toBe(900);

  const builderDraft = projectThroughProductionBuilder(persistedWeeks);
  const incomingWeeks = normalizeMappedWeeks(builderDraft);

  expect(countChangedWorkouts(persistedWeeks, incomingWeeks)).toBe(0);
  expect(getChangedWorkoutIds(persistedWeeks, incomingWeeks)).toEqual([]);

  const representativeWorkout = incomingWeeks[0].workouts[0];
  const [single, superset, cardio, opaque] = representativeWorkout.blocks;
  expect(single.exercises[0].setTemplates[0]).toEqual(
    expect.objectContaining({
      id: "week_1_workout_1_single_set_1",
      setType: "TOP_SET",
      targetReps: null,
      minReps: 8,
      maxReps: 12,
      targetRir: null,
      targetRpe: 8.5,
      tempo: null,
      restSeconds: null,
      notes: "single persisted set note",
    })
  );
  expect(single.exercises[0]).toEqual(
    expect.objectContaining({
      id: "week_1_workout_1_single_row",
      defaultTempo: null,
      defaultRestSeconds: null,
      defaultTargetRir: null,
      defaultTargetRpe: 8.5,
      intensificationMethod: "DROP_SET",
    })
  );
  expect(superset.exercises.map((exercise) => exercise.id)).toEqual([
    "week_1_workout_1_a_row",
    "week_1_workout_1_b_row",
  ]);
  expect(cardio.exercises[0].cardioPrescription).toEqual(
    expect.objectContaining({
      vendorExtension: { source: "import" },
      machineSettings: expect.arrayContaining([{ key: "stride", value: "long" }]),
    })
  );
  expect(opaque.blockType).toBe("GIANT_SET");
});

test("a real frontend-style two-set addition changes exactly one of 36 workouts", () => {
  const persistedWeeks = createPersistedFixture();
  const builderDraft = projectThroughProductionBuilder(persistedWeeks);
  const singleSets = builderDraft.weeks[3].workouts[4].blocks[0].sets;

  singleSets.push({ reps: 8, rpe: 2 }, { reps: 8, rpe: 2 });

  const incomingWeeks = normalizeMappedWeeks(builderDraft);
  expect(countChangedWorkouts(persistedWeeks, incomingWeeks)).toBe(1);
  expect(getChangedWorkoutIds(persistedWeeks, incomingWeeks)).toEqual([
    "week_4_workout_5",
  ]);
});
