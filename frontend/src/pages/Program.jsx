import { useEffect, useState } from "react";
export default function Program() {
    const [scrolled, setScrolled] = useState(false);

    useEffect(() => {
      const onScroll = () => setScrolled(window.scrollY > 4);
      onScroll();
      window.addEventListener("scroll", onScroll, { passive: true });
      return () => window.removeEventListener("scroll", onScroll);
    }, []);
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
          <button
            type="button"
            className="flex h-10 w-10 items-center justify-center rounded-full bg-primary shadow-lg shadow-primary/20"
            aria-label="Create program"
          >
            <span className="material-symbols-outlined text-2xl text-white">
              add
            </span>
          </button>
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
                    Upper / Lower Hypertrophy
                  </h2>
                </div>
  
                <span className="px-2.5 py-1 rounded-full bg-primary/10 text-primary text-[11px] font-bold uppercase tracking-wider">
                  manual
                </span>
              </div>
  
              <div className="space-y-4">
                <div className="flex items-center justify-between text-sm text-slate-500">
                  <span>Week 4 of 8</span>
                  <span>Jan 3 - Feb 28</span>
                </div>
  
                <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                  <div className="h-full bg-primary rounded-full w-1/2" />
                </div>
  
                <button
                  type="button"
                  className="w-full mt-4 py-3 rounded-xl text-sm font-bold border shadow-sm hover:shadow-md transition-shadow bg-primary text-white border-primary/20 shadow-md shadow-primary/20"
                >
                  View Details
                </button>
              </div>
            </div>
          </section>
  
          {/* Cycle Structure */}
          <section>
            <h3 className="text-lg font-bold mb-8 px-2">Cycle Structure</h3>
  
            <div className="space-y-12 px-2">
              {/* Row 1 */}
              <div className="relative flex justify-between items-center">
                <div className="absolute top-4 left-0 w-full h-1 bg-slate-200 z-0" />
                <div className="absolute top-4 left-0 w-[60%] h-1 bg-primary z-10" />
  
                {/* W1 */}
                <div className="relative z-20 flex flex-col items-center">
                  <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center text-white shadow-sm">
                    <span className="material-symbols-outlined text-sm">
                      check
                    </span>
                  </div>
                  <span className="absolute -bottom-6 text-[10px] font-bold text-slate-500">
                    W1
                  </span>
                </div>
  
                {/* W2 */}
                <div className="relative z-20 flex flex-col items-center">
                  <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center text-white shadow-sm">
                    <span className="material-symbols-outlined text-sm">
                      check
                    </span>
                  </div>
                  <span className="absolute -bottom-6 text-[10px] font-bold text-slate-500">
                    W2
                  </span>
                </div>
  
                {/* W3 */}
                <div className="relative z-20 flex flex-col items-center">
                  <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center text-white shadow-sm">
                    <span className="material-symbols-outlined text-sm">
                      check
                    </span>
                  </div>
                  <span className="absolute -bottom-6 text-[10px] font-bold text-slate-500">
                    W3
                  </span>
                </div>
  
                {/* W4 current */}
                <div className="relative z-20 flex flex-col items-center">
                  <div className="w-10 h-10 rounded-full bg-primary border-4 border-white flex items-center justify-center text-white shadow-lg shadow-primary/40 -mt-1">
                    <span className="text-xs font-bold">W4</span>
                  </div>
                  <span className="absolute -bottom-6 text-[10px] font-bold text-primary">
                    NOW
                  </span>
                </div>
  
                {/* W5 */}
                <div className="relative z-20 flex flex-col items-center">
                  <div className="w-8 h-8 rounded-full bg-white border-2 border-slate-200 flex items-center justify-center text-slate-400">
                    <span className="text-[10px] font-bold">5</span>
                  </div>
                  <span className="absolute -bottom-6 text-[10px] font-bold text-slate-400">
                    W5
                  </span>
                </div>
  
                {/* W6 */}
                <div className="relative z-20 flex flex-col items-center">
                  <div className="w-8 h-8 rounded-full bg-white border-2 border-slate-200 flex items-center justify-center text-slate-400">
                    <span className="text-[10px] font-bold">6</span>
                  </div>
                  <span className="absolute -bottom-6 text-[10px] font-bold text-slate-400">
                    W6
                  </span>
                </div>
              </div>
  
              {/* Row 2 */}
              <div className="relative flex justify-between items-center pt-8 pb-8">
                <div className="absolute top-12 left-0 w-full h-1 bg-slate-200 z-0" />
  
                {/* W7 */}
                <div className="relative z-20 flex flex-col items-center">
                  <div className="w-8 h-8 rounded-full bg-white border-2 border-slate-200 flex items-center justify-center text-slate-400 shadow-sm">
                    <span className="text-[10px] font-bold">7</span>
                  </div>
                  <span className="absolute -bottom-6 text-[10px] font-bold text-slate-500">
                    W7
                  </span>
                </div>
  
                {/* W8 */}
                <div className="relative z-20 flex flex-col items-center">
                  <div className="w-8 h-8 rounded-full bg-white border-2 border-slate-200 flex items-center justify-center text-slate-400 shadow-sm">
                    <span className="text-[10px] font-bold">8</span>
                  </div>
                  <span className="absolute -bottom-6 text-[10px] font-bold text-slate-500">
                    W8
                  </span>
                </div>
  
                {/* W9 deload */}
                <div className="relative z-20 flex flex-col items-center">
                  <span className="absolute -top-7 text-[8px] font-bold tracking-wider text-slate-400 uppercase">
                    Deload
                  </span>
                  <div className="w-8 h-8 rounded-full bg-slate-50 border-2 border-dashed border-slate-300 flex items-center justify-center text-slate-400">
                    <span className="text-[10px] font-bold">9</span>
                  </div>
                  <span className="absolute -bottom-6 text-[10px] font-bold text-slate-500">
                    W9
                  </span>
                </div>
  
                {/* New cycle group */}
                <div className="relative flex gap-8">
                  <span className="absolute -top-7 left-1/2 -translate-x-1/2 text-[8px] font-bold tracking-wider uppercase whitespace-nowrap">
                    New Cycle
                  </span>
  
                  {[10, 11, 12].map((n) => (
                    <div key={n} className="relative z-20 flex flex-col items-center">
                      <div className="w-8 h-8 rounded-full border-2 flex items-center justify-center shadow-sm bg-background-light border-slate-200">
                        <span className="text-[10px] font-bold">{n}</span>
                      </div>
                      <span className="absolute -bottom-6 text-[10px] font-bold text-slate-500">
                        W{n}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </section>
  
          {/* Past Programs */}
          <section>
            <div className="flex items-center justify-between mb-4 px-2">
              <h3 className="text-lg font-bold">Past Programs</h3>
              <button type="button" className="text-sm font-medium text-primary">
                See All
              </button>
            </div>
  
            <div className="space-y-3 px-2">
              {[
                { title: "Strength Phase", subtitle: "Completed Oct 2023", icon: "fitness_center" },
                { title: "Summer Cut", subtitle: "Completed Aug 2023", icon: "sunny" },
              ].map((p) => (
                <div
                  key={p.title}
                  className="flex items-center gap-4 p-4 rounded-2xl bg-white border border-slate-100 shadow-sm"
                >
                  <div className="w-12 h-12 rounded-lg bg-slate-100 flex items-center justify-center">
                    <span className="material-symbols-outlined text-slate-400">
                      {p.icon}
                    </span>
                  </div>
                  <div className="flex-1">
                    <h4 className="text-sm font-bold">{p.title}</h4>
                    <p className="text-xs text-slate-500">{p.subtitle}</p>
                  </div>
                  <span className="material-symbols-outlined text-slate-300">
                    chevron_right
                  </span>
                </div>
              ))}
            </div>
          </section>
  
          {/* Saved Programs */}
          <section className="pb-6">
            <div className="flex items-center justify-between mb-4 px-2">
              <h3 className="text-lg font-bold">Saved Programs</h3>
              <button type="button" className="text-sm font-medium text-primary">
                Browse
              </button>
            </div>
  
            <div className="space-y-3 px-2">
              {[
                { title: "Push Pull Legs Blueprint", subtitle: "6 Days / 125 Sets • Per Week" },
                { title: "Classic Physique Focus", subtitle: "5 Days / 116 Sets • Per Week" },
              ].map((p) => (
                <div
                  key={p.title}
                  className="relative overflow-hidden rounded-2xl bg-white border border-slate-100 p-5 shadow-sm"
                >
                  <div className="flex justify-between items-center">
                    <div>
                      <h4 className="text-sm font-bold">{p.title}</h4>
                      <p className="text-xs text-slate-500 mt-1">{p.subtitle}</p>
                    </div>
  
                    <button
                      type="button"
                      className="h-8 w-8 rounded-full flex items-center justify-center text-slate-400"
                      aria-label="Bookmark"
                    >
                      <span className="material-symbols-outlined">bookmark</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </main>
  
        {/* Spacer for BottomTabs */}
        <div className="h-[calc(64px+max(8px,env(safe-area-inset-bottom)))]" />
      </div>
    );
  }