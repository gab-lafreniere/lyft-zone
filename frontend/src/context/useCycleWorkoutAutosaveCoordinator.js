import { useMemo } from "react";
import { mapCycleWorkoutToApi } from "../features/multiWeek/mappers";
import { saveCycleWorkoutContent } from "../services/api";
import { attachBlockUiKeys } from "../utils/blockUiKeys";
import {
  reconcileCanonicalWorkoutIdentities,
  useWorkoutAutosaveCoordinator,
} from "./useWorkoutAutosaveCoordinator";

function snapshotsEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function serializeSnapshot(workout, workoutIndex) {
  return mapCycleWorkoutToApi(workout, workoutIndex);
}

function serializeContentSnapshot(workout) {
  const {
    id: _id,
    orderIndex: _orderIndex,
    scheduledDay: _scheduledDay,
    ...content
  } = serializeSnapshot(workout, 0);
  return content;
}

function getWorkoutEntries(draft) {
  const entries = [];

  (draft?.weeks || []).forEach((week, weekIndex) => {
    (week.workouts || []).forEach((workout, workoutIndex) => {
      if (workout?.id) {
        entries.push({ week, weekIndex, workoutIndex, workout });
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

function findMatchingWeek(weeks, sentWeek, weekIndex) {
  return (weeks || []).find((week) => week.id && week.id === sentWeek?.id) ||
    (weeks || []).find((week) => week.weekNumber === sentWeek?.weekNumber) ||
    (weeks || [])[weekIndex] ||
    null;
}

function buildStructuralWorkoutMatches(sentDraft, canonicalDraft) {
  const matches = new Map();

  (sentDraft?.weeks || []).forEach((sentWeek, weekIndex) => {
    const canonicalWeek = findMatchingWeek(canonicalDraft?.weeks, sentWeek, weekIndex);
    const remainingCanonical = [...(canonicalWeek?.workouts || [])];

    (sentWeek.workouts || []).forEach((sentWorkout, workoutIndex) => {
      let canonicalIndex = remainingCanonical.findIndex(
        (workout) => workout.id && workout.id === sentWorkout.id
      );
      if (canonicalIndex < 0) {
        canonicalIndex = remainingCanonical.findIndex(
          (workout) => Number(workout.orderIndex) === Number(sentWorkout.orderIndex)
        );
      }
      if (canonicalIndex < 0 && remainingCanonical[workoutIndex]) {
        canonicalIndex = workoutIndex;
      }

      const canonicalWorkout = canonicalIndex >= 0
        ? remainingCanonical.splice(canonicalIndex, 1)[0]
        : null;
      if (sentWorkout.id && canonicalWorkout) {
        matches.set(sentWorkout.id, {
          canonicalWeek,
          canonicalWorkout,
          sentWeek,
          sentWorkout,
          sentWorkoutIndex: workoutIndex,
        });
      }
    });
  });

  return matches;
}

export function reconcileStructuralCycleDraft(currentDraft, sentDraft, canonicalDraft) {
  const matches = buildStructuralWorkoutMatches(sentDraft, canonicalDraft);
  const workoutResults = [];
  const nextWeeks = (currentDraft?.weeks || []).map((currentWeek, currentWeekIndex) => {
    const sentWeek = findMatchingWeek(sentDraft?.weeks, currentWeek, currentWeekIndex);
    const canonicalWeek = sentWeek
      ? findMatchingWeek(canonicalDraft?.weeks, sentWeek, currentWeekIndex)
      : null;

    const workouts = (currentWeek.workouts || []).map((currentWorkout, workoutIndex) => {
      const match = matches.get(currentWorkout.id);
      if (!match) {
        return currentWorkout;
      }

      const hasNewerContent = !snapshotsEqual(
        serializeContentSnapshot(currentWorkout),
        serializeContentSnapshot(match.sentWorkout)
      );
      const reconciledWorkout = hasNewerContent
        ? reconcileCanonicalWorkoutIdentities(
          currentWorkout,
          serializeSnapshot(match.sentWorkout, match.sentWorkoutIndex),
          match.canonicalWorkout
        )
        : {
          ...match.canonicalWorkout,
          blocks: attachBlockUiKeys(
            match.canonicalWorkout.blocks || [],
            currentWorkout.blocks || []
          ),
        };
      const hasNewerPlacement =
        currentWeek.weekNumber !== match.sentWeek.weekNumber ||
        workoutIndex !== match.sentWorkoutIndex ||
        currentWorkout.orderIndex !== match.sentWorkout.orderIndex ||
        (currentWorkout.scheduledDay || null) !== (match.sentWorkout.scheduledDay || null);
      const nextWorkout = {
        ...reconciledWorkout,
        id: match.canonicalWorkout.id,
        contentRevision: match.canonicalWorkout.contentRevision,
        orderIndex: hasNewerPlacement
          ? currentWorkout.orderIndex
          : match.canonicalWorkout.orderIndex,
        scheduledDay: hasNewerPlacement
          ? currentWorkout.scheduledDay
          : match.canonicalWorkout.scheduledDay,
      };

      workoutResults.push({
        canonicalWorkout: match.canonicalWorkout,
        hasNewerContent,
        nextWorkout,
        oldWorkoutId: currentWorkout.id,
      });
      return nextWorkout;
    });

    if (!sentWeek || !canonicalWeek) {
      return { ...currentWeek, workouts };
    }

    const nextWeek = { ...currentWeek, id: canonicalWeek.id, workouts };
    ["weekNumber", "orderIndex", "label", "notes"].forEach((field) => {
      if (currentWeek[field] === sentWeek[field]) {
        nextWeek[field] = canonicalWeek[field];
      }
    });
    return nextWeek;
  });
  const nextDraft = { ...currentDraft, weeks: nextWeeks };

  [
    "programName",
    "sessionsPerWeek",
    "programLength",
    "durationWeeks",
    "startDate",
    "endDate",
  ].forEach((field) => {
    if (currentDraft?.[field] === sentDraft?.[field]) {
      nextDraft[field] = canonicalDraft?.[field];
    }
  });

  return { draft: nextDraft, workoutResults };
}

export function useCycleWorkoutAutosaveCoordinator({
  multiWeekDraft,
  setMultiWeekDraft,
  draftMetadata,
  setDraftMetadata,
  documentMetadataRef,
  structuralMutationVersion,
  handleDraftExpired,
}) {
  const adapter = useMemo(() => ({
    findWorkoutEntry,
    getResponseDocumentRevision: (response) => response.planRevision,
    getWorkoutEntries,
    handleSpecialSaveError: async (error, context) => {
      if (error?.code !== "DRAFT_EXPIRED") {
        return false;
      }
      context.rebaseWorkoutDirtyDetectionBaseline(context.draft, { resetState: true });
      await handleDraftExpired(error, context.metadata?.cycleId || null);
      return true;
    },
    isDocumentReady: (metadata) => Boolean(
      metadata?.loadedFromBackend && metadata?.cycleId && metadata?.cyclePlanId
    ),
    persistWorkoutContent: ({
      metadata,
      workoutId,
      contentRevision,
      workout,
    }) => saveCycleWorkoutContent(
      metadata.cycleId,
      metadata.cyclePlanId,
      workoutId,
      {
        contentRevision,
        allowCrossDayDraft: metadata.allowCrossDayDraft,
        timezone: metadata.timezone,
        workout,
      }
    ),
    reconcileStructuralDraft: reconcileStructuralCycleDraft,
    replaceWorkout,
    serializeContentSnapshot,
    serializeSnapshot,
  }), [handleDraftExpired]);

  return useWorkoutAutosaveCoordinator({
    draft: multiWeekDraft,
    setDraft: setMultiWeekDraft,
    draftMetadata,
    setDraftMetadata,
    documentMetadataRef,
    structuralMutationVersion,
    adapter,
  });
}
