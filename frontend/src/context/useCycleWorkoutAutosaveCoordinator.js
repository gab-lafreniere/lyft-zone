import { useCallback, useEffect, useRef, useState } from "react";
import { mapCycleWorkoutToApi } from "../features/multiWeek/mappers";
import { saveCycleWorkoutContent } from "../services/api";
import { attachBlockUiKeys } from "../utils/blockUiKeys";

export const MAX_CONCURRENT_WORKOUT_SAVES = 4;
const WORKOUT_AUTOSAVE_DEBOUNCE_MS = 700;

function isValidRevision(value) {
  return Number.isInteger(value) && value > 0;
}

function serializeSnapshot(workout, workoutIndex) {
  return mapCycleWorkoutToApi(workout, workoutIndex);
}

function snapshotsEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function getWorkoutEntries(draft) {
  const entries = [];

  (draft?.weeks || []).forEach((week, weekIndex) => {
    (week.workouts || []).forEach((workout, workoutIndex) => {
      if (workout?.id) {
        entries.push({ weekIndex, workoutIndex, workout });
      }
    });
  });

  return entries;
}

function findWorkoutEntry(draft, workoutId) {
  return getWorkoutEntries(draft).find(({ workout }) => workout.id === workoutId) || null;
}

function replaceWorkout(draft, workoutId, nextWorkout) {
  let didReplace = false;
  const weeks = (draft?.weeks || []).map((week) => {
    const workouts = (week.workouts || []).map((workout) => {
      if (workout.id !== workoutId) {
        return workout;
      }

      didReplace = true;
      return nextWorkout;
    });

    return workouts === week.workouts
      ? week
      : { ...week, workouts };
  });

  return didReplace ? { ...draft, weeks } : draft;
}

function getCanonicalExercises(block) {
  if (block?.type === "superset") {
    return block.exercises || [];
  }

  if (block?.type === "single" || block?.type === "cardio") {
    return [{
      id: block.exerciseRowId || block.exercisePersistence?.id,
      persistence: block.exercisePersistence,
      sets: block.sets || [],
    }];
  }

  return [];
}

function reconcileSetIdentities(currentSets, sentSets, canonicalSets) {
  const canonicalBySentId = new Map();

  sentSets.forEach((sentSet, index) => {
    if (sentSet?.id && canonicalSets[index]) {
      canonicalBySentId.set(sentSet.id, canonicalSets[index]);
    }
  });

  return (currentSets || []).map((set) => {
    const canonical = canonicalBySentId.get(set?.id);
    if (!canonical) {
      return set;
    }

    return {
      ...set,
      id: canonical.id,
      persistence: canonical.persistence || set.persistence,
    };
  });
}

function reconcileExerciseIdentities(currentExercises, sentExercises, canonicalExercises) {
  const canonicalBySentId = new Map();

  sentExercises.forEach((sentExercise, index) => {
    if (sentExercise?.id && canonicalExercises[index]) {
      canonicalBySentId.set(sentExercise.id, {
        canonical: canonicalExercises[index],
        sent: sentExercise,
      });
    }
  });

  return (currentExercises || []).map((exercise) => {
    const match = canonicalBySentId.get(exercise?.id);
    if (!match) {
      return exercise;
    }

    return {
      ...exercise,
      id: match.canonical.id,
      persistence: match.canonical.persistence || exercise.persistence,
      sets: reconcileSetIdentities(
        exercise.sets || [],
        match.sent.setTemplates || [],
        match.canonical.sets || []
      ),
    };
  });
}

// Identity correlation is performed between the exact sent tree and its
// canonical response. Current local rows are then found by their stable
// client/persisted id, so a concurrent local reorder cannot misassociate ids.
export function reconcileCanonicalWorkoutIdentities(
  currentWorkout,
  sentSnapshot,
  canonicalWorkout
) {
  const canonicalBySentBlockId = new Map();

  (sentSnapshot?.blocks || []).forEach((sentBlock, index) => {
    const canonicalBlock = canonicalWorkout?.blocks?.[index];
    if (sentBlock?.id && canonicalBlock) {
      canonicalBySentBlockId.set(sentBlock.id, { canonicalBlock, sentBlock });
    }
  });

  const blocks = (currentWorkout?.blocks || []).map((block) => {
    const match = canonicalBySentBlockId.get(block.id);
    if (!match) {
      return block;
    }

    const sentExercises = match.sentBlock.exercises || [];
    const canonicalExercises = getCanonicalExercises(match.canonicalBlock);
    const nextBlock = {
      ...block,
      id: match.canonicalBlock.id,
      persistence: match.canonicalBlock.persistence || block.persistence,
    };

    if (block.type === "superset") {
      nextBlock.exercises = reconcileExerciseIdentities(
        block.exercises || [],
        sentExercises,
        canonicalExercises
      );
    } else if (block.type === "single" || block.type === "cardio") {
      const sentExercise = sentExercises[0];
      const canonicalExercise = canonicalExercises[0];
      const currentExerciseId = block.exerciseRowId || block.exercisePersistence?.id;

      if (sentExercise?.id && sentExercise.id === currentExerciseId && canonicalExercise) {
        nextBlock.exerciseRowId = canonicalExercise.id;
        nextBlock.exercisePersistence =
          canonicalExercise.persistence || block.exercisePersistence;

        if (block.type === "single") {
          nextBlock.sets = reconcileSetIdentities(
            block.sets || [],
            sentExercise.setTemplates || [],
            canonicalExercise.sets || []
          );
        }
      }
    }

    return nextBlock;
  });

  return {
    ...currentWorkout,
    persistence: canonicalWorkout?.persistence || currentWorkout.persistence,
    blocks,
  };
}

function createInitialWorkoutState(workout, workoutIndex, options = {}) {
  const contentRevision = workout?.contentRevision;
  const validRevision = isValidRevision(contentRevision);
  const pendingStructuralSave =
    options.createdLocallyPendingStructuralSave || false;

  return {
    status: pendingStructuralSave ? "dirty" : validRevision ? "clean" : "error",
    contentRevision: validRevision ? contentRevision : null,
    lastSyncedSnapshot: validRevision
      ? serializeSnapshot(workout, workoutIndex)
      : null,
    inFlightSnapshot: null,
    pendingFollowUp: false,
    lastError: validRevision || pendingStructuralSave
      ? null
      : {
        code: "MISSING_WORKOUT_CONTENT_REVISION",
        message: "This workout is missing its persisted content revision.",
      },
    createdLocallyPendingStructuralSave: pendingStructuralSave,
  };
}

function publicWorkoutState(entry) {
  if (!entry) {
    return null;
  }

  const {
    inFlightPromise,
    queuedForSlot,
    ...publicState
  } = entry;
  return publicState;
}

export function useCycleWorkoutAutosaveCoordinator({
  enabled,
  multiWeekDraft,
  setMultiWeekDraft,
  draftMetadata,
  setDraftMetadata,
  documentMetadataRef,
  structuralMutationVersion,
  handleDraftExpired,
}) {
  const draftRef = useRef(multiWeekDraft);
  const metadataRef = useRef(draftMetadata);
  const baselineRef = useRef(new Map());
  const stateRef = useRef(new Map());
  const timerRef = useRef(new Map());
  const generationRef = useRef(0);
  const lastStructuralMutationVersionRef = useRef(structuralMutationVersion);
  const activeSaveCountRef = useRef(0);
  const slotQueueRef = useRef([]);
  const [workoutSaveState, setWorkoutSaveState] = useState(() => new Map());

  useEffect(() => {
    draftRef.current = multiWeekDraft;
  }, [multiWeekDraft]);

  useEffect(() => {
    metadataRef.current = draftMetadata;
  }, [draftMetadata]);

  const publishState = useCallback(() => {
    setWorkoutSaveState(new Map(
      Array.from(stateRef.current, ([workoutId, entry]) => [
        workoutId,
        publicWorkoutState(entry),
      ])
    ));
  }, []);

  const clearWorkoutTimer = useCallback((workoutId) => {
    const timer = timerRef.current.get(workoutId);
    if (timer != null) {
      window.clearTimeout(timer);
      timerRef.current.delete(workoutId);
    }
  }, []);

  const setWorkoutEntry = useCallback((workoutId, updater) => {
    const current = stateRef.current.get(workoutId) || null;
    const next = typeof updater === "function" ? updater(current) : updater;

    if (next == null) {
      stateRef.current.delete(workoutId);
    } else {
      stateRef.current.set(workoutId, next);
    }
    publishState();
    return next;
  }, [publishState]);

  const rebaseWorkoutDirtyDetectionBaseline = useCallback((draft, options = {}) => {
    const entries = getWorkoutEntries(draft);
    baselineRef.current = new Map(
      entries.map(({ workout, workoutIndex }) => [
        workout.id,
        { workoutRef: workout, workoutIndex },
      ])
    );

    if (options.resetState) {
      generationRef.current += 1;
      timerRef.current.forEach((timer) => window.clearTimeout(timer));
      timerRef.current.clear();
      stateRef.current = new Map(
        entries.map(({ workout, workoutIndex }) => [
          workout.id,
          createInitialWorkoutState(workout, workoutIndex),
        ])
      );
      publishState();
    }
  }, [publishState]);

  const rebaseOneWorkout = useCallback((draft, workoutId) => {
    const entry = findWorkoutEntry(draft, workoutId);
    if (!entry) {
      baselineRef.current.delete(workoutId);
      return;
    }

    baselineRef.current.set(workoutId, {
      workoutRef: entry.workout,
      workoutIndex: entry.workoutIndex,
    });
  }, []);

  const rebaseStructuralMutation = useCallback((draft) => {
    const entries = getWorkoutEntries(draft);
    const nextIds = new Set(entries.map(({ workout }) => workout.id));

    timerRef.current.forEach((timer, workoutId) => {
      if (!nextIds.has(workoutId)) {
        window.clearTimeout(timer);
        timerRef.current.delete(workoutId);
        stateRef.current.delete(workoutId);
      }
    });

    entries.forEach(({ workout, workoutIndex }) => {
      if (!stateRef.current.has(workout.id)) {
        stateRef.current.set(workout.id, createInitialWorkoutState(workout, workoutIndex, {
          createdLocallyPendingStructuralSave: true,
        }));
      }
    });

    baselineRef.current = new Map(
      entries.map(({ workout, workoutIndex }) => [
        workout.id,
        { workoutRef: workout, workoutIndex },
      ])
    );
    publishState();
  }, [publishState]);

  const acquireSaveSlot = useCallback(() => {
    if (activeSaveCountRef.current < MAX_CONCURRENT_WORKOUT_SAVES) {
      activeSaveCountRef.current += 1;
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      slotQueueRef.current.push(resolve);
    });
  }, []);

  const releaseSaveSlot = useCallback(() => {
    const next = slotQueueRef.current.shift();
    if (next) {
      next();
      return;
    }
    activeSaveCountRef.current = Math.max(0, activeSaveCountRef.current - 1);
  }, []);

  const applyWorkoutResponse = useCallback((workoutId, sentSnapshot, response) => {
    const currentEntry = findWorkoutEntry(draftRef.current, workoutId);
    if (!currentEntry) {
      return { hasNewerLocalEdits: false, canonicalSnapshot: sentSnapshot };
    }

    const currentSnapshot = serializeSnapshot(
      currentEntry.workout,
      currentEntry.workoutIndex
    );
    const hasNewerLocalEdits = !snapshotsEqual(currentSnapshot, sentSnapshot);
    const canonicalWorkout = {
      ...response.workout,
      contentRevision: response.contentRevision,
    };
    const nextWorkout = hasNewerLocalEdits
      ? {
        ...reconcileCanonicalWorkoutIdentities(
          currentEntry.workout,
          sentSnapshot,
          canonicalWorkout
        ),
        contentRevision: response.contentRevision,
      }
      : {
        ...canonicalWorkout,
        blocks: attachBlockUiKeys(
          canonicalWorkout.blocks || [],
          currentEntry.workout.blocks || []
        ),
      };
    const nextDraft = replaceWorkout(draftRef.current, workoutId, nextWorkout);

    draftRef.current = nextDraft;
    rebaseOneWorkout(nextDraft, workoutId);
    setMultiWeekDraft(nextDraft);

    const canonicalSnapshot = serializeSnapshot(
      canonicalWorkout,
      currentEntry.workoutIndex
    );

    return { hasNewerLocalEdits, canonicalSnapshot };
  }, [rebaseOneWorkout, setMultiWeekDraft]);

  const persistWorkoutNow = useCallback(async function persistWorkout(
    workoutId,
    overrideWorkout = null
  ) {
    if (!enabled) {
      return null;
    }

    clearWorkoutTimer(workoutId);
    const existingState = stateRef.current.get(workoutId);
    if (!existingState) {
      return null;
    }

    if (
      existingState.status === "conflict" ||
      existingState.status === "error" ||
      existingState.createdLocallyPendingStructuralSave
    ) {
      return null;
    }

    if (existingState.inFlightPromise) {
      setWorkoutEntry(workoutId, (state) => ({
        ...state,
        pendingFollowUp: true,
      }));
      return existingState.inFlightPromise;
    }

    const requestGeneration = generationRef.current;
    const savePromise = (async () => {
      await acquireSaveSlot();

      let response = null;
      try {
        if (requestGeneration !== generationRef.current) {
          return null;
        }

        const metadata = metadataRef.current;
        const currentWorkoutEntry = overrideWorkout
          ? {
            workout: overrideWorkout,
            workoutIndex:
              findWorkoutEntry(draftRef.current, workoutId)?.workoutIndex ?? 0,
          }
          : findWorkoutEntry(draftRef.current, workoutId);
        const liveState = stateRef.current.get(workoutId);

        if (
          !metadata.loadedFromBackend ||
          !metadata.cycleId ||
          !metadata.cyclePlanId ||
          !currentWorkoutEntry ||
          !liveState ||
          !isValidRevision(liveState.contentRevision)
        ) {
          if (liveState && !isValidRevision(liveState.contentRevision)) {
            setWorkoutEntry(workoutId, (state) => ({
              ...state,
              status: "error",
              lastError: {
                code: "MISSING_WORKOUT_CONTENT_REVISION",
                message: "This workout is missing its persisted content revision.",
              },
            }));
          }
          return null;
        }

        const sentSnapshot = serializeSnapshot(
          currentWorkoutEntry.workout,
          currentWorkoutEntry.workoutIndex
        );

        setWorkoutEntry(workoutId, (state) => ({
          ...state,
          status: "saving",
          inFlightSnapshot: sentSnapshot,
          pendingFollowUp: false,
          lastError: null,
        }));

        response = await saveCycleWorkoutContent(
          metadata.cycleId,
          metadata.cyclePlanId,
          workoutId,
          {
            contentRevision: liveState.contentRevision,
            allowCrossDayDraft: metadata.allowCrossDayDraft,
            timezone: metadata.timezone,
            workout: sentSnapshot,
          }
        );

        if (requestGeneration !== generationRef.current) {
          return response;
        }

        const { hasNewerLocalEdits, canonicalSnapshot } = applyWorkoutResponse(
          workoutId,
          sentSnapshot,
          response
        );

        const nextPlanRevision = Math.max(
          Number(metadataRef.current?.revision) || 0,
          Number(documentMetadataRef?.current?.revision) || 0,
          Number(response.planRevision) || 0
        );
        const nextLastSavedAt =
          response.updatedAt || metadataRef.current?.lastSavedAt;

        metadataRef.current = {
          ...metadataRef.current,
          revision: nextPlanRevision,
          lastSavedAt: nextLastSavedAt,
        };
        if (documentMetadataRef) {
          documentMetadataRef.current = {
            ...documentMetadataRef.current,
            revision: nextPlanRevision,
            lastSavedAt: nextLastSavedAt,
          };
        }
        setDraftMetadata((prev) => ({
          ...prev,
          revision: Math.max(
            Number(prev.revision) || 0,
            nextPlanRevision
          ),
          lastSavedAt: nextLastSavedAt || prev.lastSavedAt,
        }));
        setWorkoutEntry(workoutId, (state) => ({
          ...state,
          status: hasNewerLocalEdits ? "dirty" : "clean",
          contentRevision: response.contentRevision,
          lastSyncedSnapshot: canonicalSnapshot,
          inFlightSnapshot: null,
          pendingFollowUp: hasNewerLocalEdits || state.pendingFollowUp,
          lastError: null,
        }));
      } catch (error) {
        if (requestGeneration !== generationRef.current) {
          return null;
        }

        if (error?.code === "WORKOUT_REVISION_CONFLICT") {
          setWorkoutEntry(workoutId, (state) => ({
            ...state,
            status: "conflict",
            inFlightSnapshot: null,
            pendingFollowUp: false,
            lastError: error,
          }));
        } else if (error?.code === "DRAFT_EXPIRED") {
          rebaseWorkoutDirtyDetectionBaseline(draftRef.current, { resetState: true });
          await handleDraftExpired(error, metadataRef.current?.cycleId || null);
        } else if (
          error?.code === "NOT_FOUND" &&
          !findWorkoutEntry(draftRef.current, workoutId)
        ) {
          setWorkoutEntry(workoutId, null);
        } else {
          setWorkoutEntry(workoutId, (state) => ({
            ...state,
            status: "error",
            inFlightSnapshot: null,
            pendingFollowUp: false,
            lastError: error,
          }));
        }
      } finally {
        releaseSaveSlot();
      }

      if (requestGeneration !== generationRef.current) {
        return response;
      }

      const settledState = stateRef.current.get(workoutId);
      if (
        settledState &&
        settledState.status !== "conflict" &&
        settledState.status !== "error" &&
        settledState.pendingFollowUp
      ) {
        setWorkoutEntry(workoutId, (state) => ({
          ...state,
          status: "dirty",
          inFlightPromise: null,
          pendingFollowUp: false,
        }));
        return persistWorkout(workoutId);
      }

      return response;
    })();

    setWorkoutEntry(workoutId, (state) => ({
      ...state,
      inFlightPromise: savePromise,
    }));

    try {
      return await savePromise;
    } finally {
      if (requestGeneration === generationRef.current) {
        setWorkoutEntry(workoutId, (state) => state
          ? { ...state, inFlightPromise: null }
          : null);
      }
    }
  }, [
    acquireSaveSlot,
    applyWorkoutResponse,
    clearWorkoutTimer,
    documentMetadataRef,
    enabled,
    handleDraftExpired,
    rebaseWorkoutDirtyDetectionBaseline,
    releaseSaveSlot,
    setDraftMetadata,
    setWorkoutEntry,
  ]);

  const scheduleAutosave = useCallback((workoutId) => {
    if (!enabled) {
      return;
    }

    const state = stateRef.current.get(workoutId);
    if (
      !state ||
      state.status === "conflict" ||
      state.status === "error" ||
      state.createdLocallyPendingStructuralSave
    ) {
      return;
    }

    if (state.inFlightPromise) {
      setWorkoutEntry(workoutId, (current) => ({
        ...current,
        pendingFollowUp: true,
      }));
      return;
    }

    clearWorkoutTimer(workoutId);
    setWorkoutEntry(workoutId, (current) => ({
      ...current,
      status: "debounced",
    }));
    timerRef.current.set(workoutId, window.setTimeout(() => {
      timerRef.current.delete(workoutId);
      persistWorkoutNow(workoutId);
    }, WORKOUT_AUTOSAVE_DEBOUNCE_MS));
  }, [clearWorkoutTimer, enabled, persistWorkoutNow, setWorkoutEntry]);

  const markWorkoutDirty = useCallback((workoutId, workout, workoutIndex) => {
    const existing = stateRef.current.get(workoutId) ||
      createInitialWorkoutState(workout, workoutIndex);

    if (existing.status === "conflict" || existing.status === "error") {
      return;
    }

    setWorkoutEntry(workoutId, {
      ...existing,
      status: existing.inFlightPromise ? "saving" : "dirty",
      pendingFollowUp: existing.inFlightPromise
        ? true
        : existing.pendingFollowUp,
    });
    scheduleAutosave(workoutId);
  }, [scheduleAutosave, setWorkoutEntry]);

  useEffect(() => {
    if (!enabled) {
      baselineRef.current = new Map(
        getWorkoutEntries(multiWeekDraft).map(({ workout, workoutIndex }) => [
          workout.id,
          { workoutRef: workout, workoutIndex },
        ])
      );
      return;
    }

    if (lastStructuralMutationVersionRef.current !== structuralMutationVersion) {
      lastStructuralMutationVersionRef.current = structuralMutationVersion;
      rebaseStructuralMutation(multiWeekDraft);
      return;
    }

    const entries = getWorkoutEntries(multiWeekDraft);
    if (baselineRef.current.size === 0) {
      rebaseWorkoutDirtyDetectionBaseline(multiWeekDraft, { resetState: true });
      return;
    }

    const nextBaseline = new Map();
    entries.forEach(({ workout, workoutIndex }) => {
      const previous = baselineRef.current.get(workout.id);
      nextBaseline.set(workout.id, { workoutRef: workout, workoutIndex });

      if (!previous) {
        const nextState = createInitialWorkoutState(workout, workoutIndex, {
          createdLocallyPendingStructuralSave: true,
        });
        stateRef.current.set(workout.id, nextState);
        return;
      }

      if (!Object.is(previous.workoutRef, workout)) {
        markWorkoutDirty(workout.id, workout, workoutIndex);
      }
    });
    baselineRef.current = nextBaseline;
    publishState();
  }, [
    enabled,
    markWorkoutDirty,
    multiWeekDraft,
    publishState,
    rebaseStructuralMutation,
    rebaseWorkoutDirtyDetectionBaseline,
    structuralMutationVersion,
  ]);

  const flushWorkout = useCallback(async (workoutId) => {
    if (!enabled) {
      return null;
    }

    while (true) {
      const state = stateRef.current.get(workoutId);
      if (!state) {
        return null;
      }

      if (
        state.status === "clean" ||
        state.status === "conflict" ||
        state.status === "error" ||
        state.createdLocallyPendingStructuralSave
      ) {
        return publicWorkoutState(state);
      }

      clearWorkoutTimer(workoutId);
      if (state.inFlightPromise) {
        await state.inFlightPromise;
      } else {
        await persistWorkoutNow(workoutId);
      }
    }
  }, [clearWorkoutTimer, enabled, persistWorkoutNow]);

  const flushAllWorkouts = useCallback(async () => {
    if (!enabled) {
      return { blockedWorkoutIds: [] };
    }

    while (true) {
      const workoutIds = Array.from(stateRef.current.keys());
      await Promise.all(workoutIds.map(flushWorkout));

      const pending = Array.from(stateRef.current.values()).some((state) =>
        !state.createdLocallyPendingStructuralSave &&
        (
          state.status === "dirty" ||
          state.status === "debounced" ||
          state.status === "saving" ||
          state.pendingFollowUp ||
          state.inFlightPromise
        )
      );

      if (!pending) {
        return {
          blockedWorkoutIds: Array.from(stateRef.current.entries())
            .filter(([, state]) => state.status === "conflict" || state.status === "error")
            .map(([workoutId]) => workoutId),
        };
      }
    }
  }, [enabled, flushWorkout]);

  useEffect(() => () => {
    timerRef.current.forEach((timer) => window.clearTimeout(timer));
    timerRef.current.clear();
  }, []);

  return {
    flushAllWorkouts,
    flushWorkout,
    persistWorkoutNow,
    rebaseWorkoutDirtyDetectionBaseline,
    workoutSaveState,
  };
}
