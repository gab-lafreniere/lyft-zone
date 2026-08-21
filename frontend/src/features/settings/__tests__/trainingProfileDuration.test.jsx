import "@testing-library/jest-dom";
import { fireEvent, render, screen } from "@testing-library/react";
import { validateTrainingProfileDraft } from "../settingsValidation";
import AvailabilitySection from "../trainingProfileSections/AvailabilitySection";

const AVAILABILITY_OPTIONS = {
  sessionsPerWeek: [1, 2, 3, 4, 5, 6, 7],
  durationPerSession: [15, 30, 45, 60, 75, 90, 105, 120],
};

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
  expect(
    validateTrainingProfileDraft(createDraft(120), AVAILABILITY_OPTIONS).ok
  ).toBe(true);

  const aboveMaximum = validateTrainingProfileDraft(
    createDraft(121),
    AVAILABILITY_OPTIONS
  );
  expect(aboveMaximum.ok).toBe(false);
  expect(
    aboveMaximum.fieldErrors["availability.durationPerSession"]
  ).toBe("Select an available session duration.");
});

test("Availability duration control clamps increments at 120", () => {
  const onChange = jest.fn();

  render(
    <AvailabilitySection
      draft={createDraft(120)}
      onChange={onChange}
      fieldErrors={{}}
      options={AVAILABILITY_OPTIONS}
    />
  );

  fireEvent.click(
    screen.getByRole("button", { name: "Increase Duration per session" })
  );

  expect(onChange).not.toHaveBeenCalled();
});

test("Availability edits preferred days for future cycles and keeps exact-count validation", () => {
  const onChange = jest.fn();
  const draft = createDraft(60);
  draft.availability.preferredTrainingDays = [
    "MONDAY",
    "TUESDAY",
    "THURSDAY",
    "FRIDAY",
  ];

  render(
    <AvailabilitySection
      draft={draft}
      onChange={onChange}
      fieldErrors={{}}
      options={AVAILABILITY_OPTIONS}
    />
  );

  expect(screen.getByText(/future cycles only/i)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Friday" }));
  expect(onChange).toHaveBeenCalledWith(
    expect.objectContaining({
      availability: expect.objectContaining({
        preferredTrainingDays: ["MONDAY", "TUESDAY", "THURSDAY"],
      }),
    })
  );

  const invalidDraft = createDraft(60);
  invalidDraft.availability.preferredTrainingDays = ["MONDAY"];
  expect(
    validateTrainingProfileDraft(invalidDraft, AVAILABILITY_OPTIONS)
      .fieldErrors["availability.preferredTrainingDays"]
  ).toEqual(expect.any(String));
});
