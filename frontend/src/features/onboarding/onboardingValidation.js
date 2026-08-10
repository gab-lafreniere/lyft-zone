import {
  CARDIO_ROLE_OPTIONS,
  EQUIPMENT_BIAS_OPTIONS,
  EQUIPMENT_PRESETS,
  EXPERIENCE_OPTIONS,
} from "../settings/settingsOptions";
import { isCompletePainIssue } from "../settings/settingsMappers";
import { validateTrainingProfileDraft } from "../settings/settingsValidation";

export const MAX_DISPLAY_NAME_LENGTH = 80;
const VALID_SEX_VALUES = new Set(["MALE", "FEMALE"]);
const VALID_EXPERIENCE_VALUES = new Set(
  EXPERIENCE_OPTIONS.map((option) => option.value)
);
const VALID_EQUIPMENT_BIASES = new Set(
  EQUIPMENT_BIAS_OPTIONS.map((option) => option.value)
);
const VALID_CARDIO_ROLES = new Set(
  CARDIO_ROLE_OPTIONS.map((option) => option.value)
);

export function hasValidOnboardingCardioRole(draft) {
  return VALID_CARDIO_ROLES.has(draft?.cardioProfile?.cardioRole);
}

export function validateAboutYou({ profile, experience }) {
  const fieldErrors = {};
  const displayName = String(profile?.displayName || "").trim();
  const age = Number(profile?.age);
  const demographicsLocked = profile?.demographicsStatus === "LOCKED";

  if (!displayName) {
    fieldErrors.displayName = "Enter your name.";
  } else if (displayName.length > MAX_DISPLAY_NAME_LENGTH) {
    fieldErrors.displayName = `Name must be at most ${MAX_DISPLAY_NAME_LENGTH} characters.`;
  }

  if (profile?.demographicsStatus === "INCONSISTENT") {
    fieldErrors.demographics =
      "Your saved age and sex are incomplete. Contact support before continuing.";
  } else if (!demographicsLocked) {
    if (!Number.isInteger(age) || age < 18 || age > 100) {
      fieldErrors.age = "Age must be an integer from 18 through 100.";
    }
    if (!VALID_SEX_VALUES.has(profile?.sex)) {
      fieldErrors.sex = "Select Male or Female.";
    }
  }

  if (!VALID_EXPERIENCE_VALUES.has(experience)) {
    fieldErrors.experience = "Select your training experience.";
  }

  return {
    ok: Object.keys(fieldErrors).length === 0,
    fieldErrors,
  };
}

export function validateTrainingStep(draft, availabilityOptions) {
  const fieldErrors = {};
  const sessions = Number(draft?.availability?.sessionsPerWeek);
  const duration = Number(draft?.availability?.durationPerSession);
  const allowedSessions = availabilityOptions?.sessionsPerWeek || [];
  const allowedDurations = availabilityOptions?.durationPerSession || [];

  if (!allowedSessions.includes(sessions)) {
    fieldErrors.sessionsPerWeek = "Choose an available weekly frequency.";
  }
  if (!allowedDurations.includes(duration)) {
    fieldErrors.durationPerSession = "Choose an available session duration.";
  }

  return {
    ok: Object.keys(fieldErrors).length === 0,
    fieldErrors,
  };
}

export function validateMuscleStep(draft, availabilityOptions) {
  const validation = validateTrainingProfileDraft(draft, availabilityOptions);
  const fieldErrors = Object.fromEntries(
    Object.entries(validation.fieldErrors).filter(([path]) =>
      path.startsWith("musclePriorities")
    )
  );

  return {
    ok: Object.keys(fieldErrors).length === 0,
    fieldErrors,
  };
}

export function validateSetupStep(draft) {
  const fieldErrors = {};
  const preset = draft?.environment?.equipmentPreset;
  const availableEquipment = draft?.environment?.availableEquipment;
  const equipmentBias = draft?.exercisePreference?.equipmentBias;

  if (!Object.prototype.hasOwnProperty.call(EQUIPMENT_PRESETS, preset)) {
    fieldErrors.equipmentPreset = "Choose a training setup.";
  }
  if (!Array.isArray(availableEquipment) || availableEquipment.length === 0) {
    fieldErrors.availableEquipment = "Select at least one available item.";
  }
  if (!VALID_EQUIPMENT_BIASES.has(equipmentBias)) {
    fieldErrors.equipmentBias = "Choose an equipment preference.";
  }

  return {
    ok: Object.keys(fieldErrors).length === 0,
    fieldErrors,
  };
}

export function validateFinalStep(draft, availabilityOptions, hasMovementLimitations) {
  const validation = validateTrainingProfileDraft(draft, availabilityOptions);
  const fieldErrors = { ...validation.fieldErrors };
  const painIssues = Array.isArray(draft?.movementConstraints?.painIssues)
    ? draft.movementConstraints.painIssues
    : [];

  if (!hasValidOnboardingCardioRole(draft)) {
    fieldErrors["cardioProfile.cardioRole"] = "Choose how cardio should be included.";
  }

  if (
    hasMovementLimitations &&
    painIssues.some((issue) => !isCompletePainIssue(issue))
  ) {
    fieldErrors.movementConstraints =
      "Complete or remove unfinished movement limitations before continuing.";
  }

  return {
    ok: Object.keys(fieldErrors).length === 0 && validation.formErrors.length === 0,
    fieldErrors,
    formErrors: validation.formErrors,
  };
}
