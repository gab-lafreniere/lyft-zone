import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { buildOrigin, resolveBackTarget } from "../features/weeklyPlans/navigation";
import {
  getCycleDetailsPath,
  getCyclesLibraryPath,
} from "../features/multiWeek/routes";
import { getAllCycles } from "../services/api";

function formatDateRange(startDate, endDate) {
  if (!startDate || !endDate) {
    return "Dates unavailable";
  }

  try {
    const formatter = new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });

    return `${formatter.format(new Date(startDate))} - ${formatter.format(new Date(endDate))}`;
  } catch {
    return `${startDate} - ${endDate}`;
  }
}

function getTemporalStatusClasses(status) {
  switch (status) {
    case "active":
      return "bg-emerald-100 text-emerald-700";
    case "past":
      return "bg-slate-200 text-slate-600";
    case "upcoming":
    default:
      return "bg-sky-100 text-sky-700";
  }
}

export default function AllCycles() {
  const navigate = useNavigate();
  const location = useLocation();
  const [activeFilter, setActiveFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [isCreateMenuOpen, setIsCreateMenuOpen] = useState(false);
  const [cycles, setCycles] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const createMenuRef = useRef(null);

  useEffect(() => {
    let isMounted = true;

    async function loadCycles() {
      setIsLoading(true);

      try {
        const response = await getAllCycles();

        if (isMounted) {
          setCycles(response.items || []);
        }
      } catch {
        if (isMounted) {
          setCycles([]);
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    loadCycles();

    return () => {
      isMounted = false;
    };
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

  const filteredCycles = useMemo(() => {
    const matchingCycles = cycles.filter((cycle) => {
      const matchesFilter =
        activeFilter === "all" ? true : cycle.editorialStatus === activeFilter;

      const matchesSearch = cycle.name
        .toLowerCase()
        .includes(searchQuery.trim().toLowerCase());

      return matchesFilter && matchesSearch;
    });

    const temporalSortOrder = {
      active: 0,
      upcoming: 1,
      past: 2,
    };

    return [...matchingCycles].sort((left, right) => {
      const leftOrder = temporalSortOrder[left.temporalStatus] ?? 99;
      const rightOrder = temporalSortOrder[right.temporalStatus] ?? 99;

      if (leftOrder !== rightOrder) {
        return leftOrder - rightOrder;
      }

      if (left.temporalStatus === "past" && right.temporalStatus === "past") {
        return new Date(right.endDate) - new Date(left.endDate);
      }

      return new Date(left.startDate) - new Date(right.startDate);
    });
  }, [activeFilter, cycles, searchQuery]);

  return (
    <div className="-mx-6 min-h-full bg-background-light text-slate-900">
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-background-light/80 backdrop-blur-md">
        <div className="flex h-16 items-center justify-between px-4">
          <button
            type="button"
            onClick={() => navigate(resolveBackTarget(location, "/program"))}
            className="flex size-10 items-center justify-center rounded-full transition-colors hover:bg-slate-100"
            aria-label="Back"
          >
            <span className="material-symbols-outlined text-slate-700">
              arrow_back
            </span>
          </button>

          <h1 className="text-lg font-bold tracking-tight">All Cycles</h1>

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
                  <span className="material-symbols-outlined text-[18px] text-primary">
                    auto_awesome
                  </span>
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
                        returnTo: getCyclesLibraryPath(),
                      },
                    });
                  }}
                >
                  <span className="material-symbols-outlined text-[18px] text-primary">
                    tune
                  </span>
                  Manual
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      <main className="space-y-6 px-4 pb-24 pt-4">
        <div className="relative">
          <span className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-slate-400">
            search
          </span>
          <input
            type="text"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Search your library..."
            className="h-14 w-full rounded-xl border border-slate-200 bg-white pl-12 pr-4 text-sm font-medium outline-none transition-all placeholder:text-slate-400 focus:border-transparent focus:ring-2 focus:ring-primary/20"
          />
        </div>

        <div className="hide-scrollbar -mx-4 flex gap-3 overflow-x-auto px-4">
          {[
            { value: "all", label: "All" },
            { value: "draft", label: "Draft" },
            { value: "published", label: "Published" },
          ].map((filter) => {
            const isActive = activeFilter === filter.value;

            return (
              <button
                key={filter.value}
                type="button"
                onClick={() => setActiveFilter(filter.value)}
                className={[
                  "shrink-0 rounded-full px-5 py-2.5 text-[11px] font-bold uppercase tracking-[0.16em] transition-colors",
                  isActive
                    ? "bg-primary text-white shadow-md shadow-primary/20"
                    : "bg-white text-slate-600 hover:bg-slate-100",
                ].join(" ")}
              >
                {filter.label}
              </button>
            );
          })}
        </div>

        <section className="space-y-4">
          {!isLoading && filteredCycles.length === 0 && (
            <div className="rounded-xl border border-dashed border-slate-300 bg-white px-5 py-8 text-center shadow-sm">
              <h3 className="text-lg font-bold tracking-tight text-slate-900">
                No cycles yet
              </h3>
              <p className="mt-2 text-sm text-slate-500">
                Convert a weekly template into a multi-week cycle to populate this library.
              </p>
              <button
                type="button"
                onClick={() =>
                  navigate("/program/manual-new", {
                    state: {
                      from: buildOrigin(location),
                      returnTo: getCyclesLibraryPath(),
                    },
                  })
                }
                className="mt-5 w-full rounded-xl bg-primary py-3 text-sm font-bold text-white shadow-lg shadow-primary/20"
              >
                Create your first program
              </button>
            </div>
          )}

          {filteredCycles.map((cycle) => (
            <button
              key={cycle.id}
              type="button"
              onClick={() =>
                navigate(getCycleDetailsPath(cycle.id), {
                  state: {
                    from: buildOrigin(location),
                    returnTo: getCyclesLibraryPath(),
                  },
                })
              }
              className="group relative flex w-full items-center justify-between rounded-xl border border-slate-200 bg-white p-5 text-left shadow-sm transition-all hover:shadow-md"
            >
              <div className="space-y-1">
                <h3 className="text-lg font-bold tracking-tight text-slate-900">
                  {cycle.name}
                </h3>

                <p className="text-sm font-medium text-slate-500">
                  {cycle.sessionsPerWeek} workouts / week
                  {typeof cycle.totalWeeklySets === "number"
                    ? ` • ${cycle.totalWeeklySets} total sets`
                    : ""}
                </p>

                <p className="text-sm font-medium text-slate-500">
                  {cycle.durationWeeks} weeks • {formatDateRange(cycle.startDate, cycle.endDate)}
                </p>

                <div className="mt-2 flex flex-wrap items-center gap-2.5">
                  <span
                    className={[
                      "rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.14em]",
                      cycle.editorialStatus === "draft"
                        ? "bg-amber-100 text-amber-700"
                        : "bg-primary/10 text-primary",
                    ].join(" ")}
                  >
                    {cycle.editorialStatus}
                  </span>

                  <span
                    className={[
                      "rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.14em]",
                      getTemporalStatusClasses(cycle.temporalStatus),
                    ].join(" ")}
                  >
                    {cycle.temporalStatus}
                  </span>

                  <span className="text-[10px] font-medium text-slate-400">
                    {cycle.startDate} to {cycle.endDate}
                  </span>
                </div>
              </div>

              <div className="flex h-8 w-8 items-center justify-center rounded-full text-slate-400 transition-colors group-hover:text-primary">
                <span className="material-symbols-outlined">chevron_right</span>
              </div>
            </button>
          ))}
        </section>
      </main>
    </div>
  );
}
