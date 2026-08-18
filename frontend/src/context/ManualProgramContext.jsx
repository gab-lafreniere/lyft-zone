import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { mapProgramDraftToWeeklyPlanUpdate, mapBuilderPayloadToProgramDraft } from "../features/weeklyPlans/mappers";
import { openOrCreateWeeklyPlanEditDraft, updateWeeklyPlanDraft } from "../services/api";
import { attachBlockUiKeys, createBlockUiKey } from "../utils/blockUiKeys";
import { getDuplicateWorkoutName } from "../utils/duplicateWorkoutName";

const ManualProgramContext = createContext(null);
export const MAX_BLOCK_SET_COUNT = 10;
const DEFAULT_CARDIO_DURATION_MINUTES = 20;

function clampNumber(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function normalizeSetUpdates(updates = {}) {
  const nextUpdates = { ...updates };

  if (typeof nextUpdates.reps === "number" && !Number.isNaN(nextUpdates.reps)) {
    nextUpdates.reps = clampNumber(nextUpdates.reps, 0, 100);
  }

  if (typeof nextUpdates.rpe === "number" && !Number.isNaN(nextUpdates.rpe)) {
    nextUpdates.rpe = clampNumber(nextUpdates.rpe, 0, 4);
  }

  return nextUpdates;
}

function applySetUpdatesWithIntent(set, updates) {
  const editIntent = { ...(set.editIntent || {}) };

  if (Object.prototype.hasOwnProperty.call(updates, "reps") && updates.reps !== set.reps) {
    editIntent.reps = true;
  }
  if (Object.prototype.hasOwnProperty.call(updates, "rpe") && updates.rpe !== set.rpe) {
    editIntent.rir = true;
  }

  return { ...set, ...updates, editIntent };
}

function applyBlockUpdatesWithIntent(block, updates) {
  const editIntent = { ...(block.editIntent || {}) };

  ["tempo", "rest", "notes", "cardioPrescription"].forEach((field) => {
    if (Object.prototype.hasOwnProperty.call(updates, field) && updates[field] !== block[field]) {
      editIntent[field] = true;
    }
  });

  return { ...block, ...updates, editIntent };
}

function applyExerciseUpdatesWithIntent(exercise, updates) {
  const editIntent = { ...(exercise.editIntent || {}) };

  ["tempo", "notes"].forEach((field) => {
    if (
      Object.prototype.hasOwnProperty.call(updates, field) &&
      updates[field] !== exercise[field]
    ) {
      editIntent[field] = true;
    }
  });

  return { ...exercise, ...updates, editIntent };
}

function createId(prefix) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

function createSingleSetRow() {
  return { reps: 8, rpe: 2 };
}

function createSupersetSetRow() {
  return { reps: 10, rpe: 2 };
}

function createSetRows(count, createRow) {
  return Array.from({ length: Math.max(1, count) }, () => createRow());
}

function normalizeSupersetExerciseSets(exercise, targetCount) {
  const safeCount = Math.max(1, targetCount);
  const existingSets = Array.isArray(exercise?.sets) ? exercise.sets : [];

  if (existingSets.length === safeCount) {
    return exercise;
  }

  if (existingSets.length > safeCount) {
    return {
      ...exercise,
      sets: existingSets.slice(0, safeCount),
    };
  }

  return {
    ...exercise,
    sets: [
      ...existingSets,
      ...createSetRows(safeCount - existingSets.length, createSupersetSetRow),
    ],
  };
}

function normalizeSupersetBlock(block) {
  const populatedCounts = Array.isArray(block.exercises)
    ? block.exercises
        .map((exercise) => (Array.isArray(exercise?.sets) ? exercise.sets.length : 0))
        .filter((count) => count > 0)
    : [];
  const targetCount = Math.max(1, block.sets ?? populatedCounts[0] ?? 1);

  return {
    ...block,
    sets: targetCount,
    exercises: (block.exercises || []).map((exercise) =>
      normalizeSupersetExerciseSets(exercise, targetCount)
    ),
  };
}

function createDefaultSingleBlock() {
  return {
    id: createId("block"),
    uiKey: createBlockUiKey(),
    type: "single",
    exercise: "Barbell Back Squat",
    exerciseId: null,
    bodyParts: [],
    muscleFocus: [],
    tempo: "3010",
    rest: "120s",
    sets: createSetRows(2, createSingleSetRow),
    notes: "",
  };
}

function createDefaultSupersetBlock() {
  return normalizeSupersetBlock({
    id: createId("block"),
    uiKey: createBlockUiKey(),
    type: "superset",
    sets: 2,
    rest: "120s",
    exercises: [
      {
        label: "A1",
        name: "Leg Extension",
        exerciseId: null,
        bodyParts: [],
        muscleFocus: [],
        tempo: "3010",
        sets: [
          { reps: 15, rpe: 2 },
          { reps: 12, rpe: 2 },
        ],
        notes: "",
      },
      {
        label: "A2",
        name: "Seated Leg Curl",
        exerciseId: null,
        bodyParts: [],
        muscleFocus: [],
        tempo: "3010",
        sets: [
          { reps: 12, rpe: 2 },
          { reps: 10, rpe: 2 },
        ],
        notes: "",
      },
    ],
  });
}

function createSingleBlockFromExercise(exercise) {
  return {
    id: createId("block"),
    uiKey: createBlockUiKey(),
    type: "single",
    exercise: exercise.name,
    exerciseId: exercise.exerciseId,
    bodyParts: Array.isArray(exercise.bodyParts) ? exercise.bodyParts : [],
    muscleFocus: Array.isArray(exercise.muscleFocus) ? exercise.muscleFocus : [],
    tempo: "3010",
    rest: "120s",
    sets: createSetRows(2, createSingleSetRow),
    notes: "",
  };
}

function createCardioBlockFromExercise(exercise) {
  return {
    id: createId("block"),
    uiKey: createBlockUiKey(),
    type: "cardio",
    exerciseId: exercise.exerciseId,
    exercise,
    cardioPrescription: {
      durationMinutes: DEFAULT_CARDIO_DURATION_MINUTES,
      heartRateTargetMode: undefined,
      heartRateTargetValue: null,
      machineSettings: [],
      notes: "",
    },
  };
}

function createEmptySupersetExercise(label, setCount = 2) {
  return {
    label,
    name: "",
    exerciseId: null,
    bodyParts: [],
    muscleFocus: [],
    tempo: "3010",
    sets: createSetRows(setCount, createSupersetSetRow),
    notes: "",
  };
}

function createWorkout(name, withTemplateBlocks = true) {
  return {
    id: createId("workout"),
    name,
    blocks: withTemplateBlocks
      ? [createDefaultSingleBlock(), createDefaultSupersetBlock()]
      : [],
  };
}

function cloneWorkoutForDuplicate(workout, name = workout.name) {
  return {
    ...workout,
    id: createId("workout"),
    name,
    persistence: undefined,
    blocks: (workout.blocks || []).map((block) => ({
      ...block,
      id: createId("block"),
      uiKey: createBlockUiKey(),
      persistence: undefined,
      exerciseRowId: undefined,
      exercisePersistence: undefined,
      editIntent: undefined,
      exercises:
        block.type === "superset"
          ? (block.exercises || []).map((exercise) => ({
              ...exercise,
              id: undefined,
              persistence: undefined,
              editIntent: undefined,
              sets: Array.isArray(exercise.sets)
                ? exercise.sets.map((set) => ({
                    ...set,
                    id: undefined,
                    persistence: undefined,
                    editIntent: undefined,
                  }))
                : [],
            }))
          : block.exercises,
      sets: Array.isArray(block.sets)
        ? block.sets.map((set) => ({
            ...set,
            id: undefined,
            persistence: undefined,
            editIntent: undefined,
          }))
        : block.sets,
    })),
  };
}

function moveArrayItem(items, fromIndex, toIndex) {
  if (
    !Array.isArray(items) ||
    fromIndex === toIndex ||
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= items.length ||
    toIndex >= items.length
  ) {
    return items;
  }

  const nextItems = [...items];
  const [movedItem] = nextItems.splice(fromIndex, 1);
  nextItems.splice(toIndex, 0, movedItem);
  return nextItems;
}

function attachUiKeysToWorkouts(nextWorkouts = [], previousWorkouts = []) {
  const previousWorkoutsById = new Map(
    previousWorkouts.map((workout) => [workout.id, workout])
  );

  return nextWorkouts.map((workout) => ({
    ...workout,
    blocks: attachBlockUiKeys(
      workout.blocks || [],
      previousWorkoutsById.get(workout.id)?.blocks || []
    ),
  }));
}

function canMoveSelectedWorkouts(workouts, selectedIds, direction) {
  const selectedIdSet = new Set(selectedIds);

  if (!selectedIdSet.size) {
    return false;
  }

  if (direction === "up") {
    return workouts.some(
      (workout, index) =>
        selectedIdSet.has(workout.id) &&
        index > 0 &&
        !selectedIdSet.has(workouts[index - 1].id)
    );
  }

  return workouts.some(
    (workout, index) =>
      selectedIdSet.has(workout.id) &&
      index < workouts.length - 1 &&
      !selectedIdSet.has(workouts[index + 1].id)
  );
}

function createInitialDraft() {
  return {
    programName: "",
    sessionsPerWeek: 4,
    programLength: 8,
    startDate: null,
    endDate: null,
    isMultiWeek: false,
    selectedWeek: 1,
    workouts: [],
  };
}

function createInitialDraftMetadata() {
  return {
    weeklyPlanParentId: null,
    weeklyPlanVersionId: null,
    status: "draft",
    source: "manual",
    loadedFromBackend: false,
    lastSavedAt: null,
    saveState: "idle",
    lastPersistedSignature: "",
    originRoute: null,
    revision: null,
    lastSaveErrorMessage: null,
    lastSaveErrorCode: null,
  };
}

function sameIdentity(a, b) {
  return Boolean(
    a &&
      b &&
      a.weeklyPlanParentId === b.weeklyPlanParentId &&
      a.weeklyPlanVersionId === b.weeklyPlanVersionId
  );
}

// A hydration target is declared before its weeklyPlanVersionId is knowable
// (the draft version is resolved server-side by openOrCreateWeeklyPlanEditDraft),
// so the hydrate-response mismatch check can only compare the outer key --
// unlike sameIdentity, which requires both fields and is for the
// already-loaded same-document check and the send-side abort check, where
// both sides always have a fully-resolved identity by the time they run.
function sameRequestedWeeklyPlan(target, responseIdentity) {
  return Boolean(
    target &&
      responseIdentity &&
      target.weeklyPlanParentId === responseIdentity.weeklyPlanParentId
  );
}

export function ManualProgramProvider({ children }) {
  const [programDraft, setProgramDraft] = useState(createInitialDraft);
  const [draftMetadata, setDraftMetadata] = useState(createInitialDraftMetadata);

  // Kept in sync via effects below so async code (debounce timers, in-flight
  // fetch continuations) always reads the latest value instead of a stale
  // render's closure.
  const programDraftRef = useRef(programDraft);
  const draftMetadataRef = useRef(draftMetadata);

  // Save-sequencing refs (ported from MultiWeekProgramContext.jsx): guarantee
  // at most one PATCH is ever in flight at a time, and that a save triggered
  // while another is already in flight coalesces into a single queued
  // follow-up built from the freshest local snapshot, rather than firing a
  // second overlapping request.
  const saveRequestIdRef = useRef(0);
  const latestAppliedSaveRequestIdRef = useRef(0);
  const saveInFlightPromiseRef = useRef(null);
  const pendingSaveRequestedRef = useRef(false);

  // Identity refs (plan §D): `loadedIdentityRef` is what's truly reflected in
  // `programDraft`/`draftMetadata` right now; `targetIdentityRef` is what the
  // user currently wants to be viewing/editing. A debounced save captures its
  // target identity at the moment it's scheduled and revalidates it against
  // `targetIdentityRef.current` immediately before sending, so a save for a
  // document the user has since navigated away from is silently aborted
  // instead of being sent to the wrong row.
  const loadedIdentityRef = useRef(null);
  const targetIdentityRef = useRef(null);

  useEffect(() => {
    programDraftRef.current = programDraft;
  }, [programDraft]);

  useEffect(() => {
    draftMetadataRef.current = draftMetadata;
  }, [draftMetadata]);

  // `DRAFT_REVISION_CONFLICT` is deliberately NOT the same recovery path as
  // `DRAFT_EXPIRED` (cycle-only, unrelated to this context): it must never
  // silently discard local content. This handler only sets state -- it does
  // not touch programDraft and does not auto-retry. The only way out of
  // "conflict" is the user explicitly confirming reloadLatestAfterConflict().
  const handleRevisionConflict = useCallback((error) => {
    setDraftMetadata((prev) => (
      prev.saveState === "conflict"
        ? prev
        : {
          ...prev,
          saveState: "conflict",
          lastSaveErrorMessage: error?.message || "This draft was updated elsewhere.",
          lastSaveErrorCode: error?.code || "DRAFT_REVISION_CONFLICT",
        }
    ));
  }, []);

  const persistDraftNow = useCallback(async (overrideDraft = null, overrideIdentity = null) => {
    const currentMetadata = draftMetadataRef.current;

    if (
      !currentMetadata.loadedFromBackend ||
      !currentMetadata.weeklyPlanParentId ||
      !currentMetadata.weeklyPlanVersionId
    ) {
      return null;
    }

    const identity = overrideIdentity || {
      weeklyPlanParentId: currentMetadata.weeklyPlanParentId,
      weeklyPlanVersionId: currentMetadata.weeklyPlanVersionId,
    };

    const nextDraft = overrideDraft || programDraftRef.current;
    const payload = mapProgramDraftToWeeklyPlanUpdate(nextDraft);
    const signature = JSON.stringify(payload);

    if (signature === currentMetadata.lastPersistedSignature) {
      return null;
    }

    if (saveInFlightPromiseRef.current) {
      pendingSaveRequestedRef.current = true;
      return saveInFlightPromiseRef.current;
    }

    const requestId = saveRequestIdRef.current + 1;
    saveRequestIdRef.current = requestId;

    setDraftMetadata((prev) => (
      prev.saveState === "saving" ? prev : { ...prev, saveState: "saving" }
    ));

    const isStillCurrentTarget = () => sameIdentity(targetIdentityRef.current, identity);

    const runSave = async () => {
      if (!isStillCurrentTarget()) {
        // The user has navigated away from this document since this save was
        // scheduled (or since it was sent). Sending stale content to a
        // document that's no longer the active target would corrupt whatever
        // the user is now looking at, so drop it instead.
        return null;
      }

      const response = await updateWeeklyPlanDraft(
        identity.weeklyPlanParentId,
        identity.weeklyPlanVersionId,
        { ...payload, revision: currentMetadata.revision }
      );

      if (!isStillCurrentTarget()) {
        return response;
      }

      const currentSignature = JSON.stringify(
        mapProgramDraftToWeeklyPlanUpdate(programDraftRef.current)
      );
      const hasNewerLocalEdits = currentSignature !== signature;
      const isOlderThanAppliedResponse = requestId < latestAppliedSaveRequestIdRef.current;

      if (hasNewerLocalEdits || isOlderThanAppliedResponse) {
        setDraftMetadata((prev) => {
          const latestLocalSignature = JSON.stringify(
            mapProgramDraftToWeeklyPlanUpdate(programDraftRef.current)
          );
          const hasUnsavedLocalEdits = latestLocalSignature !== prev.lastPersistedSignature;

          if (!hasUnsavedLocalEdits) {
            return prev;
          }

          const hasNewerSaveRequestInFlight = requestId < saveRequestIdRef.current;
          const nextSaveState = hasNewerSaveRequestInFlight ? "saving" : "dirty";

          return prev.saveState === nextSaveState
            ? prev
            : { ...prev, saveState: nextSaveState };
        });

        return response;
      }

      latestAppliedSaveRequestIdRef.current = requestId;

      const updatedSignature = JSON.stringify(
        mapProgramDraftToWeeklyPlanUpdate(response.builderPayload)
      );

      setDraftMetadata((prev) => ({
        ...prev,
        lastSavedAt: response.updatedAt || new Date().toISOString(),
        saveState: "saved",
        lastPersistedSignature: updatedSignature,
        revision: response.revision ?? prev.revision,
      }));

      return response;
    };

    const savePromise = (async () => {
      let saveError = null;
      let result = null;

      try {
        result = await runSave();
      } catch (error) {
        saveError = error;

        if (error?.code === "DRAFT_REVISION_CONFLICT") {
          handleRevisionConflict(error);
        } else {
          setDraftMetadata((prev) => (
            prev.saveState === "error" ? prev : { ...prev, saveState: "error" }
          ));
        }
      } finally {
        saveInFlightPromiseRef.current = null;
      }

      let followUpPromise = null;

      if (pendingSaveRequestedRef.current) {
        pendingSaveRequestedRef.current = false;
        const latestDraft = programDraftRef.current;
        const latestMetadata = draftMetadataRef.current;
        const latestSignature = JSON.stringify(
          mapProgramDraftToWeeklyPlanUpdate(latestDraft)
        );

        if (
          latestMetadata.saveState !== "conflict" &&
          latestSignature !== latestMetadata.lastPersistedSignature
        ) {
          // Award the coalesced follow-up the freshest snapshot, and chain it
          // onto this promise so a single `await persistDraftNow()` (e.g. a
          // future publish flush) resolves only once the follow-up also
          // settles, not just this leg.
          followUpPromise = persistDraftNow(latestDraft);
        }
      }

      if (followUpPromise) {
        return followUpPromise;
      }

      if (saveError) {
        throw saveError;
      }

      return result;
    })();

    saveInFlightPromiseRef.current = savePromise;
    return savePromise;
  }, [handleRevisionConflict]);

  useEffect(() => {
    if (
      !draftMetadata.loadedFromBackend ||
      !draftMetadata.weeklyPlanParentId ||
      !draftMetadata.weeklyPlanVersionId ||
      draftMetadataRef.current.saveState === "conflict"
    ) {
      // While conflicted, autosave is suspended entirely -- retrying with
      // the same known-stale revision would just conflict again. The user
      // keeps editing normally (programDraft still updates); this effect
      // just never re-arms until reloadLatestAfterConflict() resolves it.
      // Reads the ref (not a `saveState` dependency) deliberately: adding
      // `saveState` to this effect's own deps would make it re-run on every
      // saveState transition it's responsible for causing -- including
      // "saving" -> "error" -- and its own dirty-fallback below would then
      // immediately stomp that error state back to "dirty".
      return undefined;
    }

    const signature = JSON.stringify(mapProgramDraftToWeeklyPlanUpdate(programDraft));

    if (signature === draftMetadata.lastPersistedSignature) {
      return undefined;
    }

    setDraftMetadata((prev) => ({
      ...prev,
      saveState: prev.saveState === "saving" ? "saving" : "dirty",
    }));

    // Capture the draft content and the identity it belongs to together, at
    // the moment this edit armed the timer -- not read fresh from a ref when
    // the timer fires. `persistDraftNow` revalidates this identity against
    // `targetIdentityRef.current` right before sending, which is what
    // actually protects against a stale send after the user has navigated
    // away within the debounce window.
    const draftSnapshot = programDraft;
    const identitySnapshot = {
      weeklyPlanParentId: draftMetadata.weeklyPlanParentId,
      weeklyPlanVersionId: draftMetadata.weeklyPlanVersionId,
    };

    const timeoutId = window.setTimeout(() => {
      persistDraftNow(draftSnapshot, identitySnapshot).catch(() => {});
    }, 700);

    return () => window.clearTimeout(timeoutId);
  }, [
    draftMetadata.lastPersistedSignature,
    draftMetadata.loadedFromBackend,
    draftMetadata.weeklyPlanParentId,
    draftMetadata.weeklyPlanVersionId,
    persistDraftNow,
    programDraft,
  ]);

  const updateSupersetSetCount = useCallback((workoutId, blockId, nextCount) => {
    const safeCount = clampNumber(nextCount || 1, 1, MAX_BLOCK_SET_COUNT);

    setProgramDraft((prev) => ({
      ...prev,
      workouts: prev.workouts.map((workout) => {
        if (workout.id !== workoutId) {
          return workout;
        }

        return {
          ...workout,
          blocks: workout.blocks.map((block) => {
            if (block.id !== blockId || block.type !== "superset") {
              return block;
            }

            if (Number(block.sets || 1) === safeCount) {
              return block;
            }

            return normalizeSupersetBlock({
              ...block,
              sets: safeCount,
              editIntent: { ...(block.editIntent || {}), roundCount: true },
            });
          }),
        };
      }),
    }));
  }, []);

  const createProgramDraft = useCallback((payload = {}) => {
    const nextProgramName = String(payload.programName || "").trim();

    if (!nextProgramName) {
      return;
    }

    const sessions = Math.max(1, Math.min(7, payload.sessionsPerWeek ?? 4));

    setProgramDraft({
      programName: nextProgramName,
      sessionsPerWeek: sessions,
      programLength: payload.programLength ?? 8,
      startDate: payload.startDate ?? null,
      endDate: payload.endDate ?? null,
      isMultiWeek: payload.isMultiWeek ?? false,
      selectedWeek: payload.selectedWeek ?? 1,
      workouts: [],
    });
    setDraftMetadata(createInitialDraftMetadata());
    loadedIdentityRef.current = null;
    targetIdentityRef.current = null;
  }, []);

  const updateProgramMeta = useCallback((updates = {}) => {
    setProgramDraft((prev) => ({ ...prev, ...updates }));
  }, []);

  const updateSessionsPerWeek = useCallback((nextValue) => {
    setProgramDraft((prev) => {
      const safeValue = clampNumber(Number(nextValue) || 1, 1, 7);

      if (safeValue < prev.workouts.length) {
        return prev;
      }

      return {
        ...prev,
        sessionsPerWeek: safeValue,
      };
    });
  }, []);

  const addWorkout = useCallback((name) => {
    setProgramDraft((prev) => {
      if (prev.workouts.length >= prev.sessionsPerWeek) {
        return prev;
      }

      const nextIndex = prev.workouts.length + 1;
      const workoutName = name || `Workout ${nextIndex}`;
      return {
        ...prev,
        workouts: [...prev.workouts, createWorkout(workoutName, false)],
      };
    });
  }, []);

  const updateWorkoutName = useCallback((workoutId, name) => {
    setProgramDraft((prev) => ({
      ...prev,
      workouts: prev.workouts.map((workout) =>
        workout.id === workoutId ? { ...workout, name } : workout
      ),
    }));
  }, []);

  const appendSingleBlockFromExercise = useCallback((workoutId, exercise) => {
    if (!exercise?.exerciseId || !exercise?.name) {
      return;
    }

    const block =
      String(exercise.trainingType || "").toLowerCase() === "cardio"
        ? createCardioBlockFromExercise(exercise)
        : createSingleBlockFromExercise(exercise);

    setProgramDraft((prev) => ({
      ...prev,
      workouts: prev.workouts.map((workout) =>
        workout.id === workoutId
          ? {
              ...workout,
              blocks: [...workout.blocks, block],
            }
          : workout
      ),
    }));
  }, []);

  const convertSingleBlockToSuperset = useCallback((workoutId, blockId) => {
    setProgramDraft((prev) => ({
      ...prev,
      workouts: prev.workouts.map((workout) => {
        if (workout.id !== workoutId) {
          return workout;
        }

        return {
          ...workout,
          blocks: workout.blocks.map((block) => {
            if (block.id !== blockId || block.type !== "single") {
              return block;
            }

            return {
              id: block.id,
              uiKey: block.uiKey || createBlockUiKey(),
              type: "superset",
              sets: Math.max(1, block.sets.length || 1),
              rest: block.rest,
              persistence: block.persistence,
              editIntent: { ...(block.editIntent || {}), roundCount: true },
              exercises: [
                {
                  id: block.exerciseRowId,
                  label: "A1",
                  name: block.exercise,
                  exerciseId: block.exerciseId ?? null,
                  bodyParts: Array.isArray(block.bodyParts) ? block.bodyParts : [],
                  muscleFocus: Array.isArray(block.muscleFocus) ? block.muscleFocus : [],
                  tempo: block.tempo,
                  sets: block.sets,
                  notes: block.notes,
                  persistence: block.exercisePersistence,
                },
                createEmptySupersetExercise("A2", Math.max(1, block.sets.length || 1)),
              ],
            };
          }),
        };
      }),
    }));
  }, []);

  const assignSupersetExercise = useCallback((workoutId, blockId, exerciseIndex, exercise) => {
    if (!exercise?.exerciseId || !exercise?.name) {
      return;
    }

    setProgramDraft((prev) => ({
      ...prev,
      workouts: prev.workouts.map((workout) => {
        if (workout.id !== workoutId) {
          return workout;
        }

        return {
          ...workout,
          blocks: workout.blocks.map((block) => {
            if (block.id !== blockId || block.type !== "superset") {
              return block;
            }

            return {
              ...block,
              exercises: block.exercises.map((entry, index) =>
                index === exerciseIndex
                  ? {
                      ...entry,
                      name: exercise.name,
                      exerciseId: exercise.exerciseId,
                      bodyParts: Array.isArray(exercise.bodyParts) ? exercise.bodyParts : [],
                      muscleFocus: Array.isArray(exercise.muscleFocus)
                        ? exercise.muscleFocus
                        : [],
                    }
                  : entry
              ),
            };
          }),
        };
      }),
    }));
  }, []);

  const addBlock = useCallback((workoutId, type = "single") => {
    const block = type === "superset" ? createDefaultSupersetBlock() : createDefaultSingleBlock();

    setProgramDraft((prev) => ({
      ...prev,
      workouts: prev.workouts.map((workout) =>
        workout.id === workoutId
          ? { ...workout, blocks: [...workout.blocks, block] }
          : workout
      ),
    }));
  }, []);

  const removeBlock = useCallback((workoutId, blockId) => {
    setProgramDraft((prev) => ({
      ...prev,
      workouts: prev.workouts.map((workout) =>
        workout.id === workoutId
          ? {
              ...workout,
              blocks: workout.blocks.filter((block) => block.id !== blockId),
            }
          : workout
      ),
    }));
  }, []);

  const addSet = useCallback((workoutId, blockId, exerciseIndex = null) => {
    setProgramDraft((prev) => ({
      ...prev,
      workouts: prev.workouts.map((workout) => {
        if (workout.id !== workoutId) {
          return workout;
        }

        return {
          ...workout,
          blocks: workout.blocks.map((block) => {
            if (block.id !== blockId) {
              return block;
            }

            if (block.type === "single") {
              if (block.sets.length >= MAX_BLOCK_SET_COUNT) {
                return block;
              }

              return {
                ...block,
                sets: [...block.sets, createSingleSetRow()],
              };
            }

            if ((block.sets || 1) >= MAX_BLOCK_SET_COUNT) {
              return block;
            }

            return normalizeSupersetBlock({
              ...block,
              sets: (block.sets || 1) + 1,
              editIntent: { ...(block.editIntent || {}), roundCount: true },
            });
          }),
        };
      }),
    }));
  }, []);

  const removeSet = useCallback((workoutId, blockId, setIndex, exerciseIndex = null) => {
    setProgramDraft((prev) => ({
      ...prev,
      workouts: prev.workouts.map((workout) => {
        if (workout.id !== workoutId) {
          return workout;
        }

        return {
          ...workout,
          blocks: workout.blocks.map((block) => {
            if (block.id !== blockId) {
              return block;
            }

            if (block.type === "single") {
              if (block.sets.length <= 1) {
                return block;
              }

              return {
                ...block,
                sets: block.sets.filter((_, index) => index !== setIndex),
              };
            }

            if ((block.sets || 1) <= 1) {
              return block;
            }

            return normalizeSupersetBlock({
              ...block,
              sets: (block.sets || 1) - 1,
              editIntent: { ...(block.editIntent || {}), roundCount: true },
            });
          }),
        };
      }),
    }));
  }, []);

  const updateSet = useCallback(
    (workoutId, blockId, setIndex, updates, exerciseIndex = null) => {
      const normalizedUpdates = normalizeSetUpdates(updates);

      setProgramDraft((prev) => ({
        ...prev,
        workouts: prev.workouts.map((workout) => {
          if (workout.id !== workoutId) {
            return workout;
          }

          return {
            ...workout,
            blocks: workout.blocks.map((block) => {
              if (block.id !== blockId) {
                return block;
              }

              if (block.type === "single") {
                return {
                  ...block,
                  sets: block.sets.map((set, index) =>
                    index === setIndex
                      ? applySetUpdatesWithIntent(set, normalizedUpdates)
                      : set
                  ),
                };
              }

              if (typeof exerciseIndex !== "number" || !block.exercises[exerciseIndex]) {
                return block;
              }

              const nextExercises = block.exercises.map((exercise, index) => {
                if (index !== exerciseIndex) {
                  return exercise;
                }

                return {
                  ...exercise,
                  sets: exercise.sets.map((set, idx) =>
                    idx === setIndex
                      ? applySetUpdatesWithIntent(set, normalizedUpdates)
                      : set
                  ),
                };
              });

              return normalizeSupersetBlock({ ...block, exercises: nextExercises });
            }),
          };
        }),
      }));
    },
    []
  );

  const moveWorkouts = useCallback((workoutIds, direction) => {
    const selectedIds = Array.isArray(workoutIds)
      ? workoutIds.filter(Boolean)
      : [];

    if (!selectedIds.length || !["up", "down"].includes(direction)) {
      return;
    }

    setProgramDraft((prev) => {
      if (!canMoveSelectedWorkouts(prev.workouts, selectedIds, direction)) {
        return prev;
      }

      const selectedIdSet = new Set(selectedIds);
      const nextWorkouts = [...prev.workouts];

      if (direction === "up") {
        for (let index = 1; index < nextWorkouts.length; index += 1) {
          if (
            selectedIdSet.has(nextWorkouts[index].id) &&
            !selectedIdSet.has(nextWorkouts[index - 1].id)
          ) {
            [nextWorkouts[index - 1], nextWorkouts[index]] = [
              nextWorkouts[index],
              nextWorkouts[index - 1],
            ];
          }
        }
      } else {
        for (let index = nextWorkouts.length - 2; index >= 0; index -= 1) {
          if (
            selectedIdSet.has(nextWorkouts[index].id) &&
            !selectedIdSet.has(nextWorkouts[index + 1].id)
          ) {
            [nextWorkouts[index], nextWorkouts[index + 1]] = [
              nextWorkouts[index + 1],
              nextWorkouts[index],
            ];
          }
        }
      }

      return {
        ...prev,
        workouts: nextWorkouts,
      };
    });
  }, []);

  const duplicateWorkouts = useCallback((workoutIds) => {
    const selectedIds = Array.isArray(workoutIds)
      ? workoutIds.filter(Boolean)
      : [];

    if (!selectedIds.length) {
      return;
    }

    setProgramDraft((prev) => {
      if (prev.workouts.length + selectedIds.length > prev.sessionsPerWeek) {
        return prev;
      }

      const selectedIdSet = new Set(selectedIds);
      const nextWorkouts = [];
      const existingWorkoutNames = prev.workouts.map((workout) => workout.name);

      prev.workouts.forEach((workout) => {
        nextWorkouts.push(workout);

        if (selectedIdSet.has(workout.id)) {
          const duplicateName = getDuplicateWorkoutName(workout.name, existingWorkoutNames);
          existingWorkoutNames.push(duplicateName);
          nextWorkouts.push(cloneWorkoutForDuplicate(workout, duplicateName));
        }
      });

      return {
        ...prev,
        workouts: nextWorkouts,
      };
    });
  }, []);

  const removeWorkouts = useCallback((workoutIds) => {
    const selectedIds = Array.isArray(workoutIds)
      ? workoutIds.filter(Boolean)
      : [];

    if (!selectedIds.length) {
      return;
    }

    setProgramDraft((prev) => {
      const selectedIdSet = new Set(selectedIds);

      return {
        ...prev,
        workouts: prev.workouts.filter((workout) => !selectedIdSet.has(workout.id)),
      };
    });
  }, []);

  const resetProgramDraft = useCallback(() => {
    setProgramDraft(createInitialDraft());
    setDraftMetadata(createInitialDraftMetadata());
    loadedIdentityRef.current = null;
    targetIdentityRef.current = null;
  }, []);

  // The only way targetIdentityRef is ever set ahead of a fetch dispatching.
  // Callers that are about to open a (possibly different) weekly plan must
  // call this synchronously, before starting the fetch -- weeklyPlanVersionId
  // is left null since it isn't resolved until openOrCreateWeeklyPlanEditDraft
  // returns. hydrateProgramDraft compares an arriving response's
  // weeklyPlanParentId against whatever was most recently declared here; a
  // response for a parent id a newer call here has since superseded is
  // dropped rather than applied.
  const beginHydrationTarget = useCallback((identity) => {
    targetIdentityRef.current = identity;
  }, []);

  const hydrateProgramDraft = useCallback((response, options = {}) => {
    const nextState = mapBuilderPayloadToProgramDraft(response);
    const responseIdentity = {
      weeklyPlanParentId: nextState.metadata.weeklyPlanParentId,
      weeklyPlanVersionId: nextState.metadata.weeklyPlanVersionId,
    };

    if (!options.force) {
      const declaredTarget = targetIdentityRef.current;
      const isStaleAgainstDeclaredTarget =
        declaredTarget != null && !sameRequestedWeeklyPlan(declaredTarget, responseIdentity);

      if (isStaleAgainstDeclaredTarget) {
        // A newer beginHydrationTarget() call has already superseded this
        // fetch's target since it was dispatched -- this response is for a
        // weekly plan the user is no longer requesting. Drop it entirely (no
        // partial apply), regardless of what loadedIdentityRef says.
        return;
      }

      const isSameDocumentAlreadyLoaded = sameIdentity(
        loadedIdentityRef.current,
        responseIdentity
      );

      if (isSameDocumentAlreadyLoaded) {
        const currentSaveState = draftMetadataRef.current.saveState;

        if (
          currentSaveState === "dirty" ||
          currentSaveState === "saving" ||
          currentSaveState === "conflict"
        ) {
          // Local edits, an in-flight/queued save, or an unresolved conflict
          // for this exact document all take priority over a redundant
          // "open draft" response -- applying it here would silently revert
          // whatever the user is mid-editing, or silently resolve a
          // conflict without the user's explicit confirmation.
          return;
        }
      }
    }

    setProgramDraft((prev) => ({
      ...nextState.programDraft,
      workouts: attachUiKeysToWorkouts(
        nextState.programDraft.workouts || [],
        prev.workouts || []
      ),
    }));
    setDraftMetadata({
      ...createInitialDraftMetadata(),
      ...nextState.metadata,
      originRoute: options.originRoute ?? null,
    });
    loadedIdentityRef.current = responseIdentity;
    // A response that was just applied (whether it passed the checks above
    // or arrived via force:true) is, by definition, now what the user is
    // looking at -- keep the target in sync so later callers (the send-side
    // check in persistDraftNow, and the next hydrateProgramDraft call) see a
    // fully-resolved identity rather than the pre-dispatch partial one.
    targetIdentityRef.current = responseIdentity;
  }, []);

  // The only path back from `saveState === "conflict"`. Explicitly
  // destructive -- discards every unsaved local edit made since the
  // conflict was detected -- so the calling UI must show an explicit
  // confirmation step before invoking this, not call it as a direct,
  // unconfirmed side effect of a single click.
  const reloadLatestAfterConflict = useCallback(async () => {
    const currentMetadata = draftMetadataRef.current;

    if (currentMetadata.saveState !== "conflict" || !currentMetadata.weeklyPlanParentId) {
      return null;
    }

    try {
      const response = await openOrCreateWeeklyPlanEditDraft(currentMetadata.weeklyPlanParentId);
      // Explicit, user-confirmed discard-and-reload -- force past the
      // local-authority guard the same way DRAFT_EXPIRED recovery does for
      // the cycle builder.
      hydrateProgramDraft(response, { force: true });
      return response;
    } catch (reloadError) {
      setDraftMetadata((prev) => ({
        ...prev,
        saveState: "error",
        lastSaveErrorMessage: reloadError?.message || "Unable to reload draft. Please refresh the page.",
        lastSaveErrorCode: reloadError?.code || null,
      }));
      return null;
    }
  }, [hydrateProgramDraft]);

  const setDraftOriginRoute = useCallback((originRoute) => {
    setDraftMetadata((prev) => ({
      ...prev,
      originRoute: originRoute ?? null,
    }));
  }, []);

  const updateDraftMetadata = useCallback((updates = {}) => {
    setDraftMetadata((prev) => ({ ...prev, ...updates }));
  }, []);

  const updateBlock = useCallback((workoutId, blockId, updates) => {
    setProgramDraft((prev) => ({
      ...prev,
      workouts: prev.workouts.map((workout) =>
        workout.id === workoutId
          ? {
              ...workout,
              blocks: workout.blocks.map((block) =>
                block.id === blockId
                  ? applyBlockUpdatesWithIntent(block, updates)
                  : block
              ),
            }
          : workout
      ),
    }));
  }, []);

  const reorderBlocks = useCallback((workoutId, fromIndex, toIndex) => {
    setProgramDraft((prev) => ({
      ...prev,
      workouts: prev.workouts.map((workout) => {
        if (workout.id !== workoutId) {
          return workout;
        }

        const nextBlocks = moveArrayItem(
          workout.blocks || [],
          Number(fromIndex),
          Number(toIndex)
        );

        if (nextBlocks === workout.blocks) {
          return workout;
        }

        return {
          ...workout,
          blocks: nextBlocks,
        };
      }),
    }));
  }, []);

  const updateSupersetExercise = useCallback(
    (workoutId, blockId, exerciseIndex, updates) => {
      setProgramDraft((prev) => ({
        ...prev,
        workouts: prev.workouts.map((workout) => {
          if (workout.id !== workoutId) {
            return workout;
          }

          return {
            ...workout,
            blocks: workout.blocks.map((block) => {
              if (block.id !== blockId || block.type !== "superset") {
                return block;
              }

              return normalizeSupersetBlock({
                ...block,
                exercises: block.exercises.map((exercise, index) =>
                  index === exerciseIndex
                    ? applyExerciseUpdatesWithIntent(exercise, updates)
                    : exercise
                ),
              });
            }),
          };
        }),
      }));
    },
    []
  );

  const hasIncompleteSupersets = useCallback(
    (workoutId = null) => {
      return programDraft.workouts.some((workout) => {
        if (workoutId && workout.id !== workoutId) {
          return false;
        }

        return workout.blocks.some(
          (block) =>
            block.type === "superset" &&
            block.exercises.some((exercise) => !String(exercise.exerciseId || "").trim())
        );
      });
    },
    [programDraft.workouts]
  );

  const toggleMultiWeek = useCallback((value) => {
    setProgramDraft((prev) => ({
      ...prev,
      isMultiWeek: typeof value === "boolean" ? value : !prev.isMultiWeek,
    }));
  }, []);

  const setSelectedWeek = useCallback((week) => {
    setProgramDraft((prev) => ({ ...prev, selectedWeek: week }));
  }, []);

  const value = useMemo(
    () => ({
      programDraft,
      createProgramDraft,
      updateProgramMeta,
      updateSessionsPerWeek,
      resetProgramDraft,
      addWorkout,
      updateWorkoutName,
      appendSingleBlockFromExercise,
      convertSingleBlockToSuperset,
      assignSupersetExercise,
      addBlock,
      removeBlock,
      addSet,
      removeSet,
      moveWorkouts,
      duplicateWorkouts,
      removeWorkouts,
      updateSupersetSetCount,
      updateSet,
      toggleMultiWeek,
      setSelectedWeek,
      updateBlock,
      reorderBlocks,
      updateSupersetExercise,
      hasIncompleteSupersets,
      draftMetadata,
      hydrateProgramDraft,
      beginHydrationTarget,
      persistDraftNow,
      reloadLatestAfterConflict,
      setDraftOriginRoute,
      updateDraftMetadata,
    }),
    [
      programDraft,
      createProgramDraft,
      updateProgramMeta,
      updateSessionsPerWeek,
      resetProgramDraft,
      addWorkout,
      updateWorkoutName,
      appendSingleBlockFromExercise,
      convertSingleBlockToSuperset,
      assignSupersetExercise,
      addBlock,
      removeBlock,
      addSet,
      removeSet,
      moveWorkouts,
      duplicateWorkouts,
      removeWorkouts,
      updateSupersetSetCount,
      updateSet,
      toggleMultiWeek,
      setSelectedWeek,
      updateBlock,
      reorderBlocks,
      updateSupersetExercise,
      hasIncompleteSupersets,
      draftMetadata,
      hydrateProgramDraft,
      beginHydrationTarget,
      persistDraftNow,
      reloadLatestAfterConflict,
      setDraftOriginRoute,
      updateDraftMetadata,
    ]
  );

  return (
    <ManualProgramContext.Provider value={value}>
      {children}
    </ManualProgramContext.Provider>
  );
}

export function useManualProgram() {
  const context = useContext(ManualProgramContext);

  if (!context) {
    throw new Error("useManualProgram must be used within ManualProgramProvider");
  }

  return context;
}
