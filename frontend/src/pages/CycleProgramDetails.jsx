import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMultiWeekProgram } from "../context/MultiWeekProgramContext";
import {
  getCycleBuilderPath,
  getCyclesLibraryPath,
} from "../features/multiWeek/routes";
import {
  deleteCycle,
  getCycleDetails,
  openOrCreateCycleEditDraft,
} from "../services/api";

function formatDate(value) {
  if (!value) {
    return "";
  }

  return new Date(`${value}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default function CycleProgramDetails() {
  const navigate = useNavigate();
  const { cycleId } = useParams();
  const { hydrateCycleDraft } = useMultiWeekProgram();
  const [details, setDetails] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isOpeningDraft, setIsOpeningDraft] = useState(false);
  const [isDeletingCycle, setIsDeletingCycle] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let isMounted = true;

    async function loadDetails() {
      setIsLoading(true);
      setError("");

      try {
        const response = await getCycleDetails(cycleId);
        if (isMounted) {
          setDetails(response);
        }
      } catch (loadError) {
        if (isMounted) {
          setDetails(null);
          setError(loadError.message || "Unable to load program.");
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    loadDetails();

    return () => {
      isMounted = false;
    };
  }, [cycleId]);

  const summary = useMemo(() => {
    const weeks = details?.builderPayload?.weeks || [];
    const firstWeek = weeks[0] || null;

    return {
      weeks: weeks.length,
      workoutsPerWeek: firstWeek?.workouts?.length || 0,
    };
  }, [details]);

  const handleEdit = async () => {
    setIsOpeningDraft(true);
    setError("");

      try {
        const response = await openOrCreateCycleEditDraft(cycleId);
      hydrateCycleDraft(response);
      navigate(getCycleBuilderPath(cycleId));
    } catch (openError) {
      setError(openError.message || "Unable to open draft.");
    } finally {
      setIsOpeningDraft(false);
    }
  };

  const handleDelete = async () => {
    const confirmed = window.confirm(
      "Delete this multi-week cycle? This cannot be undone."
    );

    if (!confirmed) {
      return;
    }

    setIsDeletingCycle(true);
    setError("");

    try {
      await deleteCycle(cycleId);
      navigate(getCyclesLibraryPath(), { replace: true });
    } catch (deleteError) {
      setError(deleteError.message || "Unable to delete program.");
      setIsDeletingCycle(false);
    }
  };

  if (isLoading) {
    return <div className="px-4 py-8 text-sm text-slate-500">Loading program...</div>;
  }

  if (!details) {
    return <div className="px-4 py-8 text-sm text-red-500">{error || "Program not found."}</div>;
  }

  const cycle = details.cycle;

  return (
    <div className="-mx-6 min-h-full bg-background-light text-slate-900">
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-background-light/80 backdrop-blur-md">
        <div className="flex h-16 items-center justify-between px-4">
          <button
            type="button"
            onClick={() => navigate("/program")}
            className="flex size-10 items-center justify-center rounded-full transition-colors hover:bg-slate-100"
            aria-label="Back"
          >
            <span className="material-symbols-outlined text-slate-700">arrow_back</span>
          </button>
          <h1 className="text-lg font-bold tracking-tight">{cycle.name}</h1>
          <div className="size-10" />
        </div>
      </header>

      <main className="space-y-6 px-4 py-6">
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-primary">
                {cycle.temporalStatus}
              </p>
              <h2 className="mt-1 text-2xl font-bold">{details.builderPayload?.programName || cycle.name}</h2>
            </div>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-slate-600">
              {details.draftPlanId ? "draft available" : "published"}
            </span>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-3 text-sm text-slate-600">
            <div className="rounded-lg bg-slate-50 p-3">
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Start</p>
              <p className="mt-1 font-semibold">{formatDate(cycle.startDate)}</p>
            </div>
            <div className="rounded-lg bg-slate-50 p-3">
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">End</p>
              <p className="mt-1 font-semibold">{formatDate(cycle.endDate)}</p>
            </div>
            <div className="rounded-lg bg-slate-50 p-3">
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Weeks</p>
              <p className="mt-1 font-semibold">{summary.weeks}</p>
            </div>
            <div className="rounded-lg bg-slate-50 p-3">
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Workouts / week</p>
              <p className="mt-1 font-semibold">{summary.workoutsPerWeek}</p>
            </div>
          </div>

          {error && <p className="mt-4 text-sm text-red-500">{error}</p>}

          <button
            type="button"
            onClick={handleEdit}
            disabled={isOpeningDraft || cycle.temporalStatus === "past"}
            className={[
              "mt-5 w-full rounded-xl py-3 font-bold transition-colors",
              cycle.temporalStatus !== "past" && !isOpeningDraft
                ? "bg-primary text-white"
                : "cursor-not-allowed bg-slate-300 text-white/70",
            ].join(" ")}
          >
            {isOpeningDraft ? "Opening draft..." : cycle.temporalStatus === "past" ? "Past program" : "Edit program"}
          </button>

          <button
            type="button"
            onClick={handleDelete}
            disabled={isDeletingCycle}
            className="mt-3 w-full rounded-xl border border-red-200 bg-white py-3 font-bold text-red-600 transition-colors hover:bg-red-50 disabled:opacity-60"
          >
            {isDeletingCycle ? "Deleting..." : "Delete cycle"}
          </button>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="text-sm font-bold uppercase tracking-wider text-slate-500">Weeks</h3>
          <div className="mt-4 grid grid-cols-4 gap-2">
            {(details.builderPayload?.weeks || []).map((week) => (
              <div
                key={week.id || week.weekNumber}
                className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-center text-xs font-semibold text-slate-600"
              >
                W{week.weekNumber}
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
