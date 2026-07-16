import {
  PRIMARY_GOAL_OPTIONS,
  getTrainingProfileHasErrors,
  getTrainingProfileSectionErrorMap,
} from "../settingsOptions";

describe("settingsOptions training profile error mapping", () => {
  test("maps field errors back to the matching subsection", () => {
    const fieldErrors = {
      "availability.sessionsPerWeek": "Required",
      "movementConstraints.blockedExerciseIds": "Invalid",
    };

    expect(getTrainingProfileSectionErrorMap(fieldErrors)).toEqual({
      goals: false,
      experience: false,
      availability: true,
      environment: false,
      movementConstraints: true,
      exercisePreference: false,
      cardioProfile: false,
      physicalNotes: false,
    });
  });

  test("reports whether any training profile subsection has errors", () => {
    expect(getTrainingProfileHasErrors({})).toBe(false);
    expect(getTrainingProfileHasErrors({ physicalNotes: "Too long" })).toBe(true);
  });
});

describe("settingsOptions primary goal availability", () => {
  test("keeps all product goals while locking only the future options", () => {
    expect(PRIMARY_GOAL_OPTIONS.map(({ value, disabled }) => ({ value, disabled }))).toEqual([
      { value: "HYPERTROPHY", disabled: false },
      { value: "STRENGTH", disabled: true },
      { value: "MIXED", disabled: true },
    ]);
    expect(PRIMARY_GOAL_OPTIONS.find(({ value }) => value === "STRENGTH").description).toMatch(
      /future version/i
    );
    expect(PRIMARY_GOAL_OPTIONS.find(({ value }) => value === "MIXED").description).toMatch(
      /future version/i
    );
  });
});
