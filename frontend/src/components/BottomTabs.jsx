import { NavLink } from "react-router-dom";

const base =
  "flex flex-col items-center gap-0.5 text-slate-500 hover:text-slate-700 transition-colors";
const active = "text-slate-900";

function Tab({ to, icon, label }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) => `${base} ${isActive ? active : ""}`}
      end={to === "/"}
    >
      <span className="material-symbols-outlined text-[24px] leading-none">{icon}</span>
      <span className="text-[9px] font-medium uppercase tracking-[0.16em] leading-none">
        {label}
      </span>
    </NavLink>
  );
}

export default function BottomTabs() {
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 border-t border-white/40 bg-white/45 backdrop-blur-xl supports-[backdrop-filter]:bg-white/35 px-6 pt-2 pb-[max(8px,env(safe-area-inset-bottom))] shadow-[0_-8px_24px_rgba(15,23,42,0.08)]">
      <div className="flex items-center justify-between">
        <Tab to="/" icon="home" label="Home" />
        <Tab to="/program" icon="description" label="Program" />
        <Tab to="/progress" icon="bar_chart" label="Insights" />
        <Tab to="/coach" icon="person" label="Coach" />
      </div>
    </nav>
  );
}
