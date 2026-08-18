import { useMemo } from "react";
import { mapWeeklyPlanWorkoutToApi } from "../features/weeklyPlans/mappers";
import { saveWeeklyPlanWorkoutContent } from "../services/api";
import { attachBlockUiKeys } from "../utils/blockUiKeys";
import {
  reconcileCanonicalWorkoutIdentities,
  useWorkoutAutosaveCoordinator,
} from "./useWorkoutAutosaveCoordinator";

function snapshotsEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function serializeSnapshot(workout, workoutIndex) {
  return mapWeeklyPlanWorkoutToApi(workout, workoutIndex);
}

function serializeContentSnapshot(workout) {
  const {
    id: _id,
    orderIndex: _orderIndex,
    ...content
  } = serializeSnapshot(workout, 0);
  return content;
}

function getWorkoutEntries(draft) {
  return (draft?.workouts || []).flatMap((workout, workoutIndex) => (
    workout?.id ? [{ workout, workoutIndex }] : []
  ));
}

function findWorkoutEntry(draft, workoutId) {
  return getWorkoutEntries(draft).find(({ workout }) => workout.id === workoutId) || null;
}

function replaceWorkout(draft, workoutId, nextWorkout) {
  let didReplace = false;
  const workouts = (draft?.workouts || []).map((workout) => {
    if (workout.id !== workoutId) {
      return workout;
    }
    didReplace = true;
    return nextWorkout;
  });
  return didReplace ? { ...draft, workouts } : draft;
}

function buildStructuralWorkoutMatches(sentDraft, canonicalDraft) {
  const remainingCanonical = [...(canonicalDraft?.workouts || [])];
  const matches = new Map();

  (sentDraft?.workouts || []).forEach((sentWorkout, workoutIndex) => {
    let canonicalIndex = remainingCanonical.findIndex(
      (workout) => workout.id && workout.id === sentWorkout.id
    );
    if (canonicalIndex < 0) {
      // The API serializer derives orderIndex from array position. Newly
      // added/duplicated UI workouts can have no persisted orderIndex (or an
      // inherited stale one), so correlate their canonical row against the
      // exact sent position rather than the raw UI field.
      canonicalIndex = remainingCanonical.findIndex(
        (workout) => Number(workout.orderIndex) === workoutIndex + 1
      );
    }
    if (canonicalIndex < 0 && remainingCanonical.length > 0) {
      canonicalIndex = 0;
    }

    const canonicalWorkout = canonicalIndex >= 0
      ? remainingCanonical.splice(canonicalIndex, 1)[0]
      : null;
    if (sentWorkout.id && canonicalWorkout) {
      matches.set(sentWorkout.id, {
        canonicalWorkout,
        sentWorkout,
        sentWorkoutIndex: workoutIndex,
      });
    }
  });

  return matches;
}

export function reconcileStructuralWeeklyPlanDraft(
  currentDraft,
  sentDraft,
  canonicalDraft
) {
  const matches = buildStructuralWorkoutMatches(sentDraft, canonicalDraft);
  const workoutResults = [];
  const workouts = (currentDraft?.workouts || []).map((currentWorkout, workoutIndex) => {
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
      workoutIndex !== match.sentWorkoutIndex ||
      currentWorkout.orderIndex !== match.sentWorkout.orderIndex;
    const nextWorkout = {
      ...reconciledWorkout,
      id: match.canonicalWorkout.id,
      contentRevision: match.canonicalWorkout.contentRevision,
      orderIndex: hasNewerPlacement
        ? currentWorkout.orderIndex
        : match.canonicalWorkout.orderIndex,
    };

    workoutResults.push({
      canonicalWorkout: match.canonicalWorkout,
      hasNewerContent,
      nextWorkout,
      oldWorkoutId: currentWorkout.id,
    });
    return nextWorkout;
  });

  const nextDraft = { ...currentDraft, workouts };
  ["programName", "sessionsPerWeek"].forEach((field) => {
    if (currentDraft?.[field] === sentDraft?.[field]) {
      nextDraft[field] = canonicalDraft?.[field];
    }
  });

  return { draft: nextDraft, workoutResults };
}

export function useWeeklyPlanWorkoutAutosaveCoordinator({
  enabled,
  programDraft,
  setProgramDraft,
  draftMetadata,
  setDraftMetadata,
  documentMetadataRef,
  structuralMutationVersion,
}) {
  const adapter = useMemo(() => ({
    findWorkoutEntry,
    getResponseDocumentRevision: (response) => response.versionRevision,
    getWorkoutEntries,
    isDocumentReady: (metadata) => Boolean(
      metadata?.loadedFromBackend &&
      metadata?.weeklyPlanParentId &&
      metadata?.weeklyPlanVersionId
    ),
    persistWorkoutContent: ({
      metadata,
      workoutId,
      contentRevision,
      workout,
    }) => saveWeeklyPlanWorkoutContent(
      metadata.weeklyPlanParentId,
      metadata.weeklyPlanVersionId,
      workoutId,
      { contentRevision, workout }
    ),
    reconcileStructuralDraft: reconcileStructuralWeeklyPlanDraft,
    replaceWorkout,
    serializeContentSnapshot,
    serializeSnapshot,
  }), []);

  return useWorkoutAutosaveCoordinator({
    enabled,
    draft: programDraft,
    setDraft: setProgramDraft,
    draftMetadata,
    setDraftMetadata,
    documentMetadataRef,
    structuralMutationVersion,
    adapter,
  });
}
