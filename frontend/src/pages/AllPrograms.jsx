import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { formatRelativeCreatedLabel } from "../features/weeklyPlans/formatters";
import { buildOrigin, resolveBackTarget } from "../features/weeklyPlans/navigation";
import { getWeeklyPlanDetailsPath } from "../features/weeklyPlans/routes";
import { mapWeeklyPlanListItemToUi } from "../features/weeklyPlans/mappers";
import {
  bookmarkWeeklyPlan,
  getWeeklyPlans,
  unbookmarkWeeklyPlan,
} from "../services/api";

export default function AllPrograms() {
  const navigate = useNavigate();
  const location = useLocation();
  const [activeFilter, setActiveFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [isCreateMenuOpen, setIsCreateMenuOpen] = useState(false);
  const [programs, setPrograms] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const createMenuRef = useRef(null);

  useEffect(() => {
    let isMounted = true;

    async function loadWeeklyPlans() {
      setIsLoading(true);

      try {
        const response = await getWeeklyPlans();
        const items = (response.items || []).map((item) =>
          mapWeeklyPlanListItemToUi(item, formatRelativeCreatedLabel(item.createdAt))
        );

        if (isMounted) {
          setPrograms(items);
        }
      } catch (error) {
        if (isMounted) {
          setPrograms([]);
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    loadWeeklyPlans();

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

  const filteredPrograms = useMemo(() => {
    const matchingPrograms = programs.filter((program) => {
      const matchesFilter =
        activeFilter === "all" ? true : program.status === activeFilter;

      const matchesSearch = program.name
        .toLowerCase()
        .includes(searchQuery.trim().toLowerCase());

      return matchesFilter && matchesSearch;
    });

    const hasBookmarks = matchingPrograms.some((program) => program.isBookmarked);

    return [...matchingPrograms].sort((left, right) => {
      if (hasBookmarks && left.isBookmarked !== right.isBookmarked) {
        return left.isBookmarked ? -1 : 1;
      }

      return new Date(right.createdAt) - new Date(left.createdAt);
    });
  }, [activeFilter, programs, searchQuery]);

  const handleBookmarkToggle = async (event, program) => {
    event.stopPropagation();

    const nextBookmarkState = !program.isBookmarked;
    setPrograms((prev) =>
      prev.map((item) =>
        item.id === program.id ? { ...item, isBookmarked: nextBookmarkState } : item
      )
    );

    try {
      if (nextBookmarkState) {
        await bookmarkWeeklyPlan(program.weeklyPlanParentId);
      } else {
        await unbookmarkWeeklyPlan(program.weeklyPlanParentId);
      }
    } catch (error) {
      setPrograms((prev) =>
        prev.map((item) =>
          item.id === program.id ? { ...item, isBookmarked: program.isBookmarked } : item
        )
      );
    }
  };

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

          <h1 className="text-lg font-bold tracking-tight">All Programs</h1>

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
                        returnTo: resolveBackTarget(location, "/program"),
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

      <main className="px-4 pb-24 pt-4 space-y-6">
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
          {!isLoading && filteredPrograms.length === 0 && (
            <div className="rounded-xl border border-dashed border-slate-300 bg-white px-5 py-8 text-center shadow-sm">
              <h3 className="text-lg font-bold tracking-tight text-slate-900">
                No programs yet
              </h3>
              <p className="mt-2 text-sm text-slate-500">
                Create your first weekly template to populate your library.
              </p>
              <button
                type="button"
                onClick={() =>
                  navigate("/program/manual-new", {
                    state: {
                      from: buildOrigin(location),
                      returnTo: resolveBackTarget(location, "/program"),
                    },
                  })
                }
                className="mt-5 w-full rounded-xl bg-primary py-3 text-sm font-bold text-white shadow-lg shadow-primary/20"
              >
                Create your first program
              </button>
            </div>
          )}

          {filteredPrograms.map((program) => (
            <button
              key={program.id}
              type="button"
              onClick={() =>
                navigate(getWeeklyPlanDetailsPath(program.weeklyPlanParentId), {
                  state: {
                    from: buildOrigin(location),
                    returnTo: resolveBackTarget(location, "/program"),
                  },
                })
              }
              className="group relative flex w-full items-center justify-between rounded-xl border border-slate-200 bg-white p-5 text-left shadow-sm transition-all hover:shadow-md"
            >
              <div className="space-y-1">
                <h3 className="text-lg font-bold tracking-tight text-slate-900">
                  {program.name}
                </h3>

                <p className="text-sm font-medium text-slate-500">
                  {program.frequencyPerWeek} workouts / week • {program.totalWeeklySets} total sets
                </p>

                <div className="mt-2 flex items-center gap-2.5">
                  <span
                    className={[
                      "rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.14em]",
                      program.status === "draft"
                        ? "bg-amber-100 text-amber-700"
                        : "bg-primary/10 text-primary",
                    ].join(" ")}
                  >
                    {program.status}
                  </span>

                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-600">
                    {program.source}
                  </span>

                  <span className="text-[10px] font-medium text-slate-400">
                    {program.createdLabel}
                  </span>
                </div>
              </div>

              <button
                type="button"
                onClick={(event) => handleBookmarkToggle(event, program)}
                className="flex h-8 w-8 items-center justify-center rounded-full text-slate-400 transition-colors group-hover:text-primary"
                aria-label={
                  program.isBookmarked ? "Remove bookmark" : "Add bookmark"
                }
              >
                <span className="material-symbols-outlined">
                    {program.isBookmarked ? "bookmark" : "bookmark_border"}
                </span>
              </button>
            </button>
          ))}
        </section>
      </main>
    </div>
  );
}
