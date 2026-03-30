import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { formatRelativeCreatedLabel } from "../features/weeklyPlans/formatters";
import { buildOrigin } from "../features/weeklyPlans/navigation";
import { mapWeeklyPlanListItemToUi } from "../features/weeklyPlans/mappers";
import {
  getWeeklyPlanDetailsPath,
  getWeeklyPlansPath,
} from "../features/weeklyPlans/routes";
import { getCycleDetailsPath } from "../features/multiWeek/routes";
import { getProgramsOverview, getWeeklyPlans } from "../services/api";

function createCycleNodes(currentProgram, upcomingPrograms) {
  const totalWeeks = Math.max(12, currentProgram?.durationWeeks || 8);
  const currentWeek = currentProgram ? Math.min(totalWeeks, Math.max(1, 1)) : null;

  return Array.from({ length: totalWeeks }).map((_, index) => {
    const weekNumber = index + 1;
    const isCompleted = currentProgram && currentWeek && weekNumber < currentWeek;
    const isCurrent = currentProgram && currentWeek === weekNumber;
    const isUpcoming = !isCompleted && !isCurrent;

    return {
      weekNumber,
      isCompleted,
      isCurrent,
      isUpcoming,
      highlight:
        !currentProgram && weekNumber === 1
          ? "new"
          : upcomingPrograms.length > 0 && weekNumber === totalWeeks - 1
            ? "next"
            : null,
    };
  });
}

export default function Program() {
  const [scrolled, setScrolled] = useState(false);
  const [isCreateMenuOpen, setIsCreateMenuOpen] = useState(false);
  const [weeklyPlans, setWeeklyPlans] = useState([]);
  const [overview, setOverview] = useState(null);
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
          getProgramsOverview(),
        ]);

        if (!isMounted) {
          return;
        }

        setWeeklyPlans(
          (weeklyResponse.items || []).map((item) =>
            mapWeeklyPlanListItemToUi(item, formatRelativeCreatedLabel(item.createdAt))
          )
        );
        setOverview(overviewResponse);
      } catch (error) {
        if (isMounted) {
          setWeeklyPlans([]);
          setOverview(null);
        }
      }
    }

    loadData();

    return () => {
      isMounted = false;
    };
  }, []);

  const featuredWeeklyPlan = useMemo(() => weeklyPlans[0] || null, [weeklyPlans]);
  const visibleWeeklyPlans = useMemo(() => weeklyPlans.slice(0, 2), [weeklyPlans]);
  const currentProgram = overview?.currentProgram || null;
  const pastPrograms = overview?.pastPrograms || [];
  const upcomingPrograms = useMemo(
    () => overview?.upcomingPrograms || [],
    [overview]
  );
  const cycleNodes = useMemo(
    () => createCycleNodes(currentProgram, upcomingPrograms),
    [currentProgram, upcomingPrograms]
  );

  return (
    <div className="-mx-6 bg-background-light text-slate-900 antialiased font-display">
      {/* Sticky Header */}
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
        {/* Active Program Card */}
        <section>
          <div className="relative overflow-hidden rounded-xl bg-white shadow-sm border border-slate-200/50 p-5">
            <div className="flex justify-between items-start mb-4">
              <div>
                <span className="text-[10px] font-bold uppercase tracking-widest text-primary">
                  Active Program
                </span>
                <h2 className="text-xl font-bold mt-1">
                  {currentProgram?.name || featuredWeeklyPlan?.name || "No weekly plan yet"}
                </h2>
              </div>

              <span className="px-2.5 py-1 rounded-full bg-primary/10 text-primary text-[11px] font-bold uppercase tracking-wider">
                {currentProgram?.editorialStatus || featuredWeeklyPlan?.source || "manual"}
              </span>
            </div>

            <div className="space-y-4">
              <div className="flex items-center justify-between text-sm text-slate-500">
                <span>
                  {currentProgram
                    ? `${currentProgram.summary?.sessionsPerWeek || currentProgram.durationWeeks} workouts / week`
                    : featuredWeeklyPlan
                      ? `${featuredWeeklyPlan.frequencyPerWeek} workouts / week`
                      : "Create a weekly template"}
                </span>
                <span>
                  {currentProgram
                    ? `${currentProgram.durationWeeks} week cycle`
                    : featuredWeeklyPlan
                      ? `${featuredWeeklyPlan.totalWeeklySets} total sets`
                      : ""}
                </span>
              </div>

              <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                <div className="h-full bg-primary rounded-full w-1/2" />
              </div>

              <button
                type="button"
                onClick={() =>
                  currentProgram
                    ? navigate(getCycleDetailsPath(currentProgram.cycleId || currentProgram.id))
                    : featuredWeeklyPlan
                      ? navigate(
                          getWeeklyPlanDetailsPath(featuredWeeklyPlan.weeklyPlanParentId),
                          {
                            state: {
                              from: buildOrigin(location),
                            },
                          }
                        )
                      : navigate("/program/manual-new", {
                          state: {
                            from: buildOrigin(location),
                            returnTo: "/program",
                          },
                        })
                }
                className="w-full mt-4 py-3 rounded-xl text-sm font-bold border shadow-sm hover:shadow-md transition-shadow bg-primary text-white border-primary/20 shadow-md shadow-primary/20"
              >
                {currentProgram || featuredWeeklyPlan ? "View Details" : "Create Weekly Template"}
              </button>
            </div>
          </div>
        </section>

        {/* Cycle Structure */}
        <section>
          <h3 className="text-lg font-bold mb-8 px-2">Cycle Structure</h3>

          <div className="space-y-12 px-2">
            {[cycleNodes.slice(0, 6), cycleNodes.slice(6, 12)].map((row, rowIndex) => (
              <div
                key={rowIndex}
                className={rowIndex === 0 ? "relative flex justify-between items-center" : "relative flex justify-between items-center pt-8 pb-8"}
              >
                <div className={`absolute ${rowIndex === 0 ? "top-4" : "top-12"} left-0 w-full h-1 bg-slate-200 z-0`} />

                {rowIndex === 0 && currentProgram && (
                  <div className="absolute top-4 left-0 w-[60%] h-1 bg-primary z-10" />
                )}

                {row.map((node, index) => (
                  <div key={node.weekNumber} className="relative z-20 flex flex-col items-center">
                    {node.highlight === "next" && (
                      <span className="absolute -top-7 text-[8px] font-bold tracking-wider uppercase whitespace-nowrap">
                        Next Cycle
                      </span>
                    )}

                    <div
                      className={[
                        "flex items-center justify-center shadow-sm",
                        node.isCurrent
                          ? "w-10 h-10 rounded-full bg-primary border-4 border-white text-white shadow-lg shadow-primary/40 -mt-1"
                          : node.isCompleted
                            ? "w-8 h-8 rounded-full bg-primary text-white"
                            : "w-8 h-8 rounded-full bg-white border-2 border-slate-200 text-slate-400",
                      ].join(" ")}
                    >
                      {node.isCompleted ? (
                        <span className="material-symbols-outlined text-sm">check</span>
                      ) : (
                        <span className="text-[10px] font-bold">
                          {node.isCurrent ? `W${node.weekNumber}` : node.weekNumber}
                        </span>
                      )}
                    </div>

                    <span
                      className={[
                        "absolute -bottom-6 text-[10px] font-bold",
                        node.isCurrent
                          ? "text-primary"
                          : node.isCompleted
                            ? "text-slate-500"
                            : "text-slate-400",
                      ].join(" ")}
                    >
                      {node.isCurrent ? "NOW" : `W${node.weekNumber}`}
                    </span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </section>

        {/* Upcoming Programs */}
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
            {upcomingPrograms.slice(0, 2).map((program) => (
              <button
                key={program.cycleId || program.id}
                type="button"
                onClick={() => navigate(getCycleDetailsPath(program.cycleId || program.id))}
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
                    Starts {program.startDate || "soon"}
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

        {/* Past Programs */}
        <section>
          <div className="flex items-center justify-between mb-4 px-2">
            <h3 className="text-lg font-bold">Past Programs</h3>
            <button type="button" className="text-sm font-medium text-primary">
              Browse
            </button>
          </div>

          <div className="space-y-3 px-2">
            {pastPrograms.slice(0, 2).map((program) => (
              <button
                key={program.cycleId || program.id}
                type="button"
                onClick={() => navigate(getCycleDetailsPath(program.cycleId || program.id))}
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
                    Completed {program.endDate || "previously"}
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

        {/* ALL Programs */}
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

      {/* Spacer for BottomTabs */}
      <div className="h-[calc(64px+max(8px,env(safe-area-inset-bottom)))]" />
    </div>
  );
}
