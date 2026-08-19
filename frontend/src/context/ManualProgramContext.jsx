import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";
import { mapProgramDraftToWeeklyPlanUpdate, mapBuilderPayloadToProgramDraft } from "../features/weeklyPlans/mappers";
import { isWeeklyWorkoutScopedAutosaveEnabled } from "../features/weeklyPlans/featureFlags";
import { openOrCreateWeeklyPlanEditDraft, updateWeeklyPlanDraft } from "../services/api";
import { attachBlockUiKeys, createBlockUiKey } from "../utils/blockUiKeys";
import { getDuplicateWorkoutName } from "../utils/duplicateWorkoutName";
import { useDraftAutosaveCoordinator } from "./useDraftAutosaveCoordinator";
import { useWeeklyPlanWorkoutAutosaveCoordinator } from "./useWeeklyPlanWorkoutAutosaveCoordinator";

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

function getWeeklyPlanIdentity(metadata) {
  if (!metadata?.weeklyPlanParentId || !metadata?.weeklyPlanVersionId) {
    return null;
  }

  return {
    documentId: metadata.weeklyPlanParentId,
    versionId: metadata.weeklyPlanVersionId,
  };
}

function getWeeklyPlanResponseIdentity(response) {
  return getWeeklyPlanIdentity(mapBuilderPayloadToProgramDraft(response).metadata);
}

function toWeeklyPlanCoordinatorIdentity(identity) {
  if (!identity) {
    return null;
  }

  return {
    documentId: identity.weeklyPlanParentId,
    versionId: identity.weeklyPlanVersionId,
  };
}

function buildWeeklyPublishWorkoutBlockedError(workoutIds, blockedReason = null) {
  const error = new Error(
    "Resolve workout autosave conflicts or errors before publishing."
  );
  error.code = "WORKOUT_AUTOSAVE_BLOCKED";
  error.workoutIds = workoutIds;
  error.blockedReason = blockedReason;
  return error;
}

function buildWeeklyPublishDocumentBlockedError(metadata, fallbackCode) {
  const error = new Error(
    metadata?.lastSaveErrorMessage ||
    "Resolve draft autosave conflicts or errors before publishing."
  );
  error.code = metadata?.lastSaveErrorCode || fallbackCode;
  return error;
}

function buildWeeklyPublishNoProgressError() {
  const error = new Error(
    "Weekly Plan persistence could not reach a stable state for publishing."
  );
  error.code = "WEEKLY_PUBLISH_PERSISTENCE_BLOCKED";
  return error;
}

export function ManualProgramProvider({ children }) {
  const [programDraft, setProgramDraft] = useState(createInitialDraft);
  const [draftMetadata, setDraftMetadata] = useState(createInitialDraftMetadata);
  const [structuralMutationVersion, setStructuralMutationVersion] = useState(0);
  const weeklyWorkoutScopedAutosaveEnabled =
    isWeeklyWorkoutScopedAutosaveEnabled();
  const structuralMutationVersionRef = useRef(0);
  const lastPersistedStructuralMutationVersionRef = useRef(0);
  const workoutCoordinatorRef = useRef(null);
  const weeklyDocumentMetadataRef = useRef(draftMetadata);
  weeklyDocumentMetadataRef.current = draftMetadata;

  const setCoordinatorDraftMetadata = useCallback((updater) => {
    const currentMetadata = weeklyDocumentMetadataRef.current;
    const nextMetadata = typeof updater === "function"
      ? updater(currentMetadata)
      : updater;
    weeklyDocumentMetadataRef.current = nextMetadata;
    setDraftMetadata(nextMetadata);
  }, []);

  const applyWeeklyHydrationResponse = useCallback((response, options = {}) => {
    const nextState = mapBuilderPayloadToProgramDraft(response);

    setProgramDraft((prev) => {
      const nextDraft = {
        ...nextState.programDraft,
        workouts: attachUiKeysToWorkouts(
          nextState.programDraft.workouts || [],
          prev.workouts || []
        ),
      };
      workoutCoordinatorRef.current?.rebaseWorkoutDirtyDetectionBaseline(
        nextDraft,
        { resetState: true }
      );
      return nextDraft;
    });
    lastPersistedStructuralMutationVersionRef.current =
      structuralMutationVersionRef.current;
    setCoordinatorDraftMetadata({
      ...createInitialDraftMetadata(),
      ...nextState.metadata,
      originRoute: options.originRoute ?? null,
    });
  }, [setCoordinatorDraftMetadata]);

  const applyCanonicalWeeklyResponse = useCallback((response) => {
    const nextState = mapBuilderPayloadToProgramDraft(response);

    setProgramDraft((prev) => {
      const nextDraft = {
        ...nextState.programDraft,
        workouts: attachUiKeysToWorkouts(
          nextState.programDraft.workouts || [],
          prev.workouts || []
        ),
      };
      workoutCoordinatorRef.current?.rebaseWorkoutDirtyDetectionBaseline(
        nextDraft,
        { resetState: true }
      );
      return nextDraft;
    });
    lastPersistedStructuralMutationVersionRef.current =
      structuralMutationVersionRef.current;
    setCoordinatorDraftMetadata((prev) => ({
      ...prev,
      ...nextState.metadata,
      originRoute: prev.originRoute,
      lastSavedAt: response.updatedAt || new Date().toISOString(),
      saveState: "saved",
      lastSaveErrorMessage: null,
      lastSaveErrorCode: null,
    }));
  }, [setCoordinatorDraftMetadata]);

  const persistWeeklyPlanDocument = useCallback(({ identity, payload, metadata }) => (
    updateWeeklyPlanDraft(
      identity.documentId,
      identity.versionId,
      { ...payload, revision: metadata.revision }
    )
  ), []);

  const prepareWeeklyDocumentPersistence = useCallback(async () => {
    if (!weeklyWorkoutScopedAutosaveEnabled) {
      return null;
    }

    const prepared = await workoutCoordinatorRef.current?.prepareStructuralSave();
    return {
      draft: prepared?.draft,
      metadata: prepared?.metadata,
      context: {
        structuralMutationVersion: structuralMutationVersionRef.current,
      },
    };
  }, [weeklyWorkoutScopedAutosaveEnabled]);

  const handleSuccessfulWeeklyDocumentSave = useCallback((response, context) => {
    if (!weeklyWorkoutScopedAutosaveEnabled) {
      if (!context.hasNewerLocalEdits || context.isOlderThanAppliedResponse) {
        return false;
      }

      const nextState = mapBuilderPayloadToProgramDraft(response);
      setCoordinatorDraftMetadata((prev) => ({
        ...prev,
        ...nextState.metadata,
        originRoute: prev.originRoute,
        lastSavedAt: response.updatedAt || new Date().toISOString(),
        saveState: "dirty",
        lastSaveErrorMessage: null,
        lastSaveErrorCode: null,
      }));
      return true;
    }

    const nextState = mapBuilderPayloadToProgramDraft(response);
    workoutCoordinatorRef.current?.reconcileStructuralSave(
      context.requestDraft,
      nextState.programDraft
    );
    const persistedStructuralVersion =
      context.preparationContext?.structuralMutationVersion ??
      structuralMutationVersionRef.current;
    lastPersistedStructuralMutationVersionRef.current = Math.max(
      lastPersistedStructuralMutationVersionRef.current,
      persistedStructuralVersion
    );
    const hasNewerStructuralMutation =
      structuralMutationVersionRef.current > persistedStructuralVersion;
    setCoordinatorDraftMetadata((prev) => ({
      ...prev,
      ...nextState.metadata,
      weeklyPlanParentId:
        response?.weeklyPlanParentId || nextState.metadata.weeklyPlanParentId,
      weeklyPlanVersionId:
        response?.weeklyPlanVersionId || nextState.metadata.weeklyPlanVersionId,
      originRoute: prev.originRoute,
      lastSavedAt: response.updatedAt || new Date().toISOString(),
      saveState: hasNewerStructuralMutation ? "dirty" : "saved",
      lastSaveErrorMessage: null,
      lastSaveErrorCode: null,
    }));
    return true;
  }, [setCoordinatorDraftMetadata, weeklyWorkoutScopedAutosaveEnabled]);

  const handleWeeklyDocumentPersistenceSettled = useCallback((context) => {
    if (!weeklyWorkoutScopedAutosaveEnabled) {
      return;
    }

    const persistedStructuralVersion =
      context.preparationContext?.structuralMutationVersion ?? null;
    const succeeded = context.outcome === "succeeded" || context.outcome === "skipped";
    const ownsLatestStructuralPause =
      persistedStructuralVersion != null &&
      structuralMutationVersionRef.current <= persistedStructuralVersion;
    if (succeeded && persistedStructuralVersion != null) {
      lastPersistedStructuralMutationVersionRef.current = Math.max(
        lastPersistedStructuralMutationVersionRef.current,
        persistedStructuralVersion
      );
    }
    workoutCoordinatorRef.current?.finishStructuralSave({
      releasePause: context.outcome === "failed" || ownsLatestStructuralPause,
      resumeDirtySaves: succeeded && ownsLatestStructuralPause,
    });
  }, [weeklyWorkoutScopedAutosaveEnabled]);

  const shouldAutosaveWeeklyDocument = useCallback(() => (
    weeklyWorkoutScopedAutosaveEnabled
      ? structuralMutationVersionRef.current >
        lastPersistedStructuralMutationVersionRef.current
      : undefined
  ), [weeklyWorkoutScopedAutosaveEnabled]);

  const {
    beginHydrationTarget: beginCoordinatorHydrationTarget,
    draftRef: programDraftRef,
    hydrate: hydrateCoordinatorDraft,
    metadataRef: draftMetadataRef,
    persistDraftNow: persistCoordinatorDraftNow,
    resetHydrationIdentity,
  } = useDraftAutosaveCoordinator({
    draft: programDraft,
    metadata: draftMetadata,
    metadataSourceRef: weeklyDocumentMetadataRef,
    setMetadata: setCoordinatorDraftMetadata,
    serializeDraft: mapProgramDraftToWeeklyPlanUpdate,
    getCurrentIdentity: getWeeklyPlanIdentity,
    getResponseIdentity: getWeeklyPlanResponseIdentity,
    persistDocument: persistWeeklyPlanDocument,
    onHydrate: applyWeeklyHydrationResponse,
    onCanonicalSaveResponse: applyCanonicalWeeklyResponse,
    preparePersistence: weeklyWorkoutScopedAutosaveEnabled
      ? prepareWeeklyDocumentPersistence
      : undefined,
    onSuccessfulSaveResponse: handleSuccessfulWeeklyDocumentSave,
    onPersistenceSettled: weeklyWorkoutScopedAutosaveEnabled
      ? handleWeeklyDocumentPersistenceSettled
      : undefined,
    shouldAutosave: weeklyWorkoutScopedAutosaveEnabled
      ? shouldAutosaveWeeklyDocument
      : undefined,
    autosaveTrigger: weeklyWorkoutScopedAutosaveEnabled
      ? structuralMutationVersion
      : programDraft,
    cancelDebouncedAutosaveOnPersist: weeklyWorkoutScopedAutosaveEnabled,
  });

  const beginDocumentHydrationTarget = useCallback((identity) => {
    beginCoordinatorHydrationTarget(toWeeklyPlanCoordinatorIdentity(identity));
  }, [beginCoordinatorHydrationTarget]);

  const hydrateProgramDraft = useCallback((response, options = {}) => {
    hydrateCoordinatorDraft(response, options);
  }, [hydrateCoordinatorDraft]);

  const persistDraftNow = useCallback((overrideDraft = null, overrideIdentity = null) => (
    persistCoordinatorDraftNow(
      overrideDraft,
      toWeeklyPlanCoordinatorIdentity(overrideIdentity)
    )
  ), [persistCoordinatorDraftNow]);

  const workoutCoordinator = useWeeklyPlanWorkoutAutosaveCoordinator({
    enabled: weeklyWorkoutScopedAutosaveEnabled,
    programDraft,
    setProgramDraft,
    draftMetadata,
    setDraftMetadata: setCoordinatorDraftMetadata,
    documentMetadataRef: weeklyDocumentMetadataRef,
    structuralMutationVersion,
  });
  workoutCoordinatorRef.current = workoutCoordinator;
  const {
    flushAllWorkouts,
    flushWorkout,
    getPersistenceSummary,
    persistWorkoutNow,
    workoutSaveState,
  } = workoutCoordinator;

  const markStructuralMutation = useCallback(() => {
    workoutCoordinatorRef.current?.notifyStructuralMutation();
    structuralMutationVersionRef.current += 1;
    setStructuralMutationVersion(structuralMutationVersionRef.current);
  }, []);

  const prepareWeeklyPlanDraftForPublish = useCallback(async () => {
    let documentPassRequired = !weeklyWorkoutScopedAutosaveEnabled;
    let genericDocumentRetryAttempted = false;

    const readState = () => {
      const metadata = weeklyDocumentMetadataRef.current;
      const workoutSummary = workoutCoordinatorRef.current
        ?.getPersistenceSummary() || getPersistenceSummary();
      return {
        hasPendingStructuralMutation: weeklyWorkoutScopedAutosaveEnabled && (
          structuralMutationVersionRef.current >
          lastPersistedStructuralMutationVersionRef.current
        ),
        hasLegacyDocumentChanges: !weeklyWorkoutScopedAutosaveEnabled && (
          JSON.stringify(mapProgramDraftToWeeklyPlanUpdate(programDraftRef.current)) !==
          metadata.lastPersistedSignature
        ),
        metadata,
        workoutSummary,
      };
    };
    const progressKey = (state) => JSON.stringify({
      documentRevision: state.metadata.revision,
      documentSaveState: state.metadata.saveState,
      lastPersistedSignature: state.metadata.lastPersistedSignature,
      lastPersistedStructuralMutationVersion:
        lastPersistedStructuralMutationVersionRef.current,
      pendingStructuralWorkoutIds:
        state.workoutSummary.pendingStructuralWorkoutIds,
      pendingWorkoutIds: state.workoutSummary.pendingWorkoutIds,
      structuralMutationVersion: structuralMutationVersionRef.current,
      structuralPauseActive: state.workoutSummary.structuralPauseActive,
    });

    while (true) {
      const flushResult = await flushAllWorkouts();
      if (flushResult.blockedReason === "DOCUMENT_CONFLICT") {
        throw buildWeeklyPublishDocumentBlockedError(
          weeklyDocumentMetadataRef.current,
          "DRAFT_REVISION_CONFLICT"
        );
      }
      if (flushResult.blockedReason || flushResult.blockedWorkoutIds.length > 0) {
        throw buildWeeklyPublishWorkoutBlockedError(
          flushResult.blockedWorkoutIds,
          flushResult.blockedReason || null
        );
      }

      let currentState = readState();
      if (currentState.workoutSummary.blockedWorkoutIds.length > 0) {
        throw buildWeeklyPublishWorkoutBlockedError(
          currentState.workoutSummary.blockedWorkoutIds
        );
      }
      if (currentState.metadata.saveState === "conflict") {
        throw buildWeeklyPublishDocumentBlockedError(
          currentState.metadata,
          "DRAFT_REVISION_CONFLICT"
        );
      }
      if (
        currentState.metadata.saveState === "error" &&
        genericDocumentRetryAttempted
      ) {
        throw buildWeeklyPublishDocumentBlockedError(
          currentState.metadata,
          "WEEKLY_DRAFT_SAVE_FAILED"
        );
      }

      const documentNeedsPersistence =
        documentPassRequired ||
        currentState.hasPendingStructuralMutation ||
        currentState.hasLegacyDocumentChanges ||
        currentState.metadata.saveState === "dirty" ||
        currentState.metadata.saveState === "saving" ||
        currentState.metadata.saveState === "error" ||
        currentState.workoutSummary.pendingStructuralWorkoutIds.length > 0 ||
        currentState.workoutSummary.structuralPauseActive;

      if (documentNeedsPersistence) {
        if (currentState.metadata.saveState === "error") {
          genericDocumentRetryAttempted = true;
        }
        const beforeProgressKey = progressKey(currentState);
        await persistDraftNow();
        documentPassRequired = false;
        currentState = readState();
        const documentStillNeedsPersistence =
          currentState.hasPendingStructuralMutation ||
          currentState.hasLegacyDocumentChanges ||
          currentState.metadata.saveState === "dirty" ||
          currentState.metadata.saveState === "saving" ||
          currentState.workoutSummary.pendingStructuralWorkoutIds.length > 0 ||
          currentState.workoutSummary.structuralPauseActive;
        if (
          documentStillNeedsPersistence &&
          progressKey(currentState) === beforeProgressKey
        ) {
          throw buildWeeklyPublishNoProgressError();
        }
        continue;
      }

      currentState = readState();
      if (currentState.metadata.saveState === "conflict") {
        throw buildWeeklyPublishDocumentBlockedError(
          currentState.metadata,
          "DRAFT_REVISION_CONFLICT"
        );
      }
      if (currentState.metadata.saveState === "error") {
        throw buildWeeklyPublishDocumentBlockedError(
          currentState.metadata,
          "WEEKLY_DRAFT_SAVE_FAILED"
        );
      }
      if (currentState.workoutSummary.blockedWorkoutIds.length > 0) {
        throw buildWeeklyPublishWorkoutBlockedError(
          currentState.workoutSummary.blockedWorkoutIds
        );
      }
      if (
        currentState.hasPendingStructuralMutation ||
        currentState.hasLegacyDocumentChanges ||
        currentState.metadata.saveState === "dirty" ||
        currentState.metadata.saveState === "saving" ||
        currentState.workoutSummary.pendingWorkoutIds.length > 0 ||
        currentState.workoutSummary.structuralPauseActive
      ) {
        throw buildWeeklyPublishNoProgressError();
      }

      return {
        status: "ready",
        draft: programDraftRef.current,
        metadata: currentState.metadata,
      };
    }
  }, [
    flushAllWorkouts,
    getPersistenceSummary,
    persistDraftNow,
    programDraftRef,
    weeklyWorkoutScopedAutosaveEnabled,
  ]);

  const beginHydrationTarget = useCallback((identity) => {
    const currentMetadata = draftMetadataRef.current;
    const isDifferentDocument = Boolean(
      currentMetadata.loadedFromBackend &&
      currentMetadata.weeklyPlanParentId &&
      identity?.weeklyPlanParentId &&
      currentMetadata.weeklyPlanParentId !== identity.weeklyPlanParentId
    );

    if (!weeklyWorkoutScopedAutosaveEnabled || !isDifferentDocument) {
      beginDocumentHydrationTarget(identity);
      return null;
    }

    return (async () => {
      const preparation = await prepareWeeklyPlanDraftForPublish();
      if (preparation.status !== "ready") {
        throw buildWeeklyPublishNoProgressError();
      }
      beginDocumentHydrationTarget(identity);
      return null;
    })();
  }, [
    beginDocumentHydrationTarget,
    draftMetadataRef,
    prepareWeeklyPlanDraftForPublish,
    weeklyWorkoutScopedAutosaveEnabled,
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
    setCoordinatorDraftMetadata(createInitialDraftMetadata());
    resetHydrationIdentity();
  }, [resetHydrationIdentity, setCoordinatorDraftMetadata]);

  const updateProgramMeta = useCallback((updates = {}) => {
    markStructuralMutation();
    setProgramDraft((prev) => ({ ...prev, ...updates }));
  }, [markStructuralMutation]);

  const updateSessionsPerWeek = useCallback((nextValue) => {
    markStructuralMutation();
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
  }, [markStructuralMutation]);

  const updateProgramSettings = useCallback((updates = {}) => {
    markStructuralMutation();
    setProgramDraft((prev) => {
      const hasSessionsPerWeek = Object.prototype.hasOwnProperty.call(
        updates,
        "sessionsPerWeek"
      );
      const safeSessionsPerWeek = clampNumber(
        Number(hasSessionsPerWeek ? updates.sessionsPerWeek : prev.sessionsPerWeek) || 1,
        1,
        7
      );
      const nextDraft = {
        ...prev,
        ...(Object.prototype.hasOwnProperty.call(updates, "programName")
          ? { programName: updates.programName }
          : {}),
      };

      if (!hasSessionsPerWeek || safeSessionsPerWeek < prev.workouts.length) {
        return nextDraft;
      }

      return {
        ...nextDraft,
        sessionsPerWeek: safeSessionsPerWeek,
      };
    });
  }, [markStructuralMutation]);

  const addWorkout = useCallback((name) => {
    markStructuralMutation();
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
  }, [markStructuralMutation]);

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

    markStructuralMutation();
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
  }, [markStructuralMutation]);

  const duplicateWorkouts = useCallback((workoutIds) => {
    const selectedIds = Array.isArray(workoutIds)
      ? workoutIds.filter(Boolean)
      : [];

    if (!selectedIds.length) {
      return;
    }

    markStructuralMutation();
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
  }, [markStructuralMutation]);

  const removeWorkouts = useCallback((workoutIds) => {
    const selectedIds = Array.isArray(workoutIds)
      ? workoutIds.filter(Boolean)
      : [];

    if (!selectedIds.length) {
      return;
    }

    markStructuralMutation();
    setProgramDraft((prev) => {
      const selectedIdSet = new Set(selectedIds);

      return {
        ...prev,
        workouts: prev.workouts.filter((workout) => !selectedIdSet.has(workout.id)),
      };
    });
  }, [markStructuralMutation]);

  const resetProgramDraft = useCallback(() => {
    setProgramDraft(createInitialDraft());
    setCoordinatorDraftMetadata(createInitialDraftMetadata());
    resetHydrationIdentity();
  }, [resetHydrationIdentity, setCoordinatorDraftMetadata]);

  // The only path back from `saveState === "conflict"`. Explicitly
  // destructive -- discards every unsaved local edit made since the
  // conflict was detected -- so the calling UI must show an explicit
  // confirmation step before invoking this, not call it as a direct,
  // unconfirmed side effect of a single click. The coordinator's metadata
  // ref keeps this domain-specific reload check current across async work.
  const reloadLatestAfterConflict = useCallback(async () => {
    const currentMetadata = draftMetadataRef.current;

    if (currentMetadata.saveState !== "conflict" || !currentMetadata.weeklyPlanParentId) {
      return null;
    }

    try {
      const response = await openOrCreateWeeklyPlanEditDraft(currentMetadata.weeklyPlanParentId);
      // Explicit, user-confirmed discard-and-reload -- force past the
      // local-authority guard used by explicit conflict recovery.
      hydrateProgramDraft(response, { force: true });
      return response;
    } catch (reloadError) {
      setCoordinatorDraftMetadata((prev) => ({
        ...prev,
        saveState: "error",
        lastSaveErrorMessage: reloadError?.message || "Unable to reload draft. Please refresh the page.",
        lastSaveErrorCode: reloadError?.code || null,
      }));
      return null;
    }
  }, [draftMetadataRef, hydrateProgramDraft, setCoordinatorDraftMetadata]);

  const setDraftOriginRoute = useCallback((originRoute) => {
    setCoordinatorDraftMetadata((prev) => ({
      ...prev,
      originRoute: originRoute ?? null,
    }));
  }, [setCoordinatorDraftMetadata]);

  const updateDraftMetadata = useCallback((updates = {}) => {
    setCoordinatorDraftMetadata((prev) => ({ ...prev, ...updates }));
  }, [setCoordinatorDraftMetadata]);

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
      updateProgramSettings,
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
      prepareWeeklyPlanDraftForPublish,
      persistWorkoutNow,
      flushWorkout,
      flushAllWorkouts,
      workoutSaveState,
      weeklyWorkoutScopedAutosaveEnabled,
      reloadLatestAfterConflict,
      setDraftOriginRoute,
      updateDraftMetadata,
    }),
    [
      programDraft,
      createProgramDraft,
      updateProgramMeta,
      updateSessionsPerWeek,
      updateProgramSettings,
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
      prepareWeeklyPlanDraftForPublish,
      persistWorkoutNow,
      flushWorkout,
      flushAllWorkouts,
      workoutSaveState,
      weeklyWorkoutScopedAutosaveEnabled,
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
