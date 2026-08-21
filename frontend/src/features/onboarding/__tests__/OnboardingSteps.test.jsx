import { useState } from "react";
import "@testing-library/jest-dom";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DesignV2Scope } from "../../../design-v2";
import { getMuscleMacroRegions } from "../muscleRegionMapping";
import AboutYouStep from "../steps/AboutYouStep";
import AdditionalContextStep from "../steps/AdditionalContextStep";
import MuscleFocusStep from "../steps/MuscleFocusStep";
import ProfileSummaryPanel from "../ProfileSummaryPanel";
import TrainingSetupStep from "../steps/TrainingSetupStep";
import TrainingStep from "../steps/TrainingStep";
import { buildProfileSummaryItems } from "../profileSummary";

const availabilityOptions = {
  sessionsPerWeek: [1, 2, 3, 4, 5, 6, 7],
  durationPerSession: [15, 30, 45, 60, 75, 90, 105, 120],
};

function createDraft(overrides = {}) {
  return {
    primaryGoal: "HYPERTROPHY",
    experience: "intermediate",
    availability: { sessionsPerWeek: 4, durationPerSession: 60 },
    musclePriorities: {
      primaryFocus: null,
      secondaryFocuses: [],
      deprioritizedArea: null,
    },
    environment: { equipmentPreset: null, availableEquipment: ["bodyweight"] },
    movementConstraints: { painIssues: [], manualBlockedExerciseIds: [] },
    exercisePreference: { equipmentBias: "no_preference" },
    cardioProfile: { cardioRole: null, preferredModalities: [] },
    physicalNotes: "",
    ...overrides,
  };
}

function AboutHarness({ locked = false, initialExperience = null }) {
  const [profile, setProfile] = useState({
    displayName: "Alex",
    age: 30,
    sex: "FEMALE",
    demographicsStatus: locked ? "LOCKED" : "NOT_COLLECTED",
  });
  const [experience, setExperience] = useState(initialExperience);

  return (
    <DesignV2Scope>
      <AboutYouStep
        profile={profile}
        experience={experience}
        onProfileChange={setProfile}
        onExperienceChange={setExperience}
      />
      <output data-testid="about-state">{JSON.stringify({ profile, experience })}</output>
    </DesignV2Scope>
  );
}

test("Step 1 sentence controls update the canonical profile and experience values", () => {
  render(<AboutHarness />);

  const experienceControl = screen.getByRole("combobox", {
    name: "Training experience",
  });
  const ageControl = screen.getByRole("spinbutton", { name: "Age" });
  expect(experienceControl).toHaveAttribute("aria-expanded", "false");
  expect(experienceControl).not.toHaveTextContent(/experience|select|choose/i);
  expect(screen.queryByRole("option")).not.toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "About you" }).previousElementSibling).toHaveTextContent(
    "person"
  );
  expect(ageControl).toHaveAttribute("inputmode", "numeric");
  expect(ageControl).toHaveAttribute("pattern", "[0-9]*");
  expect(screen.queryByText("Age and sex can't be changed later.")).not.toBeInTheDocument();

  fireEvent.change(screen.getByRole("textbox", { name: "Name" }), {
    target: { value: "Taylor" },
  });
  fireEvent.change(ageControl, {
    target: { value: "34" },
  });
  fireEvent.click(experienceControl);
  fireEvent.click(screen.getByRole("option", { name: "Advanced" }));
  fireEvent.click(screen.getByRole("radio", { name: "Male" }));

  const state = JSON.parse(screen.getByTestId("about-state").textContent);
  expect(state.profile).toMatchObject({ displayName: "Taylor", age: "34", sex: "MALE" });
  expect(state.experience).toBe("advanced");
  expect(screen.queryByText("Step 1 of 5")).not.toBeInTheDocument();
});

test("Step 1 custom experience menu supports keyboard selection from a blank state", () => {
  render(<AboutHarness />);

  const experienceControl = screen.getByRole("combobox", {
    name: "Training experience",
  });
  experienceControl.focus();
  userEvent.keyboard("{arrowdown}{arrowdown}{enter}");

  expect(JSON.parse(screen.getByTestId("about-state").textContent).experience).toBe(
    "intermediate"
  );
  expect(experienceControl).toHaveTextContent("Intermediate");
  expect(experienceControl).toHaveAttribute("aria-expanded", "false");
});

test("Step 1 keeps locked demographics immutable while name and experience remain editable", () => {
  render(<AboutHarness locked initialExperience="intermediate" />);

  expect(screen.getByRole("spinbutton", { name: "Age" })).toBeDisabled();
  expect(screen.getByRole("spinbutton", { name: "Age" })).toHaveClass(
    "lz-onboarding-inline-control--entered"
  );
  expect(screen.getByRole("radio", { name: "Male" })).toBeDisabled();
  expect(screen.getByRole("radio", { name: "Female" })).toBeDisabled();
  expect(screen.queryByText("Age and sex can't be changed later.")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("combobox", { name: "Training experience" }));
  fireEvent.click(screen.getByRole("option", { name: "Beginner" }));
  expect(JSON.parse(screen.getByTestId("about-state").textContent).experience).toBe("beginner");
});

function TrainingHarness() {
  const [draft, setDraft] = useState(createDraft());
  return (
    <DesignV2Scope>
      <TrainingStep draft={draft} availabilityOptions={availabilityOptions} onChange={setDraft} />
      <output data-testid="training-state">{JSON.stringify(draft)}</output>
    </DesignV2Scope>
  );
}

test("Step 2 keeps the exact stepper values and behavior", () => {
  render(<TrainingHarness />);
  fireEvent.click(screen.getByRole("button", { name: "Increase training days" }));
  fireEvent.click(screen.getByRole("button", { name: "Increase session duration" }));

  const draft = JSON.parse(screen.getByTestId("training-state").textContent);
  expect(draft.availability).toEqual({
    sessionsPerWeek: 5,
    durationPerSession: 75,
    preferredTrainingDays: ["MONDAY", "TUESDAY", "THURSDAY", "FRIDAY", "SATURDAY"],
  });
  expect(screen.getByText("Goal · Muscle Growth & Hypertrophy")).toBeInTheDocument();
});

test("Step 2 allows preferred-day customization and hides the control at seven sessions", () => {
  render(<TrainingHarness />);

  expect(screen.getByRole("button", { name: "Monday" })).toHaveAttribute("aria-pressed", "true");
  fireEvent.click(screen.getByRole("button", { name: "Friday" }));
  fireEvent.click(screen.getByRole("button", { name: "Sunday" }));

  let draft = JSON.parse(screen.getByTestId("training-state").textContent);
  expect(draft.availability.preferredTrainingDays).toEqual([
    "MONDAY",
    "TUESDAY",
    "THURSDAY",
    "SUNDAY",
  ]);

  fireEvent.click(screen.getByRole("button", { name: "Increase training days" }));
  fireEvent.click(screen.getByRole("button", { name: "Increase training days" }));
  fireEvent.click(screen.getByRole("button", { name: "Increase training days" }));
  expect(screen.queryByLabelText("Preferred training days")).not.toBeInTheDocument();
  draft = JSON.parse(screen.getByTestId("training-state").textContent);
  expect(draft.availability.preferredTrainingDays).toHaveLength(7);
});

function AdditionalContextHarness() {
  const [draft, setDraft] = useState(createDraft({
    environment: { equipmentPreset: "minimal", availableEquipment: ["bodyweight"] },
  }));
  const [hasMovementLimitations, setHasMovementLimitations] = useState(false);

  return (
    <DesignV2Scope>
      <AdditionalContextStep
        draft={draft}
        onChange={setDraft}
        hasMovementLimitations={hasMovementLimitations}
        onMovementLimitationsChange={setHasMovementLimitations}
      />
      <ProfileSummaryPanel items={buildProfileSummaryItems(draft)} />
      <output data-testid="draft-state">{JSON.stringify(draft)}</output>
    </DesignV2Scope>
  );
}

test("Step 5 progressively exposes the existing Movement Constraints workflow", () => {
  render(<AdditionalContextHarness />);

  expect(screen.queryByText("Your limitations")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("radio", { name: "Yes" }));
  expect(screen.getByText("Your limitations")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /Add a limitation/i })).toBeInTheDocument();
  expect(screen.queryByText("Advanced signals")).not.toBeInTheDocument();
});

test("Step 5 maps compact cardio choices, optional modalities, and notes", () => {
  render(<AdditionalContextHarness />);

  expect(screen.queryByRole("button", { name: "Stationary Bike" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("radio", { name: "Cardio sessions" }));
  fireEvent.click(screen.getByRole("button", { name: "Stationary Bike" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Anything else?" }), {
    target: { value: "Avoid early morning sessions." },
  });

  const draft = JSON.parse(screen.getByTestId("draft-state").textContent);
  expect(draft.cardioProfile).toEqual({
    cardioRole: "cardio_sessions",
    preferredModalities: ["stationary_bike"],
  });
  expect(draft.physicalNotes).toBe("Avoid early morning sessions.");
});

test("Step 5 starts with no cardio selection and maps every explicit choice canonically", () => {
  render(<AdditionalContextHarness />);

  expect(JSON.parse(screen.getByTestId("draft-state").textContent).cardioProfile.cardioRole)
    .toBeNull();
  expect(screen.getByText("Choose one option to generate your program.")).toBeInTheDocument();
  expect(screen.getAllByRole("radio", { name: /None|Warm-up|Cardio sessions|Both/ }))
    .toHaveLength(4);

  [
    ["None", "none"],
    ["Warm-up", "warm_up_only"],
    ["Cardio sessions", "cardio_sessions"],
    ["Both", "warm_up_and_cardio"],
  ].forEach(([label, value]) => {
    fireEvent.click(screen.getByRole("radio", { name: label }));
    expect(JSON.parse(screen.getByTestId("draft-state").textContent).cardioProfile.cardioRole)
      .toBe(value);
  });
});

test("Step 5 sticky summary expands explicitly and reflects canonical choices", () => {
  render(<AdditionalContextHarness />);

  const toggle = screen.getByRole("button", { name: "Expand profile summary" });
  expect(toggle).toHaveAttribute("aria-expanded", "false");
  expect(toggle).toHaveTextContent(
    "Intermediate · 4 days/week · 60 min/session · Minimal"
  );
  expect(screen.queryByRole("region", { name: "Full profile summary" })).not.toBeInTheDocument();

  fireEvent.click(toggle);
  const summary = screen.getByRole("region", { name: "Full profile summary" });
  expect(screen.getByRole("button", { name: "Collapse profile summary" })).toHaveAttribute(
    "aria-expanded",
    "true"
  );
  expect(within(summary).getByText("Intermediate")).toBeInTheDocument();
  expect(within(summary).getByText("4 days/week")).toBeInTheDocument();
  expect(within(summary).getByText("60 min/session")).toBeInTheDocument();
  expect(within(summary).queryByText(/main|secondary|reduced/i)).not.toBeInTheDocument();
  expect(within(summary).queryByText("No cardio")).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "Collapse profile summary" }));
  expect(screen.getByRole("button", { name: "Expand profile summary" })).toHaveAttribute(
    "aria-expanded",
    "false"
  );
  fireEvent.click(screen.getByRole("radio", { name: "None" }));
  expect(screen.queryByText("No cardio")).not.toBeInTheDocument();
});

function MuscleHarness() {
  const [draft, setDraft] = useState(createDraft());
  return (
    <DesignV2Scope>
      <MuscleFocusStep
        draft={draft}
        availabilityOptions={availabilityOptions}
        onChange={setDraft}
      />
      <output data-testid="muscle-state">{JSON.stringify(draft)}</output>
    </DesignV2Scope>
  );
}

test("Step 3 caps secondary macro defaults at two", () => {
  render(<MuscleHarness />);

  fireEvent.click(screen.getByRole("button", { name: "Secondary: 0/2" }));
  fireEvent.click(screen.getByRole("button", { name: "Select and open Chest options" }));
  fireEvent.click(screen.getByRole("button", { name: "Select and open Back options" }));
  fireEvent.click(screen.getByRole("button", { name: "Select and open Biceps options" }));

  expect(screen.getByRole("alert")).toHaveTextContent("up to two");
  const draft = JSON.parse(screen.getByTestId("muscle-state").textContent);
  expect(draft.musclePriorities.secondaryFocuses).toEqual(["chest", "back"]);
});

test("Step 3 single-option macros select and deselect immediately", () => {
  render(<MuscleHarness />);

  fireEvent.click(screen.getByRole("button", { name: "Reduce: 0/1" }));
  const selectChest = screen.getByRole("button", { name: "Select Chest as Reduce" });
  expect(selectChest).not.toHaveAttribute("aria-expanded");
  fireEvent.click(selectChest);

  expect(JSON.parse(screen.getByTestId("muscle-state").textContent).musclePriorities)
    .toMatchObject({ deprioritizedArea: "chest" });
  expect(screen.queryByRole("region", { name: "Chest" })).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: /Deselect Chest as Reduce/ }));
  expect(JSON.parse(screen.getByTestId("muscle-state").textContent).musclePriorities)
    .toMatchObject({ deprioritizedArea: null });
});

test("Step 3 selects the canonical whole area and visibly opens optional refinements", () => {
  render(<MuscleHarness />);

  const chestCard = screen.getByRole("button", { name: "Select and open Chest options" });
  fireEvent.click(chestCard);

  const openChestCard = screen.getByRole("button", { name: /Close Chest options/ });
  const optionsPanel = screen.getByRole("region", { name: "Chest" });
  expect(openChestCard).toHaveAttribute("aria-expanded", "true");
  expect(openChestCard).toHaveClass("lz-onboarding-muscle-card--open");
  expect(openChestCard.nextElementSibling).toBe(optionsPanel);
  expect(JSON.parse(screen.getByTestId("muscle-state").textContent).musclePriorities)
    .toMatchObject({ primaryFocus: "chest" });
  expect(within(optionsPanel).getByRole("button", { name: "All Chest Main" }))
    .toHaveAttribute("aria-pressed", "true");
  expect(within(optionsPanel).getByText(/Chest is selected as main/i)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Select and open Back options" }))
    .toBeInTheDocument();

  fireEvent.click(within(optionsPanel).getByRole("button", { name: "Upper Chest" }));
  expect(JSON.parse(screen.getByTestId("muscle-state").textContent).musclePriorities)
    .toMatchObject({ primaryFocus: "upper_chest" });
});

test("Step 3 closing an open macro does not restore a deselected whole area", () => {
  render(<MuscleHarness />);

  fireEvent.click(screen.getByRole("button", { name: "Select and open Chest options" }));
  const optionsPanel = screen.getByRole("region", { name: "Chest" });
  fireEvent.click(within(optionsPanel).getByRole("button", { name: "All Chest Main" }));

  expect(JSON.parse(screen.getByTestId("muscle-state").textContent).musclePriorities)
    .toMatchObject({ primaryFocus: null });

  fireEvent.click(screen.getByRole("button", { name: "Close Chest options" }));

  expect(screen.queryByRole("region", { name: "Chest" })).not.toBeInTheDocument();
  expect(JSON.parse(screen.getByTestId("muscle-state").textContent).musclePriorities)
    .toMatchObject({ primaryFocus: null });
});

test("Step 3 preserves Lats when Back is closed and reopened", () => {
  render(<MuscleHarness />);

  fireEvent.click(screen.getByRole("button", { name: "Select and open Back options" }));
  fireEvent.click(
    within(screen.getByRole("region", { name: "Back" })).getByRole("button", {
      name: "Lats",
    })
  );
  fireEvent.click(screen.getByRole("button", { name: /Close Back options/ }));
  fireEvent.click(screen.getByRole("button", { name: /Open Back options/ }));

  const reopenedPanel = screen.getByRole("region", { name: "Back" });
  expect(JSON.parse(screen.getByTestId("muscle-state").textContent).musclePriorities)
    .toMatchObject({ primaryFocus: "lats" });
  expect(within(reopenedPanel).getByRole("button", { name: "Lats Main" }))
    .toHaveAttribute("aria-pressed", "true");
});

test("Step 3 preserves Side Delts when Shoulders is closed and reopened", () => {
  render(<MuscleHarness />);

  fireEvent.click(
    screen.getByRole("button", { name: "Select and open Shoulders options" })
  );
  fireEvent.click(
    within(screen.getByRole("region", { name: "Shoulders" })).getByRole("button", {
      name: "Side Delts",
    })
  );
  fireEvent.click(screen.getByRole("button", { name: /Close Shoulders options/ }));
  fireEvent.click(screen.getByRole("button", { name: /Open Shoulders options/ }));

  const reopenedPanel = screen.getByRole("region", { name: "Shoulders" });
  expect(JSON.parse(screen.getByTestId("muscle-state").textContent).musclePriorities)
    .toMatchObject({ primaryFocus: "side_delts" });
  expect(within(reopenedPanel).getByRole("button", { name: "Side Delts Main" }))
    .toHaveAttribute("aria-pressed", "true");
});

test("Step 3 reopening a macro does not change muscle priorities", () => {
  render(<MuscleHarness />);

  fireEvent.click(screen.getByRole("button", { name: "Secondary: 0/2" }));
  fireEvent.click(screen.getByRole("button", { name: "Select and open Back options" }));
  fireEvent.click(
    within(screen.getByRole("region", { name: "Back" })).getByRole("button", {
      name: "Upper Back",
    })
  );
  fireEvent.click(screen.getByRole("button", { name: /Close Back options/ }));
  const beforeReopen = JSON.parse(
    screen.getByTestId("muscle-state").textContent
  ).musclePriorities;

  fireEvent.click(screen.getByRole("button", { name: /Open Back options/ }));

  expect(JSON.parse(screen.getByTestId("muscle-state").textContent).musclePriorities)
    .toEqual(beforeReopen);
});

test("Step 3 explicitly selecting All X replaces a child assignment", () => {
  render(<MuscleHarness />);

  fireEvent.click(screen.getByRole("button", { name: "Select and open Back options" }));
  const panel = screen.getByRole("region", { name: "Back" });
  fireEvent.click(within(panel).getByRole("button", { name: "Lats" }));
  fireEvent.click(within(panel).getByRole("button", { name: "All Back" }));

  expect(JSON.parse(screen.getByTestId("muscle-state").textContent).musclePriorities)
    .toMatchObject({ primaryFocus: "back" });
  expect(within(panel).getByRole("button", { name: "All Back Main" }))
    .toHaveAttribute("aria-pressed", "true");
});

test("Step 3 child refinement replaces its parent without consuming another slot", () => {
  render(<MuscleHarness />);

  fireEvent.click(screen.getByRole("button", { name: "Secondary: 0/2" }));
  fireEvent.click(screen.getByRole("button", { name: "Select and open Back options" }));
  const backPanel = screen.getByRole("region", { name: "Back" });
  fireEvent.click(within(backPanel).getByRole("button", { name: "Lats" }));

  const priorities = JSON.parse(
    screen.getByTestId("muscle-state").textContent
  ).musclePriorities;
  expect(priorities.secondaryFocuses).toEqual(["lats"]);
  expect(screen.getByRole("button", { name: "Secondary: 1/2" })).toBeInTheDocument();
});

test("Step 3 Glutes & Hamstrings remains a selection-neutral UX grouping", () => {
  render(<MuscleHarness />);

  fireEvent.click(screen.getByRole("button", { name: "Open Glutes & Hamstrings options" }));
  expect(JSON.parse(screen.getByTestId("muscle-state").textContent).musclePriorities)
    .toMatchObject({ primaryFocus: null });

  const panel = screen.getByRole("region", { name: "Glutes & Hamstrings" });
  fireEvent.click(within(panel).getByRole("button", { name: "Glutes" }));
  expect(JSON.parse(screen.getByTestId("muscle-state").textContent).musclePriorities)
    .toMatchObject({ primaryFocus: "glutes" });
});

test("Step 3 More areas opens without assigning and maps its canonical choices", () => {
  render(<MuscleHarness />);

  const moreAreasCard = screen.getByRole("button", { name: "Open More areas options" });
  expect(moreAreasCard).toBeInTheDocument();
  fireEvent.click(moreAreasCard);
  expect(JSON.parse(screen.getByTestId("muscle-state").textContent).musclePriorities)
    .toMatchObject({ primaryFocus: null });

  const panel = screen.getByRole("region", { name: "More areas" });
  fireEvent.click(within(panel).getByRole("button", { name: "Forearms" }));
  expect(JSON.parse(screen.getByTestId("muscle-state").textContent).musclePriorities)
    .toMatchObject({ primaryFocus: "forearms" });

  fireEvent.click(within(panel).getByRole("button", { name: "Adductors" }));
  expect(JSON.parse(screen.getByTestId("muscle-state").textContent).musclePriorities)
    .toMatchObject({ primaryFocus: "adductors" });
});

test("Step 3 keeps Main and Reduce limited to one canonical assignment", () => {
  render(<MuscleHarness />);

  fireEvent.click(screen.getByRole("button", { name: "Select and open Chest options" }));
  fireEvent.click(screen.getByRole("button", { name: "Select and open Back options" }));
  expect(JSON.parse(screen.getByTestId("muscle-state").textContent).musclePriorities)
    .toMatchObject({ primaryFocus: "back" });

  fireEvent.click(screen.getByRole("button", { name: "Reduce: 0/1" }));
  fireEvent.click(screen.getByRole("button", { name: "Select Chest as Reduce" }));
  fireEvent.click(screen.getByRole("button", { name: /Select Back as Reduce/ }));
  expect(JSON.parse(screen.getByTestId("muscle-state").textContent).musclePriorities)
    .toMatchObject({ primaryFocus: null, deprioritizedArea: "back" });
});

test("Step 3 reassignment removes the same canonical value from conflicting slots", () => {
  render(<MuscleHarness />);

  fireEvent.click(screen.getByRole("button", { name: "Select and open Chest options" }));
  fireEvent.click(screen.getByRole("button", { name: "Reduce: 0/1" }));
  fireEvent.click(screen.getByRole("button", { name: /Select Chest as Reduce/ }));

  const draft = JSON.parse(screen.getByTestId("muscle-state").textContent);
  expect(draft.musclePriorities).toEqual({
    primaryFocus: null,
    secondaryFocuses: [],
    deprioritizedArea: "chest",
  });
});

test("macro mapping exactly matches the finalized canonical onboarding groups", () => {
  const regions = getMuscleMacroRegions("primary");
  expect(regions.map((region) => region.label)).toEqual([
    "Chest",
    "Back",
    "Shoulders",
    "Biceps",
    "Triceps",
    "Core",
    "Quads",
    "Glutes & Hamstrings",
    "Calves",
    "More areas",
  ]);
  expect(Object.fromEntries(regions.map((region) => [
    region.label,
    region.options.map((option) => [option.label, option.value]),
  ]))).toEqual({
    Chest: [["All Chest", "chest"], ["Upper Chest", "upper_chest"]],
    Back: [["All Back", "back"], ["Lats", "lats"], ["Upper Back", "upper_back"]],
    Shoulders: [["All Shoulders", "shoulders"], ["Front Delts", "front_delts"], ["Side Delts", "side_delts"], ["Rear Delts", "rear_delts"]],
    Biceps: [["All Biceps", "biceps"], ["Long Head", "biceps_long_head"], ["Short Head", "biceps_short_head"]],
    Triceps: [["All Triceps", "triceps"], ["Long Head", "triceps_long_head"], ["Lateral Head", "triceps_lateral_head"]],
    Core: [["All Core", "core"], ["Abs", "abs"], ["Upper Abs", "upper_abs"], ["Lower Abs", "lower_abs"], ["Obliques", "obliques"], ["Lower Back", "lower_back"]],
    Quads: [["Quads", "quadriceps"]],
    "Glutes & Hamstrings": [["Glutes", "glutes"], ["Glute Max", "glute_max"], ["Glute Med", "glute_med"], ["Hamstrings", "hamstrings"]],
    Calves: [["All Calves", "calves"], ["Gastrocnemius", "gastrocnemius"], ["Soleus", "soleus"]],
    "More areas": [["Forearms", "forearms"], ["Adductors", "adductors"]],
  });
});

test("Reduce mapping excludes every micro-focus and keeps Lower Back under Core", () => {
  const reducedRegions = getMuscleMacroRegions("deprioritized");
  const reducedValues = reducedRegions.flatMap((region) =>
    region.options.map((option) => option.value)
  );
  expect(reducedValues).not.toEqual(expect.arrayContaining([
    "upper_chest",
    "lats",
    "rear_delts",
    "glute_max",
    "gastrocnemius",
  ]));
  expect(reducedRegions.find((region) => region.id === "core").options)
    .toEqual(expect.arrayContaining([
      expect.objectContaining({ value: "lower_back", label: "Lower Back" }),
    ]));
  expect(reducedRegions.find((region) => region.id === "back").options)
    .not.toEqual(expect.arrayContaining([expect.objectContaining({ value: "lower_back" })]));
});

function SetupHarness() {
  const [draft, setDraft] = useState(createDraft());
  return (
    <DesignV2Scope>
      <TrainingSetupStep draft={draft} onChange={setDraft} />
      <output data-testid="setup-state">{JSON.stringify(draft)}</output>
    </DesignV2Scope>
  );
}

test("Step 4 applies canonical presets and compact equipment bias", () => {
  render(<SetupHarness />);

  fireEvent.click(screen.getByRole("radio", { name: "Home Gym" }));
  fireEvent.click(screen.getByRole("radio", { name: "Machines" }));

  const draft = JSON.parse(screen.getByTestId("setup-state").textContent);
  expect(draft.environment.equipmentPreset).toBe("home_gym");
  expect(draft.environment.availableEquipment).toContain("dumbbells");
  expect(draft.exercisePreference.equipmentBias).toBe("machines");
});

test("Step 4 optional equipment customization persists without another disclosure layer", () => {
  render(<SetupHarness />);
  fireEvent.click(screen.getByRole("radio", { name: "Home Gym" }));
  fireEvent.click(screen.getByRole("button", { name: /Customize equipment/i }));
  fireEvent.click(screen.getByRole("button", { name: "Gymnastic Rings" }));

  const draft = JSON.parse(screen.getByTestId("setup-state").textContent);
  expect(draft.environment.availableEquipment).toContain("gymnastic_rings");
  expect(screen.queryByRole("button", { name: "Bodyweight" })).toBeInTheDocument();
});
