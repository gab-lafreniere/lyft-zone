import {
  mapCycleBuilderPayload,
  mapMultiWeekDraftToApi,
} from "../multiWeek/mappers";
import { mapProgramDraftToWeeklyPlanUpdate } from "../weeklyPlans/mappers";

function createSet(id, overrides = {}) {
  const persistence = {
    id,
    setIndex: 1,
    setType: "TOP_SET",
    targetReps: null,
    minReps: 8,
    maxReps: 12,
    targetSeconds: 45,
    targetRir: null,
    targetRpe: 8.5,
    tempo: null,
    restSeconds: null,
    notes: "persisted set note",
    ...overrides,
  };

  return {
    id,
    reps: persistence.targetReps ?? persistence.maxReps ?? persistence.minReps,
    rpe: persistence.targetRir ?? 2,
    persistence,
  };
}

test("published ManualConvert response cannot claim editable Cycle identity", () => {
  const mapped = mapCycleBuilderPayload({
    cycleId: "cycle_new",
    planId: "published_plan",
    publishedPlanId: "published_plan",
    status: "PUBLISHED",
    builderPayload: { weeks: [] },
  });

  expect(mapped.programDraft.planId).toBe("published_plan");
  expect(mapped.metadata.status).toBe("published");
  expect(mapped.metadata.planId).toBeNull();
  expect(mapped.metadata.cyclePlanId).toBeNull();
});

function createExercise(id, setTemplates, overrides = {}) {
  return {
    id,
    label: "A1",
    name: "Incline Press",
    exerciseId: "ex_incline_press",
    bodyParts: ["chest"],
    muscleFocus: ["upper_chest"],
    tempo: "3010",
    sets: setTemplates,
    notes: "visible exercise note",
    persistence: {
      id,
      exerciseId: "ex_incline_press",
      exerciseName: "Incline Press",
      bodyParts: ["chest"],
      muscleFocus: ["upper_chest"],
      orderIndex: 1,
      executionNotes: "persisted execution note",
      defaultTempo: null,
      defaultRestSeconds: null,
      defaultTargetRir: null,
      defaultTargetRpe: 8.5,
      intensificationMethod: "DROP_SET",
      cardioPrescription: null,
      notes: "persisted exercise note",
      ...overrides,
    },
  };
}

function createBuilderBlocks() {
  const singleSet = createSet("single_set");
  const singleExercise = createExercise("single_exercise", [singleSet]);
  const supersetSetA = createSet("superset_set_a", {
    setType: "BACKOFF",
    targetSeconds: null,
    targetRpe: 9,
  });
  const supersetSetB = createSet("superset_set_b", {
    setType: "AMRAP",
    targetReps: 15,
    minReps: 15,
    maxReps: 15,
    targetSeconds: null,
    targetRir: 1,
    targetRpe: null,
    tempo: "2010",
    restSeconds: 75,
    notes: "second lane note",
  });
  const supersetExerciseA = createExercise("superset_exercise_a", [supersetSetA]);
  const supersetExerciseB = createExercise("superset_exercise_b", [supersetSetB], {
    exerciseId: "ex_row",
    exerciseName: "Cable Row",
    bodyParts: ["back"],
    muscleFocus: ["lats"],
    defaultTempo: "2010",
    defaultRestSeconds: 75,
    defaultTargetRir: 1,
    defaultTargetRpe: null,
    intensificationMethod: "NONE",
    notes: "row note",
  });
  Object.assign(supersetExerciseB, {
    name: "Cable Row",
    exerciseId: "ex_row",
    bodyParts: ["back"],
    muscleFocus: ["lats"],
    tempo: "2010",
    notes: "row note",
  });

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
  const cardioExercisePersistence = {
    id: "cardio_exercise",
    exerciseId: "ex_treadmill",
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
    notes: "cardio row note",
  };

  const opaqueBlock = {
    id: "giant_block",
    orderIndex: 4,
    blockType: "GIANT_SET",
    label: "Legacy giant set",
    roundCount: 3,
    restStrategy: "AFTER_ROUND",
    restSeconds: 120,
    notes: "opaque",
    exercises: [
      {
        ...createExercise("giant_exercise", [createSet("giant_set")]).persistence,
        setTemplates: [createSet("giant_set").persistence],
      },
    ],
  };

  return [
    {
      id: "single_block",
      type: "single",
      exerciseRowId: singleExercise.id,
      exercise: singleExercise.name,
      exerciseId: singleExercise.exerciseId,
      bodyParts: singleExercise.bodyParts,
      muscleFocus: singleExercise.muscleFocus,
      tempo: "3010",
      rest: "120s",
      sets: singleExercise.sets,
      notes: "visible block note",
      exercisePersistence: singleExercise.persistence,
      persistence: {
        id: "single_block",
        orderIndex: 1,
        blockType: "SINGLE",
        label: "Primary",
        roundCount: null,
        restStrategy: "AFTER_EXERCISE",
        restSeconds: null,
        notes: "persisted block note",
      },
    },
    {
      id: "superset_block",
      type: "superset",
      sets: 1,
      rest: "120s",
      notes: "persisted superset note",
      exercises: [supersetExerciseA, supersetExerciseB],
      persistence: {
        id: "superset_block",
        orderIndex: 2,
        blockType: "SUPERSET",
        label: "A/B",
        roundCount: null,
        restStrategy: "AFTER_ROUND",
        restSeconds: null,
        notes: "persisted superset note",
      },
    },
    {
      id: "cardio_block",
      type: "cardio",
      exerciseRowId: "cardio_exercise",
      exerciseId: "ex_treadmill",
      exercise: { exerciseId: "ex_treadmill", name: "Treadmill" },
      cardioPrescription,
      notes: "cardio block note",
      exercisePersistence: cardioExercisePersistence,
      persistence: {
        id: "cardio_block",
        orderIndex: 3,
        blockType: "CARDIO",
        label: "Conditioning",
        roundCount: null,
        restStrategy: "NONE",
        restSeconds: null,
        notes: "cardio block note",
      },
    },
    {
      id: "giant_block",
      type: "unsupported",
      persistence: { opaqueBlock },
    },
  ];
}

function createProgramDraft(kind) {
  const workout = {
    id: "workout_1",
    name: "Push and conditioning",
    orderIndex: 1,
    blocks: createBuilderBlocks(),
    persistence: {
      id: "workout_1",
      name: "Push and conditioning",
      orderIndex: 1,
      scheduledDay: kind === "cycle" ? "MONDAY" : undefined,
      estimatedDurationMinutes: 67,
      notes: "persisted workout note",
    },
  };

  if (kind === "cycle") {
    return {
      programName: "Fidelity Cycle",
      weeks: [
        {
          id: "week_1",
          weekNumber: 1,
          orderIndex: 1,
          label: "Week 1",
          notes: "week note",
          workouts: [workout],
        },
      ],
    };
  }

  return {
    programName: "Fidelity Weekly Plan",
    sessionsPerWeek: 1,
    workouts: [workout],
  };
}

function getWorkoutDocument(kind, draft) {
  const document =
    kind === "cycle"
      ? mapMultiWeekDraftToApi(draft)
      : mapProgramDraftToWeeklyPlanUpdate(draft);
  return {
    document,
    workout: kind === "cycle" ? document.weeks[0].workouts[0] : document.workouts[0],
  };
}

describe.each(["cycle", "weekly"])("%s draft mapper fidelity", (kind) => {
  test("preserves persisted backing data on a zero-edit save", () => {
    const { workout } = getWorkoutDocument(kind, createProgramDraft(kind));
    const [single, superset, cardio, opaque] = workout.blocks;

    expect(workout.estimatedDurationMinutes).toBe(67);
    expect(workout.notes).toBe("persisted workout note");

    expect(single.label).toBe("Primary");
    expect(single.restSeconds).toBeNull();
    expect(single.exercises[0].id).toBe("single_exercise");
    expect(single.exercises[0].defaultTargetRir).toBeNull();
    expect(single.exercises[0].defaultTargetRpe).toBe(8.5);
    expect(single.exercises[0].intensificationMethod).toBe("DROP_SET");
    expect(single.exercises[0].setTemplates[0]).toEqual(
      expect.objectContaining({
        id: "single_set",
        setType: "TOP_SET",
        targetReps: null,
        minReps: 8,
        maxReps: 12,
        targetSeconds: 45,
        targetRir: null,
        targetRpe: 8.5,
        tempo: null,
        restSeconds: null,
        notes: "persisted set note",
      })
    );

    expect(superset.roundCount).toBeNull();
    expect(superset.exercises.map((exercise) => exercise.id)).toEqual([
      "superset_exercise_a",
      "superset_exercise_b",
    ]);
    expect(superset.exercises[1].setTemplates[0].id).toBe("superset_set_b");
    expect(superset.exercises[1].setTemplates[0].setType).toBe("AMRAP");

    expect(cardio.exercises[0].id).toBe("cardio_exercise");
    expect(cardio.exercises[0].cardioPrescription).toEqual(
      expect.objectContaining({
        vendorExtension: { source: "import" },
        machineSettings: expect.arrayContaining([
          { key: "stride", value: "long" },
        ]),
      })
    );

    expect(opaque).toEqual(
      createBuilderBlocks()[3].persistence.opaqueBlock
    );
  });

  test("canonicalizes a rep range only after an explicit reps edit", () => {
    const untouchedDraft = createProgramDraft(kind);
    const untouched = getWorkoutDocument(kind, untouchedDraft).workout.blocks[0]
      .exercises[0].setTemplates[0];
    expect(untouched).toEqual(
      expect.objectContaining({ targetReps: null, minReps: 8, maxReps: 12 })
    );

    const editedDraft = createProgramDraft(kind);
    const editedSet = editedDraft[
      kind === "cycle" ? "weeks" : "workouts"
    ];
    const set =
      kind === "cycle"
        ? editedSet[0].workouts[0].blocks[0].sets[0]
        : editedSet[0].blocks[0].sets[0];
    set.reps = 9;
    set.editIntent = { reps: true };

    const edited = getWorkoutDocument(kind, editedDraft).workout.blocks[0]
      .exercises[0].setTemplates[0];
    expect(edited).toEqual(
      expect.objectContaining({ targetReps: 9, minReps: 9, maxReps: 9 })
    );
    expect(edited.targetRpe).toBe(8.5);
    expect(edited.setType).toBe("TOP_SET");
    expect(edited.notes).toBe("persisted set note");
  });
});
