import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  getDateKeyInTimeZone,
  resolveOccurrenceTemporalState,
} from "../features/multiWeek/occurrence";
import { mapCycleBuilderPayload, mapMultiWeekDraftToApi } from "../features/multiWeek/mappers";
import { openOrCreateCycleEditDraft, updateCycleDraft } from "../services/api";
import { attachBlockUiKeys, createBlockUiKey } from "../utils/blockUiKeys";
import { getDuplicateWorkoutName } from "../utils/duplicateWorkoutName";
import { useCycleWorkoutAutosaveCoordinator } from "./useCycleWorkoutAutosaveCoordinator";
import { useDraftAutosaveCoordinator } from "./useDraftAutosaveCoordinator";

const MultiWeekProgramContext = createContext(null);
export const MAX_BLOCK_SET_COUNT = 10;
const DEFAULT_CARDIO_DURATION_MINUTES = 20;
const DAY_OF_WEEK = [
  "MONDAY",
  "TUESDAY",
  "WEDNESDAY",
  "THURSDAY",
  "FRIDAY",
  "SATURDAY",
  "SUNDAY",
];

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
  return { id: createId("set"), reps: 8, rpe: 2 };
}

function createSupersetSetRow() {
  return { id: createId("set"), reps: 10, rpe: 2 };
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
    exerciseRowId: createId("exercise"),
    exercise: "",
    exerciseId: null,
    bodyParts: [],
    muscleFocus: [],
    tempo: "3010",
    rest: "120s",
    sets: createSetRows(2, createSingleSetRow),
    notes: "",
  };
}

function createEmptySupersetExercise(label, setCount = 2) {
  return {
    id: createId("exercise"),
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

function createDefaultSupersetBlock() {
  return normalizeSupersetBlock({
    id: createId("block"),
    uiKey: createBlockUiKey(),
    type: "superset",
    sets: 2,
    rest: "120s",
    exercises: [
      createEmptySupersetExercise("A1", 2),
      createEmptySupersetExercise("A2", 2),
    ],
  });
}

function createSingleBlockFromExercise(exercise) {
  return {
    id: createId("block"),
    uiKey: createBlockUiKey(),
    type: "single",
    exerciseRowId: createId("exercise"),
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
    exerciseRowId: createId("exercise"),
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
    contentRevision: undefined,
    name,
    persistence: undefined,
    blocks: (workout.blocks || []).map((block) => ({
      ...block,
      id: createId("block"),
      uiKey: createBlockUiKey(),
      persistence: undefined,
      exerciseRowId:
        block.type === "single" || block.type === "cardio"
          ? createId("exercise")
          : undefined,
      exercisePersistence: undefined,
      editIntent: undefined,
      exercises:
        block.type === "superset"
          ? (block.exercises || []).map((exercise) => ({
            ...exercise,
            id: createId("exercise"),
            persistence: undefined,
            editIntent: undefined,
            sets: Array.isArray(exercise.sets)
              ? exercise.sets.map((set) => ({
                ...set,
                id: createId("set"),
                persistence: undefined,
                editIntent: undefined,
              }))
              : [],
          }))
          : block.exercises,
      sets: Array.isArray(block.sets)
        ? block.sets.map((set) => ({
          ...set,
          id: createId("set"),
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

function attachUiKeysToWeeks(nextWeeks = [], previousWeeks = []) {
  const previousWorkoutsById = new Map();

  previousWeeks.forEach((week) => {
    (week.workouts || []).forEach((workout) => {
      previousWorkoutsById.set(workout.id, workout);
    });
  });

  return nextWeeks.map((week) => ({
    ...week,
    workouts: (week.workouts || []).map((workout) => ({
      ...workout,
      blocks: attachBlockUiKeys(
        workout.blocks || [],
        previousWorkoutsById.get(workout.id)?.blocks || []
      ),
    })),
  }));
}

function getDayIndex(day) {
  return DAY_OF_WEEK.indexOf(day || "");
}

function createInitialDraft() {
  return {
    programName: "",
    sessionsPerWeek: 0,
    programLength: 0,
    startDate: null,
    endDate: null,
    selectedWeek: 1,
    weeks: [],
  };
}

function createInitialDraftMetadata() {
  return {
    cycleId: null,
    cyclePlanId: null,
    status: "draft",
    temporalStatus: "upcoming",
    timezone: "America/Toronto",
    loadedFromBackend: false,
    lastSavedAt: null,
    saveState: "idle",
    lastPersistedSignature: "",
    revision: null,
    draftState: null,
    draftTimeline: null,
    allowCrossDayDraft: false,
    lastSaveErrorMessage: null,
    lastSaveErrorCode: null,
    isRecoveringDraft: false,
    recoveryMessage: null,
  };
}

function updateSelectedWeekDraft(prev, updater) {
  const selectedWeekIndex = Math.max(0, (prev.selectedWeek || 1) - 1);
  if (!prev.weeks[selectedWeekIndex]) {
    return prev;
  }

  const nextWeeks = prev.weeks.map((week, index) =>
    index === selectedWeekIndex ? updater(week) : week
  );

  return {
    ...prev,
    weeks: nextWeeks,
  };
}

function resolvePreservedSelectedWeek(currentSelectedWeek, nextDraft) {
  const validWeekNumbers = new Set((nextDraft?.weeks || []).map((week) => week.weekNumber));

  if (validWeekNumbers.has(currentSelectedWeek)) {
    return currentSelectedWeek;
  }

  if (validWeekNumbers.has(nextDraft?.selectedWeek)) {
    return nextDraft.selectedWeek;
  }

  return nextDraft?.weeks?.[0]?.weekNumber || 1;
}

function getWorkoutFallbackWeekdayIndex(workout) {
  const orderIndex = Number(workout?.orderIndex);
  if (!Number.isInteger(orderIndex) || orderIndex < 1) {
    return null;
  }

  return Math.max(0, orderIndex - 1);
}

function getMultiWeekTodayDateKey(metadata, draft) {
  return (
    metadata?.draftState?.localDate ||
    getDateKeyInTimeZone(metadata?.timezone || draft?.timezone || "America/Toronto")
  );
}

function getCycleIdentity(metadata) {
  if (!metadata?.cycleId || !metadata?.cyclePlanId) {
    return null;
  }

  return {
    documentId: metadata.cycleId,
    versionId: metadata.cyclePlanId,
  };
}

function getCycleResponseIdentity(response) {
  return getCycleIdentity(mapCycleBuilderPayload(response).metadata);
}

function toCycleCoordinatorIdentity(identity) {
  if (!identity) {
    return null;
  }

  return {
    documentId: identity.cycleId,
    versionId: identity.planId,
  };
}

function isCycleAutosavePaused(metadata) {
  return Boolean(metadata?.isRecoveringDraft);
}

function getCycleSaveErrorPatch(error) {
  return {
    lastSaveErrorMessage: error?.message || "Unable to autosave this draft.",
    lastSaveErrorCode: error?.code || null,
  };
}

function buildCyclePublishWorkoutBlockedError(workoutIds, blockedReason = null) {
  const error = new Error(
    "Resolve workout autosave conflicts or errors before publishing."
  );
  error.code = "WORKOUT_AUTOSAVE_BLOCKED";
  error.workoutIds = workoutIds;
  error.blockedReason = blockedReason;
  return error;
}

function buildCyclePublishDocumentBlockedError(metadata, fallbackCode) {
  const error = new Error(
    metadata?.lastSaveErrorMessage ||
    "Resolve draft autosave conflicts or errors before publishing."
  );
  error.code = metadata?.lastSaveErrorCode || fallbackCode;
  return error;
}

function buildCyclePublishNoProgressError() {
  const error = new Error(
    "Cycle persistence could not reach a stable state for publishing."
  );
  error.code = "CYCLE_PUBLISH_PERSISTENCE_BLOCKED";
  return error;
}

function isLockedActiveCycleWorkoutOccurrence({
  draft,
  metadata,
  weekNumber,
  workout,
  scheduledDay = undefined,
  weekdayIndex = undefined,
}) {
  if (metadata?.temporalStatus !== "active" || !draft?.startDate || !workout) {
    return false;
  }

  return resolveOccurrenceTemporalState({
    cycleStartDate: draft.startDate,
    weekNumber,
    scheduledDay: scheduledDay === undefined ? workout.scheduledDay || null : scheduledDay,
    weekdayIndex:
      weekdayIndex === undefined ? getWorkoutFallbackWeekdayIndex(workout) : weekdayIndex,
    todayDateKey: getMultiWeekTodayDateKey(metadata, draft),
  }).isPastOccurrence;
}

export function MultiWeekProgramProvider({ children }) {
  const [multiWeekDraft, setMultiWeekDraft] = useState(createInitialDraft);
  const [draftMetadata, setDraftMetadata] = useState(createInitialDraftMetadata);
  const [structuralMutationVersion, setStructuralMutationVersion] = useState(0);
  const draftRecoveryPromiseRef = useRef(null);
  const draftRecoveryGenerationRef = useRef(0);
  const structuralMutationVersionRef = useRef(0);
  const lastPersistedStructuralMutationVersionRef = useRef(0);
  const workoutCoordinatorRef = useRef(null);
  const cycleDocumentMetadataRef = useRef(draftMetadata);
  cycleDocumentMetadataRef.current = draftMetadata;

  const setCoordinatorDraftMetadata = useCallback((updater) => {
    const currentMetadata = cycleDocumentMetadataRef.current;
    const nextMetadata = typeof updater === "function"
      ? updater(currentMetadata)
      : updater;
    cycleDocumentMetadataRef.current = nextMetadata;
    setDraftMetadata(nextMetadata);
  }, []);

  const selectedWeek = useMemo(
    () => multiWeekDraft.weeks.find((week) => week.weekNumber === multiWeekDraft.selectedWeek) || multiWeekDraft.weeks[0] || null,
    [multiWeekDraft.selectedWeek, multiWeekDraft.weeks]
  );

  const programDraft = useMemo(
    () => ({
      ...multiWeekDraft,
      isMultiWeek: true,
      workouts: selectedWeek?.workouts || [],
    }),
    [multiWeekDraft, selectedWeek]
  );

  const applyCycleHydrationResponse = useCallback((response) => {
    const nextState = mapCycleBuilderPayload(response);

    setMultiWeekDraft((prev) => {
      const nextDraft = {
        ...nextState.programDraft,
        weeks: attachUiKeysToWeeks(
          nextState.programDraft.weeks || [],
          prev.weeks || []
        ),
        selectedWeek: resolvePreservedSelectedWeek(prev.selectedWeek, nextState.programDraft),
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
    });
  }, [setCoordinatorDraftMetadata]);

  const applyCanonicalCycleResponse = useCallback((response) => {
    const activePlanId = response?.planId || null;
    const nextState = mapCycleBuilderPayload(response);

    setMultiWeekDraft((prev) => {
      const nextDraft = {
        ...nextState.programDraft,
        weeks: attachUiKeysToWeeks(
          nextState.programDraft.weeks || [],
          prev.weeks || []
        ),
        selectedWeek: resolvePreservedSelectedWeek(prev.selectedWeek, nextState.programDraft),
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
      cycleId: nextState.metadata.cycleId,
      cyclePlanId: activePlanId || nextState.metadata.cyclePlanId,
      lastSavedAt: response.updatedAt || new Date().toISOString(),
      saveState: "saved",
      lastSaveErrorMessage: null,
      lastSaveErrorCode: null,
    }));
  }, [setCoordinatorDraftMetadata]);

  const recoverExpiredDraft = useCallback(async (
    error,
    cycleIdOverride,
    hydrateRecoveredDraft,
    metadataSnapshot
  ) => {
    if (error?.code !== "DRAFT_EXPIRED") {
      return false;
    }

    draftRecoveryGenerationRef.current += 1;

    if (draftRecoveryPromiseRef.current) {
      await draftRecoveryPromiseRef.current;
      return true;
    }

    const currentMetadata = metadataSnapshot;
    const resolvedCycleId = cycleIdOverride || currentMetadata?.cycleId || null;
    const recoveryFailureMessage = "Unable to recover draft. Please refresh the page.";

    if (!resolvedCycleId) {
      setCoordinatorDraftMetadata((prev) => ({
        ...prev,
        isRecoveringDraft: false,
        recoveryMessage: recoveryFailureMessage,
        saveState: "error",
        lastSaveErrorMessage: recoveryFailureMessage,
        lastSaveErrorCode: error?.code || "DRAFT_EXPIRED",
      }));
      return true;
    }

    const recoveryPromise = (async () => {
      setCoordinatorDraftMetadata((prev) => ({
        ...prev,
        isRecoveringDraft: true,
        recoveryMessage: "Your draft expired. Reloading latest version...",
        saveState: "idle",
        lastSaveErrorMessage: null,
        lastSaveErrorCode: "DRAFT_EXPIRED",
      }));

      try {
        const response = await openOrCreateCycleEditDraft(resolvedCycleId, {
          timezone: currentMetadata?.timezone,
          allowCrossDayDraft: currentMetadata?.allowCrossDayDraft,
        });
        // The draft row that expired no longer exists server-side -- this
        // recovery must force past the local-authority guard regardless of
        // in-progress edits, unlike a normal hydrate.
        hydrateRecoveredDraft(response, { force: true });
        return response;
      } catch (recoveryError) {
        setCoordinatorDraftMetadata((prev) => ({
          ...prev,
          isRecoveringDraft: false,
          recoveryMessage: recoveryFailureMessage,
          saveState: "error",
          lastSaveErrorMessage: recoveryFailureMessage,
          lastSaveErrorCode: recoveryError?.code || null,
        }));
        return null;
      } finally {
        draftRecoveryPromiseRef.current = null;
      }
    })();

    draftRecoveryPromiseRef.current = recoveryPromise;
    await recoveryPromise;
    return true;
  }, [setCoordinatorDraftMetadata]);

  const persistCycleDocument = useCallback(({ identity, payload, metadata }) => (
    updateCycleDraft(identity.documentId, identity.versionId, {
      ...payload,
      allowCrossDayDraft: metadata.allowCrossDayDraft,
      revision: metadata.revision,
    })
  ), []);

  const handleCycleSaveError = useCallback((error, { currentMetadata, hydrate }) => (
    recoverExpiredDraft(
      error,
      currentMetadata?.cycleId || null,
      hydrate,
      currentMetadata
    )
  ), [recoverExpiredDraft]);

  const logCycleAutosaveError = useCallback((error, metadata) => {
    console.error("[MultiWeekProgramContext] autosave failed", {
      cycleId: metadata?.cycleId || null,
      cyclePlanId: metadata?.cyclePlanId || null,
      errorCode: error?.code || null,
      errorMessage: error?.message || null,
    });
  }, []);

  const logQueuedCycleAutosaveError = useCallback((error, metadata) => {
    console.error("[MultiWeekProgramContext] queued autosave failed", {
      cycleId: metadata?.cycleId || null,
      cyclePlanId: metadata?.cyclePlanId || null,
      errorCode: error?.code || null,
      errorMessage: error?.message || null,
    });
  }, []);

  const prepareCycleDocumentPersistence = useCallback(async () => {
    const prepared = await workoutCoordinatorRef.current?.prepareStructuralSave();
    return {
      draft: prepared?.draft,
      metadata: prepared?.metadata,
      context: {
        structuralMutationVersion: structuralMutationVersionRef.current,
      },
    };
  }, []);

  const handleSuccessfulCycleDocumentSave = useCallback((response, context) => {
    const nextState = mapCycleBuilderPayload(response);
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
    const nextMetadata = {
      ...cycleDocumentMetadataRef.current,
      ...nextState.metadata,
      cyclePlanId: response?.planId || nextState.metadata.cyclePlanId,
      lastSavedAt: response.updatedAt || new Date().toISOString(),
      saveState: hasNewerStructuralMutation ? "dirty" : "saved",
      lastSaveErrorMessage: null,
      lastSaveErrorCode: null,
    };
    setCoordinatorDraftMetadata(nextMetadata);
    return true;
  }, [setCoordinatorDraftMetadata]);

  const handleCycleDocumentPersistenceSettled = useCallback((context) => {
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
  }, []);

  const shouldAutosaveCycleDocument = useCallback(() => (
    structuralMutationVersionRef.current >
    lastPersistedStructuralMutationVersionRef.current
  ), []);

  const {
    beginHydrationTarget: beginCoordinatorHydrationTarget,
    draftRef: multiWeekDraftRef,
    hydrate: hydrateCoordinatorDraft,
    metadataRef: draftMetadataRef,
    persistDraftNow: persistCoordinatorDraftNow,
  } = useDraftAutosaveCoordinator({
    draft: multiWeekDraft,
    metadata: draftMetadata,
    metadataSourceRef: cycleDocumentMetadataRef,
    setMetadata: setCoordinatorDraftMetadata,
    serializeDraft: mapMultiWeekDraftToApi,
    getCurrentIdentity: getCycleIdentity,
    getResponseIdentity: getCycleResponseIdentity,
    persistDocument: persistCycleDocument,
    onHydrate: applyCycleHydrationResponse,
    onCanonicalSaveResponse: applyCanonicalCycleResponse,
    handleSaveError: handleCycleSaveError,
    getSaveErrorPatch: getCycleSaveErrorPatch,
    isTransientlyPaused: isCycleAutosavePaused,
    onAutosaveError: logCycleAutosaveError,
    onQueuedSaveError: logQueuedCycleAutosaveError,
    preparePersistence: prepareCycleDocumentPersistence,
    onSuccessfulSaveResponse: handleSuccessfulCycleDocumentSave,
    onPersistenceSettled: handleCycleDocumentPersistenceSettled,
    shouldAutosave: shouldAutosaveCycleDocument,
    autosaveTrigger: structuralMutationVersion,
  });

  const beginDocumentHydrationTarget = useCallback((identity) => {
    beginCoordinatorHydrationTarget(toCycleCoordinatorIdentity(identity));
  }, [beginCoordinatorHydrationTarget]);

  const hydrateProgramDraft = useCallback((response, options = {}) => {
    hydrateCoordinatorDraft(response, options);
  }, [hydrateCoordinatorDraft]);

  const persistDraftNow = useCallback((overrideDraft = null, overrideIdentity = null) => (
    persistCoordinatorDraftNow(
      overrideDraft,
      toCycleCoordinatorIdentity(overrideIdentity)
    )
  ), [persistCoordinatorDraftNow]);

  const handleDraftExpired = useCallback((error, cycleIdOverride = null) => (
    recoverExpiredDraft(
      error,
      cycleIdOverride,
      hydrateProgramDraft,
      draftMetadataRef.current
    )
  ), [draftMetadataRef, hydrateProgramDraft, recoverExpiredDraft]);

  const workoutCoordinator = useCycleWorkoutAutosaveCoordinator({
    multiWeekDraft,
    setMultiWeekDraft,
    draftMetadata,
    setDraftMetadata,
    documentMetadataRef: cycleDocumentMetadataRef,
    structuralMutationVersion,
    handleDraftExpired,
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

  const prepareCycleDraftForPublish = useCallback(async () => {
    const recoveryGenerationAtStart = draftRecoveryGenerationRef.current;
    let genericDocumentRetryAttempted = false;

    const didRecoverDraft = () => (
      draftRecoveryGenerationRef.current !== recoveryGenerationAtStart
    );
    const readState = () => {
      const metadata = cycleDocumentMetadataRef.current;
      const workoutSummary = workoutCoordinatorRef.current
        ?.getPersistenceSummary() || getPersistenceSummary();
      const hasPendingStructuralMutation = (
        structuralMutationVersionRef.current >
        lastPersistedStructuralMutationVersionRef.current
      );

      return {
        hasPendingStructuralMutation,
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
      if (didRecoverDraft()) {
        return { status: "aborted", reason: "DRAFT_EXPIRED" };
      }

      if (flushResult.blockedReason === "DOCUMENT_CONFLICT") {
        throw buildCyclePublishDocumentBlockedError(
          cycleDocumentMetadataRef.current,
          "DRAFT_REVISION_CONFLICT"
        );
      }
      if (flushResult.blockedReason || flushResult.blockedWorkoutIds.length > 0) {
        throw buildCyclePublishWorkoutBlockedError(
          flushResult.blockedWorkoutIds,
          flushResult.blockedReason || null
        );
      }

      let currentState = readState();
      if (currentState.workoutSummary.blockedWorkoutIds.length > 0) {
        throw buildCyclePublishWorkoutBlockedError(
          currentState.workoutSummary.blockedWorkoutIds
        );
      }
      if (currentState.metadata.saveState === "conflict") {
        throw buildCyclePublishDocumentBlockedError(
          currentState.metadata,
          "DRAFT_REVISION_CONFLICT"
        );
      }
      if (
        currentState.metadata.saveState === "error" &&
        genericDocumentRetryAttempted
      ) {
        throw buildCyclePublishDocumentBlockedError(
          currentState.metadata,
          "CYCLE_DRAFT_SAVE_FAILED"
        );
      }

      const documentNeedsPersistence =
        currentState.hasPendingStructuralMutation ||
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
        try {
          await persistDraftNow();
        } catch (error) {
          if (didRecoverDraft()) {
            return { status: "aborted", reason: "DRAFT_EXPIRED" };
          }
          throw error;
        }

        if (didRecoverDraft()) {
          return { status: "aborted", reason: "DRAFT_EXPIRED" };
        }

        currentState = readState();
        const documentStillNeedsPersistence =
          currentState.hasPendingStructuralMutation ||
          currentState.metadata.saveState === "dirty" ||
          currentState.metadata.saveState === "saving" ||
          currentState.workoutSummary.pendingStructuralWorkoutIds.length > 0 ||
          currentState.workoutSummary.structuralPauseActive;
        if (
          documentStillNeedsPersistence &&
          progressKey(currentState) === beforeProgressKey
        ) {
          throw buildCyclePublishNoProgressError();
        }
        continue;
      }

      currentState = readState();
      if (currentState.metadata.saveState === "conflict") {
        throw buildCyclePublishDocumentBlockedError(
          currentState.metadata,
          "DRAFT_REVISION_CONFLICT"
        );
      }
      if (currentState.metadata.saveState === "error") {
        throw buildCyclePublishDocumentBlockedError(
          currentState.metadata,
          "CYCLE_DRAFT_SAVE_FAILED"
        );
      }
      if (currentState.workoutSummary.blockedWorkoutIds.length > 0) {
        throw buildCyclePublishWorkoutBlockedError(
          currentState.workoutSummary.blockedWorkoutIds
        );
      }
      if (
        currentState.hasPendingStructuralMutation ||
        currentState.metadata.saveState === "dirty" ||
        currentState.metadata.saveState === "saving" ||
        currentState.workoutSummary.pendingWorkoutIds.length > 0 ||
        currentState.workoutSummary.structuralPauseActive
      ) {
        throw buildCyclePublishNoProgressError();
      }

      return {
        status: "ready",
        draft: multiWeekDraftRef.current,
        metadata: currentState.metadata,
      };
    }
  }, [
    flushAllWorkouts,
    getPersistenceSummary,
    multiWeekDraftRef,
    persistDraftNow,
  ]);

  const beginHydrationTarget = useCallback((identity) => {
    const currentMetadata = draftMetadataRef.current;
    const isDifferentDocument = Boolean(
      currentMetadata.loadedFromBackend &&
      currentMetadata.cycleId &&
      identity?.cycleId &&
      currentMetadata.cycleId !== identity.cycleId
    );

    if (!isDifferentDocument) {
      beginDocumentHydrationTarget(identity);
      return null;
    }

    return (async () => {
      if (
        structuralMutationVersionRef.current >
        lastPersistedStructuralMutationVersionRef.current
      ) {
        await persistDraftNow();
      }

      const { blockedWorkoutIds, blockedReason } = await flushAllWorkouts();
      if (blockedReason || blockedWorkoutIds.length > 0) {
        const error = new Error(
          "Resolve workout autosave errors before opening another cycle draft."
        );
        error.code = "WORKOUT_AUTOSAVE_BLOCKED";
        error.workoutIds = blockedWorkoutIds;
        error.blockedReason = blockedReason || null;
        throw error;
      }

      beginDocumentHydrationTarget(identity);
      return null;
    })();
  }, [
    beginDocumentHydrationTarget,
    draftMetadataRef,
    flushAllWorkouts,
    persistDraftNow,
  ]);

  // The only path back from `saveState === "conflict"`. Explicitly
  // destructive -- discards every unsaved local edit made since the
  // conflict was detected -- so the calling UI must show an explicit
  // confirmation step before invoking this, not call it as a direct,
  // unconfirmed side effect of a single click.
  const reloadLatestAfterConflict = useCallback(async () => {
    const currentMetadata = draftMetadataRef.current;

    if (currentMetadata.saveState !== "conflict" || !currentMetadata.cycleId) {
      return null;
    }

    try {
      const response = await openOrCreateCycleEditDraft(currentMetadata.cycleId, {
        timezone: currentMetadata?.timezone,
        allowCrossDayDraft: currentMetadata?.allowCrossDayDraft,
      });
      // Explicit, user-confirmed discard-and-reload -- force past the
      // local-authority guard the same way DRAFT_EXPIRED recovery does.
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

  const updateProgramMeta = useCallback((updates = {}) => {
    markStructuralMutation();
    setMultiWeekDraft((prev) => ({ ...prev, ...updates }));
  }, [markStructuralMutation]);

  const setSelectedWeek = useCallback((week) => {
    setMultiWeekDraft((prev) => ({ ...prev, selectedWeek: week }));
  }, []);

  const updateWorkoutName = useCallback((workoutId, name) => {
    setMultiWeekDraft((prev) =>
      updateSelectedWeekDraft(prev, (week) => {
        const targetWorkout = week.workouts.find((workout) => workout.id === workoutId);
        if (
          isLockedActiveCycleWorkoutOccurrence({
            draft: prev,
            metadata: draftMetadataRef.current,
            weekNumber: week.weekNumber,
            workout: targetWorkout,
          })
        ) {
          return week;
        }

        return {
          ...week,
          workouts: week.workouts.map((workout) =>
            workout.id === workoutId ? { ...workout, name } : workout
          ),
        };
      })
    );
  }, [draftMetadataRef]);

  const addWorkout = useCallback((name) => {
    markStructuralMutation();
    setMultiWeekDraft((prev) =>
      updateSelectedWeekDraft(prev, (week) => {
        if (week.workouts.length >= prev.sessionsPerWeek) {
          return week;
        }

        const nextIndex = week.workouts.length + 1;
        return {
          ...week,
          workouts: [
            ...week.workouts,
            createWorkout(name || `Workout ${nextIndex}`, false),
          ],
        };
      })
    );
  }, [markStructuralMutation]);

  const moveWorkouts = useCallback((workoutIds, direction) => {
    const selectedIdSet = new Set(Array.isArray(workoutIds) ? workoutIds : []);

    markStructuralMutation();
    setMultiWeekDraft((prev) =>
      updateSelectedWeekDraft(prev, (week) => {
        const nextWorkouts = [...week.workouts];

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
          ...week,
          workouts: nextWorkouts,
        };
      })
    );
  }, [markStructuralMutation]);

  const duplicateWorkouts = useCallback((workoutIds) => {
    const selectedIdSet = new Set(Array.isArray(workoutIds) ? workoutIds : []);

    markStructuralMutation();
    setMultiWeekDraft((prev) =>
      updateSelectedWeekDraft(prev, (week) => {
        if (week.workouts.length + selectedIdSet.size > prev.sessionsPerWeek) {
          return week;
        }

        const nextWorkouts = [];
        const existingWorkoutNames = week.workouts.map((workout) => workout.name);
        week.workouts.forEach((workout) => {
          nextWorkouts.push(workout);
          if (selectedIdSet.has(workout.id)) {
            const duplicateName = getDuplicateWorkoutName(workout.name, existingWorkoutNames);
            existingWorkoutNames.push(duplicateName);
            nextWorkouts.push(cloneWorkoutForDuplicate(workout, duplicateName));
          }
        });

        return {
          ...week,
          workouts: nextWorkouts,
        };
      })
    );
  }, [markStructuralMutation]);

  const removeWorkouts = useCallback((workoutIds) => {
    const selectedIdSet = new Set(Array.isArray(workoutIds) ? workoutIds : []);

    markStructuralMutation();
    setMultiWeekDraft((prev) =>
      updateSelectedWeekDraft(prev, (week) => ({
        ...week,
        workouts: week.workouts.filter((workout) => !selectedIdSet.has(workout.id)),
      }))
    );
  }, [markStructuralMutation]);

  const updateBlock = useCallback((workoutId, blockId, updates) => {
    setMultiWeekDraft((prev) =>
      updateSelectedWeekDraft(prev, (week) => {
        const targetWorkout = week.workouts.find((workout) => workout.id === workoutId);
        if (
          isLockedActiveCycleWorkoutOccurrence({
            draft: prev,
            metadata: draftMetadataRef.current,
            weekNumber: week.weekNumber,
            workout: targetWorkout,
          })
        ) {
          return week;
        }

        return {
          ...week,
          workouts: week.workouts.map((workout) =>
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
        };
      })
    );
  }, [draftMetadataRef]);

  const reorderBlocks = useCallback((workoutId, fromIndex, toIndex) => {
    setMultiWeekDraft((prev) =>
      updateSelectedWeekDraft(prev, (week) => {
        const targetWorkout = week.workouts.find((workout) => workout.id === workoutId);
        if (
          isLockedActiveCycleWorkoutOccurrence({
            draft: prev,
            metadata: draftMetadataRef.current,
            weekNumber: week.weekNumber,
            workout: targetWorkout,
          })
        ) {
          return week;
        }

        return {
          ...week,
          workouts: week.workouts.map((workout) => {
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
        };
      })
    );
  }, [draftMetadataRef]);

  const updateSupersetExercise = useCallback((workoutId, blockId, exerciseIndex, updates) => {
    setMultiWeekDraft((prev) =>
      updateSelectedWeekDraft(prev, (week) => {
        const targetWorkout = week.workouts.find((workout) => workout.id === workoutId);
        if (
          isLockedActiveCycleWorkoutOccurrence({
            draft: prev,
            metadata: draftMetadataRef.current,
            weekNumber: week.weekNumber,
            workout: targetWorkout,
          })
        ) {
          return week;
        }

        return {
          ...week,
          workouts: week.workouts.map((workout) => {
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
        };
      })
    );
  }, [draftMetadataRef]);

  const updateSupersetSetCount = useCallback((workoutId, blockId, nextCount) => {
    const safeCount = clampNumber(nextCount || 1, 1, MAX_BLOCK_SET_COUNT);

    setMultiWeekDraft((prev) =>
      updateSelectedWeekDraft(prev, (week) => {
        const targetWorkout = week.workouts.find((workout) => workout.id === workoutId);
        if (
          isLockedActiveCycleWorkoutOccurrence({
            draft: prev,
            metadata: draftMetadataRef.current,
            weekNumber: week.weekNumber,
            workout: targetWorkout,
          })
        ) {
          return week;
        }

        return {
          ...week,
          workouts: week.workouts.map((workout) => {
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
        };
      })
    );
  }, [draftMetadataRef]);

  const removeBlock = useCallback((workoutId, blockId) => {
    setMultiWeekDraft((prev) =>
      updateSelectedWeekDraft(prev, (week) => {
        const targetWorkout = week.workouts.find((workout) => workout.id === workoutId);
        if (
          isLockedActiveCycleWorkoutOccurrence({
            draft: prev,
            metadata: draftMetadataRef.current,
            weekNumber: week.weekNumber,
            workout: targetWorkout,
          })
        ) {
          return week;
        }

        return {
          ...week,
          workouts: week.workouts.map((workout) =>
            workout.id === workoutId
              ? {
                ...workout,
                blocks: workout.blocks.filter((block) => block.id !== blockId),
              }
              : workout
          ),
        };
      })
    );
  }, [draftMetadataRef]);

  const addSet = useCallback((workoutId, blockId, exerciseIndex = null) => {
    setMultiWeekDraft((prev) =>
      updateSelectedWeekDraft(prev, (week) => {
        const targetWorkout = week.workouts.find((workout) => workout.id === workoutId);
        if (
          isLockedActiveCycleWorkoutOccurrence({
            draft: prev,
            metadata: draftMetadataRef.current,
            weekNumber: week.weekNumber,
            workout: targetWorkout,
          })
        ) {
          return week;
        }

        return {
          ...week,
          workouts: week.workouts.map((workout) => {
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
        };
      })
    );
  }, [draftMetadataRef]);

  const removeSet = useCallback((workoutId, blockId, setIndex, exerciseIndex = null) => {
    setMultiWeekDraft((prev) =>
      updateSelectedWeekDraft(prev, (week) => {
        const targetWorkout = week.workouts.find((workout) => workout.id === workoutId);
        if (
          isLockedActiveCycleWorkoutOccurrence({
            draft: prev,
            metadata: draftMetadataRef.current,
            weekNumber: week.weekNumber,
            workout: targetWorkout,
          })
        ) {
          return week;
        }

        return {
          ...week,
          workouts: week.workouts.map((workout) => {
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
        };
      })
    );
  }, [draftMetadataRef]);

  const moveWorkoutToScheduledDay = useCallback((workoutId, nextScheduledDay) => {
    if (!DAY_OF_WEEK.includes(nextScheduledDay)) {
      return;
    }

    markStructuralMutation();
    setMultiWeekDraft((prev) =>
      updateSelectedWeekDraft(prev, (week) => {
        const workouts = week.workouts || [];
        const movingWorkout = workouts.find((workout) => workout.id === workoutId);
        if (!movingWorkout) {
          return week;
        }
        if (
          isLockedActiveCycleWorkoutOccurrence({
            draft: prev,
            metadata: draftMetadataRef.current,
            weekNumber: week.weekNumber,
            workout: movingWorkout,
          }) ||
          isLockedActiveCycleWorkoutOccurrence({
            draft: prev,
            metadata: draftMetadataRef.current,
            weekNumber: week.weekNumber,
            workout: movingWorkout,
            scheduledDay: nextScheduledDay,
            weekdayIndex: getDayIndex(nextScheduledDay),
          })
        ) {
          return week;
        }

        const targetWorkout = workouts.find(
          (workout) =>
            workout.id !== workoutId && (workout.scheduledDay || null) === nextScheduledDay
        );
        const sourceScheduledDay = movingWorkout.scheduledDay || null;

        return {
          ...week,
          workouts: workouts.map((workout) => {
            if (workout.id === workoutId) {
              return {
                ...workout,
                scheduledDay: nextScheduledDay,
              };
            }

            if (targetWorkout && workout.id === targetWorkout.id) {
              return {
                ...workout,
                scheduledDay: sourceScheduledDay,
              };
            }

            return workout;
          }),
        };
      })
    );
  }, [draftMetadataRef, markStructuralMutation]);

  const moveSelectedWeekWorkoutToScheduledDay = useCallback((orderIndex, nextScheduledDay) => {
    if (!DAY_OF_WEEK.includes(nextScheduledDay)) {
      return;
    }

    markStructuralMutation();
    setMultiWeekDraft((prev) =>
      updateSelectedWeekDraft(prev, (week) => {
        const workouts = week.workouts || [];
        const movingWorkout = workouts.find(
          (workout) => Number(workout.orderIndex) === Number(orderIndex)
        );
        if (!movingWorkout) {
          return week;
        }
        if (
          isLockedActiveCycleWorkoutOccurrence({
            draft: prev,
            metadata: draftMetadataRef.current,
            weekNumber: week.weekNumber,
            workout: movingWorkout,
          }) ||
          isLockedActiveCycleWorkoutOccurrence({
            draft: prev,
            metadata: draftMetadataRef.current,
            weekNumber: week.weekNumber,
            workout: movingWorkout,
            scheduledDay: nextScheduledDay,
            weekdayIndex: getDayIndex(nextScheduledDay),
          })
        ) {
          return week;
        }

        const targetWorkout = workouts.find(
          (workout) =>
            Number(workout.orderIndex) !== Number(orderIndex) &&
            (workout.scheduledDay || null) === nextScheduledDay
        );
        const sourceScheduledDay = movingWorkout.scheduledDay || null;

        return {
          ...week,
          workouts: workouts.map((workout) => {
            if (Number(workout.orderIndex) === Number(orderIndex)) {
              return {
                ...workout,
                scheduledDay: nextScheduledDay,
              };
            }

            if (targetWorkout && workout.id === targetWorkout.id) {
              return {
                ...workout,
                scheduledDay: sourceScheduledDay,
              };
            }

            return workout;
          }),
        };
      })
    );
  }, [draftMetadataRef, markStructuralMutation]);

  const duplicateSelectedWeekWorkout = useCallback((orderIndex, targetScheduledDay = null) => {
    markStructuralMutation();
    setMultiWeekDraft((prev) =>
      updateSelectedWeekDraft(prev, (week) => {
        const workouts = week.workouts || [];
        const sourceWorkout = workouts.find(
          (workout) => Number(workout.orderIndex) === Number(orderIndex)
        );

        if (!sourceWorkout) {
          return week;
        }

        const occupiedDays = new Set(
          workouts.map((workout) => workout.scheduledDay).filter((day) => DAY_OF_WEEK.includes(day))
        );
        const sourceDayIndex = getDayIndex(sourceWorkout.scheduledDay);
        const nextEmptyAfter = DAY_OF_WEEK.find(
          (day, index) => index > sourceDayIndex && !occupiedDays.has(day)
        );
        const nextEmptyBefore = DAY_OF_WEEK.find(
          (day, index) => index < sourceDayIndex && !occupiedDays.has(day)
        );
        const targetDay =
          DAY_OF_WEEK.includes(targetScheduledDay) && !occupiedDays.has(targetScheduledDay)
            ? targetScheduledDay
            : nextEmptyAfter || nextEmptyBefore || null;

        if (!targetDay) {
          return week;
        }
        if (
          isLockedActiveCycleWorkoutOccurrence({
            draft: prev,
            metadata: draftMetadataRef.current,
            weekNumber: week.weekNumber,
            workout: sourceWorkout,
            scheduledDay: targetDay,
            weekdayIndex: getDayIndex(targetDay),
          })
        ) {
          return week;
        }

        const maxOrderIndex = workouts.reduce(
          (maxValue, workout) => Math.max(maxValue, Number(workout.orderIndex) || 0),
          0
        );
        const duplicateName = getDuplicateWorkoutName(
          sourceWorkout.name,
          workouts.map((workout) => workout.name)
        );
        const duplicatedWorkout = cloneWorkoutForDuplicate(sourceWorkout, duplicateName);

        return {
          ...week,
          workouts: [
            ...workouts,
            {
              ...duplicatedWorkout,
              orderIndex: maxOrderIndex + 1,
              scheduledDay: targetDay,
            },
          ],
        };
      })
    );
  }, [draftMetadataRef, markStructuralMutation]);

  const deleteSelectedWeekWorkout = useCallback((orderIndex) => {
    markStructuralMutation();
    setMultiWeekDraft((prev) =>
      updateSelectedWeekDraft(prev, (week) => {
        const targetWorkout = (week.workouts || []).find(
          (workout) => Number(workout.orderIndex) === Number(orderIndex)
        );
        if (
          isLockedActiveCycleWorkoutOccurrence({
            draft: prev,
            metadata: draftMetadataRef.current,
            weekNumber: week.weekNumber,
            workout: targetWorkout,
          })
        ) {
          return week;
        }

        return {
          ...week,
          workouts: (week.workouts || []).filter(
            (workout) => Number(workout.orderIndex) !== Number(orderIndex)
          ),
        };
      })
    );
  }, [draftMetadataRef, markStructuralMutation]);

  const updateSet = useCallback((workoutId, blockId, setIndex, updates, exerciseIndex = null) => {
    const normalizedUpdates = normalizeSetUpdates(updates);

    setMultiWeekDraft((prev) =>
      updateSelectedWeekDraft(prev, (week) => {
        const targetWorkout = week.workouts.find((workout) => workout.id === workoutId);
        if (
          isLockedActiveCycleWorkoutOccurrence({
            draft: prev,
            metadata: draftMetadataRef.current,
            weekNumber: week.weekNumber,
            workout: targetWorkout,
          })
        ) {
          return week;
        }

        return {
          ...week,
          workouts: week.workouts.map((workout) => {
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

                const nextExercises = block.exercises.map((exercise, index) =>
                  index === exerciseIndex
                    ? {
                      ...exercise,
                      sets: exercise.sets.map((set, idx) =>
                        idx === setIndex
                          ? applySetUpdatesWithIntent(set, normalizedUpdates)
                          : set
                      ),
                    }
                    : exercise
                );

                return normalizeSupersetBlock({
                  ...block,
                  exercises: nextExercises,
                });
              }),
            };
          }),
        };
      })
    );
  }, [draftMetadataRef]);

  const appendSingleBlockFromExercise = useCallback((workoutId, exercise) => {
    if (!exercise?.exerciseId || !exercise?.name) {
      return;
    }

    const block =
      String(exercise.trainingType || "").toLowerCase() === "cardio"
        ? createCardioBlockFromExercise(exercise)
        : createSingleBlockFromExercise(exercise);

    setMultiWeekDraft((prev) =>
      updateSelectedWeekDraft(prev, (week) => {
        const targetWorkout = week.workouts.find((workout) => workout.id === workoutId);
        if (
          isLockedActiveCycleWorkoutOccurrence({
            draft: prev,
            metadata: draftMetadataRef.current,
            weekNumber: week.weekNumber,
            workout: targetWorkout,
          })
        ) {
          return week;
        }

        return {
          ...week,
          workouts: week.workouts.map((workout) =>
            workout.id === workoutId
              ? { ...workout, blocks: [...workout.blocks, block] }
              : workout
          ),
        };
      })
    );
  }, [draftMetadataRef]);

  const convertSingleBlockToSuperset = useCallback((workoutId, blockId) => {
    setMultiWeekDraft((prev) =>
      updateSelectedWeekDraft(prev, (week) => {
        const targetWorkout = week.workouts.find((workout) => workout.id === workoutId);
        if (
          isLockedActiveCycleWorkoutOccurrence({
            draft: prev,
            metadata: draftMetadataRef.current,
            weekNumber: week.weekNumber,
            workout: targetWorkout,
          })
        ) {
          return week;
        }

        return {
          ...week,
          workouts: week.workouts.map((workout) => {
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
        };
      })
    );
  }, [draftMetadataRef]);

  const assignSupersetExercise = useCallback((workoutId, blockId, exerciseIndex, exercise) => {
    if (!exercise?.exerciseId || !exercise?.name) {
      return;
    }

    setMultiWeekDraft((prev) =>
      updateSelectedWeekDraft(prev, (week) => {
        const targetWorkout = week.workouts.find((workout) => workout.id === workoutId);
        if (
          isLockedActiveCycleWorkoutOccurrence({
            draft: prev,
            metadata: draftMetadataRef.current,
            weekNumber: week.weekNumber,
            workout: targetWorkout,
          })
        ) {
          return week;
        }

        return {
          ...week,
          workouts: week.workouts.map((workout) => {
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
                        muscleFocus: Array.isArray(exercise.muscleFocus) ? exercise.muscleFocus : [],
                      }
                      : entry
                  ),
                };
              }),
            };
          }),
        };
      })
    );
  }, [draftMetadataRef]);

  const hasIncompleteSupersets = useCallback((workoutId = null) => {
    return (selectedWeek?.workouts || []).some((workout) => {
      if (workoutId && workout.id !== workoutId) {
        return false;
      }

      return workout.blocks.some(
        (block) =>
          block.type === "superset" &&
          block.exercises.some((exercise) => !String(exercise.exerciseId || "").trim())
      );
    });
  }, [selectedWeek]);

  const updateDraftMetadata = useCallback((updates = {}) => {
    setCoordinatorDraftMetadata((prev) => ({ ...prev, ...updates }));
  }, [setCoordinatorDraftMetadata]);

  const value = useMemo(
    () => ({
      programDraft,
      draftMetadata,
      workoutSaveState,
      hydrateProgramDraft,
      beginHydrationTarget,
      handleDraftExpired,
      persistDraftNow,
      prepareCycleDraftForPublish,
      persistWorkoutNow,
      flushWorkout,
      flushAllWorkouts,
      reloadLatestAfterConflict,
      getMultiWeekTodayDateKey: () =>
        getMultiWeekTodayDateKey(draftMetadataRef.current, multiWeekDraftRef.current),
      updateProgramMeta,
      setSelectedWeek,
      updateWorkoutName,
      addWorkout,
      moveWorkouts,
      duplicateWorkouts,
      removeWorkouts,
      updateBlock,
      reorderBlocks,
      updateSupersetExercise,
      updateSupersetSetCount,
      removeBlock,
      moveWorkoutToScheduledDay,
      moveSelectedWeekWorkoutToScheduledDay,
      duplicateSelectedWeekWorkout,
      deleteSelectedWeekWorkout,
      addSet,
      removeSet,
      updateSet,
      appendSingleBlockFromExercise,
      convertSingleBlockToSuperset,
      assignSupersetExercise,
      hasIncompleteSupersets,
      updateDraftMetadata,
    }),
    [
      programDraft,
      draftMetadata,
      workoutSaveState,
      draftMetadataRef,
      multiWeekDraftRef,
      hydrateProgramDraft,
      beginHydrationTarget,
      handleDraftExpired,
      persistDraftNow,
      prepareCycleDraftForPublish,
      persistWorkoutNow,
      flushWorkout,
      flushAllWorkouts,
      reloadLatestAfterConflict,
      updateProgramMeta,
      setSelectedWeek,
      updateWorkoutName,
      addWorkout,
      moveWorkouts,
      duplicateWorkouts,
      removeWorkouts,
      updateBlock,
      reorderBlocks,
      updateSupersetExercise,
      updateSupersetSetCount,
      removeBlock,
      moveWorkoutToScheduledDay,
      moveSelectedWeekWorkoutToScheduledDay,
      duplicateSelectedWeekWorkout,
      deleteSelectedWeekWorkout,
      addSet,
      removeSet,
      updateSet,
      appendSingleBlockFromExercise,
      convertSingleBlockToSuperset,
      assignSupersetExercise,
      hasIncompleteSupersets,
      updateDraftMetadata,
    ]
  );

  return (
    <MultiWeekProgramContext.Provider value={value}>
      {children}
    </MultiWeekProgramContext.Provider>
  );
}

export function useMultiWeekProgram() {
  const context = useContext(MultiWeekProgramContext);

  if (!context) {
    throw new Error("useMultiWeekProgram must be used within MultiWeekProgramProvider");
  }

  return context;
}
