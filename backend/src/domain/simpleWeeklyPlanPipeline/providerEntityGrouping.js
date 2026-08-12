const PROVIDER_ENTITY_GROUP_KEYS = Object.freeze([
  'strengthExercises',
  'cardioExercises',
  'blockRests',
]);

function entityRegistryError(message, details = null) {
  const error = new Error(message);
  error.code = 'INVALID_PROVIDER_ENTITY_REGISTRY';
  if (details) {
    error.details = [details];
  }
  return error;
}

function buildCanonicalProviderEntities(skeleton = {}) {
  const slots = Array.isArray(skeleton.slots) ? skeleton.slots : [];
  const slotByPointer = new Map();

  slots.forEach((slot) => {
    if (slotByPointer.has(slot.pointer)) {
      throw entityRegistryError(
        `Canonical skeleton contains duplicate slot pointer: ${slot.pointer}`,
        { pointer: slot.pointer }
      );
    }
    slotByPointer.set(slot.pointer, slot);
  });

  function requireSlot(pointer, kind) {
    const slot = slotByPointer.get(pointer);
    if (!slot || slot.kind !== kind) {
      throw entityRegistryError(
        `Canonical skeleton is missing ${kind} at ${pointer}`,
        {
          pointer,
          expectedKind: kind,
          receivedKind: slot?.kind || null,
        }
      );
    }
    return slot;
  }

  const groups = {
    strengthExercises: [],
    cardioExercises: [],
    blockRests: [],
  };
  const workouts = Array.isArray(skeleton.document?.workouts)
    ? skeleton.document.workouts
    : [];

  workouts.forEach((workout, workoutIndex) => {
    const blocks = Array.isArray(workout?.blocks) ? workout.blocks : [];
    blocks.forEach((block, blockIndex) => {
      const blockPointer = `/workouts/${workoutIndex}/blocks/${blockIndex}`;

      if (block.blockType === 'SUPERSET') {
        groups.blockRests.push({
          restSlot: requireSlot(
            `${blockPointer}/restSeconds`,
            'blockRestSeconds'
          ),
        });
      }

      const exercises = Array.isArray(block?.exercises)
        ? block.exercises
        : [];
      exercises.forEach((exercise, exerciseIndex) => {
        const exercisePointer =
          `${blockPointer}/exercises/${exerciseIndex}`;
        const shared = {
          exerciseIdSlot: requireSlot(
            `${exercisePointer}/exerciseId`,
            'exerciseId'
          ),
          notesSlot: requireSlot(
            `${exercisePointer}/notes`,
            'exerciseNotes'
          ),
        };

        if (block.blockType === 'CARDIO') {
          groups.cardioExercises.push({
            ...shared,
            cardioPrescriptionSlot: requireSlot(
              `${exercisePointer}/cardioPrescription`,
              'cardioPrescription'
            ),
          });
          return;
        }

        const setTemplates = Array.isArray(exercise?.setTemplates)
          ? exercise.setTemplates
          : [];
        groups.strengthExercises.push({
          ...shared,
          defaultsSlot: requireSlot(exercisePointer, 'exerciseDefaults'),
          setSlots: setTemplates.map((_, setIndex) =>
            requireSlot(
              `${exercisePointer}/setTemplates/${setIndex}`,
              'strengthSetTarget'
            )
          ),
        });
      });
    });
  });

  return groups;
}

module.exports = {
  PROVIDER_ENTITY_GROUP_KEYS,
  buildCanonicalProviderEntities,
};
