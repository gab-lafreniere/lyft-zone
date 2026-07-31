import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useManualProgram } from "../../../context/ManualProgramContext";
import Button from "../../../ui/Button";
import {
  getManualBuilderPath,
  getWeeklyPlansPath,
} from "../routes";

const STRATEGY_FALLBACK =
  "Ton programme a été généré et validé à partir de ton Training Profile.";

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isOptionalString(value) {
  return value === null || typeof value === "string";
}

function isStringArray(value) {
  return (
    Array.isArray(value) &&
    value.every(
      (entry) => typeof entry === "string" && Boolean(entry.trim())
    )
  );
}

function isNonNegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function isPresentationWorkout(workout) {
  return (
    isObject(workout) &&
    Number.isSafeInteger(workout.orderIndex) &&
    workout.orderIndex > 0 &&
    isOptionalString(workout.name) &&
    isOptionalString(workout.focus) &&
    (workout.calculatedDurationMinutes === null ||
      isNonNegativeInteger(workout.calculatedDurationMinutes)) &&
    isNonNegativeInteger(workout.exerciseCount) &&
    isNonNegativeInteger(workout.workingSetCount)
  );
}

function getSupportedPresentation(generationResult) {
  const presentation = generationResult?.aiPresentation;
  const focusAreas = presentation?.focusAreas;

  if (
    !isObject(presentation) ||
    presentation.schemaVersion !== 1 ||
    !isOptionalString(presentation.strategySummary) ||
    !isOptionalString(presentation.splitType) ||
    !isObject(focusAreas) ||
    !isStringArray(focusAreas.primary) ||
    !isStringArray(focusAreas.secondary) ||
    !isStringArray(focusAreas.deprioritized) ||
    !Array.isArray(presentation.workouts) ||
    !presentation.workouts.every(isPresentationWorkout)
  ) {
    return null;
  }

  return presentation;
}

function formatIdentifier(value) {
  if (typeof value !== "string") {
    return "";
  }

  const normalized = value.trim().replaceAll("_", " ").toLowerCase();
  return normalized
    ? normalized.charAt(0).toUpperCase() + normalized.slice(1)
    : "";
}

function formatCount(value, singular, plural) {
  return `${value} ${value === 1 ? singular : plural}`;
}

function PriorityCategory({ label, values }) {
  if (!values.length) {
    return null;
  }

  return (
    <div className="rounded-2xl bg-slate-50 p-3">
      <dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">
        {label}
      </dt>
      <dd className="mt-1 text-sm font-bold text-slate-800">
        {values.map(formatIdentifier).join(", ")}
      </dd>
    </div>
  );
}

function DetailedWorkoutPreview({ workouts }) {
  return (
    <ul className="space-y-3" aria-label="Aperçu des séances">
      {workouts.map((workout, index) => (
        <li
          key={`${workout.orderIndex}-${workout.name || index}`}
          className="rounded-2xl border border-slate-100 bg-slate-50 p-4"
        >
          <div>
            <p className="font-bold text-slate-900">
              {workout.name || `Séance ${index + 1}`}
            </p>
            {workout.focus ? (
              <p className="mt-1 text-sm leading-5 text-slate-500">
                {workout.focus}
              </p>
            ) : null}
          </div>
          <div className="mt-3 flex flex-wrap gap-2 text-xs font-semibold text-slate-600">
            <span className="rounded-full bg-white px-3 py-1.5">
              {workout.calculatedDurationMinutes === null
                ? "Durée non disponible"
                : `${workout.calculatedDurationMinutes} min`}
            </span>
            <span className="rounded-full bg-white px-3 py-1.5">
              {formatCount(workout.exerciseCount, "exercice", "exercices")}
            </span>
            <span className="rounded-full bg-white px-3 py-1.5">
              {formatCount(
                workout.workingSetCount,
                "série de travail",
                "séries de travail"
              )}
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}

function MinimalWorkoutPreview({ workouts }) {
  if (!workouts.length) {
    return (
      <p className="text-sm text-slate-500">
        Le programme a été créé sans aperçu de séance disponible.
      </p>
    );
  }

  return (
    <ul className="space-y-2" aria-label="Aperçu des séances">
      {workouts.map((workout, index) => (
        <li
          key={workout?.id || `${workout?.name}-${index}`}
          className="rounded-2xl bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-800"
        >
          {workout?.name || `Séance ${index + 1}`}
        </li>
      ))}
    </ul>
  );
}

export default function AIBuilderResult({ generationResult, backTarget }) {
  const navigate = useNavigate();
  const { hydrateProgramDraft } = useManualProgram();
  const [isLeavingForEdit, setIsLeavingForEdit] = useState(false);
  const editHandledRef = useRef(false);
  const presentation = getSupportedPresentation(generationResult);
  const builderPayload = generationResult?.builderPayload || {};
  const builderWorkouts = Array.isArray(builderPayload.workouts)
    ? builderPayload.workouts
    : [];
  const sessionsPerWeek =
    builderPayload.sessionsPerWeek ?? builderWorkouts.length;
  const presentationWorkouts = presentation?.workouts || [];
  const hasDetailedWorkoutPreview = presentationWorkouts.length > 0;
  const strategySummary =
    presentation?.strategySummary?.trim() || STRATEGY_FALLBACK;
  const splitLabel = formatIdentifier(presentation?.splitType);
  const focusAreas = presentation?.focusAreas || {
    primary: [],
    secondary: [],
    deprioritized: [],
  };

  const handleEdit = () => {
    if (!generationResult || editHandledRef.current) {
      return;
    }

    editHandledRef.current = true;
    setIsLeavingForEdit(true);
    hydrateProgramDraft(generationResult, {
      originRoute: backTarget,
    });
    navigate(getManualBuilderPath(), {
      state: {
        from: backTarget,
        returnTo: backTarget,
      },
    });
  };

  const handleViewPrograms = () => {
    navigate(getWeeklyPlansPath());
  };

  return (
    <section
      aria-labelledby="generated-program-title"
      className="space-y-5 rounded-3xl border border-emerald-200 bg-white p-5 shadow-sm"
    >
      <header>
        <p className="inline-flex rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold uppercase tracking-wider text-emerald-700">
          Généré avec AI
        </p>
        <h2
          id="generated-program-title"
          className="mt-3 text-xl font-bold text-slate-900"
        >
          {builderPayload.programName || "Programme sans nom"}
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          {sessionsPerWeek} séance{sessionsPerWeek === 1 ? "" : "s"} par semaine
          {splitLabel ? ` · ${splitLabel}` : ""}
        </p>
      </header>

      <section aria-labelledby="strategy-summary-title">
        <h3 id="strategy-summary-title" className="text-base font-bold text-slate-900">
          Pourquoi ce plan?
        </h3>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          {strategySummary}
        </p>
      </section>

      {focusAreas.primary.length ||
      focusAreas.secondary.length ||
      focusAreas.deprioritized.length ? (
        <section aria-labelledby="focus-areas-title">
          <h3 id="focus-areas-title" className="text-base font-bold text-slate-900">
            Priorités du programme
          </h3>
          <dl className="mt-3 grid gap-3 sm:grid-cols-2">
            <PriorityCategory
              label="Priorité principale"
              values={focusAreas.primary}
            />
            <PriorityCategory
              label="Priorités secondaires"
              values={focusAreas.secondary}
            />
            <PriorityCategory
              label="Zone dépriorisée"
              values={focusAreas.deprioritized}
            />
          </dl>
        </section>
      ) : null}

      <section aria-labelledby="workout-preview-title">
        <h3 id="workout-preview-title" className="text-base font-bold text-slate-900">
          Aperçu des séances
        </h3>
        <div className="mt-3">
          {hasDetailedWorkoutPreview ? (
            <DetailedWorkoutPreview workouts={presentationWorkouts} />
          ) : (
            <MinimalWorkoutPreview workouts={builderWorkouts} />
          )}
        </div>
      </section>

      <div className="grid gap-3 border-t border-slate-100 pt-5 sm:grid-cols-2">
        <Button
          type="button"
          onClick={handleEdit}
          disabled={isLeavingForEdit}
        >
          Modifier
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={handleViewPrograms}
          disabled={isLeavingForEdit}
        >
          Voir mes programmes
        </Button>
      </div>
    </section>
  );
}
