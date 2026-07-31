import "@testing-library/jest-dom";
import { fireEvent, render, screen } from "@testing-library/react";
import { validateTrainingProfileDraft } from "../settingsValidation";
import AvailabilitySection from "../trainingProfileSections/AvailabilitySection";

function createDraft(durationPerSession) {
  return {
    primaryGoal: "HYPERTROPHY",
    experience: "intermediate",
    availability: {
      sessionsPerWeek: 4,
      durationPerSession,
    },
    environment: {
      equipmentPreset: "full_gym",
      availableEquipment: ["bodyweight"],
    },
    musclePriorities: {
      primaryFocus: "chest",
      secondaryFocuses: [],
      deprioritizedArea: null,
    },
    movementConstraints: {
      painIssues: [],
      manualBlockedExerciseIds: [],
    },
    physicalNotes: "",
  };
}

test("Training Profile frontend accepts 120 minutes and rejects 121", () => {
  expect(validateTrainingProfileDraft(createDraft(120)).ok).toBe(true);

  const aboveMaximum = validateTrainingProfileDraft(createDraft(121));
  expect(aboveMaximum.ok).toBe(false);
  expect(
    aboveMaximum.fieldErrors["availability.durationPerSession"]
  ).toBe("Duration per session must be an integer between 15 and 120 minutes.");
});

test("Availability duration control clamps increments at 120", () => {
  const onChange = jest.fn();

  render(
    <AvailabilitySection
      draft={createDraft(120)}
      onChange={onChange}
      fieldErrors={{}}
    />
  );

  fireEvent.click(
    screen.getByRole("button", { name: "Increase Duration per session" })
  );

  expect(onChange).toHaveBeenCalledWith(
    expect.objectContaining({
      availability: expect.objectContaining({
        durationPerSession: "120",
      }),
    })
  );
});
