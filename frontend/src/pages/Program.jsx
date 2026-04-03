import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { formatRelativeCreatedLabel } from "../features/weeklyPlans/formatters";
import { mapWeeklyPlanListItemToUi } from "../features/weeklyPlans/mappers";
import { buildOrigin } from "../features/weeklyPlans/navigation";
import {
  getWeeklyPlanDetailsPath,
  getWeeklyPlansPath,
} from "../features/weeklyPlans/routes";
import { getCycleDetailsPath } from "../features/multiWeek/routes";
import { getProgramOverviewV2, getWeeklyPlans } from "../services/api";

function formatDisplayDate(dateKey) {
  if (!dateKey) {
    return "";
  }

  return new Date(`${dateKey}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function getTimelineFillWidth(rowSlots, progressWeekNumber) {
  if (!Array.isArray(rowSlots) || rowSlots.length < 2 || !Number.isFinite(progressWeekNumber)) {
    return "0%";
  }

  const firstSlotIndex = rowSlots[0].slotIndex;
  const lastSlotIndex = rowSlots[rowSlots.length - 1].slotIndex;
  if (progressWeekNumber < firstSlotIndex) {
    return "0%";
  }

  if (progressWeekNumber >= lastSlotIndex) {
    return "100%";
  }

  const completedSegments = progressWeekNumber - firstSlotIndex;
  return `${(completedSegments / (rowSlots.length - 1)) * 100}%`;
}

function getTimelineNodeClasses(slot) {
  if (slot.isCurrent) {
    return "w-10 h-10 rounded-full bg-primary border-4 border-white text-white shadow-lg shadow-primary/40 -mt-1";
  }

  if (slot.isCompleted) {
    return "w-8 h-8 rounded-full bg-primary text-white";
  }

  if (slot.status === "next_cycle") {
    return "w-8 h-8 rounded-full bg-slate-900 text-white";
  }

  if (slot.status === "deload") {
    return "w-8 h-8 rounded-full bg-white border-2 border-slate-300 text-slate-500";
  }

  if (slot.status === "neutral") {
    return "w-8 h-8 rounded-full bg-white border-2 border-slate-200 text-slate-300";
  }

  return "w-8 h-8 rounded-full bg-white border-2 border-slate-200 text-slate-400";
}

function getTimelineLabelClasses(slot) {
  if (slot.isCurrent) {
    return "text-primary";
  }

  if (slot.isCompleted) {
    return "text-slate-500";
  }

  if (slot.status === "next_cycle") {
    return "text-slate-900";
  }

  if (slot.status === "deload") {
    return "text-slate-500";
  }

  return "text-slate-400";
}

export default function Program() {
  const [scrolled, setScrolled] = useState(false);
  const [isCreateMenuOpen, setIsCreateMenuOpen] = useState(false);
  const [weeklyPlans, setWeeklyPlans] = useState([]);
  const [programOverview, setProgramOverview] = useState(null);
  const createMenuRef = useRef(null);
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 4);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (!isCreateMenuOpen) return undefined;

    const onPointerDown = (event) => {
      if (!createMenuRef.current?.contains(event.target)) {
        setIsCreateMenuOpen(false);
      }
    };

    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        setIsCreateMenuOpen(false);
      }
    };

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown, { passive: true });
    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [isCreateMenuOpen]);

  useEffect(() => {
    let isMounted = true;

    async function loadData() {
      try {
        const [weeklyResponse, overviewResponse] = await Promise.all([
          getWeeklyPlans(),
          getProgramOverviewV2(),
        ]);

        if (!isMounted) {
          return;
        }

        setWeeklyPlans(
          (weeklyResponse.items || []).map((item) =>
            mapWeeklyPlanListItemToUi(item, formatRelativeCreatedLabel(item.createdAt))
          )
        );
        setProgramOverview(overviewResponse);
      } catch (error) {
        if (isMounted) {
          setWeeklyPlans([]);
          setProgramOverview(null);
        }
      }
    }

    loadData();

    return () => {
      isMounted = false;
    };
  }, []);

  const visibleWeeklyPlans = useMemo(() => weeklyPlans.slice(0, 2), [weeklyPlans]);
  const activeProgramCard = programOverview?.activeProgramCard || null;
  const cycleStructure = programOverview?.cycleStructure || null;
  const upcomingPrograms = programOverview?.upcomingPrograms || [];
  const pastPrograms = programOverview?.pastPrograms || [];
  const timelineRows = useMemo(
    () => [
      cycleStructure?.slots?.slice(0, 6) || [],
      cycleStructure?.slots?.slice(6, 12) || [],
    ],
    [cycleStructure]
  );

  return (
    <div className="-mx-6 bg-background-light text-slate-900 antialiased font-display">
      <header
        className={[
          "sticky top-0 z-40 px-6 pt-3 pb-3 bg-background-light transition-shadow duration-200",
          scrolled ? "shadow-[0_6px_18px_rgba(15,23,42,0.08)]" : "shadow-none",
        ].join(" ")}
      >
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold tracking-tight">Program</h1>
          <div className="relative" ref={createMenuRef}>
            <button
              type="button"
              className="flex h-10 w-10 items-center justify-center rounded-full bg-primary shadow-lg shadow-primary/20"
              aria-label="Create program"
              aria-expanded={isCreateMenuOpen}
              aria-haspopup="menu"
              onClick={() => setIsCreateMenuOpen((open) => !open)}
            >
              <span className="material-symbols-outlined text-2xl text-white">
                add
              </span>
            </button>

            {isCreateMenuOpen && (
              <div
                className="absolute right-0 mt-2 w-44 rounded-2xl border border-white/50 bg-white/85 p-1.5 shadow-[0_16px_32px_rgba(15,23,42,0.16)] backdrop-blur-xl"
                role="menu"
                aria-label="Create program options"
              >
                <button
                  type="button"
                  className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm font-semibold text-slate-800 transition-colors hover:bg-slate-100/80"
                  role="menuitem"
                  onClick={() => {
                    setIsCreateMenuOpen(false);
                    navigate("/ai", {
                      state: {
                        from: buildOrigin(location),
                      },
                    });
                  }}
                >
                  <span className="material-symbols-outlined text-[18px] text-primary">auto_awesome</span>
                  AI builder
                </button>
                <button
                  type="button"
                  className="mt-1 flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm font-semibold text-slate-800 transition-colors hover:bg-slate-100/80"
                  role="menuitem"
                  onClick={() => {
                    setIsCreateMenuOpen(false);
                    navigate("/program/manual-new", {
                      state: {
                        from: buildOrigin(location),
                        returnTo: "/program",
                      },
                    });
                  }}
                >
                  <span className="material-symbols-outlined text-[18px] text-primary">tune</span>
                  Manual
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      <main className="px-6 space-y-8 pt-6">
        <section>
          <div className="relative overflow-hidden rounded-xl bg-white shadow-sm border border-slate-200/50 p-5">
            <div className="flex justify-between items-start mb-4">
              <div>
                <span className="text-[10px] font-bold uppercase tracking-widest text-primary">
                  Active Program
                </span>
                <h2 className="text-xl font-bold mt-1">
                  {activeProgramCard?.name || "No active cycle yet"}
                </h2>
              </div>

              <span className="px-2.5 py-1 rounded-full bg-primary/10 text-primary text-[11px] font-bold uppercase tracking-wider">
                {activeProgramCard?.editorialStatus || "inactive"}
              </span>
            </div>

            <div className="space-y-4">
              <div className="flex items-center justify-between text-sm text-slate-500">
                <span>
                  {activeProgramCard
                    ? `${activeProgramCard.referenceSessionsPerWeek} workouts / week`
                    : "No active cycle"}
                </span>
                <span>
                  {activeProgramCard
                    ? `${activeProgramCard.cycleDurationWeeks} week cycle`
                    : ""}
                </span>
              </div>

              <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary rounded-full transition-all"
                  style={{ width: `${activeProgramCard?.dayProgressPercent || 0}%` }}
                />
              </div>

              <button
                type="button"
                onClick={() =>
                  activeProgramCard
                    ? navigate(getCycleDetailsPath(activeProgramCard.cycleId))
                    : navigate("/program/cycles")
                }
                className="w-full mt-4 py-3 rounded-xl text-sm font-bold border shadow-sm hover:shadow-md transition-shadow bg-primary text-white border-primary/20 shadow-md shadow-primary/20"
              >
                {activeProgramCard ? "View Details" : "Browse Cycles"}
              </button>
            </div>
          </div>
        </section>

        <section>
          <h3 className="text-lg font-bold mb-8 px-2">Cycle Structure</h3>

          <div className="space-y-12 px-2">
            {timelineRows.map((row, rowIndex) => (
              <div
                key={rowIndex}
                className={rowIndex === 0 ? "relative flex justify-between items-center" : "relative flex justify-between items-center pt-8 pb-8"}
              >
                <div className={`absolute ${rowIndex === 0 ? "top-4" : "top-12"} left-0 w-full h-1 bg-slate-200 z-0`} />

                <div
                  className={`absolute ${rowIndex === 0 ? "top-4" : "top-12"} left-0 h-1 bg-primary z-10 transition-all`}
                  style={{
                    width: getTimelineFillWidth(
                      row,
                      Number(cycleStructure?.progressWeekNumber || 0)
                    ),
                  }}
                />

                {row.map((slot) => (
                  <div key={slot.slotIndex} className="relative z-20 flex flex-col items-center">
                    {slot.showNextCycleHint && (
                      <span className="absolute -top-7 text-[8px] font-bold tracking-wider uppercase whitespace-nowrap text-slate-900">
                        Next Cycle
                      </span>
                    )}

                    <div
                      className={[
                        "flex items-center justify-center shadow-sm",
                        getTimelineNodeClasses(slot),
                      ].join(" ")}
                    >
                      {slot.showCheckmark ? (
                        <span className="material-symbols-outlined text-sm">check</span>
                      ) : (
                        <span className="text-[10px] font-bold">
                          {slot.isCurrent ? slot.label : slot.slotIndex}
                        </span>
                      )}
                    </div>

                    <span
                      className={[
                        "absolute -bottom-6 text-[10px] font-bold",
                        getTimelineLabelClasses(slot),
                      ].join(" ")}
                    >
                      {slot.showNowLabel ? "NOW" : slot.label}
                    </span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </section>

        <section>
          <div className="flex items-center justify-between mb-4 px-2">
            <h3 className="text-lg font-bold">Upcoming Programs</h3>
            <button
              type="button"
              onClick={() => navigate("/program/cycles")}
              className="text-sm font-medium text-primary"
            >
              Browse
            </button>
          </div>

          <div className="space-y-3 px-2">
            {upcomingPrograms.map((program) => (
              <button
                key={program.cycleId}
                type="button"
                onClick={() => navigate(getCycleDetailsPath(program.cycleId))}
                className="flex w-full items-center gap-4 p-4 rounded-2xl bg-white border border-slate-100 shadow-sm text-left"
              >
                <div className="w-12 h-12 rounded-lg bg-slate-100 flex items-center justify-center">
                  <span className="material-symbols-outlined text-slate-400">
                    event_upcoming
                  </span>
                </div>
                <div className="flex-1">
                  <h4 className="text-sm font-bold">{program.name}</h4>
                  <p className="text-xs text-slate-500">
                    Starts {formatDisplayDate(program.startDate) || "soon"}
                  </p>
                </div>
                <span className="material-symbols-outlined text-slate-300">
                  chevron_right
                </span>
              </button>
            ))}

            {!upcomingPrograms.length && (
              <div className="flex items-center gap-4 p-4 rounded-2xl bg-white border border-slate-100 shadow-sm">
                <div className="w-12 h-12 rounded-lg bg-slate-100 flex items-center justify-center">
                  <span className="material-symbols-outlined text-slate-400">
                    event_upcoming
                  </span>
                </div>
                <div className="flex-1">
                  <h4 className="text-sm font-bold">No upcoming programs yet</h4>
                  <p className="text-xs text-slate-500">Future multi-week cycles will appear here.</p>
                </div>
              </div>
            )}
          </div>
        </section>

        <section>
          <div className="flex items-center justify-between mb-4 px-2">
            <h3 className="text-lg font-bold">Past Programs</h3>
            <button type="button" className="text-sm font-medium text-primary">
              Browse
            </button>
          </div>

          <div className="space-y-3 px-2">
            {pastPrograms.map((program) => (
              <button
                key={program.cycleId}
                type="button"
                onClick={() => navigate(getCycleDetailsPath(program.cycleId))}
                className="flex w-full items-center gap-4 p-4 rounded-2xl bg-white border border-slate-100 shadow-sm text-left"
              >
                <div className="w-12 h-12 rounded-lg bg-slate-100 flex items-center justify-center">
                  <span className="material-symbols-outlined text-slate-400">
                    fitness_center
                  </span>
                </div>
                <div className="flex-1">
                  <h4 className="text-sm font-bold">{program.name}</h4>
                  <p className="text-xs text-slate-500">
                    Completed {formatDisplayDate(program.endDate) || "previously"}
                  </p>
                </div>
                <span className="material-symbols-outlined text-slate-300">
                  chevron_right
                </span>
              </button>
            ))}

            {!pastPrograms.length && (
              <div className="flex items-center gap-4 p-4 rounded-2xl bg-white border border-slate-100 shadow-sm">
                <div className="w-12 h-12 rounded-lg bg-slate-100 flex items-center justify-center">
                  <span className="material-symbols-outlined text-slate-400">
                    history
                  </span>
                </div>
                <div className="flex-1">
                  <h4 className="text-sm font-bold">No past programs yet</h4>
                  <p className="text-xs text-slate-500">Completed multi-week cycles will appear here.</p>
                </div>
              </div>
            )}
          </div>
        </section>

        <section className="pb-6">
          <div className="flex items-center justify-between mb-4 px-2">
            <h3 className="text-lg font-bold">All Programs</h3>
            <button
              type="button"
              onClick={() => navigate(getWeeklyPlansPath())}
              className="text-sm font-medium text-primary"
            >
              See All
            </button>
          </div>

          <div className="space-y-3 px-2">
            {visibleWeeklyPlans.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() =>
                  navigate(getWeeklyPlanDetailsPath(p.weeklyPlanParentId), {
                    state: {
                      from: buildOrigin(location),
                    },
                  })
                }
                className="group relative w-full overflow-hidden rounded-2xl border border-slate-100 bg-white p-5 text-left shadow-sm transition-all hover:shadow-md"
              >
                <div className="flex justify-between items-center">
                  <div>
                    <h4 className="text-sm font-bold">{p.name}</h4>
                    <p className="mt-1 text-xs text-slate-500">
                      {p.frequencyPerWeek} workouts / {p.totalWeeklySets} total sets •{" "}
                      {p.status}
                    </p>
                  </div>

                  <div
                    className="h-8 w-8 rounded-full flex items-center justify-center text-slate-400 transition-colors group-hover:text-primary"
                    aria-hidden="true"
                  >
                    <span className="material-symbols-outlined">
                      {p.isBookmarked ? "bookmark" : "bookmark_border"}
                    </span>
                  </div>
                </div>
              </button>
            ))}
            {!visibleWeeklyPlans.length && (
              <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-5 text-sm text-slate-500 shadow-sm">
                Your workout programs will appear here once you create one.
              </div>
            )}
          </div>
        </section>
      </main>

      <div className="h-[calc(64px+max(8px,env(safe-area-inset-bottom)))]" />
    </div>
  );
}
