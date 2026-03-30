import { useEffect, useMemo, useState } from "react";
import { getHomeDashboard } from "../services/api";

function formatDayLabel(dateKey) {
  return new Date(`${dateKey}T00:00:00Z`).toLocaleDateString("en-US", {
    weekday: "narrow",
  });
}

function formatDayNumber(dateKey) {
  return new Date(`${dateKey}T00:00:00Z`).getUTCDate();
}

function getDayCardClasses(day) {
  if (day?.state === "today") {
    return "flex flex-col items-center p-2 rounded-lg bg-primary/20 border border-primary/30 relative";
  }

  if (day?.state === "past_empty") {
    return "flex flex-col items-center p-2 rounded-lg bg-white shadow-sm border border-slate-100";
  }

  if (day?.state === "past_missed") {
    return "flex flex-col items-center p-2 rounded-lg bg-white shadow-sm border border-slate-100";
  }

  if (day?.state === "future_planned") {
    return "flex flex-col items-center p-2 rounded-lg bg-white shadow-sm border border-primary/40";
  }

  return "flex flex-col items-center p-2 rounded-lg bg-white shadow-sm border border-slate-100";
}

export default function HomeDashboard() {
  const [scrolled, setScrolled] = useState(false);
  const [dashboard, setDashboard] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 4);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    let isMounted = true;

    async function loadDashboard() {
      try {
        const response = await getHomeDashboard();
        if (isMounted) {
          setDashboard(response);
          setError("");
        }
      } catch (loadError) {
        if (isMounted) {
          setDashboard(null);
          setError(loadError.message || "Unable to load home dashboard.");
        }
      }
    }

    loadDashboard();

    return () => {
      isMounted = false;
    };
  }, []);

  const currentProgram = dashboard?.currentProgram || null;
  const todayFocus = dashboard?.todayFocus || null;
  const flatDays = useMemo(
    () => (dashboard?.weeks || []).flatMap((week) => week.days || []).slice(0, 14),
    [dashboard]
  );

  const weeklySetGoal = currentProgram?.summary?.totalSetsFirstWeek || 24;
  const workoutsPerWeek = currentProgram?.summary?.sessionsPerWeek || 4;
  const workoutDaysThisWeek = (dashboard?.weeks?.[0]?.days || []).filter(
    (day) => (day.workouts || []).length > 0
  ).length;

  return (
    <div className="-mx-6 bg-background-light text-slate-900 antialiased font-display">
      {/* Header Section */}
      <header
        className={[
          "sticky top-0 z-40 px-6 pt-1 pb-1 bg-background-light transition-shadow duration-200",
          scrolled ? "shadow-[0_6px_18px_rgba(15,23,42,0.08)]" : "shadow-none",
        ].join(" ")}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="size-12 rounded-full overflow-hidden border-2 border-white shadow-sm">
              <img
                alt="Alex Johnson"
                className="w-full h-full object-cover"
                src="https://lh3.googleusercontent.com/aida-public/AB6AXuAOqSnukIxxig6axnIuq0lGlXj4I6ciPTu5Oe88ZY9cv2aT0AGMV8O7q5dWRK5NhL8gG_ZGNViFE8Y1UQkVSlmp5fOYhI8JHcttUzj0NOrT1vuOpfl1qv5htMMAa3UbR-GLVKqaFMZEFu7S6NIgmO1wD7ueqr9NvXWcPoFBh2muyPArPBj6n1FJPWTbqVRbkXxLqRBvoj5UFAvRDCvxx0M7Pm0Q92fcft6HhL6Xd_Nrzyt9pt97KXKUgOy5jUvSjdrZ1iUBZJAwA68"
              />
            </div>

            <div className="leading-tight">
              <p className="text-xs text-slate-500 font-medium uppercase tracking-wider">
                Good morning
              </p>
              <h1 className="font-bold text-xl text-slate-900">Alex Johnson</h1>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              className="glass size-10 rounded-full flex items-center justify-center text-slate-700 shadow-sm"
              aria-label="Notifications"
            >
              <span className="material-symbols-outlined text-[22px]">notifications</span>
            </button>

            <button
              type="button"
              className="glass size-10 rounded-full flex items-center justify-center text-slate-700 shadow-sm"
              aria-label="Settings"
            >
              <span className="material-symbols-outlined text-[22px]">settings</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Content Scrollable Area */}
      <main className="px-6 flex flex-col gap-2.5 pt-1">
        <div className="inline-flex w-fit items-center gap-2 px-3 py-1 rounded-full bg-accent-teal/50 border border-primary/20">
          <span className="size-1.5 rounded-full bg-primary animate-pulse"></span>
          <p className="text-[11px] font-semibold text-slate-700 uppercase tracking-tight">
            {currentProgram
              ? `Week 1 of ${currentProgram.durationWeeks} · ${currentProgram.name}`
              : "No active published cycle"}
          </p>
        </div>

        {/* Hero Card (Today's Session) */}
        <section className="relative group rounded-xl overflow-hidden shadow-lg">
          <img
            alt="Gym Background"
            className="absolute inset-0 w-full h-full object-cover"
            src="https://lh3.googleusercontent.com/aida-public/AB6AXuCEPstqrEn1FRzNtnYTq447xhXDZPDl7UrsIXnlBjrCaGK7kbUC_K9xtKuDK7S3iqy43UFTU-XxY-z2QrP_jKxlZyZhrmavYgqacCnsDX9jVVph5C6J8jft5x3xJMfKDH4CCbT6y-LVErnpTGCQvYmiuKMf0XAE5qeMossuciJ7AyU783X5YiBTxrR6sY25JDGxTfNenIjjgoSwpQ1qMztyZjHzLSTLTijLN8TdqqxSEKf7asdiMEYyRTNUUQSdUf66OemeFKBvupM"
          />

          <div className="absolute inset-0 bg-gradient-to-t from-black/95 to-black/35"></div>

          <div className="relative p-4 flex flex-col justify-end min-h-[140px] sm:min-h-[160px]">
            <div className="mb-3">
              <p className="text-[9px] font-bold text-primary uppercase tracking-widest mb-0.5">
                Today's Focus
              </p>
              <h2 className="text-xl font-black text-white tracking-tight">
                {todayFocus?.name || "No workout scheduled"}
              </h2>
              <p className="text-white/90 text-xs font-semibold">
                {currentProgram ? currentProgram.name : "Current program unavailable"}
              </p>
              <p className="text-white/60 text-[10px] mt-0.5">
                {todayFocus
                  ? `Workout ${todayFocus.orderIndex} · Week ${todayFocus.weekNumber}`
                  : "Rest / recovery day"}
              </p>
            </div>

            <button
              type="button"
              className="w-full bg-primary hover:bg-[#15cfbf] text-slate-950 font-black py-2 sm:py-2.5 rounded-xl transition-all shadow-xl flex items-center justify-center gap-2"
            >
              <span className="uppercase tracking-wider text-[10px]">
                Start Session
              </span>
              <span className="material-symbols-outlined text-lg">play_arrow</span>
            </button>
          </div>
        </section>

        {/* Schedule Section */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
              <span className="material-symbols-outlined text-sm">
                calendar_today
              </span>
              Schedule
            </h3>
            <span className="text-[10px] text-slate-400 font-medium uppercase">
              Next 14 Days
            </span>
          </div>

          <div className="grid grid-cols-7 gap-1.5">
            {flatDays.map((day) => {
              const isToday = day.state === "today";
              const hasWorkout = (day.workouts || []).length > 0;
              const isPastMissed = day.state === "past_missed";

              return (
                <div key={day.date} className={getDayCardClasses(day)}>
                  <span
                    className={[
                      "text-[9px] font-medium",
                      isToday ? "text-primary font-bold" : hasWorkout ? "text-slate-500" : "text-slate-400",
                    ].join(" ")}
                  >
                    {formatDayLabel(day.date)}
                  </span>
                  <span
                    className={[
                      "text-xs font-bold",
                      isToday || hasWorkout ? "text-slate-900" : "text-slate-700",
                      isToday ? "font-black" : "",
                    ].join(" ")}
                  >
                    {formatDayNumber(day.date)}
                  </span>
                  {isToday ? (
                    <div className="size-1.5 rounded-full bg-primary mt-1 shadow-[0_0_8px_rgba(25,230,212,0.6)]"></div>
                  ) : hasWorkout ? (
                    <span className="material-symbols-outlined text-primary text-[14px] mt-1">
                      {isPastMissed ? "fitness_center" : "fitness_center"}
                    </span>
                  ) : (
                    <div className="size-1.5 rounded-full bg-slate-200 mt-1"></div>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        {/* Weekly Performance */}
        <section className="glass rounded-xl p-3 shadow-sm border border-white">
          <div className="flex items-end justify-between mb-2">
            <div>
              <h3 className="text-sm font-bold text-slate-800 tracking-tight">Weekly Performance</h3>
              <p className="text-[10px] font-semibold text-slate-500">Current Week</p>
            </div>
          </div>

          <div className="flex justify-around items-center gap-4 py-2">
            <div className="flex flex-col items-center">
              <div className="relative flex items-center justify-center size-16">
                <svg className="size-full -rotate-90" viewBox="0 0 36 36">
                  <circle
                    className="stroke-slate-100"
                    cx="18"
                    cy="18"
                    fill="none"
                    r="16"
                    strokeWidth="3"
                  ></circle>
                  <circle
                    className="stroke-primary"
                    cx="18"
                    cy="18"
                    fill="none"
                    r="16"
                    strokeDasharray={`${Math.min(100, workoutDaysThisWeek * 25)}, 100`}
                    strokeLinecap="round"
                    strokeWidth="3"
                  ></circle>
                </svg>
                <div className="absolute flex flex-col items-center">
                  <span className="text-[10px] font-bold text-slate-800">
                    {workoutDaysThisWeek}/{Math.max(workoutsPerWeek, 1)}
                  </span>
                  <span className="text-[7px] text-slate-500 uppercase font-bold">
                    Days
                  </span>
                </div>
              </div>
              <div className="mt-2 text-center">
                <p className="text-[10px] font-bold text-slate-700">Weekly Sessions</p>
                <p className="text-[8px] text-slate-400">
                  {Math.max(0, workoutsPerWeek - workoutDaysThisWeek)} remaining
                </p>
              </div>
            </div>

            <div className="flex flex-col items-center">
              <div className="relative flex items-center justify-center size-16">
                <svg className="size-full -rotate-90" viewBox="0 0 36 36">
                  <circle
                    className="stroke-slate-100"
                    cx="18"
                    cy="18"
                    fill="none"
                    r="16"
                    strokeWidth="3"
                  ></circle>
                  <circle
                    className="stroke-primary"
                    cx="18"
                    cy="18"
                    fill="none"
                    r="16"
                    strokeDasharray={`${Math.min(100, Math.round((weeklySetGoal / Math.max(weeklySetGoal, 1)) * 100))}, 100`}
                    strokeLinecap="round"
                    strokeWidth="3"
                  ></circle>
                </svg>
                <div className="absolute flex flex-col items-center">
                  <span className="text-[10px] font-bold text-slate-800">
                    {weeklySetGoal}
                  </span>
                  <span className="text-[7px] text-slate-500 uppercase font-bold">
                    Sets
                  </span>
                </div>
              </div>
              <div className="mt-2 text-center">
                <p className="text-[10px] font-bold text-slate-700">Planned Sets</p>
                <p className="text-[8px] text-slate-400">First week target</p>
              </div>
            </div>
          </div>
        </section>

        {/* AI Coach Insight */}
        <section className="glass-darker rounded-xl p-3 border-l-4 border-primary shadow-sm mt-auto">
          <div className="flex items-start gap-3">
            <div className="bg-primary/20 p-2 rounded-full">
              <span className="material-symbols-outlined text-primary text-xl">
                insights
              </span>
            </div>
            <div>
              <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wide mb-1">
                AI Coach Insight
              </h3>
              <p className="text-sm text-slate-600 leading-snug">
                {currentProgram
                  ? `Your current multi-week cycle is active. Keep the same structure on Home: current week plus next week, with missed past workouts shown in grey.`
                  : "Create and publish a multi-week cycle to see your current program and the next two weeks here."}
              </p>
            </div>
          </div>
        </section>

        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-600">
            {error}
          </div>
        )}

        {/* Navigation Spacer */}
        <div className="h-[calc(64px+max(8px,env(safe-area-inset-bottom)))]"></div>
      </main>
      {/* Bottom Navigation */}
    </div>
  );
}
