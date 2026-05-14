import {
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
