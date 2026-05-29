export const SETTINGS_ROOT_ITEMS = [
  {
    id: "trainingProfile",
    label: "Training Profile",
    description: "Goals, experience, availability, environment, and movement signals.",
    menuDescription: "",
    icon: "fitness_center",
    screenId: "training-profile-menu",
    readonly: false,
  },
  {
    id: "account",
    label: "Profile",
    description: "Profile identity and account basics.",
    menuDescription: "",
    icon: "person",
    screenId: "settings-section",
    readonly: true,
  },
  {
    id: "aiCoaching",
    label: "AI Coaching",
    description: "Current coaching mode and future AI controls.",
    menuDescription: "",
    icon: "neurology",
    screenId: "settings-section",
    readonly: true,
  },
  {
    id: "workoutExperience",
    label: "Workout Experience",
    description: "Rest timer and in-workout behavior preferences.",
    menuDescription: "",
    icon: "timer",
    screenId: "settings-section",
    readonly: true,
  },
  {
    id: "interface",
    label: "Units & Interface",
    description: "Units and interface defaults.",
    menuDescription: "",
    icon: "tune",
    screenId: "settings-section",
    readonly: true,
  },
];

export const SETTINGS_SECTIONS = SETTINGS_ROOT_ITEMS.map(({ id, label }) => ({
  id,
  label,
}));

export const TRAINING_PROFILE_MENU_ITEMS = [
  {
    id: "goals",
    label: "Goals",
    description: "Primary goal and muscle priority signals.",
    menuDescription: "",
    screenId: "training-profile-section",
    errorPaths: ["primaryGoal", "musclePriorities"],
  },
  {
    id: "experience",
    label: "Experience",
    description: "Current lifting experience level.",
    menuDescription: "",
    screenId: "training-profile-section",
    errorPaths: ["experience"],
  },
  {
    id: "availability",
    label: "Availability",
    description: "Weekly training volume and session length.",
    menuDescription: "",
    screenId: "training-profile-section",
    errorPaths: ["availability"],
  },
  {
    id: "environment",
    label: "Environment",
    description: "Training environment, setup, and available equipment.",
    menuDescription: "",
    screenId: "training-profile-section",
    errorPaths: ["environment"],
  },
  {
    id: "movementConstraints",
    label: "Movement Constraints",
    description: "Soft signals, hard blocks, and pain context.",
    menuDescription: "",
    screenId: "training-profile-section",
    errorPaths: ["movementConstraints"],
  },
  {
    id: "exercisePreference",
    label: "Exercise Preference",
    description: "Optional equipment bias.",
    menuDescription: "",
    screenId: "training-profile-section",
    errorPaths: ["exercisePreference"],
  },
  {
    id: "cardioProfile",
    label: "Cardio Profile",
    description: "Cardio role and preferred modalities.",
    menuDescription: "",
    screenId: "training-profile-section",
    errorPaths: ["cardioProfile"],
  },
  {
    id: "physicalNotes",
    label: "Physical Notes",
    description: "Extra context for future builder logic.",
    menuDescription: "",
    screenId: "training-profile-section",
    errorPaths: ["physicalNotes"],
  },
];

export const SETTINGS_ROOT_GROUPS = [
  { label: "Training", itemIds: ["trainingProfile", "aiCoaching"] },
  { label: "Account", itemIds: ["account"] },
  { label: "Preferences", itemIds: ["workoutExperience", "interface"] },
];

export const TRAINING_PROFILE_MENU_GROUPS = [
  { label: "Plan Inputs", itemIds: ["goals", "experience", "availability"] },
  { label: "Gym Setup", itemIds: ["environment", "exercisePreference"] },
  { label: "Constraints", itemIds: ["movementConstraints"] },
  { label: "Cardio & Notes", itemIds: ["cardioProfile", "physicalNotes"] },
];

export function resolveSettingsMenuGroups(groups, items) {
  const itemsById = new Map((items || []).map((item) => [item.id, item]));

  return (groups || []).map((group) => ({
    ...group,
    items: (group.itemIds || []).map((itemId) => itemsById.get(itemId)).filter(Boolean),
  }));
}

function hasErrorForPath(fieldErrors, path) {
  if (!path) {
    return false;
  }

  return Object.keys(fieldErrors || {}).some(
    (candidate) =>
      candidate === path ||
      candidate.startsWith(`${path}.`) ||
      candidate.startsWith(`${path}[`)
  );
}

export function findSettingsRootItem(itemId) {
  return SETTINGS_ROOT_ITEMS.find((item) => item.id === itemId) || null;
}

export function findTrainingProfileMenuItem(itemId) {
  return TRAINING_PROFILE_MENU_ITEMS.find((item) => item.id === itemId) || null;
}

export function getTrainingProfileSectionErrorMap(fieldErrors) {
  return TRAINING_PROFILE_MENU_ITEMS.reduce((accumulator, item) => {
    accumulator[item.id] = item.errorPaths.some((path) => hasErrorForPath(fieldErrors, path));
    return accumulator;
  }, {});
}

export function getTrainingProfileHasErrors(fieldErrors) {
  return Object.values(getTrainingProfileSectionErrorMap(fieldErrors)).some(Boolean);
}

export const PRIMARY_GOAL_OPTIONS = [
  {
    value: "HYPERTROPHY",
    label: "Hypertrophy",
    description: "Focus on muscle size, shape, and overall visual development.",
    icon: "exercise",
  },
  {
    value: "STRENGTH",
    label: "Strength",
    description: "Bias your plan toward force output and heavier performance work.",
    icon: "bolt",
  },
  {
    value: "MIXED",
    label: "Mixed",
    description: "Balance muscle growth and strength with a more blended approach.",
    icon: "tune",
  },
];

export const EXPERIENCE_OPTIONS = [
  {
    value: "beginner",
    label: "Beginner",
    description: "You are still building consistency, exercise skill, and tolerance.",
    icon: "school",
  },
  {
    value: "intermediate",
    label: "Intermediate",
    description: "You train regularly and recover well from structured weekly volume.",
    icon: "trending_up",
  },
  {
    value: "advanced",
    label: "Advanced",
    description: "You handle higher precision, accumulated fatigue, and progression nuance.",
    icon: "workspace_premium",
  },
];

export const TRAINING_ENVIRONMENT_OPTIONS = [
  {
    value: "gym",
    label: "Gym",
    description: "You usually train in a commercial or fully equipped gym setting.",
    icon: "fitness_center",
  },
  {
    value: "home",
    label: "Home",
    description: "You mainly rely on a home setup and available home equipment.",
    icon: "home",
  },
];

export const EQUIPMENT_SETUP_OPTIONS = [
  {
    value: "full_gym",
    label: "Full Gym",
    description: "Broad access to machines, free weights, racks, and accessories.",
    icon: "apartment",
  },
  {
    value: "limited_gym",
    label: "Limited Gym",
    description: "A gym environment, but with notable equipment gaps or limitations.",
    icon: "domain",
  },
  {
    value: "home_gym",
    label: "Home Gym",
    description: "A stronger home setup with several useful training tools available.",
    icon: "garage_home",
  },
  {
    value: "minimal",
    label: "Minimal",
    description: "Very limited equipment, mostly bodyweight or a few versatile tools.",
    icon: "deployed_code",
  },
];

export const EQUIPMENT_BIAS_OPTIONS = [
  {
    value: "machines",
    label: "Machines",
    description: "Prefer stable machine-based setups when possible.",
    icon: "precision_manufacturing",
  },
  {
    value: "free_weights",
    label: "Free Weights",
    description: "Prefer dumbbells, barbells, and more open movement patterns.",
    icon: "sports_gymnastics",
  },
  {
    value: "no_preference",
    label: "No Preference",
    description: "Let the system balance exercise choice without a strong equipment bias.",
    icon: "shuffle",
  },
];

export const PAIN_SEVERITY_OPTIONS = [
  { value: "none", label: "None" },
  { value: "low", label: "Low" },
  { value: "moderate", label: "Moderate" },
  { value: "high", label: "High" },
  { value: "severe", label: "Severe" },
];

export const TRAINING_RULE_OPTIONS = [
  {
    value: "none",
    label: "No restriction",
    description: "No specific restriction is applied by default.",
    icon: "check_circle",
  },
  {
    value: "monitor",
    label: "Monitor symptoms",
    description: "Keep the movement available, but pay attention to symptoms and tolerance.",
    icon: "visibility",
  },
  {
    value: "limit",
    label: "Pain-free only",
    description: "Keep only pain-free variations, ranges, and loads.",
    icon: "shield",
  },
  {
    value: "modify",
    label: "Modify movement",
    description: "Use safer alternatives or change setup to reduce aggravation.",
    icon: "build",
  },
  {
    value: "avoid",
    label: "Avoid entirely",
    description: "Treat this as a clear hard restriction in the plan.",
    icon: "block",
  },
];

export const AFFECTED_AREA_OPTIONS = [
  { value: "shoulder", label: "Shoulder" },
  { value: "elbow", label: "Elbow" },
  { value: "wrist", label: "Wrist" },
  { value: "lower_back", label: "Lower Back" },
  { value: "hip", label: "Hip" },
  { value: "knee", label: "Knee" },
  { value: "ankle", label: "Ankle" },
  { value: "neck_upper_back", label: "Neck / Upper Back" },
];

export const CARDIO_ROLE_OPTIONS = [
  {
    value: "none",
    label: "No cardio focus",
    description: "Keep cardio out of the program unless needed elsewhere.",
    icon: "do_not_disturb_on",
  },
  {
    value: "warm_up_only",
    label: "Warm-up only",
    description: "Use cardio mainly as a warm-up before lifting sessions.",
    icon: "directions_run",
  },
  {
    value: "cardio_sessions",
    label: "Cardio sessions",
    description: "Include dedicated cardio work as part of the overall plan.",
    icon: "monitor_heart",
  },
  {
    value: "warm_up_and_cardio",
    label: "Warm-up and cardio",
    description: "Blend both warm-up usage and more intentional cardio work.",
    icon: "favorite",
  },
];

export const CARDIO_MODALITY_OPTIONS = [
  { value: "treadmill_walk", label: "Treadmill Walk" },
  { value: "incline_treadmill_walk", label: "Incline Treadmill Walk" },
  { value: "stationary_bike", label: "Stationary Bike" },
  { value: "recumbent_bike", label: "Recumbent Bike" },
  { value: "stair_climber", label: "Stair Climber" },
  { value: "elliptical", label: "Elliptical" },
  { value: "rowing_machine", label: "Rowing Machine" },
];

export const AREA_KIND_MAP = {
  upper_body: "region",
  lower_body: "region",
  core: "region",
  chest: "major",
  back: "major",
  shoulders: "major",
  biceps: "major",
  triceps: "major",
  forearms: "major",
  quadriceps: "major",
  hamstrings: "major",
  glutes: "major",
  calves: "major",
  adductors: "major",
  abs: "major",
  obliques: "major",
  lower_back: "major",
  upper_chest: "micro",
  front_delts: "micro",
  side_delts: "micro",
  rear_delts: "micro",
  lats: "micro",
  upper_back: "micro",
  biceps_long_head: "micro",
  biceps_short_head: "micro",
  triceps_long_head: "micro",
  triceps_lateral_head: "micro",
  glute_max: "micro",
  glute_med: "micro",
  gastrocnemius: "micro",
  soleus: "micro",
  upper_abs: "micro",
  lower_abs: "micro",
};

export const AREA_PARENT_MAP = {
  chest: "upper_body",
  back: "upper_body",
  shoulders: "upper_body",
  biceps: "upper_body",
  triceps: "upper_body",
  forearms: "upper_body",
  quadriceps: "lower_body",
  hamstrings: "lower_body",
  glutes: "lower_body",
  calves: "lower_body",
  adductors: "lower_body",
  abs: "core",
  obliques: "core",
  lower_back: "core",
  upper_chest: "chest",
  front_delts: "shoulders",
  side_delts: "shoulders",
  rear_delts: "shoulders",
  lats: "back",
  upper_back: "back",
  biceps_long_head: "biceps",
  biceps_short_head: "biceps",
  triceps_long_head: "triceps",
  triceps_lateral_head: "triceps",
  glute_max: "glutes",
  glute_med: "glutes",
  gastrocnemius: "calves",
  soleus: "calves",
  upper_abs: "abs",
  lower_abs: "abs",
};

export const AREA_LABELS = {
  upper_body: "Upper Body",
  lower_body: "Lower Body",
  core: "Core",
  chest: "Chest",
  back: "Back",
  shoulders: "Shoulders",
  biceps: "Biceps",
  triceps: "Triceps",
  forearms: "Forearms",
  quadriceps: "Quadriceps",
  hamstrings: "Hamstrings",
  glutes: "Glutes",
  calves: "Calves",
  adductors: "Adductors",
  abs: "Abs",
  obliques: "Obliques",
  lower_back: "Lower Back",
  upper_chest: "Upper Chest",
  front_delts: "Front Delts",
  side_delts: "Side Delts",
  rear_delts: "Rear Delts",
  lats: "Lats",
  upper_back: "Upper Back",
  biceps_long_head: "Biceps Long Head",
  biceps_short_head: "Biceps Short Head",
  triceps_long_head: "Triceps Long Head",
  triceps_lateral_head: "Triceps Lateral Head",
  glute_max: "Glute Max",
  glute_med: "Glute Med",
  gastrocnemius: "Gastrocnemius",
  soleus: "Soleus",
  upper_abs: "Upper Abs",
  lower_abs: "Lower Abs",
};

export const BIOMECHANICAL_CONFLICTS = {
  chest: ["shoulders"],
  shoulders: ["chest"],
  biceps: ["triceps"],
  triceps: ["biceps"],
  quadriceps: ["hamstrings"],
  hamstrings: ["quadriceps"],
};

export const MUSCLE_PRIORITY_GROUPS = [
  {
    label: "Upper Body",
    options: [
      { value: "upper_body", label: AREA_LABELS.upper_body, kind: AREA_KIND_MAP.upper_body },
      { value: "chest", label: AREA_LABELS.chest, kind: AREA_KIND_MAP.chest },
      { value: "upper_chest", label: AREA_LABELS.upper_chest, kind: AREA_KIND_MAP.upper_chest },
      { value: "back", label: AREA_LABELS.back, kind: AREA_KIND_MAP.back },
      { value: "lats", label: AREA_LABELS.lats, kind: AREA_KIND_MAP.lats },
      { value: "upper_back", label: AREA_LABELS.upper_back, kind: AREA_KIND_MAP.upper_back },
      { value: "shoulders", label: AREA_LABELS.shoulders, kind: AREA_KIND_MAP.shoulders },
      { value: "front_delts", label: AREA_LABELS.front_delts, kind: AREA_KIND_MAP.front_delts },
      { value: "side_delts", label: AREA_LABELS.side_delts, kind: AREA_KIND_MAP.side_delts },
      { value: "rear_delts", label: AREA_LABELS.rear_delts, kind: AREA_KIND_MAP.rear_delts },
      { value: "biceps", label: AREA_LABELS.biceps, kind: AREA_KIND_MAP.biceps },
      {
        value: "biceps_long_head",
        label: AREA_LABELS.biceps_long_head,
        kind: AREA_KIND_MAP.biceps_long_head,
      },
      {
        value: "biceps_short_head",
        label: AREA_LABELS.biceps_short_head,
        kind: AREA_KIND_MAP.biceps_short_head,
      },
      { value: "triceps", label: AREA_LABELS.triceps, kind: AREA_KIND_MAP.triceps },
      {
        value: "triceps_long_head",
        label: AREA_LABELS.triceps_long_head,
        kind: AREA_KIND_MAP.triceps_long_head,
      },
      {
        value: "triceps_lateral_head",
        label: AREA_LABELS.triceps_lateral_head,
        kind: AREA_KIND_MAP.triceps_lateral_head,
      },
      { value: "forearms", label: AREA_LABELS.forearms, kind: AREA_KIND_MAP.forearms },
    ],
  },
  {
    label: "Lower Body",
    options: [
      { value: "lower_body", label: AREA_LABELS.lower_body, kind: AREA_KIND_MAP.lower_body },
      { value: "quadriceps", label: AREA_LABELS.quadriceps, kind: AREA_KIND_MAP.quadriceps },
      { value: "hamstrings", label: AREA_LABELS.hamstrings, kind: AREA_KIND_MAP.hamstrings },
      { value: "glutes", label: AREA_LABELS.glutes, kind: AREA_KIND_MAP.glutes },
      { value: "glute_max", label: AREA_LABELS.glute_max, kind: AREA_KIND_MAP.glute_max },
      { value: "glute_med", label: AREA_LABELS.glute_med, kind: AREA_KIND_MAP.glute_med },
      { value: "calves", label: AREA_LABELS.calves, kind: AREA_KIND_MAP.calves },
      {
        value: "gastrocnemius",
        label: AREA_LABELS.gastrocnemius,
        kind: AREA_KIND_MAP.gastrocnemius,
      },
      { value: "soleus", label: AREA_LABELS.soleus, kind: AREA_KIND_MAP.soleus },
      { value: "adductors", label: AREA_LABELS.adductors, kind: AREA_KIND_MAP.adductors },
    ],
  },
  {
    label: "Core",
    options: [
      { value: "core", label: AREA_LABELS.core, kind: AREA_KIND_MAP.core },
      { value: "abs", label: AREA_LABELS.abs, kind: AREA_KIND_MAP.abs },
      { value: "upper_abs", label: AREA_LABELS.upper_abs, kind: AREA_KIND_MAP.upper_abs },
      { value: "lower_abs", label: AREA_LABELS.lower_abs, kind: AREA_KIND_MAP.lower_abs },
      { value: "obliques", label: AREA_LABELS.obliques, kind: AREA_KIND_MAP.obliques },
      { value: "lower_back", label: AREA_LABELS.lower_back, kind: AREA_KIND_MAP.lower_back },
    ],
  },
];

export const DEPRIORITIZED_AREA_GROUPS = MUSCLE_PRIORITY_GROUPS.map((group) => ({
  ...group,
  options: group.options.filter((option) => option.kind !== "micro"),
}));

export const EQUIPMENT_CATEGORIES = [
  {
    label: "Bodyweight",
    items: [
      { value: "bodyweight", label: "Bodyweight" },
      { value: "pull_up_bar", label: "Pull-up Bar" },
      { value: "dip_station", label: "Dip Station" },
      { value: "gymnastic_rings", label: "Gymnastic Rings" },
      { value: "push_up_handles", label: "Push-up Handles" },
      { value: "parallettes", label: "Parallettes" },
    ],
  },
  {
    label: "Free Weights",
    items: [
      { value: "dumbbells", label: "Dumbbells" },
      { value: "kettlebell", label: "Kettlebell" },
      { value: "weight_plates", label: "Weight Plates" },
      { value: "olympic_barbell", label: "Olympic Barbell" },
      { value: "ez_bar", label: "EZ Bar" },
      { value: "straight_bar", label: "Straight Bar" },
      { value: "trap_bar", label: "Trap Bar" },
      { value: "safety_squat_bar", label: "Safety Squat Bar" },
    ],
  },
  {
    label: "Benches & Racks",
    items: [
      { value: "flat_bench", label: "Flat Bench" },
      { value: "adjustable_bench", label: "Adjustable Bench" },
      { value: "incline_bench", label: "Incline Bench" },
      { value: "decline_bench", label: "Decline Bench" },
      { value: "preacher_bench", label: "Preacher Bench" },
      { value: "bench_press_rack", label: "Bench Press Rack" },
      { value: "squat_rack", label: "Squat Rack" },
      { value: "power_rack", label: "Power Rack" },
    ],
  },
  {
    label: "Cable Station",
    items: [
      { value: "cable_machine", label: "Cable Machine" },
      { value: "d_handle", label: "D Handle" },
      { value: "rope_attachment", label: "Rope Attachment" },
      { value: "straight_bar_attachment", label: "Straight Bar Attachment" },
      { value: "ez_bar_attachment", label: "EZ Bar Attachment" },
      { value: "v_bar_attachment", label: "V Bar Attachment" },
      { value: "lat_pulldown_bar", label: "Lat Pulldown Bar" },
      { value: "ankle_strap", label: "Ankle Strap" },
    ],
  },
  {
    label: "Smith Machine",
    items: [{ value: "smith_machine", label: "Smith Machine" }],
  },
  {
    label: "Bands",
    items: [
      { value: "resistance_band", label: "Resistance Band" },
      { value: "mini_band", label: "Mini Band" },
      { value: "loop_band", label: "Loop Band" },
    ],
  },
  {
    label: "Selectorized Machines",
    items: [
      { value: "selectorized_chest_press", label: "Selectorized Chest Press" },
      { value: "selectorized_incline_press", label: "Selectorized Incline Press" },
      { value: "selectorized_shoulder_press", label: "Selectorized Shoulder Press" },
      { value: "selectorized_lateral_raise", label: "Selectorized Lateral Raise" },
      { value: "selectorized_lat_pulldown", label: "Selectorized Lat Pulldown" },
      { value: "selectorized_seated_row", label: "Selectorized Seated Row" },
      { value: "selectorized_pec_deck", label: "Selectorized Pec Deck" },
      { value: "selectorized_reverse_pec_deck", label: "Selectorized Reverse Pec Deck" },
      { value: "selectorized_preacher_curl", label: "Selectorized Preacher Curl" },
      { value: "selectorized_triceps_extension", label: "Selectorized Triceps Extension" },
      { value: "selectorized_leg_extension", label: "Selectorized Leg Extension" },
      { value: "selectorized_seated_leg_curl", label: "Selectorized Seated Leg Curl" },
      { value: "selectorized_lying_leg_curl", label: "Selectorized Lying Leg Curl" },
      { value: "selectorized_standing_leg_curl", label: "Selectorized Standing Leg Curl" },
      { value: "selectorized_hip_abduction", label: "Selectorized Hip Abduction" },
      { value: "selectorized_hip_adduction", label: "Selectorized Hip Adduction" },
      { value: "selectorized_glute_kickback", label: "Selectorized Glute Kickback" },
      { value: "selectorized_ab_crunch", label: "Selectorized Ab Crunch" },
    ],
  },
  {
    label: "Plate Loaded Machines",
    items: [
      { value: "plate_loaded_chest_press", label: "Plate Loaded Chest Press" },
      { value: "plate_loaded_row", label: "Plate Loaded Row" },
      { value: "plate_loaded_high_row", label: "Plate Loaded High Row" },
      { value: "plate_loaded_lat_pulldown", label: "Plate Loaded Lat Pulldown" },
      { value: "plate_loaded_leg_press", label: "Plate Loaded Leg Press" },
      { value: "plate_loaded_hack_squat", label: "Plate Loaded Hack Squat" },
      { value: "plate_loaded_pendulum_squat", label: "Plate Loaded Pendulum Squat" },
      { value: "plate_loaded_hip_thrust", label: "Plate Loaded Hip Thrust" },
      { value: "plate_loaded_shrug", label: "Plate Loaded Shrug" },
    ],
  },
  {
    label: "Lower Body Specialty Machines",
    items: [
      { value: "belt_squat_machine", label: "Belt Squat Machine" },
      { value: "v_squat_machine", label: "V Squat Machine" },
      { value: "standing_calf_raise_machine", label: "Standing Calf Raise Machine" },
      { value: "seated_calf_raise_machine", label: "Seated Calf Raise Machine" },
      { value: "donkey_calf_raise_machine", label: "Donkey Calf Raise Machine" },
      { value: "glute_ham_developer", label: "Glute Ham Developer" },
      { value: "back_extension_bench", label: "Back Extension Bench" },
    ],
  },
  {
    label: "Assisted Machines",
    items: [
      { value: "assisted_pull_up_machine", label: "Assisted Pull-up Machine" },
      { value: "assisted_dip_machine", label: "Assisted Dip Machine" },
    ],
  },
  {
    label: "Cardio Machines",
    items: [
      { value: "treadmill", label: "Treadmill" },
      { value: "stationary_bike", label: "Stationary Bike" },
      { value: "recumbent_bike", label: "Recumbent Bike" },
      { value: "stair_climber", label: "Stair Climber" },
      { value: "elliptical", label: "Elliptical" },
      { value: "rowing_machine", label: "Rowing Machine" },
    ],
  },
  {
    label: "Accessories",
    items: [
      { value: "ab_wheel", label: "Ab Wheel" },
      { value: "stability_ball", label: "Stability Ball" },
      { value: "step_platform", label: "Step Platform" },
      { value: "dip_machine", label: "Dip Machine" },
    ],
  },
];

export const EQUIPMENT_LABELS = EQUIPMENT_CATEGORIES.reduce((accumulator, category) => {
  category.items.forEach((item) => {
    accumulator[item.value] = item.label;
  });
  return accumulator;
}, {});

export const CARDIO_MODALITY_LABELS = CARDIO_MODALITY_OPTIONS.reduce(
  (accumulator, option) => {
    accumulator[option.value] = option.label;
    return accumulator;
  },
  {}
);

export function getAncestorAreas(area) {
  const ancestors = [];
  let current = AREA_PARENT_MAP[area] || null;

  while (current) {
    ancestors.push(current);
    current = AREA_PARENT_MAP[current] || null;
  }

  return ancestors;
}

export function getComparableArea(area) {
  if (!area) {
    return null;
  }

  return AREA_KIND_MAP[area] === "micro" ? AREA_PARENT_MAP[area] || null : area;
}
