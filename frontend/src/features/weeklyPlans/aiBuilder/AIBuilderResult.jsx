import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useManualProgram } from "../../../context/ManualProgramContext";
import { openOrCreateWeeklyPlanEditDraft } from "../../../services/api";
import Button from "../../../ui/Button";
import {
  getManualBuilderPath,
  getWeeklyPlanDetailsPath,
} from "../routes";

function formatIdentifier(value) {
  const normalized = String(value || "").replaceAll("_", " ").trim();
  return normalized
    ? normalized.charAt(0).toUpperCase() + normalized.slice(1)
    : "";
}

function MetricCard({ label, value, suffix = "" }) {
  return (
    <div className="rounded-2xl bg-slate-50 p-3">
      <dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">
        {label}
      </dt>
      <dd className="mt-1 text-lg font-bold text-slate-900">
        {value}{suffix}
      </dd>
    </div>
  );
}

function TextList({ title, values }) {
  if (!Array.isArray(values) || values.length === 0) {
    return null;
  }

  return (
    <section aria-label={title}>
      <h3 className="text-sm font-bold text-slate-900">{title}</h3>
      <ul className="mt-2 space-y-1 text-sm leading-6 text-slate-600">
        {values.map((value, index) => (
          <li key={`${value}-${index}`}>{formatIdentifier(value)}</li>
        ))}
      </ul>
    </section>
  );
}

export default function AIBuilderResult({ generationResult, backTarget }) {
  const navigate = useNavigate();
  const { beginHydrationTarget, hydrateProgramDraft } = useManualProgram();
  const [isOpeningDraft, setIsOpeningDraft] = useState(false);
  const [actionError, setActionError] = useState("");
  const editInFlightRef = useRef(false);
  const weeklyPlanParentId = generationResult?.weeklyPlanParentId;
  const metrics = generationResult?.metrics || {};
  const presentation = generationResult?.presentation || {};
  const muscleDistribution = Array.isArray(metrics.weeklyMuscleDistribution)
    ? metrics.weeklyMuscleDistribution.filter(
        (entry) => Number(entry?.rawSets) > 0 || Number(entry?.percentage) > 0
      )
    : [];

  const handleSeeDetails = () => {
    if (!weeklyPlanParentId) {
      return;
    }

    navigate(getWeeklyPlanDetailsPath(weeklyPlanParentId), {
      state: { from: backTarget },
    });
  };

  const handleModify = async () => {
    if (!weeklyPlanParentId || editInFlightRef.current) {
      return;
    }

    editInFlightRef.current = true;
    setIsOpeningDraft(true);
    setActionError("");

    try {
      await beginHydrationTarget({
        weeklyPlanParentId,
        weeklyPlanVersionId: null,
      });
      const draft = await openOrCreateWeeklyPlanEditDraft(weeklyPlanParentId);
      const detailsPath = getWeeklyPlanDetailsPath(weeklyPlanParentId);
      hydrateProgramDraft(draft, { originRoute: detailsPath });
      navigate(getManualBuilderPath(), {
        state: {
          from: detailsPath,
          returnTo: backTarget,
        },
      });
    } catch (_error) {
      editInFlightRef.current = false;
      setIsOpeningDraft(false);
      setActionError("We couldn't open the program for editing.");
    }
  };

  return (
    <section
      aria-labelledby="generated-program-title"
      className="space-y-5 rounded-3xl border border-emerald-200 bg-white p-5 shadow-sm"
    >
      <header>
        <p className="inline-flex rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold uppercase tracking-wider text-emerald-700">
          Generated with AI
        </p>
        <h2
          id="generated-program-title"
          className="mt-3 text-xl font-bold text-slate-900"
        >
          {generationResult?.name || presentation.title || "Untitled program"}
        </h2>
      </header>

      <dl className="grid grid-cols-2 gap-3">
        <MetricCard label="Exercises" value={metrics.totalExercises || 0} />
        <MetricCard label="Strength sets" value={metrics.strengthSets || 0} />
        <MetricCard
          label="Average duration"
          value={metrics.averageDurationMinutes || 0}
          suffix=" min"
        />
        <MetricCard
          label="Average TUT"
          value={metrics.averageTUTMinutes || 0}
          suffix=" min"
        />
      </dl>

      {muscleDistribution.length > 0 ? (
        <section aria-labelledby="muscle-distribution-title">
          <h3 id="muscle-distribution-title" className="text-sm font-bold text-slate-900">
            Weekly muscle distribution
          </h3>
          <div className="mt-3 space-y-2">
            {muscleDistribution.map((entry) => (
              <div key={entry.key || entry.label} className="flex items-center justify-between text-sm">
                <span className="text-slate-600">
                  {entry.label || formatIdentifier(entry.key)}
                </span>
                <span className="font-bold text-slate-900">
                  {Math.round(Number(entry.percentage) || 0)}%
                </span>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {presentation.summary ? (
        <section aria-labelledby="presentation-summary-title">
          <h3 id="presentation-summary-title" className="text-sm font-bold text-slate-900">
            Summary
          </h3>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            {presentation.summary}
          </p>
        </section>
      ) : null}

      <TextList title="Weekly structure" values={presentation.weeklyStructure} />
      <TextList title="Muscle priorities" values={presentation.musclePriorities} />
      <TextList title="Constraint management" values={presentation.constraintNotes} />

      {presentation.progression ? (
        <section aria-labelledby="progression-title">
          <h3 id="progression-title" className="text-sm font-bold text-slate-900">
            Progression
          </h3>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            {presentation.progression}
          </p>
        </section>
      ) : null}

      <TextList title="Coaching notes" values={presentation.coachingNotes} />

      {actionError ? (
        <p role="alert" className="text-sm font-medium text-red-600">
          {actionError}
        </p>
      ) : null}

      <div className="grid gap-3 border-t border-slate-100 pt-5 sm:grid-cols-2">
        <Button
          type="button"
          variant="secondary"
          onClick={handleSeeDetails}
          disabled={isOpeningDraft}
        >
          See details
        </Button>
        <Button
          type="button"
          onClick={handleModify}
          disabled={isOpeningDraft}
        >
          {isOpeningDraft ? "Opening…" : "Modify"}
        </Button>
      </div>
    </section>
  );
}
