import {
  applyEquipmentPreset,
  toggleAvailableEquipment,
} from "../../settings/equipmentPresetUtils";
import {
  validateAboutYou,
  validateFinalStep,
  validateMuscleStep,
  validateSetupStep,
  validateTrainingStep,
} from "../onboardingValidation";

const availabilityOptions = {
  sessionsPerWeek: [1, 2, 3, 4, 5, 6, 7],
  durationPerSession: [15, 30, 45, 60, 75, 90, 105, 120],
};

function createDraft(overrides = {}) {
  return {
    primaryGoal: "HYPERTROPHY",
    experience: "intermediate",
    availability: {
      sessionsPerWeek: 4,
      durationPerSession: 60,
      preferredTrainingDays: ["MONDAY", "TUESDAY", "THURSDAY", "FRIDAY"],
    },
    musclePriorities: {
      primaryFocus: null,
      secondaryFocuses: [],
      deprioritizedArea: null,
    },
    environment: { equipmentPreset: "minimal", availableEquipment: ["bodyweight"] },
    movementConstraints: { painIssues: [], manualBlockedExerciseIds: [] },
    exercisePreference: { equipmentBias: "no_preference" },
    cardioProfile: { cardioRole: null, preferredModalities: [] },
    physicalNotes: "",
    ...overrides,
  };
}

test("validates displayName, canonical demographics, and experience", () => {
  expect(
    validateAboutYou({
      profile: {
        displayName: "Alex",
        age: 30,
        sex: "FEMALE",
        demographicsStatus: "NOT_COLLECTED",
      },
      experience: "beginner",
    }).ok
  ).toBe(true);

  const invalid = validateAboutYou({
    profile: {
      displayName: " ",
      age: 17,
      sex: "",
      demographicsStatus: "NOT_COLLECTED",
    },
    experience: "expert",
  });
  expect(invalid.fieldErrors).toEqual(
    expect.objectContaining({
      displayName: expect.any(String),
      age: expect.any(String),
      sex: expect.any(String),
      experience: expect.any(String),
    })
  );
});

test("locked demographics are accepted without resubmission values", () => {
  expect(
    validateAboutYou({
      profile: {
        displayName: "Alex",
        age: "",
        sex: "",
        demographicsStatus: "LOCKED",
      },
      experience: "advanced",
    }).ok
  ).toBe(true);
});

test("uses only the exact server-provided availability enums", () => {
  expect(validateTrainingStep(createDraft(), availabilityOptions).ok).toBe(true);
  expect(
    validateTrainingStep(
      createDraft({ availability: { sessionsPerWeek: 0, durationPerSession: 50 } }),
      availabilityOptions
    ).fieldErrors
  ).toEqual({
    sessionsPerWeek: expect.any(String),
    durationPerSession: expect.any(String),
  });
});

test("requires exactly one unique preferred day per weekly session", () => {
  const invalid = validateTrainingStep(
    createDraft({
      availability: {
        sessionsPerWeek: 3,
        durationPerSession: 60,
        preferredTrainingDays: ["MONDAY", "MONDAY", "FRIDAY"],
      },
    }),
    availabilityOptions
  );

  expect(invalid.ok).toBe(false);
  expect(invalid.fieldErrors.preferredTrainingDays).toEqual(expect.any(String));
});

test("preserves canonical muscle limits and conflict rules", () => {
  const tooMany = validateMuscleStep(
    createDraft({
      musclePriorities: {
        primaryFocus: "chest",
        secondaryFocuses: ["back", "biceps", "calves"],
        deprioritizedArea: null,
      },
    }),
    availabilityOptions
  );
  expect(tooMany.ok).toBe(false);

  const conflict = validateMuscleStep(
    createDraft({
      musclePriorities: {
        primaryFocus: "chest",
        secondaryFocuses: [],
        deprioritizedArea: "shoulders",
      },
    }),
    availabilityOptions
  );
  expect(conflict.ok).toBe(false);

  const microReduce = validateMuscleStep(
    createDraft({
      musclePriorities: {
        primaryFocus: null,
        secondaryFocuses: [],
        deprioritizedArea: "rear_delts",
      },
    }),
    availabilityOptions
  );
  expect(microReduce.ok).toBe(false);
});

test("preset helpers populate canonical equipment and preserve customization", () => {
  const environment = applyEquipmentPreset(
    { equipmentPreset: null, availableEquipment: ["bodyweight"] },
    "home_gym"
  );
  expect(environment.equipmentPreset).toBe("home_gym");
  expect(environment.availableEquipment).toContain("dumbbells");

  const customized = toggleAvailableEquipment(environment.availableEquipment, "dumbbells");
  expect(customized).not.toContain("dumbbells");
  expect(customized.length).toBeGreaterThan(0);
});

test("requires a canonical equipment preset and bias in onboarding", () => {
  expect(validateSetupStep(createDraft()).ok).toBe(true);
  expect(
    validateSetupStep(
      createDraft({
        environment: { equipmentPreset: null, availableEquipment: ["bodyweight"] },
        exercisePreference: { equipmentBias: "sometimes" },
      })
    ).fieldErrors
  ).toEqual({
    equipmentPreset: expect.any(String),
    equipmentBias: expect.any(String),
  });
});

test("final validation covers notes and unfinished movement issues", () => {
  const invalid = validateFinalStep(
    createDraft({
      physicalNotes: "x".repeat(1001),
      movementConstraints: {
        painIssues: [{ id: "issue_1", description: "Knee pain" }],
        manualBlockedExerciseIds: [],
      },
    }),
    availabilityOptions,
    true
  );

  expect(invalid.fieldErrors.physicalNotes).toEqual(expect.any(String));
  expect(invalid.fieldErrors.movementConstraints).toEqual(expect.any(String));
  expect(invalid.fieldErrors["cardioProfile.cardioRole"]).toEqual(expect.any(String));
});

test("final onboarding validation requires an explicit canonical cardio role", () => {
  expect(validateFinalStep(createDraft(), availabilityOptions, false).ok).toBe(false);
  expect(
    validateFinalStep(
      createDraft({ cardioProfile: { cardioRole: "none", preferredModalities: [] } }),
      availabilityOptions,
      false
    ).ok
  ).toBe(true);
});
