import { useEffect, useMemo, useState } from "react";
import { getHomeDashboard } from "../services/api";

function getLocalDateInput() {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDayLabel(dateKey) {
  return new Date(`${dateKey}T00:00:00Z`).toLocaleDateString("en-US", {
    weekday: "narrow",
    timeZone: "UTC",
  });
}

function formatDayNumber(dateKey) {
  return new Date(`${dateKey}T00:00:00Z`).getUTCDate();
}

function getDayCardClasses(day) {
  if (day?.isSelected && day?.isToday) {
    return "flex flex-col items-center rounded-lg border border-primary/40 bg-primary/20 p-2 relative";
  }

  if (day?.isSelected) {
    return "flex flex-col items-center rounded-lg border border-primary/30 bg-primary/10 p-2";
  }

  if (day?.state === "planned") {
    return "flex flex-col items-center rounded-lg border border-primary/40 bg-white p-2 shadow-sm";
  }

  return "flex flex-col items-center rounded-lg border border-slate-100 bg-white p-2 shadow-sm";
}

export default function HomeDashboard() {
  const [scrolled, setScrolled] = useState(false);
  const [dashboard, setDashboard] = useState(null);
  const [error, setError] = useState("");
  const [selectedDate, setSelectedDate] = useState(() => getLocalDateInput());
  const [fixedScheduleDays, setFixedScheduleDays] = useState([]);

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
        const response = await getHomeDashboard(selectedDate);
        if (isMounted) {
          setDashboard(response);
          setFixedScheduleDays((currentDays) =>
            currentDays.length > 0 ? currentDays : response?.schedule14Days?.days || []
          );
          setSelectedDate(response?.selectedDate || selectedDate);
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
  }, [selectedDate]);

  const status = dashboard?.status || null;
  const currentProgram = dashboard?.currentProgram || null;
  const todayFocus = dashboard?.todayFocus || null;
  const scheduleDays = useMemo(
    () =>
      fixedScheduleDays.map((day) => ({
        ...day,
        isSelected: day.date === selectedDate,
      })),
    [fixedScheduleDays, selectedDate]
  );
  const firstWeekDays = scheduleDays.slice(0, 7);
  const isSelectedDateToday = useMemo(
    () => scheduleDays.some((day) => day.date === dashboard?.selectedDate && day.isToday),
    [dashboard?.selectedDate, scheduleDays]
  );

  const weeklySetGoal = currentProgram?.summary?.totalSetsFirstWeek || 24;
  const workoutsPerWeek = currentProgram?.summary?.sessionsPerWeek || 4;
  const workoutDaysThisWeek = firstWeekDays.filter((day) => day.session).length;
  const focusHeading = isSelectedDateToday ? "Today's Focus" : "Selected Day Focus";

  return (
    <div className="-mx-6 bg-background-light text-slate-900 antialiased font-display">
      <header
        className={[
          "sticky top-0 z-40 bg-background-light px-6 pb-1 pt-1 transition-shadow duration-200",
          scrolled ? "shadow-[0_6px_18px_rgba(15,23,42,0.08)]" : "shadow-none",
        ].join(" ")}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="size-12 overflow-hidden rounded-full border-2 border-white shadow-sm">
              <img
                alt="Alex Johnson"
                className="h-full w-full object-cover"
                src="https://lh3.googleusercontent.com/aida-public/AB6AXuAOqSnukIxxig6axnIuq0lGlXj4I6ciPTu5Oe88ZY9cv2aT0AGMV8O7q5dWRK5NhL8gG_ZGNViFE8Y1UQkVSlmp5fOYhI8JHcttUzj0NOrT1vuOpfl1qv5htMMAa3UbR-GLVKqaFMZEFu7S6NIgmO1wD7ueqr9NvXWcPoFBh2muyPArPBj6n1FJPWTbqVRbkXxLqRBvoj5UFAvRDCvxx0M7Pm0Q92fcft6HhL6Xd_Nrzyt9pt97KXKUgOy5jUvSjdrZ1iUBZJAwA68"
              />
            </div>

            <div className="leading-tight">
              <p className="text-xs font-medium uppercase tracking-wider text-slate-500">
                Good morning
              </p>
              <h1 className="text-xl font-bold text-slate-900">Alex Johnson</h1>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              className="glass flex size-10 items-center justify-center rounded-full text-slate-700 shadow-sm"
              aria-label="Notifications"
            >
              <span className="material-symbols-outlined text-[22px]">notifications</span>
            </button>

            <button
              type="button"
              className="glass flex size-10 items-center justify-center rounded-full text-slate-700 shadow-sm"
              aria-label="Settings"
            >
              <span className="material-symbols-outlined text-[22px]">settings</span>
            </button>
          </div>
        </div>
      </header>

      <main className="flex flex-col gap-2.5 px-6 pt-1">
        <div className="inline-flex w-fit items-center gap-2 rounded-full border border-primary/20 bg-accent-teal/50 px-3 py-1">
          <span className="size-1.5 rounded-full bg-primary animate-pulse"></span>
          <p className="text-[11px] font-semibold uppercase tracking-tight text-slate-700">
            {status?.label || "No published cycle"}
          </p>
        </div>

        <section className="group relative overflow-hidden rounded-xl shadow-lg">
          <img
            alt="Gym Background"
            className="absolute inset-0 h-full w-full object-cover"
            src="https://lh3.googleusercontent.com/aida-public/AB6AXuCEPstqrEn1FRzNtnYTq447xhXDZPDl7UrsIXnlBjrCaGK7kbUC_K9xtKuDK7S3iqy43UFTU-XxY-z2QrP_jKxlZyZhrmavYgqacCnsDX9jVVph5C6J8jft5x3xJMfKDH4CCbT6y-LVErnpTGCQvYmiuKMf0XAE5qeMossuciJ7AyU783X5YiBTxrR6sY25JDGxTfNenIjjgoSwpQ1qMztyZjHzLSTLTijLN8TdqqxSEKf7asdiMEYyRTNUUQSdUf66OemeFKBvupM"
          />

          <div className="absolute inset-0 bg-gradient-to-t from-black/95 to-black/35"></div>

          <div className="relative flex min-h-[140px] flex-col justify-end p-4 sm:min-h-[160px]">
            <div className="mb-3">
              <p className="mb-0.5 text-[9px] font-bold uppercase tracking-widest text-primary">
                {focusHeading}
              </p>
              <h2 className="text-xl font-black tracking-tight text-white">
                {todayFocus?.title || "Rest / Recovery"}
              </h2>
              <p className="text-xs font-semibold text-white/90">
                {currentProgram ? currentProgram.name : "Current program unavailable"}
              </p>
              <p className="mt-0.5 text-[10px] text-white/60">
                {todayFocus?.subtitle || "No session planned"}
              </p>
            </div>

            <button
              type="button"
              disabled={!todayFocus?.showStartSession}
              className={[
                "flex h-11 w-full items-center justify-center gap-2 rounded-xl px-4 shadow-xl transition-all",
                todayFocus?.showStartSession
                  ? "bg-primary hover:bg-[#15cfbf]"
                  : "cursor-not-allowed border border-white/15 bg-white/10",
              ].join(" ")}
            >
              <span
                className={[
                  "text-[10px] font-black uppercase tracking-wider",
                  todayFocus?.showStartSession ? "text-slate-950" : "text-white/80",
                ].join(" ")}
              >
                {todayFocus?.showStartSession ? "Start Session" : "Rest Day"}
              </span>
              <span
                className={[
                  "material-symbols-outlined text-lg",
                  todayFocus?.showStartSession ? "text-slate-950" : "text-white/70",
                ].join(" ")}
              >
                {todayFocus?.showStartSession ? "play_arrow" : "bedtime"}
              </span>
            </button>
          </div>
        </section>

        <section>
          <div className="mb-3 flex items-center justify-between">
            <h3 className="flex items-center gap-2 text-sm font-bold text-slate-800">
              <span className="material-symbols-outlined text-sm">calendar_today</span>
              Schedule
            </h3>
            <span className="text-[10px] font-medium uppercase text-slate-400">
              Next 14 Days
            </span>
          </div>

          <div className="grid grid-cols-7 gap-1.5">
            {scheduleDays.map((day) => {
              const hasSession = Boolean(day.session);

              return (
                <button
                  key={day.date}
                  type="button"
                  onClick={() => setSelectedDate(day.date)}
                  className={getDayCardClasses(day)}
                  aria-pressed={day.isSelected}
                  aria-label={`Select ${day.date}`}
                >
                  <span
                    className={[
                      "text-[9px] font-medium",
                      day.isToday || day.isSelected
                        ? "font-bold text-primary"
                        : hasSession
                          ? "text-slate-500"
                          : "text-slate-400",
                    ].join(" ")}
                  >
                    {formatDayLabel(day.date)}
                  </span>
                  <span
                    className={[
                      "text-xs font-bold",
                      day.isToday || day.isSelected || hasSession
                        ? "text-slate-900"
                        : "text-slate-700",
                      day.isToday || day.isSelected ? "font-black" : "",
                    ].join(" ")}
                  >
                    {formatDayNumber(day.date)}
                  </span>
                  {hasSession ? (
                    <span className="material-symbols-outlined mt-1 text-[14px] text-primary">
                      fitness_center
                    </span>
                  ) : (
                    <div
                      className={[
                        "mt-1 size-1.5 rounded-full",
                        day.isToday
                          ? "bg-primary shadow-[0_0_8px_rgba(25,230,212,0.6)]"
                          : "bg-slate-200",
                      ].join(" ")}
                    ></div>
                  )}
                </button>
              );
            })}
          </div>
        </section>

        <section className="glass rounded-xl border border-white p-3 shadow-sm">
          <div className="mb-2 flex items-end justify-between">
            <div>
              <h3 className="text-sm font-bold tracking-tight text-slate-800">
                Weekly Performance
              </h3>
              <p className="text-[10px] font-semibold text-slate-500">Current Week</p>
            </div>
          </div>

          <div className="flex items-center justify-around gap-4 py-2">
            <div className="flex flex-col items-center">
              <div className="relative flex size-16 items-center justify-center">
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
                  <span className="text-[7px] font-bold uppercase text-slate-500">
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
              <div className="relative flex size-16 items-center justify-center">
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
                    strokeDasharray={`${Math.min(
                      100,
                      Math.round((weeklySetGoal / Math.max(weeklySetGoal, 1)) * 100)
                    )}, 100`}
                    strokeLinecap="round"
                    strokeWidth="3"
                  ></circle>
                </svg>
                <div className="absolute flex flex-col items-center">
                  <span className="text-[10px] font-bold text-slate-800">
                    {weeklySetGoal}
                  </span>
                  <span className="text-[7px] font-bold uppercase text-slate-500">
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

        <section className="glass-darker mt-auto rounded-xl border-l-4 border-primary p-3 shadow-sm">
          <div className="flex items-start gap-3">
            <div className="rounded-full bg-primary/20 p-2">
              <span className="material-symbols-outlined text-xl text-primary">
                insights
              </span>
            </div>
            <div>
              <h3 className="mb-1 text-xs font-bold uppercase tracking-wide text-slate-800">
                AI Coach Insight
              </h3>
              <p className="text-sm leading-snug text-slate-600">
                {currentProgram
                  ? "Your Home now follows the published cycle and scheduled sessions. Select any day to preview its planned focus."
                  : "Create and publish a multi-week cycle to see your current program and upcoming sessions here."}
              </p>
            </div>
          </div>
        </section>

        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-600">
            {error}
          </div>
        )}

        <div className="h-[calc(64px+max(8px,env(safe-area-inset-bottom)))]"></div>
      </main>
    </div>
  );
}
