import "@testing-library/jest-dom";
import { fireEvent, render, screen } from "@testing-library/react";
import { DesignV2Scope } from "../../../design-v2";
import OnboardingProgramResult from "../OnboardingProgramResult";

const weeklyPlan = {
  name: "Chest-Focused Hypertrophy",
  metrics: {
    strengthSets: 54,
    totalExercises: 18,
    averageDurationMinutes: 42,
    averageTUTMinutes: 32,
    weeklyMuscleDistribution: [
      { key: "chest", label: "Chest", rawSets: 14, percentage: 80 },
      { key: "back", label: "Back", rawSets: 12, percentage: 68 },
      { key: "biceps", label: "Biceps", rawSets: 8, percentage: 46 },
      { key: "calves", label: "Calves", rawSets: 0, percentage: 0 },
    ],
  },
  presentation: {
    summary: "Built around four focused home-gym sessions.",
    progression: "Add load when every set reaches the top of its rep range.",
    coachingNotes: ["Keep technique consistent."],
  },
};

const profile = {
  primaryGoal: "HYPERTROPHY",
  availability: { durationPerSession: 45 },
  musclePriorities: {
    primaryFocus: "chest",
    secondaryFocuses: ["biceps"],
  },
};

const cycle = {
  cycleId: "cycle_1",
  durationWeeks: 6,
  builderPayload: {
    weeks: [
      {
        workouts: [
          { id: "w2", orderIndex: 2, scheduledDay: "THURSDAY", name: "Lower Power" },
          { id: "w1", orderIndex: 1, scheduledDay: "MONDAY", name: "Upper Power" },
        ],
      },
    ],
  },
};

test("renders real weekly metrics, split, insights, and result actions", () => {
  const onModify = jest.fn();
  const onDetails = jest.fn();
  render(
    <DesignV2Scope>
      <OnboardingProgramResult
        weeklyPlan={weeklyPlan}
        cycle={cycle}
        profile={profile}
        onModify={onModify}
        onDetails={onDetails}
      />
    </DesignV2Scope>
  );

  expect(screen.getByText("Program Generated")).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: weeklyPlan.name })).toBeInTheDocument();
  expect(screen.getByText("54")).toBeInTheDocument();
  expect(screen.getByText("Total Sets")).toBeInTheDocument();
  expect(screen.getByText("Avg. Workout")).toBeInTheDocument();
  expect(screen.getByText("Avg. TUT")).toBeInTheDocument();
  expect(screen.getByText("42m")).toBeInTheDocument();
  expect(screen.getByText("32m")).toBeInTheDocument();
  expect(screen.getByText("14 sets")).toBeInTheDocument();
  expect(screen.getByText("Chest").closest(".lz-onboarding-result-muscle"))
    .toHaveTextContent("14 sets");
  expect(screen.getByText("Chest").closest(".lz-onboarding-result-muscle")
    .querySelector(".lz-onboarding-result-muscle__fill--info"))
    .toBeInTheDocument();
  expect(screen.getByText("Biceps").closest(".lz-onboarding-result-muscle")
    .querySelector(".lz-onboarding-result-muscle__fill--info"))
    .toBeInTheDocument();
  expect(screen.getByText("Back").closest(".lz-onboarding-result-muscle")
    .querySelector(".lz-onboarding-result-muscle__fill--info"))
    .not.toBeInTheDocument();
  expect(screen.queryByText("Calves")).not.toBeInTheDocument();
  const splitRows = screen.getAllByRole("listitem");
  expect(splitRows[0]).toHaveTextContent("Upper Power");
  expect(screen.getByRole("heading", { name: "Coach's Insight" })).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "Modify" }));
  fireEvent.click(screen.getByRole("button", { name: "Details" }));
  expect(onModify).toHaveBeenCalledTimes(1);
  expect(onDetails).toHaveBeenCalledTimes(1);
});

test("renders the canonical persisted presentation title without client synthesis", () => {
  const verbosePlan = {
    ...weeklyPlan,
    name: "2-day hypertrophy split built around chest priority, with biceps as the secondary emphasis",
    presentation: {
      ...weeklyPlan.presentation,
      title: "Chest Priority Hypertrophy",
    },
  };
  const originalName = verbosePlan.name;

  render(
    <DesignV2Scope>
      <OnboardingProgramResult
        weeklyPlan={verbosePlan}
        cycle={cycle}
        profile={profile}
        onModify={() => {}}
        onDetails={() => {}}
      />
    </DesignV2Scope>
  );

  expect(screen.getByRole("heading", {
    name: "Chest Priority Hypertrophy",
  })).toBeInTheDocument();
  expect(screen.queryByText(originalName)).not.toBeInTheDocument();
  expect(verbosePlan.name).toBe(originalName);
});

test("maps micro priorities to displayed parent muscle rows", () => {
  render(
    <DesignV2Scope>
      <OnboardingProgramResult
        weeklyPlan={weeklyPlan}
        cycle={cycle}
        profile={{
          ...profile,
          musclePriorities: {
            primaryFocus: "upper_chest",
            secondaryFocuses: ["biceps_long_head"],
          },
        }}
        onModify={() => {}}
        onDetails={() => {}}
      />
    </DesignV2Scope>
  );

  for (const label of ["Chest", "Biceps"]) {
    expect(screen.getByText(label).closest(".lz-onboarding-result-muscle")
      .querySelector(".lz-onboarding-result-muscle__fill--info"))
      .toBeInTheDocument();
  }
});

test("uses backend per-workout averages instead of requested onboarding duration", () => {
  render(
    <DesignV2Scope>
      <OnboardingProgramResult
        weeklyPlan={{
          ...weeklyPlan,
          metrics: {
            ...weeklyPlan.metrics,
            averageDurationMinutes: 77,
            averageTUTMinutes: 21,
          },
        }}
        cycle={cycle}
        profile={profile}
        onModify={() => {}}
        onDetails={() => {}}
      />
    </DesignV2Scope>
  );

  expect(screen.getByText("77m")).toBeInTheDocument();
  expect(screen.getByText("21m")).toBeInTheDocument();
  expect(screen.queryByText("45m")).not.toBeInTheDocument();
});

test("omits unavailable optional result sections instead of inventing values", () => {
  render(
    <DesignV2Scope>
      <OnboardingProgramResult
        weeklyPlan={{ name: "Valid Minimal Plan", metrics: {}, presentation: {} }}
        cycle={{ cycleId: "cycle_2", durationWeeks: 6 }}
        onModify={() => {}}
        onDetails={() => {}}
      />
    </DesignV2Scope>
  );

  expect(screen.queryByText("Weekly Volume Overview")).not.toBeInTheDocument();
  expect(screen.queryByText("Muscle Volume Distribution")).not.toBeInTheDocument();
  expect(screen.queryByText("Your Training Split")).not.toBeInTheDocument();
  expect(screen.queryByText("Coach's Insight")).not.toBeInTheDocument();
});
