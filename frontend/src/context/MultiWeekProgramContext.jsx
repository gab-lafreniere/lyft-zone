import {
  createContext,
  useCallback,
  useContext,
  useEffect,
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

function sameIdentity(a, b) {
  return Boolean(a && b && a.cycleId === b.cycleId && a.planId === b.planId);
}

// A hydration target is declared before its planId is knowable (the draft
// plan is resolved server-side by openOrCreateCycleEditDraft), so the
// hydrate-response mismatch check can only compare the outer key -- unlike
// sameIdentity, which requires both fields and is for the already-loaded
// same-document check and the send-side abort check, where both sides
// always have a fully-resolved identity by the time they run.
function sameRequestedCycle(target, responseIdentity) {
  return Boolean(target && responseIdentity && target.cycleId === responseIdentity.cycleId);
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
  const multiWeekDraftRef = useRef(multiWeekDraft);
  const draftMetadataRef = useRef(draftMetadata);
  const draftRecoveryPromiseRef = useRef(null);
  const saveRequestIdRef = useRef(0);
  const latestAppliedSaveRequestIdRef = useRef(0);
  const saveInFlightPromiseRef = useRef(null);
  const pendingSaveRequestedRef = useRef(false);

  // Identity refs (plan §D): `loadedIdentityRef` is what's truly reflected in
  // `multiWeekDraft`/`draftMetadata` right now; `targetIdentityRef` is what
  // the user currently wants to be viewing/editing. A debounced save
  // captures its target identity at the moment it's scheduled and
  // revalidates it against `targetIdentityRef.current` immediately before
  // sending, so a save for a document the user has since navigated away from
  // is silently aborted instead of being sent to the wrong row.
  const loadedIdentityRef = useRef(null);
  const targetIdentityRef = useRef(null);

  useEffect(() => {
    multiWeekDraftRef.current = multiWeekDraft;
  }, [multiWeekDraft]);

  useEffect(() => {
    draftMetadataRef.current = draftMetadata;
  }, [draftMetadata]);

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

  // The only way targetIdentityRef is ever set ahead of a fetch dispatching.
  // Callers that are about to open a (possibly different) cycle must call
  // this synchronously, before starting the fetch -- planId is left null
  // since it isn't resolved until openOrCreateCycleEditDraft returns.
  // hydrateProgramDraft compares an arriving response's cycleId against
  // whatever was most recently declared here; a response for a cycleId a
  // newer call here has since superseded is dropped rather than applied.
  const beginHydrationTarget = useCallback((identity) => {
    targetIdentityRef.current = identity;
  }, []);

  const hydrateProgramDraft = useCallback((response, options = {}) => {
    const nextState = mapCycleBuilderPayload(response);
    const responseIdentity = {
      cycleId: nextState.metadata.cycleId,
      planId: nextState.metadata.cyclePlanId,
    };

    if (!options.force) {
      const declaredTarget = targetIdentityRef.current;
      const isStaleAgainstDeclaredTarget =
        declaredTarget != null && !sameRequestedCycle(declaredTarget, responseIdentity);

      if (isStaleAgainstDeclaredTarget) {
        // A newer beginHydrationTarget() call has already superseded this
        // fetch's target since it was dispatched -- this response is for a
        // cycle the user is no longer requesting. Drop it entirely (no
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
          // whatever the user is mid-editing (this is the fix for the
          // reproduced navigation-revert bug), or silently resolve a
          // conflict without the user's explicit confirmation.
          return;
        }
      }
    }

    setMultiWeekDraft((prev) => ({
      ...nextState.programDraft,
      weeks: attachUiKeysToWeeks(
        nextState.programDraft.weeks || [],
        prev.weeks || []
      ),
      selectedWeek: resolvePreservedSelectedWeek(prev.selectedWeek, nextState.programDraft),
    }));
    setDraftMetadata({
      ...createInitialDraftMetadata(),
      ...nextState.metadata,
    });
    loadedIdentityRef.current = responseIdentity;
    // A response that was just applied (whether it passed the checks above
    // or arrived via force:true) is, by definition, now what the user is
    // looking at -- keep the target in sync so later callers (the send-side
    // check in persistDraftNow, and the next hydrateProgramDraft call) see a
    // fully-resolved identity rather than the pre-dispatch partial one.
    targetIdentityRef.current = responseIdentity;
  }, []);

  const handleDraftExpired = useCallback(async (error, cycleIdOverride = null) => {
    if (error?.code !== "DRAFT_EXPIRED") {
      return false;
    }

    if (draftRecoveryPromiseRef.current) {
      await draftRecoveryPromiseRef.current;
      return true;
    }

    const currentMetadata = draftMetadataRef.current;
    const resolvedCycleId = cycleIdOverride || currentMetadata?.cycleId || null;
    const recoveryFailureMessage = "Unable to recover draft. Please refresh the page.";

    if (!resolvedCycleId) {
      setDraftMetadata((prev) => ({
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
      setDraftMetadata((prev) => ({
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
        hydrateProgramDraft(response, { force: true });
        return response;
      } catch (recoveryError) {
        setDraftMetadata((prev) => ({
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
  }, [hydrateProgramDraft]);

  // `DRAFT_REVISION_CONFLICT` is deliberately NOT the same recovery path as
  // `DRAFT_EXPIRED` above: it must never silently discard local content.
  // This handler only sets state -- it does not touch multiWeekDraft and
  // does not auto-retry. The only way out of "conflict" is the user
  // explicitly confirming reloadLatestAfterConflict().
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
      setDraftMetadata((prev) => ({
        ...prev,
        saveState: "error",
        lastSaveErrorMessage: reloadError?.message || "Unable to reload draft. Please refresh the page.",
        lastSaveErrorCode: reloadError?.code || null,
      }));
      return null;
    }
  }, [hydrateProgramDraft]);

  const persistDraftNow = useCallback(async (overrideDraft = null, overrideIdentity = null) => {
    const currentMetadata = draftMetadataRef.current;
    const currentPlanId = currentMetadata?.cyclePlanId || null;
    if (currentMetadata?.isRecoveringDraft) {
      return null;
    }

    if (
      !currentMetadata.loadedFromBackend ||
      !currentMetadata.cycleId ||
      !currentPlanId
    ) {
      return null;
    }

    const identity = overrideIdentity || {
      cycleId: currentMetadata.cycleId,
      planId: currentPlanId,
    };

    const nextDraft = overrideDraft || multiWeekDraftRef.current;
    const payload = mapMultiWeekDraftToApi(nextDraft);
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
      prev.saveState === "saving"
        ? prev
        : {
          ...prev,
          saveState: "saving",
        }
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

      const response = await updateCycleDraft(identity.cycleId, identity.planId, {
        ...payload,
        allowCrossDayDraft: currentMetadata.allowCrossDayDraft,
        revision: currentMetadata.revision,
      });

      if (!isStillCurrentTarget()) {
        return response;
      }

      const currentSignature = JSON.stringify(
        mapMultiWeekDraftToApi(multiWeekDraftRef.current)
      );
      const hasNewerLocalEdits = currentSignature !== signature;
      const isOlderThanAppliedResponse =
        requestId < latestAppliedSaveRequestIdRef.current;

      if (hasNewerLocalEdits || isOlderThanAppliedResponse) {
        setDraftMetadata((prev) => {
          const latestLocalSignature = JSON.stringify(
            mapMultiWeekDraftToApi(multiWeekDraftRef.current)
          );
          const hasUnsavedLocalEdits =
            latestLocalSignature !== prev.lastPersistedSignature;

          if (!hasUnsavedLocalEdits) {
            return prev;
          }

          const hasNewerSaveRequestInFlight = requestId < saveRequestIdRef.current;
          const nextSaveState = hasNewerSaveRequestInFlight ? "saving" : "dirty";

          return prev.saveState === nextSaveState
            ? prev
            : {
              ...prev,
              saveState: nextSaveState,
            };
        });

        return response;
      }

      latestAppliedSaveRequestIdRef.current = requestId;
      const activePlanId = response?.planId || null;
      const nextState = mapCycleBuilderPayload(response);
      setMultiWeekDraft((prev) => ({
        ...nextState.programDraft,
        weeks: attachUiKeysToWeeks(
          nextState.programDraft.weeks || [],
          prev.weeks || []
        ),
        selectedWeek: resolvePreservedSelectedWeek(prev.selectedWeek, nextState.programDraft),
      }));
      setDraftMetadata((prev) => ({
        ...prev,
        ...nextState.metadata,
        cycleId: nextState.metadata.cycleId,
        cyclePlanId: activePlanId || nextState.metadata.cyclePlanId,
        lastSavedAt: response.updatedAt || new Date().toISOString(),
        saveState: "saved",
        lastSaveErrorMessage: null,
        lastSaveErrorCode: null,
      }));
      loadedIdentityRef.current = {
        cycleId: nextState.metadata.cycleId,
        planId: activePlanId || nextState.metadata.cyclePlanId,
      };

      return response;
    };

    const savePromise = (async () => {
      let saveError = null;
      let result = null;

      try {
        result = await runSave();
      } catch (error) {
        if (error?.code === "DRAFT_REVISION_CONFLICT") {
          saveError = error;
          handleRevisionConflict(error);
        } else {
          const didRecoverDraft = await handleDraftExpired(error, currentMetadata?.cycleId || null);

          if (!didRecoverDraft) {
            saveError = error;
            setDraftMetadata((prev) => (
              prev.saveState === "error"
                ? prev
                : {
                  ...prev,
                  saveState: "error",
                  lastSaveErrorMessage: error?.message || "Unable to autosave this draft.",
                  lastSaveErrorCode: error?.code || null,
                }
            ));
          }
        }
      } finally {
        saveInFlightPromiseRef.current = null;
      }

      let followUpPromise = null;

      if (pendingSaveRequestedRef.current) {
        pendingSaveRequestedRef.current = false;
        const latestMetadata = draftMetadataRef.current;

        if (!latestMetadata?.isRecoveringDraft && latestMetadata?.saveState !== "conflict") {
          const latestDraft = multiWeekDraftRef.current;
          const latestSignature = JSON.stringify(mapMultiWeekDraftToApi(latestDraft));

          if (latestSignature !== latestMetadata.lastPersistedSignature) {
            // Chain the coalesced follow-up onto this promise, built from the
            // freshest snapshot, so a single `await persistDraftNow()` (e.g.
            // a publish flush) resolves only once the follow-up also
            // settles, not just this leg.
            followUpPromise = persistDraftNow(latestDraft).catch((queuedError) => {
              console.error("[MultiWeekProgramContext] queued autosave failed", {
                cycleId: draftMetadataRef.current?.cycleId || null,
                cyclePlanId: draftMetadataRef.current?.cyclePlanId || null,
                errorCode: queuedError?.code || null,
                errorMessage: queuedError?.message || null,
              });
              throw queuedError;
            });
          }
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
  }, [handleDraftExpired, handleRevisionConflict]);

  useEffect(() => {
    if (
      draftMetadataRef.current.isRecoveringDraft ||
      !draftMetadata.loadedFromBackend ||
      !draftMetadata.cycleId ||
      !draftMetadata.cyclePlanId ||
      draftMetadataRef.current.saveState === "conflict"
    ) {
      // While conflicted, autosave is suspended entirely -- retrying with
      // the same known-stale revision would just conflict again. The user
      // keeps editing normally (multiWeekDraft still updates); this effect
      // just never re-arms until reloadLatestAfterConflict() resolves it.
      // Same reasoning for isRecoveringDraft: a *failed* DRAFT_EXPIRED
      // recovery sets isRecoveringDraft:false and saveState:"error" in the
      // same setDraftMetadata call, from inside this effect's own dispatched
      // save. If isRecoveringDraft were a dependency, that transition would
      // re-run this effect, and its own dirty-fallback below (which treats
      // any non-saving/non-dirty state as "must be dirty") would stomp the
      // freshly-set "error" state right back to "dirty" and silently
      // re-arm a save of a pre-recovery-failure snapshot. Reading both
      // flags from the ref (not as dependencies) avoids that loop; any
      // genuine new edit still re-runs this effect via the multiWeekDraft
      // dependency below, so recovery completing (success or failure) is
      // still correctly picked up on the next real edit.
      return undefined;
    }

    const signature = JSON.stringify(mapMultiWeekDraftToApi(multiWeekDraft));
    if (signature === draftMetadata.lastPersistedSignature) {
      return undefined;
    }

    setDraftMetadata((prev) => {
      if (prev.saveState === "saving" || prev.saveState === "dirty") {
        return prev;
      }

      return {
        ...prev,
        saveState: "dirty",
      };
    });

    // Capture the draft content and the identity it belongs to together, at
    // the moment this edit armed the timer -- not read fresh from a ref when
    // the timer fires. `persistDraftNow` revalidates this identity against
    // `targetIdentityRef.current` right before sending, which is what
    // actually protects against a stale send after the user has navigated
    // away within the debounce window.
    const draftSnapshot = multiWeekDraft;
    const identitySnapshot = {
      cycleId: draftMetadata.cycleId,
      planId: draftMetadata.cyclePlanId,
    };

    const timeoutId = window.setTimeout(() => {
      persistDraftNow(draftSnapshot, identitySnapshot).catch((error) => {
        console.error("[MultiWeekProgramContext] autosave failed", {
          cycleId: draftMetadataRef.current?.cycleId || null,
          cyclePlanId: draftMetadataRef.current?.cyclePlanId || null,
          errorCode: error?.code || null,
          errorMessage: error?.message || null,
        });
      });
    }, 700);

    return () => window.clearTimeout(timeoutId);
  }, [
    draftMetadata.cycleId,
    draftMetadata.cyclePlanId,
    draftMetadata.lastPersistedSignature,
    draftMetadata.loadedFromBackend,
    multiWeekDraft,
    persistDraftNow,
  ]);

  const updateProgramMeta = useCallback((updates = {}) => {
    setMultiWeekDraft((prev) => ({ ...prev, ...updates }));
  }, []);

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
  }, []);

  const addWorkout = useCallback((name) => {
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
  }, []);

  const moveWorkouts = useCallback((workoutIds, direction) => {
    const selectedIdSet = new Set(Array.isArray(workoutIds) ? workoutIds : []);

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
  }, []);

  const duplicateWorkouts = useCallback((workoutIds) => {
    const selectedIdSet = new Set(Array.isArray(workoutIds) ? workoutIds : []);

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
  }, []);

  const removeWorkouts = useCallback((workoutIds) => {
    const selectedIdSet = new Set(Array.isArray(workoutIds) ? workoutIds : []);

    setMultiWeekDraft((prev) =>
      updateSelectedWeekDraft(prev, (week) => ({
        ...week,
        workouts: week.workouts.filter((workout) => !selectedIdSet.has(workout.id)),
      }))
    );
  }, []);

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
  }, []);

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
  }, []);

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
  }, []);

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
  }, []);

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
  }, []);

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
  }, []);

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
  }, []);

  const moveWorkoutToScheduledDay = useCallback((workoutId, nextScheduledDay) => {
    if (!DAY_OF_WEEK.includes(nextScheduledDay)) {
      return;
    }

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
  }, []);

  const moveSelectedWeekWorkoutToScheduledDay = useCallback((orderIndex, nextScheduledDay) => {
    if (!DAY_OF_WEEK.includes(nextScheduledDay)) {
      return;
    }

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
  }, []);

  const duplicateSelectedWeekWorkout = useCallback((orderIndex, targetScheduledDay = null) => {
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
  }, []);

  const deleteSelectedWeekWorkout = useCallback((orderIndex) => {
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
  }, []);

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
  }, []);

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
  }, []);

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
  }, []);

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
  }, []);

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
    setDraftMetadata((prev) => ({ ...prev, ...updates }));
  }, []);

  const value = useMemo(
    () => ({
      programDraft,
      draftMetadata,
      hydrateProgramDraft,
      beginHydrationTarget,
      handleDraftExpired,
      persistDraftNow,
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
      hydrateProgramDraft,
      beginHydrationTarget,
      handleDraftExpired,
      persistDraftNow,
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
