const CARDIO_MODALITY_BY_EXERCISE_ID = {
  exr_treadmill_walk: "treadmill_walk",
  exr_incline_treadmill_walk: "incline_treadmill_walk",
  exr_stationary_bike: "stationary_bike",
  exr_recumbent_bike: "recumbent_bike",
  exr_stair_climber: "stair_climber",
  exr_elliptical: "elliptical",
  exr_rowing_machine: "rowing_machine",
};

export function resolveCardioModality(exerciseId, explicitModality = null) {
  const normalizedExplicitModality = String(explicitModality || "")
    .trim()
    .toLowerCase();

  if (normalizedExplicitModality) {
    return normalizedExplicitModality;
  }

  const normalizedExerciseId = String(exerciseId || "").trim();
  return CARDIO_MODALITY_BY_EXERCISE_ID[normalizedExerciseId] || "";
}
