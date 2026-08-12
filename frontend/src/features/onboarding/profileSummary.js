import {
  AREA_LABELS,
  CARDIO_ROLE_OPTIONS,
  EQUIPMENT_SETUP_OPTIONS,
  EXPERIENCE_OPTIONS,
  PRIMARY_GOAL_OPTIONS,
} from "../settings/settingsOptions";

const CARDIO_LABELS = {
  none: "No cardio",
  warm_up_only: "Warm-up cardio",
  cardio_sessions: "Cardio sessions",
  warm_up_and_cardio: "Warm-up + cardio",
};

function findLabel(options, value) {
  return options.find((option) => option.value === value)?.label || "";
}

export function buildProfileSummaryItems(draft) {
  const items = [];
  const experience = findLabel(EXPERIENCE_OPTIONS, draft?.experience);
  const sessions = Number(draft?.availability?.sessionsPerWeek);
  const duration = Number(draft?.availability?.durationPerSession);
  const preset = findLabel(EQUIPMENT_SETUP_OPTIONS, draft?.environment?.equipmentPreset);
  const priorities = draft?.musclePriorities || {};
  const muscleLabels = [
    priorities.primaryFocus ? `${AREA_LABELS[priorities.primaryFocus]} main` : "",
    ...(priorities.secondaryFocuses || []).map((value) => `${AREA_LABELS[value]} secondary`),
    priorities.deprioritizedArea ? `${AREA_LABELS[priorities.deprioritizedArea]} reduced` : "",
  ].filter(Boolean);
  const cardioRole = draft?.cardioProfile?.cardioRole;
  const cardio = cardioRole && cardioRole !== "none"
    ? CARDIO_LABELS[cardioRole] || findLabel(CARDIO_ROLE_OPTIONS, cardioRole)
    : "";

  if (experience) items.push({ key: "experience", label: experience, icon: "trending_up" });
  if (Number.isFinite(sessions) && sessions > 0) {
    items.push({ key: "sessions", label: `${sessions} days/week`, icon: "calendar_month", tone: "action" });
  }
  if (Number.isFinite(duration) && duration > 0) {
    items.push({ key: "duration", label: `${duration} min/session`, icon: "timer", tone: "info" });
  }
  if (muscleLabels.length) {
    items.push({ key: "muscles", label: muscleLabels.join(" · "), icon: "fitness_center" });
  }
  if (preset) items.push({ key: "equipment", label: preset, icon: "home" });
  if (cardio) items.push({ key: "cardio", label: cardio, icon: "monitor_heart" });

  return items;
}

export function buildCompactSummaryText(items) {
  const compactKeys = new Set(["experience", "sessions", "duration", "equipment"]);
  return items
    .filter((item) => compactKeys.has(item.key))
    .map((item) => item.label)
    .join(" · ");
}

export function buildGenerationProfileChips(draft) {
  const chips = [];
  const sessions = Number(draft?.availability?.sessionsPerWeek);
  const goal = findLabel(PRIMARY_GOAL_OPTIONS, draft?.primaryGoal);
  const experience = findLabel(EXPERIENCE_OPTIONS, draft?.experience);
  const primaryFocus = AREA_LABELS[draft?.musclePriorities?.primaryFocus] || "";
  const equipment = findLabel(
    EQUIPMENT_SETUP_OPTIONS,
    draft?.environment?.equipmentPreset
  );

  if (Number.isFinite(sessions) && sessions > 0) {
    chips.push({ key: "sessions", label: `${sessions} Sessions/Wk` });
  }
  if (goal) chips.push({ key: "goal", label: goal });
  if (experience) chips.push({ key: "experience", label: experience });
  if (primaryFocus) {
    chips.push({ key: "priority", label: `${primaryFocus} Priority`, accent: true });
  }
  if (equipment) chips.push({ key: "equipment", label: equipment });

  return chips;
}
