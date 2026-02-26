import { useEffect, useState } from "react";
export default function HomeDashboard() {
    const [compact, setCompact] = useState(false);

    useEffect(() => {
        const scroller = document.getElementById("home-scroll");
        if (!scroller) return;
      
        const onScroll = () => setCompact(scroller.scrollTop > 18);
      
        onScroll();
        scroller.addEventListener("scroll", onScroll, { passive: true });
        return () => scroller.removeEventListener("scroll", onScroll);
      }, []);

    return (
        <div id="home-scroll" className="bg-background-light text-slate-900 antialiased font-display h-full min-h-0 overflow-y-auto hide-scrollbar">
      {/* Header Section */}
      <header
        className={[
            "sticky top-0 z-40 px-0 bg-background-light/85 backdrop-blur-md",
            "transition-all",
            compact ? "pt-2 pb-2" : "pt-0 pb-3",
        ].join(" ")}
        >
        <div className={["flex items-center justify-between", compact ? "mb-2" : "mb-4"].join(" ")}>
            <div className="flex items-center gap-3">
            <div
                className={[
                "rounded-full overflow-hidden border-2 border-white shadow-sm transition-all",
                compact ? "size-9" : "size-12",
                ].join(" ")}
            >
                <img
                alt="Alex"
                className="w-full h-full object-cover"
                src="https://lh3.googleusercontent.com/aida-public/AB6AXuAOqSnukIxxig6axnIuq0lGlXj4I6ciPTu5Oe88ZY9cv2aT0AGMV8O7q5dWRK5NhL8gG_ZGNViFE8Y1UQkVSlmp5fOYhI8JHcttUzj0NOrT1vuOpfl1qv5htMMAa3UbR-GLVKqaFMZEFu7S6NIgmO1wD7ueqr9NvXWcPoFBh2muyPArPBj6n1FJPWTbqVRbkXxLqRBvoj5UFAvRDCvxx0M7Pm0Q92fcft6HhL6Xd_Nrzyt9pt97KXKUgOy5jUvSjdrZ1iUBZJAwA68"
                />
            </div>

            <div className="leading-tight">
                {!compact && (
                <p className="text-xs text-slate-500 font-medium uppercase tracking-wider">
                    Good morning
                </p>
                )}
                <h1 className={["font-bold text-slate-900 transition-all", compact ? "text-base" : "text-xl"].join(" ")}>
                Alex Johnson
                </h1>
            </div>
            </div>

            <div className={["flex items-center transition-all", compact ? "gap-2" : "gap-3"].join(" ")}>
            <button
                type="button"
                className={[
                "glass rounded-full flex items-center justify-center text-slate-700 shadow-sm transition-all",
                compact ? "size-9" : "size-10",
                ].join(" ")}
                aria-label="Notifications"
            >
                <span className="material-symbols-outlined text-[22px]">notifications</span>
            </button>

            <button
                type="button"
                className={[
                "glass rounded-full flex items-center justify-center text-slate-700 shadow-sm transition-all",
                compact ? "size-9" : "size-10",
                ].join(" ")}
                aria-label="Settings"
            >
                <span className="material-symbols-outlined text-[22px]">settings</span>
            </button>
            </div>
        </div>

        {!compact && (
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-accent-teal/50 border border-primary/20">
            <span className="size-1.5 rounded-full bg-primary animate-pulse"></span>
            <p className="text-[11px] font-semibold text-slate-700 uppercase tracking-tight">
                Week 4 of 8 · Hypertrophy Phase
            </p>
            </div>
        )}
      </header>

      {/* Main Content Scrollable Area */}
      <main className="px-0 flex flex-col gap-2.5 pt-1">
        {/* Hero Card (Today's Session) */}
        <section className="relative group rounded-xl overflow-hidden shadow-lg">
          <img
            alt="Gym Background"
            className="absolute inset-0 w-full h-full object-cover"
            src="https://lh3.googleusercontent.com/aida-public/AB6AXuCEPstqrEn1FRzNtnYTq447xhXDZPDl7UrsIXnlBjrCaGK7kbUC_K9xtKuDK7S3iqy43UFTU-XxY-z2QrP_jKxlZyZhrmavYgqacCnsDX9jVVph5C6J8jft5x3xJMfKDH4CCbT6y-LVErnpTGCQvYmiuKMf0XAE5qeMossuciJ7AyU783X5YiBTxrR6sY25JDGxTfNenIjjgoSwpQ1qMztyZjHzLSTLTijLN8TdqqxSEKf7asdiMEYyRTNUUQSdUf66OemeFKBvupM"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/95 via-black/50 to-transparent"></div>

          <div className="relative p-4 flex flex-col justify-end min-h-[140px] sm:min-h-[160px]">
            <div className="mb-3">
              <p className="text-[9px] font-bold text-primary uppercase tracking-widest mb-0.5">
                Today's Focus
              </p>
              <h2 className="text-xl font-black text-white tracking-tight">
                Lower Body A
              </h2>
              <p className="text-white/90 text-xs font-semibold">
                Quadriceps &amp; Glutes
              </p>
              <p className="text-white/60 text-[10px] mt-0.5">
                65 min · 7 exercises · 24 sets
              </p>
            </div>

            <button
              type="button"
              className="w-full bg-primary hover:bg-[#15cfbf] text-slate-950 font-black py-2 sm:py-2.5 rounded-xl transition-all shadow-xl flex items-center justify-center gap-2"
            >
              <span className="uppercase tracking-wider text-[10px]">
                Start Session
              </span>
              <span className="material-symbols-outlined text-lg">
                play_arrow
              </span>
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
            <div className="flex flex-col items-center p-2 rounded-lg bg-white shadow-sm border border-slate-100">
              <span className="text-[9px] text-slate-400 font-medium">M</span>
              <span className="text-xs font-bold text-slate-700">12</span>
              <div className="size-1.5 rounded-full bg-slate-200 mt-1"></div>
            </div>

            <div className="flex flex-col items-center p-2 rounded-lg bg-white shadow-sm border border-primary/40">
              <span className="text-[9px] text-slate-500 font-medium">T</span>
              <span className="text-xs font-bold text-slate-900">13</span>
              <span className="material-symbols-outlined text-[14px] mt-1 text-primary">
                check_circle
              </span>
            </div>

            <div className="flex flex-col items-center p-2 rounded-lg bg-white shadow-sm border border-slate-100">
              <span className="text-[9px] text-slate-400 font-medium">W</span>
              <span className="text-xs font-bold text-slate-700">14</span>
              <div className="size-1.5 rounded-full bg-slate-200 mt-1"></div>
            </div>

            <div className="flex flex-col items-center p-2 rounded-lg bg-primary/20 border border-primary/30 relative">
              <span className="text-[9px] text-primary font-bold">T</span>
              <span className="text-xs font-black text-slate-900">15</span>
              <div className="size-1.5 rounded-full bg-primary mt-1 shadow-[0_0_8px_rgba(25,230,212,0.6)]"></div>
            </div>

            <div className="flex flex-col items-center p-2 rounded-lg bg-white shadow-sm border border-primary/40">
              <span className="text-[9px] text-slate-500 font-medium">F</span>
              <span className="text-xs font-bold text-slate-900">16</span>
              <span className="material-symbols-outlined text-primary text-[14px] mt-1">
                fitness_center
              </span>
            </div>

            <div className="flex flex-col items-center p-2 rounded-lg bg-white shadow-sm border border-primary/40">
              <span className="text-[9px] text-slate-500 font-medium">S</span>
              <span className="text-xs font-bold text-slate-900">17</span>
              <span className="material-symbols-outlined text-primary text-[14px] mt-1">
                fitness_center
              </span>
            </div>

            <div className="flex flex-col items-center p-2 rounded-lg bg-white shadow-sm border border-slate-100">
              <span className="text-[9px] text-slate-400 font-medium">S</span>
              <span className="text-xs font-bold text-slate-700">18</span>
              <div className="size-1.5 rounded-full bg-slate-200 mt-1"></div>
            </div>

            <div className="flex flex-col items-center p-2 rounded-lg bg-white shadow-sm border border-slate-100">
              <span className="text-[9px] text-slate-400 font-medium">M</span>
              <span className="text-xs font-bold text-slate-700">19</span>
              <div className="size-1.5 rounded-full bg-slate-200 mt-1"></div>
            </div>

            <div className="flex flex-col items-center p-2 rounded-lg bg-white shadow-sm border border-primary/40">
              <span className="text-[9px] text-slate-500 font-medium">T</span>
              <span className="text-xs font-bold text-slate-900">20</span>
              <span className="material-symbols-outlined text-primary text-[14px] mt-1">
                fitness_center
              </span>
            </div>

            <div className="flex flex-col items-center p-2 rounded-lg bg-white shadow-sm border border-slate-100">
              <span className="text-[9px] text-slate-400 font-medium">W</span>
              <span className="text-xs font-bold text-slate-700">21</span>
              <div className="size-1.5 rounded-full bg-slate-200 mt-1"></div>
            </div>

            <div className="flex flex-col items-center p-2 rounded-lg bg-white shadow-sm border border-primary/40">
              <span className="text-[9px] text-slate-500 font-medium">T</span>
              <span className="text-xs font-bold text-slate-900">22</span>
              <span className="material-symbols-outlined text-primary text-[14px] mt-1">
                fitness_center
              </span>
            </div>

            <div className="flex flex-col items-center p-2 rounded-lg bg-white shadow-sm border border-primary/40">
              <span className="text-[9px] text-slate-500 font-medium">F</span>
              <span className="text-xs font-bold text-slate-900">23</span>
              <span className="material-symbols-outlined text-primary text-[14px] mt-1">
                fitness_center
              </span>
            </div>

            <div className="flex flex-col items-center p-2 rounded-lg bg-white shadow-sm border border-primary/40">
              <span className="text-[9px] text-slate-500 font-medium">S</span>
              <span className="text-xs font-bold text-slate-900">24</span>
              <span className="material-symbols-outlined text-primary text-[14px] mt-1">
                fitness_center
              </span>
            </div>

            <div className="flex flex-col items-center p-2 rounded-lg bg-white shadow-sm border border-slate-100">
              <span className="text-[9px] text-slate-400 font-medium">S</span>
              <span className="text-xs font-bold text-slate-700">25</span>
              <div className="size-1.5 rounded-full bg-slate-200 mt-1"></div>
            </div>
          </div>
        </section>

        {/* Weekly Performance */}
        <section className="glass rounded-xl p-3 shadow-sm border border-white">
        <div className="flex items-end justify-between mb-2">
            <div>
                <h3 className="text-sm font-bold text-slate-800 tracking-tight">Weekly Performance</h3>
                <p className="text-[10px] font-semibold text-slate-500">Week 4</p>
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
                    strokeDasharray="75, 100"
                    strokeLinecap="round"
                    strokeWidth="3"
                  ></circle>
                </svg>
                <div className="absolute flex flex-col items-center">
                  <span className="text-[10px] font-bold text-slate-800">
                    18/24
                  </span>
                  <span className="text-[7px] text-slate-500 uppercase font-bold">
                    Sets
                  </span>
                </div>
              </div>
              <div className="mt-2 text-center">
                <p className="text-[10px] font-bold text-slate-700">
                  Weekly Sets
                </p>
                <p className="text-[8px] text-slate-400">6 remaining</p>
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
                    strokeDasharray="75, 100"
                    strokeLinecap="round"
                    strokeWidth="3"
                  ></circle>
                </svg>
                <div className="absolute flex flex-col items-center">
                  <span className="text-[10px] font-bold text-slate-800">
                    195/260
                  </span>
                  <span className="text-[7px] text-slate-500 uppercase font-bold">
                    Min
                  </span>
                </div>
              </div>
              <div className="mt-2 text-center">
                <p className="text-[10px] font-bold text-slate-700">
                  Workout Time
                </p>
                <p className="text-[8px] text-slate-400">65 min left</p>
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
                Your squat improved by{" "}
                <span className="text-slate-900 font-bold">+10 lb</span> this
                cycle. Recovery is good.{" "}
                <span className="text-primary font-medium">
                  Deload recommended
                </span>{" "}
                in 10 days.
              </p>
            </div>
          </div>
        </section>
        {/* Navigation Spacer */}
        <div className="h-[calc(64px+max(8px,env(safe-area-inset-bottom)))]"></div>
      </main>
      {/* Bottom Navigation */}
    </div>
  );
}
