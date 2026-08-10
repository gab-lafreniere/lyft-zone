import {
  DEPRIORITIZED_AREA_GROUPS,
  MUSCLE_PRIORITY_GROUPS,
} from "../settings/settingsOptions";

// This layer only groups canonical Settings values for the macro-first onboarding UI.
// Contextual labels never change the canonical values persisted by Settings.
const REGION_VALUE_MAP = [
  {
    id: "chest",
    label: "Chest",
    icon: "fitness_center",
    defaultValue: "chest",
    options: [["chest", "All Chest"], ["upper_chest", "Upper Chest"]],
  },
  {
    id: "back",
    label: "Back",
    icon: "accessibility_new",
    defaultValue: "back",
    options: [["back", "All Back"], ["lats", "Lats"], ["upper_back", "Upper Back"]],
  },
  {
    id: "shoulders",
    label: "Shoulders",
    icon: "sports_gymnastics",
    defaultValue: "shoulders",
    options: [["shoulders", "All Shoulders"], ["front_delts", "Front Delts"], ["side_delts", "Side Delts"], ["rear_delts", "Rear Delts"]],
  },
  {
    id: "biceps",
    label: "Biceps",
    icon: "exercise",
    defaultValue: "biceps",
    options: [["biceps", "All Biceps"], ["biceps_long_head", "Long Head"], ["biceps_short_head", "Short Head"]],
  },
  {
    id: "triceps",
    label: "Triceps",
    icon: "exercise",
    defaultValue: "triceps",
    options: [["triceps", "All Triceps"], ["triceps_long_head", "Long Head"], ["triceps_lateral_head", "Lateral Head"]],
  },
  {
    id: "core",
    label: "Core",
    icon: "self_improvement",
    defaultValue: "core",
    options: [["core", "All Core"], ["abs", "Abs"], ["upper_abs", "Upper Abs"], ["lower_abs", "Lower Abs"], ["obliques", "Obliques"], ["lower_back", "Lower Back"]],
  },
  {
    id: "quads",
    label: "Quads",
    icon: "directions_run",
    defaultValue: "quadriceps",
    options: [["quadriceps", "Quads"]],
  },
  {
    id: "posterior",
    label: "Glutes & Hamstrings",
    icon: "airline_seat_legroom_extra",
    defaultValue: null,
    options: [["glutes", "Glutes"], ["glute_max", "Glute Max"], ["glute_med", "Glute Med"], ["hamstrings", "Hamstrings"]],
  },
  {
    id: "calves",
    label: "Calves",
    icon: "steps",
    defaultValue: "calves",
    options: [["calves", "All Calves"], ["gastrocnemius", "Gastrocnemius"], ["soleus", "Soleus"]],
  },
  {
    id: "more",
    label: "More areas",
    icon: "more_horiz",
    defaultValue: null,
    options: [["forearms", "Forearms"], ["adductors", "Adductors"]],
  },
];

function flattenOptions(groups) {
  return new Map(
    groups.flatMap((group) => group.options).map((option) => [option.value, option])
  );
}

const priorityOptions = flattenOptions(MUSCLE_PRIORITY_GROUPS);
const reducedOptions = flattenOptions(DEPRIORITIZED_AREA_GROUPS);

export function getMuscleMacroRegions(mode = "primary") {
  const availableOptions = mode === "deprioritized" ? reducedOptions : priorityOptions;

  return REGION_VALUE_MAP.map((region) => {
    const allOptions = region.options
      .map(([value, label]) => {
        const canonicalOption = priorityOptions.get(value);
        return canonicalOption ? { ...canonicalOption, label } : null;
      })
      .filter(Boolean);

    return {
      ...region,
      values: allOptions.map((option) => option.value),
      allOptions,
      options: allOptions.filter((option) => availableOptions.has(option.value)),
    };
  }).filter((region) => region.options.length > 0);
}

export function findMuscleMacroRegion(value) {
  return REGION_VALUE_MAP.find((region) =>
    region.options.some(([optionValue]) => optionValue === value)
  ) || null;
}
